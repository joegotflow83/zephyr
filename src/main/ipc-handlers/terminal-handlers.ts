// IPC handlers for terminal service operations.
// Registered once during app startup via registerTerminalHandlers().
// All handlers run in the main process and delegate to TerminalManager.

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { TerminalManager, TerminalSessionOpts } from '../../services/terminal-manager';
import type { VMManager } from '../../services/vm-manager';

export interface TerminalServices {
  terminalManager: TerminalManager;
  vmManager: VMManager;
}

/**
 * Register all terminal-related IPC handlers
 * @param services - Terminal services to delegate to
 */
export function registerTerminalHandlers(services: TerminalServices): void {
  const { terminalManager, vmManager } = services;

  // ── Open Terminal Session ────────────────────────────────────────────────

  ipcMain.handle(
    IPC.TERMINAL_OPEN,
    async (_event, containerId: string, opts?: TerminalSessionOpts) => {
      try {
        const session = await terminalManager.openSession(containerId, opts);
        return { success: true, session };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  );

  // ── Open VM Terminal Session ─────────────────────────────────────────────

  ipcMain.handle(
    IPC.TERMINAL_OPEN_VM,
    async (_event, vmName: string, containerName: string, opts?: TerminalSessionOpts) => {
      try {
        const session = await terminalManager.openVMSession(vmName, containerName, vmManager, opts);
        return { success: true, session };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  );

  // ── Close Terminal Session ───────────────────────────────────────────────

  ipcMain.handle(IPC.TERMINAL_CLOSE, async (_event, sessionId: string) => {
    try {
      await terminalManager.closeSession(sessionId);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  // ── Write to Terminal (fire-and-forget for performance) ──────────────────

  ipcMain.on(IPC.TERMINAL_WRITE, (_event, sessionId: string, data: string) => {
    try {
      terminalManager.writeToSession(sessionId, data);
    } catch (error) {
      // Log error but don't block (fire-and-forget)
      console.error(`Terminal write error for session ${sessionId}:`, error);
    }
  });

  // ── Resize Terminal PTY ───────────────────────────────────────────────────

  ipcMain.handle(
    IPC.TERMINAL_RESIZE,
    async (_event, sessionId: string, cols: number, rows: number) => {
      try {
        await terminalManager.resizeSession(sessionId, cols, rows);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  );
}
