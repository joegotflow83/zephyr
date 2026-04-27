/**
 * Unit tests for registerPipelineHandlers (Phase 1.9 IPC handlers).
 *
 * Tests cover:
 * - PIPELINE_LIST   — returns pipeline array
 * - PIPELINE_GET    — returns single pipeline or null
 * - PIPELINE_ADD    — creates pipeline and broadcasts PIPELINE_CHANGED
 * - PIPELINE_UPDATE — patches pipeline and broadcasts
 * - PIPELINE_REMOVE — deletes pipeline and broadcasts
 * - Read handlers do NOT broadcast (prevents storm on UI polling).
 * - Store errors (unknown id, edit built-in, id collision) propagate via IPC.
 * - Broadcast fans out to non-destroyed windows only.
 *
 * Strategy: mock electron's ipcMain + BrowserWindow so handlers can be
 * invoked directly without a running Electron process. Mock the
 * PipelineStore interface so each handler's delegation is asserted in
 * isolation — store semantics (reconciliation, atomic writes) are the
 * responsibility of pipeline-store.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pipeline } from '../../src/shared/pipeline-types';
import { IPC } from '../../src/shared/ipc-channels';

// ─── Electron mock ────────────────────────────────────────────────────────────

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

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'pipe-1',
    name: 'Test Pipeline',
    description: 'desc',
    stages: [
      {
        id: 'coder',
        name: 'Coder',
        agentPrompt: 'write code',
        instances: 1,
      },
    ],
    bounceLimit: 3,
    builtIn: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = registeredHandlers.get(channel);
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  return handler({} /* _event */, ...args);
}

// ─── Test setup ───────────────────────────────────────────────────────────────

describe('registerPipelineHandlers', () => {
  let mockPipelineStore: {
    listPipelines: ReturnType<typeof vi.fn>;
    getPipeline: ReturnType<typeof vi.fn>;
    addPipeline: ReturnType<typeof vi.fn>;
    updatePipeline: ReturnType<typeof vi.fn>;
    removePipeline: ReturnType<typeof vi.fn>;
  };
  let mockProjectStore: {
    clearDanglingPipelineId: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    registeredHandlers.clear();
    mockSend.mockClear();
    mockIsDestroyed.mockReturnValue(false);

    const pipeline = makePipeline();
    mockPipelineStore = {
      listPipelines: vi.fn().mockReturnValue([pipeline]),
      getPipeline: vi.fn().mockReturnValue(pipeline),
      addPipeline: vi.fn().mockReturnValue(pipeline),
      updatePipeline: vi.fn().mockReturnValue({ ...pipeline, name: 'Renamed' }),
      removePipeline: vi.fn(),
    };
    mockProjectStore = {
      clearDanglingPipelineId: vi.fn().mockReturnValue(0),
    };

    const { registerPipelineHandlers } = await import(
      '../../src/main/ipc-handlers/pipeline-handlers'
    );
    registerPipelineHandlers({
      pipelineStore: mockPipelineStore as any,
      projectStore: mockProjectStore as any,
    });
  });

  // ── PIPELINE_LIST ──────────────────────────────────────────────────────────

  describe('PIPELINE_LIST', () => {
    it('returns pipeline array', async () => {
      const result = await invoke(IPC.PIPELINE_LIST);
      expect(mockPipelineStore.listPipelines).toHaveBeenCalledTimes(1);
      expect(result).toEqual([makePipeline()]);
    });

    it('does not broadcast on read', async () => {
      await invoke(IPC.PIPELINE_LIST);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // ── PIPELINE_GET ───────────────────────────────────────────────────────────

  describe('PIPELINE_GET', () => {
    it('returns single pipeline by id', async () => {
      const result = await invoke(IPC.PIPELINE_GET, 'pipe-1');
      expect(mockPipelineStore.getPipeline).toHaveBeenCalledWith('pipe-1');
      expect((result as Pipeline).id).toBe('pipe-1');
    });

    it('returns null when pipeline does not exist', async () => {
      mockPipelineStore.getPipeline.mockReturnValue(null);
      const result = await invoke(IPC.PIPELINE_GET, 'missing');
      expect(result).toBeNull();
    });

    it('does not broadcast on read', async () => {
      await invoke(IPC.PIPELINE_GET, 'pipe-1');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // ── PIPELINE_ADD ───────────────────────────────────────────────────────────

  describe('PIPELINE_ADD', () => {
    it('creates pipeline via store and returns it', async () => {
      const input = {
        id: 'pipe-1',
        name: 'Test Pipeline',
        stages: makePipeline().stages,
        bounceLimit: 3,
      };
      const result = await invoke(IPC.PIPELINE_ADD, input);
      expect(mockPipelineStore.addPipeline).toHaveBeenCalledWith(input);
      expect((result as Pipeline).id).toBe('pipe-1');
    });

    it('broadcasts PIPELINE_CHANGED with the refreshed list after adding', async () => {
      const listAfter = [makePipeline(), makePipeline({ id: 'pipe-2' })];
      mockPipelineStore.listPipelines.mockReturnValue(listAfter);

      await invoke(IPC.PIPELINE_ADD, {
        name: 'New',
        stages: makePipeline().stages,
        bounceLimit: 3,
      });

      expect(mockSend).toHaveBeenCalledWith(IPC.PIPELINE_CHANGED, listAfter);
    });

    it('propagates store errors (duplicate id) over IPC', async () => {
      mockPipelineStore.addPipeline.mockImplementation(() => {
        throw new Error('[PipelineStore] Pipeline id already exists: pipe-1');
      });

      await expect(
        invoke(IPC.PIPELINE_ADD, {
          id: 'pipe-1',
          name: 'Dup',
          stages: makePipeline().stages,
          bounceLimit: 3,
        }),
      ).rejects.toThrow('Pipeline id already exists');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // ── PIPELINE_UPDATE ────────────────────────────────────────────────────────

  describe('PIPELINE_UPDATE', () => {
    it('patches pipeline via store and returns merged result', async () => {
      const result = await invoke(IPC.PIPELINE_UPDATE, 'pipe-1', { name: 'Renamed' });
      expect(mockPipelineStore.updatePipeline).toHaveBeenCalledWith('pipe-1', {
        name: 'Renamed',
      });
      expect((result as Pipeline).name).toBe('Renamed');
    });

    it('broadcasts PIPELINE_CHANGED after update', async () => {
      await invoke(IPC.PIPELINE_UPDATE, 'pipe-1', { name: 'Renamed' });
      expect(mockSend).toHaveBeenCalledWith(
        IPC.PIPELINE_CHANGED,
        expect.any(Array),
      );
    });

    it('propagates store errors (edit built-in) over IPC', async () => {
      mockPipelineStore.updatePipeline.mockImplementation(() => {
        throw new Error(
          "[PipelineStore] Cannot edit built-in pipeline 'classic-factory'. Clone it first.",
        );
      });

      await expect(
        invoke(IPC.PIPELINE_UPDATE, 'classic-factory', { name: 'Hack' }),
      ).rejects.toThrow('Cannot edit built-in pipeline');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // ── PIPELINE_REMOVE ────────────────────────────────────────────────────────

  describe('PIPELINE_REMOVE', () => {
    it('removes pipeline via store', async () => {
      await invoke(IPC.PIPELINE_REMOVE, 'pipe-1');
      expect(mockPipelineStore.removePipeline).toHaveBeenCalledWith('pipe-1');
    });

    it('clears dangling pipelineId from projects after removal', async () => {
      await invoke(IPC.PIPELINE_REMOVE, 'pipe-1');
      expect(mockProjectStore.clearDanglingPipelineId).toHaveBeenCalledWith('pipe-1');
    });

    it('broadcasts PIPELINE_CHANGED after removal', async () => {
      await invoke(IPC.PIPELINE_REMOVE, 'pipe-1');
      expect(mockSend).toHaveBeenCalledWith(
        IPC.PIPELINE_CHANGED,
        expect.any(Array),
      );
    });

    it('propagates store errors (unknown id) over IPC', async () => {
      mockPipelineStore.removePipeline.mockImplementation(() => {
        throw new Error('[PipelineStore] Pipeline not found: missing');
      });

      await expect(invoke(IPC.PIPELINE_REMOVE, 'missing')).rejects.toThrow(
        'Pipeline not found',
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('does not clear dangling pipelineIds when removal throws', async () => {
      mockPipelineStore.removePipeline.mockImplementation(() => {
        throw new Error('[PipelineStore] Pipeline not found: missing');
      });

      await expect(invoke(IPC.PIPELINE_REMOVE, 'missing')).rejects.toThrow();
      expect(mockProjectStore.clearDanglingPipelineId).not.toHaveBeenCalled();
    });
  });

  // ── Broadcast fan-out ──────────────────────────────────────────────────────

  describe('broadcast to all windows', () => {
    it('sends to all non-destroyed windows', async () => {
      await invoke(IPC.PIPELINE_ADD, {
        name: 'X',
        stages: makePipeline().stages,
        bounceLimit: 3,
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('skips destroyed windows', async () => {
      mockIsDestroyed.mockReturnValue(true);
      await invoke(IPC.PIPELINE_ADD, {
        name: 'X',
        stages: makePipeline().stages,
        bounceLimit: 3,
      });
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
