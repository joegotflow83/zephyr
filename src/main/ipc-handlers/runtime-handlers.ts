// IPC handlers for container runtime operations.
// Registered once during app startup via registerRuntimeHandlers().
// All handlers run in the main process and delegate to ContainerRuntime and RuntimeHealthMonitor.
//
// Why this exists: decouples IPC from any concrete runtime (Docker, Podman).
// The same handlers work regardless of which runtime is active.

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { ContainerRuntime, ContainerCreateOpts, ExecOpts } from '../../services/container-runtime';
import type { RuntimeHealthMonitor } from '../../services/runtime-health';

export interface RuntimeServices {
  runtime: ContainerRuntime;
  runtimeHealth: RuntimeHealthMonitor;
}

/**
 * Register all container runtime IPC handlers.
 * @param services - Runtime services to delegate to
 */
export function registerRuntimeHandlers(services: RuntimeServices): void {
  const { runtime, runtimeHealth } = services;

  // ── Runtime Status ─────────────────────────────────────────────────────────

  ipcMain.handle(IPC.RUNTIME_STATUS, async () => {
    const isAvailable = await runtime.isAvailable();
    if (!isAvailable) {
      return { available: false };
    }
    // getInfo() runs the same command as isAvailable() but parses the JSON.
    // Guard against parse errors so a malformed-but-exiting-0 response doesn't
    // flip available to false.
    try {
      const info = await runtime.getInfo();
      return { available: true, info };
    } catch {
      return { available: true };
    }
  });

  // ── Image Operations ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.RUNTIME_PULL_IMAGE, async (event, image: string) => {
    const sender = event.sender;

    await runtime.pullImage(image, (progress) => {
      sender.send(IPC.RUNTIME_PULL_PROGRESS, { image, progress });
    });

    return { success: true };
  });

  // ── Container Lifecycle ───────────────────────────────────────────────────

  ipcMain.handle(
    IPC.RUNTIME_CREATE_CONTAINER,
    async (_event, opts: ContainerCreateOpts): Promise<string> => {
      return runtime.createContainer(opts);
    },
  );

  ipcMain.handle(IPC.RUNTIME_START, async (_event, containerId: string): Promise<void> => {
    await runtime.startContainer(containerId);
  });

  ipcMain.handle(
    IPC.RUNTIME_STOP,
    async (_event, containerId: string, timeout?: number): Promise<void> => {
      await runtime.stopContainer(containerId, timeout);
    },
  );

  ipcMain.handle(
    IPC.RUNTIME_REMOVE,
    async (_event, containerId: string, force?: boolean): Promise<void> => {
      await runtime.removeContainer(containerId, force);
    },
  );

  ipcMain.handle(IPC.RUNTIME_LIST_CONTAINERS, async () => {
    return runtime.listContainers();
  });

  ipcMain.handle(IPC.RUNTIME_CONTAINER_STATUS, async (_event, containerId: string) => {
    return runtime.getContainerStatus(containerId);
  });

  // ── Exec Command ──────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.RUNTIME_EXEC,
    async (_event, containerId: string, cmd: string[], opts?: ExecOpts) => {
      return runtime.execCommand(containerId, cmd, opts);
    },
  );

  // ── Health Monitoring ─────────────────────────────────────────────────────

  // Broadcast runtime availability changes to all renderer windows.
  // Include runtime info when available so the renderer can display version/stats
  // without a separate round-trip query.
  runtimeHealth.onStatusChange(async (isAvailable) => {
    let info;
    if (isAvailable) {
      try {
        info = await runtime.getInfo();
      } catch {
        // info stays undefined — available flag still propagates correctly
      }
    }
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send(IPC.RUNTIME_STATUS_CHANGED, isAvailable, info);
    });
  });
}
