import { useState, useEffect } from 'react';
import { isLoopActive } from '../../shared/loop-types';
import type { LoopState } from '../../shared/loop-types';

/**
 * React hook for tracking active factory projects.
 * Counts distinct projects that have at least one active factory container
 * (containers with a `role` field are factory containers).
 *
 * @returns Number of projects with currently active factory containers
 */
export function useActiveFactories(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    const queryCount = async () => {
      try {
        const loops = await window.api.loops.list();
        if (mounted) {
          const activeFactoryProjectIds = new Set(
            loops
              .filter((loop: LoopState) => loop.role !== undefined && isLoopActive(loop.status))
              .map((loop: LoopState) => loop.projectId)
          );
          setCount(activeFactoryProjectIds.size);
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
