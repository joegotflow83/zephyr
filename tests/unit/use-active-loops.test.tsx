import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useActiveLoops } from '../../src/renderer/hooks/useActiveLoops';
import { LoopStatus, LoopState } from '../../src/shared/loop-types';

describe('useActiveLoops Hook', () => {
  let stateChangedCallback: ((state: LoopState) => void) | null = null;
  let cleanupFn: ReturnType<typeof vi.fn>;

  const createLoopState = (id: string, status: LoopStatus): LoopState => ({
    projectId: id,
    projectName: `Project ${id}`,
    containerId: `container-${id}`,
    mode: 'SINGLE' as const,
    status,
    iteration: 1,
    logs: [],
    commits: [],
    errors: [],
    startedAt: Date.now(),
    stoppedAt: null,
  });

  beforeEach(() => {
    stateChangedCallback = null;
    cleanupFn = vi.fn();

    // Mock window.api.loops
    global.window.api = {
      loops: {
        list: vi.fn().mockResolvedValue([]),
        onStateChanged: vi.fn((callback) => {
          stateChangedCallback = callback;
          return cleanupFn;
        }),
      },
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial Loop Query', () => {
    it('queries loop list on mount', async () => {
      renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(global.window.api.loops.list).toHaveBeenCalledTimes(1);
      });
    });

    it('returns 0 when no loops are active', async () => {
      global.window.api.loops.list = vi.fn().mockResolvedValue([]);

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(0);
      });
    });

    it('counts RUNNING loops', async () => {
      global.window.api.loops.list = vi.fn().mockResolvedValue([
        createLoopState('1', LoopStatus.RUNNING),
        createLoopState('2', LoopStatus.RUNNING),
      ]);

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(2);
      });
    });

    it('counts STARTING loops', async () => {
      global.window.api.loops.list = vi.fn().mockResolvedValue([
        createLoopState('1', LoopStatus.STARTING),
      ]);

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(1);
      });
    });

    it('does not count PAUSED loops', async () => {
      global.window.api.loops.list = vi.fn().mockResolvedValue([
        createLoopState('1', LoopStatus.PAUSED),
      ]);

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(0);
      });
    });

    it('does not count IDLE loops', async () => {
      global.window.api.loops.list = vi.fn().mockResolvedValue([
        createLoopState('1', LoopStatus.IDLE),
        createLoopState('2', LoopStatus.RUNNING),
      ]);

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(1);
      });
    });

    it('does not count STOPPED loops', async () => {
      global.window.api.loops.list = vi.fn().mockResolvedValue([
        createLoopState('1', LoopStatus.STOPPED),
        createLoopState('2', LoopStatus.RUNNING),
      ]);

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(1);
      });
    });

    it('does not count COMPLETED loops', async () => {
      global.window.api.loops.list = vi.fn().mockResolvedValue([
        createLoopState('1', LoopStatus.COMPLETED),
        createLoopState('2', LoopStatus.RUNNING),
      ]);

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(1);
      });
    });

    it('does not count FAILED loops', async () => {
      global.window.api.loops.list = vi.fn().mockResolvedValue([
        createLoopState('1', LoopStatus.FAILED),
        createLoopState('2', LoopStatus.RUNNING),
      ]);

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(1);
      });
    });

    it('does not count STOPPING loops', async () => {
      global.window.api.loops.list = vi.fn().mockResolvedValue([
        createLoopState('1', LoopStatus.STOPPING),
        createLoopState('2', LoopStatus.RUNNING),
      ]);

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(1);
      });
    });

    it('counts mixed active loop states', async () => {
      global.window.api.loops.list = vi.fn().mockResolvedValue([
        createLoopState('1', LoopStatus.RUNNING),
        createLoopState('2', LoopStatus.STARTING),
        createLoopState('3', LoopStatus.PAUSED),
        createLoopState('4', LoopStatus.STOPPED),
        createLoopState('5', LoopStatus.COMPLETED),
      ]);

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(2); // RUNNING + STARTING only
      });
    });

    it('handles query errors gracefully', async () => {
      global.window.api.loops.list = vi.fn().mockRejectedValue(new Error('Query failed'));

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(0);
      });
    });

    it('starts with 0 before initial query completes', () => {
      const { result } = renderHook(() => useActiveLoops());

      // Check initial state before async resolution
      expect(result.current).toBe(0);
    });
  });

  describe('State Change Subscription', () => {
    it('subscribes to state changes on mount', async () => {
      renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(global.window.api.loops.onStateChanged).toHaveBeenCalledTimes(1);
        expect(global.window.api.loops.onStateChanged).toHaveBeenCalledWith(
          expect.any(Function)
        );
      });
    });

    it('updates count when loop starts', async () => {
      global.window.api.loops.list = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([createLoopState('1', LoopStatus.RUNNING)]);

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(0);
      });

      // Simulate loop state change
      if (stateChangedCallback) {
        stateChangedCallback(createLoopState('1', LoopStatus.RUNNING));
      }

      await waitFor(() => {
        expect(result.current).toBe(1);
      });
    });

    it('updates count when loop stops', async () => {
      global.window.api.loops.list = vi
        .fn()
        .mockResolvedValueOnce([createLoopState('1', LoopStatus.RUNNING)])
        .mockResolvedValueOnce([createLoopState('1', LoopStatus.STOPPED)]);

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(1);
      });

      // Simulate loop stopping
      if (stateChangedCallback) {
        stateChangedCallback(createLoopState('1', LoopStatus.STOPPED));
      }

      await waitFor(() => {
        expect(result.current).toBe(0);
      });
    });

    it('updates count when loop transitions between active states', async () => {
      global.window.api.loops.list = vi
        .fn()
        .mockResolvedValueOnce([createLoopState('1', LoopStatus.RUNNING)])
        .mockResolvedValueOnce([createLoopState('1', LoopStatus.STARTING)]);

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(1);
      });

      // Simulate loop transitioning from RUNNING to STARTING (both active)
      if (stateChangedCallback) {
        stateChangedCallback(createLoopState('1', LoopStatus.STARTING));
      }

      await waitFor(() => {
        expect(result.current).toBe(1);
      });
    });

    it('handles errors in re-query gracefully', async () => {
      global.window.api.loops.list = vi
        .fn()
        .mockResolvedValueOnce([createLoopState('1', LoopStatus.RUNNING)])
        .mockRejectedValueOnce(new Error('Query failed'));

      const { result } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(1);
      });

      // Simulate loop state change that triggers failed re-query
      if (stateChangedCallback) {
        stateChangedCallback(createLoopState('1', LoopStatus.STOPPED));
      }

      // Should keep previous count on error
      await waitFor(() => {
        expect(result.current).toBe(1);
      });
    });
  });

  describe('Cleanup', () => {
    it('calls cleanup function on unmount', async () => {
      const { unmount } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(global.window.api.loops.onStateChanged).toHaveBeenCalled();
      });

      unmount();

      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });

    it('does not update state after unmount', async () => {
      global.window.api.loops.list = vi
        .fn()
        .mockResolvedValueOnce([createLoopState('1', LoopStatus.RUNNING)])
        .mockResolvedValueOnce([]);

      const { result, unmount } = renderHook(() => useActiveLoops());

      await waitFor(() => {
        expect(result.current).toBe(1);
      });

      unmount();

      // Try to trigger state change after unmount
      if (stateChangedCallback) {
        stateChangedCallback(createLoopState('1', LoopStatus.STOPPED));
      }

      // State should remain as it was before unmount
      expect(result.current).toBe(1);
    });
  });
});
