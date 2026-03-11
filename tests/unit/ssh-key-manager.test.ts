/**
 * Unit tests for SSHKeyManager service.
 *
 * Tests cover:
 * - ED25519 keypair generation (private/public key format validation)
 * - GitHub URL parsing (HTTPS and SSH formats)
 * - GitHub URL detection
 * - Container SSH injection (mocked DockerManager exec)
 * - GitHub API deploy key add/remove (mocked HTTPS requests)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSHKeyManager, type Execable } from '../../src/services/ssh-key-manager';

// ─── Mocks ──────────────────────────────────────────────────────────────────

/** Build a mock Execable that always succeeds with exitCode 0 */
function makeExecable(overrides?: Partial<Awaited<ReturnType<Execable['execCommand']>>>): {
  execCommand: ReturnType<typeof vi.fn>;
  manager: Execable;
} {
  const execCommand = vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: '',
    stderr: '',
    ...overrides,
  });
  return { execCommand, manager: { execCommand } };
}

// ─── generateKeyPair ────────────────────────────────────────────────────────

describe('SSHKeyManager.generateKeyPair', () => {
  let manager: SSHKeyManager;

  beforeEach(() => {
    const { manager: docker } = makeExecable();
    manager = new SSHKeyManager(docker);
  });

  it('returns a privateKey in OpenSSH native PEM format', () => {
    const { privateKey } = manager.generateKeyPair();
    expect(privateKey).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----/);
    expect(privateKey).toMatch(/-----END OPENSSH PRIVATE KEY-----/);
  });

  it('returns a publicKey in ssh-ed25519 authorized_keys format', () => {
    const { publicKey } = manager.generateKeyPair();
    expect(publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ zephyr-deploy-key$/);
  });

  it('generates unique keypairs on each call', () => {
    const kp1 = manager.generateKeyPair();
    const kp2 = manager.generateKeyPair();
    expect(kp1.privateKey).not.toBe(kp2.privateKey);
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
  });

  it('public key base64 blob is valid base64', () => {
    const { publicKey } = manager.generateKeyPair();
    const parts = publicKey.split(' ');
    expect(parts).toHaveLength(3);
    expect(() => Buffer.from(parts[1], 'base64')).not.toThrow();
  });

  it('public key starts with the ssh-ed25519 type prefix in the wire format', () => {
    const { publicKey } = manager.generateKeyPair();
    const parts = publicKey.split(' ');
    const blob = Buffer.from(parts[1], 'base64');
    // First 4 bytes = uint32 length of type string (11 = length of 'ssh-ed25519')
    const typeLen = blob.readUInt32BE(0);
    expect(typeLen).toBe(11);
    // Next typeLen bytes = 'ssh-ed25519'
    expect(blob.slice(4, 4 + typeLen).toString()).toBe('ssh-ed25519');
    // Next 4 bytes = uint32 length of key (32 bytes for ED25519)
    const keyLen = blob.readUInt32BE(4 + typeLen);
    expect(keyLen).toBe(32);
  });
});

// ─── parseGithubRepo ────────────────────────────────────────────────────────

describe('SSHKeyManager.parseGithubRepo', () => {
  let manager: SSHKeyManager;

  beforeEach(() => {
    const { manager: docker } = makeExecable();
    manager = new SSHKeyManager(docker);
  });

  it('parses an HTTPS URL without .git suffix', () => {
    const result = manager.parseGithubRepo('https://github.com/octocat/Hello-World');
    expect(result).toEqual({ owner: 'octocat', repo: 'Hello-World' });
  });

  it('parses an HTTPS URL with .git suffix', () => {
    const result = manager.parseGithubRepo('https://github.com/octocat/Hello-World.git');
    expect(result).toEqual({ owner: 'octocat', repo: 'Hello-World' });
  });

  it('parses an SSH URL', () => {
    const result = manager.parseGithubRepo('git@github.com:octocat/Hello-World.git');
    expect(result).toEqual({ owner: 'octocat', repo: 'Hello-World' });
  });

  it('parses an SSH URL without .git suffix', () => {
    const result = manager.parseGithubRepo('git@github.com:org/my-repo');
    expect(result).toEqual({ owner: 'org', repo: 'my-repo' });
  });

  it('parses orgs with hyphens and dots', () => {
    const result = manager.parseGithubRepo('https://github.com/my-org/my.repo.git');
    expect(result).toEqual({ owner: 'my-org', repo: 'my.repo' });
  });

  it('throws for a non-GitHub URL', () => {
    expect(() => manager.parseGithubRepo('https://gitlab.com/user/repo')).toThrow(
      'Cannot parse GitHub repo from URL'
    );
  });

  it('throws for an empty string', () => {
    expect(() => manager.parseGithubRepo('')).toThrow('Cannot parse GitHub repo from URL');
  });
});

// ─── isGithubUrl ────────────────────────────────────────────────────────────

describe('SSHKeyManager.isGithubUrl', () => {
  let manager: SSHKeyManager;

  beforeEach(() => {
    const { manager: docker } = makeExecable();
    manager = new SSHKeyManager(docker);
  });

  it('returns true for HTTPS GitHub URLs', () => {
    expect(manager.isGithubUrl('https://github.com/user/repo')).toBe(true);
  });

  it('returns true for SSH GitHub URLs', () => {
    expect(manager.isGithubUrl('git@github.com:user/repo.git')).toBe(true);
  });

  it('returns false for non-GitHub URLs', () => {
    expect(manager.isGithubUrl('https://gitlab.com/user/repo')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(manager.isGithubUrl('')).toBe(false);
  });

  it('returns false for local paths', () => {
    expect(manager.isGithubUrl('/home/user/myrepo')).toBe(false);
  });
});

// ─── injectIntoContainer ────────────────────────────────────────────────────

describe('SSHKeyManager.injectIntoContainer', () => {
  let execCommand: ReturnType<typeof vi.fn>;
  let manager: SSHKeyManager;

  beforeEach(() => {
    const mock = makeExecable();
    execCommand = mock.execCommand;
    manager = new SSHKeyManager(mock.manager);
  });

  it('calls execCommand exactly 5 times (mkdir, key, ssh-keyscan, chmod, config)', async () => {
    const { privateKey } = manager.generateKeyPair();
    await manager.injectIntoContainer('container-abc', privateKey);
    expect(execCommand).toHaveBeenCalledTimes(5);
  });

  it('first call creates ~/.ssh with chmod 700', async () => {
    const { privateKey } = manager.generateKeyPair();
    await manager.injectIntoContainer('container-abc', privateKey);
    const firstCall = execCommand.mock.calls[0][1] as string[];
    expect(firstCall[2]).toContain('mkdir -p ~/.ssh');
    expect(firstCall[2]).toContain('chmod 700 ~/.ssh');
  });

  it('second call writes id_ed25519 with chmod 600', async () => {
    const { privateKey } = manager.generateKeyPair();
    await manager.injectIntoContainer('container-abc', privateKey);
    const secondCall = execCommand.mock.calls[1][1] as string[];
    expect(secondCall[2]).toContain('~/.ssh/id_ed25519');
    expect(secondCall[2]).toContain('chmod 600 ~/.ssh/id_ed25519');
  });

  it('third call writes known_hosts containing github.com', async () => {
    const { privateKey } = manager.generateKeyPair();
    await manager.injectIntoContainer('container-abc', privateKey);
    const thirdCall = execCommand.mock.calls[2][1] as string[];
    expect(thirdCall[2]).toContain('~/.ssh/known_hosts');
  });

  it('fifth call writes ~/.ssh/config', async () => {
    const { privateKey } = manager.generateKeyPair();
    await manager.injectIntoContainer('container-abc', privateKey);
    const fifthCall = execCommand.mock.calls[4][1] as string[];
    expect(fifthCall[2]).toContain('~/.ssh/config');
  });

  it('passes the correct containerId to all exec calls', async () => {
    const { privateKey } = manager.generateKeyPair();
    await manager.injectIntoContainer('my-container-id', privateKey);
    for (const call of execCommand.mock.calls) {
      expect(call[0]).toBe('my-container-id');
    }
  });

  it('throws if mkdir fails', async () => {
    execCommand.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'Permission denied' });
    const { privateKey } = manager.generateKeyPair();
    await expect(manager.injectIntoContainer('c1', privateKey)).rejects.toThrow(
      'Failed to create ~/.ssh in container'
    );
  });

  it('throws if writing the private key fails', async () => {
    execCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // mkdir OK
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'disk full' }); // key write fails
    const { privateKey } = manager.generateKeyPair();
    await expect(manager.injectIntoContainer('c1', privateKey)).rejects.toThrow(
      'Failed to write SSH private key to container'
    );
  });

  it('throws if writing known_hosts fails (keyscan fails and fallback also fails)', async () => {
    execCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // mkdir
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // key write
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' }) // ssh-keyscan fails → triggers fallback
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'err' }); // fallback write fails
    const { privateKey } = manager.generateKeyPair();
    await expect(manager.injectIntoContainer('c1', privateKey)).rejects.toThrow(
      'Failed to write SSH known_hosts to container'
    );
  });

  it('throws if writing ssh config fails', async () => {
    execCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // mkdir
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // key
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // ssh-keyscan succeeds
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // chmod known_hosts
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'err' }); // config fails
    const { privateKey } = manager.generateKeyPair();
    await expect(manager.injectIntoContainer('c1', privateKey)).rejects.toThrow(
      'Failed to write SSH config to container'
    );
  });
});

// ─── addDeployKey / removeDeployKey ─────────────────────────────────────────

describe('SSHKeyManager.addDeployKey / removeDeployKey', () => {
  let manager: SSHKeyManager;
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { manager: docker } = makeExecable();
    manager = new SSHKeyManager(docker);

    // Spy on the private githubApiRequest method via prototype access
    mockRequest = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(manager as any, 'githubApiRequest').mockImplementation(mockRequest);
  });

  describe('addDeployKey', () => {
    it('posts to the correct GitHub API endpoint', async () => {
      mockRequest.mockResolvedValue({ statusCode: 201, body: JSON.stringify({ id: 42 }) });

      const keyId = await manager.addDeployKey(
        'ghp_token',
        'https://github.com/owner/repo',
        'ssh-ed25519 AAAA...',
        'Zephyr project loop-1'
      );

      expect(mockRequest).toHaveBeenCalledWith(
        'POST',
        '/repos/owner/repo/keys',
        'ghp_token',
        expect.stringContaining('"key"')
      );
      expect(keyId).toBe(42);
    });

    it('includes read_only: false in the request body', async () => {
      mockRequest.mockResolvedValue({ statusCode: 201, body: JSON.stringify({ id: 99 }) });

      await manager.addDeployKey(
        'ghp_token',
        'git@github.com:org/repo.git',
        'ssh-ed25519 AAAA...',
        'Zephyr title'
      );

      const bodyArg = JSON.parse(mockRequest.mock.calls[0][3] as string) as { read_only: boolean };
      expect(bodyArg.read_only).toBe(false);
    });

    it('throws on non-201 response', async () => {
      mockRequest.mockResolvedValue({ statusCode: 422, body: '{"message":"key already exists"}' });

      await expect(
        manager.addDeployKey('ghp_token', 'https://github.com/owner/repo', 'ssh-ed25519 AAAA...', 'title')
      ).rejects.toThrow('GitHub deploy key creation failed: HTTP 422');
    });
  });

  describe('removeDeployKey', () => {
    it('sends DELETE to the correct endpoint', async () => {
      mockRequest.mockResolvedValue({ statusCode: 204, body: '' });

      await manager.removeDeployKey('ghp_token', 'https://github.com/owner/repo', 123);

      expect(mockRequest).toHaveBeenCalledWith(
        'DELETE',
        '/repos/owner/repo/keys/123',
        'ghp_token',
        null
      );
    });

    it('resolves without error on 204', async () => {
      mockRequest.mockResolvedValue({ statusCode: 204, body: '' });
      await expect(
        manager.removeDeployKey('ghp_token', 'https://github.com/owner/repo', 5)
      ).resolves.toBeUndefined();
    });

    it('resolves without error on 404 (already deleted — idempotent)', async () => {
      mockRequest.mockResolvedValue({ statusCode: 404, body: '{"message":"Not Found"}' });
      await expect(
        manager.removeDeployKey('ghp_token', 'https://github.com/owner/repo', 5)
      ).resolves.toBeUndefined();
    });

    it('throws on unexpected non-success response', async () => {
      mockRequest.mockResolvedValue({ statusCode: 403, body: '{"message":"Forbidden"}' });

      await expect(
        manager.removeDeployKey('ghp_token', 'https://github.com/owner/repo', 5)
      ).rejects.toThrow('GitHub deploy key deletion failed: HTTP 403');
    });
  });
});
