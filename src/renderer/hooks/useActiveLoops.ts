import { useState, useEffect } from 'react';
import { isLoopActive } from '../../shared/loop-types';
import type { LoopState } from '../../shared/loop-types';

/**
 * React hook for tracking active loops.
 * Fetches loop count via IPC and subscribes to state changes.
 *
 * @returns Number of currently active loops
 */
export function useActiveLoops(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    const queryCount = async () => {
      try {
        const loops = await window.api.loops.list();
        if (mounted) {
          setCount(loops.filter((loop: LoopState) => isLoopActive(loop.status)).length);
        }
      } catch {
        // keep previous count on error
      }
    };

    queryCount();

    const cleanup = window.api.loops.onStateChanged(() => {
      queryCount();
    });

    return () => {
      mounted = false;
      cleanup();
    };
  }, []);

  return count;
}
