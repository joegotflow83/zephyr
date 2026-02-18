/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLogStream } from '../../src/renderer/hooks/useLogStream';
import type { ParsedLogLine } from '../../src/shared/loop-types';

describe('useLogStream', () => {
  let mockUnsubscribe: ReturnType<typeof vi.fn>;
  let mockOnLogLine: ReturnType<typeof vi.fn>;
  let logLineCallback: ((projectId: string, line: ParsedLogLine) => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();

    mockUnsubscribe = vi.fn();
    mockOnLogLine = vi.fn((callback) => {
      logLineCallback = callback;
      return mockUnsubscribe;
    });

    // Mock window.api
    (window as any).api = {
      loops: {
        onLogLine: mockOnLogLine,
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    logLineCallback = null;
  });

  it('should initialize with empty lines', () => {
    const { result } = renderHook(() => useLogStream('project-1'));

    expect(result.current.lines).toEqual([]);
    expect(result.current.clearLines).toBeInstanceOf(Function);
  });

  it('should subscribe to log line events on mount', () => {
    renderHook(() => useLogStream('project-1'));

    expect(mockOnLogLine).toHaveBeenCalledTimes(1);
    expect(mockOnLogLine).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should unsubscribe on unmount', () => {
    const { unmount } = renderHook(() => useLogStream('project-1'));

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('should buffer log lines for the selected project', async () => {
    const { result } = renderHook(() => useLogStream('project-1'));

    const line1: ParsedLogLine = {
      type: 'info',
      raw: 'Starting loop...',
      timestamp: new Date(),
    };

    const line2: ParsedLogLine = {
      type: 'commit',
      raw: 'git commit -m "test"',
      timestamp: new Date(),
      commitMessage: 'test',
    };

    // Emit log lines
    act(() => {
      logLineCallback!('project-1', line1);
      logLineCallback!('project-1', line2);
    });

    // Flush RAF
    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.lines).toHaveLength(2);
    expect(result.current.lines[0]).toEqual(line1);
    expect(result.current.lines[1]).toEqual(line2);
  });

  it('should not show lines from other projects', async () => {
    const { result } = renderHook(() => useLogStream('project-1'));

    const line1: ParsedLogLine = {
      type: 'info',
      raw: 'Project 1 log',
      timestamp: new Date(),
    };

    const line2: ParsedLogLine = {
      type: 'info',
      raw: 'Project 2 log',
      timestamp: new Date(),
    };

    act(() => {
      logLineCallback!('project-1', line1);
      logLineCallback!('project-2', line2);
    });

    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0]).toEqual(line1);
  });

  it('should batch updates with requestAnimationFrame', async () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const { result } = renderHook(() => useLogStream('project-1'));

    const lines: ParsedLogLine[] = Array.from({ length: 100 }, (_, i) => ({
      type: 'info',
      raw: `Line ${i}`,
      timestamp: new Date(),
    }));

    // Emit many lines rapidly
    act(() => {
      lines.forEach((line) => logLineCallback!('project-1', line));
    });

    // Should only schedule one RAF call (batching)
    expect(rafSpy).toHaveBeenCalledTimes(1);

    // Flush RAF
    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.lines).toHaveLength(100);

    rafSpy.mockRestore();
  });

  it('should clear lines for the selected project', async () => {
    const { result } = renderHook(() => useLogStream('project-1'));

    const line: ParsedLogLine = {
      type: 'info',
      raw: 'Test line',
      timestamp: new Date(),
    };

    act(() => {
      logLineCallback!('project-1', line);
    });

    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.lines).toHaveLength(1);

    // Clear lines
    act(() => {
      result.current.clearLines();
    });

    expect(result.current.lines).toHaveLength(0);
  });

  it('should preserve lines from other projects when clearing', async () => {
    const { result, rerender } = renderHook(
      ({ projectId }) => useLogStream(projectId),
      { initialProps: { projectId: 'project-1' } },
    );

    const line1: ParsedLogLine = {
      type: 'info',
      raw: 'Project 1 log',
      timestamp: new Date(),
    };

    const line2: ParsedLogLine = {
      type: 'info',
      raw: 'Project 2 log',
      timestamp: new Date(),
    };

    // Add lines to both projects
    act(() => {
      logLineCallback!('project-1', line1);
      logLineCallback!('project-2', line2);
    });

    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.lines).toHaveLength(1);

    // Clear project 1
    act(() => {
      result.current.clearLines();
    });

    expect(result.current.lines).toHaveLength(0);

    // Switch to project 2
    rerender({ projectId: 'project-2' });

    // Project 2 lines should still be there
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0]).toEqual(line2);
  });

  it('should switch projects and show buffered lines', async () => {
    const { result, rerender } = renderHook(
      ({ projectId }) => useLogStream(projectId),
      { initialProps: { projectId: 'project-1' } },
    );

    const line1: ParsedLogLine = {
      type: 'info',
      raw: 'Project 1 log',
      timestamp: new Date(),
    };

    const line2: ParsedLogLine = {
      type: 'info',
      raw: 'Project 2 log',
      timestamp: new Date(),
    };

    // Add lines to both projects
    act(() => {
      logLineCallback!('project-1', line1);
      logLineCallback!('project-2', line2);
    });

    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0]).toEqual(line1);

    // Switch to project 2
    rerender({ projectId: 'project-2' });

    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0]).toEqual(line2);

    // Switch back to project 1
    rerender({ projectId: 'project-1' });

    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0]).toEqual(line1);
  });

  it('should handle null projectId', () => {
    const { result } = renderHook(() => useLogStream(null));

    expect(result.current.lines).toEqual([]);

    const line: ParsedLogLine = {
      type: 'info',
      raw: 'Test line',
      timestamp: new Date(),
    };

    act(() => {
      logLineCallback!('project-1', line);
    });

    act(() => {
      vi.runAllTimers();
    });

    // Should not show any lines
    expect(result.current.lines).toEqual([]);
  });

  it('should handle undefined projectId', () => {
    const { result } = renderHook(() => useLogStream(undefined));

    expect(result.current.lines).toEqual([]);

    const line: ParsedLogLine = {
      type: 'info',
      raw: 'Test line',
      timestamp: new Date(),
    };

    act(() => {
      logLineCallback!('project-1', line);
    });

    act(() => {
      vi.runAllTimers();
    });

    // Should not show any lines
    expect(result.current.lines).toEqual([]);
  });

  it('should switch from null to valid projectId', async () => {
    const { result, rerender } = renderHook(
      ({ projectId }) => useLogStream(projectId),
      { initialProps: { projectId: null as string | null } },
    );

    expect(result.current.lines).toEqual([]);

    const line: ParsedLogLine = {
      type: 'info',
      raw: 'Test line',
      timestamp: new Date(),
    };

    // Add line while projectId is null
    act(() => {
      logLineCallback!('project-1', line);
    });

    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.lines).toEqual([]);

    // Switch to project-1
    rerender({ projectId: 'project-1' });

    // Should now show buffered line
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0]).toEqual(line);
  });

  it('should cancel pending RAF on unmount', () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = renderHook(() => useLogStream('project-1'));

    const line: ParsedLogLine = {
      type: 'info',
      raw: 'Test line',
      timestamp: new Date(),
    };

    act(() => {
      logLineCallback!('project-1', line);
    });

    // Unmount before RAF fires
    unmount();

    expect(cancelSpy).toHaveBeenCalled();

    cancelSpy.mockRestore();
  });

  it('should accumulate lines across multiple RAF cycles', async () => {
    const { result } = renderHook(() => useLogStream('project-1'));

    // First batch
    act(() => {
      logLineCallback!('project-1', {
        type: 'info',
        raw: 'Line 1',
        timestamp: new Date(),
      });
    });

    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.lines).toHaveLength(1);

    // Second batch
    act(() => {
      logLineCallback!('project-1', {
        type: 'info',
        raw: 'Line 2',
        timestamp: new Date(),
      });
    });

    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.lines).toHaveLength(2);
    expect(result.current.lines[0].raw).toBe('Line 1');
    expect(result.current.lines[1].raw).toBe('Line 2');
  });

  it('should handle clearLines when projectId is null', () => {
    const { result } = renderHook(() => useLogStream(null));

    // Should not throw
    expect(() => {
      act(() => {
        result.current.clearLines();
      });
    }).not.toThrow();
  });

  it('should handle different log line types correctly', async () => {
    const { result } = renderHook(() => useLogStream('project-1'));

    const lines: ParsedLogLine[] = [
      {
        type: 'info',
        raw: 'Info line',
        timestamp: new Date(),
      },
      {
        type: 'error',
        raw: 'Error: Something failed',
        timestamp: new Date(),
        errorDetails: 'Something failed',
      },
      {
        type: 'commit',
        raw: 'git commit -m "feat: new feature"',
        timestamp: new Date(),
        commitMessage: 'feat: new feature',
      },
      {
        type: 'plan',
        raw: '## Plan: Implement feature',
        timestamp: new Date(),
        planText: 'Implement feature',
      },
    ];

    act(() => {
      lines.forEach((line) => logLineCallback!('project-1', line));
    });

    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.lines).toHaveLength(4);
    expect(result.current.lines[0].type).toBe('info');
    expect(result.current.lines[1].type).toBe('error');
    expect(result.current.lines[2].type).toBe('commit');
    expect(result.current.lines[3].type).toBe('plan');
  });

  it('should maintain order of log lines', async () => {
    const { result } = renderHook(() => useLogStream('project-1'));

    const lines: ParsedLogLine[] = Array.from({ length: 10 }, (_, i) => ({
      type: 'info',
      raw: `Line ${i}`,
      timestamp: new Date(),
    }));

    act(() => {
      lines.forEach((line) => logLineCallback!('project-1', line));
    });

    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.lines).toHaveLength(10);
    result.current.lines.forEach((line, i) => {
      expect(line.raw).toBe(`Line ${i}`);
    });
  });
});
