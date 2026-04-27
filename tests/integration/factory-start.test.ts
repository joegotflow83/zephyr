/**
 * @vitest-environment node
 *
 * Integration test for the FACTORY_START IPC handler with a multi-instance pipeline.
 *
 * Why this lives in tests/integration/ rather than tests/unit/:
 *   - Uses a REAL LoopRunner (not just a mock) so the container-naming logic in
 *     LoopRunner.startLoop is actually exercised.
 *   - The unit tests in loop-handlers.test.ts verify routing and opts passing using
 *     a fully-mocked startLoop. This test verifies the end-to-end name derivation:
 *     projectName → safeName → "zephyr-<safeName>-<stageId>-<instanceIndex>".
 *   - Uses a real temp directory so PROMPT_<stageId>.md writes are verified on disk.
 *
 * Scenario: 2-stage pipeline where stage[0] has instances=1 and stage[1] has
 * instances=2, giving 3 total containers. The test asserts correct count, names,
 * prompt files, and per-instance env vars.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../src/shared/ipc-channels';
import { LoopMode } from '../../src/shared/loop-types';
import { LoopRunner } from '../../src/services/loop-runner';
import { LogParser } from '../../src/services/log-parser';
import type { ContainerRuntime } from '../../src/services/container-runtime';
import type { Pipeline } from '../../src/shared/pipeline-types';

// ── Mock electron ─────────────────────────────────────────────────────────────
// Must be hoisted so it's in place before loop-handlers is imported.

const handlerRegistry: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlerRegistry[channel] = handler;
    },
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  Notification: class {
    show() {}
  },
}));

import { registerLoopHandlers } from '../../src/main/ipc-handlers/loop-handlers';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createFakeEvent(): IpcMainInvokeEvent {
  return { sender: { send: vi.fn() } } as unknown as IpcMainInvokeEvent;
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlerRegistry[channel];
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  return handler(createFakeEvent(), ...args);
}

/** Build a mock ContainerRuntime that records createContainer calls. */
function buildMockRuntime(): ContainerRuntime {
  const containerStates = new Map<string, 'running' | 'exited'>();
  return {
    runtimeType: 'docker',
    isAvailable: vi.fn().mockResolvedValue(true),
    getInfo: vi.fn().mockResolvedValue({ version: '27.0.0', containers: 0, images: 0 }),
    isImageAvailable: vi.fn().mockResolvedValue(true),
    pullImage: vi.fn().mockResolvedValue(undefined),
    saveImage: vi.fn().mockResolvedValue(undefined),
    buildImage: vi.fn().mockResolvedValue(undefined),
    createContainer: vi.fn(async () => {
      const id = `ctr-${Math.random().toString(36).slice(2, 7)}`;
      containerStates.set(id, 'running');
      return id;
    }),
    startContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn(async (id: string) => { containerStates.set(id, 'exited'); }),
    removeContainer: vi.fn(async (id: string) => { containerStates.delete(id); }),
    getContainerStatus: vi.fn(async (id: string) => ({
      id,
      state: containerStates.get(id) ?? 'exited',
      status: 'Up 1 second',
    })),
    getContainerCreated: vi.fn().mockResolvedValue(null),
    listContainers: vi.fn().mockResolvedValue([]),
    execCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    createExecSession: vi.fn().mockResolvedValue({ id: 'exec-1', stream: null }),
    resizeExec: vi.fn().mockResolvedValue(undefined),
    // streamLogs must resolve (not just return) so LoopRunner can await the stream.
    streamLogs: vi.fn().mockResolvedValue({ stop: vi.fn() }),
  } as unknown as ContainerRuntime;
}

/** Build a 2-stage pipeline: coder(×1) → qa(×2). */
function buildTestPipeline(overrides?: Partial<Pipeline>): Pipeline {
  return {
    id: 'pl-factory-int',
    name: 'Factory Integration Pipeline',
    stages: [
      { id: 'coder', name: 'Coder', agentPrompt: 'You are a coder.', instances: 1 },
      { id: 'qa', name: 'QA', agentPrompt: 'You are a QA engineer.', instances: 2 },
    ],
    bounceLimit: 3,
    builtIn: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('FACTORY_START — 2-stage pipeline with instances [1, 2]', () => {
  let workspacePath: string;
  let docker: ContainerRuntime;

  const projectId = 'proj-factory-int';
  const projectName = 'Demo Project';
  // 'Demo Project' → lowercase → 'demo project' → hyphens → 'demo-project'
  const safeName = 'demo-project';

  function makeBaseOpts() {
    return {
      mode: LoopMode.CONTINUOUS,
      dockerImage: 'test-image:latest',
      projectId,
      projectName,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    for (const key of Object.keys(handlerRegistry)) {
      delete handlerRegistry[key];
    }

    workspacePath = fsSync.mkdtempSync(path.join(os.tmpdir(), 'zephyr-factory-int-'));
    docker = buildMockRuntime();

    const loopRunner = new LoopRunner(docker, new LogParser());

    const mockProjectStore = {
      getProject: vi.fn().mockReturnValue({
        id: projectId,
        name: projectName,
        local_path: workspacePath,
        repo_url: '',
        docker_image: 'test-image:latest',
        max_iterations: 5,
        loop_script: '',
        pre_validation_scripts: [],
        hooks: [],
        kiro_hooks: [],
        custom_prompts: {},
        spec_files: {},
        factory_config: { enabled: true, roles: [] },
        pipelineId: 'pl-factory-int',
        feature_requests_content: '',
      }),
    };

    const mockPipelineStore = {
      getPipeline: vi.fn().mockReturnValue(buildTestPipeline()),
    };

    registerLoopHandlers({
      loopRunner,
      scheduler: {
        scheduleLoop: vi.fn(),
        cancelSchedule: vi.fn(),
        listScheduled: vi.fn(),
      } as never,
      projectStore: mockProjectStore as never,
      pipelineStore: mockPipelineStore as never,
    });
  });

  afterEach(() => {
    fsSync.rmSync(workspacePath, { recursive: true, force: true });
  });

  it('spawns exactly 3 containers for instances [1, 2]', async () => {
    await invoke(IPC.FACTORY_START, projectId, makeBaseOpts());
    expect(docker.createContainer).toHaveBeenCalledTimes(3);
  });

  it('uses composite role keys as container name suffixes: coder-0, qa-0, qa-1', async () => {
    await invoke(IPC.FACTORY_START, projectId, makeBaseOpts());

    const names = (docker.createContainer as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: [{ name?: string }]) => c[0].name ?? '',
    );
    expect(names).toEqual([
      `zephyr-${safeName}-coder-0`,
      `zephyr-${safeName}-qa-0`,
      `zephyr-${safeName}-qa-1`,
    ]);
  });

  it('writes PROMPT_<stageId>.md once per stage (not per instance)', async () => {
    await invoke(IPC.FACTORY_START, projectId, makeBaseOpts());

    const coderPrompt = fsSync.readFileSync(path.join(workspacePath, 'PROMPT_coder.md'), 'utf-8');
    const qaPrompt = fsSync.readFileSync(path.join(workspacePath, 'PROMPT_qa.md'), 'utf-8');
    expect(coderPrompt).toBe('You are a coder.');
    expect(qaPrompt).toBe('You are a QA engineer.');

    // Exactly 2 prompt files — not 3 (one per instance)
    const promptFiles = fsSync.readdirSync(workspacePath).filter((f) => f.startsWith('PROMPT_'));
    expect(promptFiles).toHaveLength(2);
  });

  it('sets STAGE_ID and INSTANCE_INDEX per-instance in env vars', async () => {
    await invoke(IPC.FACTORY_START, projectId, makeBaseOpts());

    const envs = (docker.createContainer as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: [{ env?: Record<string, string> }]) => c[0].env ?? {},
    );
    expect(envs[0]).toMatchObject({ STAGE_ID: 'coder', INSTANCE_INDEX: '0' });
    expect(envs[1]).toMatchObject({ STAGE_ID: 'qa', INSTANCE_INDEX: '0' });
    expect(envs[2]).toMatchObject({ STAGE_ID: 'qa', INSTANCE_INDEX: '1' });
  });

  it('returns 3 LoopState objects with roles in pipeline stage × instance order', async () => {
    const result = await invoke(IPC.FACTORY_START, projectId, makeBaseOpts()) as Array<{ role?: string }>;

    expect(result).toHaveLength(3);
    expect(result[0].role).toBe('coder-0');
    expect(result[1].role).toBe('qa-0');
    expect(result[2].role).toBe('qa-1');
  });

  it('preserves caller-supplied env vars alongside per-instance additions', async () => {
    await invoke(IPC.FACTORY_START, projectId, {
      ...makeBaseOpts(),
      envVars: { MY_TOKEN: 'secret' },
    });

    const envs = (docker.createContainer as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: [{ env?: Record<string, string> }]) => c[0].env ?? {},
    );
    for (const env of envs) {
      expect(env).toMatchObject({ MY_TOKEN: 'secret' });
    }
  });
});
