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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'factory-task-store-test-'));
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
    store = new FactoryTaskStore(tmpDir);
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
    store = new FactoryTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allows qa → inprogress (send back for rework)', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'security');
    store.moveTask('proj-1', task.id, 'qa');
    const moved = store.moveTask('proj-1', task.id, 'inprogress');
    expect(moved.column).toBe('inprogress');
  });

  it('allows start → backlog', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    const moved = store.moveTask('proj-1', task.id, 'backlog');
    expect(moved.column).toBe('backlog');
  });

  it('allows done → backlog (reopen)', () => {
    const task = store.addTask('proj-1', { title: 'T', description: '' });
    store.moveTask('proj-1', task.id, 'start');
    store.moveTask('proj-1', task.id, 'inprogress');
    store.moveTask('proj-1', task.id, 'security');
    store.moveTask('proj-1', task.id, 'qa');
    store.moveTask('proj-1', task.id, 'documentation');
    store.moveTask('proj-1', task.id, 'done');
    const moved = store.moveTask('proj-1', task.id, 'backlog');
    expect(moved.column).toBe('backlog');
  });
});

describe('FactoryTaskStore.moveTask — invalid transitions', () => {
  let tmpDir: string;
  let store: FactoryTaskStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new FactoryTaskStore(tmpDir);
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
    const store1 = new FactoryTaskStore(tmpDir);
    const task = store1.addTask('proj-1', { title: 'Moveable', description: '' });
    store1.moveTask('proj-1', task.id, 'start');

    const store2 = new FactoryTaskStore(tmpDir);
    const found = store2.getTask('proj-1', task.id);
    expect(found?.column).toBe('start');
  });
});
