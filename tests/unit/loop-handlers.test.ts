/**
 * Unit tests for src/main/ipc-handlers/loop-handlers.ts
 *
 * Verifies that registerLoopHandlers() correctly wires IPC channels to
 * LoopRunner and LoopScheduler methods. Each handler is extracted via the
 * mock ipcMain.handle registry, then called directly to confirm routing.
 *
 * Why we test routing: the IPC layer is the boundary between renderer and
 * main process. A mis-wired channel means the renderer silently gets undefined
 * or stale data. Unit tests here catch those regressions cheaply, without
 * needing a real Electron process.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../src/shared/ipc-channels';
import { LoopMode, LoopStatus } from '../../src/shared/loop-types';

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

import { registerLoopHandlers } from '../../src/main/ipc-handlers/loop-handlers';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fake IpcMainInvokeEvent for testing. */
const createFakeEvent = (): IpcMainInvokeEvent =>
  ({
    sender: {
      send: mockWebContentsSend,
    },
  }) as unknown as IpcMainInvokeEvent;

/** Call a registered handler as if invoked from the renderer. */
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlerRegistry[channel];
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  return handler(createFakeEvent(), ...args);
}

// ── Service mocks ─────────────────────────────────────────────────────────────

const mockLoopRunner = {
  startLoop: vi.fn(),
  stopLoop: vi.fn(),
  listAll: vi.fn(),
  getLoopState: vi.fn(),
  removeLoop: vi.fn(),
  onStateChange: vi.fn(),
  onLogLine: vi.fn(),
};

const mockScheduler = {
  scheduleLoop: vi.fn(),
  cancelSchedule: vi.fn(),
  listScheduled: vi.fn(),
};

const mockCleanupManager = {
  registerContainer: vi.fn(),
};

// ── Setup ─────────────────────────────────────────────────────────────────────

describe('registerLoopHandlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Clear registry between test suites
    for (const key of Object.keys(handlerRegistry)) {
      delete handlerRegistry[key];
    }
    registerLoopHandlers({
      loopRunner: mockLoopRunner as never,
      scheduler: mockScheduler as never,
      cleanupManager: mockCleanupManager as never,
    });
  });

  // ── Loop lifecycle tests ────────────────────────────────────────────────────

  describe('loop:start', () => {
    it('should route to loopRunner.startLoop() and register container with cleanup manager', async () => {
      const opts = {
        projectId: 'test-project',
        dockerImage: 'test-image',
        mode: LoopMode.SINGLE,
      };
      const expectedState = {
        projectId: 'test-project',
        containerId: 'abc123',
        mode: LoopMode.SINGLE,
        status: LoopStatus.RUNNING,
        iteration: 0,
        startedAt: new Date().toISOString(),
        stoppedAt: null,
        logs: [],
        commits: [],
        errors: 0,
        error: null,
      };

      mockLoopRunner.startLoop.mockResolvedValue(expectedState);

      const result = await invoke(IPC.LOOP_START, opts);

      expect(mockLoopRunner.startLoop).toHaveBeenCalledWith(opts);
      expect(mockCleanupManager.registerContainer).toHaveBeenCalledWith('abc123');
      expect(result).toEqual(expectedState);
    });

    it('should not register container if startLoop fails', async () => {
      const opts = {
        projectId: 'test-project',
        dockerImage: 'test-image',
        mode: LoopMode.SINGLE,
      };
      const failedState = {
        projectId: 'test-project',
        containerId: null,
        mode: LoopMode.SINGLE,
        status: LoopStatus.FAILED,
        iteration: 0,
        startedAt: new Date().toISOString(),
        stoppedAt: new Date().toISOString(),
        logs: [],
        commits: [],
        errors: 0,
        error: 'Failed to create container',
      };

      mockLoopRunner.startLoop.mockResolvedValue(failedState);

      const result = await invoke(IPC.LOOP_START, opts);

      expect(mockLoopRunner.startLoop).toHaveBeenCalledWith(opts);
      expect(mockCleanupManager.registerContainer).not.toHaveBeenCalled();
      expect(result).toEqual(failedState);
    });

    it('should handle cleanup manager not being provided', async () => {
      // Re-register without cleanup manager
      vi.resetAllMocks();
      for (const key of Object.keys(handlerRegistry)) {
        delete handlerRegistry[key];
      }
      registerLoopHandlers({
        loopRunner: mockLoopRunner as never,
        scheduler: mockScheduler as never,
        // cleanupManager intentionally omitted
      });

      const opts = {
        projectId: 'test-project',
        dockerImage: 'test-image',
        mode: LoopMode.SINGLE,
      };
      const expectedState = {
        projectId: 'test-project',
        containerId: 'abc123',
        mode: LoopMode.SINGLE,
        status: LoopStatus.RUNNING,
        iteration: 0,
        startedAt: new Date().toISOString(),
        stoppedAt: null,
        logs: [],
        commits: [],
        errors: 0,
        error: null,
      };

      mockLoopRunner.startLoop.mockResolvedValue(expectedState);

      const result = await invoke(IPC.LOOP_START, opts);

      expect(mockLoopRunner.startLoop).toHaveBeenCalledWith(opts);
      expect(mockCleanupManager.registerContainer).not.toHaveBeenCalled();
      expect(result).toEqual(expectedState);
    });
  });

  describe('loop:stop', () => {
    it('should route to loopRunner.stopLoop()', async () => {
      mockLoopRunner.stopLoop.mockResolvedValue(undefined);

      await invoke(IPC.LOOP_STOP, 'test-project');

      expect(mockLoopRunner.stopLoop).toHaveBeenCalledWith('test-project');
    });
  });

  describe('loop:list', () => {
    it('should route to loopRunner.listAll()', async () => {
      const mockStates = [
        {
          projectId: 'proj-1',
          containerId: 'abc',
          mode: LoopMode.CONTINUOUS,
          status: LoopStatus.RUNNING,
          iteration: 2,
          startedAt: new Date().toISOString(),
          stoppedAt: null,
          logs: [],
          commits: [],
          errors: 0,
          error: null,
        },
        {
          projectId: 'proj-2',
          containerId: null,
          mode: LoopMode.SINGLE,
          status: LoopStatus.FAILED,
          iteration: 0,
          startedAt: new Date().toISOString(),
          stoppedAt: new Date().toISOString(),
          logs: [],
          commits: [],
          errors: 5,
          error: 'Container failed to start',
        },
      ];

      mockLoopRunner.listAll.mockResolvedValue(mockStates);

      const result = await invoke(IPC.LOOP_LIST);

      expect(mockLoopRunner.listAll).toHaveBeenCalledWith();
      expect(result).toEqual(mockStates);
    });
  });

  describe('loop:get', () => {
    it('should route to loopRunner.getLoopState() and return state', async () => {
      const mockState = {
        projectId: 'test-project',
        containerId: 'abc123',
        mode: LoopMode.SINGLE,
        status: LoopStatus.COMPLETED,
        iteration: 1,
        startedAt: new Date().toISOString(),
        stoppedAt: new Date().toISOString(),
        logs: [],
        commits: ['a1b2c3d'],
        errors: 0,
        error: null,
      };

      mockLoopRunner.getLoopState.mockReturnValue(mockState);

      const result = await invoke(IPC.LOOP_GET, 'test-project');

      expect(mockLoopRunner.getLoopState).toHaveBeenCalledWith('test-project');
      expect(result).toEqual(mockState);
    });

    it('should return null if loop not found', async () => {
      mockLoopRunner.getLoopState.mockReturnValue(null);

      const result = await invoke(IPC.LOOP_GET, 'nonexistent');

      expect(mockLoopRunner.getLoopState).toHaveBeenCalledWith('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('loop:remove', () => {
    it('should route to loopRunner.removeLoop()', async () => {
      mockLoopRunner.removeLoop.mockResolvedValue(undefined);

      await invoke(IPC.LOOP_REMOVE, 'test-project');

      expect(mockLoopRunner.removeLoop).toHaveBeenCalledWith('test-project');
    });
  });

  // ── Scheduling tests ────────────────────────────────────────────────────────

  describe('loop:schedule', () => {
    it('should route to scheduler.scheduleLoop()', async () => {
      const projectId = 'test-project';
      const schedule = '*/5 minutes';
      const loopOpts = {
        projectId,
        dockerImage: 'test-image',
      };

      mockScheduler.scheduleLoop.mockReturnValue(undefined);

      await invoke(IPC.LOOP_SCHEDULE, projectId, schedule, loopOpts);

      expect(mockScheduler.scheduleLoop).toHaveBeenCalledWith(
        projectId,
        schedule,
        loopOpts,
      );
    });
  });

  describe('loop:cancel-schedule', () => {
    it('should route to scheduler.cancelSchedule()', async () => {
      mockScheduler.cancelSchedule.mockReturnValue(undefined);

      await invoke(IPC.LOOP_CANCEL_SCHEDULE, 'test-project');

      expect(mockScheduler.cancelSchedule).toHaveBeenCalledWith('test-project');
    });
  });

  describe('loop:list-scheduled', () => {
    it('should route to scheduler.listScheduled()', async () => {
      const mockScheduled = [
        {
          projectId: 'proj-1',
          schedule: {
            intervalMs: 300000,
            expression: '*/5 minutes',
          },
          loopOpts: {
            projectId: 'proj-1',
            dockerImage: 'test-image',
          },
          timerId: null,
          nextRun: new Date().toISOString(),
        },
      ];

      mockScheduler.listScheduled.mockReturnValue(mockScheduled);

      const result = await invoke(IPC.LOOP_LIST_SCHEDULED);

      expect(mockScheduler.listScheduled).toHaveBeenCalledWith();
      expect(result).toEqual(mockScheduled);
    });
  });

  // ── Event broadcasting tests ────────────────────────────────────────────────

  describe('event broadcasting', () => {
    it('should register onStateChange callback that broadcasts to all windows', () => {
      expect(mockLoopRunner.onStateChange).toHaveBeenCalledTimes(1);

      const callback = mockLoopRunner.onStateChange.mock.calls[0][0];
      const testState = {
        projectId: 'test-project',
        containerId: 'abc123',
        mode: LoopMode.SINGLE,
        status: LoopStatus.RUNNING,
        iteration: 1,
        startedAt: new Date().toISOString(),
        stoppedAt: null,
        logs: [],
        commits: [],
        errors: 0,
        error: null,
      };

      callback(testState);

      expect(mockBrowserWindow.getAllWindows).toHaveBeenCalled();
      expect(mockWebContentsSend).toHaveBeenCalledWith(
        IPC.LOOP_STATE_CHANGED,
        testState,
      );
    });

    it('should register onLogLine callback that broadcasts to all windows', () => {
      expect(mockLoopRunner.onLogLine).toHaveBeenCalledTimes(1);

      const callback = mockLoopRunner.onLogLine.mock.calls[0][0];
      const testLine = {
        type: 'commit' as const,
        content: 'commit abc123',
        metadata: { sha: 'abc123' },
      };

      callback('test-project', testLine);

      expect(mockBrowserWindow.getAllWindows).toHaveBeenCalled();
      expect(mockWebContentsSend).toHaveBeenCalledWith(
        IPC.LOOP_LOG_LINE,
        'test-project',
        testLine,
      );
    });
  });
});
