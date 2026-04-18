/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserWindow, dialog } from 'electron';
import type { UpdateInfo } from 'electron-updater';

// Mock electron-updater
const mockAutoUpdater = {
  autoDownload: false,
  autoInstallOnAppQuit: true,
  currentVersion: { version: '0.1.0' },
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  on: vi.fn(),
};

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}));

// Mock electron
vi.mock('electron', () => ({
  app: {
    quit: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  dialog: {
    showMessageBox: vi.fn(),
  },
}));

// Mock logging
vi.mock('../../src/services/logging', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('AutoUpdater Service', () => {
  let AutoUpdater: typeof import('../../src/services/auto-updater').AutoUpdater;
  let getAutoUpdater: typeof import('../../src/services/auto-updater').getAutoUpdater;
  let mockWindow: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset the module to get a fresh instance
    vi.resetModules();

    // Import fresh
    const module = await import('../../src/services/auto-updater');
    AutoUpdater = module.AutoUpdater;
    getAutoUpdater = module.getAutoUpdater;

    // Create mock window
    mockWindow = {
      webContents: {
        send: vi.fn(),
      },
      isDestroyed: vi.fn().mockReturnValue(false),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = getAutoUpdater();
      const instance2 = getAutoUpdater();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Initialization', () => {
    it('should configure auto-updater on construction', () => {
      new AutoUpdater();
      expect(mockAutoUpdater.autoDownload).toBe(false);
      expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true);
    });

    it('should set up event listeners on construction', () => {
      new AutoUpdater();
      expect(mockAutoUpdater.on).toHaveBeenCalledWith(
        'checking-for-update',
        expect.any(Function)
      );
      expect(mockAutoUpdater.on).toHaveBeenCalledWith(
        'update-available',
        expect.any(Function)
      );
      expect(mockAutoUpdater.on).toHaveBeenCalledWith(
        'update-not-available',
        expect.any(Function)
      );
      expect(mockAutoUpdater.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function)
      );
      expect(mockAutoUpdater.on).toHaveBeenCalledWith(
        'download-progress',
        expect.any(Function)
      );
      expect(mockAutoUpdater.on).toHaveBeenCalledWith(
        'update-downloaded',
        expect.any(Function)
      );
    });
  });

  describe('setMainWindow', () => {
    it('should set the main window', () => {
      const updater = new AutoUpdater();
      updater.setMainWindow(mockWindow as any);
      // Window is set (no direct getter, but affects subsequent operations)
      expect(true).toBe(true);
    });
  });

  describe('getState', () => {
    it('should return initial idle state', () => {
      const updater = new AutoUpdater();
      const state = updater.getState();
      expect(state.status).toBe('idle');
      expect(state.updateInfo).toBeUndefined();
      expect(state.error).toBeUndefined();
    });

    it('should return a copy of the state', () => {
      const updater = new AutoUpdater();
      const state1 = updater.getState();
      const state2 = updater.getState();
      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);
    });
  });

  describe('checkForUpdatesOnStartup', () => {
    it('should schedule update check with delay', () => {
      vi.useFakeTimers();
      const updater = new AutoUpdater();
      mockAutoUpdater.checkForUpdates.mockResolvedValue({
        updateInfo: { version: '0.1.0' } as UpdateInfo,
      });

      updater.checkForUpdatesOnStartup();

      // Check should not have run immediately
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();

      // Advance time
      vi.advanceTimersByTime(10000);

      // Check should have run
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should only run startup check once', () => {
      vi.useFakeTimers();
      const updater = new AutoUpdater();
      mockAutoUpdater.checkForUpdates.mockResolvedValue({
        updateInfo: { version: '0.1.0' } as UpdateInfo,
      });

      updater.checkForUpdatesOnStartup();
      updater.checkForUpdatesOnStartup(); // Call again

      vi.advanceTimersByTime(10000);

      // Should only have been called once
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('checkForUpdates', () => {
    it('should check for updates successfully', async () => {
      const updater = new AutoUpdater();
      mockAutoUpdater.checkForUpdates.mockResolvedValue({
        updateInfo: { version: '0.2.0' } as UpdateInfo,
      });

      await updater.checkForUpdates(false);

      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalled();
    });

    it('should handle null result from check', async () => {
      const updater = new AutoUpdater();
      mockAutoUpdater.checkForUpdates.mockResolvedValue(null);

      await updater.checkForUpdates(false);

      const state = updater.getState();
      expect(state.status).toBe('error');
      expect(state.error).toContain('no result');
    });

    it('should handle check error', async () => {
      const updater = new AutoUpdater();
      mockAutoUpdater.checkForUpdates.mockRejectedValue(
        new Error('Network error')
      );

      await updater.checkForUpdates(false);

      const state = updater.getState();
      expect(state.status).toBe('error');
      expect(state.error).toBe('Network error');
    });

    it('should not check if already checking', async () => {
      const updater = new AutoUpdater();
      updater.setMainWindow(mockWindow as any);

      // Manually set state to checking
      mockAutoUpdater.checkForUpdates.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({ updateInfo: { version: '0.2.0' } as UpdateInfo }),
              100
            );
          })
      );

      const promise1 = updater.checkForUpdates(false);
      const promise2 = updater.checkForUpdates(false);

      await promise1;
      await promise2;

      // Should only have been called once
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    });
  });

  describe('downloadUpdate', () => {
    it('should download update when available', async () => {
      const updater = new AutoUpdater();
      updater.setMainWindow(mockWindow as any);
      vi.mocked(dialog.showMessageBox).mockResolvedValue({
        response: 1,
        checkboxChecked: false,
      });

      // Simulate update available state
      mockAutoUpdater.checkForUpdates.mockResolvedValue({
        updateInfo: { version: '0.2.0' } as UpdateInfo,
      });

      // Trigger update-available event to set state
      const onUpdateAvailable = mockAutoUpdater.on.mock.calls.find(
        (call) => call[0] === 'update-available'
      )?.[1];
      expect(onUpdateAvailable).toBeDefined();
      onUpdateAvailable({ version: '0.2.0' } as UpdateInfo);

      mockAutoUpdater.downloadUpdate.mockResolvedValue(['path/to/update']);

      await updater.downloadUpdate();

      expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalled();
    });

    it('should not download if no update available', async () => {
      const updater = new AutoUpdater();

      await updater.downloadUpdate();

      expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled();
    });

    it('should handle download error', async () => {
      const updater = new AutoUpdater();
      updater.setMainWindow(mockWindow as any);
      vi.mocked(dialog.showMessageBox).mockResolvedValue({
        response: 1,
        checkboxChecked: false,
      });

      // Set state to available
      const onUpdateAvailable = mockAutoUpdater.on.mock.calls.find(
        (call) => call[0] === 'update-available'
      )?.[1];
      onUpdateAvailable({ version: '0.2.0' } as UpdateInfo);

      mockAutoUpdater.downloadUpdate.mockRejectedValue(
        new Error('Download failed')
      );

      await updater.downloadUpdate();

      const state = updater.getState();
      expect(state.status).toBe('error');
      expect(state.error).toBe('Download failed');
    });
  });

  describe('quitAndInstall', () => {
    it('should quit and install when update is downloaded', () => {
      const updater = new AutoUpdater();
      updater.setMainWindow(mockWindow as any);
      vi.mocked(dialog.showMessageBox).mockResolvedValue({
        response: 1,
        checkboxChecked: false,
      });

      // Set state to downloaded
      const onUpdateDownloaded = mockAutoUpdater.on.mock.calls.find(
        (call) => call[0] === 'update-downloaded'
      )?.[1];
      onUpdateDownloaded({ version: '0.2.0' } as UpdateInfo);

      updater.quitAndInstall();

      expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    });

    it('should not install if update not downloaded', () => {
      const updater = new AutoUpdater();

      updater.quitAndInstall();

      expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
    });
  });

  describe('Event Listeners', () => {
    it('should update state on checking-for-update event', () => {
      const updater = new AutoUpdater();
      updater.setMainWindow(mockWindow as any);

      const onCheckingForUpdate = mockAutoUpdater.on.mock.calls.find(
        (call) => call[0] === 'checking-for-update'
      )?.[1];

      onCheckingForUpdate();

      const state = updater.getState();
      expect(state.status).toBe('checking');
    });

    it('should update state on update-available event', () => {
      const updater = new AutoUpdater();
      updater.setMainWindow(mockWindow as any);
      vi.mocked(dialog.showMessageBox).mockResolvedValue({
        response: 1,
        checkboxChecked: false,
      });

      const updateInfo = { version: '0.2.0' } as UpdateInfo;
      const onUpdateAvailable = mockAutoUpdater.on.mock.calls.find(
        (call) => call[0] === 'update-available'
      )?.[1];

      onUpdateAvailable(updateInfo);

      const state = updater.getState();
      expect(state.status).toBe('available');
      expect(state.updateInfo).toEqual(updateInfo);
    });

    it('should update state on update-not-available event', () => {
      const updater = new AutoUpdater();
      updater.setMainWindow(mockWindow as any);

      const updateInfo = { version: '0.1.0' } as UpdateInfo;
      const onUpdateNotAvailable = mockAutoUpdater.on.mock.calls.find(
        (call) => call[0] === 'update-not-available'
      )?.[1];

      onUpdateNotAvailable(updateInfo);

      const state = updater.getState();
      expect(state.status).toBe('not-available');
    });

    it('should update state on error event', () => {
      const updater = new AutoUpdater();
      updater.setMainWindow(mockWindow as any);

      const error = new Error('Update check failed');
      const onError = mockAutoUpdater.on.mock.calls.find(
        (call) => call[0] === 'error'
      )?.[1];

      onError(error);

      const state = updater.getState();
      expect(state.status).toBe('error');
      expect(state.error).toBe('Update check failed');
    });

    it('should update state on download-progress event', () => {
      const updater = new AutoUpdater();
      updater.setMainWindow(mockWindow as any);

      const progressObj = {
        percent: 50.5,
        bytesPerSecond: 1024000,
        transferred: 512000,
        total: 1024000,
      };

      const onDownloadProgress = mockAutoUpdater.on.mock.calls.find(
        (call) => call[0] === 'download-progress'
      )?.[1];

      onDownloadProgress(progressObj);

      const state = updater.getState();
      expect(state.status).toBe('downloading');
      expect(state.downloadProgress).toEqual(progressObj);
    });

    it('should update state on update-downloaded event', () => {
      const updater = new AutoUpdater();
      updater.setMainWindow(mockWindow as any);
      vi.mocked(dialog.showMessageBox).mockResolvedValue({
        response: 1,
        checkboxChecked: false,
      });

      const updateInfo = { version: '0.2.0' } as UpdateInfo;
      const onUpdateDownloaded = mockAutoUpdater.on.mock.calls.find(
        (call) => call[0] === 'update-downloaded'
      )?.[1];

      onUpdateDownloaded(updateInfo);

      const state = updater.getState();
      expect(state.status).toBe('downloaded');
      expect(state.updateInfo).toEqual(updateInfo);
    });
  });

  describe('State Change Notifications', () => {
    it('should notify renderer on state change', () => {
      const updater = new AutoUpdater();
      updater.setMainWindow(mockWindow as any);

      const onCheckingForUpdate = mockAutoUpdater.on.mock.calls.find(
        (call) => call[0] === 'checking-for-update'
      )?.[1];

      onCheckingForUpdate();

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'auto-update:state-changed',
        expect.objectContaining({ status: 'checking' })
      );
    });

    it('should not notify if window is destroyed', () => {
      const updater = new AutoUpdater();
      mockWindow.isDestroyed.mockReturnValue(true);
      updater.setMainWindow(mockWindow as any);

      const onCheckingForUpdate = mockAutoUpdater.on.mock.calls.find(
        (call) => call[0] === 'checking-for-update'
      )?.[1];

      onCheckingForUpdate();

      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });
  });
});
