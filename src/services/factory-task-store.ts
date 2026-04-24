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
 * All transition validation is enforced here — callers do not need to
 * check ALLOWED_TRANSITIONS before calling moveTask.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import {
  FactoryColumn,
  FactoryTask,
  FactoryTaskQueue,
  ALLOWED_TRANSITIONS,
} from '../shared/factory-types';

const DEFAULT_BASE_PATH = path.join(os.homedir(), '.zephyr', 'factory-tasks');

export class FactoryTaskStore {
  private readonly basePath: string;

  /**
   * @param basePath - Directory to store per-project JSON files.
   *   Defaults to `~/.zephyr/factory-tasks/`. Pass a temp dir in tests.
   */
  constructor(basePath?: string) {
    this.basePath = basePath ?? DEFAULT_BASE_PATH;
    fs.mkdirSync(this.basePath, { recursive: true });
  }

  /** Returns the storage file path for a project's task queue. */
  private filePath(projectId: string): string {
    return path.join(this.basePath, `${projectId}.json`);
  }

  /**
   * Load and return the task queue for a project.
   * Returns `{ projectId, tasks: [] }` if the file is missing or corrupt.
   */
  getQueue(projectId: string): FactoryTaskQueue {
    try {
      const raw = fs.readFileSync(this.filePath(projectId), 'utf-8');
      return JSON.parse(raw) as FactoryTaskQueue;
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
   * Validates the transition against `ALLOWED_TRANSITIONS` — throws if
   * the move is not permitted. Also throws if the task ID does not exist.
   *
   * @returns The updated task.
   */
  moveTask(projectId: string, taskId: string, toColumn: FactoryColumn): FactoryTask {
    const queue = this.getQueue(projectId);
    const idx = queue.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) {
      throw new Error(`[FactoryTaskStore] Task not found: ${taskId}`);
    }
    const task = queue.tasks[idx];
    const allowed = ALLOWED_TRANSITIONS[task.column];
    if (!allowed.includes(toColumn)) {
      throw new Error(
        `[FactoryTaskStore] Invalid transition from '${task.column}' to '${toColumn}'. ` +
          `Allowed targets: ${allowed.join(', ')}`,
      );
    }
    const updated: FactoryTask = {
      ...task,
      column: toColumn,
      updatedAt: new Date().toISOString(),
    };
    queue.tasks[idx] = updated;
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
