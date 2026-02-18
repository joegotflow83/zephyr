import { useState, useEffect } from 'react';
import { LoopState, isLoopActive } from '../../shared/loop-types';

/**
 * React hook for tracking active loops.
 * Subscribes to loop state changes and counts loops in active states
 * (RUNNING or STARTING).
 *
 * @returns Number of currently active loops
 */
export function useActiveLoops(): number {
  const [activeCount, setActiveCount] = useState<number>(0);

  useEffect(() => {
    let isMounted = true;

    // Query initial loop states
    window.api.loops
      .list()
      .then((loops: LoopState[]) => {
        if (isMounted) {
          const count = loops.filter((loop) => isLoopActive(loop.status)).length;
          setActiveCount(count);
        }
      })
      .catch(() => {
        // Silently handle errors
        if (isMounted) {
          setActiveCount(0);
        }
      });

    // Subscribe to loop state changes
    const cleanup = window.api.loops.onStateChanged((_state: LoopState) => {
      if (isMounted) {
        // Re-query all loops to get accurate count
        window.api.loops
          .list()
          .then((loops: LoopState[]) => {
            if (isMounted) {
              const count = loops.filter((loop) => isLoopActive(loop.status)).length;
              setActiveCount(count);
            }
          })
          .catch(() => {
            // Keep previous count on error
          });
      }
    });

    return () => {
      isMounted = false;
      cleanup();
    };
  }, []);

  return activeCount;
}
