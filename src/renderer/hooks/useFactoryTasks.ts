/**
 * Convenience hook for accessing factory task state from the global store.
 *
 * Wraps IPC calls to the factory task backend and provides a clean
 * interface for kanban board operations. State updates automatically
 * via FACTORY_TASK_CHANGED IPC events.
 */

import { useAppStore } from '../stores/app-store';
import type { FactoryTask, FactoryColumn } from '../../shared/factory-types';

export interface UseFactoryTasksResult {
  tasks: FactoryTask[];
  loading: boolean;
  addTask: (title: string, description?: string) => Promise<FactoryTask>;
  moveTask: (taskId: string, targetColumn: FactoryColumn) => Promise<FactoryTask>;
  removeTask: (taskId: string) => Promise<boolean>;
  syncFromSpecs: () => Promise<FactoryTask[]>;
}

/**
 * Hook that provides factory task state and operations for a given project.
 * All mutations broadcast FACTORY_TASK_CHANGED which automatically updates the store.
 */
export function useFactoryTasks(projectId: string | null): UseFactoryTasksResult {
  const allTasks = useAppStore((state) => state.factoryTasks);
  const loading = useAppStore((state) => state.factoryTasksLoading);

  const tasks = projectId ? (allTasks[projectId] ?? []) : [];

  const addTask = async (title: string, description?: string): Promise<FactoryTask> => {
    if (!projectId) throw new Error('No project selected');
    return window.api.factoryTasks.add(projectId, title, description);
  };

  const moveTask = async (taskId: string, targetColumn: FactoryColumn): Promise<FactoryTask> => {
    if (!projectId) throw new Error('No project selected');
    return window.api.factoryTasks.move(projectId, taskId, targetColumn);
  };

  const removeTask = async (taskId: string): Promise<boolean> => {
    if (!projectId) throw new Error('No project selected');
    return window.api.factoryTasks.remove(projectId, taskId);
  };

  const syncFromSpecs = async (): Promise<FactoryTask[]> => {
    if (!projectId) throw new Error('No project selected');
    return window.api.factoryTasks.sync(projectId);
  };

  return { tasks, loading, addTask, moveTask, removeTask, syncFromSpecs };
}
