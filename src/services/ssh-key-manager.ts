/**
 * SSHKeyManager — ephemeral ED25519 deploy key lifecycle for GitHub repos.
 *
 * Generates fresh ED25519 keypairs on each loop start, registers them with
 * GitHub as per-repo deploy keys (write access), injects the private key into
 * the running Docker container so the Claude agent can push commits, and
 * deletes the key from GitHub when the loop stops or fails.
 *
 * Keys are short-lived and scoped to a single repository. The private key
 * never touches the host filesystem — it exists only in memory and inside
 * the container's ephemeral `/root/.ssh/` directory.
 *
 * GitHub known_hosts fingerprint is hardcoded to prevent MITM on first
 * connection inside the container.
 */

import crypto from 'crypto';
import https from 'https';

/** DockerManager interface required by SSHKeyManager (narrow pick for testability). */
export interface Execable {
  execCommand(
    containerId: string,
    cmd: string[],
    opts?: { user?: string; workingDir?: string; env?: string[] }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

/** Parsed GitHub repository coordinates. */
export interface GithubRepo {
  owner: string;
  repo: string;
}

/**
 * GitHub's hardcoded ED25519 host fingerprint.
 * Pinning this prevents MITM on the very first `git push` inside the container.
 * Source: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
 */
const GITHUB_KNOWN_HOST =
  'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';

/**
 * SSH config written to ~/.ssh/config inside the container.
 * Forces use of the injected key and strict host key checking.
 */
const SSH_CONFIG = `Host github.com
  IdentityFile ~/.ssh/id_ed25519
  StrictHostKeyChecking yes
`;

export class SSHKeyManager {
  private readonly dockerManager: Execable;

  constructor(dockerManager: Execable) {
    this.dockerManager = dockerManager;
  }

  /**
   * Generate a fresh ED25519 keypair.
   *
   * Returns:
   * - `privateKey`: PKCS#8 PEM format (compatible with OpenSSH 7.8+, which
   *   covers Ubuntu 20.04 and later)
   * - `publicKey`: OpenSSH authorized_keys format (`ssh-ed25519 <base64> <comment>`)
   *   suitable for upload to the GitHub deploy keys API
   */
  generateKeyPair(): { privateKey: string; publicKey: string } {
    const keyPair = crypto.generateKeyPairSync('ed25519');

    const privateKey = keyPair.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;

    // Extract the raw 32-byte public key from the SPKI DER encoding.
    // ED25519 SPKI DER is always: 30 2a 30 05 06 03 2b 65 70 03 21 00 <32 bytes>
    // The last 32 bytes are invariably the raw key material.
    const spkiDer = keyPair.publicKey.export({
      type: 'spki',
      format: 'der',
    }) as Buffer;

    const rawKey = spkiDer.slice(-32);

    // SSH public key wire format: [uint32 type-len][type][uint32 key-len][key-bytes]
    const typeBuf = Buffer.from('ssh-ed25519');
    const typeLen = Buffer.allocUnsafe(4);
    typeLen.writeUInt32BE(typeBuf.length);
    const keyLen = Buffer.allocUnsafe(4);
    keyLen.writeUInt32BE(rawKey.length);

    const blob = Buffer.concat([typeLen, typeBuf, keyLen, rawKey]);
    const publicKey = `ssh-ed25519 ${blob.toString('base64')} zephyr-deploy-key`;

    return { privateKey, publicKey };
  }

  /**
   * Parse a GitHub repository URL into `{ owner, repo }`.
   *
   * Handles:
   * - HTTPS: `https://github.com/owner/repo` or `https://github.com/owner/repo.git`
   * - SSH: `git@github.com:owner/repo.git`
   *
   * @throws if the URL cannot be parsed as a GitHub repo URL
   */
  parseGithubRepo(url: string): GithubRepo {
    // SSH format: git@github.com:owner/repo.git
    const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    // HTTPS format: https://github.com/owner/repo or https://github.com/owner/repo.git
    const httpsMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    throw new Error(`Cannot parse GitHub repo from URL: ${url}`);
  }

  /**
   * Returns true if the given URL points to a GitHub repository.
   */
  isGithubUrl(url: string): boolean {
    return /github\.com[:/]/.test(url);
  }

  /**
   * Register a public key as a deploy key on a GitHub repository.
   *
   * @param pat - GitHub Personal Access Token with repo deploy key write access
   * @param repoUrl - Repository URL (HTTPS or SSH format)
   * @param publicKey - OpenSSH public key string (`ssh-ed25519 AAAA...`)
   * @param title - Display name shown in GitHub's deploy keys list
   * @returns The numeric `key_id` assigned by GitHub (needed for later deletion)
   */
  async addDeployKey(
    pat: string,
    repoUrl: string,
    publicKey: string,
    title: string
  ): Promise<number> {
    const { owner, repo } = this.parseGithubRepo(repoUrl);

    const body = JSON.stringify({
      title,
      key: publicKey,
      read_only: false, // write access required for git push
    });

    const response = await this.githubApiRequest('POST', `/repos/${owner}/${repo}/keys`, pat, body);

    if (response.statusCode !== 201) {
      throw new Error(
        `GitHub deploy key creation failed: HTTP ${response.statusCode} — ${response.body}`
      );
    }

    const data = JSON.parse(response.body) as { id: number };
    return data.id;
  }

  /**
   * Delete a deploy key from a GitHub repository.
   *
   * @param pat - GitHub Personal Access Token with repo deploy key write access
   * @param repoUrl - Repository URL (HTTPS or SSH format)
   * @param keyId - The numeric key_id returned by `addDeployKey`
   */
  async removeDeployKey(pat: string, repoUrl: string, keyId: number): Promise<void> {
    const { owner, repo } = this.parseGithubRepo(repoUrl);
    const response = await this.githubApiRequest(
      'DELETE',
      `/repos/${owner}/${repo}/keys/${keyId}`,
      pat,
      null
    );

    // 204 No Content on success; 404 if already deleted (idempotent)
    if (response.statusCode !== 204 && response.statusCode !== 404) {
      throw new Error(
        `GitHub deploy key deletion failed: HTTP ${response.statusCode} — ${response.body}`
      );
    }
  }

  /**
   * Inject an ED25519 private key into a running container's SSH directory.
   *
   * Sets up:
   * - `~/.ssh/id_ed25519` (chmod 600) — private key for authentication
   * - `~/.ssh/known_hosts` — hardcoded GitHub ED25519 fingerprint (prevents MITM)
   * - `~/.ssh/config` — tells ssh to use this key for github.com
   *
   * All writes use base64-encoded printf to avoid shell escaping issues with
   * PEM key content (newlines, special characters).
   *
   * @param containerId - Running Docker container ID
   * @param privateKey - PKCS#8 PEM private key string
   */
  async injectIntoContainer(containerId: string, privateKey: string): Promise<void> {
    const exec = (cmd: string) =>
      this.dockerManager.execCommand(containerId, ['sh', '-c', cmd]);

    // Create SSH directory with restrictive permissions
    const mkdirResult = await exec('mkdir -p ~/.ssh && chmod 700 ~/.ssh');
    if (mkdirResult.exitCode !== 0) {
      throw new Error(`Failed to create ~/.ssh in container: ${mkdirResult.stderr}`);
    }

    // Write private key (base64-encoded to safely handle PEM newlines)
    const privateKeyB64 = Buffer.from(privateKey).toString('base64');
    const writeKeyResult = await exec(
      `printf '%s' '${privateKeyB64}' | base64 -d > ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519`
    );
    if (writeKeyResult.exitCode !== 0) {
      throw new Error(`Failed to write SSH private key to container: ${writeKeyResult.stderr}`);
    }

    // Write hardcoded GitHub known_hosts to prevent MITM on first connection
    const knownHostsB64 = Buffer.from(GITHUB_KNOWN_HOST + '\n').toString('base64');
    const writeKnownHostsResult = await exec(
      `printf '%s' '${knownHostsB64}' | base64 -d > ~/.ssh/known_hosts && chmod 644 ~/.ssh/known_hosts`
    );
    if (writeKnownHostsResult.exitCode !== 0) {
      throw new Error(`Failed to write SSH known_hosts to container: ${writeKnownHostsResult.stderr}`);
    }

    // Write SSH config to bind the key to github.com
    const sshConfigB64 = Buffer.from(SSH_CONFIG).toString('base64');
    const writeConfigResult = await exec(
      `printf '%s' '${sshConfigB64}' | base64 -d > ~/.ssh/config && chmod 644 ~/.ssh/config`
    );
    if (writeConfigResult.exitCode !== 0) {
      throw new Error(`Failed to write SSH config to container: ${writeConfigResult.stderr}`);
    }
  }

  /**
   * Make a GitHub REST API request.
   *
   * @param method - HTTP method (POST, DELETE, etc.)
   * @param path - API path (e.g., `/repos/owner/repo/keys`)
   * @param pat - Personal Access Token for Authorization header
   * @param body - JSON request body (null for DELETE)
   * @returns Status code and response body string
   */
  private githubApiRequest(
    method: string,
    path: string,
    pat: string,
    body: string | null
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: 'api.github.com',
        port: 443,
        path,
        method,
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Zephyr-Desktop',
          ...(body !== null
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            : {}),
        },
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      });

      req.on('error', reject);

      if (body !== null) {
        req.write(body);
      }
      req.end();
    });
  }
}
