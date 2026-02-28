/**
 * Unit tests for src/main/ipc-handlers/vm-handlers.ts
 *
 * Verifies that registerVMHandlers() correctly wires IPC channels to
 * VMManager and LoopRunner methods. Each handler is extracted via the mock
 * ipcMain.handle registry, then called directly to confirm routing.
 *
 * Why we test routing: the IPC layer is the boundary between renderer and
 * main process. A mis-wired channel means the renderer silently gets undefined
 * or stale data. Unit tests here catch those regressions cheaply, without
 * needing a real Electron process.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../src/shared/ipc-channels';

// ── Mock electron ─────────────────────────────────────────────────────────────

const handlerRegistry: Record<string, (...args: unknown[]) => unknown> = {};

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

// ── Mock logging ──────────────────────────────────────────────────────────────

vi.mock('../../src/services/logging', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Import subject under test (after mocks are in place) ─────────────────────

import { registerVMHandlers } from '../../src/main/ipc-handlers/vm-handlers';

// ── Helpers ───────────────────────────────────────────────────────────────────

const createFakeEvent = (): IpcMainInvokeEvent => ({
  sender: { send: mockWebContentsSend },
} as unknown as IpcMainInvokeEvent);

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlerRegistry[channel];
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  return handler(createFakeEvent(), ...args);
}

// ── Service mocks ─────────────────────────────────────────────────────────────

const mockVMManager = {
  isMultipassAvailable: vi.fn(),
  getVersion: vi.fn(),
  listVMs: vi.fn(),
  getVMInfo: vi.fn(),
  createVM: vi.fn(),
  startVM: vi.fn(),
  stopVM: vi.fn(),
  deleteVM: vi.fn(),
  isZephyrVM: vi.fn(),
};

const mockLoopRunner = {
  startProjectVM: vi.fn(),
  stopProjectVM: vi.fn(),
  getProjectVMInfo: vi.fn(),
};

const sampleVMInfo = {
  name: 'zephyr-proj1234-abc1',
  state: 'Running' as const,
  ipv4: '10.0.0.1',
  cpus: 2,
  memory: '4G',
  disk: '20G',
  release: '22.04',
};

// ── Setup ─────────────────────────────────────────────────────────────────────

describe('registerVMHandlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const key of Object.keys(handlerRegistry)) {
      delete handlerRegistry[key];
    }
    registerVMHandlers({
      vmManager: mockVMManager as never,
      loopRunner: mockLoopRunner as never,
    });
    // Default: one window available for broadcast tests
    mockBrowserWindow.getAllWindows.mockReturnValue([
      { webContents: { send: mockWebContentsSend } },
    ]);
  });

  // ── vm:status ────────────────────────────────────────────────────────────────

  describe('vm:status', () => {
    it('returns available:false when Multipass is unavailable', async () => {
      mockVMManager.isMultipassAvailable.mockResolvedValue(false);
      const result = await invoke(IPC.VM_STATUS);
      expect(mockVMManager.isMultipassAvailable).toHaveBeenCalledOnce();
      expect(result).toEqual({ available: false });
      expect(mockVMManager.getVersion).not.toHaveBeenCalled();
    });

    it('returns available:true with version when Multipass is available', async () => {
      mockVMManager.isMultipassAvailable.mockResolvedValue(true);
      mockVMManager.getVersion.mockResolvedValue('1.14.0+mac');
      const result = await invoke(IPC.VM_STATUS);
      expect(mockVMManager.isMultipassAvailable).toHaveBeenCalledOnce();
      expect(mockVMManager.getVersion).toHaveBeenCalledOnce();
      expect(result).toEqual({ available: true, version: '1.14.0+mac' });
    });

    it('returns available:true without version when getVersion throws', async () => {
      mockVMManager.isMultipassAvailable.mockResolvedValue(true);
      mockVMManager.getVersion.mockRejectedValue(new Error('version failed'));
      const result = await invoke(IPC.VM_STATUS);
      expect(result).toEqual({ available: true });
    });
  });

  // ── vm:list ───────────────────────────────────────────────────────────────────

  describe('vm:list', () => {
    it('delegates to vmManager.listVMs()', async () => {
      const vms = [sampleVMInfo];
      mockVMManager.listVMs.mockResolvedValue(vms);
      const result = await invoke(IPC.VM_LIST);
      expect(mockVMManager.listVMs).toHaveBeenCalledOnce();
      expect(result).toEqual(vms);
    });

    it('returns empty array when no VMs exist', async () => {
      mockVMManager.listVMs.mockResolvedValue([]);
      const result = await invoke(IPC.VM_LIST);
      expect(result).toEqual([]);
    });
  });

  // ── vm:get ─────────────────────────────────────────────────────────────────────

  describe('vm:get', () => {
    it('delegates to vmManager.getVMInfo() with the provided VM name', async () => {
      mockVMManager.getVMInfo.mockResolvedValue(sampleVMInfo);
      const result = await invoke(IPC.VM_GET, 'zephyr-proj1234-abc1');
      expect(mockVMManager.getVMInfo).toHaveBeenCalledWith('zephyr-proj1234-abc1');
      expect(result).toEqual(sampleVMInfo);
    });

    it('returns null when VM does not exist', async () => {
      mockVMManager.getVMInfo.mockResolvedValue(null);
      const result = await invoke(IPC.VM_GET, 'nonexistent-vm');
      expect(result).toBeNull();
    });
  });

  // ── vm:start ──────────────────────────────────────────────────────────────────

  describe('vm:start', () => {
    it('delegates to loopRunner.startProjectVM() and broadcasts status', async () => {
      mockLoopRunner.startProjectVM.mockResolvedValue(sampleVMInfo);
      const result = await invoke(IPC.VM_START, 'project-123');
      expect(mockLoopRunner.startProjectVM).toHaveBeenCalledWith('project-123', undefined);
      expect(result).toEqual(sampleVMInfo);
      // Verify broadcast to renderer
      expect(mockBrowserWindow.getAllWindows).toHaveBeenCalled();
      expect(mockWebContentsSend).toHaveBeenCalledWith(IPC.VM_STATUS_CHANGED, sampleVMInfo);
    });

    it('propagates errors from startProjectVM', async () => {
      mockLoopRunner.startProjectVM.mockRejectedValue(new Error('No persistent VM registered'));
      await expect(invoke(IPC.VM_START, 'project-999')).rejects.toThrow('No persistent VM registered');
      expect(mockWebContentsSend).not.toHaveBeenCalled();
    });

    it('broadcasts to all open windows', async () => {
      const send1 = vi.fn();
      const send2 = vi.fn();
      mockBrowserWindow.getAllWindows.mockReturnValue([
        { webContents: { send: send1 } },
        { webContents: { send: send2 } },
      ]);
      mockLoopRunner.startProjectVM.mockResolvedValue(sampleVMInfo);
      await invoke(IPC.VM_START, 'project-123');
      expect(send1).toHaveBeenCalledWith(IPC.VM_STATUS_CHANGED, sampleVMInfo);
      expect(send2).toHaveBeenCalledWith(IPC.VM_STATUS_CHANGED, sampleVMInfo);
    });
  });

  // ── vm:stop ───────────────────────────────────────────────────────────────────

  describe('vm:stop', () => {
    it('delegates to loopRunner.stopProjectVM() and broadcasts updated status', async () => {
      mockLoopRunner.stopProjectVM.mockResolvedValue(undefined);
      const stoppedInfo = { ...sampleVMInfo, state: 'Stopped' as const };
      mockLoopRunner.getProjectVMInfo.mockResolvedValue(stoppedInfo);

      const result = await invoke(IPC.VM_STOP, 'project-123');
      expect(mockLoopRunner.stopProjectVM).toHaveBeenCalledWith('project-123');
      expect(result).toBeUndefined();
      expect(mockLoopRunner.getProjectVMInfo).toHaveBeenCalledWith('project-123');
      expect(mockWebContentsSend).toHaveBeenCalledWith(IPC.VM_STATUS_CHANGED, stoppedInfo);
    });

    it('propagates errors from stopProjectVM (loop running)', async () => {
      mockLoopRunner.stopProjectVM.mockRejectedValue(
        new Error('Cannot stop VM while a loop is running')
      );
      await expect(invoke(IPC.VM_STOP, 'project-123')).rejects.toThrow(
        'Cannot stop VM while a loop is running'
      );
    });

    it('handles getProjectVMInfo returning null without broadcasting', async () => {
      mockLoopRunner.stopProjectVM.mockResolvedValue(undefined);
      mockLoopRunner.getProjectVMInfo.mockResolvedValue(null);
      await invoke(IPC.VM_STOP, 'project-123');
      // No broadcast if no info available
      expect(mockWebContentsSend).not.toHaveBeenCalled();
    });

    it('handles getProjectVMInfo throwing without crashing', async () => {
      mockLoopRunner.stopProjectVM.mockResolvedValue(undefined);
      mockLoopRunner.getProjectVMInfo.mockRejectedValue(new Error('VM info unavailable'));
      // Should not propagate — error is caught and warned
      await expect(invoke(IPC.VM_STOP, 'project-123')).resolves.toBeUndefined();
    });
  });

  // ── vm:delete ─────────────────────────────────────────────────────────────────

  describe('vm:delete', () => {
    it('delegates to vmManager.deleteVM() with force=true', async () => {
      mockVMManager.deleteVM.mockResolvedValue(undefined);
      const result = await invoke(IPC.VM_DELETE, 'zephyr-proj1234-abc1');
      expect(mockVMManager.deleteVM).toHaveBeenCalledWith('zephyr-proj1234-abc1', true);
      expect(result).toBeUndefined();
    });

    it('propagates errors from deleteVM', async () => {
      mockVMManager.deleteVM.mockRejectedValue(new Error('VM not found'));
      await expect(invoke(IPC.VM_DELETE, 'nonexistent-vm')).rejects.toThrow('VM not found');
    });
  });

  // ── Channel registration ───────────────────────────────────────────────────────

  describe('channel registration', () => {
    it('registers all expected VM channels', () => {
      const expected = [
        IPC.VM_STATUS,
        IPC.VM_LIST,
        IPC.VM_GET,
        IPC.VM_START,
        IPC.VM_STOP,
        IPC.VM_DELETE,
      ];
      for (const channel of expected) {
        expect(handlerRegistry[channel], `Missing handler for ${channel}`).toBeDefined();
      }
    });

    it('does not register VM_STATUS_CHANGED (it is an outbound event, not a handler)', () => {
      expect(handlerRegistry[IPC.VM_STATUS_CHANGED]).toBeUndefined();
    });
  });
});
