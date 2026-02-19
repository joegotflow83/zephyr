/**
 * Unit tests for SelfUpdater service.
 * Mocks GitManager and LoopRunner to avoid real operations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';

// Mock fs module
vi.mock('fs', () => {
  const mockFns = {
    readFileSync: vi.fn(),
  };
  return {
    default: mockFns,
    ...mockFns,
  };
});

// Import after mocks are set up
import { SelfUpdater, UpdateInfo, SELF_UPDATE_PROJECT_ID } from '../../src/services/self-updater';
import { GitManager } from '../../src/services/git-manager';
import type { LoopRunner } from '../../src/services/loop-runner';
import { LoopMode } from '../../src/shared/loop-types';
import { readFileSync } from 'fs';

describe('SelfUpdater', () => {
  let updater: SelfUpdater;
  let mockGitManager: GitManager;
  let mockLoopRunner: Partial<LoopRunner>;
  let mockReadFileSync: any;

  const appDir = '/test/app';
  const packageJsonContent = JSON.stringify({
    name: 'zephyr-desktop',
    version: '0.1.0',
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock GitManager
    mockGitManager = {
      validateRepo: vi.fn(),
      getRepoInfo: vi.fn(),
      getRecentCommits: vi.fn(),
      cloneRepo: vi.fn(),
    } as any;

    // Mock LoopRunner
    mockLoopRunner = {
      getLoopState: vi.fn(),
      startLoop: vi.fn(),
    };

    // Mock fs
    mockReadFileSync = readFileSync as any;
    mockReadFileSync.mockReturnValue(packageJsonContent);

    updater = new SelfUpdater(mockGitManager, appDir);
  });

  describe('constructor', () => {
    it('should create instance without LoopRunner', () => {
      expect(updater).toBeDefined();
    });

    it('should create instance with LoopRunner', () => {
      const updaterWithRunner = new SelfUpdater(
        mockGitManager,
        appDir,
        mockLoopRunner as LoopRunner
      );
      expect(updaterWithRunner).toBeDefined();
    });
  });

  describe('setLoopRunner', () => {
    it('should set LoopRunner instance', () => {
      updater.setLoopRunner(mockLoopRunner as LoopRunner);
      // No error means success
      expect(true).toBe(true);
    });
  });

  describe('getCurrentVersion', () => {
    it('should read version from package.json', () => {
      const version = updater.getCurrentVersion();
      expect(version).toBe('0.1.0');
      expect(mockReadFileSync).toHaveBeenCalledWith(
        path.join(appDir, 'package.json'),
        'utf-8'
      );
    });

    it('should return 0.0.0 if version is missing', () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'test' }));
      const version = updater.getCurrentVersion();
      expect(version).toBe('0.0.0');
    });

    it('should throw error if package.json cannot be read', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });
      expect(() => updater.getCurrentVersion()).toThrow(
        'Failed to read current version'
      );
    });

    it('should throw error if package.json is invalid JSON', () => {
      mockReadFileSync.mockReturnValue('invalid json');
      expect(() => updater.getCurrentVersion()).toThrow(
        'Failed to read current version'
      );
    });
  });

  describe('checkForUpdates', () => {
    beforeEach(() => {
      (mockGitManager.validateRepo as any).mockResolvedValue(true);
      (mockGitManager.getRepoInfo as any).mockResolvedValue({
        branch: 'main',
        remoteUrl: 'https://github.com/example/zephyr.git',
        isDirty: false,
      });
      (mockGitManager.getRecentCommits as any).mockResolvedValue([
        {
          hash: 'abc123',
          message: 'Add feature X',
          author: 'test@example.com',
          date: '2026-02-19T10:00:00Z',
        },
        {
          hash: 'def456',
          message: 'Fix bug Y',
          author: 'test@example.com',
          date: '2026-02-18T15:00:00Z',
        },
      ]);
    });

    it('should check for updates successfully', async () => {
      const updateInfo = await updater.checkForUpdates();

      expect(updateInfo).toBeDefined();
      expect(updateInfo.available).toBe(false);
      expect(updateInfo.currentVersion).toBe('0.1.0');
      expect(updateInfo.latestVersion).toBe('0.1.0');
      expect(updateInfo.changelog).toContain('Add feature X');
      expect(updateInfo.changelog).toContain('abc123');
      expect(mockGitManager.validateRepo).toHaveBeenCalledWith(appDir);
      expect(mockGitManager.getRepoInfo).toHaveBeenCalledWith(appDir);
      expect(mockGitManager.getRecentCommits).toHaveBeenCalledWith(appDir, 5);
    });

    it('should throw error if app directory is not a git repo', async () => {
      (mockGitManager.validateRepo as any).mockResolvedValue(false);

      await expect(updater.checkForUpdates()).rejects.toThrow(
        'Application directory is not a valid Git repository'
      );
    });

    it('should throw error if git operations fail', async () => {
      (mockGitManager.getRepoInfo as any).mockRejectedValue(
        new Error('Network error')
      );

      await expect(updater.checkForUpdates()).rejects.toThrow(
        'Failed to check for updates'
      );
    });

    it('should include changelog with recent commits', async () => {
      const updateInfo = await updater.checkForUpdates();

      expect(updateInfo.changelog).toContain('Add feature X');
      expect(updateInfo.changelog).toContain('Fix bug Y');
      expect(updateInfo.changelog).toContain('abc123');
      expect(updateInfo.changelog).toContain('def456');
    });

    it('should handle empty commit history', async () => {
      (mockGitManager.getRecentCommits as any).mockResolvedValue([]);

      const updateInfo = await updater.checkForUpdates();

      expect(updateInfo.changelog).toBe('');
    });

    it('should return current version as latest when no updates', async () => {
      const updateInfo = await updater.checkForUpdates();

      expect(updateInfo.currentVersion).toBe('0.1.0');
      expect(updateInfo.latestVersion).toBe('0.1.0');
      expect(updateInfo.available).toBe(false);
    });
  });

  describe('startSelfUpdate', () => {
    const dockerImage = 'anthropics/anthropic-quickstarts:latest';
    const envVars = { API_KEY: 'test-key' };

    beforeEach(() => {
      updater.setLoopRunner(mockLoopRunner as LoopRunner);
      (mockLoopRunner.getLoopState as any).mockReturnValue(null);
      (mockLoopRunner.startLoop as any).mockResolvedValue({
        projectId: SELF_UPDATE_PROJECT_ID,
        containerId: 'container123',
        mode: LoopMode.SINGLE,
        status: 'starting',
      });
    });

    it('should throw error if no LoopRunner configured', async () => {
      const updaterNoRunner = new SelfUpdater(mockGitManager, appDir);

      await expect(
        updaterNoRunner.startSelfUpdate(dockerImage)
      ).rejects.toThrow('LoopRunner not configured');
    });

    it('should throw error if self-update loop already running', async () => {
      (mockLoopRunner.getLoopState as any).mockReturnValue({
        projectId: SELF_UPDATE_PROJECT_ID,
        status: 'running',
      });

      await expect(updater.startSelfUpdate(dockerImage)).rejects.toThrow(
        'A self-update loop is already running'
      );
    });

    it('should start self-update loop successfully', async () => {
      await updater.startSelfUpdate(dockerImage);

      expect(mockLoopRunner.getLoopState).toHaveBeenCalledWith(
        SELF_UPDATE_PROJECT_ID
      );
      expect(mockLoopRunner.startLoop).toHaveBeenCalledWith({
        projectId: SELF_UPDATE_PROJECT_ID,
        dockerImage,
        mode: LoopMode.SINGLE,
        envVars: undefined,
        volumeMounts: [expect.stringContaining('/workspace')],
        workDir: '/workspace',
      });
    });

    it('should start self-update loop with environment variables', async () => {
      await updater.startSelfUpdate(dockerImage, envVars);

      expect(mockLoopRunner.startLoop).toHaveBeenCalledWith({
        projectId: SELF_UPDATE_PROJECT_ID,
        dockerImage,
        mode: LoopMode.SINGLE,
        envVars,
        volumeMounts: [expect.stringContaining('/workspace')],
        workDir: '/workspace',
      });
    });

    it('should mount app directory as volume', async () => {
      await updater.startSelfUpdate(dockerImage);

      expect(mockLoopRunner.startLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          volumeMounts: [`${appDir}:/workspace`],
          workDir: '/workspace',
        })
      );
    });

    it('should use SINGLE mode for self-update', async () => {
      await updater.startSelfUpdate(dockerImage);

      expect(mockLoopRunner.startLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: LoopMode.SINGLE,
        })
      );
    });

    it('should use reserved project ID', async () => {
      await updater.startSelfUpdate(dockerImage);

      expect(mockLoopRunner.startLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: SELF_UPDATE_PROJECT_ID,
        })
      );
    });
  });

  describe('SELF_UPDATE_PROJECT_ID', () => {
    it('should export reserved project ID constant', () => {
      expect(SELF_UPDATE_PROJECT_ID).toBe('zephyr-self-update');
    });
  });

  describe('UpdateInfo type', () => {
    it('should have correct structure', () => {
      const updateInfo: UpdateInfo = {
        available: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
        changelog: 'New features',
      };

      expect(updateInfo.available).toBe(true);
      expect(updateInfo.currentVersion).toBe('0.1.0');
      expect(updateInfo.latestVersion).toBe('0.2.0');
      expect(updateInfo.changelog).toBe('New features');
    });

    it('should allow missing changelog', () => {
      const updateInfo: UpdateInfo = {
        available: false,
        currentVersion: '0.1.0',
        latestVersion: '0.1.0',
      };

      expect(updateInfo.changelog).toBeUndefined();
    });
  });
});
