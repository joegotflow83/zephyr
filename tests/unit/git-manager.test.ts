/**
 * Unit tests for GitManager service.
 * Mocks simple-git to avoid real git operations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';

// Mock simple-git module
vi.mock('simple-git', () => {
  const mockGit = {
    clone: vi.fn(),
    revparse: vi.fn(),
    status: vi.fn(),
    getRemotes: vi.fn(),
    log: vi.fn(),
    fetch: vi.fn(),
    raw: vi.fn(),
  };

  return {
    simpleGit: vi.fn(() => mockGit),
    SimpleGit: vi.fn(),
  };
});

// Mock fs module - inline functions to avoid hoisting issues
vi.mock('fs', () => {
  const mockFns = {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
  };
  return {
    default: mockFns,
    ...mockFns,
  };
});

// Import after mocks are set up
import { GitManager, RepoInfo, Commit } from '../../src/services/git-manager';
import { simpleGit } from 'simple-git';
import { existsSync, readdirSync, mkdirSync, rmSync } from 'fs';

describe('GitManager', () => {
  let manager: GitManager;
  let mockGit: any;
  let mockExistsSync: any;
  let mockReaddirSync: any;
  let mockMkdirSync: any;
  let mockRmSync: any;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new GitManager();
    mockGit = (simpleGit as any)();
    mockExistsSync = (existsSync as any);
    mockReaddirSync = (readdirSync as any);
    mockMkdirSync = (mkdirSync as any);
    mockRmSync = (rmSync as any);
  });

  describe('cloneRepo', () => {
    it('should clone a repository successfully', async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockReturnValue(undefined);
      mockGit.clone.mockResolvedValue(undefined);

      await manager.cloneRepo(
        'https://github.com/example/repo.git',
        '/tmp/repo'
      );

      expect(mockGit.clone).toHaveBeenCalledWith(
        'https://github.com/example/repo.git',
        expect.any(String)
      );
    });

    it('should clone with progress callback', async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockReturnValue(undefined);
      mockGit.clone.mockResolvedValue(undefined);

      const onProgress = vi.fn();

      await manager.cloneRepo(
        'https://github.com/example/repo.git',
        '/tmp/repo',
        onProgress
      );

      expect(onProgress).toHaveBeenCalledWith('Clone complete');
      expect(mockGit.clone).toHaveBeenCalled();
    });

    it('should throw error if URL is empty', async () => {
      await expect(manager.cloneRepo('', '/tmp/repo')).rejects.toThrow(
        'Repository URL must not be empty'
      );
    });

    it('should throw error if URL is whitespace only', async () => {
      await expect(manager.cloneRepo('   ', '/tmp/repo')).rejects.toThrow(
        'Repository URL must not be empty'
      );
    });

    it('should throw error if destination directory exists and is non-empty', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['file.txt']);

      await expect(
        manager.cloneRepo('https://github.com/example/repo.git', '/tmp/repo')
      ).rejects.toThrow('Target directory already exists and is non-empty');
    });

    it('should clean up destination on clone failure', async () => {
      mockExistsSync
        .mockReturnValueOnce(false) // First check for destination
        .mockReturnValueOnce(true); // Second check after clone failure
      mockMkdirSync.mockReturnValue(undefined);
      mockGit.clone.mockRejectedValue(new Error('Clone failed'));

      await expect(
        manager.cloneRepo('https://github.com/example/repo.git', '/tmp/repo')
      ).rejects.toThrow('Clone failed');

      expect(mockRmSync).toHaveBeenCalled();
    });

    it('should create parent directory if it does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockReturnValue(undefined);
      mockGit.clone.mockResolvedValue(undefined);

      await manager.cloneRepo(
        'https://github.com/example/repo.git',
        '/tmp/nested/repo'
      );

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true })
      );
    });

    it('should support SSH URLs', async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockReturnValue(undefined);
      mockGit.clone.mockResolvedValue(undefined);

      await manager.cloneRepo('git@github.com:example/repo.git', '/tmp/repo');

      expect(mockGit.clone).toHaveBeenCalledWith(
        'git@github.com:example/repo.git',
        expect.any(String)
      );
    });
  });

  describe('validateRepo', () => {
    it('should return true for valid git repository', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');

      const isValid = await manager.validateRepo('/path/to/repo');

      expect(isValid).toBe(true);
      expect(mockGit.revparse).toHaveBeenCalledWith('--git-dir');
    });

    it('should return false for non-git directory', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockRejectedValue(new Error('Not a git repo'));

      const isValid = await manager.validateRepo('/path/to/repo');

      expect(isValid).toBe(false);
    });

    it('should return false if path does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const isValid = await manager.validateRepo('/nonexistent/path');

      expect(isValid).toBe(false);
    });

    it('should return false on any error', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockRejectedValue(new Error('Some error'));

      const isValid = await manager.validateRepo('/path/to/repo');

      expect(isValid).toBe(false);
    });
  });

  describe('getRepoInfo', () => {
    it('should return repo info for valid repository', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.status.mockResolvedValue({
        current: 'main',
        isClean: () => true,
      });
      mockGit.getRemotes.mockResolvedValue([
        {
          name: 'origin',
          refs: { fetch: 'https://github.com/example/repo.git' },
        },
      ]);

      const info = await manager.getRepoInfo('/path/to/repo');

      expect(info).toEqual({
        branch: 'main',
        remoteUrl: 'https://github.com/example/repo.git',
        isDirty: false,
      });
    });

    it('should handle detached HEAD state', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.status.mockResolvedValue({
        current: null,
        isClean: () => true,
      });
      mockGit.getRemotes.mockResolvedValue([]);

      const info = await manager.getRepoInfo('/path/to/repo');

      expect(info.branch).toBe('detached');
    });

    it('should return isDirty true for modified files', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.status.mockResolvedValue({
        current: 'main',
        isClean: () => false,
      });
      mockGit.getRemotes.mockResolvedValue([]);

      const info = await manager.getRepoInfo('/path/to/repo');

      expect(info.isDirty).toBe(true);
    });

    it('should return empty remoteUrl if origin not found', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.status.mockResolvedValue({
        current: 'main',
        isClean: () => true,
      });
      mockGit.getRemotes.mockResolvedValue([
        { name: 'upstream', refs: { fetch: 'https://github.com/other/repo.git' } },
      ]);

      const info = await manager.getRepoInfo('/path/to/repo');

      expect(info.remoteUrl).toBe('');
    });

    it('should throw error if path does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(manager.getRepoInfo('/nonexistent')).rejects.toThrow(
        'Repository path does not exist'
      );
    });

    it('should throw error if not a git repository', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockRejectedValue(new Error('Not a git repo'));

      await expect(manager.getRepoInfo('/path/to/repo')).rejects.toThrow(
        'Not a valid Git repository'
      );
    });

    it('should handle error in status call gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.status.mockRejectedValue(new Error('Status error'));
      mockGit.getRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'https://github.com/example/repo.git' } },
      ]);

      const info = await manager.getRepoInfo('/path/to/repo');

      expect(info.branch).toBe('unknown');
      expect(info.remoteUrl).toBe('https://github.com/example/repo.git');
      expect(info.isDirty).toBe(false);
    });

    it('should handle error in getRemotes call gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.status.mockResolvedValue({
        current: 'main',
        isClean: () => true,
      });
      mockGit.getRemotes.mockRejectedValue(new Error('Remotes error'));

      const info = await manager.getRepoInfo('/path/to/repo');

      expect(info.branch).toBe('main');
      expect(info.remoteUrl).toBe('');
      expect(info.isDirty).toBe(false);
    });
  });

  describe('getRecentCommits', () => {
    it('should return recent commits for valid repository', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.log.mockResolvedValue({
        all: [
          {
            hash: 'abc123def456',
            message: 'Fix: Update feature\nDetailed description',
            author_name: 'John Doe',
            date: '2026-02-19T10:30:00Z',
          },
          {
            hash: '789ghi012jkl',
            message: 'Add: New feature',
            author_name: 'Jane Smith',
            date: '2026-02-18T09:15:00Z',
          },
        ],
      });

      const commits = await manager.getRecentCommits('/path/to/repo');

      expect(commits).toHaveLength(2);
      expect(commits[0]).toEqual({
        hash: 'abc123def456',
        message: 'Fix: Update feature',
        author: 'John Doe',
        date: '2026-02-19T10:30:00.000Z',
      });
      expect(commits[1]).toEqual({
        hash: '789ghi012jkl',
        message: 'Add: New feature',
        author: 'Jane Smith',
        date: '2026-02-18T09:15:00.000Z',
      });
    });

    it('should respect custom count parameter', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.log.mockResolvedValue({ all: [] });

      await manager.getRecentCommits('/path/to/repo', 50);

      expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 50 });
    });

    it('should return empty array for repository with no commits', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.log.mockResolvedValue({ all: [] });

      const commits = await manager.getRecentCommits('/path/to/repo');

      expect(commits).toEqual([]);
    });

    it('should handle error for empty repository', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.log.mockRejectedValue(
        new Error('your current branch')
      );

      const commits = await manager.getRecentCommits('/path/to/repo');

      expect(commits).toEqual([]);
    });

    it('should throw error if path does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(
        manager.getRecentCommits('/nonexistent')
      ).rejects.toThrow('Repository path does not exist');
    });

    it('should throw error if not a git repository', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockRejectedValue(new Error('Not a git repo'));

      await expect(
        manager.getRecentCommits('/path/to/repo')
      ).rejects.toThrow('Not a valid Git repository');
    });

    it('should extract first line of multi-line commit messages', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.log.mockResolvedValue({
        all: [
          {
            hash: 'abc123',
            message: 'First line\nSecond line\nThird line',
            author_name: 'Author',
            date: '2026-02-19T10:30:00Z',
          },
        ],
      });

      const commits = await manager.getRecentCommits('/path/to/repo', 1);

      expect(commits[0].message).toBe('First line');
    });

    it('should handle missing author_name', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.log.mockResolvedValue({
        all: [
          {
            hash: 'abc123',
            message: 'Some commit',
            author_name: null,
            date: '2026-02-19T10:30:00Z',
          },
        ],
      });

      const commits = await manager.getRecentCommits('/path/to/repo', 1);

      expect(commits[0].author).toBe('unknown');
    });

    it('should default count to 10', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.log.mockResolvedValue({ all: [] });

      await manager.getRecentCommits('/path/to/repo');

      expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 10 });
    });

    it('should rethrow errors other than empty repo', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.log.mockRejectedValue(new Error('Network error'));

      await expect(
        manager.getRecentCommits('/path/to/repo')
      ).rejects.toThrow('Network error');
    });
  });

  describe('fetchRemote', () => {
    it('should fetch from origin successfully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.fetch.mockResolvedValue(undefined);

      await manager.fetchRemote('/path/to/repo');

      expect(mockGit.fetch).toHaveBeenCalledWith('origin');
    });

    it('should fetch from custom remote', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.fetch.mockResolvedValue(undefined);

      await manager.fetchRemote('/path/to/repo', 'upstream');

      expect(mockGit.fetch).toHaveBeenCalledWith('upstream');
    });

    it('should throw error if path does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(manager.fetchRemote('/nonexistent')).rejects.toThrow(
        'Repository path does not exist'
      );
    });

    it('should throw error if not a git repository', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockRejectedValue(new Error('not a git repo'));

      await expect(manager.fetchRemote('/path/to/repo')).rejects.toThrow(
        'Not a valid Git repository'
      );
    });

    it('should throw error if fetch fails', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.fetch.mockRejectedValue(new Error('Connection refused'));

      await expect(manager.fetchRemote('/path/to/repo')).rejects.toThrow(
        "Failed to fetch from remote 'origin'"
      );
    });
  });

  describe('getRemoteFileContent', () => {
    it('should return file content at given ref', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.raw.mockResolvedValue('{"name":"zephyr","version":"0.2.0"}\n');

      const content = await manager.getRemoteFileContent(
        '/path/to/repo',
        'origin/HEAD',
        'package.json'
      );

      expect(content).toBe('{"name":"zephyr","version":"0.2.0"}\n');
      expect(mockGit.raw).toHaveBeenCalledWith([
        'show',
        'origin/HEAD:package.json',
      ]);
    });

    it('should support arbitrary refs (tag, branch, commit)', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.raw.mockResolvedValue('content');

      await manager.getRemoteFileContent('/path/to/repo', 'v1.2.3', 'README.md');

      expect(mockGit.raw).toHaveBeenCalledWith(['show', 'v1.2.3:README.md']);
    });

    it('should throw error if path does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(
        manager.getRemoteFileContent('/nonexistent', 'origin/HEAD', 'package.json')
      ).rejects.toThrow('Repository path does not exist');
    });

    it('should throw error if not a git repository', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockRejectedValue(new Error('not a git repo'));

      await expect(
        manager.getRemoteFileContent('/path/to/repo', 'origin/HEAD', 'package.json')
      ).rejects.toThrow('Not a valid Git repository');
    });

    it('should throw error if file does not exist at ref', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.raw.mockRejectedValue(new Error('path not in tree'));

      await expect(
        manager.getRemoteFileContent('/path/to/repo', 'origin/HEAD', 'missing.json')
      ).rejects.toThrow("Failed to read 'missing.json' at ref 'origin/HEAD'");
    });
  });

  describe('Type definitions', () => {
    it('should have correct RepoInfo interface structure', () => {
      const info: RepoInfo = {
        branch: 'main',
        remoteUrl: 'https://github.com/example/repo.git',
        isDirty: false,
      };

      expect(info.branch).toBeDefined();
      expect(info.remoteUrl).toBeDefined();
      expect(info.isDirty).toBeDefined();
    });

    it('should have correct Commit interface structure', () => {
      const commit: Commit = {
        hash: 'abc123',
        message: 'Test commit',
        author: 'Test Author',
        date: '2026-02-19T10:30:00Z',
      };

      expect(commit.hash).toBeDefined();
      expect(commit.message).toBeDefined();
      expect(commit.author).toBeDefined();
      expect(commit.date).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle repositories with unusual characters in paths', async () => {
      const unusualPath = '/tmp/repo with spaces & special-chars';
      mockExistsSync.mockReturnValue(true);
      mockGit.revparse.mockResolvedValue('.git');
      mockGit.status.mockResolvedValue({
        current: 'main',
        isClean: () => true,
      });
      mockGit.getRemotes.mockResolvedValue([]);

      const info = await manager.getRepoInfo(unusualPath);

      expect(info.branch).toBe('main');
    });

    it('should handle repositories with special characters in URL', async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockReturnValue(undefined);
      mockGit.clone.mockResolvedValue(undefined);

      const specialUrl = 'https://github.com/user-name/repo_name.git';
      await manager.cloneRepo(specialUrl, '/tmp/repo');

      expect(mockGit.clone).toHaveBeenCalledWith(
        specialUrl,
        expect.any(String)
      );
    });

    it('should handle clone with path containing symlinks (resolved)', async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockReturnValue(undefined);
      mockGit.clone.mockResolvedValue(undefined);

      // Path resolution should handle symlinks
      await manager.cloneRepo(
        'https://github.com/example/repo.git',
        '/tmp/../tmp/repo'
      );

      expect(mockGit.clone).toHaveBeenCalled();
    });
  });
});
