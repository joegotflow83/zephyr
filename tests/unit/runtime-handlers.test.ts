/**
 * Unit tests for src/main/ipc-handlers/runtime-handlers.ts
 *
 * Verifies that registerRuntimeHandlers() correctly wires IPC channels to
 * ContainerRuntime and RuntimeHealthMonitor methods. Each handler is extracted
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

import { registerRuntimeHandlers } from '../../src/main/ipc-handlers/runtime-handlers';

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

const mockRuntime = {
  isAvailable: vi.fn(),
  getInfo: vi.fn(),
  pullImage: vi.fn(),
  createContainer: vi.fn(),
  startContainer: vi.fn(),
  stopContainer: vi.fn(),
  removeContainer: vi.fn(),
  listContainers: vi.fn(),
  getContainerStatus: vi.fn(),
  execCommand: vi.fn(),
};

const mockRuntimeHealth = {
  onStatusChange: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  getLastKnownStatus: vi.fn(),
  isRunning: vi.fn(),
  removeCallback: vi.fn(),
};

// ── Setup ─────────────────────────────────────────────────────────────────────

describe('registerRuntimeHandlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Clear registry between test suites
    for (const key of Object.keys(handlerRegistry)) {
      delete handlerRegistry[key];
    }
    registerRuntimeHandlers({
      runtime: mockRuntime as never,
      runtimeHealth: mockRuntimeHealth as never,
    });
  });

  // ── Runtime Status ─────────────────────────────────────────────────────────

  describe('runtime:status', () => {
    it('returns available:false when runtime is unavailable', async () => {
      mockRuntime.isAvailable.mockResolvedValue(false);
      const result = await invoke(IPC.RUNTIME_STATUS);
      expect(mockRuntime.isAvailable).toHaveBeenCalledOnce();
      expect(result).toEqual({ available: false });
      expect(mockRuntime.getInfo).not.toHaveBeenCalled();
    });

    it('returns available:true with info when runtime is available', async () => {
      mockRuntime.isAvailable.mockResolvedValue(true);
      const info = {
        version: '27.0.0',
        containers: 5,
        images: 12,
        osType: 'linux',
        architecture: 'x86_64',
      };
      mockRuntime.getInfo.mockResolvedValue(info);
      const result = await invoke(IPC.RUNTIME_STATUS);
      expect(mockRuntime.isAvailable).toHaveBeenCalledOnce();
      expect(mockRuntime.getInfo).toHaveBeenCalledOnce();
      expect(result).toEqual({ available: true, info });
    });

    it('returns available:true without info if getInfo throws', async () => {
      mockRuntime.isAvailable.mockResolvedValue(true);
      mockRuntime.getInfo.mockRejectedValue(new Error('JSON parse error'));
      const result = await invoke(IPC.RUNTIME_STATUS);
      expect(result).toEqual({ available: true });
    });
  });

  // ── Image Operations ───────────────────────────────────────────────────────

  describe('runtime:pull-image', () => {
    it('pulls image and sends progress updates', async () => {
      mockRuntime.pullImage.mockImplementation(async (image: string, onProgress: (p: unknown) => void) => {
        if (onProgress) {
          onProgress({ status: 'Pulling', progress: '50%' });
          onProgress({ status: 'Downloaded', progress: '100%' });
        }
      });

      const result = await invoke(IPC.RUNTIME_PULL_IMAGE, 'ubuntu:latest');

      expect(mockRuntime.pullImage).toHaveBeenCalledWith(
        'ubuntu:latest',
        expect.any(Function),
      );
      expect(result).toEqual({ success: true });

      // Verify progress was sent to renderer
      expect(mockWebContentsSend).toHaveBeenCalledWith(IPC.RUNTIME_PULL_PROGRESS, {
        image: 'ubuntu:latest',
        progress: { status: 'Pulling', progress: '50%' },
      });
      expect(mockWebContentsSend).toHaveBeenCalledWith(IPC.RUNTIME_PULL_PROGRESS, {
        image: 'ubuntu:latest',
        progress: { status: 'Downloaded', progress: '100%' },
      });
    });
  });

  // ── Container Lifecycle ────────────────────────────────────────────────────

  describe('runtime:create-container', () => {
    it('passes opts to runtime.createContainer() and returns container ID', async () => {
      const opts = {
        image: 'ubuntu:latest',
        projectId: 'test-project',
        name: 'test-container',
        cmd: ['bash'],
      };
      mockRuntime.createContainer.mockResolvedValue('container-abc123');
      const result = await invoke(IPC.RUNTIME_CREATE_CONTAINER, opts);
      expect(mockRuntime.createContainer).toHaveBeenCalledWith(opts);
      expect(result).toBe('container-abc123');
    });
  });

  describe('runtime:start', () => {
    it('passes containerId to runtime.startContainer()', async () => {
      mockRuntime.startContainer.mockResolvedValue(undefined);
      await invoke(IPC.RUNTIME_START, 'container-xyz');
      expect(mockRuntime.startContainer).toHaveBeenCalledWith('container-xyz');
    });
  });

  describe('runtime:stop', () => {
    it('passes containerId to runtime.stopContainer()', async () => {
      mockRuntime.stopContainer.mockResolvedValue(undefined);
      await invoke(IPC.RUNTIME_STOP, 'container-xyz');
      expect(mockRuntime.stopContainer).toHaveBeenCalledWith('container-xyz', undefined);
    });

    it('passes timeout when provided', async () => {
      mockRuntime.stopContainer.mockResolvedValue(undefined);
      await invoke(IPC.RUNTIME_STOP, 'container-xyz', 30);
      expect(mockRuntime.stopContainer).toHaveBeenCalledWith('container-xyz', 30);
    });
  });

  describe('runtime:remove', () => {
    it('passes containerId to runtime.removeContainer()', async () => {
      mockRuntime.removeContainer.mockResolvedValue(undefined);
      await invoke(IPC.RUNTIME_REMOVE, 'container-xyz');
      expect(mockRuntime.removeContainer).toHaveBeenCalledWith('container-xyz', undefined);
    });

    it('passes force flag when provided', async () => {
      mockRuntime.removeContainer.mockResolvedValue(undefined);
      await invoke(IPC.RUNTIME_REMOVE, 'container-xyz', true);
      expect(mockRuntime.removeContainer).toHaveBeenCalledWith('container-xyz', true);
    });
  });

  describe('runtime:list-containers', () => {
    it('delegates to runtime.listContainers()', async () => {
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
      mockRuntime.listContainers.mockResolvedValue(containers);
      const result = await invoke(IPC.RUNTIME_LIST_CONTAINERS);
      expect(mockRuntime.listContainers).toHaveBeenCalledOnce();
      expect(result).toEqual(containers);
    });

    it('returns empty array when no containers', async () => {
      mockRuntime.listContainers.mockResolvedValue([]);
      const result = await invoke(IPC.RUNTIME_LIST_CONTAINERS);
      expect(result).toEqual([]);
    });
  });

  describe('runtime:container-status', () => {
    it('passes containerId to runtime.getContainerStatus()', async () => {
      const status = {
        id: 'abc123',
        state: 'running',
        status: 'Up 10 minutes',
        startedAt: '2026-02-18T10:00:00Z',
      };
      mockRuntime.getContainerStatus.mockResolvedValue(status);
      const result = await invoke(IPC.RUNTIME_CONTAINER_STATUS, 'abc123');
      expect(mockRuntime.getContainerStatus).toHaveBeenCalledWith('abc123');
      expect(result).toEqual(status);
    });
  });

  // ── Exec Command ───────────────────────────────────────────────────────────

  describe('runtime:exec', () => {
    it('passes containerId, cmd to runtime.execCommand()', async () => {
      const execResult = {
        exitCode: 0,
        stdout: 'Hello World',
        stderr: '',
      };
      mockRuntime.execCommand.mockResolvedValue(execResult);
      const result = await invoke(IPC.RUNTIME_EXEC, 'container-xyz', ['echo', 'Hello World']);
      expect(mockRuntime.execCommand).toHaveBeenCalledWith(
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
      mockRuntime.execCommand.mockResolvedValue(execResult);
      const result = await invoke(IPC.RUNTIME_EXEC, 'container-xyz', ['pwd'], opts);
      expect(mockRuntime.execCommand).toHaveBeenCalledWith('container-xyz', ['pwd'], opts);
      expect(result).toEqual(execResult);
    });
  });

  // ── Health Monitoring ──────────────────────────────────────────────────────

  describe('runtime health monitoring', () => {
    it('registers status change callback that broadcasts to all windows', async () => {
      // Verify onStatusChange was called during registration
      expect(mockRuntimeHealth.onStatusChange).toHaveBeenCalledOnce();
      expect(mockRuntimeHealth.onStatusChange).toHaveBeenCalledWith(expect.any(Function));

      // Get the callback that was registered
      const callback = mockRuntimeHealth.onStatusChange.mock.calls[0][0] as (v: boolean) => Promise<void>;

      // Simulate runtime becoming available — should include info
      const info = { version: '5.0.0', containers: 2, images: 4 };
      mockRuntime.getInfo.mockResolvedValue(info);
      await callback(true);

      expect(mockRuntime.getInfo).toHaveBeenCalledOnce();
      expect(mockBrowserWindow.getAllWindows).toHaveBeenCalled();
      expect(mockWebContentsSend).toHaveBeenCalledWith(IPC.RUNTIME_STATUS_CHANGED, true, info);

      // Test with disconnection — getInfo should not be called, info is undefined
      mockWebContentsSend.mockClear();
      mockRuntime.getInfo.mockClear();
      await callback(false);
      expect(mockRuntime.getInfo).not.toHaveBeenCalled();
      expect(mockWebContentsSend).toHaveBeenCalledWith(IPC.RUNTIME_STATUS_CHANGED, false, undefined);
    });

    it('sends available:true with undefined info if getInfo throws', async () => {
      const callback = mockRuntimeHealth.onStatusChange.mock.calls[0][0] as (v: boolean) => Promise<void>;
      mockRuntime.getInfo.mockRejectedValue(new Error('info failed'));
      await callback(true);
      expect(mockWebContentsSend).toHaveBeenCalledWith(IPC.RUNTIME_STATUS_CHANGED, true, undefined);
    });
  });

  // ── Channel registration ───────────────────────────────────────────────────

  describe('channel registration', () => {
    it('registers all expected channels', () => {
      const expected = [
        IPC.RUNTIME_STATUS,
        IPC.RUNTIME_PULL_IMAGE,
        IPC.RUNTIME_CREATE_CONTAINER,
        IPC.RUNTIME_START,
        IPC.RUNTIME_STOP,
        IPC.RUNTIME_REMOVE,
        IPC.RUNTIME_LIST_CONTAINERS,
        IPC.RUNTIME_CONTAINER_STATUS,
        IPC.RUNTIME_EXEC,
      ];
      for (const channel of expected) {
        expect(handlerRegistry[channel], `Missing handler for ${channel}`).toBeDefined();
      }
    });
  });
});
