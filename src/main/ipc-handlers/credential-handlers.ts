// IPC handlers for credential services (API keys, login sessions).
// Registered once during app startup via registerCredentialHandlers().
// All handlers run in the main process and delegate to service instances.

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { CredentialManager, CredentialService } from '../../services/credential-manager';
import type { LoginManager, LoginResult } from '../../services/login-manager';

export interface CredentialServices {
  credentialManager: CredentialManager;
  loginManager: LoginManager;
}

/**
 * Mask an API key for display in the renderer.
 * Shows first 4 and last 4 characters, masks the rest.
 * Example: "sk_test_1234567890abcdef" -> "sk_t**********cdef"
 */
function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return '****';
  }
  const prefix = key.slice(0, 4);
  const suffix = key.slice(-4);
  const masked = '*'.repeat(Math.min(10, key.length - 8));
  return `${prefix}${masked}${suffix}`;
}

export function registerCredentialHandlers(services: CredentialServices): void {
  const { credentialManager, loginManager } = services;

  // ── Store API Key ─────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.CREDENTIALS_STORE,
    async (_event, service: CredentialService, key: string): Promise<void> => {
      await credentialManager.storeApiKey(service, key);
    },
  );

  // ── Get API Key (masked) ──────────────────────────────────────────────────

  ipcMain.handle(
    IPC.CREDENTIALS_GET,
    async (_event, service: CredentialService): Promise<string | null> => {
      const key = await credentialManager.getApiKey(service);
      if (!key) {
        return null;
      }
      // Return masked version to renderer for display
      return maskApiKey(key);
    },
  );

  // ── Delete API Key ────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.CREDENTIALS_DELETE,
    async (_event, service: CredentialService): Promise<void> => {
      await credentialManager.deleteApiKey(service);
    },
  );

  // ── List Stored Services ──────────────────────────────────────────────────

  ipcMain.handle(IPC.CREDENTIALS_LIST, async (): Promise<string[]> => {
    return credentialManager.listStoredServices();
  });

  // ── Login (browser-based) ─────────────────────────────────────────────────

  ipcMain.handle(
    IPC.CREDENTIALS_LOGIN,
    async (_event, service: string): Promise<LoginResult> => {
      if (service === 'claude-code') {
        return loginManager.openClaudeCodeLoginSession();
      }
      return loginManager.openLoginSession(service);
    },
  );

  // ── Check Auth Status ─────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.CREDENTIALS_CHECK_AUTH,
    async (): Promise<{ api_key: boolean; browser_session: boolean; aws_bedrock: boolean }> => {
      const stored = await credentialManager.listStoredServices();
      return {
        api_key: stored.includes('anthropic'),
        browser_session: stored.includes('anthropic_session'),
        aws_bedrock: stored.includes('anthropic_bedrock'),
      };
    },
  );

  // ── GitHub PAT (per-project) ──────────────────────────────────────────────

  ipcMain.handle(
    IPC.GITHUB_PAT_SET,
    async (_event, projectId: string, pat: string): Promise<void> => {
      await credentialManager.setGithubPat(projectId, pat);
    },
  );

  ipcMain.handle(
    IPC.GITHUB_PAT_GET,
    async (_event, projectId: string): Promise<boolean> => {
      const pat = await credentialManager.getGithubPat(projectId);
      return pat !== null;
    },
  );

  ipcMain.handle(
    IPC.GITHUB_PAT_DELETE,
    async (_event, projectId: string): Promise<void> => {
      await credentialManager.deleteGithubPat(projectId);
    },
  );

  // ── GitLab PAT (per-project) ──────────────────────────────────────────────

  ipcMain.handle(
    IPC.GITLAB_PAT_SET,
    async (_event, projectId: string, pat: string): Promise<void> => {
      await credentialManager.setGitlabPat(projectId, pat);
    },
  );

  ipcMain.handle(
    IPC.GITLAB_PAT_GET,
    async (_event, projectId: string): Promise<boolean> => {
      const pat = await credentialManager.getGitlabPat(projectId);
      return pat !== null;
    },
  );

  ipcMain.handle(
    IPC.GITLAB_PAT_DELETE,
    async (_event, projectId: string): Promise<void> => {
      await credentialManager.deleteGitlabPat(projectId);
    },
  );
}
