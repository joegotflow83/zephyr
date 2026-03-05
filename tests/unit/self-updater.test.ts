/**
 * Unit tests for SelfUpdater service.
 * Mocks fetch and LoopRunner to avoid real operations.
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
import type { LoopRunner } from '../../src/services/loop-runner';
import { LoopMode } from '../../src/shared/loop-types';
import { readFileSync } from 'fs';

describe('SelfUpdater', () => {
  let updater: SelfUpdater;
  let mockLoopRunner: Partial<LoopRunner>;
  let mockReadFileSync: any;
  let mockFetch: any;

  const appDir = '/test/app';
  const packageJsonContent = JSON.stringify({
    name: 'zephyr-desktop',
    version: '0.1.0',
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock LoopRunner
    mockLoopRunner = {
      getLoopState: vi.fn(),
      startLoop: vi.fn(),
    };

    // Mock fs
    mockReadFileSync = readFileSync as any;
    mockReadFileSync.mockReturnValue(packageJsonContent);

    // Mock fetch
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    updater = new SelfUpdater(appDir);
  });

  describe('constructor', () => {
    it('should create instance without LoopRunner', () => {
      expect(updater).toBeDefined();
    });

    it('should create instance with LoopRunner', () => {
      const updaterWithRunner = new SelfUpdater(appDir, mockLoopRunner as LoopRunner);
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
    const makeRelease = (version: string, body?: string) => ({
      tag_name: `v${version}`,
      body: body ?? '',
    });

    beforeEach(() => {
      // Default: same version as current — no update
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeRelease('0.1.0', 'Some release notes'),
      });
    });

    it('should check for updates successfully (no update available)', async () => {
      const updateInfo = await updater.checkForUpdates();

      expect(updateInfo).toBeDefined();
      expect(updateInfo.available).toBe(false);
      expect(updateInfo.currentVersion).toBe('0.1.0');
      expect(updateInfo.latestVersion).toBe('0.1.0');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/joegotflow83/zephyr/releases/latest',
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });

    it('should return available=true when remote version is newer', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeRelease('0.2.0'),
      });

      const updateInfo = await updater.checkForUpdates();

      expect(updateInfo.available).toBe(true);
      expect(updateInfo.currentVersion).toBe('0.1.0');
      expect(updateInfo.latestVersion).toBe('0.2.0');
    });

    it('should return available=false when remote version matches current', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeRelease('0.1.0'),
      });

      const updateInfo = await updater.checkForUpdates();

      expect(updateInfo.available).toBe(false);
      expect(updateInfo.latestVersion).toBe('0.1.0');
    });

    it('should return available=false when remote version is older', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeRelease('0.0.9'),
      });

      const updateInfo = await updater.checkForUpdates();

      expect(updateInfo.available).toBe(false);
      expect(updateInfo.latestVersion).toBe('0.0.9');
    });

    it('should strip leading v from tag_name', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ tag_name: 'v0.2.0', body: '' }),
      });

      const updateInfo = await updater.checkForUpdates();

      expect(updateInfo.latestVersion).toBe('0.2.0');
    });

    it('should include changelog from release body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeRelease('0.2.0', 'New feature: Terminal support\nBug fix: Memory leak'),
      });

      const updateInfo = await updater.checkForUpdates();

      expect(updateInfo.changelog).toContain('New feature: Terminal support');
      expect(updateInfo.changelog).toContain('Bug fix: Memory leak');
    });

    it('should return empty changelog when release body is absent', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ tag_name: 'v0.1.0' }),
      });

      const updateInfo = await updater.checkForUpdates();

      expect(updateInfo.changelog).toBe('');
    });

    it('should throw error when GitHub API returns non-ok status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(updater.checkForUpdates()).rejects.toThrow(
        'Failed to check for updates'
      );
    });

    it('should throw error when fetch fails (network error)', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(updater.checkForUpdates()).rejects.toThrow(
        'Failed to check for updates'
      );
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
      const updaterNoRunner = new SelfUpdater(appDir);

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
        projectName: 'Zephyr Self-Update',
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
        projectName: 'Zephyr Self-Update',
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
