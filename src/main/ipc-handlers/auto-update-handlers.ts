/**
 * IPC handlers for auto-update functionality
 */

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { AutoUpdater } from '../../services/auto-updater';
import { getLogger } from '../../services/logging';

const logger = getLogger('ipc');

interface AutoUpdateHandlersDeps {
  autoUpdater: AutoUpdater;
}

export function registerAutoUpdateHandlers(deps: AutoUpdateHandlersDeps): void {
  const { autoUpdater } = deps;

  // Get current auto-update state
  ipcMain.handle(IPC.AUTO_UPDATE_GET_STATE, () => {
    logger.debug('IPC: auto-update:get-state');
    return autoUpdater.getState();
  });

  // Manually check for updates
  ipcMain.handle(IPC.AUTO_UPDATE_CHECK, async () => {
    logger.info('IPC: auto-update:check');
    await autoUpdater.checkForUpdates(true);
  });

  // Download available update
  ipcMain.handle(IPC.AUTO_UPDATE_DOWNLOAD, async () => {
    logger.info('IPC: auto-update:download');
    await autoUpdater.downloadUpdate();
  });

  // Install downloaded update and restart
  ipcMain.handle(IPC.AUTO_UPDATE_INSTALL, () => {
    logger.info('IPC: auto-update:install (quit and install)');
    autoUpdater.quitAndInstall();
  });

  logger.info('Auto-update IPC handlers registered');
}
