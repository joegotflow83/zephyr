/**
 * Unit tests for src/main/ipc-handlers/docker-handlers.ts
 *
 * Verifies that registerDockerHandlers() correctly wires IPC channels to
 * DockerManager and DockerHealthMonitor methods. Each handler is extracted
 * via the mock ipcMain.handle registry, then called directly to confirm routing.
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

// Track webContents.send calls
const { mockWebContentsSend, mockBrowserWindow } = vi.hoisted(() => {
  const mockWebContentsSend = vi.fn();
  const mockBrowserWindow = {
    getAllWindows: vi.fn(() => [
      { webContents: { send: mockWebContentsSend } },
    ]),
  };
  return { mockWebContentsSend, mockBrowserWindow };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlerRegistry[channel] = handler;
    },
  },
  BrowserWindow: mockBrowserWindow,
}));

// ── Import subject under test (after mocks are in place) ─────────────────────

import { registerDockerHandlers } from '../../src/main/ipc-handlers/docker-handlers';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fake IpcMainInvokeEvent with sender.send() for testing progress events. */
const createFakeEvent = (): IpcMainInvokeEvent => ({
  sender: {
    send: mockWebContentsSend,
  },
} as unknown as IpcMainInvokeEvent);

/** Call a registered handler as if invoked from the renderer. */
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlerRegistry[channel];
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  return handler(createFakeEvent(), ...args);
}

// ── Service mocks ─────────────────────────────────────────────────────────────

const mockDockerManager = {
  isDockerAvailable: vi.fn(),
  getDockerInfo: vi.fn(),
  pullImage: vi.fn(),
  createContainer: vi.fn(),
  startContainer: vi.fn(),
  stopContainer: vi.fn(),
  removeContainer: vi.fn(),
  listRunningContainers: vi.fn(),
  getContainerStatus: vi.fn(),
  execCommand: vi.fn(),
};

const mockDockerHealth = {
  onStatusChange: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  getLastKnownStatus: vi.fn(),
  isRunning: vi.fn(),
  removeCallback: vi.fn(),
};

// ── Setup ─────────────────────────────────────────────────────────────────────

describe('registerDockerHandlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Clear registry between test suites
    for (const key of Object.keys(handlerRegistry)) {
      delete handlerRegistry[key];
    }
    registerDockerHandlers({
      dockerManager: mockDockerManager as never,
      dockerHealth: mockDockerHealth as never,
    });
  });

  // ── Docker Status ──────────────────────────────────────────────────────────

  describe('docker:status', () => {
    it('returns available:false when Docker is unavailable', async () => {
      mockDockerManager.isDockerAvailable.mockResolvedValue(false);
      const result = await invoke(IPC.DOCKER_STATUS);
      expect(mockDockerManager.isDockerAvailable).toHaveBeenCalledOnce();
      expect(result).toEqual({ available: false });
      expect(mockDockerManager.getDockerInfo).not.toHaveBeenCalled();
    });

    it('returns available:true with info when Docker is available', async () => {
      mockDockerManager.isDockerAvailable.mockResolvedValue(true);
      const info = {
        version: '24.0.0',
        containers: 5,
        images: 12,
        osType: 'linux',
        architecture: 'x86_64',
      };
      mockDockerManager.getDockerInfo.mockResolvedValue(info);
      const result = await invoke(IPC.DOCKER_STATUS);
      expect(mockDockerManager.isDockerAvailable).toHaveBeenCalledOnce();
      expect(mockDockerManager.getDockerInfo).toHaveBeenCalledOnce();
      expect(result).toEqual({ available: true, info });
    });
  });

  // ── Image Operations ───────────────────────────────────────────────────────

  describe('docker:pull-image', () => {
    it('pulls image and sends progress updates', async () => {
      mockDockerManager.pullImage.mockImplementation(async (image, onProgress) => {
        // Simulate progress callback
        if (onProgress) {
          onProgress({ status: 'Pulling', progress: '50%' });
          onProgress({ status: 'Downloaded', progress: '100%' });
        }
      });

      const result = await invoke(IPC.DOCKER_PULL_IMAGE, 'ubuntu:latest');

      expect(mockDockerManager.pullImage).toHaveBeenCalledWith(
        'ubuntu:latest',
        expect.any(Function),
      );
      expect(result).toEqual({ success: true });

      // Verify progress was sent to renderer
      expect(mockWebContentsSend).toHaveBeenCalledWith(IPC.DOCKER_PULL_PROGRESS, {
        image: 'ubuntu:latest',
        progress: { status: 'Pulling', progress: '50%' },
      });
      expect(mockWebContentsSend).toHaveBeenCalledWith(IPC.DOCKER_PULL_PROGRESS, {
        image: 'ubuntu:latest',
        progress: { status: 'Downloaded', progress: '100%' },
      });
    });
  });

  // ── Container Lifecycle ────────────────────────────────────────────────────

  describe('docker:create-container', () => {
    it('passes opts to dockerManager.createContainer() and returns container ID', async () => {
      const opts = {
        image: 'ubuntu:latest',
        projectId: 'test-project',
        name: 'test-container',
        cmd: ['bash'],
      };
      mockDockerManager.createContainer.mockResolvedValue('container-abc123');
      const result = await invoke(IPC.DOCKER_CREATE_CONTAINER, opts);
      expect(mockDockerManager.createContainer).toHaveBeenCalledWith(opts);
      expect(result).toBe('container-abc123');
    });
  });

  describe('docker:start', () => {
    it('passes containerId to dockerManager.startContainer()', async () => {
      mockDockerManager.startContainer.mockResolvedValue(undefined);
      await invoke(IPC.DOCKER_START, 'container-xyz');
      expect(mockDockerManager.startContainer).toHaveBeenCalledWith('container-xyz');
    });
  });

  describe('docker:stop', () => {
    it('passes containerId to dockerManager.stopContainer()', async () => {
      mockDockerManager.stopContainer.mockResolvedValue(undefined);
      await invoke(IPC.DOCKER_STOP, 'container-xyz');
      expect(mockDockerManager.stopContainer).toHaveBeenCalledWith('container-xyz', undefined);
    });

    it('passes timeout when provided', async () => {
      mockDockerManager.stopContainer.mockResolvedValue(undefined);
      await invoke(IPC.DOCKER_STOP, 'container-xyz', 30);
      expect(mockDockerManager.stopContainer).toHaveBeenCalledWith('container-xyz', 30);
    });
  });

  describe('docker:remove', () => {
    it('passes containerId to dockerManager.removeContainer()', async () => {
      mockDockerManager.removeContainer.mockResolvedValue(undefined);
      await invoke(IPC.DOCKER_REMOVE, 'container-xyz');
      expect(mockDockerManager.removeContainer).toHaveBeenCalledWith('container-xyz', undefined);
    });

    it('passes force flag when provided', async () => {
      mockDockerManager.removeContainer.mockResolvedValue(undefined);
      await invoke(IPC.DOCKER_REMOVE, 'container-xyz', true);
      expect(mockDockerManager.removeContainer).toHaveBeenCalledWith('container-xyz', true);
    });
  });

  describe('docker:list-containers', () => {
    it('delegates to dockerManager.listRunningContainers()', async () => {
      const containers = [
        {
          id: 'abc123',
          name: 'test-1',
          image: 'ubuntu:latest',
          state: 'running',
          status: 'Up 5 minutes',
          created: '2026-02-18T10:00:00Z',
          projectId: 'proj-1',
        },
      ];
      mockDockerManager.listRunningContainers.mockResolvedValue(containers);
      const result = await invoke(IPC.DOCKER_LIST_CONTAINERS);
      expect(mockDockerManager.listRunningContainers).toHaveBeenCalledOnce();
      expect(result).toEqual(containers);
    });

    it('returns empty array when no containers', async () => {
      mockDockerManager.listRunningContainers.mockResolvedValue([]);
      const result = await invoke(IPC.DOCKER_LIST_CONTAINERS);
      expect(result).toEqual([]);
    });
  });

  describe('docker:container-status', () => {
    it('passes containerId to dockerManager.getContainerStatus()', async () => {
      const status = {
        id: 'abc123',
        state: 'running',
        status: 'Up 10 minutes',
        startedAt: '2026-02-18T10:00:00Z',
      };
      mockDockerManager.getContainerStatus.mockResolvedValue(status);
      const result = await invoke(IPC.DOCKER_CONTAINER_STATUS, 'abc123');
      expect(mockDockerManager.getContainerStatus).toHaveBeenCalledWith('abc123');
      expect(result).toEqual(status);
    });
  });

  // ── Exec Command ───────────────────────────────────────────────────────────

  describe('docker:exec', () => {
    it('passes containerId, cmd to dockerManager.execCommand()', async () => {
      const execResult = {
        exitCode: 0,
        stdout: 'Hello World',
        stderr: '',
      };
      mockDockerManager.execCommand.mockResolvedValue(execResult);
      const result = await invoke(IPC.DOCKER_EXEC, 'container-xyz', ['echo', 'Hello World']);
      expect(mockDockerManager.execCommand).toHaveBeenCalledWith(
        'container-xyz',
        ['echo', 'Hello World'],
        undefined,
      );
      expect(result).toEqual(execResult);
    });

    it('passes opts when provided', async () => {
      const execResult = {
        exitCode: 0,
        stdout: '/app',
        stderr: '',
      };
      const opts = { user: 'root', workingDir: '/app' };
      mockDockerManager.execCommand.mockResolvedValue(execResult);
      const result = await invoke(IPC.DOCKER_EXEC, 'container-xyz', ['pwd'], opts);
      expect(mockDockerManager.execCommand).toHaveBeenCalledWith('container-xyz', ['pwd'], opts);
      expect(result).toEqual(execResult);
    });
  });

  // ── Docker Health Monitoring ───────────────────────────────────────────────

  describe('docker health monitoring', () => {
    it('registers status change callback that broadcasts to all windows', () => {
      // Verify onStatusChange was called during registration
      expect(mockDockerHealth.onStatusChange).toHaveBeenCalledOnce();
      expect(mockDockerHealth.onStatusChange).toHaveBeenCalledWith(expect.any(Function));

      // Get the callback that was registered
      const callback = mockDockerHealth.onStatusChange.mock.calls[0][0];

      // Simulate Docker status change
      callback(true);

      // Verify broadcast to all windows
      expect(mockBrowserWindow.getAllWindows).toHaveBeenCalled();
      expect(mockWebContentsSend).toHaveBeenCalledWith(IPC.DOCKER_STATUS_CHANGED, true);

      // Test with disconnection
      mockWebContentsSend.mockClear();
      callback(false);
      expect(mockWebContentsSend).toHaveBeenCalledWith(IPC.DOCKER_STATUS_CHANGED, false);
    });
  });

  // ── Channel registration ───────────────────────────────────────────────────

  describe('channel registration', () => {
    it('registers all expected channels', () => {
      const expected = [
        IPC.DOCKER_STATUS,
        IPC.DOCKER_PULL_IMAGE,
        IPC.DOCKER_CREATE_CONTAINER,
        IPC.DOCKER_START,
        IPC.DOCKER_STOP,
        IPC.DOCKER_REMOVE,
        IPC.DOCKER_LIST_CONTAINERS,
        IPC.DOCKER_CONTAINER_STATUS,
        IPC.DOCKER_EXEC,
      ];
      for (const channel of expected) {
        expect(handlerRegistry[channel], `Missing handler for ${channel}`).toBeDefined();
      }
    });
  });
});
