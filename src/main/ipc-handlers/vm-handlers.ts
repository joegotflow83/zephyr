// IPC handlers for VM management operations.
// Registered once during app startup via registerVMHandlers().
// All handlers run in the main process and delegate to VMManager and LoopRunner.

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { VMManager, VMInfo } from '../../services/vm-manager';
import type { LoopRunner } from '../../services/loop-runner';
import type { VMConfig } from '../../shared/models';
import { getLogger } from '../../services/logging';

export interface VMServices {
  vmManager: VMManager;
  loopRunner: LoopRunner;
}

/**
 * Register all VM-related IPC handlers.
 *
 * Handlers map the IPC channels defined in ipc-channels.ts to VMManager
 * and LoopRunner methods. VM state changes are broadcast to all renderer
 * windows via VM_STATUS_CHANGED after mutating operations.
 */
export function registerVMHandlers(services: VMServices): void {
  const { vmManager, loopRunner } = services;
  const logger = getLogger('vm');

  /** Broadcast updated VM info to all renderer windows */
  function broadcastVMStatus(info: VMInfo): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC.VM_STATUS_CHANGED, info);
    });
  }

  // ── VM Status ─────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.VM_STATUS, async () => {
    const available = await vmManager.isMultipassAvailable();
    if (!available) {
      return { available: false };
    }
    try {
      const version = await vmManager.getVersion();
      return { available: true, version };
    } catch {
      return { available: true };
    }
  });

  // ── VM Listing ────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.VM_LIST, async () => {
    return vmManager.listVMs();
  });

  ipcMain.handle(IPC.VM_GET, async (_event, name: string) => {
    return vmManager.getVMInfo(name);
  });

  // ── Persistent VM Lifecycle (project-scoped) ──────────────────────────────

  // Start (or create-then-start) the persistent VM for a project.
  // vmConfig is forwarded so the VM can be provisioned on first use.
  ipcMain.handle(IPC.VM_START, async (_event, projectId: string, vmConfig?: VMConfig): Promise<VMInfo> => {
    const info = await loopRunner.startProjectVM(projectId, vmConfig);
    broadcastVMStatus(info);
    return info;
  });

  // Stop the persistent VM for a project. Refuses if a loop is actively running.
  ipcMain.handle(IPC.VM_STOP, async (_event, projectId: string): Promise<void> => {
    await loopRunner.stopProjectVM(projectId);
    // Broadcast updated VM info (state should now be Stopped)
    try {
      const info = await loopRunner.getProjectVMInfo(projectId);
      if (info) {
        broadcastVMStatus(info);
      }
    } catch (err) {
      logger.warn('Failed to get VM info after stop for broadcast', { err });
    }
  });

  // ── VM Deletion ───────────────────────────────────────────────────────────

  // Delete a VM by name and purge it from disk immediately.
  ipcMain.handle(IPC.VM_DELETE, async (_event, name: string): Promise<void> => {
    await vmManager.deleteVM(name, true);
  });
}
