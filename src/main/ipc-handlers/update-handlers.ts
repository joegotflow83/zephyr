// IPC handlers for application updates (check for updates, apply updates).
// Registered once during app startup via registerUpdateHandlers().
// All handlers run in the main process and delegate to SelfUpdater service.

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { SelfUpdater, UpdateInfo } from '../../services/self-updater';

export interface UpdateServices {
  selfUpdater: SelfUpdater;
}

/**
 * Register IPC handlers for application updates.
 *
 * @param services - Service instances needed for update operations
 */
export function registerUpdateHandlers(services: UpdateServices): void {
  const { selfUpdater } = services;

  // ── Check for Updates ─────────────────────────────────────────────────────

  ipcMain.handle(IPC.UPDATES_CHECK, async (): Promise<UpdateInfo> => {
    return await selfUpdater.checkForUpdates();
  });

  // ── Apply Update ──────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.UPDATES_APPLY,
    async (_event, dockerImage: string, envVars?: Record<string, string>): Promise<void> => {
      await selfUpdater.startSelfUpdate(dockerImage, envVars);
    }
  );
}
