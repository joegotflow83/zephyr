/**
 * Unit tests for registerFactoryTaskHandlers (Phase 3 IPC handlers).
 *
 * Tests cover:
 * - FACTORY_TASK_LIST   — returns task array for a project
 * - FACTORY_TASK_GET    — returns single task or null
 * - FACTORY_TASK_ADD    — creates task and broadcasts FACTORY_TASK_CHANGED
 * - FACTORY_TASK_MOVE   — allows forward/backward transitions; rejects invalid
 * - FACTORY_TASK_REMOVE — removes task and broadcasts
 * - FACTORY_TASK_SYNC   — reads project config and calls syncFromSpecs
 * - FACTORY_TASK_UPDATE — merges updates and broadcasts
 * - All mutation handlers broadcast FACTORY_TASK_CHANGED to all windows
 *
 * Strategy: mock electron's ipcMain + BrowserWindow so handlers can be
 * invoked directly without a running Electron process.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FactoryTask, FactoryColumn } from '../../src/shared/factory-types';
import { IPC } from '../../src/shared/ipc-channels';

// ─── Electron mock ────────────────────────────────────────────────────────────

// Capture ipcMain.handle registrations so we can invoke handlers in tests.
const registeredHandlers: Map<string, Function> = new Map();

const mockSend = vi.fn();
const mockIsDestroyed = vi.fn().mockReturnValue(false);
const mockWindow = { webContents: { send: mockSend }, isDestroyed: mockIsDestroyed };

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Function) => {
      registeredHandlers.set(channel, handler);
    },
  },
  BrowserWindow: {
    getAllWindows: () => [mockWindow],
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<FactoryTask> = {}): FactoryTask {
  return {
    id: 'task-1',
    title: 'Test Task',
    description: 'A description',
    column: 'backlog',
    projectId: 'proj-1',
    bounceCount: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Call a registered IPC handler as if from renderer (no real event object needed). */
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = registeredHandlers.get(channel);
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  return handler({} /* _event */, ...args);
}

// ─── Test setup ───────────────────────────────────────────────────────────────

describe('registerFactoryTaskHandlers', () => {
  let mockFactoryTaskStore: {
    getQueue: ReturnType<typeof vi.fn>;
    getTask: ReturnType<typeof vi.fn>;
    addTask: ReturnType<typeof vi.fn>;
    moveTask: ReturnType<typeof vi.fn>;
    removeTask: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
    syncFromSpecs: ReturnType<typeof vi.fn>;
  };

  let mockProjectStore: {
    getProject: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    registeredHandlers.clear();
    mockSend.mockClear();
    mockIsDestroyed.mockReturnValue(false);

    const task = makeTask();

    mockFactoryTaskStore = {
      getQueue: vi.fn().mockReturnValue({ projectId: 'proj-1', tasks: [task] }),
      getTask: vi.fn().mockReturnValue(task),
      addTask: vi.fn().mockReturnValue(task),
      moveTask: vi.fn().mockReturnValue({ ...task, column: 'start' }),
      removeTask: vi.fn(),
      updateTask: vi.fn().mockReturnValue({ ...task, title: 'Updated' }),
      syncFromSpecs: vi.fn().mockReturnValue([task]),
    };

    mockProjectStore = {
      getProject: vi.fn().mockReturnValue({
        id: 'proj-1',
        spec_files: { 'auth.md': true, 'billing.md': true },
        local_path: '/projects/proj-1',
      }),
    };

    // Import and register handlers fresh each test
    const { registerFactoryTaskHandlers } = await import(
      '../../src/main/ipc-handlers/factory-task-handlers'
    );
    registerFactoryTaskHandlers({
      factoryTaskStore: mockFactoryTaskStore as any,
      projectStore: mockProjectStore as any,
    });
  });

  // ── FACTORY_TASK_LIST ────────────────────────────────────────────────────────

  describe('FACTORY_TASK_LIST', () => {
    it('returns task array for a project', async () => {
      const result = await invoke(IPC.FACTORY_TASK_LIST, 'proj-1');
      expect(mockFactoryTaskStore.getQueue).toHaveBeenCalledWith('proj-1');
      expect(result).toEqual([makeTask()]);
    });

    it('does not broadcast on read', async () => {
      await invoke(IPC.FACTORY_TASK_LIST, 'proj-1');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // ── FACTORY_TASK_GET ─────────────────────────────────────────────────────────

  describe('FACTORY_TASK_GET', () => {
    it('returns single task by ID', async () => {
      const result = await invoke(IPC.FACTORY_TASK_GET, 'proj-1', 'task-1');
      expect(mockFactoryTaskStore.getTask).toHaveBeenCalledWith('proj-1', 'task-1');
      expect((result as FactoryTask).id).toBe('task-1');
    });

    it('returns null when task does not exist', async () => {
      mockFactoryTaskStore.getTask.mockReturnValue(null);
      const result = await invoke(IPC.FACTORY_TASK_GET, 'proj-1', 'missing');
      expect(result).toBeNull();
    });

    it('does not broadcast on read', async () => {
      await invoke(IPC.FACTORY_TASK_GET, 'proj-1', 'task-1');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // ── FACTORY_TASK_ADD ─────────────────────────────────────────────────────────

  describe('FACTORY_TASK_ADD', () => {
    it('creates task via store and returns it', async () => {
      const result = await invoke(IPC.FACTORY_TASK_ADD, 'proj-1', 'New Task', 'desc');
      expect(mockFactoryTaskStore.addTask).toHaveBeenCalledWith('proj-1', {
        title: 'New Task',
        description: 'desc',
      });
      expect((result as FactoryTask).id).toBe('task-1');
    });

    it('broadcasts FACTORY_TASK_CHANGED after adding', async () => {
      await invoke(IPC.FACTORY_TASK_ADD, 'proj-1', 'New Task', '');
      expect(mockSend).toHaveBeenCalledWith(
        IPC.FACTORY_TASK_CHANGED,
        'proj-1',
        expect.any(Array),
      );
    });
  });

  // ── FACTORY_TASK_MOVE ────────────────────────────────────────────────────────

  describe('FACTORY_TASK_MOVE', () => {
    it('allows valid forward transition', async () => {
      const moved = { ...makeTask(), column: 'start' as FactoryColumn };
      mockFactoryTaskStore.moveTask.mockReturnValue(moved);

      const result = await invoke(IPC.FACTORY_TASK_MOVE, 'proj-1', 'task-1', 'start');
      expect(mockFactoryTaskStore.moveTask).toHaveBeenCalledWith('proj-1', 'task-1', 'start');
      expect((result as FactoryTask).column).toBe('start');
    });

    it('allows valid backward transition', async () => {
      const moved = { ...makeTask(), column: 'backlog' as FactoryColumn };
      mockFactoryTaskStore.moveTask.mockReturnValue(moved);

      const result = await invoke(IPC.FACTORY_TASK_MOVE, 'proj-1', 'task-1', 'backlog');
      expect((result as FactoryTask).column).toBe('backlog');
    });

    it('propagates error for invalid transition from store', async () => {
      mockFactoryTaskStore.moveTask.mockImplementation(() => {
        throw new Error("Cannot move task from 'backlog' to 'done'");
      });

      await expect(
        invoke(IPC.FACTORY_TASK_MOVE, 'proj-1', 'task-1', 'done'),
      ).rejects.toThrow("Cannot move task from 'backlog' to 'done'");
    });

    it('broadcasts FACTORY_TASK_CHANGED after valid move', async () => {
      await invoke(IPC.FACTORY_TASK_MOVE, 'proj-1', 'task-1', 'start');
      expect(mockSend).toHaveBeenCalledWith(
        IPC.FACTORY_TASK_CHANGED,
        'proj-1',
        expect.any(Array),
      );
    });
  });

  // ── FACTORY_TASK_REMOVE ──────────────────────────────────────────────────────

  describe('FACTORY_TASK_REMOVE', () => {
    it('removes task via store', async () => {
      await invoke(IPC.FACTORY_TASK_REMOVE, 'proj-1', 'task-1');
      expect(mockFactoryTaskStore.removeTask).toHaveBeenCalledWith('proj-1', 'task-1');
    });

    it('broadcasts FACTORY_TASK_CHANGED after removal', async () => {
      await invoke(IPC.FACTORY_TASK_REMOVE, 'proj-1', 'task-1');
      expect(mockSend).toHaveBeenCalledWith(
        IPC.FACTORY_TASK_CHANGED,
        'proj-1',
        expect.any(Array),
      );
    });
  });

  // ── FACTORY_TASK_UPDATE ──────────────────────────────────────────────────────

  describe('FACTORY_TASK_UPDATE', () => {
    it('merges title update via store', async () => {
      const updated = { ...makeTask(), title: 'Updated' };
      mockFactoryTaskStore.updateTask.mockReturnValue(updated);

      const result = await invoke(IPC.FACTORY_TASK_UPDATE, 'proj-1', 'task-1', {
        title: 'Updated',
      });
      expect(mockFactoryTaskStore.updateTask).toHaveBeenCalledWith('proj-1', 'task-1', {
        title: 'Updated',
      });
      expect((result as FactoryTask).title).toBe('Updated');
    });

    it('merges description update via store', async () => {
      const updated = { ...makeTask(), description: 'New desc' };
      mockFactoryTaskStore.updateTask.mockReturnValue(updated);

      await invoke(IPC.FACTORY_TASK_UPDATE, 'proj-1', 'task-1', { description: 'New desc' });
      expect(mockFactoryTaskStore.updateTask).toHaveBeenCalledWith('proj-1', 'task-1', {
        description: 'New desc',
      });
    });

    it('broadcasts FACTORY_TASK_CHANGED after update', async () => {
      await invoke(IPC.FACTORY_TASK_UPDATE, 'proj-1', 'task-1', { title: 'X' });
      expect(mockSend).toHaveBeenCalledWith(
        IPC.FACTORY_TASK_CHANGED,
        'proj-1',
        expect.any(Array),
      );
    });
  });

  // ── FACTORY_TASK_SYNC ────────────────────────────────────────────────────────

  describe('FACTORY_TASK_SYNC', () => {
    it('reads project config and calls syncFromSpecs with full spec_files record and local_path', async () => {
      await invoke(IPC.FACTORY_TASK_SYNC, 'proj-1');
      expect(mockProjectStore.getProject).toHaveBeenCalledWith('proj-1');
      expect(mockFactoryTaskStore.syncFromSpecs).toHaveBeenCalledWith(
        'proj-1',
        { 'auth.md': true, 'billing.md': true },
        '/projects/proj-1',
      );
    });

    it('returns newly synced tasks', async () => {
      const result = await invoke(IPC.FACTORY_TASK_SYNC, 'proj-1');
      expect(result).toEqual([makeTask()]);
    });

    it('broadcasts FACTORY_TASK_CHANGED when new tasks are synced', async () => {
      await invoke(IPC.FACTORY_TASK_SYNC, 'proj-1');
      expect(mockSend).toHaveBeenCalledWith(
        IPC.FACTORY_TASK_CHANGED,
        'proj-1',
        expect.any(Array),
      );
    });

    it('does NOT broadcast when syncFromSpecs returns empty array', async () => {
      mockFactoryTaskStore.syncFromSpecs.mockReturnValue([]);
      await invoke(IPC.FACTORY_TASK_SYNC, 'proj-1');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('handles missing projectStore gracefully (no spec files)', async () => {
      // Re-register without projectStore
      registeredHandlers.clear();
      const { registerFactoryTaskHandlers } = await import(
        '../../src/main/ipc-handlers/factory-task-handlers'
      );
      registerFactoryTaskHandlers({ factoryTaskStore: mockFactoryTaskStore as any });

      mockFactoryTaskStore.syncFromSpecs.mockReturnValue([]);
      const result = await invoke(IPC.FACTORY_TASK_SYNC, 'proj-1');
      expect(mockFactoryTaskStore.syncFromSpecs).toHaveBeenCalledWith('proj-1', {}, undefined);
      expect(result).toEqual([]);
    });
  });

  // ── Broadcast to all windows ─────────────────────────────────────────────────

  describe('broadcast to all windows', () => {
    it('sends to all non-destroyed windows', async () => {
      await invoke(IPC.FACTORY_TASK_ADD, 'proj-1', 'T', '');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('skips destroyed windows', async () => {
      mockIsDestroyed.mockReturnValue(true);
      await invoke(IPC.FACTORY_TASK_ADD, 'proj-1', 'T', '');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
