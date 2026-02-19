/**
 * Unit tests for src/main/ipc-handlers/terminal-handlers.ts
 *
 * Verifies that registerTerminalHandlers() correctly wires IPC channels to
 * TerminalManager methods. Each handler is extracted via the mock ipcMain
 * registry, then called directly to confirm routing and error handling.
 *
 * Why we test routing: the IPC layer is the boundary between renderer and
 * main process. A mis-wired channel means the renderer silently gets undefined
 * or stale data. Unit tests here catch those regressions cheaply, without
 * needing a real Electron process.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../src/shared/ipc-channels';
import type { TerminalSession } from '../../src/services/terminal-manager';

// ── Mock electron ────────────────────────────────────────────────────────────

// Registry of handlers registered via ipcMain.handle()
const handleRegistry: Record<string, (...args: unknown[]) => unknown> = {};

// Registry of handlers registered via ipcMain.on() (fire-and-forget)
const onRegistry: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handleRegistry[channel] = handler;
    },
    on: (channel: string, handler: (...args: unknown[]) => unknown) => {
      onRegistry[channel] = handler;
    },
  },
}));

// ── Import subject under test (after mocks are in place) ─────────────────────

import { registerTerminalHandlers } from '../../src/main/ipc-handlers/terminal-handlers';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fake IpcMainInvokeEvent for testing */
const createFakeEvent = (): IpcMainInvokeEvent =>
  ({
    sender: {},
  }) as unknown as IpcMainInvokeEvent;

/** Call a registered handle handler as if invoked from the renderer. */
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handleRegistry[channel];
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  return handler(createFakeEvent(), ...args);
}

/** Call a registered on handler as if invoked from the renderer. */
function send(channel: string, ...args: unknown[]): void {
  const handler = onRegistry[channel];
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  handler(createFakeEvent(), ...args);
}

// ── Service mocks ─────────────────────────────────────────────────────────────

const mockTerminalManager = {
  openSession: vi.fn(),
  closeSession: vi.fn(),
  writeToSession: vi.fn(),
  resizeSession: vi.fn(),
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('registerTerminalHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(handleRegistry).forEach((key) => delete handleRegistry[key]);
    Object.keys(onRegistry).forEach((key) => delete onRegistry[key]);
  });

  describe('terminal:open', () => {
    it('should register handler for terminal:open', () => {
      registerTerminalHandlers({ terminalManager: mockTerminalManager as any });
      expect(handleRegistry[IPC.TERMINAL_OPEN]).toBeDefined();
    });

    it('should open terminal session and return success with session', async () => {
      const mockSession: TerminalSession = {
        id: 'session-123',
        containerId: 'container-abc',
        user: 'root',
        createdAt: new Date('2026-02-19T00:00:00Z'),
      };

      mockTerminalManager.openSession.mockResolvedValue(mockSession);
      registerTerminalHandlers({ terminalManager: mockTerminalManager as any });

      const result = await invoke(IPC.TERMINAL_OPEN, 'container-abc', {
        shell: 'bash',
        user: 'root',
      });

      expect(mockTerminalManager.openSession).toHaveBeenCalledWith('container-abc', {
        shell: 'bash',
        user: 'root',
      });
      expect(result).toEqual({
        success: true,
        session: mockSession,
      });
    });

    it('should open terminal session without options', async () => {
      const mockSession: TerminalSession = {
        id: 'session-456',
        containerId: 'container-xyz',
        createdAt: new Date(),
      };

      mockTerminalManager.openSession.mockResolvedValue(mockSession);
      registerTerminalHandlers({ terminalManager: mockTerminalManager as any });

      const result = await invoke(IPC.TERMINAL_OPEN, 'container-xyz');

      expect(mockTerminalManager.openSession).toHaveBeenCalledWith(
        'container-xyz',
        undefined
      );
      expect(result).toEqual({
        success: true,
        session: mockSession,
      });
    });

    it('should return error if openSession fails', async () => {
      mockTerminalManager.openSession.mockRejectedValue(
        new Error('Container not found')
      );
      registerTerminalHandlers({ terminalManager: mockTerminalManager as any });

      const result = await invoke(IPC.TERMINAL_OPEN, 'bad-container');

      expect(result).toEqual({
        success: false,
        error: 'Container not found',
      });
    });
  });

  describe('terminal:close', () => {
    it('should register handler for terminal:close', () => {
      registerTerminalHandlers({ terminalManager: mockTerminalManager as any });
      expect(handleRegistry[IPC.TERMINAL_CLOSE]).toBeDefined();
    });

    it('should close terminal session and return success', async () => {
      mockTerminalManager.closeSession.mockResolvedValue(undefined);
      registerTerminalHandlers({ terminalManager: mockTerminalManager as any });

      const result = await invoke(IPC.TERMINAL_CLOSE, 'session-123');

      expect(mockTerminalManager.closeSession).toHaveBeenCalledWith('session-123');
      expect(result).toEqual({ success: true });
    });

    it('should return error if closeSession fails', async () => {
      mockTerminalManager.closeSession.mockRejectedValue(
        new Error('Session session-999 not found')
      );
      registerTerminalHandlers({ terminalManager: mockTerminalManager as any });

      const result = await invoke(IPC.TERMINAL_CLOSE, 'session-999');

      expect(result).toEqual({
        success: false,
        error: 'Session session-999 not found',
      });
    });
  });

  describe('terminal:write', () => {
    it('should register handler for terminal:write using ipcMain.on', () => {
      registerTerminalHandlers({ terminalManager: mockTerminalManager as any });
      expect(onRegistry[IPC.TERMINAL_WRITE]).toBeDefined();
    });

    it('should write data to terminal session (fire-and-forget)', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      registerTerminalHandlers({ terminalManager: mockTerminalManager as any });

      send(IPC.TERMINAL_WRITE, 'session-123', 'ls -la\n');

      expect(mockTerminalManager.writeToSession).toHaveBeenCalledWith(
        'session-123',
        'ls -la\n'
      );
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should log error but not throw if writeToSession fails', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockTerminalManager.writeToSession.mockImplementation(() => {
        throw new Error('Session not found');
      });
      registerTerminalHandlers({ terminalManager: mockTerminalManager as any });

      // Should not throw
      expect(() => {
        send(IPC.TERMINAL_WRITE, 'bad-session', 'data');
      }).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Terminal write error for session bad-session:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('terminal:resize', () => {
    it('should register handler for terminal:resize', () => {
      registerTerminalHandlers({ terminalManager: mockTerminalManager as any });
      expect(handleRegistry[IPC.TERMINAL_RESIZE]).toBeDefined();
    });

    it('should resize terminal session and return success', async () => {
      mockTerminalManager.resizeSession.mockResolvedValue(undefined);
      registerTerminalHandlers({ terminalManager: mockTerminalManager as any });

      const result = await invoke(IPC.TERMINAL_RESIZE, 'session-123', 80, 24);

      expect(mockTerminalManager.resizeSession).toHaveBeenCalledWith(
        'session-123',
        80,
        24
      );
      expect(result).toEqual({ success: true });
    });

    it('should return error if resizeSession fails', async () => {
      mockTerminalManager.resizeSession.mockRejectedValue(
        new Error('Resize failed')
      );
      registerTerminalHandlers({ terminalManager: mockTerminalManager as any });

      const result = await invoke(IPC.TERMINAL_RESIZE, 'session-123', 100, 30);

      expect(result).toEqual({
        success: false,
        error: 'Resize failed',
      });
    });
  });

  describe('integration', () => {
    it('should register all terminal handlers', () => {
      registerTerminalHandlers({ terminalManager: mockTerminalManager as any });

      expect(handleRegistry[IPC.TERMINAL_OPEN]).toBeDefined();
      expect(handleRegistry[IPC.TERMINAL_CLOSE]).toBeDefined();
      expect(onRegistry[IPC.TERMINAL_WRITE]).toBeDefined();
      expect(handleRegistry[IPC.TERMINAL_RESIZE]).toBeDefined();
    });
  });
});
