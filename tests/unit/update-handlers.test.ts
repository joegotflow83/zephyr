/**
 * Unit tests for update IPC handlers.
 * Mocks SelfUpdater service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '../../src/shared/ipc-channels';

// Mock electron module
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

// Import after mocks
import { registerUpdateHandlers } from '../../src/main/ipc-handlers/update-handlers';
import type { SelfUpdater, UpdateInfo } from '../../src/services/self-updater';

describe('update-handlers', () => {
  let mockSelfUpdater: Partial<SelfUpdater>;
  let mockIpcHandle: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock SelfUpdater
    mockSelfUpdater = {
      checkForUpdates: vi.fn(),
      startSelfUpdate: vi.fn(),
    };

    mockIpcHandle = ipcMain.handle as any;
  });

  describe('registerUpdateHandlers', () => {
    it('should register all update handlers', () => {
      registerUpdateHandlers({ selfUpdater: mockSelfUpdater as SelfUpdater });

      expect(mockIpcHandle).toHaveBeenCalledWith(
        IPC.UPDATES_CHECK,
        expect.any(Function)
      );
      expect(mockIpcHandle).toHaveBeenCalledWith(
        IPC.UPDATES_APPLY,
        expect.any(Function)
      );
    });

    it('should register exactly 2 handlers', () => {
      registerUpdateHandlers({ selfUpdater: mockSelfUpdater as SelfUpdater });

      expect(mockIpcHandle).toHaveBeenCalledTimes(2);
    });
  });

  describe('UPDATES_CHECK handler', () => {
    it('should check for updates', async () => {
      const updateInfo: UpdateInfo = {
        available: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
        changelog: 'New features',
      };
      (mockSelfUpdater.checkForUpdates as any).mockResolvedValue(updateInfo);

      registerUpdateHandlers({ selfUpdater: mockSelfUpdater as SelfUpdater });

      // Get the handler function from the second call (first arg is channel)
      const handler = mockIpcHandle.mock.calls.find(
        (call: any) => call[0] === IPC.UPDATES_CHECK
      )?.[1];

      expect(handler).toBeDefined();
      const result = await handler();

      expect(result).toEqual(updateInfo);
      expect(mockSelfUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors from checkForUpdates', async () => {
      const error = new Error('Network failure');
      (mockSelfUpdater.checkForUpdates as any).mockRejectedValue(error);

      registerUpdateHandlers({ selfUpdater: mockSelfUpdater as SelfUpdater });

      const handler = mockIpcHandle.mock.calls.find(
        (call: any) => call[0] === IPC.UPDATES_CHECK
      )?.[1];

      await expect(handler()).rejects.toThrow('Network failure');
    });
  });

  describe('UPDATES_APPLY handler', () => {
    it('should apply update with docker image', async () => {
      (mockSelfUpdater.startSelfUpdate as any).mockResolvedValue(undefined);

      registerUpdateHandlers({ selfUpdater: mockSelfUpdater as SelfUpdater });

      const handler = mockIpcHandle.mock.calls.find(
        (call: any) => call[0] === IPC.UPDATES_APPLY
      )?.[1];

      expect(handler).toBeDefined();

      const dockerImage = 'anthropics/anthropic-quickstarts:latest';
      await handler({}, dockerImage);

      expect(mockSelfUpdater.startSelfUpdate).toHaveBeenCalledWith(
        dockerImage,
        undefined
      );
    });

    it('should apply update with docker image and env vars', async () => {
      (mockSelfUpdater.startSelfUpdate as any).mockResolvedValue(undefined);

      registerUpdateHandlers({ selfUpdater: mockSelfUpdater as SelfUpdater });

      const handler = mockIpcHandle.mock.calls.find(
        (call: any) => call[0] === IPC.UPDATES_APPLY
      )?.[1];

      const dockerImage = 'anthropics/anthropic-quickstarts:latest';
      const envVars = { API_KEY: 'test-key', DEBUG: 'true' };

      await handler({}, dockerImage, envVars);

      expect(mockSelfUpdater.startSelfUpdate).toHaveBeenCalledWith(
        dockerImage,
        envVars
      );
    });

    it('should propagate errors from startSelfUpdate', async () => {
      const error = new Error('Loop already running');
      (mockSelfUpdater.startSelfUpdate as any).mockRejectedValue(error);

      registerUpdateHandlers({ selfUpdater: mockSelfUpdater as SelfUpdater });

      const handler = mockIpcHandle.mock.calls.find(
        (call: any) => call[0] === IPC.UPDATES_APPLY
      )?.[1];

      const dockerImage = 'anthropics/anthropic-quickstarts:latest';
      await expect(handler({}, dockerImage)).rejects.toThrow('Loop already running');
    });
  });
});
