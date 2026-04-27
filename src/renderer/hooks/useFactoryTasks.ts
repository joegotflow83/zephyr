/**
 * Convenience hook for accessing factory task state and the active pipeline.
 *
 * Wraps IPC calls to the factory task backend and provides a clean
 * interface for kanban board operations. Task state updates automatically
 * via FACTORY_TASK_CHANGED IPC events; pipeline state updates via
 * PIPELINE_CHANGED events so consumers re-render on pipeline edits.
 */

import { useState, useEffect } from 'react';
import { useAppStore } from '../stores/app-store';
import type { FactoryTask } from '../../shared/factory-types';
import type { Pipeline } from '../../shared/pipeline-types';
import { columnsFor } from '../../shared/pipeline-types';
import { deriveTransitions, type DerivedTransitions } from '../../lib/pipeline/transitions';

export interface UseFactoryTasksResult {
  tasks: FactoryTask[];
  loading: boolean;
  pipeline: Pipeline | null;
  columns: string[];
  allowedTransitions: DerivedTransitions;
  addTask: (title: string, description?: string) => Promise<FactoryTask>;
  moveTask: (taskId: string, targetColumn: string) => Promise<FactoryTask>;
  removeTask: (taskId: string) => Promise<boolean>;
  syncFromSpecs: () => Promise<FactoryTask[]>;
}

/**
 * Hook that provides factory task state, active pipeline, and operations for a
 * given project. All mutations broadcast FACTORY_TASK_CHANGED / PIPELINE_CHANGED
 * which automatically update state here.
 */
export function useFactoryTasks(
  projectId: string | null,
  pipelineId?: string | null
): UseFactoryTasksResult {
  const allTasks = useAppStore((state) => state.factoryTasks);
  const loading = useAppStore((state) => state.factoryTasksLoading);

  const tasks = projectId ? (allTasks[projectId] ?? []) : [];

  const [pipeline, setPipeline] = useState<Pipeline | null>(null);

  useEffect(() => {
    if (!pipelineId) {
      setPipeline(null);
      return;
    }
    void window.api.pipelines.get(pipelineId).then(setPipeline);
    const cleanup = window.api.pipelines.onChanged((pipelines) => {
      setPipeline(pipelines.find((p) => p.id === pipelineId) ?? null);
    });
    return cleanup;
  }, [pipelineId]);

  const columns = pipeline ? columnsFor(pipeline) : [];
  const allowedTransitions: DerivedTransitions = pipeline
    ? deriveTransitions(pipeline)
    : { allowed: {}, forward: {} };

  const addTask = async (title: string, description?: string): Promise<FactoryTask> => {
    if (!projectId) throw new Error('No project selected');
    return window.api.factoryTasks.add(projectId, title, description);
  };

  const moveTask = async (taskId: string, targetColumn: string): Promise<FactoryTask> => {
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

  return {
    tasks,
    loading,
    pipeline,
    columns,
    allowedTransitions,
    addTask,
    moveTask,
    removeTask,
    syncFromSpecs,
  };
}
