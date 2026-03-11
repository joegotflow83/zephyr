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

/**
 * Build an OpenSSH private key file (-----BEGIN OPENSSH PRIVATE KEY-----) from
 * raw ED25519 key material. Node.js exports ED25519 private keys in PKCS#8 format
 * which older OpenSSH clients reject with "invalid format". OpenSSH native format
 * is universally supported across all versions.
 *
 * Format spec: https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.key
 *
 * @param privateScalar - 32-byte raw ED25519 private scalar (seed)
 * @param publicKey     - 32-byte raw ED25519 public key
 */
function buildOpenSSHPrivateKey(privateScalar: Buffer, publicKey: Buffer): string {
  const u32 = (n: number): Buffer => {
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32BE(n);
    return b;
  };
  const str = (s: string): Buffer => Buffer.from(s, 'utf8');

  const keyType = str('ssh-ed25519');
  const comment = str('zephyr-deploy-key');
  // Two identical random uint32s used by OpenSSH to detect decryption errors
  const checkInt = crypto.randomBytes(4);

  // Public key blob: [type_len][type][key_len][key]
  const pubKeyBlob = Buffer.concat([
    u32(keyType.length), keyType,
    u32(publicKey.length), publicKey,
  ]);

  // OpenSSH ED25519 private key data is seed (32 bytes) || public key (32 bytes) = 64 bytes
  const privKeyData = Buffer.concat([privateScalar, publicKey]);

  // Private section before padding
  const privateSection = Buffer.concat([
    checkInt, checkInt,                      // decryption check
    u32(keyType.length), keyType,            // key type
    u32(publicKey.length), publicKey,        // public key
    u32(privKeyData.length), privKeyData,    // private key (seed + pub)
    u32(comment.length), comment,            // comment
  ]);

  // Pad to multiple of 8 bytes (block size for unencrypted "none" cipher)
  const padLen = (8 - (privateSection.length % 8)) % 8;
  const padding = Buffer.from(Array.from({ length: padLen }, (_, i) => (i + 1) & 0xff));
  const privateSectionPadded = Buffer.concat([privateSection, padding]);

  // Full key structure
  const magic = Buffer.concat([str('openssh-key-v1'), Buffer.from([0x00])]);
  const none = str('none');
  const fullKey = Buffer.concat([
    magic,
    u32(none.length), none,                            // cipher: none
    u32(none.length), none,                            // kdf: none
    u32(0),                                            // kdf options: empty
    u32(1),                                            // number of keys
    u32(pubKeyBlob.length), pubKeyBlob,                // public key
    u32(privateSectionPadded.length), privateSectionPadded, // private section
  ]);

  // Wrap in PEM with standard 70-character line width
  const b64 = fullKey.toString('base64');
  const lines = (b64.match(/.{1,70}/g) ?? []).join('\n');
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

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

/** Parsed GitLab repository coordinates. */
export interface GitlabRepo {
  owner: string;
  repo: string;
}

/**
 * GitHub's hardcoded host fingerprints (all key types) used as a fallback when
 * ssh-keyscan is unavailable. Including RSA, ECDSA, and ED25519 ensures the
 * SSH client can verify the host regardless of which key type it negotiates.
 * Sources: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
 */
const GITHUB_KNOWN_HOSTS = [
  'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
  'github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=',
  'github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFBK8NOQBI+3i29sfeQH7Nd2HEXSTGxaVAiZ1Fx+Xk0ZQVZ3gJ+T6C2I3Z5E9ZQ3qnQ9W+9Y5r+DK6C0u+C6JB5oQJdx7Qe1DcO0xDOVYcpT3v/L3T7vVHU0H6d9W6B5XxdGOgIQ8y5M8e7PdS2D+oT6c8YC6R5/Z0bXA/H6YJb/VQy/S1Q1R5YFyOt9YkdS3d1AvdZWO6HzMcGcj+T7bGVFNcTq+Qv7w2o7v+OJqfZkrW6G8aXgT/f6oQqH8wF2E9bv8XF5qY/A8kU+UB8+mPXnGNwmAU9OxWO/C+vJFYzfRzYMzD6T+gPbVkLkh7ZRQXq5Ix3QGn5kMV+T3GXXlY0T9QJR2Fuz78v7jXCn7lY7pXgO2OjJ5bh7Y9O+pf3+/XH8==',
].join('\n');

/**
 * GitLab's hardcoded host fingerprints (all key types) used as a fallback.
 * Source: https://docs.gitlab.com/ee/user/gitlab_com/index.html#ssh-known_hosts-entries
 */
const GITLAB_KNOWN_HOSTS = [
  'gitlab.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAfuCHKVTjquxvt6CM6tdG4SLp1Btn/nOeHHE5UOzRdf',
  'gitlab.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBFSMqzJeV9rUzU4kWitGjeR4PWSa29SPqJ1fVkhtj3Hw9xjLVXVYrU9QlYWrOLXBpQ6KWjbjTDTdDkoohFzgbEY=',
  'gitlab.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCsj2bNKTBSpIYDEGk9KxsGh3mySTRgMtXL583qmBpzeQ+jqCMRgBqB98u3z++J1sKlXHWfM9dyhSevkMwSbhoR8XIq/U0tCNyokEi/ueaBMCvbcTHhO7FcwzY92WK4Yt0aGROY5qX2UqMotz/N9gcCbst48jrnUrY3jyioLTivKe1yk3RPkFhjSIKFZpQXX2pkJFbHbFyoE2JKqAGTT8+sqPLaXXEjRRRlqNfaACTTxDVJwc9ek+ihe53Xb4A8VBVbPGFNOWBMF8c6gC1E1QKGE6XFkVxbmNkBnkFtRMF3MZr8yHCVANGbX4oOQGr5iQQ3KCxc/5/1T5XjkrE6kJVH',
].join('\n');

/**
 * SSH config written to ~/.ssh/config inside the container.
 * Forces use of the injected key and strict host key checking.
 */
const SSH_CONFIG = `Host github.com
  IdentityFile ~/.ssh/id_ed25519
  StrictHostKeyChecking yes
`;

const GITLAB_SSH_CONFIG = `Host gitlab.com
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

    // Extract raw 32-byte public key from SPKI DER.
    // ED25519 SPKI DER is always: 30 2a 30 05 06 03 2b 65 70 03 21 00 <32 bytes>
    // The last 32 bytes are invariably the raw key material.
    const spkiDer = keyPair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const rawPubKey = spkiDer.slice(-32);

    // Extract raw 32-byte private scalar from PKCS#8 DER.
    // ED25519 PKCS#8 DER structure is fixed-length: the seed starts at byte 16.
    // Layout: 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20 <32 bytes seed>
    const pkcs8Der = keyPair.privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
    const privateScalar = pkcs8Der.slice(16, 48);

    // Build the private key in OpenSSH native format (-----BEGIN OPENSSH PRIVATE KEY-----)
    // rather than PKCS#8 (-----BEGIN PRIVATE KEY-----). OpenSSH native format is
    // universally supported; PKCS#8 causes "invalid format" errors in some container images.
    const privateKey = buildOpenSSHPrivateKey(privateScalar, rawPubKey);

    // SSH public key wire format: [uint32 type-len][type][uint32 key-len][key-bytes]
    const typeBuf = Buffer.from('ssh-ed25519');
    const typeLen = Buffer.allocUnsafe(4);
    typeLen.writeUInt32BE(typeBuf.length);
    const keyLen = Buffer.allocUnsafe(4);
    keyLen.writeUInt32BE(rawPubKey.length);
    const blob = Buffer.concat([typeLen, typeBuf, keyLen, rawPubKey]);
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
   * Returns true if the given URL points to a GitLab repository.
   */
  isGitlabUrl(url: string): boolean {
    return /gitlab\.com[:/]/.test(url);
  }

  /**
   * Parse a GitLab repository URL into `{ owner, repo }`.
   *
   * Handles:
   * - HTTPS: `https://gitlab.com/owner/repo` or `https://gitlab.com/owner/repo.git`
   * - SSH: `git@gitlab.com:owner/repo.git`
   *
   * @throws if the URL cannot be parsed as a GitLab repo URL
   */
  parseGitlabRepo(url: string): GitlabRepo {
    // SSH format: git@gitlab.com:owner/repo.git
    const sshMatch = url.match(/^git@gitlab\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    // HTTPS format: https://gitlab.com/owner/repo or https://gitlab.com/owner/repo.git
    const httpsMatch = url.match(/^https?:\/\/gitlab\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    throw new Error(`Cannot parse GitLab repo from URL: ${url}`);
  }

  /**
   * Register a public key as a deploy key on a GitLab repository.
   *
   * @param pat - GitLab Personal Access Token with api or write_repository scope
   * @param repoUrl - Repository URL (HTTPS or SSH format)
   * @param publicKey - OpenSSH public key string (`ssh-ed25519 AAAA...`)
   * @param title - Display name shown in GitLab's deploy keys list
   * @returns The numeric key ID assigned by GitLab (needed for later deletion)
   */
  async addGitlabDeployKey(
    pat: string,
    repoUrl: string,
    publicKey: string,
    title: string
  ): Promise<number> {
    const { owner, repo } = this.parseGitlabRepo(repoUrl);
    const projectPath = encodeURIComponent(`${owner}/${repo}`);

    const body = JSON.stringify({
      title,
      key: publicKey,
      can_push: true,
    });

    const response = await this.gitlabApiRequest(
      'POST',
      `/api/v4/projects/${projectPath}/deploy_keys`,
      pat,
      body
    );

    if (response.statusCode !== 201) {
      throw new Error(
        `GitLab deploy key creation failed: HTTP ${response.statusCode} — ${response.body}`
      );
    }

    const data = JSON.parse(response.body) as { id: number };
    return data.id;
  }

  /**
   * Delete a deploy key from a GitLab repository.
   *
   * @param pat - GitLab Personal Access Token with api or write_repository scope
   * @param repoUrl - Repository URL (HTTPS or SSH format)
   * @param keyId - The numeric key ID returned by `addGitlabDeployKey`
   */
  async removeGitlabDeployKey(pat: string, repoUrl: string, keyId: number): Promise<void> {
    const { owner, repo } = this.parseGitlabRepo(repoUrl);
    const projectPath = encodeURIComponent(`${owner}/${repo}`);

    const response = await this.gitlabApiRequest(
      'DELETE',
      `/api/v4/projects/${projectPath}/deploy_keys/${keyId}`,
      pat,
      null
    );

    // 204 No Content on success; 404 if already deleted (idempotent)
    if (response.statusCode !== 204 && response.statusCode !== 404) {
      throw new Error(
        `GitLab deploy key deletion failed: HTTP ${response.statusCode} — ${response.body}`
      );
    }
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
   * Inject an ED25519 private key into a running container's SSH directory for GitHub.
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
    return this.injectIntoContainerForHost(containerId, privateKey, 'github');
  }

  /**
   * Inject an ED25519 private key into a running container's SSH directory for GitLab.
   *
   * @param containerId - Running Docker container ID
   * @param privateKey - PKCS#8 PEM private key string
   */
  async injectIntoContainerForGitlab(containerId: string, privateKey: string): Promise<void> {
    return this.injectIntoContainerForHost(containerId, privateKey, 'gitlab');
  }

  /**
   * Shared implementation for injecting an SSH key into a container for a given host.
   *
   * Uses ssh-keyscan to populate known_hosts with all current host key types
   * (RSA, ECDSA, ED25519) from the live server. This avoids "Host key verification
   * failed" errors that occur when the SSH client negotiates a key type that isn't
   * present in a hardcoded known_hosts. Falls back to hardcoded fingerprints if
   * ssh-keyscan is unavailable or fails.
   */
  private async injectIntoContainerForHost(
    containerId: string,
    privateKey: string,
    provider: 'github' | 'gitlab'
  ): Promise<void> {
    const exec = (cmd: string) =>
      this.dockerManager.execCommand(containerId, ['sh', '-c', cmd]);

    const hostname = provider === 'github' ? 'github.com' : 'gitlab.com';
    const fallbackKnownHosts = provider === 'github' ? GITHUB_KNOWN_HOSTS : GITLAB_KNOWN_HOSTS;
    const sshConfig = provider === 'github' ? SSH_CONFIG : GITLAB_SSH_CONFIG;

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

    // Populate known_hosts using ssh-keyscan so all host key types (RSA, ECDSA, ED25519)
    // are included. This prevents "Host key verification failed" when the SSH client
    // negotiates a key type that differs from any single hardcoded entry. Falls back
    // to hardcoded fingerprints if ssh-keyscan is unavailable.
    const keyscanResult = await exec(
      `ssh-keyscan -T 10 ${hostname} > ~/.ssh/known_hosts 2>/dev/null && [ -s ~/.ssh/known_hosts ]`
    );
    if (keyscanResult.exitCode !== 0) {
      // keyscan failed or returned empty — fall back to hardcoded fingerprints
      const fallbackB64 = Buffer.from(fallbackKnownHosts + '\n').toString('base64');
      const writeKnownHostsResult = await exec(
        `printf '%s' '${fallbackB64}' | base64 -d > ~/.ssh/known_hosts && chmod 644 ~/.ssh/known_hosts`
      );
      if (writeKnownHostsResult.exitCode !== 0) {
        throw new Error(`Failed to write SSH known_hosts to container: ${writeKnownHostsResult.stderr}`);
      }
    } else {
      await exec('chmod 644 ~/.ssh/known_hosts');
    }

    // Write SSH config to bind the key to the host
    const sshConfigB64 = Buffer.from(sshConfig).toString('base64');
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

  /**
   * Make a GitLab REST API request.
   *
   * @param method - HTTP method (POST, DELETE, etc.)
   * @param path - API path (e.g., `/api/v4/projects/owner%2Frepo/deploy_keys`)
   * @param pat - Personal Access Token for PRIVATE-TOKEN header
   * @param body - JSON request body (null for DELETE)
   * @returns Status code and response body string
   */
  private gitlabApiRequest(
    method: string,
    path: string,
    pat: string,
    body: string | null
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: 'gitlab.com',
        port: 443,
        path,
        method,
        headers: {
          'PRIVATE-TOKEN': pat,
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
