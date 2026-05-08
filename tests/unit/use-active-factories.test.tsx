/**
 * Unit tests for src/renderer/hooks/useActiveFactories.ts
 *
 * useActiveFactories counts distinct projects that have at least one active
 * factory container. Factory containers are identified by having a `role` field.
 * Active means status is STARTING or RUNNING (per isLoopActive).
 *
 * Why factory-specific counting matters: the status bar badge shows how many
 * projects are currently running a pipeline, not how many individual containers
 * are active. Two containers for the same project should show as 1 active project.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useActiveFactories } from '../../src/renderer/hooks/useActiveFactories';
import { LoopStatus, LoopMode } from '../../src/shared/loop-types';
import type { LoopState } from '../../src/shared/loop-types';

describe('useActiveFactories Hook', () => {
  let stateChangedCallback: ((state: LoopState) => void) | null = null;
  let cleanupFn: ReturnType<typeof vi.fn>;

  /** Build a minimal LoopState. Pass role to make it a factory container. */
  const makeLoop = (
    projectId: string,
    status: LoopStatus,
    role?: string,
  ): LoopState => ({
    projectId,
    projectName: `Project ${projectId}`,
    containerId: `container-${projectId}-${role ?? 'solo'}`,
    mode: LoopMode.CONTINUOUS,
    status,
    iteration: 0,
    startedAt: null,
    stoppedAt: null,
    logs: [],
    commits: [],
    errors: 0,
    error: null,
    ...(role !== undefined ? { role } : {}),
  });

  beforeEach(() => {
    stateChangedCallback = null;
    cleanupFn = vi.fn();

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

  // ── Initial query ──────────────────────────────────────────────────────────

  it('starts at 0 before initial query resolves', () => {
    const { result } = renderHook(() => useActiveFactories());
    expect(result.current).toBe(0);
  });

  it('returns 0 when no loops exist', async () => {
    global.window.api.loops.list = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useActiveFactories());
    await waitFor(() => expect(result.current).toBe(0));
  });

  it('returns 0 when loops exist but none are factory loops (no role)', async () => {
    global.window.api.loops.list = vi.fn().mockResolvedValue([
      makeLoop('proj-1', LoopStatus.RUNNING),
      makeLoop('proj-2', LoopStatus.STARTING),
    ]);
    const { result } = renderHook(() => useActiveFactories());
    await waitFor(() => expect(result.current).toBe(0));
  });

  it('counts 1 project with a RUNNING factory container', async () => {
    global.window.api.loops.list = vi.fn().mockResolvedValue([
      makeLoop('proj-1', LoopStatus.RUNNING, 'coder-0'),
    ]);
    const { result } = renderHook(() => useActiveFactories());
    await waitFor(() => expect(result.current).toBe(1));
  });

  it('counts 1 project with a STARTING factory container', async () => {
    global.window.api.loops.list = vi.fn().mockResolvedValue([
      makeLoop('proj-1', LoopStatus.STARTING, 'qa-0'),
    ]);
    const { result } = renderHook(() => useActiveFactories());
    await waitFor(() => expect(result.current).toBe(1));
  });

  it('counts 2 distinct projects each with an active factory container', async () => {
    global.window.api.loops.list = vi.fn().mockResolvedValue([
      makeLoop('proj-1', LoopStatus.RUNNING, 'coder-0'),
      makeLoop('proj-2', LoopStatus.RUNNING, 'coder-0'),
    ]);
    const { result } = renderHook(() => useActiveFactories());
    await waitFor(() => expect(result.current).toBe(2));
  });

  it('counts 1 (not 2) when two factory containers belong to the same project', async () => {
    global.window.api.loops.list = vi.fn().mockResolvedValue([
      makeLoop('proj-1', LoopStatus.RUNNING, 'coder-0'),
      makeLoop('proj-1', LoopStatus.RUNNING, 'qa-0'),
    ]);
    const { result } = renderHook(() => useActiveFactories());
    await waitFor(() => expect(result.current).toBe(1));
  });

  it('does not count inactive factory containers (STOPPED)', async () => {
    global.window.api.loops.list = vi.fn().mockResolvedValue([
      makeLoop('proj-1', LoopStatus.STOPPED, 'coder-0'),
    ]);
    const { result } = renderHook(() => useActiveFactories());
    await waitFor(() => expect(result.current).toBe(0));
  });

  it('does not count inactive factory containers (COMPLETED)', async () => {
    global.window.api.loops.list = vi.fn().mockResolvedValue([
      makeLoop('proj-1', LoopStatus.COMPLETED, 'coder-0'),
    ]);
    const { result } = renderHook(() => useActiveFactories());
    await waitFor(() => expect(result.current).toBe(0));
  });

  it('does not count inactive factory containers (FAILED)', async () => {
    global.window.api.loops.list = vi.fn().mockResolvedValue([
      makeLoop('proj-1', LoopStatus.FAILED, 'coder-0'),
    ]);
    const { result } = renderHook(() => useActiveFactories());
    await waitFor(() => expect(result.current).toBe(0));
  });

  it('counts only projects with active factory containers from a mixed list', async () => {
    global.window.api.loops.list = vi.fn().mockResolvedValue([
      makeLoop('proj-1', LoopStatus.RUNNING, 'coder-0'),  // active factory → counted
      makeLoop('proj-1', LoopStatus.STOPPED, 'qa-0'),     // inactive factory → not counted separately
      makeLoop('proj-2', LoopStatus.RUNNING),              // active but no role → not a factory
      makeLoop('proj-3', LoopStatus.STOPPED, 'coder-0'),  // inactive factory → not counted
      makeLoop('proj-4', LoopStatus.STARTING, 'qa-1'),    // active factory → counted
    ]);
    const { result } = renderHook(() => useActiveFactories());
    // proj-1 (has active factory coder-0), proj-4 (has active factory qa-1)
    await waitFor(() => expect(result.current).toBe(2));
  });

  it('handles initial query errors gracefully (returns 0)', async () => {
    global.window.api.loops.list = vi.fn().mockRejectedValue(new Error('IPC failed'));
    const { result } = renderHook(() => useActiveFactories());
    await waitFor(() => expect(result.current).toBe(0));
  });

  // ── State change subscription ──────────────────────────────────────────────

  it('subscribes to state changes on mount', async () => {
    renderHook(() => useActiveFactories());
    await waitFor(() => {
      expect(global.window.api.loops.onStateChanged).toHaveBeenCalledTimes(1);
      expect(global.window.api.loops.onStateChanged).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });
  });

  it('re-queries when a state change event arrives', async () => {
    global.window.api.loops.list = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeLoop('proj-1', LoopStatus.RUNNING, 'coder-0')]);

    const { result } = renderHook(() => useActiveFactories());

    await waitFor(() => expect(result.current).toBe(0));

    stateChangedCallback!(makeLoop('proj-1', LoopStatus.RUNNING, 'coder-0'));

    await waitFor(() => expect(result.current).toBe(1));
  });

  it('decrements count when a factory project stops', async () => {
    global.window.api.loops.list = vi.fn()
      .mockResolvedValueOnce([makeLoop('proj-1', LoopStatus.RUNNING, 'coder-0')])
      .mockResolvedValueOnce([makeLoop('proj-1', LoopStatus.STOPPED, 'coder-0')]);

    const { result } = renderHook(() => useActiveFactories());

    await waitFor(() => expect(result.current).toBe(1));

    stateChangedCallback!(makeLoop('proj-1', LoopStatus.STOPPED, 'coder-0'));

    await waitFor(() => expect(result.current).toBe(0));
  });

  it('keeps previous count when re-query after state change fails', async () => {
    global.window.api.loops.list = vi.fn()
      .mockResolvedValueOnce([makeLoop('proj-1', LoopStatus.RUNNING, 'coder-0')])
      .mockRejectedValueOnce(new Error('IPC failed'));

    const { result } = renderHook(() => useActiveFactories());

    await waitFor(() => expect(result.current).toBe(1));

    stateChangedCallback!(makeLoop('proj-1', LoopStatus.STOPPED, 'coder-0'));

    // should keep previous count on error
    await waitFor(() => expect(result.current).toBe(1));
  });

  // ── Cleanup ────────────────────────────────────────────────────────────────

  it('calls the onStateChanged cleanup function on unmount', async () => {
    const { unmount } = renderHook(() => useActiveFactories());

    await waitFor(() => {
      expect(global.window.api.loops.onStateChanged).toHaveBeenCalled();
    });

    unmount();

    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });

  it('does not update state after unmount', async () => {
    global.window.api.loops.list = vi.fn()
      .mockResolvedValueOnce([makeLoop('proj-1', LoopStatus.RUNNING, 'coder-0')])
      .mockResolvedValueOnce([]);

    const { result, unmount } = renderHook(() => useActiveFactories());

    await waitFor(() => expect(result.current).toBe(1));

    unmount();

    stateChangedCallback!(makeLoop('proj-1', LoopStatus.STOPPED, 'coder-0'));

    // State should not change after unmount
    expect(result.current).toBe(1);
  });

  it('queries loop list on mount', async () => {
    renderHook(() => useActiveFactories());
    await waitFor(() => {
      expect(global.window.api.loops.list).toHaveBeenCalledTimes(1);
    });
  });
});
