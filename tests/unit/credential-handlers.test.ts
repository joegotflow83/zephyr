/**
 * Unit tests for src/main/ipc-handlers/credential-handlers.ts
 *
 * Verifies that registerCredentialHandlers() correctly wires IPC channels to
 * service methods. Each handler is extracted via the mock ipcMain.handle
 * registry, then called directly to confirm routing.
 *
 * Why we test routing: the IPC layer is the boundary between renderer and
 * main process. A mis-wired channel means the renderer silently gets undefined
 * or stale data. Unit tests here catch those regressions cheaply, without
 * needing a real Electron process.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../src/shared/ipc-channels';

// ── Mock electron ────────────────────────────────────────────────────────────

// Registry of handlers registered via ipcMain.handle()
const handlerRegistry: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlerRegistry[channel] = handler;
    },
  },
}));

// ── Import subject under test (after mocks are in place) ─────────────────────

import { registerCredentialHandlers } from '../../src/main/ipc-handlers/credential-handlers';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fake IpcMainInvokeEvent — handlers typically ignore it. */
const fakeEvent = {} as IpcMainInvokeEvent;

/** Call a registered handler as if invoked from the renderer. */
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlerRegistry[channel];
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  return handler(fakeEvent, ...args);
}

// ── Service mocks ─────────────────────────────────────────────────────────────

const mockCredentialManager = {
  storeApiKey: vi.fn(),
  getApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  listStoredServices: vi.fn(),
};

const mockLoginManager = {
  openLoginSession: vi.fn(),
};

// ── Setup ─────────────────────────────────────────────────────────────────────

describe('registerCredentialHandlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Clear registry between test suites
    for (const key of Object.keys(handlerRegistry)) {
      delete handlerRegistry[key];
    }
    registerCredentialHandlers({
      credentialManager: mockCredentialManager as never,
      loginManager: mockLoginManager as never,
    });
  });

  // ── Store API Key ───────────────────────────────────────────────────────────

  describe('credentials:store', () => {
    it('delegates to credentialManager.storeApiKey()', async () => {
      mockCredentialManager.storeApiKey.mockResolvedValue(undefined);

      await invoke(IPC.CREDENTIALS_STORE, 'anthropic', 'sk_test_1234');

      expect(mockCredentialManager.storeApiKey).toHaveBeenCalledWith(
        'anthropic',
        'sk_test_1234',
      );
    });

    it('propagates errors from credentialManager', async () => {
      mockCredentialManager.storeApiKey.mockRejectedValue(
        new Error('Encryption not available'),
      );

      await expect(
        invoke(IPC.CREDENTIALS_STORE, 'openai', ''),
      ).rejects.toThrow('Encryption not available');
    });
  });

  // ── Get API Key (masked) ─────────────────────────────────────────────────────

  describe('credentials:get', () => {
    it('returns masked API key when key exists', async () => {
      mockCredentialManager.getApiKey.mockResolvedValue('sk_test_1234567890abcdef');

      const result = await invoke(IPC.CREDENTIALS_GET, 'anthropic');

      expect(mockCredentialManager.getApiKey).toHaveBeenCalledWith('anthropic');
      // Masked format: first 4 + asterisks + last 4
      expect(result).toBe('sk_t**********cdef');
    });

    it('returns null when no key is stored', async () => {
      mockCredentialManager.getApiKey.mockResolvedValue(null);

      const result = await invoke(IPC.CREDENTIALS_GET, 'github');

      expect(mockCredentialManager.getApiKey).toHaveBeenCalledWith('github');
      expect(result).toBeNull();
    });

    it('masks short keys correctly', async () => {
      mockCredentialManager.getApiKey.mockResolvedValue('short');

      const result = await invoke(IPC.CREDENTIALS_GET, 'anthropic');

      // Keys <= 8 chars should just be '****'
      expect(result).toBe('****');
    });

    it('masks medium keys correctly', async () => {
      mockCredentialManager.getApiKey.mockResolvedValue('test123456');

      const result = await invoke(IPC.CREDENTIALS_GET, 'openai');

      // test123456 -> test**3456
      expect(result).toBe('test**3456');
    });

    it('masks long keys with max 10 asterisks', async () => {
      mockCredentialManager.getApiKey.mockResolvedValue(
        'sk_test_very_long_key_1234567890abcdefghijklmnop',
      );

      const result = await invoke(IPC.CREDENTIALS_GET, 'anthropic');

      // Should have exactly 10 asterisks (not more)
      expect(result).toBe('sk_t**********mnop');
      expect((result as string).match(/\*/g)?.length).toBe(10);
    });
  });

  // ── Delete API Key ───────────────────────────────────────────────────────────

  describe('credentials:delete', () => {
    it('delegates to credentialManager.deleteApiKey()', async () => {
      mockCredentialManager.deleteApiKey.mockResolvedValue(undefined);

      await invoke(IPC.CREDENTIALS_DELETE, 'anthropic');

      expect(mockCredentialManager.deleteApiKey).toHaveBeenCalledWith('anthropic');
    });

    it('completes successfully even if key does not exist', async () => {
      mockCredentialManager.deleteApiKey.mockResolvedValue(undefined);

      await expect(invoke(IPC.CREDENTIALS_DELETE, 'github')).resolves.toBeUndefined();
    });
  });

  // ── List Stored Services ─────────────────────────────────────────────────────

  describe('credentials:list', () => {
    it('returns list of services with stored credentials', async () => {
      const services = ['anthropic', 'openai'];
      mockCredentialManager.listStoredServices.mockResolvedValue(services);

      const result = await invoke(IPC.CREDENTIALS_LIST);

      expect(mockCredentialManager.listStoredServices).toHaveBeenCalled();
      expect(result).toEqual(services);
    });

    it('returns empty array when no credentials stored', async () => {
      mockCredentialManager.listStoredServices.mockResolvedValue([]);

      const result = await invoke(IPC.CREDENTIALS_LIST);

      expect(result).toEqual([]);
    });
  });

  // ── Login (browser-based) ─────────────────────────────────────────────────────

  describe('credentials:login', () => {
    it('delegates to loginManager.openLoginSession()', async () => {
      const loginResult = { success: true, service: 'anthropic' };
      mockLoginManager.openLoginSession.mockResolvedValue(loginResult);

      const result = await invoke(IPC.CREDENTIALS_LOGIN, 'anthropic');

      expect(mockLoginManager.openLoginSession).toHaveBeenCalledWith('anthropic');
      expect(result).toEqual(loginResult);
    });

    it('returns error result on login failure', async () => {
      const loginResult = {
        success: false,
        service: 'openai',
        error: 'User cancelled login',
      };
      mockLoginManager.openLoginSession.mockResolvedValue(loginResult);

      const result = await invoke(IPC.CREDENTIALS_LOGIN, 'openai');

      expect(result).toEqual(loginResult);
    });

    it('propagates errors from loginManager', async () => {
      mockLoginManager.openLoginSession.mockRejectedValue(
        new Error('No login URL known'),
      );

      await expect(
        invoke(IPC.CREDENTIALS_LOGIN, 'unknown-service'),
      ).rejects.toThrow('No login URL known');
    });
  });
});
