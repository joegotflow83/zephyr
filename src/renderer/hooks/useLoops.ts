/**
 * Convenience hook for accessing loop execution state from the global store.
 *
 * Provides loop states, start/stop operations, and scheduling functionality.
 * Automatically updates when loop states change via IPC events.
 */

import { useAppStore } from '../stores/app-store';
import type { LoopState, LoopStartOpts } from '../../shared/loop-types';
import { getLoopKey } from '../../shared/loop-types';
import type { ScheduledLoop } from '../../services/scheduler';

export interface UseLoopsResult {
  loops: LoopState[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  start: (opts: LoopStartOpts) => Promise<LoopState>;
  stop: (projectId: string, role?: string) => Promise<void>;
  remove: (projectId: string, role?: string) => Promise<void>;
  get: (projectId: string, role?: string) => LoopState | undefined;
  factoryStart: (projectId: string, baseOpts: LoopStartOpts) => Promise<LoopState[]>;
  factoryStop: (projectId: string) => Promise<void>;
  schedule: (
    projectId: string,
    schedule: string,
    loopOpts: Omit<LoopStartOpts, 'mode'>
  ) => Promise<void>;
  cancelSchedule: (projectId: string) => Promise<void>;
  listScheduled: () => Promise<ScheduledLoop[]>;
}

/**
 * Hook that provides loop execution state and operations.
 * All mutations automatically update the global store.
 */
export function useLoops(): UseLoopsResult {
  const loops = useAppStore((state) => state.loops);
  const loading = useAppStore((state) => state.loopsLoading);
  const error = useAppStore((state) => state.loopsError);
  const refresh = useAppStore((state) => state.refreshLoops);
  const updateInStore = useAppStore((state) => state.updateLoop);
  const removeFromStore = useAppStore((state) => state.removeLoop);

  const start = async (opts: LoopStartOpts): Promise<LoopState> => {
    const state = await window.api.loops.start(opts);
    updateInStore(state);
    return state;
  };

  const stop = async (projectId: string, role?: string): Promise<void> => {
    await window.api.loops.stop(projectId, role);
    // State will be updated via IPC event listener
  };

  const remove = async (projectId: string, role?: string): Promise<void> => {
    await window.api.loops.remove(projectId, role);
    removeFromStore(projectId, role);
  };

  const get = (projectId: string, role?: string): LoopState | undefined => {
    const key = getLoopKey(projectId, role);
    return loops.find((l) => getLoopKey(l) === key);
  };

  const factoryStart = async (projectId: string, baseOpts: LoopStartOpts): Promise<LoopState[]> => {
    const states = await window.api.factory.start(projectId, baseOpts);
    for (const state of states) {
      updateInStore(state);
    }
    return states;
  };

  const factoryStop = async (projectId: string): Promise<void> => {
    await window.api.factory.stop(projectId);
    // States will be updated via IPC event listeners
  };

  const schedule = async (
    projectId: string,
    schedule: string,
    loopOpts: Omit<LoopStartOpts, 'mode'>
  ): Promise<void> => {
    await window.api.loops.schedule(projectId, schedule, loopOpts);
  };

  const cancelSchedule = async (projectId: string): Promise<void> => {
    await window.api.loops.cancelSchedule(projectId);
  };

  const listScheduled = async (): Promise<ScheduledLoop[]> => {
    return await window.api.loops.listScheduled();
  };

  return {
    loops,
    loading,
    error,
    refresh,
    start,
    stop,
    remove,
    get,
    factoryStart,
    factoryStop,
    schedule,
    cancelSchedule,
    listScheduled,
  };
}
