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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../src/shared/ipc-channels';
import { LoopMode, LoopStatus } from '../../src/shared/loop-types';
import type { Pipeline } from '../../src/shared/pipeline-types';

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
  listByProject: vi.fn().mockReturnValue([]),
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
    mockLoopRunner.listByProject.mockReturnValue([]);
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
      mockLoopRunner.listByProject.mockReturnValue([]);
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

      expect(mockLoopRunner.stopLoop).toHaveBeenCalledWith('test-project', undefined);
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

      expect(mockLoopRunner.getLoopState).toHaveBeenCalledWith('test-project', undefined);
      expect(result).toEqual(mockState);
    });

    it('should return null if loop not found', async () => {
      mockLoopRunner.getLoopState.mockReturnValue(null);

      const result = await invoke(IPC.LOOP_GET, 'nonexistent');

      expect(mockLoopRunner.getLoopState).toHaveBeenCalledWith('nonexistent', undefined);
      expect(result).toBeNull();
    });
  });

  describe('loop:remove', () => {
    it('should route to loopRunner.removeLoop()', async () => {
      mockLoopRunner.removeLoop.mockResolvedValue(undefined);

      await invoke(IPC.LOOP_REMOVE, 'test-project');

      expect(mockLoopRunner.removeLoop).toHaveBeenCalledWith('test-project', undefined);
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
      // Two onStateChange callbacks are registered: [0] for deploy-key cleanup, [1] for broadcasting
      expect(mockLoopRunner.onStateChange).toHaveBeenCalledTimes(2);

      const callback = mockLoopRunner.onStateChange.mock.calls[1][0];
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

    it('should register onLogLine callback that broadcasts to all windows', async () => {
      vi.useFakeTimers();
      expect(mockLoopRunner.onLogLine).toHaveBeenCalledTimes(1);

      const callback = mockLoopRunner.onLogLine.mock.calls[0][0];
      const testLine = {
        type: 'commit' as const,
        content: 'commit abc123',
        metadata: { sha: 'abc123' },
      };

      callback('test-project', testLine);

      // Log lines are batched and flushed after 250ms
      vi.advanceTimersByTime(250);

      expect(mockBrowserWindow.getAllWindows).toHaveBeenCalled();
      expect(mockWebContentsSend).toHaveBeenCalledWith(
        IPC.LOOP_LOG_LINE,
        'test-project',
        testLine,
      );

      vi.useRealTimers();
    });
  });
});

// ── factory:start tests ──────────────────────────────────────────────────────
//
// FACTORY_START is the entry point for the pipeline-driven coding factory
// (Phase 2.5). It must:
//   - reject when the project has no pipelineId (Phase 2.6 contract)
//   - load the pipeline, write PROMPT_<stageId>.md per stage
//   - spawn `stage.instances` containers per stage with role
//     `<stageId>-<instanceIndex>`, passing STAGE_ID/INSTANCE_INDEX env vars
//     and (in SINGLE mode) embedding both as loop-script args
//
// These behaviours are pinned here so a future refactor that "helpfully"
// reverts to the legacy roles-based fan-out, drops the env vars, or skips
// prompt-file emission fails fast on this suite.

const sampleStage = (id: string, instances = 1): Pipeline['stages'][number] => ({
  id,
  name: id,
  agentPrompt: `prompt for ${id}`,
  instances,
  icon: '🔧',
  color: '#000',
});

const samplePipeline = (overrides: Partial<Pipeline> = {}): Pipeline => ({
  id: 'pl-1',
  name: 'Test Pipeline',
  description: '',
  stages: [sampleStage('pm'), sampleStage('coder')],
  bounceLimit: 3,
  builtIn: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

const fakeRunningState = (projectId: string, role: string) => ({
  projectId,
  projectName: 'p',
  containerId: `cid-${role}`,
  mode: LoopMode.CONTINUOUS,
  status: LoopStatus.RUNNING,
  iteration: 0,
  startedAt: new Date().toISOString(),
  stoppedAt: null,
  logs: [],
  commits: [],
  errors: 0,
  error: null,
  role,
});

describe('factory:start', () => {
  let workspacePath: string;
  let mockProjectStore: { getProject: ReturnType<typeof vi.fn> };
  let mockPipelineStore: { getPipeline: ReturnType<typeof vi.fn> };

  const projectId = 'proj-1';

  beforeEach(() => {
    vi.resetAllMocks();
    mockLoopRunner.listByProject.mockReturnValue([]);
    for (const key of Object.keys(handlerRegistry)) {
      delete handlerRegistry[key];
    }

    workspacePath = fsSync.mkdtempSync(path.join(os.tmpdir(), 'zephyr-factory-test-'));

    mockProjectStore = {
      getProject: vi.fn().mockReturnValue({
        id: projectId,
        name: 'Demo Project',
        local_path: workspacePath,
        repo_url: '',
        docker_image: 'img',
        max_iterations: 10,
        loop_script: '',
        pre_validation_scripts: [],
        hooks: [],
        kiro_hooks: [],
        custom_prompts: {},
        spec_files: {},
        factory_config: { enabled: true, roles: [] },
        pipelineId: 'pl-1',
        feature_requests_content: '',
      }),
    };

    mockPipelineStore = {
      getPipeline: vi.fn().mockReturnValue(samplePipeline()),
    };

    registerLoopHandlers({
      loopRunner: mockLoopRunner as never,
      scheduler: mockScheduler as never,
      cleanupManager: mockCleanupManager as never,
      projectStore: mockProjectStore as never,
      pipelineStore: mockPipelineStore as never,
    });
  });

  afterEach(() => {
    fsSync.rmSync(workspacePath, { recursive: true, force: true });
  });

  it('rejects when the project does not exist', async () => {
    mockProjectStore.getProject.mockReturnValueOnce(null);
    await expect(
      invoke(IPC.FACTORY_START, projectId, { mode: LoopMode.CONTINUOUS, dockerImage: 'img', projectId, projectName: 'p' }),
    ).rejects.toThrow(/not found/);
    expect(mockLoopRunner.startLoop).not.toHaveBeenCalled();
  });

  it('rejects when factory_config is not enabled', async () => {
    mockProjectStore.getProject.mockReturnValueOnce({
      ...mockProjectStore.getProject(projectId),
      factory_config: { enabled: false, roles: [] },
    });
    await expect(
      invoke(IPC.FACTORY_START, projectId, { mode: LoopMode.CONTINUOUS, dockerImage: 'img', projectId, projectName: 'p' }),
    ).rejects.toThrow(/Factory mode is not enabled/);
    expect(mockLoopRunner.startLoop).not.toHaveBeenCalled();
  });

  it('rejects when the project has no pipelineId (Phase 2.6 contract)', async () => {
    mockProjectStore.getProject.mockReturnValueOnce({
      ...mockProjectStore.getProject(projectId),
      pipelineId: undefined,
    });
    await expect(
      invoke(IPC.FACTORY_START, projectId, { mode: LoopMode.CONTINUOUS, dockerImage: 'img', projectId, projectName: 'p' }),
    ).rejects.toThrow(/No pipeline assigned/);
    expect(mockLoopRunner.startLoop).not.toHaveBeenCalled();
  });

  it('rejects when the referenced pipeline cannot be found', async () => {
    mockPipelineStore.getPipeline.mockReturnValueOnce(null);
    await expect(
      invoke(IPC.FACTORY_START, projectId, { mode: LoopMode.CONTINUOUS, dockerImage: 'img', projectId, projectName: 'p' }),
    ).rejects.toThrow(/Pipeline pl-1 not found/);
    expect(mockLoopRunner.startLoop).not.toHaveBeenCalled();
  });

  it('rejects when the pipeline has no stages', async () => {
    mockPipelineStore.getPipeline.mockReturnValueOnce(samplePipeline({ stages: [] }));
    await expect(
      invoke(IPC.FACTORY_START, projectId, { mode: LoopMode.CONTINUOUS, dockerImage: 'img', projectId, projectName: 'p' }),
    ).rejects.toThrow(/has no stages/);
    expect(mockLoopRunner.startLoop).not.toHaveBeenCalled();
  });

  it('writes PROMPT_<stageId>.md to local_path for every stage', async () => {
    mockLoopRunner.startLoop.mockImplementation((opts: { role?: string; projectId: string }) =>
      Promise.resolve(fakeRunningState(opts.projectId, opts.role ?? '')),
    );

    await invoke(IPC.FACTORY_START, projectId, { mode: LoopMode.CONTINUOUS, dockerImage: 'img', projectId, projectName: 'Demo Project' });

    const pmPrompt = fsSync.readFileSync(path.join(workspacePath, 'PROMPT_pm.md'), 'utf-8');
    const coderPrompt = fsSync.readFileSync(path.join(workspacePath, 'PROMPT_coder.md'), 'utf-8');
    expect(pmPrompt).toBe('prompt for pm');
    expect(coderPrompt).toBe('prompt for coder');
  });

  it('spawns one container per stage with role "<stageId>-0" when instances=1', async () => {
    mockLoopRunner.startLoop.mockImplementation((opts: { role?: string; projectId: string }) =>
      Promise.resolve(fakeRunningState(opts.projectId, opts.role ?? '')),
    );

    const result = await invoke(IPC.FACTORY_START, projectId, {
      mode: LoopMode.CONTINUOUS,
      dockerImage: 'img',
      projectId,
      projectName: 'Demo Project',
    }) as Array<{ role?: string }>;

    expect(mockLoopRunner.startLoop).toHaveBeenCalledTimes(2);
    const roles = mockLoopRunner.startLoop.mock.calls.map((c) => c[0].role);
    expect(roles).toEqual(['pm-0', 'coder-0']);
    expect(result.map((r) => r.role)).toEqual(['pm-0', 'coder-0']);
  });

  it('spawns N containers when stage.instances > 1, with sequential instanceIndex', async () => {
    mockPipelineStore.getPipeline.mockReturnValueOnce(
      samplePipeline({ stages: [sampleStage('pm'), sampleStage('coder', 3)] }),
    );
    mockLoopRunner.startLoop.mockImplementation((opts: { role?: string; projectId: string }) =>
      Promise.resolve(fakeRunningState(opts.projectId, opts.role ?? '')),
    );

    await invoke(IPC.FACTORY_START, projectId, {
      mode: LoopMode.CONTINUOUS,
      dockerImage: 'img',
      projectId,
      projectName: 'Demo Project',
    });

    const roles = mockLoopRunner.startLoop.mock.calls.map((c) => c[0].role);
    expect(roles).toEqual(['pm-0', 'coder-0', 'coder-1', 'coder-2']);
  });

  it('passes STAGE_ID and INSTANCE_INDEX env vars to each container', async () => {
    mockPipelineStore.getPipeline.mockReturnValueOnce(
      samplePipeline({ stages: [sampleStage('coder', 2)] }),
    );
    mockLoopRunner.startLoop.mockImplementation((opts: { role?: string; projectId: string }) =>
      Promise.resolve(fakeRunningState(opts.projectId, opts.role ?? '')),
    );

    await invoke(IPC.FACTORY_START, projectId, {
      mode: LoopMode.CONTINUOUS,
      dockerImage: 'img',
      projectId,
      projectName: 'Demo Project',
      envVars: { EXISTING: 'value' },
    });

    const calls = mockLoopRunner.startLoop.mock.calls.map((c) => c[0].envVars);
    // existing env vars are preserved alongside the per-stage additions
    expect(calls[0]).toMatchObject({ EXISTING: 'value', STAGE_ID: 'coder', INSTANCE_INDEX: '0' });
    expect(calls[1]).toMatchObject({ EXISTING: 'value', STAGE_ID: 'coder', INSTANCE_INDEX: '1' });
  });

  it('builds a SINGLE-mode CMD that reads PROMPT_<stageId>.md when no loop_script is configured', async () => {
    mockLoopRunner.startLoop.mockImplementation((opts: { role?: string; projectId: string }) =>
      Promise.resolve(fakeRunningState(opts.projectId, opts.role ?? '')),
    );

    await invoke(IPC.FACTORY_START, projectId, {
      mode: LoopMode.SINGLE,
      dockerImage: 'img',
      projectId,
      projectName: 'Demo Project',
    });

    const cmds = mockLoopRunner.startLoop.mock.calls.map((c) => c[0].cmd);
    expect(cmds[0]).toEqual([
      'bash',
      '-c',
      expect.stringContaining('cat /workspace/PROMPT_pm.md'),
    ]);
    expect(cmds[1]).toEqual([
      'bash',
      '-c',
      expect.stringContaining('cat /workspace/PROMPT_coder.md'),
    ]);
  });

  it('builds a SINGLE-mode CMD that calls the loop_script with stageId + instanceIndex args', async () => {
    mockProjectStore.getProject.mockReturnValue({
      ...mockProjectStore.getProject(projectId),
      loop_script: 'run.sh',
    });
    mockPipelineStore.getPipeline.mockReturnValueOnce(
      samplePipeline({ stages: [sampleStage('coder', 2)] }),
    );
    mockLoopRunner.startLoop.mockImplementation((opts: { role?: string; projectId: string }) =>
      Promise.resolve(fakeRunningState(opts.projectId, opts.role ?? '')),
    );

    await invoke(IPC.FACTORY_START, projectId, {
      mode: LoopMode.SINGLE,
      dockerImage: 'img',
      projectId,
      projectName: 'Demo Project',
    });

    const cmds = mockLoopRunner.startLoop.mock.calls.map((c) => c[0].cmd);
    expect(cmds[0][2]).toContain('./run.sh coder 0 ');
    expect(cmds[1][2]).toContain('./run.sh coder 1 ');
  });

  it('does not set cmd in CONTINUOUS mode (the image default CMD runs)', async () => {
    mockLoopRunner.startLoop.mockImplementation((opts: { role?: string; projectId: string }) =>
      Promise.resolve(fakeRunningState(opts.projectId, opts.role ?? '')),
    );

    await invoke(IPC.FACTORY_START, projectId, {
      mode: LoopMode.CONTINUOUS,
      dockerImage: 'img',
      projectId,
      projectName: 'Demo Project',
    });

    for (const call of mockLoopRunner.startLoop.mock.calls) {
      expect(call[0].cmd).toBeUndefined();
    }
  });

  it('continues spawning remaining stages when one stage start fails', async () => {
    let callCount = 0;
    mockLoopRunner.startLoop.mockImplementation((opts: { role?: string; projectId: string }) => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('boom');
      }
      return Promise.resolve(fakeRunningState(opts.projectId, opts.role ?? ''));
    });

    const result = await invoke(IPC.FACTORY_START, projectId, {
      mode: LoopMode.CONTINUOUS,
      dockerImage: 'img',
      projectId,
      projectName: 'Demo Project',
    }) as unknown[];

    expect(mockLoopRunner.startLoop).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1); // first failed; second succeeded
  });
});

// ── factory:stop tests (Phase 2.12) ──────────────────────────────────────────
//
// FACTORY_STOP must stop all active container loops for a project AND then
// clear the `lockedBy` field on every task that currently holds a lock.
// Containers are gone after stop, so stale locks would leave the kanban
// permanently showing locked indicators — clearing them here is the canonical
// cleanup path.
//
// Why test lock-clearing separately: the container-stop logic is already
// exercised by LoopRunner unit tests. These tests pin the NEW invariant —
// that lock state is also cleaned up — which is the entire point of 2.12.
// Without this, a future refactor that moves or removes the unlock loop
// would silently leave tasks locked after FACTORY_STOP.

describe('factory:stop', () => {
  const projectId = 'proj-1';

  const makeLockedTask = (id: string) => ({
    id,
    title: `Task ${id}`,
    description: '',
    column: 'coder',
    bounceCount: 0,
    lockedBy: `agent-${id}`,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  });

  const makeUnlockedTask = (id: string) => ({
    id,
    title: `Task ${id}`,
    description: '',
    column: 'pm',
    bounceCount: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  });

  let mockFactoryTaskStore: {
    getQueue: ReturnType<typeof vi.fn>;
    unlockTask: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockLoopRunner.listByProject.mockReturnValue([]);
    for (const key of Object.keys(handlerRegistry)) {
      delete handlerRegistry[key];
    }

    mockFactoryTaskStore = {
      getQueue: vi.fn().mockReturnValue({ projectId, tasks: [] }),
      unlockTask: vi.fn(),
    };

    registerLoopHandlers({
      loopRunner: mockLoopRunner as never,
      scheduler: mockScheduler as never,
      factoryTaskStore: mockFactoryTaskStore as never,
    });
  });

  it('clears lockedBy for all locked tasks after containers stop', async () => {
    mockLoopRunner.listByProject.mockReturnValue([fakeRunningState(projectId, 'coder-0')]);
    mockLoopRunner.stopLoop.mockResolvedValue(undefined);
    mockFactoryTaskStore.getQueue.mockReturnValue({
      projectId,
      tasks: [makeLockedTask('t-1'), makeLockedTask('t-2')],
    });

    await invoke(IPC.FACTORY_STOP, projectId);

    expect(mockFactoryTaskStore.unlockTask).toHaveBeenCalledWith(projectId, 't-1');
    expect(mockFactoryTaskStore.unlockTask).toHaveBeenCalledWith(projectId, 't-2');
  });

  it('does not call unlockTask for tasks that have no lock', async () => {
    mockFactoryTaskStore.getQueue.mockReturnValue({
      projectId,
      tasks: [makeUnlockedTask('t-1')],
    });

    await invoke(IPC.FACTORY_STOP, projectId);

    expect(mockFactoryTaskStore.unlockTask).not.toHaveBeenCalled();
  });

  it('clears locks even when some container stops fail', async () => {
    mockLoopRunner.listByProject.mockReturnValue([fakeRunningState(projectId, 'coder-0')]);
    mockLoopRunner.stopLoop.mockRejectedValue(new Error('container timeout'));
    mockFactoryTaskStore.getQueue.mockReturnValue({
      projectId,
      tasks: [makeLockedTask('t-1')],
    });

    // The container stop error propagates, but lock clearing still ran first
    await expect(invoke(IPC.FACTORY_STOP, projectId)).rejects.toThrow('container timeout');
    expect(mockFactoryTaskStore.unlockTask).toHaveBeenCalledWith(projectId, 't-1');
  });

  it('is a no-op for locks when factoryTaskStore is not injected', async () => {
    for (const key of Object.keys(handlerRegistry)) {
      delete handlerRegistry[key];
    }
    registerLoopHandlers({
      loopRunner: mockLoopRunner as never,
      scheduler: mockScheduler as never,
      // factoryTaskStore intentionally omitted
    });

    await expect(invoke(IPC.FACTORY_STOP, projectId)).resolves.toBeUndefined();
    expect(mockFactoryTaskStore.unlockTask).not.toHaveBeenCalled();
  });

  it('swallows per-task unlock errors and continues to the next task', async () => {
    mockFactoryTaskStore.getQueue.mockReturnValue({
      projectId,
      tasks: [makeLockedTask('t-1'), makeLockedTask('t-2')],
    });
    mockFactoryTaskStore.unlockTask
      .mockImplementationOnce(() => { throw new Error('unlock failed'); })
      .mockReturnValue(undefined);

    await expect(invoke(IPC.FACTORY_STOP, projectId)).resolves.toBeUndefined();
    expect(mockFactoryTaskStore.unlockTask).toHaveBeenCalledTimes(2);
  });

  it('stops all active loops for the project', async () => {
    mockLoopRunner.listByProject.mockReturnValue([
      fakeRunningState(projectId, 'pm-0'),
      fakeRunningState(projectId, 'coder-0'),
    ]);
    mockLoopRunner.stopLoop.mockResolvedValue(undefined);

    await invoke(IPC.FACTORY_STOP, projectId);

    expect(mockLoopRunner.stopLoop).toHaveBeenCalledTimes(2);
  });
});

// ── processTaskStatusUpdate tests (Phase 2.7) ───────────────────────────────
//
// processTaskStatusUpdate is the dispatch core of the @task-status.json
// watcher. It reads the agent-written payload, looks up the task by id (NOT
// title — the legacy title-match path is gone, see cross-cutting risk #2),
// and routes one of four lifecycle events through FactoryTaskStore:
//
//   forward  — derive next column from pipeline order, call moveTask
//   rejected — pass toStage verbatim to moveTask (which validates + bounces)
//   locked   — call lockTask with the agent-supplied lockId
//   unlocked — call unlockTask
//
// Why test the function directly: the watcher closure is wrapped inside
// loopRunner.onStateChange and only fires on fs events, which makes
// integration testing slow and brittle. The function is the seam — pinning
// it here gives us full coverage of the dispatch logic without spinning up
// real fs watchers, and the watcher closure is small enough (parse JSON,
// call function, broadcast on true) that visual review covers it.
//
// Errors are deliberately swallowed (logged + return false) rather than
// thrown: agents may write malformed JSON, an unknown taskId, or an invalid
// transition; none of those should crash the host or kill the watcher.

import { processTaskStatusUpdate } from '../../src/main/ipc-handlers/loop-handlers';
import type { TaskStatusUpdate, TaskStatusUpdateDeps } from '../../src/main/ipc-handlers/loop-handlers';
import type { FactoryTask } from '../../src/shared/factory-types';

describe('processTaskStatusUpdate', () => {
  const projectId = 'proj-1';

  const sampleTask = (overrides: Partial<FactoryTask> = {}): FactoryTask => ({
    id: 'task-1',
    title: 'Implement login',
    description: '',
    column: 'pm',
    bounceCount: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  });

  let mockStore: {
    getTask: ReturnType<typeof vi.fn>;
    getQueue: ReturnType<typeof vi.fn>;
    moveTask: ReturnType<typeof vi.fn>;
    lockTask: ReturnType<typeof vi.fn>;
    unlockTask: ReturnType<typeof vi.fn>;
  };
  let mockProjectStore: { getProject: ReturnType<typeof vi.fn> };
  let mockPipelineStore: { getPipeline: ReturnType<typeof vi.fn> };

  const buildDeps = (): TaskStatusUpdateDeps => ({
    factoryTaskStore: mockStore as never,
    projectStore: mockProjectStore as never,
    pipelineStore: mockPipelineStore as never,
  });

  beforeEach(() => {
    mockStore = {
      getTask: vi.fn().mockReturnValue(sampleTask()),
      getQueue: vi.fn(),
      // Default: non-blocked return so handover tests don't fire unexpectedly.
      moveTask: vi.fn().mockReturnValue(sampleTask({ column: 'pm' })),
      lockTask: vi.fn(),
      unlockTask: vi.fn(),
    };
    mockProjectStore = {
      getProject: vi.fn().mockReturnValue({
        id: projectId,
        pipelineId: 'pl-1',
        local_path: '/tmp/test-workspace',
      }),
    };
    mockPipelineStore = {
      getPipeline: vi.fn().mockReturnValue(samplePipeline()),
    };
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it('returns false when payload is null', () => {
    expect(processTaskStatusUpdate(projectId, null, buildDeps())).toBe(false);
    expect(mockStore.getTask).not.toHaveBeenCalled();
  });

  it('returns false when payload is not an object', () => {
    expect(processTaskStatusUpdate(projectId, 'oops', buildDeps())).toBe(false);
    expect(mockStore.getTask).not.toHaveBeenCalled();
  });

  it('returns false when taskId is missing', () => {
    const payload: Partial<TaskStatusUpdate> = { status: 'forward' };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.getTask).not.toHaveBeenCalled();
  });

  it('returns false when status is missing', () => {
    const payload: Partial<TaskStatusUpdate> = { taskId: 'task-1' };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(false);
    // Must look up the task before checking status — wait, actually the
    // current implementation checks status before the task lookup. Pin that
    // ordering: cheap validation first, expensive store call second.
    expect(mockStore.getTask).not.toHaveBeenCalled();
  });

  it('returns false when the taskId does not exist', () => {
    mockStore.getTask.mockReturnValueOnce(null);
    const payload: TaskStatusUpdate = { taskId: 'ghost', status: 'forward' };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.moveTask).not.toHaveBeenCalled();
    expect(mockStore.lockTask).not.toHaveBeenCalled();
    expect(mockStore.unlockTask).not.toHaveBeenCalled();
  });

  it('returns false on unknown status values', () => {
    const payload = { taskId: 'task-1', status: 'finished' } as unknown as TaskStatusUpdate;
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.moveTask).not.toHaveBeenCalled();
  });

  // ── Forward ───────────────────────────────────────────────────────────────

  it('forward: advances task to the next column derived from pipeline order', () => {
    // Default sampleTask is on `pm`; samplePipeline has stages [pm, coder].
    // forward[pm] = 'coder'.
    const payload: TaskStatusUpdate = { taskId: 'task-1', status: 'forward' };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(true);
    expect(mockStore.moveTask).toHaveBeenCalledWith(projectId, 'task-1', 'coder');
  });

  it('forward: returns false at terminal column (done) without calling moveTask', () => {
    mockStore.getTask.mockReturnValueOnce(sampleTask({ column: 'done' }));
    const payload: TaskStatusUpdate = { taskId: 'task-1', status: 'forward' };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.moveTask).not.toHaveBeenCalled();
  });

  it('forward: returns false from blocked column (terminal in deriveTransitions)', () => {
    // Blocked has forward[blocked] = null per deriveTransitions; PM moves
    // tasks out of Blocked manually via the kanban.
    mockStore.getTask.mockReturnValueOnce(sampleTask({ column: 'blocked' }));
    const payload: TaskStatusUpdate = { taskId: 'task-1', status: 'forward' };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.moveTask).not.toHaveBeenCalled();
  });

  it('forward: returns false when project has no pipelineId', () => {
    mockProjectStore.getProject.mockReturnValueOnce({ id: projectId });
    const payload: TaskStatusUpdate = { taskId: 'task-1', status: 'forward' };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.moveTask).not.toHaveBeenCalled();
  });

  it('forward: returns false when the pipeline cannot be resolved', () => {
    mockPipelineStore.getPipeline.mockReturnValueOnce(null);
    const payload: TaskStatusUpdate = { taskId: 'task-1', status: 'forward' };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.moveTask).not.toHaveBeenCalled();
  });

  it('forward: returns false when projectStore is omitted from deps', () => {
    // Without projectStore we cannot resolve the pipeline; refuse rather
    // than fall through to a default. Pinning this prevents a future
    // construction site from forgetting to wire the dep.
    const payload: TaskStatusUpdate = { taskId: 'task-1', status: 'forward' };
    const deps: TaskStatusUpdateDeps = { factoryTaskStore: mockStore as never };
    expect(processTaskStatusUpdate(projectId, payload, deps)).toBe(false);
    expect(mockStore.moveTask).not.toHaveBeenCalled();
  });

  // ── Rejected ──────────────────────────────────────────────────────────────

  it('rejected: passes toStage verbatim to moveTask (which handles bounce + blocked)', () => {
    // The bounce-count increment + Phase 2.4 blocked redirect live inside
    // moveTask itself; processTaskStatusUpdate trusts the store and only
    // verifies the call shape here. Logic-level coverage is in
    // factory-task-store.test.ts.
    mockStore.getTask.mockReturnValueOnce(sampleTask({ column: 'coder' }));
    const payload: TaskStatusUpdate = {
      taskId: 'task-1',
      status: 'rejected',
      fromStage: 'coder',
      toStage: 'pm',
    };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(true);
    expect(mockStore.moveTask).toHaveBeenCalledWith(projectId, 'task-1', 'pm');
  });

  it('rejected: returns false when toStage is missing', () => {
    const payload: TaskStatusUpdate = {
      taskId: 'task-1',
      status: 'rejected',
      fromStage: 'coder',
    };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.moveTask).not.toHaveBeenCalled();
  });

  it('rejected: returns false when moveTask throws (e.g. invalid transition)', () => {
    // Non-adjacent backward (qa → pm, skipping coder) is rejected by
    // deriveTransitions. The function must not propagate the throw — agents
    // can write nonsense and the watcher must keep working for the next
    // legitimate write.
    mockStore.moveTask.mockImplementation(() => {
      throw new Error('Invalid transition');
    });
    const payload: TaskStatusUpdate = {
      taskId: 'task-1',
      status: 'rejected',
      toStage: 'pm',
    };
    let result: boolean | undefined;
    expect(() => {
      result = processTaskStatusUpdate(projectId, payload, buildDeps());
    }).not.toThrow();
    expect(result).toBe(false);
  });

  // ── Blocked escalation handover (Phase 2.10) ──────────────────────────────
  //
  // When moveTask redirects a task to 'blocked' due to bounce limit (Phase 2.4
  // gate), the host writes team/handovers/<taskId>-host-to-pm.md so the PM
  // agent can escalate to a human without a separate IPC round-trip.
  //
  // Tests use a real temp directory (matching the factory:start test pattern)
  // to exercise the actual fs write — no module-level mocks needed and the
  // atomic write semantics are verified end-to-end.
  //
  // The guard `data.toStage !== 'blocked'` distinguishes host redirect (agent
  // asked for an earlier stage but was overridden) from an explicit agent
  // escalation (agent requested 'blocked' directly).

  it('rejected: writes blocked escalation handover when moveTask redirects to blocked', () => {
    const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'handover-test-'));
    try {
      mockProjectStore.getProject.mockReturnValueOnce({
        id: projectId,
        pipelineId: 'pl-1',
        local_path: tmpDir,
      });
      const blockedTask = sampleTask({ column: 'blocked', bounceCount: 3 });
      mockStore.moveTask.mockReturnValueOnce(blockedTask);

      const payload: TaskStatusUpdate = { taskId: 'task-1', status: 'rejected', toStage: 'pm' };
      const result = processTaskStatusUpdate(projectId, payload, buildDeps());

      expect(result).toBe(true);
      const handoverPath = path.join(tmpDir, 'team', 'handovers', 'task-1-host-to-pm.md');
      expect(fsSync.existsSync(handoverPath)).toBe(true);
    } finally {
      fsSync.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejected: handover content includes task title, bounce count, and bounce limit', () => {
    const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'handover-test-'));
    try {
      mockProjectStore.getProject.mockReturnValueOnce({
        id: projectId,
        pipelineId: 'pl-1',
        local_path: tmpDir,
      });
      const blockedTask = sampleTask({ column: 'blocked', bounceCount: 3, title: 'Fix auth bug' });
      mockStore.moveTask.mockReturnValueOnce(blockedTask);

      const payload: TaskStatusUpdate = { taskId: 'task-1', status: 'rejected', toStage: 'pm' };
      processTaskStatusUpdate(projectId, payload, buildDeps());

      const content = fsSync.readFileSync(
        path.join(tmpDir, 'team', 'handovers', 'task-1-host-to-pm.md'),
        'utf8',
      );
      expect(content).toContain('Fix auth bug');
      expect(content).toContain('3'); // bounceCount and bounceLimit
      expect(content).toContain('@human_clarification.md');
      // Requested stage name should appear (pipeline has a 'pm' stage)
      expect(content).toContain('pm');
    } finally {
      fsSync.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejected: does not write handover when toStage is already blocked (agent-initiated escalation)', () => {
    // Agent explicitly requested 'blocked' — this is an agent escalation, not
    // a host bounce-limit redirect. No handover should be written.
    const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'handover-test-'));
    try {
      mockProjectStore.getProject.mockReturnValueOnce({
        id: projectId,
        pipelineId: 'pl-1',
        local_path: tmpDir,
      });
      const blockedTask = sampleTask({ column: 'blocked', bounceCount: 1 });
      mockStore.moveTask.mockReturnValueOnce(blockedTask);

      const payload: TaskStatusUpdate = { taskId: 'task-1', status: 'rejected', toStage: 'blocked' };
      const result = processTaskStatusUpdate(projectId, payload, buildDeps());

      expect(result).toBe(true);
      const handoverDir = path.join(tmpDir, 'team', 'handovers');
      // Directory should not have been created at all (no file write attempted)
      expect(fsSync.existsSync(handoverDir)).toBe(false);
    } finally {
      fsSync.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejected: skips handover (but still returns true) when projectStore is absent', () => {
    const blockedTask = sampleTask({ column: 'blocked', bounceCount: 3 });
    mockStore.moveTask.mockReturnValueOnce(blockedTask);

    const payload: TaskStatusUpdate = { taskId: 'task-1', status: 'rejected', toStage: 'pm' };
    const deps: TaskStatusUpdateDeps = { factoryTaskStore: mockStore as never };
    // No temp dir needed — if the handover code runs it will throw trying to
    // resolve project.local_path from an absent store. The test passes only
    // when the guard short-circuits before any fs access.
    expect(processTaskStatusUpdate(projectId, payload, deps)).toBe(true);
  });

  it('rejected: skips handover (but still returns true) when project has no local_path', () => {
    const blockedTask = sampleTask({ column: 'blocked', bounceCount: 3 });
    mockStore.moveTask.mockReturnValueOnce(blockedTask);
    // Project exists but has no local_path (e.g. remote-only project).
    mockProjectStore.getProject.mockReturnValueOnce({ id: projectId, pipelineId: 'pl-1' });

    const payload: TaskStatusUpdate = { taskId: 'task-1', status: 'rejected', toStage: 'pm' };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(true);
    // If the code tried to write to undefined/null path it would throw; the
    // test passing without error confirms the guard fired correctly.
  });

  // ── Locked ────────────────────────────────────────────────────────────────

  it('locked: calls lockTask with the agent-supplied lockId', () => {
    const payload: TaskStatusUpdate = {
      taskId: 'task-1',
      status: 'locked',
      lockId: 'coder-0',
    };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(true);
    expect(mockStore.lockTask).toHaveBeenCalledWith(projectId, 'task-1', 'coder-0');
  });

  it('locked: returns false when lockId is missing', () => {
    const payload: TaskStatusUpdate = { taskId: 'task-1', status: 'locked' };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.lockTask).not.toHaveBeenCalled();
  });

  it('locked: returns false when lockTask throws (already held by another owner)', () => {
    mockStore.lockTask.mockImplementationOnce(() => {
      throw new Error('Task already locked by coder-1');
    });
    const payload: TaskStatusUpdate = {
      taskId: 'task-1',
      status: 'locked',
      lockId: 'coder-0',
    };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(false);
  });

  // ── Unlocked ──────────────────────────────────────────────────────────────

  it('unlocked: calls unlockTask', () => {
    const payload: TaskStatusUpdate = { taskId: 'task-1', status: 'unlocked' };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(true);
    expect(mockStore.unlockTask).toHaveBeenCalledWith(projectId, 'task-1');
  });

  it('unlocked: succeeds even when the task is already unlocked (store is idempotent)', () => {
    // unlockTask itself is idempotent — no throw on already-unlocked task —
    // so the dispatcher returning true here is correct (the broadcast is a
    // cheap no-op for renderer state that's already in sync).
    const payload: TaskStatusUpdate = { taskId: 'task-1', status: 'unlocked' };
    expect(processTaskStatusUpdate(projectId, payload, buildDeps())).toBe(true);
    expect(mockStore.unlockTask).toHaveBeenCalledTimes(1);
  });
});

// ── processTaskDecomposition tests (Phase 2.8) ──────────────────────────────
//
// processTaskDecomposition is the dispatch core of the @task-decomposition.json
// watcher. The PM agent writes a payload of shape:
//
//   { action: "decompose", parentTaskId, tasks: [{title, description}, ...] }
//
// and the host:
//   1. resolves the project's pipeline → first stage column
//   2. atomically creates one sub-task per `tasks` entry in that column,
//      each with `parentTaskId` set
//   3. flips the parent's `isEpic` flag to true (parent stays in Backlog)
//
// On success the watcher deletes the source file (canonical "pending"
// signal — a separate processed-id ledger would be redundant). The
// dispatcher returns `true` so the watcher knows to delete and broadcast.
//
// Errors return `false` so the file stays on disk and the next legitimate
// trigger can retry. Same swallow-and-log philosophy as
// processTaskStatusUpdate: agents writing nonsense must not crash the host
// or stop the watcher.

import {
  processTaskDecomposition,
} from '../../src/main/ipc-handlers/loop-handlers';
import type {
  TaskDecomposition,
  TaskDecompositionDeps,
} from '../../src/main/ipc-handlers/loop-handlers';

describe('processTaskDecomposition', () => {
  const projectId = 'proj-1';

  const sampleEpic = (overrides: Partial<FactoryTask> = {}): FactoryTask => ({
    id: 'epic-1',
    title: 'Build login flow',
    description: 'High-level feature',
    column: 'backlog',
    bounceCount: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  });

  let mockStore: {
    getTask: ReturnType<typeof vi.fn>;
    decomposeTask: ReturnType<typeof vi.fn>;
  };
  let mockProjectStore: { getProject: ReturnType<typeof vi.fn> };
  let mockPipelineStore: { getPipeline: ReturnType<typeof vi.fn> };

  const buildDeps = (): TaskDecompositionDeps => ({
    factoryTaskStore: mockStore as never,
    projectStore: mockProjectStore as never,
    pipelineStore: mockPipelineStore as never,
  });

  const validPayload = (overrides: Partial<TaskDecomposition> = {}): TaskDecomposition => ({
    action: 'decompose',
    parentTaskId: 'epic-1',
    tasks: [
      { title: 'Login form', description: 'UI work' },
      { title: 'Auth API', description: 'Backend' },
    ],
    ...overrides,
  });

  beforeEach(() => {
    mockStore = {
      getTask: vi.fn().mockReturnValue(sampleEpic()),
      decomposeTask: vi.fn().mockReturnValue({
        parent: sampleEpic({ isEpic: true }),
        children: [],
      }),
    };
    mockProjectStore = {
      getProject: vi.fn().mockReturnValue({ id: projectId, pipelineId: 'pl-1' }),
    };
    mockPipelineStore = {
      getPipeline: vi.fn().mockReturnValue(samplePipeline()),
    };
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it('returns false when payload is null', () => {
    expect(processTaskDecomposition(projectId, null, buildDeps())).toBe(false);
    expect(mockStore.decomposeTask).not.toHaveBeenCalled();
  });

  it('returns false when payload is not an object', () => {
    expect(processTaskDecomposition(projectId, 'oops', buildDeps())).toBe(false);
    expect(mockStore.decomposeTask).not.toHaveBeenCalled();
  });

  it('returns false when action is missing', () => {
    const payload = { parentTaskId: 'epic-1', tasks: [] } as unknown as TaskDecomposition;
    expect(processTaskDecomposition(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.decomposeTask).not.toHaveBeenCalled();
  });

  it('returns false when action is not "decompose"', () => {
    // Pinning the discriminator means a future schema extension (e.g.
    // `action: "merge"`) doesn't accidentally route through the decompose
    // path with garbage fields.
    const payload = {
      action: 'merge',
      parentTaskId: 'epic-1',
      tasks: [{ title: 'A', description: '' }],
    } as unknown as TaskDecomposition;
    expect(processTaskDecomposition(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.decomposeTask).not.toHaveBeenCalled();
  });

  it('returns false when parentTaskId is missing', () => {
    const payload = { action: 'decompose', tasks: [{ title: 'A', description: '' }] } as unknown as TaskDecomposition;
    expect(processTaskDecomposition(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.decomposeTask).not.toHaveBeenCalled();
  });

  it('returns false when tasks is not an array', () => {
    const payload = {
      action: 'decompose',
      parentTaskId: 'epic-1',
      tasks: 'not an array',
    } as unknown as TaskDecomposition;
    expect(processTaskDecomposition(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.decomposeTask).not.toHaveBeenCalled();
  });

  it('returns false when tasks is an empty array', () => {
    // Empty decomposition would flag the parent as epic without giving it
    // children to track — useless for the kanban progress UI and a likely
    // PM-prompt bug. Reject at the schema layer.
    expect(
      processTaskDecomposition(projectId, validPayload({ tasks: [] }), buildDeps()),
    ).toBe(false);
    expect(mockStore.decomposeTask).not.toHaveBeenCalled();
  });

  it('returns false when a task entry has an empty title', () => {
    const payload = validPayload({
      tasks: [
        { title: 'OK', description: '' },
        { title: '   ', description: '' },
      ],
    });
    expect(processTaskDecomposition(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.decomposeTask).not.toHaveBeenCalled();
  });

  it('returns false when a task entry is missing description', () => {
    // description must be a string (empty allowed). Missing entirely catches
    // a common PM-prompt bug where the model emits `{title}` only.
    const payload = {
      action: 'decompose',
      parentTaskId: 'epic-1',
      tasks: [{ title: 'OK' }],
    } as unknown as TaskDecomposition;
    expect(processTaskDecomposition(projectId, payload, buildDeps())).toBe(false);
    expect(mockStore.decomposeTask).not.toHaveBeenCalled();
  });

  it('returns false when project has no pipelineId', () => {
    mockProjectStore.getProject.mockReturnValueOnce({ id: projectId });
    expect(processTaskDecomposition(projectId, validPayload(), buildDeps())).toBe(false);
    expect(mockStore.decomposeTask).not.toHaveBeenCalled();
  });

  it('returns false when pipeline cannot be resolved', () => {
    mockPipelineStore.getPipeline.mockReturnValueOnce(null);
    expect(processTaskDecomposition(projectId, validPayload(), buildDeps())).toBe(false);
    expect(mockStore.decomposeTask).not.toHaveBeenCalled();
  });

  it('returns false when pipeline has zero stages', () => {
    // Without a first stage there is no destination column for the children;
    // a 0-stage pipeline is itself a misconfiguration the dispatcher must
    // refuse rather than fabricate a default.
    mockPipelineStore.getPipeline.mockReturnValueOnce(samplePipeline({ stages: [] }));
    expect(processTaskDecomposition(projectId, validPayload(), buildDeps())).toBe(false);
    expect(mockStore.decomposeTask).not.toHaveBeenCalled();
  });

  it('returns false when parentTaskId is unknown', () => {
    mockStore.getTask.mockReturnValueOnce(null);
    expect(processTaskDecomposition(projectId, validPayload(), buildDeps())).toBe(false);
    expect(mockStore.decomposeTask).not.toHaveBeenCalled();
  });

  it('runs cheap shape validation before the parent lookup', () => {
    // Ordering matters: a stream of malformed payloads must not thrash the
    // task store. The shape-validation arms above already prove getTask is
    // not called when payload is invalid; this test pins ordering for the
    // invalid-action arm specifically (which routes through the same gate).
    const payload = { action: 'wrong' } as unknown as TaskDecomposition;
    processTaskDecomposition(projectId, payload, buildDeps());
    expect(mockStore.getTask).not.toHaveBeenCalled();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('passes the first stage id as the children column', () => {
    // samplePipeline() defaults to stages = [pm, coder]; pm is index 0 so
    // children land in 'pm'. This is the entire reason the dispatcher
    // requires pipeline + project resolution — children must enter the
    // pipeline immediately, not loop back to backlog.
    processTaskDecomposition(projectId, validPayload(), buildDeps());
    expect(mockStore.decomposeTask).toHaveBeenCalledWith(
      projectId,
      'epic-1',
      'pm',
      [
        { title: 'Login form', description: 'UI work' },
        { title: 'Auth API', description: 'Backend' },
      ],
    );
  });

  it('returns true on successful decomposition', () => {
    expect(processTaskDecomposition(projectId, validPayload(), buildDeps())).toBe(true);
  });

  it('uses whatever stages[0].id the pipeline declares (no hardcoded "pm")', () => {
    // Custom pipelines have arbitrary stage ids. Pinning this prevents a
    // future refactor that helpfully defaults to 'pm' when the pipeline
    // first stage isn't named 'pm' — that would silently route children
    // into a non-existent column.
    mockPipelineStore.getPipeline.mockReturnValueOnce(
      samplePipeline({ stages: [sampleStage('triage'), sampleStage('build')] }),
    );
    processTaskDecomposition(projectId, validPayload(), buildDeps());
    expect(mockStore.decomposeTask).toHaveBeenCalledWith(
      projectId,
      'epic-1',
      'triage',
      expect.any(Array),
    );
  });

  it('preserves task order from the payload (decomposition order matters for UX)', () => {
    const payload = validPayload({
      tasks: [
        { title: 'First', description: '' },
        { title: 'Second', description: '' },
        { title: 'Third', description: '' },
      ],
    });
    processTaskDecomposition(projectId, payload, buildDeps());
    const passedTasks = mockStore.decomposeTask.mock.calls[0][3];
    expect(passedTasks.map((t: { title: string }) => t.title)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  // ── Error swallowing ──────────────────────────────────────────────────────

  it('returns false when decomposeTask throws (e.g. parent vanished mid-dispatch)', () => {
    // Even after the getTask check, a concurrent mutation could remove the
    // parent before decomposeTask fires. The dispatcher must not propagate;
    // the watcher would otherwise crash and stop processing future events.
    mockStore.decomposeTask.mockImplementationOnce(() => {
      throw new Error('Task not found: epic-1');
    });
    let result: boolean | undefined;
    expect(() => {
      result = processTaskDecomposition(projectId, validPayload(), buildDeps());
    }).not.toThrow();
    expect(result).toBe(false);
  });
});

// ── mergeSupervisorActionHook tests (Phase 8.1) ─────────────────────────────
//
// mergeSupervisorActionHook is idempotent: calling it twice must not add
// duplicate PostToolUse entries. This mirrors the behaviour of the other
// merge helpers (mergeTaskStatusHook, mergeTaskDecompositionHook).

import { mergeSupervisorActionHook } from '../../src/main/ipc-handlers/loop-handlers';

describe('mergeSupervisorActionHook', () => {
  const hookCmd = 'bash ~/.claude/hooks/supervisor-action-notify.sh';

  it('injects the supervisor-action hook into empty settings', () => {
    const result = JSON.parse(mergeSupervisorActionHook('{}'));
    const hooks = result.hooks?.PostToolUse ?? [];
    const cmds = hooks.flatMap((e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command));
    expect(cmds).toContain(hookCmd);
  });

  it('is idempotent — does not duplicate the hook', () => {
    const once = mergeSupervisorActionHook('{}');
    const twice = mergeSupervisorActionHook(once);
    const hooks = JSON.parse(twice).hooks?.PostToolUse ?? [];
    const cmds = hooks.flatMap((e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command));
    const count = cmds.filter((c: string) => c === hookCmd).length;
    expect(count).toBe(1);
  });

  it('preserves existing PostToolUse entries', () => {
    const existing = JSON.stringify({
      hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo hi' }] }] },
    });
    const result = JSON.parse(mergeSupervisorActionHook(existing));
    const hooks = result.hooks?.PostToolUse ?? [];
    const cmds = hooks.flatMap((e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command));
    expect(cmds).toContain('echo hi');
    expect(cmds).toContain(hookCmd);
  });
});

// ── processSupervisorAction tests (Phase 8.1) ─────────────────────────────
//
// processSupervisorAction dispatches @supervisor-action.json writes to
// stop + restart the named container. Tests verify: validation, unknown
// targetRole, successful restart, and graceful error handling.

import { processSupervisorAction } from '../../src/main/ipc-handlers/loop-handlers';
import type { SupervisorActionDeps } from '../../src/main/ipc-handlers/loop-handlers';
import type { LoopStartOpts } from '../../src/shared/loop-types';

describe('processSupervisorAction', () => {
  const pid = 'proj-sup-1';
  const targetRole = 'pm-0';
  const baseOpts: LoopStartOpts = {
    projectId: pid,
    projectName: 'Test',
    mode: LoopMode.CONTINUOUS,
    dockerImage: 'img',
    role: targetRole,
  };

  function buildDeps(overrides: Partial<SupervisorActionDeps> = {}): SupervisorActionDeps {
    const loopOptsMap = new Map<string, LoopStartOpts>();
    loopOptsMap.set(`${pid}:${targetRole}`, baseOpts);
    return {
      loopRunner: { stopLoop: vi.fn().mockResolvedValue(undefined) } as never,
      loopOptsMap,
      restartLoop: vi.fn().mockResolvedValue({ projectId: pid, role: targetRole, status: LoopStatus.RUNNING }),
      ...overrides,
    };
  }

  it('returns false for non-object payload', async () => {
    const result = await processSupervisorAction(pid, 'bad', buildDeps());
    expect(result).toBe(false);
  });

  it('returns false for unknown action type', async () => {
    const result = await processSupervisorAction(pid, { action: 'inject-context' }, buildDeps());
    expect(result).toBe(false);
  });

  it('returns false for missing targetRole', async () => {
    const result = await processSupervisorAction(pid, { action: 'restart' }, buildDeps());
    expect(result).toBe(false);
  });

  it('returns false when targetRole has no stored opts', async () => {
    const deps = buildDeps();
    deps.loopOptsMap.clear(); // empty — no opts stored
    const result = await processSupervisorAction(
      pid,
      { action: 'restart', targetRole, timestamp: new Date().toISOString() },
      deps,
    );
    expect(result).toBe(false);
  });

  it('stops then restarts the target container and returns true', async () => {
    const deps = buildDeps();
    const result = await processSupervisorAction(
      pid,
      { action: 'restart', targetRole, reason: 'PM unresponsive', timestamp: new Date().toISOString() },
      deps,
    );
    expect(result).toBe(true);
    expect(deps.loopRunner.stopLoop).toHaveBeenCalledWith(pid, targetRole);
    expect(deps.restartLoop).toHaveBeenCalledWith(baseOpts);
  });

  it('proceeds to restart even if stopLoop throws (container already stopped)', async () => {
    const deps = buildDeps({
      loopRunner: { stopLoop: vi.fn().mockRejectedValue(new Error('not running')) } as never,
    });
    const result = await processSupervisorAction(
      pid,
      { action: 'restart', targetRole, timestamp: new Date().toISOString() },
      deps,
    );
    expect(result).toBe(true);
    expect(deps.restartLoop).toHaveBeenCalled();
  });

  it('returns false and does not throw when restartLoop fails', async () => {
    const deps = buildDeps({
      restartLoop: vi.fn().mockRejectedValue(new Error('docker error')),
    });
    await expect(
      processSupervisorAction(
        pid,
        { action: 'restart', targetRole, timestamp: new Date().toISOString() },
        deps,
      ),
    ).resolves.toBe(false);
  });
});

// ── FACTORY_RESTART_CONTAINER tests (Phase 8.1) ──────────────────────────────
//
// FACTORY_RESTART_CONTAINER stops then restarts a single named container.
// Tests verify: missing opts throws, successful restart, and stopLoop failure
// is swallowed.

describe('FACTORY_RESTART_CONTAINER handler', () => {
  const projectId = 'proj-restart-1';
  const role = 'coder-0';
  const baseOpts: LoopStartOpts = {
    projectId,
    projectName: 'Restart Test',
    mode: LoopMode.CONTINUOUS,
    dockerImage: 'img',
    role,
  };

  beforeEach(() => {
    Object.keys(handlerRegistry).forEach((k) => delete handlerRegistry[k]);
    mockLoopRunner.startLoop.mockReset();
    mockLoopRunner.stopLoop.mockReset();
    mockLoopRunner.onStateChange.mockReset();
  });

  function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = handlerRegistry[channel];
    if (!handler) throw new Error(`No handler for ${channel}`);
    return Promise.resolve(handler(createFakeEvent(), ...args));
  }

  it('throws when no opts are stored for the role', async () => {
    registerLoopHandlers({
      loopRunner: mockLoopRunner as never,
      scheduler: mockScheduler as never,
    });
    await expect(invoke(IPC.FACTORY_RESTART_CONTAINER, projectId, role)).rejects.toThrow(
      'No stored opts for loop',
    );
  });

  it('stops and restarts the container when opts are stored', async () => {
    // Pre-store opts by first calling FACTORY_START for this project
    const pipeline: Pipeline = {
      id: 'pipe-r1',
      name: 'Restart Pipe',
      stages: [{ id: role.replace(/-\d+$/, ''), name: 'Coder', agentPrompt: 'code', instances: 1 }],
      bounceLimit: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const mockPs = { getPipeline: vi.fn().mockReturnValue(pipeline) };
    const mockProj = {
      getProject: vi.fn().mockReturnValue({
        pipelineId: 'pipe-r1',
        name: 'Restart Test',
        factory_config: { enabled: true },
        hooks: [],
        pre_validation_scripts: [],
        spec_files: {},
        custom_prompts: {},
      }),
    };
    mockLoopRunner.startLoop.mockResolvedValue(fakeRunningState(projectId, role));
    mockLoopRunner.stopLoop.mockResolvedValue(undefined);

    registerLoopHandlers({
      loopRunner: mockLoopRunner as never,
      scheduler: mockScheduler as never,
      projectStore: mockProj as never,
      pipelineStore: mockPs as never,
    });

    // Invoke FACTORY_START to populate loopOptsMap
    await invoke(IPC.FACTORY_START, projectId, {
      mode: LoopMode.CONTINUOUS,
      dockerImage: 'img',
      projectId,
      projectName: 'Restart Test',
    });

    // Now restart the container
    mockLoopRunner.startLoop.mockResolvedValue(fakeRunningState(projectId, role));
    const result = await invoke(IPC.FACTORY_RESTART_CONTAINER, projectId, role);
    expect(mockLoopRunner.stopLoop).toHaveBeenCalledWith(projectId, role);
    expect(mockLoopRunner.startLoop).toHaveBeenCalledTimes(2); // once for start, once for restart
    expect((result as { role: string }).role).toBe(role);
  });
});
