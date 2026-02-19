/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IPC } from '../../src/shared/ipc-channels';

// Mock electron
const mockHandle = vi.fn();
vi.mock('electron', () => ({
  ipcMain: {
    handle: mockHandle,
  },
}));

// Mock logging
vi.mock('../../src/services/logging', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Auto-Update IPC Handlers', () => {
  let registerAutoUpdateHandlers: typeof import('../../src/main/ipc-handlers/auto-update-handlers').registerAutoUpdateHandlers;
  let mockAutoUpdater: any;
  let handlers: Map<string, Function>;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = new Map();

    // Mock ipcMain.handle
    mockHandle.mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
      return undefined as any;
    });

    // Create mock auto-updater
    mockAutoUpdater = {
      getState: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
    };

    // Import the module
    const module = await import(
      '../../src/main/ipc-handlers/auto-update-handlers'
    );
    registerAutoUpdateHandlers = module.registerAutoUpdateHandlers;
  });

  describe('Registration', () => {
    it('should register all auto-update handlers', () => {
      registerAutoUpdateHandlers({ autoUpdater: mockAutoUpdater });

      expect(mockHandle).toHaveBeenCalledWith(
        IPC.AUTO_UPDATE_GET_STATE,
        expect.any(Function)
      );
      expect(mockHandle).toHaveBeenCalledWith(
        IPC.AUTO_UPDATE_CHECK,
        expect.any(Function)
      );
      expect(mockHandle).toHaveBeenCalledWith(
        IPC.AUTO_UPDATE_DOWNLOAD,
        expect.any(Function)
      );
      expect(mockHandle).toHaveBeenCalledWith(
        IPC.AUTO_UPDATE_INSTALL,
        expect.any(Function)
      );
    });
  });

  describe('auto-update:get-state', () => {
    it('should return current auto-update state', async () => {
      const mockState = {
        status: 'idle' as const,
        updateInfo: undefined,
        error: undefined,
      };
      mockAutoUpdater.getState.mockReturnValue(mockState);

      registerAutoUpdateHandlers({ autoUpdater: mockAutoUpdater });

      const handler = handlers.get(IPC.AUTO_UPDATE_GET_STATE);
      expect(handler).toBeDefined();

      const result = await handler!();

      expect(mockAutoUpdater.getState).toHaveBeenCalled();
      expect(result).toEqual(mockState);
    });
  });

  describe('auto-update:check', () => {
    it('should check for updates', async () => {
      mockAutoUpdater.checkForUpdates.mockResolvedValue(undefined);

      registerAutoUpdateHandlers({ autoUpdater: mockAutoUpdater });

      const handler = handlers.get(IPC.AUTO_UPDATE_CHECK);
      expect(handler).toBeDefined();

      await handler!();

      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledWith(true);
    });
  });

  describe('auto-update:download', () => {
    it('should download available update', async () => {
      mockAutoUpdater.downloadUpdate.mockResolvedValue(undefined);

      registerAutoUpdateHandlers({ autoUpdater: mockAutoUpdater });

      const handler = handlers.get(IPC.AUTO_UPDATE_DOWNLOAD);
      expect(handler).toBeDefined();

      await handler!();

      expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalled();
    });
  });

  describe('auto-update:install', () => {
    it('should quit and install update', async () => {
      registerAutoUpdateHandlers({ autoUpdater: mockAutoUpdater });

      const handler = handlers.get(IPC.AUTO_UPDATE_INSTALL);
      expect(handler).toBeDefined();

      await handler!();

      expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalled();
    });
  });
});
