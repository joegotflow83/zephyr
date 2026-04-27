/**
 * FactoryTaskStore — persistent storage for Coding Factory kanban tasks.
 *
 * Each project's task queue is stored as a JSON file at
 * `<basePath>/<projectId>.json` (default: `~/.zephyr/factory-tasks/`).
 *
 * Atomic writes prevent data corruption: data is written to a `.tmp` file
 * first, then renamed over the destination atomically (same pattern as
 * ConfigManager and DeployKeyStore).
 *
 * All transition validation is enforced here against the project's active
 * pipeline (via the injected `getPipelineForProject` callback) — callers do
 * not need to consult `deriveTransitions` before calling `moveTask`.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import {
  FactoryTask,
  FactoryTaskQueue,
} from '../shared/factory-types';
import type { Pipeline } from '../shared/pipeline-types';
import { columnsFor } from '../shared/pipeline-types';
import { deriveTransitions } from '../lib/pipeline/transitions';

const DEFAULT_BASE_PATH = path.join(os.homedir(), '.zephyr', 'factory-tasks');

/**
 * Optional dependencies injected at construction time.
 *
 * `getPipelineForProject` is required for {@link FactoryTaskStore.moveTask}
 * to validate transitions against the project's active pipeline. The store
 * does not depend on `ProjectStore`/`PipelineStore` directly so tests can
 * pass a static stub without bootstrapping the full service graph.
 */
export interface FactoryTaskStoreDeps {
  /**
   * Resolve the active pipeline for a project.
   *
   * Return `null` when the project has no `pipelineId` assigned. `moveTask`
   * throws a clear "no pipeline assigned" error in that case so the renderer
   * can surface a single, actionable message (see Phase 2.6 for the
   * `FACTORY_START` parallel).
   */
  getPipelineForProject?: (projectId: string) => Pipeline | null;
}

export class FactoryTaskStore {
  private readonly basePath: string;
  private readonly deps: FactoryTaskStoreDeps;

  /**
   * @param basePath - Directory to store per-project JSON files.
   *   Defaults to `~/.zephyr/factory-tasks/`. Pass a temp dir in tests.
   * @param deps - Optional dependencies. `getPipelineForProject` is required
   *   for `moveTask` in production; tests may stub it inline.
   */
  constructor(basePath?: string, deps: FactoryTaskStoreDeps = {}) {
    this.basePath = basePath ?? DEFAULT_BASE_PATH;
    this.deps = deps;
    fs.mkdirSync(this.basePath, { recursive: true });
  }

  /** Returns the storage file path for a project's task queue. */
  private filePath(projectId: string): string {
    return path.join(this.basePath, `${projectId}.json`);
  }

  /**
   * Load and return the task queue for a project.
   *
   * Returns `{ projectId, tasks: [] }` if the file is missing or corrupt.
   *
   * Legacy migration: `bounceCount` became required in Phase 1.4. Queues
   * written before that may have tasks lacking the field, which would let
   * `undefined` flow through spread-copies in `moveTask`/`lockTask`/etc. and
   * eventually poison the bounce-limit gate (Phase 2.4) with `NaN`. Every
   * task is normalised here at load time so all downstream operators see a
   * concrete number. The migration is in-memory only — the next mutation
   * naturally persists the normalised form, so we don't pay a write on read.
   */
  getQueue(projectId: string): FactoryTaskQueue {
    try {
      const raw = fs.readFileSync(this.filePath(projectId), 'utf-8');
      const parsed = JSON.parse(raw) as FactoryTaskQueue;
      return {
        ...parsed,
        tasks: (parsed.tasks ?? []).map(migrateLegacyTask),
      };
    } catch (err: unknown) {
      if (isNodeError(err) && err.code !== 'ENOENT') {
        // eslint-disable-next-line no-console
        console.warn(`[FactoryTaskStore] Failed to load queue for ${projectId}:`, err);
      }
      return { projectId, tasks: [] };
    }
  }

  /**
   * Atomically persist a task queue to disk.
   *
   * Writes to a `.tmp` file then renames to prevent partial-write corruption.
   */
  saveQueue(queue: FactoryTaskQueue): void {
    fs.mkdirSync(this.basePath, { recursive: true });
    const dest = this.filePath(queue.projectId);
    const tmp = `${dest}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(queue, null, 2), 'utf-8');
      fs.renameSync(tmp, dest);
    } catch (err) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }

  /**
   * Create a new task in the backlog for a project.
   *
   * Generates a UUID and ISO timestamps automatically. The task always
   * starts in the `backlog` column regardless of caller input.
   */
  addTask(
    projectId: string,
    task: { title: string; description: string; sourceFile?: string },
  ): FactoryTask {
    const queue = this.getQueue(projectId);
    const now = new Date().toISOString();
    const newTask: FactoryTask = {
      id: randomUUID(),
      title: task.title,
      description: task.description,
      column: 'backlog',
      projectId,
      sourceFile: task.sourceFile,
      bounceCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    queue.tasks.push(newTask);
    this.saveQueue(queue);
    return newTask;
  }

  /**
   * Move a task to a different pipeline column.
   *
   * Validates the transition against the project's active pipeline. Throws if:
   *   - the task ID does not exist,
   *   - the project has no pipeline assigned,
   *   - without `opts.agentRejection`: the column is not adjacent to the current
   *     one (or `'blocked'`, which is universally reachable per spec §Blocked).
   *   - with `opts.agentRejection`: the column is not a valid pipeline column.
   *
   * `opts.agentRejection` bypasses the adjacency constraint so agents can send
   * a task to any earlier stage per spec §Rejection: "toStage can be any earlier
   * stage ID". Kanban drag-drop always uses the default (adjacency enforced).
   *
   * Side effects on a successful move:
   *   - **Backward bounce accounting**: when both the source and target are
   *     flow columns and the target lies earlier in flow order,
   *     `bounceCount` is incremented. The Phase 2.4 gate
   *     (`bounceCount >= pipeline.bounceLimit`) reads the result to redirect
   *     to Blocked. Moves to/from `'blocked'` do not increment — Blocked is a
   *     human-triage escape hatch, not a pipeline rejection.
   *   - **Lock release**: `lockedBy` is cleared on every transition. The
   *     agent that was holding the task is no longer responsible once the
   *     stage changes; the next stage's instances re-acquire via `lockTask`.
   *
   * @returns The updated task.
   */
  moveTask(projectId: string, taskId: string, toColumn: string, opts?: { agentRejection?: boolean }): FactoryTask {
    const queue = this.getQueue(projectId);
    const idx = queue.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) {
      throw new Error(`[FactoryTaskStore] Task not found: ${taskId}`);
    }
    const task = queue.tasks[idx];

    const pipeline = this.deps.getPipelineForProject?.(projectId);
    if (!pipeline) {
      throw new Error(
        `[FactoryTaskStore] Cannot move task ${taskId}: no pipeline assigned to project ${projectId}`,
      );
    }

    if (opts?.agentRejection) {
      // Agent-initiated rejections may target any valid pipeline column — not
      // just the adjacent one. Spec §Rejection: "toStage can be any earlier
      // stage ID". We still validate that the column actually exists so a
      // typo in the agent's @task-status.json doesn't silently corrupt state.
      const validColumns = columnsFor(pipeline);
      if (!validColumns.includes(toColumn)) {
        throw new Error(
          `[FactoryTaskStore] Unknown target column '${toColumn}' for agent rejection. ` +
            `Valid columns: ${validColumns.join(', ')}`,
        );
      }
    } else {
      // Kanban drag-drop: enforce adjacency so the human cannot accidentally
      // skip stages on the board.
      const { allowed } = deriveTransitions(pipeline);
      const allowedTargets = allowed[task.column] ?? [];
      if (!allowedTargets.includes(toColumn)) {
        throw new Error(
          `[FactoryTaskStore] Invalid transition from '${task.column}' to '${toColumn}'. ` +
            `Allowed targets: ${allowedTargets.join(', ')}`,
        );
      }
    }

    // Backward = both columns are in the flow array (i.e. neither is
    // 'blocked') AND the target index is earlier than the source. This
    // distinguishes a rejection (qa → coder) from a Blocked escalation
    // (qa → blocked) and from a Blocked resumption (blocked → coder); only
    // the first counts toward the bounce budget.
    const flow = ['backlog', ...pipeline.stages.map((s) => s.id), 'done'];
    const fromIdx = flow.indexOf(task.column);
    const toIdx = flow.indexOf(toColumn);
    const isBackward = fromIdx > -1 && toIdx > -1 && toIdx < fromIdx;

    const newBounceCount = isBackward ? (task.bounceCount ?? 0) + 1 : task.bounceCount ?? 0;

    // Phase 2.4 gate: when a backward bounce pushes `bounceCount` to/above
    // `pipeline.bounceLimit`, redirect the task to Blocked instead of the
    // agent's requested column. The increment still applies (the budget is
    // consumed) and the original `toColumn` is intentionally discarded — host
    // escalation supplants the agent's local routing decision so PM (see 2.10)
    // can pick the task up from Blocked. Only `isBackward` moves can trigger
    // the gate; forward, flow→blocked, and blocked→flow moves never escalate
    // even if the counter is already at/over limit, because they don't
    // increment the counter and therefore aren't bounce events.
    const targetColumn = isBackward && newBounceCount >= pipeline.bounceLimit
      ? 'blocked'
      : toColumn;

    const updated: FactoryTask = {
      ...task,
      column: targetColumn,
      bounceCount: newBounceCount,
      lockedBy: undefined,
      updatedAt: new Date().toISOString(),
    };
    queue.tasks[idx] = updated;

    // Phase 2.9 — Epic auto-advance.
    // When the last sub-task reaches 'done', automatically move the parent epic
    // to 'done' in the same atomic saveQueue call. Only triggers when:
    //   1. the task just landed in 'done' (not blocked or any other column),
    //   2. the task has a parentTaskId,
    //   3. the parent exists in this queue and has isEpic: true, and
    //   4. every OTHER sibling (same parentTaskId) is already in 'done'.
    // We skip the transition-validation that moveTask enforces for agent moves:
    // this is a host-side automatic promotion — the parent may be in any column
    // (most likely backlog, but could be blocked if the PM escalated the epic).
    if (updated.column === 'done' && updated.parentTaskId) {
      const parentIdx = queue.tasks.findIndex((t) => t.id === updated.parentTaskId);
      if (parentIdx > -1 && queue.tasks[parentIdx].isEpic) {
        const siblings = queue.tasks.filter(
          (t) => t.parentTaskId === updated.parentTaskId && t.id !== taskId,
        );
        if (siblings.every((t) => t.column === 'done')) {
          queue.tasks[parentIdx] = {
            ...queue.tasks[parentIdx],
            column: 'done',
            updatedAt: new Date().toISOString(),
          };
        }
      }
    }

    this.saveQueue(queue);
    return updated;
  }

  /**
   * Permanently remove a task from a project's queue.
   *
   * No-ops silently if the task ID is not found (idempotent).
   */
  removeTask(projectId: string, taskId: string): void {
    const queue = this.getQueue(projectId);
    queue.tasks = queue.tasks.filter((t) => t.id !== taskId);
    this.saveQueue(queue);
  }

  /**
   * Merge partial updates (title, description) into an existing task.
   *
   * Updates `updatedAt` to now. Throws if the task ID does not exist.
   *
   * @returns The updated task.
   */
  updateTask(
    projectId: string,
    taskId: string,
    updates: Partial<Pick<FactoryTask, 'title' | 'description'>>,
  ): FactoryTask {
    const queue = this.getQueue(projectId);
    const idx = queue.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) {
      throw new Error(`[FactoryTaskStore] Task not found: ${taskId}`);
    }
    const updated: FactoryTask = {
      ...queue.tasks[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    queue.tasks[idx] = updated;
    this.saveQueue(queue);
    return updated;
  }

  /**
   * Look up a single task by ID.
   *
   * Returns `null` if not found (caller decides how to handle missing tasks).
   */
  getTask(projectId: string, taskId: string): FactoryTask | null {
    const queue = this.getQueue(projectId);
    return queue.tasks.find((t) => t.id === taskId) ?? null;
  }

  /**
   * Acquire a task lock for an agent container.
   *
   * Each pipeline stage instance is identified by `lockId` of the form
   * `<stageId>-<instanceIndex>` (e.g. `coder-0`). When two instances race for
   * the same task, the first writer wins; the loser sees a thrown error and
   * picks a different task on its next iteration (per spec §Concurrent Town).
   *
   * Idempotent re-lock by the same owner: if `task.lockedBy === lockId`, this
   * is a no-op and the task is returned unchanged (no disk write). This makes
   * the call safe under container restarts where the same instance may retry
   * its own outstanding lock.
   *
   * Read-modify-write through `saveQueue` is atomic at the file level
   * (`.tmp → rename`), but the load-then-save sequence is *not* atomic across
   * processes. The single host process owning the task store serialises all
   * lock attempts, so the in-process JS event loop is the synchronisation
   * primitive — concurrent agents in containers must always go through IPC.
   *
   * @throws if the task is unknown or already locked by a different owner
   */
  lockTask(projectId: string, taskId: string, lockId: string): FactoryTask {
    const queue = this.getQueue(projectId);
    const idx = queue.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) {
      throw new Error(`[FactoryTaskStore] Task not found: ${taskId}`);
    }
    const task = queue.tasks[idx];
    if (task.lockedBy && task.lockedBy !== lockId) {
      throw new Error(
        `[FactoryTaskStore] Task ${taskId} already locked by '${task.lockedBy}' ` +
          `(requested by '${lockId}')`,
      );
    }
    if (task.lockedBy === lockId) {
      return task;
    }
    const updated: FactoryTask = {
      ...task,
      lockedBy: lockId,
      updatedAt: new Date().toISOString(),
    };
    queue.tasks[idx] = updated;
    this.saveQueue(queue);
    return updated;
  }

  /**
   * Release a task lock.
   *
   * Idempotent — no-op (no disk write) if the task is already unlocked. Does
   * NOT verify which owner is releasing the lock; clearing on stage transition
   * happens in `moveTask` (Phase 2.3) and on `FACTORY_STOP` (Phase 2.12), both
   * of which legitimately release locks regardless of holder.
   *
   * @throws if the task is unknown
   */
  unlockTask(projectId: string, taskId: string): FactoryTask {
    const queue = this.getQueue(projectId);
    const idx = queue.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) {
      throw new Error(`[FactoryTaskStore] Task not found: ${taskId}`);
    }
    const task = queue.tasks[idx];
    if (!task.lockedBy) {
      return task;
    }
    const updated: FactoryTask = {
      ...task,
      lockedBy: undefined,
      updatedAt: new Date().toISOString(),
    };
    queue.tasks[idx] = updated;
    this.saveQueue(queue);
    return updated;
  }

  /**
   * Atomically create sub-tasks for an epic and mark the parent as `isEpic: true`.
   *
   * All children are added and the parent flag is flipped in a single
   * `saveQueue` call so a crash mid-decomposition cannot leave the parent
   * un-flagged with some sub-tasks already created. Without this guarantee,
   * the host watcher (Phase 2.8) would re-run on the next trigger and create
   * duplicates because its idempotency relies on the source decomposition file
   * being deleted *after* a fully successful processing pass.
   *
   * Children land in `childColumn` (typically the first pipeline stage id —
   * not `'backlog'`). The spec (§Decomposition) is explicit: sub-tasks enter
   * the pipeline immediately so PM does not re-process them. Each child gets
   * a fresh UUID, the supplied `parentTaskId`, `bounceCount: 0`, and shares
   * the parent's `projectId`.
   *
   * The parent's `column` is intentionally **unchanged**. Per spec §Epic,
   * the epic stays in Backlog as a progress tracker; auto-advancement to
   * Done lands in Phase 2.9 as a separate move-task hook.
   *
   * @throws if `parentTaskId` is unknown
   * @returns the updated parent and the array of newly-created children, in
   *   the order they appeared in `children`
   */
  decomposeTask(
    projectId: string,
    parentTaskId: string,
    childColumn: string,
    children: Array<{ title: string; description: string }>,
  ): { parent: FactoryTask; children: FactoryTask[] } {
    const queue = this.getQueue(projectId);
    const parentIdx = queue.tasks.findIndex((t) => t.id === parentTaskId);
    if (parentIdx === -1) {
      throw new Error(`[FactoryTaskStore] Task not found: ${parentTaskId}`);
    }

    const now = new Date().toISOString();
    const updatedParent: FactoryTask = {
      ...queue.tasks[parentIdx],
      isEpic: true,
      updatedAt: now,
    };
    queue.tasks[parentIdx] = updatedParent;

    const createdChildren: FactoryTask[] = children.map((child) => ({
      id: randomUUID(),
      title: child.title,
      description: child.description,
      column: childColumn,
      projectId,
      parentTaskId,
      bounceCount: 0,
      createdAt: now,
      updatedAt: now,
    }));
    queue.tasks.push(...createdChildren);

    this.saveQueue(queue);
    return { parent: updatedParent, children: createdChildren };
  }

  /**
   * Atomically increment a task's `bounceCount`.
   *
   * Called on every backward transition (rejection / send-back). Phase 2.3
   * wires this into `moveTask`; Phase 2.4 reads the result against
   * `pipeline.bounceLimit` to redirect to Blocked. Kept as a separate method
   * so the loop guard logic can also count host-driven bounces (e.g. agent
   * timeout) without going through `moveTask`.
   *
   * @throws if the task is unknown
   */
  incrementBounceCount(projectId: string, taskId: string): FactoryTask {
    const queue = this.getQueue(projectId);
    const idx = queue.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) {
      throw new Error(`[FactoryTaskStore] Task not found: ${taskId}`);
    }
    const task = queue.tasks[idx];
    const updated: FactoryTask = {
      ...task,
      bounceCount: (task.bounceCount ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    queue.tasks[idx] = updated;
    this.saveQueue(queue);
    return updated;
  }

  /**
   * Import spec files as backlog tasks — skips files already tracked.
   *
   * Matching is done by `sourceFile` field so renaming a file creates a
   * new task rather than updating the existing one.
   *
   * When `localPath` is provided, also scans `<localPath>/specs/*.md` from
   * disk. Disk content takes precedence over the in-memory `specFiles` map
   * (disk files are fresher). Files found only in `specFiles` use their
   * mapped content as the task description.
   *
   * All new tasks are persisted in a single atomic write for efficiency.
   *
   * @param specFiles - Map of spec filename → content (e.g. `{ 'auth.md': '# Auth' }`)
   * @param localPath - Optional project local path; `<localPath>/specs/*.md` are scanned
   * @returns Array of newly created tasks (empty if all already tracked)
   */
  syncFromSpecs(
    projectId: string,
    specFiles: Record<string, string>,
    localPath?: string,
  ): FactoryTask[] {
    const queue = this.getQueue(projectId);
    const existingSourceFiles = new Set(
      queue.tasks.map((t) => t.sourceFile).filter((s): s is string => Boolean(s)),
    );

    // Build candidates map: filename → content (in-memory values as baseline)
    const candidates = new Map<string, string>(Object.entries(specFiles));

    // Disk files take precedence — read their content and override in-memory values
    if (localPath) {
      const specsDir = path.join(localPath, 'specs');
      try {
        const diskFiles = fs.readdirSync(specsDir).filter((f) => f.endsWith('.md'));
        for (const filename of diskFiles) {
          try {
            const content = fs.readFileSync(path.join(specsDir, filename), 'utf-8');
            candidates.set(filename, content);
          } catch {
            // If content can't be read, keep in-memory version or use empty string
            if (!candidates.has(filename)) {
              candidates.set(filename, '');
            }
          }
        }
      } catch (err: unknown) {
        if (!isNodeError(err) || err.code !== 'ENOENT') {
          // eslint-disable-next-line no-console
          console.warn(`[FactoryTaskStore] Failed to scan ${specsDir}:`, err);
        }
        // ENOENT → specs dir simply doesn't exist yet; skip silently
      }
    }

    const now = new Date().toISOString();
    const newTasks: FactoryTask[] = [];

    for (const [specFile, content] of candidates) {
      if (!existingSourceFiles.has(specFile)) {
        const task: FactoryTask = {
          id: randomUUID(),
          title: specFileToTitle(specFile),
          description: content,
          column: 'backlog',
          projectId,
          sourceFile: specFile,
          bounceCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        queue.tasks.push(task);
        newTasks.push(task);
        existingSourceFiles.add(specFile);
      }
    }

    if (newTasks.length > 0) {
      this.saveQueue(queue);
    }

    return newTasks;
  }
}

/**
 * Convert a kebab-case spec filename to a Title Case display title.
 *
 * Examples:
 *   "auth-refactor.md"    → "Auth Refactor"
 *   "add-payment-flow.md" → "Add Payment Flow"
 *   "README.md"           → "README"
 */
function specFileToTitle(filename: string): string {
  return filename
    .replace(/\.md$/i, '')
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/**
 * Coerce a task loaded from disk into the current schema.
 *
 * Today this only fills in `bounceCount: 0` for queues persisted before the
 * field was introduced. Future schema additions should extend this helper
 * rather than scattering `?? defaults` through every accessor.
 */
function migrateLegacyTask(task: FactoryTask): FactoryTask {
  if (typeof task.bounceCount === 'number') {
    return task;
  }
  return { ...task, bounceCount: 0 };
}
