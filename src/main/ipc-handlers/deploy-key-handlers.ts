// IPC handlers for deploy key management (DeployKeyStore).
// Registered once during app startup via registerDeployKeyHandlers().
// Surfaces orphaned deploy key data to the Settings UI.

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { DeployKeyStore, DeployKeyRecord } from '../../services/deploy-key-store';

export interface DeployKeyServices {
  deployKeyStore: DeployKeyStore;
}

export function registerDeployKeyHandlers(services: DeployKeyServices): void {
  const { deployKeyStore } = services;

  // ── List Orphaned Keys ────────────────────────────────────────────────────

  ipcMain.handle(IPC.DEPLOY_KEYS_LIST_ORPHANED, async (): Promise<DeployKeyRecord[]> => {
    return deployKeyStore.listOrphaned();
  });

  // ── Get Deploy Keys URL (GitHub or GitLab) ───────────────────────────────

  ipcMain.handle(
    IPC.DEPLOY_KEYS_GET_URL,
    async (_event, repo: string, service?: 'github' | 'gitlab'): Promise<string> => {
      return deployKeyStore.getDeployKeysUrl(repo, service);
    },
  );
}
