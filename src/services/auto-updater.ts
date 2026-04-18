/**
 * Auto-Updater Service
 *
 * Handles automatic application updates using electron-updater.
 * Checks for updates on startup and allows manual update checks.
 * Uses GitHub Releases as the update source.
 */

import { autoUpdater, UpdateInfo } from 'electron-updater';
import { app, BrowserWindow, dialog } from 'electron';
import { getLogger } from './logging';

const logger = getLogger('updater');

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface AutoUpdateState {
  status: UpdateStatus;
  updateInfo?: UpdateInfo;
  error?: string;
  downloadProgress?: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
}

export class AutoUpdater {
  private mainWindow: BrowserWindow | null = null;
  private state: AutoUpdateState = { status: 'idle' };
  private checkOnStartupDelay = 10000; // 10 seconds
  private startupCheckCompleted = false;
  private quitAndInstallPending = false;

  constructor() {
    // Configure auto-updater
    autoUpdater.autoDownload = false; // Require user confirmation
    autoUpdater.autoInstallOnAppQuit = true;

    // Set up event listeners
    this.setupEventListeners();
  }

  /**
   * Set the main window for notifications
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Get current update state
   */
  getState(): AutoUpdateState {
    return { ...this.state };
  }

  /**
   * Check for updates on app startup (with delay)
   */
  checkForUpdatesOnStartup(): void {
    if (this.startupCheckCompleted) {
      logger.info('Startup update check already completed');
      return;
    }

    logger.info('Scheduling startup update check', {
      delay: this.checkOnStartupDelay,
    });

    setTimeout(() => {
      this.startupCheckCompleted = true;
      this.checkForUpdates(false); // Silent check on startup
    }, this.checkOnStartupDelay);
  }

  /**
   * Manually check for updates
   */
  async checkForUpdates(showNoUpdateDialog = true): Promise<void> {
    if (this.state.status === 'checking' || this.state.status === 'downloading') {
      logger.warn('Update check already in progress');
      return;
    }

    logger.info('Checking for updates', { manual: showNoUpdateDialog });
    this.updateState({ status: 'checking', error: undefined });

    try {
      const result = await autoUpdater.checkForUpdates();

      if (!result) {
        throw new Error('Update check returned no result');
      }

      // State will be updated by event handlers
      if (showNoUpdateDialog && this.state.status === 'not-available') {
        this.showNoUpdateDialog();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to check for updates', { error: message });
      this.updateState({ status: 'error', error: message });

      if (showNoUpdateDialog) {
        this.showErrorDialog(message);
      }
    }
  }

  /**
   * Download the available update
   */
  async downloadUpdate(): Promise<void> {
    if (this.state.status !== 'available') {
      logger.warn('No update available to download');
      return;
    }

    logger.info('Starting update download');
    this.updateState({ status: 'downloading' });

    try {
      await autoUpdater.downloadUpdate();
      // State will be updated by 'update-downloaded' event
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to download update', { error: message });
      this.updateState({ status: 'error', error: message });
      this.showErrorDialog(`Failed to download update: ${message}`);
    }
  }

  /**
   * Returns true if quitAndInstall has been called and the app is about to
   * be replaced by the update. Used by the before-quit handler to skip
   * graceful shutdown and let Squirrel's install sequence run uninterrupted.
   */
  isQuitAndInstallPending(): boolean {
    return this.quitAndInstallPending;
  }

  /**
   * Install the downloaded update and restart the app
   */
  quitAndInstall(): void {
    if (this.state.status !== 'downloaded') {
      logger.warn('No update downloaded to install');
      return;
    }

    logger.info('Quitting and installing update');
    this.quitAndInstallPending = true;
    autoUpdater.quitAndInstall(false, true);

    // Guarantee the app quits even if electron-updater fails to call app.quit()
    // (e.g. MacUpdater.quitAndInstall() can return without quitting when
    // squirrelDownloadedUpdate is false, or nativeUpdater.quitAndInstall() may
    // not trigger app.quit() on all Electron/platform combinations).
    //
    // The before-quit handler returns early when quitAndInstallPending is true,
    // so this won't trigger graceful shutdown and won't interrupt the install.
    // If install failed synchronously (e.g. RPM pkexec cancelled), the error
    // listener above resets quitAndInstallPending to false before we reach here,
    // and we skip the explicit quit so the user can see the error and try again.
    if (this.quitAndInstallPending) {
      app.quit();
    }
  }

  /**
   * Set up electron-updater event listeners
   */
  private setupEventListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      logger.info('Checking for update...');
      this.updateState({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      logger.info('Update available', {
        version: info.version,
        releaseDate: info.releaseDate,
      });
      this.updateState({ status: 'available', updateInfo: info });
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      logger.info('Update not available', {
        currentVersion: info.version,
      });
      this.updateState({ status: 'not-available', updateInfo: info });
    });

    autoUpdater.on('error', (error: Error) => {
      logger.error('Auto-updater error', { error: error.message });
      this.updateState({ status: 'error', error: error.message });
      // If install failed, clear the pending flag so before-quit runs graceful shutdown
      // instead of passing through, and so we don't call app.quit() as a fallback.
      this.quitAndInstallPending = false;
    });

    autoUpdater.on('download-progress', (progressObj) => {
      logger.debug('Download progress', {
        percent: progressObj.percent.toFixed(2),
        transferred: progressObj.transferred,
        total: progressObj.total,
      });
      this.updateState({
        status: 'downloading',
        downloadProgress: {
          percent: progressObj.percent,
          bytesPerSecond: progressObj.bytesPerSecond,
          transferred: progressObj.transferred,
          total: progressObj.total,
        },
      });
      this.notifyDownloadProgress(progressObj.percent);
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      logger.info('Update downloaded', {
        version: info.version,
      });
      this.updateState({ status: 'downloaded', updateInfo: info });
      this.notifyUpdateDownloaded(info);
    });
  }

  /**
   * Update internal state and notify renderer
   */
  private updateState(updates: Partial<AutoUpdateState>): void {
    this.state = { ...this.state, ...updates };

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('auto-update:state-changed', this.state);
    }
  }

  /**
   * Show notification when update is available
   */
  private notifyUpdateAvailable(info: UpdateInfo): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    dialog
      .showMessageBox(this.mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `A new version (${info.version}) is available!`,
        detail: `Current version: ${autoUpdater.currentVersion.version}\nNew version: ${info.version}\n\nWould you like to download it now?`,
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          this.downloadUpdate();
        }
      })
      .catch((error) => {
        logger.error('Failed to show update dialog', { error });
      });
  }

  /**
   * Notify renderer of download progress
   */
  private notifyDownloadProgress(percent: number): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    // Send progress to renderer for UI updates
    this.mainWindow.webContents.send('auto-update:download-progress', percent);
  }

  /**
   * Show notification when update is downloaded
   */
  private notifyUpdateDownloaded(info: UpdateInfo): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    dialog
      .showMessageBox(this.mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} has been downloaded`,
        detail: 'The update will be installed when you restart the application.\n\nWould you like to restart now?',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          this.quitAndInstall();
        }
      })
      .catch((error) => {
        logger.error('Failed to show update downloaded dialog', { error });
      });
  }

  /**
   * Show dialog when no update is available
   */
  private showNoUpdateDialog(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    dialog
      .showMessageBox(this.mainWindow, {
        type: 'info',
        title: 'No Updates',
        message: 'You are running the latest version',
        detail: `Current version: ${autoUpdater.currentVersion.version}`,
        buttons: ['OK'],
      })
      .catch((error) => {
        logger.error('Failed to show no update dialog', { error });
      });
  }

  /**
   * Show error dialog
   */
  private showErrorDialog(message: string): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    dialog
      .showMessageBox(this.mainWindow, {
        type: 'error',
        title: 'Update Error',
        message: 'Failed to check for updates',
        detail: message,
        buttons: ['OK'],
      })
      .catch((error) => {
        logger.error('Failed to show error dialog', { error });
      });
  }
}

// Singleton instance
let autoUpdaterInstance: AutoUpdater | null = null;

/**
 * Get the AutoUpdater singleton instance
 */
export function getAutoUpdater(): AutoUpdater {
  if (!autoUpdaterInstance) {
    autoUpdaterInstance = new AutoUpdater();
  }
  return autoUpdaterInstance;
}
