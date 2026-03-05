import { useAppStore } from '../stores/app-store';
import { isLoopActive } from '../../shared/loop-types';

/**
 * React hook for tracking active loops.
 * Derives count from the global store instead of re-fetching via IPC.
 *
 * @returns Number of currently active loops
 */
export function useActiveLoops(): number {
  return useAppStore((state) =>
    state.loops.filter((loop) => isLoopActive(loop.status)).length
  );
}
