/**
 * Unit tests for FactoryTaskStore service.
 *
 * Tests cover:
 * - getQueue() — returns empty queue for missing/corrupt files
 * - addTask() — persists task in backlog with generated id + timestamps
 * - moveTask() — validates allowed forward and backward transitions
 * - removeTask() — removes by ID and persists; idempotent for missing IDs
 * - updateTask() — merges partial updates and refreshes updatedAt
 * - getTask() — returns task by ID or null when not found
 * - syncFromSpecs() — imports spec files as backlog tasks; deduplicates
 * - Kebab-case filename → Title Case title conversion
 *
 * Uses a real temp directory (no fs mocks) to ensure atomic-write semantics
 * and cross-instance persistence are exercised end-to-end, matching the
 * pattern used in deploy-key-store.test.ts and config-manager.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { FactoryTaskStore } from '../../src/services/factory-task-store';
import { type FactoryTask } from '../../src/shared/factory-types';
import type { Pipeline } from '../../src/shared/pipeline-types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'factory-task-store-test-'));
}

/**
 * Test pipeline shaped like the historical 6-stage flow
 * (start → inprogress → security → qa → documentation). We deliberately reuse
 * those stage ids — not the new `classic-factory` stage ids (pm/coder/...) —
 * so the existing transition assertions in this file describe a coherent
 * pipeline without touching every test case.
 */
const TEST_PIPELINE: Pipeline = Object.freeze({
  id: 'test-pipeline',
  name: 'Test Pipeline',
  stages: [
    { id: 'start', name: 'Start', agentPrompt: '', instances: 1 },
    { id: 'inprogress', name: 'In Progress', agentPrompt: '', instances: 1 },
    { id: 'security', name: 'Security', agentPrompt: '', instances: 1 },
    { id: 'qa', name: 'QA', agentPrompt: '', instances: 1 },
    { id: 'documentation', name: 'Documentation', agentPrompt: '', instances: 1 },
  ],
  bounceLimit: 3,
  builtIn: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}) as Pipeline;

/** Construct a store with the test pipeline injected as the move-time lookup. */
function makeStore(tmpDir: string, pipeline: Pipeline | null = TEST_PIPELINE): FactoryTaskStore {
  return new FactoryTaskStore(tmpDir, {
    getPipelineForProject: () => pipeline,
  });
}

// ─── getQueue() ──────────────────────────────────────────────────────────────

describe('FactoryTaskStore.getQueue', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new FactoryTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty queue when no file exists for project', () => {
    const queue = store.getQueue('project-abc');
    expect(queue).toEqual({ projectId: 'project-abc', tasks: [] });
  });

  it('returns empty queue when file contains corrupt JSON', () => {
    const filePath = path.join(tmpDir, 'bad-project.json');
    fs.writeFileSync(filePath, '{ invalid json ]', 'utf-8');

    const queue = store.getQueue('bad-project');
    expect(queue).toEqual({ projectId: 'bad-project', tasks: [] });
  });

  it('loads existing tasks from disk', () => {
    const queue = {
      projectId: 'proj-1',
      tasks: [
        {
          id: 'task-1',
          title: 'Existing Task',
          description: '',
          column: 'backlog' as const,
          projectId: 'proj-1',
          bounceCount: 0,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    };
    fs.writeFileSync(path.join(tmpDir, 'proj-1.json'), JSON.stringify(queue), 'utf-8');

    const loaded = store.getQueue('proj-1');
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0].title).toBe('Existing Task');
  });

  it('normalises legacy tasks that pre-date the bounceCount field to 0', () => {
    // Why: `bounceCount` became required in Phase 1.4. Queues written before
    // that may have tasks without it. Centralising the coercion in getQueue
    // protects every downstream operator (moveTask, lockTask, updateTask, …)
    // that uses `{...task}` spread copies — without this, undefined would
    // silently propagate and break the Phase 2.4 bounce-limit gate.
    const queue = {
      projectId: 'legacy',
      tasks: [
        {
          id: 'legacy-task',
          title: 'Legacy',
          description: '',
          column: 'inprogress',
          projectId: 'legacy',
          // bounceCount intentionally omitted to mirror legacy data
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    };
    fs.writeFileSync(path.join(tmpDir, 'legacy.json'), JSON.stringify(queue), 'utf-8');

    const loaded = store.getQueue('legacy');
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0].bounceCount).toBe(0);
  });

  it('preserves an existing bounceCount through migration (does not reset)', () => {
    // Why: migration must be additive. A task already partway into the bounce
    // budget must keep its count when reloaded — otherwise restarting the host
    // would silently grant agents a free retry past the bounceLimit.
    const queue = {
      projectId: 'partial',
      tasks: [
        {
          id: 'task-with-bounces',
          title: 'Bumped',
          description: '',
          column: 'inprogress',
          projectId: 'partial',
          bounceCount: 2,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    };
    fs.writeFileSync(path.join(tmpDir, 'partial.json'), JSON.stringify(queue), 'utf-8');

    const loaded = store.getQueue('partial');
    expect(loaded.tasks[0].bounceCount).toBe(2);
  });

  it('does not write back to disk on read when migration applies (in-memory only)', () => {
    // Why: getQueue is called many times per IPC handler invocation. If
    // legacy migration triggered a disk write, every read against an
    // un-migrated project would thrash the disk and risk PIPELINE_CHANGED-
    // style broadcast storms in adjacent stores. The next legitimate
    // mutation (addTask/moveTask/…) persists the normalised form.
    const queue = {
      projectId: 'read-only',
      tasks: [
        {
          id: 't',
          title: 'Legacy',
          description: '',
          column: 'backlog',
          projectId: 'read-only',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    };
    const filePath = path.join(tmpDir, 'read-only.json');
    fs.writeFileSync(filePath, JSON.stringify(queue), 'utf-8');
    const mtimeBefore = fs.statSync(filePath).mtimeMs;

    store.getQueue('read-only');
    store.getQueue('read-only');

    expect(fs.statSync(filePath).mtimeMs).toBe(mtimeBefore);
  });
});

// ─── addTask() ───────────────────────────────────────────────────────────────

describe('FactoryTaskStore.addTask', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new FactoryTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns a task with column backlog and generated id and timestamps', () => {
    const task = store.addTask('proj-1', { title: 'New Feature', description: 'Details here' });

    expect(task.id).toBeTruthy();
    expect(task.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(task.column).toBe('backlog');
    expect(task.title).toBe('New Feature');
    expect(task.description).toBe('Details here');
    expect(task.projectId).toBe('proj-1');
    expect(task.createdAt).toBeTruthy();
    expect(task.updatedAt).toBeTruthy();
  });

  it('persists the task to disk', () => {
    store.addTask('proj-1', { title: 'Saved Task', description: '' });

    const raw = fs.readFileSync(path.join(tmpDir, 'proj-1.json'), 'utf-8');
    const queue = JSON.parse(raw) as { projectId: string; tasks: FactoryTask[] };
    expect(queue.tasks).toHaveLength(1);
    expect(queue.tasks[0].title).toBe('Saved Task');
  });

  it('stores optional sourceFile when provided', () => {
    const task = store.addTask('proj-1', {
      title: 'Spec Task',
      description: '',
      sourceFile: 'auth-refactor.md',
    });

    expect(task.sourceFile).toBe('auth-refactor.md');
  });

  it('accumulates multiple tasks', () => {
    store.addTask('proj-1', { title: 'Task A', description: '' });
    store.addTask('proj-1', { title: 'Task B', description: '' });
    store.addTask('proj-1', { title: 'Task C', description: '' });

    const queue = store.getQueue('proj-1');
    expect(queue.tasks).toHaveLength(3);
    expect(queue.tasks.map((t) => t.title)).toEqual(['Task A', 'Task B', 'Task C']);
  });
});

// ─── moveTask() ──────────────────────────────────────────────────────────────

describe('FactoryTaskStore.moveTask — valid forward transitions', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = makeStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allows backlog → start', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    const moved = store.moveTask('proj-1', task.id, 'start');
    expect(moved.column).toBe('start');
  });

  it('allows start → inprogress', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    const moved = store.moveTask('proj-1', task.id, 'inprogress');
    expect(moved.column).toBe('inprogress');
  });

  it('allows inprogress → security', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    const moved = store.moveTask('proj-1', task.id, 'security');
    expect(moved.column).toBe('security');
  });

  it('allows security → qa', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'security');
    const moved = store.moveTask('proj-1', task.id, 'qa');
    expect(moved.column).toBe('qa');
  });

  it('allows qa → documentation', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'security');
    store.moveTask('proj-1', task.id, 'qa');
    const moved = store.moveTask('proj-1', task.id, 'documentation');
    expect(moved.column).toBe('documentation');
  });

  it('allows documentation → done', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'security');
    store.moveTask('proj-1', task.id, 'qa');
    store.moveTask('proj-1', task.id, 'documentation');
    const moved = store.moveTask('proj-1', task.id, 'done');
    expect(moved.column).toBe('done');
  });

  it('updates updatedAt after a move', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    const before = task.updatedAt;
    // Small delay to ensure timestamp differs
    const moved = store.moveTask('proj-1', task.id, 'start');
    // updatedAt should be >= original (could be same ms on fast machines)
    expect(new Date(moved.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime(),
    );
  });

  it('persists the new column to disk', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');

    const queue = store.getQueue('proj-1');
    expect(queue.tasks[0].column).toBe('start');
  });
});

describe('FactoryTaskStore.moveTask — valid backward transitions', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = makeStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allows qa → security (adjacent send-back for rework)', () => {
    // Why: backward movement is restricted to the immediately previous flow
    // column under the pipeline-driven model (spec §Pipeline Transitions).
    // Skipping stages — e.g. qa → inprogress — is rejected; agents must use
    // the bounce path one stage at a time so each upstream stage gets a
    // chance to fix issues before the rejection cascades further back.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'security');
    store.moveTask('proj-1', task.id, 'qa');
    const moved = store.moveTask('proj-1', task.id, 'security');
    expect(moved.column).toBe('security');
  });

  it('allows start → backlog', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    const moved = store.moveTask('proj-1', task.id, 'backlog');
    expect(moved.column).toBe('backlog');
  });

  it('allows done → documentation (adjacent rework after release)', () => {
    // Why: under the pipeline-driven model `done`'s only backward target is
    // its previous flow column (the last stage). The "reopen to backlog"
    // shortcut from the legacy hardcoded transitions no longer applies —
    // a manual triage path goes through Blocked instead, asserted below.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'security');
    store.moveTask('proj-1', task.id, 'qa');
    store.moveTask('proj-1', task.id, 'documentation');
    store.moveTask('proj-1', task.id, 'done');
    const moved = store.moveTask('proj-1', task.id, 'documentation');
    expect(moved.column).toBe('documentation');
  });

  it('rejects skip-back transitions (e.g. qa → inprogress is not adjacent)', () => {
    // Why: pin the no-skip rule. A future refactor that helpfully expanded
    // `allowed` to all upstream columns would silently let agents bypass
    // adjacent stages — defeating the bounce budget.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'security');
    store.moveTask('proj-1', task.id, 'qa');
    expect(() => store.moveTask('proj-1', task.id, 'inprogress')).toThrow(
      /Invalid transition from 'qa' to 'inprogress'/,
    );
  });
});

describe('FactoryTaskStore.moveTask — Blocked column transitions', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = makeStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allows any flow column → blocked (universal escalation)', () => {
    // Why: Blocked is a human-triage escape hatch reachable from anywhere
    // in the flow (spec §Blocked State). Without this, the Phase 2.4
    // bounce-limit gate would have nowhere to redirect overrun tasks.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    const moved = store.moveTask('proj-1', task.id, 'blocked');
    expect(moved.column).toBe('blocked');
  });

  it('allows blocked → any flow column (human resumption)', () => {
    // Why: after triage, the human picks where the task resumes — not
    // necessarily the column it escalated from. Blocked is the only
    // column that may target every flow stage.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'blocked');
    const moved = store.moveTask('proj-1', task.id, 'inprogress');
    expect(moved.column).toBe('inprogress');
  });
});

describe('FactoryTaskStore.moveTask — invalid transitions', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = makeStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects backlog → done with a descriptive error', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    expect(() => store.moveTask('proj-1', task.id, 'done')).toThrow(
      /Invalid transition from 'backlog' to 'done'/,
    );
  });

  it('rejects backlog → inprogress', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    expect(() => store.moveTask('proj-1', task.id, 'inprogress')).toThrow(
      /Invalid transition/,
    );
  });

  it('rejects backlog → security', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    expect(() => store.moveTask('proj-1', task.id, 'security')).toThrow(/Invalid transition/);
  });

  it('throws when task ID does not exist', () => {
    expect(() => store.moveTask('proj-1', 'non-existent-id', 'start')).toThrow(
      /Task not found: non-existent-id/,
    );
  });

  it('throws a "no pipeline assigned" error when getPipelineForProject returns null', () => {
    // Why: host-side analogue of the Phase 2.6 FACTORY_START rejection.
    // Without an assigned pipeline there is no way to derive transitions, so
    // the store fails fast with an actionable message rather than silently
    // permitting or rejecting moves with stale ALLOWED_TRANSITIONS data.
    const noPipelineStore = new FactoryTaskStore(tmpDir, {
      getPipelineForProject: () => null,
    });
    const task = noPipelineStore.addTask('proj-1', { title: 'T', description: '' });
    expect(() => noPipelineStore.moveTask('proj-1', task.id, 'start')).toThrow(
      /no pipeline assigned to project proj-1/,
    );
  });

  it('throws a "no pipeline assigned" error when no deps are provided', () => {
    // Why: pin the contract that moveTask can never run without a pipeline
    // resolver. A construction site that forgets to inject deps would fail
    // immediately on the first move, not silently fall through.
    const bareStore = new FactoryTaskStore(tmpDir);
    const task = bareStore.addTask('proj-1', { title: 'T', description: '' });
    expect(() => bareStore.moveTask('proj-1', task.id, 'start')).toThrow(
      /no pipeline assigned to project proj-1/,
    );
  });
});

describe('FactoryTaskStore.moveTask — bounceCount on backward moves', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = makeStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not increment bounceCount on a forward move', () => {
    // Why: forward progression is the happy path. Bouncing it would punish
    // tasks that flow naturally and exhaust the bounce budget without any
    // actual rework signal.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    const moved = store.moveTask('proj-1', task.id, 'start');
    expect(moved.bounceCount).toBe(0);
  });

  it('increments bounceCount on a single backward move', () => {
    // Why: a rejection from a later stage to its prev neighbour is the
    // canonical bounce signal — the Phase 2.4 gate compares this counter
    // against `pipeline.bounceLimit` to redirect overrun tasks to Blocked.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    const moved = store.moveTask('proj-1', task.id, 'start');
    expect(moved.bounceCount).toBe(1);
  });

  it('accumulates bounceCount across repeated rejections', () => {
    // Why: pin the +1-per-bounce contract. The Phase 2.4 gate fires when
    // `bounceCount >= bounceLimit`; without monotonic accumulation across
    // independent moveTask calls, that gate could never be reached.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start'); // bounce 1
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start'); // bounce 2
    store.moveTask('proj-1', task.id, 'inprogress');
    const third = store.moveTask('proj-1', task.id, 'start'); // bounce 3
    expect(third.bounceCount).toBe(3);
  });

  it('does not increment bounceCount on flow-column → blocked', () => {
    // Why: Blocked is a human-triage escape hatch, not a pipeline rejection.
    // Counting it would cause a single human-driven escalation to consume a
    // bounce slot that the agents never used.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    const moved = store.moveTask('proj-1', task.id, 'blocked');
    expect(moved.bounceCount).toBe(0);
  });

  it('does not increment bounceCount on blocked → flow column resumption', () => {
    // Why: resumption from Blocked is the human signalling "ready to retry";
    // it should reset the situation, not consume bounce budget.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'blocked');
    const moved = store.moveTask('proj-1', task.id, 'inprogress');
    expect(moved.bounceCount).toBe(0);
  });

  it('persists the new bounceCount to disk', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start');

    const fresh = makeStore(tmpDir);
    expect(fresh.getTask('proj-1', task.id)?.bounceCount).toBe(1);
  });
});

describe('FactoryTaskStore.moveTask — redirects to blocked at bounceLimit', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = makeStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('redirects to blocked when a backward move pushes bounceCount to bounceLimit', () => {
    // Why: this is the canonical Phase 2.4 escalation. The pipeline's
    // bounceLimit is the budget; when an agent rejects often enough to spend
    // it, the host overrides their requested column and parks the task in
    // Blocked so PM (2.10) can decide what to do next. Without this gate the
    // pipeline could ping-pong forever between two stages.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start'); // bounce 1
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start'); // bounce 2
    store.moveTask('proj-1', task.id, 'inprogress');
    const escalated = store.moveTask('proj-1', task.id, 'start'); // bounce 3 → blocked

    expect(escalated.column).toBe('blocked');
    expect(escalated.bounceCount).toBe(3);
  });

  it('still increments bounceCount on the redirecting move', () => {
    // Why: the bounce budget records spent attempts. Suppressing the
    // increment when the gate fires would mean a task that escalates to
    // Blocked, gets resumed by a human, and bounces again would re-trigger
    // the gate at the same threshold instead of immediately on the next
    // rejection. The "spent budget stays spent" semantic keeps the
    // bounceCount monotonic and the gate sticky after first escalation.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start'); // 1
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start'); // 2
    store.moveTask('proj-1', task.id, 'inprogress');
    const escalated = store.moveTask('proj-1', task.id, 'start');

    expect(escalated.bounceCount).toBe(3); // not 2 — increment still applies
  });

  it('discards the agent-requested column on redirect (lands in blocked, not the requested prev stage)', () => {
    // Why: the gate's escalation supplants the agent's local routing
    // decision. When QA rejects to its prev neighbour 'security' for the
    // third time, the task must land in 'blocked' — NOT in 'security'.
    // Without this assertion, a "redirect-to-blocked-only-when-target-is-
    // backlog" off-by-one bug could pass every other test in this file.
    // (Stage-skip is forbidden by deriveTransitions, so the only available
    // backward target from QA is its adjacent prev 'security'; the test
    // pins that even that adjacent target is overridden by the gate.)
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'security');
    store.moveTask('proj-1', task.id, 'qa');
    store.moveTask('proj-1', task.id, 'security'); // bounce 1 (qa → security)
    store.moveTask('proj-1', task.id, 'qa');
    store.moveTask('proj-1', task.id, 'security'); // bounce 2
    store.moveTask('proj-1', task.id, 'qa');
    const escalated = store.moveTask('proj-1', task.id, 'security'); // bounce 3

    expect(escalated.column).toBe('blocked');
    expect(escalated.column).not.toBe('security');
  });

  it('redirects on the first backward bounce when bounceLimit is 1', () => {
    // Why: a strict pipeline (bounceLimit: 1) means zero tolerance — the
    // first agent rejection escalates immediately. Without this assertion
    // an off-by-one in the gate (`>` instead of `>=`) would silently allow
    // one extra bounce in strict-mode pipelines, defeating the operator's
    // configuration intent.
    const strict: Pipeline = { ...TEST_PIPELINE, bounceLimit: 1 };
    const strictStore = new FactoryTaskStore(tmpDir, {
      getPipelineForProject: () => strict,
    });
    const task = strictStore.addTask('proj-1', { title: 'T', description: '' });
    strictStore.moveTask('proj-1', task.id, 'start');
    strictStore.moveTask('proj-1', task.id, 'inprogress');
    const escalated = strictStore.moveTask('proj-1', task.id, 'start');

    expect(escalated.column).toBe('blocked');
    expect(escalated.bounceCount).toBe(1);
  });

  it('keeps the requested column when bounceCount is below limit', () => {
    // Why: regression guard. The gate must NOT fire when newBounceCount is
    // strictly less than bounceLimit. A naive implementation that compared
    // against the *old* bounceCount, or used `>` against the post-increment
    // value, would either misfire or never fire — both break the canonical
    // 3-bounce flow. Pin that bounce 1 and bounce 2 still land in the
    // agent's requested column.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    const firstBounce = store.moveTask('proj-1', task.id, 'start');
    expect(firstBounce.column).toBe('start');
    expect(firstBounce.bounceCount).toBe(1);

    store.moveTask('proj-1', task.id, 'inprogress');
    const secondBounce = store.moveTask('proj-1', task.id, 'start');
    expect(secondBounce.column).toBe('start');
    expect(secondBounce.bounceCount).toBe(2);
  });

  it('does not redirect on a forward move even when bounceCount is at limit', () => {
    // Why: only backward bounces consume the budget; forward progress is the
    // happy path even after escalation. A task resumed from Blocked at
    // bounceCount=3 must be allowed to advance through stages without being
    // re-routed back to Blocked on every forward step. The `isBackward`
    // guard on the gate is what enforces this.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    // Drive bounceCount to 3 via three rejections (the third escalates).
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    const escalated = store.moveTask('proj-1', task.id, 'start');
    expect(escalated.column).toBe('blocked');

    // Human resumption + forward move — must NOT redirect even though
    // bounceCount (3) is still at the limit.
    const resumed = store.moveTask('proj-1', task.id, 'start');
    expect(resumed.column).toBe('start');
    const advanced = store.moveTask('proj-1', task.id, 'inprogress');
    expect(advanced.column).toBe('inprogress');
    expect(advanced.bounceCount).toBe(3); // unchanged on forward
  });

  it('re-escalates on subsequent backward bounce after resumption', () => {
    // Why: once the budget is spent it stays spent (see "still increments"
    // test). Any further bounce after a human-driven resumption from Blocked
    // must immediately re-escalate, since `newBounceCount >= bounceLimit` is
    // satisfied for every backward move once the counter is at limit. This
    // is the sticky-gate behaviour PM (2.10) relies on to know that a
    // resumed-and-re-bounced task is genuinely stuck.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start'); // first escalation, count=3

    // Human triages: resume from blocked into start, advance to inprogress.
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');

    // Agent rejects again — must escalate immediately (count goes 3→4).
    const reEscalated = store.moveTask('proj-1', task.id, 'start');
    expect(reEscalated.column).toBe('blocked');
    expect(reEscalated.bounceCount).toBe(4);
  });

  it('persists the redirect to disk', () => {
    // Why: the gate fires inside moveTask before saveQueue, so the redirected
    // column must be the value written. A future refactor that moved the gate
    // to a post-save hook (or to the IPC layer) would silently break crash
    // recovery — agents reading the queue post-restart would see the task in
    // the agent-requested column instead of Blocked. Pin the on-disk shape.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start');

    const fresh = makeStore(tmpDir);
    const reloaded = fresh.getTask('proj-1', task.id);
    expect(reloaded?.column).toBe('blocked');
    expect(reloaded?.bounceCount).toBe(3);
  });

  it('clears lockedBy on the redirecting move', () => {
    // Why: lock release is unconditional on every successful move (see the
    // adjacent "clears lockedBy" describe block). The gate-redirect path
    // must preserve that contract — leaving a lock attached when escalating
    // to Blocked would block the human triager from reassigning the task.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.lockTask('proj-1', task.id, 'inprogress-0');
    const escalated = store.moveTask('proj-1', task.id, 'start');

    expect(escalated.column).toBe('blocked');
    expect(escalated.lockedBy).toBeUndefined();
  });
});

describe('FactoryTaskStore.moveTask — clears lockedBy on transition', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = makeStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('clears lockedBy on a forward move', () => {
    // Why: the lock identifies the agent currently responsible for the
    // task. Once the stage changes, the next stage's instances re-acquire
    // via lockTask — leaving the old owner attached would block them.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.lockTask('proj-1', task.id, 'start-0');
    const moved = store.moveTask('proj-1', task.id, 'inprogress');
    expect(moved.lockedBy).toBeUndefined();
  });

  it('clears lockedBy on a backward move (rejection)', () => {
    // Why: a rejecting agent releases its claim atomically with the move so
    // the upstream stage's instances see an unlocked task on next poll.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.lockTask('proj-1', task.id, 'inprogress-0');
    const moved = store.moveTask('proj-1', task.id, 'start');
    expect(moved.lockedBy).toBeUndefined();
  });

  it('clears lockedBy on a Blocked escalation', () => {
    // Why: when Phase 2.4 redirects to Blocked, no agent owns the task
    // until a human resumes it; the lock must be released so the renderer's
    // 🔒 indicator stops showing.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.lockTask('proj-1', task.id, 'start-0');
    const moved = store.moveTask('proj-1', task.id, 'blocked');
    expect(moved.lockedBy).toBeUndefined();
  });

  it('persists the lock release to disk', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.lockTask('proj-1', task.id, 'start-0');
    store.moveTask('proj-1', task.id, 'inprogress');

    const fresh = makeStore(tmpDir);
    expect(fresh.getTask('proj-1', task.id)?.lockedBy).toBeUndefined();
  });
});

// ─── removeTask() ────────────────────────────────────────────────────────────

describe('FactoryTaskStore.removeTask', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new FactoryTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes the task by ID and persists', () => {
    const t1 = store.addTask('proj-1', { title: 'Task 1', description: '' });
    const t2 = store.addTask('proj-1', { title: 'Task 2', description: '' });

    store.removeTask('proj-1', t1.id);

    const queue = store.getQueue('proj-1');
    expect(queue.tasks).toHaveLength(1);
    expect(queue.tasks[0].id).toBe(t2.id);
  });

  it('persists removal to disk (survives fresh instance)', () => {
    const task = store.addTask('proj-1', { title: 'To Remove', description: '' });
    store.removeTask('proj-1', task.id);

    const freshStore = new FactoryTaskStore(tmpDir);
    const queue = freshStore.getQueue('proj-1');
    expect(queue.tasks).toHaveLength(0);
  });

  it('is a no-op when task ID does not exist', () => {
    store.addTask('proj-1', { title: 'Survivor', description: '' });
    expect(() => store.removeTask('proj-1', 'ghost-id')).not.toThrow();

    const queue = store.getQueue('proj-1');
    expect(queue.tasks).toHaveLength(1);
  });
});

// ─── updateTask() ────────────────────────────────────────────────────────────

describe('FactoryTaskStore.updateTask', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new FactoryTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('merges partial title update', () => {
    const task = store.addTask('proj-1', { title: 'Old Title', description: 'Keep me' });
    const updated = store.updateTask('proj-1', task.id, { title: 'New Title' });

    expect(updated.title).toBe('New Title');
    expect(updated.description).toBe('Keep me');
  });

  it('merges partial description update', () => {
    const task = store.addTask('proj-1', { title: 'Keep me', description: 'Old desc' });
    const updated = store.updateTask('proj-1', task.id, { description: 'New desc' });

    expect(updated.title).toBe('Keep me');
    expect(updated.description).toBe('New desc');
  });

  it('updates updatedAt timestamp', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    const before = task.updatedAt;
    const updated = store.updateTask('proj-1', task.id, { title: 'Updated' });
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime(),
    );
  });

  it('does not change column or other fields', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '', sourceFile: 'spec.md' });
    const updated = store.updateTask('proj-1', task.id, { title: 'New' });

    expect(updated.column).toBe('backlog');
    expect(updated.projectId).toBe('proj-1');
    expect(updated.sourceFile).toBe('spec.md');
    expect(updated.id).toBe(task.id);
    expect(updated.createdAt).toBe(task.createdAt);
  });

  it('persists the update to disk', () => {
    const task = store.addTask('proj-1', { title: 'Before', description: '' });
    store.updateTask('proj-1', task.id, { title: 'After' });

    const queue = store.getQueue('proj-1');
    expect(queue.tasks[0].title).toBe('After');
  });

  it('throws when task ID does not exist', () => {
    expect(() => store.updateTask('proj-1', 'missing-id', { title: 'X' })).toThrow(
      /Task not found: missing-id/,
    );
  });
});

// ─── getTask() ───────────────────────────────────────────────────────────────

describe('FactoryTaskStore.getTask', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new FactoryTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the task when found', () => {
    const task = store.addTask('proj-1', { title: 'Find me', description: 'Here' });
    const found = store.getTask('proj-1', task.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Find me');
  });

  it('returns null when task ID does not exist', () => {
    const result = store.getTask('proj-1', 'ghost-id');
    expect(result).toBeNull();
  });

  it('returns null when project has no tasks', () => {
    const result = store.getTask('empty-project', 'any-id');
    expect(result).toBeNull();
  });
});

// ─── syncFromSpecs() ─────────────────────────────────────────────────────────

describe('FactoryTaskStore.syncFromSpecs — new spec files', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new FactoryTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates tasks for spec files not already tracked', () => {
    const newTasks = store.syncFromSpecs('proj-1', {
      'auth-refactor.md': '# Auth',
      'payment-flow.md': '# Payment',
    });

    expect(newTasks).toHaveLength(2);
    const sourceFiles = newTasks.map((t) => t.sourceFile).sort();
    expect(sourceFiles).toEqual(['auth-refactor.md', 'payment-flow.md']);
  });

  it('populates task description from specFiles content', () => {
    const newTasks = store.syncFromSpecs('proj-1', { 'feature-x.md': '# Feature X\nDetails here.' });

    expect(newTasks[0].description).toBe('# Feature X\nDetails here.');
  });

  it('persists new tasks to disk', () => {
    store.syncFromSpecs('proj-1', { 'feature-x.md': '' });

    const queue = store.getQueue('proj-1');
    expect(queue.tasks).toHaveLength(1);
    expect(queue.tasks[0].sourceFile).toBe('feature-x.md');
  });

  it('creates all tasks in backlog column', () => {
    const newTasks = store.syncFromSpecs('proj-1', { 'task-a.md': '', 'task-b.md': '' });
    expect(newTasks.every((t) => t.column === 'backlog')).toBe(true);
  });

  it('returns empty array when spec list is empty', () => {
    const newTasks = store.syncFromSpecs('proj-1', {});
    expect(newTasks).toHaveLength(0);
  });
});

describe('FactoryTaskStore.syncFromSpecs — deduplication', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new FactoryTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips spec files that already have a matching task by sourceFile', () => {
    store.syncFromSpecs('proj-1', { 'existing.md': '' });
    const newTasks = store.syncFromSpecs('proj-1', { 'existing.md': '', 'new-spec.md': '' });

    // Only the new spec should be created
    expect(newTasks).toHaveLength(1);
    expect(newTasks[0].sourceFile).toBe('new-spec.md');

    // Total tasks should be 2 (1 original + 1 new)
    const queue = store.getQueue('proj-1');
    expect(queue.tasks).toHaveLength(2);
  });

  it('does not create duplicate tasks when called twice with same specs', () => {
    store.syncFromSpecs('proj-1', { 'spec-a.md': '', 'spec-b.md': '' });
    const second = store.syncFromSpecs('proj-1', { 'spec-a.md': '', 'spec-b.md': '' });

    expect(second).toHaveLength(0);
    const queue = store.getQueue('proj-1');
    expect(queue.tasks).toHaveLength(2);
  });

  it('Record keys are inherently unique — same key appears only once', () => {
    // Object keys are deduplicated by JavaScript itself
    const newTasks = store.syncFromSpecs('proj-1', { 'dupe.md': 'content' });
    expect(newTasks).toHaveLength(1);
  });
});

describe('FactoryTaskStore.syncFromSpecs — localPath scanning', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new FactoryTaskStore(tmpDir);
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-project-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('reads .md files from <localPath>/specs/ directory', () => {
    const specsDir = path.join(projectDir, 'specs');
    fs.mkdirSync(specsDir);
    fs.writeFileSync(path.join(specsDir, 'feature-login.md'), '# Login');
    fs.writeFileSync(path.join(specsDir, 'feature-logout.md'), '# Logout');
    fs.writeFileSync(path.join(specsDir, 'notes.txt'), 'ignored'); // not .md

    const newTasks = store.syncFromSpecs('proj-1', {}, projectDir);

    expect(newTasks).toHaveLength(2);
    const sourceFiles = newTasks.map((t) => t.sourceFile).sort();
    expect(sourceFiles).toEqual(['feature-login.md', 'feature-logout.md']);
  });

  it('populates description from disk file content', () => {
    const specsDir = path.join(projectDir, 'specs');
    fs.mkdirSync(specsDir);
    fs.writeFileSync(path.join(specsDir, 'feature-login.md'), '# Login\nLogin spec content.');

    const newTasks = store.syncFromSpecs('proj-1', {}, projectDir);

    expect(newTasks).toHaveLength(1);
    expect(newTasks[0].description).toBe('# Login\nLogin spec content.');
  });

  it('disk content takes precedence over in-memory specFiles content', () => {
    const specsDir = path.join(projectDir, 'specs');
    fs.mkdirSync(specsDir);
    fs.writeFileSync(path.join(specsDir, 'shared.md'), '# Fresh disk content');

    const newTasks = store.syncFromSpecs('proj-1', { 'shared.md': 'stale in-memory content' }, projectDir);

    expect(newTasks).toHaveLength(1);
    expect(newTasks[0].description).toBe('# Fresh disk content');
  });

  it('merges spec files from both argument list and disk without duplicates', () => {
    const specsDir = path.join(projectDir, 'specs');
    fs.mkdirSync(specsDir);
    fs.writeFileSync(path.join(specsDir, 'shared.md'), '');
    fs.writeFileSync(path.join(specsDir, 'disk-only.md'), '');

    const newTasks = store.syncFromSpecs('proj-1', { 'shared.md': '', 'arg-only.md': '' }, projectDir);

    expect(newTasks).toHaveLength(3);
    const sourceFiles = newTasks.map((t) => t.sourceFile).sort();
    expect(sourceFiles).toEqual(['arg-only.md', 'disk-only.md', 'shared.md']);
  });

  it('silently handles missing specs/ directory', () => {
    // projectDir exists but specs/ subdirectory does not
    expect(() => store.syncFromSpecs('proj-1', { 'fallback.md': '' }, projectDir)).not.toThrow();

    const queue = store.getQueue('proj-1');
    expect(queue.tasks).toHaveLength(1);
    expect(queue.tasks[0].sourceFile).toBe('fallback.md');
  });
});

// ─── Title conversion ─────────────────────────────────────────────────────────

describe('FactoryTaskStore — spec filename to title conversion', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new FactoryTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('converts kebab-case filename to Title Case title', () => {
    const tasks = store.syncFromSpecs('proj-1', { 'auth-refactor.md': '' });
    expect(tasks[0].title).toBe('Auth Refactor');
  });

  it('converts multi-word kebab-case filename', () => {
    const tasks = store.syncFromSpecs('proj-1', { 'add-payment-flow.md': '' });
    expect(tasks[0].title).toBe('Add Payment Flow');
  });

  it('converts single-word filename', () => {
    const tasks = store.syncFromSpecs('proj-1', { 'login.md': '' });
    expect(tasks[0].title).toBe('Login');
  });

  it('preserves uppercase acronyms when not split by dashes', () => {
    const tasks = store.syncFromSpecs('proj-1', { 'README.md': '' });
    expect(tasks[0].title).toBe('README');
  });
});

// ─── lockTask() / unlockTask() / incrementBounceCount() ─────────────────────

describe('FactoryTaskStore.lockTask', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new FactoryTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sets lockedBy on an unlocked task', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    const locked = store.lockTask('proj-1', task.id, 'coder-0');
    expect(locked.lockedBy).toBe('coder-0');
  });

  it('persists the lock to disk', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.lockTask('proj-1', task.id, 'coder-0');

    const fresh = new FactoryTaskStore(tmpDir);
    const reloaded = fresh.getTask('proj-1', task.id);
    expect(reloaded?.lockedBy).toBe('coder-0');
  });

  it('throws when another owner already holds the lock', () => {
    // Why: prevents two parallel stage instances from grabbing the same task.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.lockTask('proj-1', task.id, 'coder-0');

    expect(() => store.lockTask('proj-1', task.id, 'coder-1')).toThrow(
      /already locked by 'coder-0'/,
    );
  });

  it('is idempotent when re-locked by the same owner (no throw, no rewrite)', () => {
    // Why: container restarts may retry their own outstanding lock; that path
    // must not throw nor cause a spurious write that bumps updatedAt.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    const first = store.lockTask('proj-1', task.id, 'coder-0');
    const filePath = path.join(tmpDir, 'proj-1.json');
    const mtimeBefore = fs.statSync(filePath).mtimeMs;

    const second = store.lockTask('proj-1', task.id, 'coder-0');

    expect(second.lockedBy).toBe('coder-0');
    expect(second.updatedAt).toBe(first.updatedAt);
    expect(fs.statSync(filePath).mtimeMs).toBe(mtimeBefore);
  });

  it('throws when task ID does not exist', () => {
    expect(() => store.lockTask('proj-1', 'ghost-id', 'coder-0')).toThrow(
      /Task not found: ghost-id/,
    );
  });

  it('refreshes updatedAt on successful lock', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    const locked = store.lockTask('proj-1', task.id, 'coder-0');
    expect(new Date(locked.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(task.updatedAt).getTime(),
    );
  });
});

describe('FactoryTaskStore.unlockTask', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new FactoryTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('clears lockedBy on a locked task', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.lockTask('proj-1', task.id, 'coder-0');

    const unlocked = store.unlockTask('proj-1', task.id);

    expect(unlocked.lockedBy).toBeUndefined();
  });

  it('persists the unlock to disk', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.lockTask('proj-1', task.id, 'coder-0');
    store.unlockTask('proj-1', task.id);

    const fresh = new FactoryTaskStore(tmpDir);
    expect(fresh.getTask('proj-1', task.id)?.lockedBy).toBeUndefined();
  });

  it('is a no-op when the task is already unlocked (no rewrite)', () => {
    // Why: FACTORY_STOP / moveTask both call unlock unconditionally; we must
    // not bump updatedAt or thrash the disk for tasks that were never locked.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    const filePath = path.join(tmpDir, 'proj-1.json');
    const mtimeBefore = fs.statSync(filePath).mtimeMs;

    const result = store.unlockTask('proj-1', task.id);

    expect(result.lockedBy).toBeUndefined();
    expect(result.updatedAt).toBe(task.updatedAt);
    expect(fs.statSync(filePath).mtimeMs).toBe(mtimeBefore);
  });

  it('clears regardless of which owner holds the lock', () => {
    // Why: Phase 2.12 FACTORY_STOP releases all locks unconditionally; the
    // store does not know which container "owns" each lock.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.lockTask('proj-1', task.id, 'coder-0');

    const unlocked = store.unlockTask('proj-1', task.id);
    expect(unlocked.lockedBy).toBeUndefined();
  });

  it('throws when task ID does not exist', () => {
    expect(() => store.unlockTask('proj-1', 'ghost-id')).toThrow(
      /Task not found: ghost-id/,
    );
  });
});

describe('FactoryTaskStore.incrementBounceCount', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new FactoryTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('increments bounceCount from 0 to 1', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    expect(task.bounceCount).toBe(0);

    const bumped = store.incrementBounceCount('proj-1', task.id);
    expect(bumped.bounceCount).toBe(1);
  });

  it('increments repeatedly to track the bounce limit', () => {
    // Why: Phase 2.4 compares bounceCount >= bounceLimit (default 3); this
    // test pins the +1-per-call contract that gating relies on.
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.incrementBounceCount('proj-1', task.id);
    store.incrementBounceCount('proj-1', task.id);
    const third = store.incrementBounceCount('proj-1', task.id);
    expect(third.bounceCount).toBe(3);
  });

  it('persists the new count to disk', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.incrementBounceCount('proj-1', task.id);
    store.incrementBounceCount('proj-1', task.id);

    const fresh = new FactoryTaskStore(tmpDir);
    expect(fresh.getTask('proj-1', task.id)?.bounceCount).toBe(2);
  });

  it('handles legacy queues with missing bounceCount as 0', () => {
    // Why: `bounceCount` is required on FactoryTask, but on-disk queues from
    // before the field was added may lack it. Increment must coerce undefined
    // → 0 → 1 rather than producing NaN.
    const queue = {
      projectId: 'legacy',
      tasks: [
        {
          id: 'legacy-task',
          title: 'Legacy',
          description: '',
          column: 'inprogress',
          projectId: 'legacy',
          // Note: bounceCount intentionally omitted to mirror legacy data.
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    };
    fs.writeFileSync(path.join(tmpDir, 'legacy.json'), JSON.stringify(queue), 'utf-8');

    const bumped = store.incrementBounceCount('legacy', 'legacy-task');
    expect(bumped.bounceCount).toBe(1);
  });

  it('refreshes updatedAt', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    const bumped = store.incrementBounceCount('proj-1', task.id);
    expect(new Date(bumped.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(task.updatedAt).getTime(),
    );
  });

  it('throws when task ID does not exist', () => {
    expect(() => store.incrementBounceCount('proj-1', 'ghost-id')).toThrow(
      /Task not found: ghost-id/,
    );
  });

  it('does not modify other fields', () => {
    const task = store.addTask('proj-1', {
      title: 'Keep me',
      description: 'And me',
      sourceFile: 'spec.md',
    });
    const bumped = store.incrementBounceCount('proj-1', task.id);

    expect(bumped.id).toBe(task.id);
    expect(bumped.title).toBe('Keep me');
    expect(bumped.description).toBe('And me');
    expect(bumped.sourceFile).toBe('spec.md');
    expect(bumped.column).toBe('backlog');
    expect(bumped.createdAt).toBe(task.createdAt);
  });
});

// ─── decomposeTask() ─────────────────────────────────────────────────────────

describe('FactoryTaskStore.decomposeTask', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = makeStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('marks the parent task as isEpic and creates one child per entry', () => {
    const parent = store.addTask('proj-1', { title: 'Build login flow', description: 'Epic' });

    const result = store.decomposeTask('proj-1', parent.id, 'inprogress', [
      { title: 'Login form', description: 'UI work' },
      { title: 'Auth API', description: 'Backend' },
    ]);

    expect(result.parent.isEpic).toBe(true);
    expect(result.children).toHaveLength(2);
    expect(result.children.map((c) => c.title)).toEqual(['Login form', 'Auth API']);
  });

  it('places children in the supplied column (not backlog)', () => {
    // Children must enter the pipeline immediately so PM does not re-process
    // them as fresh epics. The dispatcher passes `pipeline.stages[0].id` —
    // the store trusts the caller and writes that value verbatim.
    const parent = store.addTask('proj-1', { title: 'Epic', description: '' });
    const result = store.decomposeTask('proj-1', parent.id, 'inprogress', [
      { title: 'Child', description: '' },
    ]);
    expect(result.children[0].column).toBe('inprogress');
  });

  it('keeps the parent in its original column (Backlog stays Backlog)', () => {
    // Per spec §Epic the parent is a progress tracker, not an active task.
    // Phase 2.9 will auto-advance it to Done when all children complete.
    const parent = store.addTask('proj-1', { title: 'Epic', description: '' });
    expect(parent.column).toBe('backlog');

    const result = store.decomposeTask('proj-1', parent.id, 'inprogress', [
      { title: 'Child', description: '' },
    ]);
    expect(result.parent.column).toBe('backlog');
  });

  it('sets parentTaskId on every child to the supplied parent id', () => {
    const parent = store.addTask('proj-1', { title: 'Epic', description: '' });
    const result = store.decomposeTask('proj-1', parent.id, 'inprogress', [
      { title: 'A', description: '' },
      { title: 'B', description: '' },
      { title: 'C', description: '' },
    ]);
    expect(result.children.every((c) => c.parentTaskId === parent.id)).toBe(true);
  });

  it('initialises every child with bounceCount: 0', () => {
    // Phase 1.4 made bounceCount required. Without explicit initialisation,
    // a child entering Backlog with `undefined` would poison the bounce-limit
    // gate the first time it gets bounced.
    const parent = store.addTask('proj-1', { title: 'Epic', description: '' });
    const result = store.decomposeTask('proj-1', parent.id, 'inprogress', [
      { title: 'A', description: '' },
    ]);
    expect(result.children[0].bounceCount).toBe(0);
  });

  it('assigns each child a fresh UUID', () => {
    const parent = store.addTask('proj-1', { title: 'Epic', description: '' });
    const result = store.decomposeTask('proj-1', parent.id, 'inprogress', [
      { title: 'A', description: '' },
      { title: 'B', description: '' },
    ]);
    expect(result.children[0].id).not.toBe(result.children[1].id);
    expect(result.children[0].id).not.toBe(parent.id);
  });

  it('persists children and parent flag to disk in a single atomic write', () => {
    // Single saveQueue call is the crash-safety guarantee — without it, the
    // host watcher would have to track partial-decomposition recovery state.
    // Pin atomicity by reading from a fresh store instance.
    const parent = store.addTask('proj-1', { title: 'Epic', description: '' });
    store.decomposeTask('proj-1', parent.id, 'inprogress', [
      { title: 'A', description: '' },
      { title: 'B', description: '' },
    ]);

    const fresh = makeStore(tmpDir);
    const queue = fresh.getQueue('proj-1');
    expect(queue.tasks).toHaveLength(3); // parent + 2 children
    const reloadedParent = queue.tasks.find((t) => t.id === parent.id);
    expect(reloadedParent?.isEpic).toBe(true);
    expect(queue.tasks.filter((t) => t.parentTaskId === parent.id)).toHaveLength(2);
  });

  it('throws when parent task ID does not exist', () => {
    expect(() =>
      store.decomposeTask('proj-1', 'ghost-id', 'inprogress', [
        { title: 'A', description: '' },
      ]),
    ).toThrow(/Task not found: ghost-id/);
  });

  it('does not mutate the queue when the parent is unknown', () => {
    // The early throw must happen before any saveQueue call — otherwise a
    // typo'd parentTaskId would still flag a different task or write
    // orphaned children. Pinned by checking the file mtime stays unchanged.
    store.addTask('proj-1', { title: 'Existing', description: '' });
    const filePath = path.join(tmpDir, 'proj-1.json');
    const before = fs.statSync(filePath).mtimeMs;

    expect(() =>
      store.decomposeTask('proj-1', 'ghost-id', 'inprogress', [
        { title: 'Child', description: '' },
      ]),
    ).toThrow();

    const after = fs.statSync(filePath).mtimeMs;
    expect(after).toBe(before);
  });

  it('refreshes the parent updatedAt timestamp', () => {
    const parent = store.addTask('proj-1', { title: 'Epic', description: '' });
    // sleep 5ms so timestamps can differ
    const sleepUntil = Date.now() + 5;
    while (Date.now() < sleepUntil) {
      /* spin */
    }
    const result = store.decomposeTask('proj-1', parent.id, 'inprogress', [
      { title: 'A', description: '' },
    ]);
    expect(new Date(result.parent.updatedAt).getTime()).toBeGreaterThan(
      new Date(parent.updatedAt).getTime(),
    );
  });

  it('preserves parent fields other than isEpic and updatedAt', () => {
    const parent = store.addTask('proj-1', {
      title: 'Original epic',
      description: 'Original description',
      sourceFile: 'epic.md',
    });
    const result = store.decomposeTask('proj-1', parent.id, 'inprogress', [
      { title: 'A', description: '' },
    ]);
    expect(result.parent.id).toBe(parent.id);
    expect(result.parent.title).toBe('Original epic');
    expect(result.parent.description).toBe('Original description');
    expect(result.parent.sourceFile).toBe('epic.md');
    expect(result.parent.bounceCount).toBe(parent.bounceCount);
    expect(result.parent.createdAt).toBe(parent.createdAt);
  });

  it('inherits projectId from the call site on every child', () => {
    const parent = store.addTask('proj-1', { title: 'Epic', description: '' });
    const result = store.decomposeTask('proj-1', parent.id, 'inprogress', [
      { title: 'A', description: '' },
    ]);
    expect(result.children[0].projectId).toBe('proj-1');
  });

  it('accepts an empty children array (caller-validated; store stays permissive)', () => {
    // The dispatcher rejects empty arrays at the schema layer — but the store
    // primitive itself stays permissive so future callers can flag a parent
    // as epic without children (e.g. a manual UI override). Pinning the
    // permissive contract prevents accidental coupling between dispatcher
    // validation and store mutation rules.
    const parent = store.addTask('proj-1', { title: 'Epic', description: '' });
    const result = store.decomposeTask('proj-1', parent.id, 'inprogress', []);
    expect(result.children).toHaveLength(0);
    expect(result.parent.isEpic).toBe(true);
  });
});

// ─── Epic auto-advance (Phase 2.9) ───────────────────────────────────────────

describe('FactoryTaskStore epic auto-advance', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = makeStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper: creates a parent epic with N children at `startColumn`.
   * Returns { parent, children }.
   */
  function makeEpic(
    childCount: number,
    startColumn: string = 'start',
  ): { parent: FactoryTask; children: FactoryTask[] } {
    const parentTask = store.addTask('proj-1', { title: 'Epic', description: '' });
    const childDefs = Array.from({ length: childCount }, (_, i) => ({
      title: `Child ${i + 1}`,
      description: '',
    }));
    const { parent, children } = store.decomposeTask('proj-1', parentTask.id, startColumn, childDefs);
    return { parent, children };
  }

  it('auto-advances the parent epic to done when the last child reaches done', () => {
    const { parent, children } = makeEpic(2);
    // Move child[0] to done via the pipeline flow first
    store.moveTask('proj-1', children[0].id, 'inprogress');
    store.moveTask('proj-1', children[0].id, 'security');
    store.moveTask('proj-1', children[0].id, 'qa');
    store.moveTask('proj-1', children[0].id, 'documentation');
    store.moveTask('proj-1', children[0].id, 'done');

    // parent should still be in backlog — sibling not done yet
    expect(store.getTask('proj-1', parent.id)?.column).toBe('backlog');

    // Move child[1] to done
    store.moveTask('proj-1', children[1].id, 'inprogress');
    store.moveTask('proj-1', children[1].id, 'security');
    store.moveTask('proj-1', children[1].id, 'qa');
    store.moveTask('proj-1', children[1].id, 'documentation');
    store.moveTask('proj-1', children[1].id, 'done');

    // Both children done — parent must now be in done
    expect(store.getTask('proj-1', parent.id)?.column).toBe('done');
  });

  it('does not advance the parent when siblings are not all done', () => {
    const { parent, children } = makeEpic(2);
    // Move only the first child to done
    store.moveTask('proj-1', children[0].id, 'inprogress');
    store.moveTask('proj-1', children[0].id, 'security');
    store.moveTask('proj-1', children[0].id, 'qa');
    store.moveTask('proj-1', children[0].id, 'documentation');
    store.moveTask('proj-1', children[0].id, 'done');

    expect(store.getTask('proj-1', parent.id)?.column).toBe('backlog');
  });

  it('auto-advances immediately when there is only one child', () => {
    const { parent, children } = makeEpic(1);
    store.moveTask('proj-1', children[0].id, 'inprogress');
    store.moveTask('proj-1', children[0].id, 'security');
    store.moveTask('proj-1', children[0].id, 'qa');
    store.moveTask('proj-1', children[0].id, 'documentation');
    store.moveTask('proj-1', children[0].id, 'done');

    expect(store.getTask('proj-1', parent.id)?.column).toBe('done');
  });

  it('does not affect a task that has no parentTaskId', () => {
    const standalone = store.addTask('proj-1', { title: 'Standalone', description: '' });
    store.moveTask('proj-1', standalone.id, 'start');
    // just verify no crash and task moved normally
    expect(store.getTask('proj-1', standalone.id)?.column).toBe('start');
  });

  it('does not advance a non-epic parent', () => {
    // Create a parent and a child manually without going through decomposeTask
    // (so parent.isEpic is absent/false) to confirm the isEpic guard is active.
    const parent = store.addTask('proj-1', { title: 'Regular task', description: '' });
    const child = store.addTask('proj-1', { title: 'Child', description: '' });
    // Manually wire parentTaskId by updating the raw queue
    const queue = store.getQueue('proj-1');
    const childIdx = queue.tasks.findIndex((t) => t.id === child.id);
    (queue.tasks[childIdx] as FactoryTask) = {
      ...queue.tasks[childIdx],
      parentTaskId: parent.id,
      column: 'documentation',
    };
    // Write through a private saveQueue-equivalent by calling a mutation
    // that forces a save; simplest: use the store directly on the raw queue
    // file to avoid exposing internals.
    const filePath = path.join(tmpDir, 'proj-1.json');
    fs.writeFileSync(filePath, JSON.stringify({ projectId: 'proj-1', tasks: queue.tasks }));

    // Re-create store to pick up the patched file
    const fresh = makeStore(tmpDir);
    // Move child to done — parent should NOT be auto-advanced because isEpic is not set
    fresh.moveTask('proj-1', child.id, 'done');
    expect(fresh.getTask('proj-1', parent.id)?.column).toBe('backlog');
  });

  it('does not trigger when moving to a column other than done', () => {
    const { parent, children } = makeEpic(1);
    // Move to a non-done column
    store.moveTask('proj-1', children[0].id, 'inprogress');
    expect(store.getTask('proj-1', parent.id)?.column).toBe('backlog');
  });

  it('is idempotent when parent is already in done', () => {
    const { parent, children } = makeEpic(1);
    // Manually move the parent to done first
    const queue = store.getQueue('proj-1');
    const parentIdx = queue.tasks.findIndex((t) => t.id === parent.id);
    queue.tasks[parentIdx] = { ...queue.tasks[parentIdx], column: 'done' };
    const filePath = path.join(tmpDir, 'proj-1.json');
    fs.writeFileSync(filePath, JSON.stringify({ projectId: 'proj-1', tasks: queue.tasks }));

    const fresh = makeStore(tmpDir);
    // Move the child to done — auto-advance runs but parent already in done
    fresh.moveTask('proj-1', children[0].id, 'inprogress');
    fresh.moveTask('proj-1', children[0].id, 'security');
    fresh.moveTask('proj-1', children[0].id, 'qa');
    fresh.moveTask('proj-1', children[0].id, 'documentation');
    fresh.moveTask('proj-1', children[0].id, 'done');
    expect(fresh.getTask('proj-1', parent.id)?.column).toBe('done'); // still done, no crash
  });

  it('auto-advance is atomic — parent column persists in the same write as the child move', () => {
    const { parent, children } = makeEpic(1);
    // Move through the pipeline to done
    store.moveTask('proj-1', children[0].id, 'inprogress');
    store.moveTask('proj-1', children[0].id, 'security');
    store.moveTask('proj-1', children[0].id, 'qa');
    store.moveTask('proj-1', children[0].id, 'documentation');
    store.moveTask('proj-1', children[0].id, 'done');

    // Verify via a completely fresh store instance (true disk read)
    const fresh = makeStore(tmpDir);
    expect(fresh.getTask('proj-1', parent.id)?.column).toBe('done');
    expect(fresh.getTask('proj-1', children[0].id)?.column).toBe('done');
  });

  it('refreshes parent updatedAt when auto-advancing', () => {
    const { parent, children } = makeEpic(1);
    const originalUpdatedAt = parent.updatedAt;

    const sleepUntil = Date.now() + 5;
    while (Date.now() < sleepUntil) { /* spin */ }

    store.moveTask('proj-1', children[0].id, 'inprogress');
    store.moveTask('proj-1', children[0].id, 'security');
    store.moveTask('proj-1', children[0].id, 'qa');
    store.moveTask('proj-1', children[0].id, 'documentation');
    store.moveTask('proj-1', children[0].id, 'done');

    const advancedParent = store.getTask('proj-1', parent.id);
    expect(new Date(advancedParent!.updatedAt).getTime()).toBeGreaterThan(
      new Date(originalUpdatedAt).getTime(),
    );
  });

  it('does not crash when parentTaskId points to a non-existent task (orphaned child)', () => {
    // Manually create a task with a parentTaskId pointing to a ghost
    const child = store.addTask('proj-1', { title: 'Orphan', description: '' });
    const queue = store.getQueue('proj-1');
    const childIdx = queue.tasks.findIndex((t) => t.id === child.id);
    (queue.tasks[childIdx] as FactoryTask) = {
      ...queue.tasks[childIdx],
      parentTaskId: 'ghost-epic-id',
      column: 'documentation',
    };
    const filePath = path.join(tmpDir, 'proj-1.json');
    fs.writeFileSync(filePath, JSON.stringify({ projectId: 'proj-1', tasks: queue.tasks }));

    const fresh = makeStore(tmpDir);
    // Should not throw; parentIdx will be -1 and the auto-advance is skipped
    expect(() => fresh.moveTask('proj-1', child.id, 'done')).not.toThrow();
    expect(fresh.getTask('proj-1', child.id)?.column).toBe('done');
  });
});

// ─── Persistence across instances ────────────────────────────────────────────

describe('FactoryTaskStore persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('data persists across separate store instances', () => {
    const store1 = new FactoryTaskStore(tmpDir);
    store1.addTask('proj-1', { title: 'Persistent', description: 'Stays across instances' });

    const store2 = new FactoryTaskStore(tmpDir);
    const queue = store2.getQueue('proj-1');
    expect(queue.tasks).toHaveLength(1);
    expect(queue.tasks[0].title).toBe('Persistent');
  });

  it('move persists across fresh instance', () => {
    const store1 = makeStore(tmpDir);
    const task = store1.addTask('proj-1', { title: 'Moveable', description: '' });
    store1.moveTask('proj-1', task.id, 'start');

    const store2 = makeStore(tmpDir);
    const found = store2.getTask('proj-1', task.id);
    expect(found?.column).toBe('start');
  });
});
