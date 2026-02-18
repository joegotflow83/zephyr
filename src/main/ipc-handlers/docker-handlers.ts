// IPC handlers for Docker service operations.
// Registered once during app startup via registerDockerHandlers().
// All handlers run in the main process and delegate to DockerManager and DockerHealthMonitor.

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { DockerManager, ContainerCreateOpts } from '../../services/docker-manager';
import type { DockerHealthMonitor } from '../../services/docker-health';

export interface DockerServices {
  dockerManager: DockerManager;
  dockerHealth: DockerHealthMonitor;
}

/**
 * Register all Docker-related IPC handlers
 * @param services - Docker services to delegate to
 */
export function registerDockerHandlers(services: DockerServices): void {
  const { dockerManager, dockerHealth } = services;

  // ── Docker Status ─────────────────────────────────────────────────────────

  ipcMain.handle(IPC.DOCKER_STATUS, async () => {
    const isAvailable = await dockerManager.isDockerAvailable();
    if (!isAvailable) {
      return { available: false };
    }
    const info = await dockerManager.getDockerInfo();
    return { available: true, info };
  });

  // ── Image Operations ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.DOCKER_PULL_IMAGE, async (event, image: string) => {
    const sender = event.sender;

    // Pull image with progress updates sent to renderer
    await dockerManager.pullImage(image, (progress) => {
      // Send progress to renderer
      sender.send(IPC.DOCKER_PULL_PROGRESS, { image, progress });
    });

    return { success: true };
  });

  // ── Container Lifecycle ───────────────────────────────────────────────────

  ipcMain.handle(
    IPC.DOCKER_CREATE_CONTAINER,
    async (_event, opts: ContainerCreateOpts): Promise<string> => {
      return dockerManager.createContainer(opts);
    },
  );

  ipcMain.handle(IPC.DOCKER_START, async (_event, containerId: string): Promise<void> => {
    await dockerManager.startContainer(containerId);
  });

  ipcMain.handle(
    IPC.DOCKER_STOP,
    async (_event, containerId: string, timeout?: number): Promise<void> => {
      await dockerManager.stopContainer(containerId, timeout);
    },
  );

  ipcMain.handle(
    IPC.DOCKER_REMOVE,
    async (_event, containerId: string, force?: boolean): Promise<void> => {
      await dockerManager.removeContainer(containerId, force);
    },
  );

  ipcMain.handle(IPC.DOCKER_LIST_CONTAINERS, async () => {
    return dockerManager.listRunningContainers();
  });

  ipcMain.handle(IPC.DOCKER_CONTAINER_STATUS, async (_event, containerId: string) => {
    return dockerManager.getContainerStatus(containerId);
  });

  // ── Exec Command ──────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.DOCKER_EXEC,
    async (_event, containerId: string, cmd: string[], opts?: { user?: string; workingDir?: string; env?: string[] }) => {
      return dockerManager.execCommand(containerId, cmd, opts);
    },
  );

  // ── Docker Health Monitoring ──────────────────────────────────────────────

  // Register health status change callback to broadcast to all windows
  dockerHealth.onStatusChange((isAvailable) => {
    // Send to all renderer windows
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send(IPC.DOCKER_STATUS_CHANGED, isAvailable);
    });
  });
}
