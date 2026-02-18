import { useEffect, useRef, useState } from 'react';
import type { ParsedLogLine } from '../../shared/loop-types';

interface LogBuffer {
  [projectId: string]: ParsedLogLine[];
}

interface UseLogStreamResult {
  lines: ParsedLogLine[];
  clearLines: () => void;
}

/**
 * Hook for real-time log streaming from loop execution.
 * Subscribes to `loop:log-line` IPC events and buffers lines per project ID.
 * Uses requestAnimationFrame to batch DOM updates for performance.
 *
 * @param projectId - The project ID to stream logs for (null/undefined = no streaming)
 * @returns Object with `lines` array and `clearLines` function
 */
export function useLogStream(projectId: string | null | undefined): UseLogStreamResult {
  // Buffer for all project logs
  const bufferRef = useRef<LogBuffer>({});

  // Pending updates (batched via rAF)
  const pendingUpdatesRef = useRef<Map<string, ParsedLogLine[]>>(new Map());

  // RAF handle for cancellation
  const rafHandleRef = useRef<number | null>(null);

  // State for the currently selected project's lines
  const [lines, setLines] = useState<ParsedLogLine[]>([]);

  // Track current projectId to detect changes
  const currentProjectIdRef = useRef<string | null | undefined>(projectId);

  // Effect: Handle project ID changes
  useEffect(() => {
    if (currentProjectIdRef.current !== projectId) {
      currentProjectIdRef.current = projectId;

      // Load existing buffer for new project
      if (projectId && bufferRef.current[projectId]) {
        setLines([...bufferRef.current[projectId]]);
      } else {
        setLines([]);
      }
    }
  }, [projectId]);

  // Effect: Subscribe to log line events
  useEffect(() => {
    // Flush function - applies all pending updates to state
    const flushPendingUpdates = () => {
      rafHandleRef.current = null;

      if (pendingUpdatesRef.current.size === 0) {
        return;
      }

      // Apply all pending updates to buffer
      pendingUpdatesRef.current.forEach((newLines, pid) => {
        if (!bufferRef.current[pid]) {
          bufferRef.current[pid] = [];
        }
        bufferRef.current[pid].push(...newLines);
      });

      // Update state if current project has pending updates
      if (currentProjectIdRef.current && pendingUpdatesRef.current.has(currentProjectIdRef.current)) {
        setLines([...bufferRef.current[currentProjectIdRef.current]]);
      }

      // Clear pending updates
      pendingUpdatesRef.current.clear();
    };

    // Schedule flush on next animation frame
    const scheduleBatchUpdate = () => {
      if (rafHandleRef.current === null) {
        rafHandleRef.current = requestAnimationFrame(flushPendingUpdates);
      }
    };

    // Log line callback
    const handleLogLine = (pid: string, line: ParsedLogLine) => {
      // Add to pending updates
      if (!pendingUpdatesRef.current.has(pid)) {
        pendingUpdatesRef.current.set(pid, []);
      }
      pendingUpdatesRef.current.get(pid)!.push(line);

      // Schedule batch update
      scheduleBatchUpdate();
    };

    // Subscribe to IPC events
    const unsubscribe = window.api.loops.onLogLine(handleLogLine);

    // Cleanup
    return () => {
      unsubscribe();

      // Cancel pending RAF
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
      }
    };
  }, []); // Empty deps - subscription stays active for app lifetime

  // Clear lines function
  const clearLines = () => {
    if (currentProjectIdRef.current) {
      // Clear buffer
      delete bufferRef.current[currentProjectIdRef.current];

      // Clear pending updates
      pendingUpdatesRef.current.delete(currentProjectIdRef.current);

      // Clear state
      setLines([]);
    }
  };

  return { lines, clearLines };
}
