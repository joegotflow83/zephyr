import React, { useState, useEffect, useCallback } from 'react';
import { KanbanBoard } from './KanbanBoard';
import { TaskDetailPanel } from './TaskDetailPanel';
import { AddTaskForm } from './AddTaskForm';
import { FactoryFlowView } from '../LoopsTab/FactoryFlowView';
import { useFactoryTasks } from '../../hooks/useFactoryTasks';
import { useAppStore } from '../../stores/app-store';
import type { FactoryTask } from '../../../shared/factory-types';
import type { LoopState } from '../../../shared/loop-types';
import { getLoopKey } from '../../../shared/loop-types';

export const FactoryTab: React.FC = () => {
  const projects = useAppStore((s) => s.projects);
  const loops = useAppStore((s) => s.loops);
  const refreshFactoryTasks = useAppStore((s) => s.refreshFactoryTasks);

  // Filter to factory-enabled projects only
  const factoryProjects = projects.filter((p) => p.factory_config?.enabled === true);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<FactoryTask | null>(null);
  const [selectedLoopKey, setSelectedLoopKey] = useState<string | null>(null);
  const [hasSynced, setHasSynced] = useState<Record<string, boolean>>({});

  // Auto-select first factory-enabled project
  useEffect(() => {
    if (!selectedProjectId && factoryProjects.length > 0) {
      setSelectedProjectId(factoryProjects[0].id);
    }
    // If the currently selected project is no longer factory-enabled, pick another
    if (
      selectedProjectId &&
      !factoryProjects.find((p) => p.id === selectedProjectId)
    ) {
      setSelectedProjectId(factoryProjects.length > 0 ? factoryProjects[0].id : null);
    }
  }, [factoryProjects, selectedProjectId]);

  const pipelineId =
    factoryProjects.find((p) => p.id === selectedProjectId)?.pipelineId ?? null;

  const { tasks, loading, pipeline, addTask, moveTask, removeTask, syncFromSpecs } =
    useFactoryTasks(selectedProjectId, pipelineId);

  // On mount and project change, load tasks
  useEffect(() => {
    if (selectedProjectId) {
      refreshFactoryTasks(selectedProjectId);
    }
  }, [selectedProjectId, refreshFactoryTasks]);

  // Auto-sync on first load if tasks array is empty
  useEffect(() => {
    if (
      selectedProjectId &&
      !hasSynced[selectedProjectId] &&
      tasks.length === 0 &&
      !loading
    ) {
      setHasSynced((prev) => ({ ...prev, [selectedProjectId]: true }));
      void syncFromSpecs();
    }
  }, [selectedProjectId, tasks.length, loading, hasSynced, syncFromSpecs]);

  // Loops for the selected project
  const projectLoops: LoopState[] = selectedProjectId
    ? loops.filter((l) => l.projectId === selectedProjectId)
    : [];

  const handleMoveTask = useCallback(
    async (taskId: string, targetColumn: string) => {
      const updated = await moveTask(taskId, targetColumn);
      // If the detail panel is open for this task, update it
      setSelectedTask((prev) => (prev?.id === taskId ? updated : prev));
    },
    [moveTask]
  );

  const handleRemoveTask = useCallback(
    async (taskId: string) => {
      await removeTask(taskId);
      setSelectedTask((prev) => (prev?.id === taskId ? null : prev));
    },
    [removeTask]
  );

  const handleUpdateTask = useCallback(
    async (taskId: string, updates: Partial<FactoryTask>) => {
      const updated = await window.api.factoryTasks.update(
        selectedProjectId!,
        taskId,
        updates
      );
      setSelectedTask((prev) => (prev?.id === taskId ? updated : prev));
    },
    [selectedProjectId]
  );

  const handleSyncFromSpecs = useCallback(async () => {
    await syncFromSpecs();
  }, [syncFromSpecs]);

  // Empty state — no factory-enabled projects
  if (projects.length > 0 && factoryProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400">
        <div className="text-5xl mb-4">🏭</div>
        <h2 className="text-xl font-semibold text-gray-200 mb-2">No Factory Projects</h2>
        <p className="text-sm text-center max-w-sm">
          Enable factory mode on a project by setting{' '}
          <code className="text-blue-400">factory_config.enabled = true</code> in its settings.
        </p>
      </div>
    );
  }

  // Loading state while projects load initially
  if (projects.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading projects…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-900 overflow-hidden">
      {/* Top bar: project selector + sync button */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-700 flex-shrink-0">
        <label className="text-xs text-gray-400 font-medium">Project</label>
        <select
          value={selectedProjectId ?? ''}
          onChange={(e) => setSelectedProjectId(e.target.value || null)}
          className="bg-gray-800 border border-gray-600 text-gray-200 text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {factoryProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        <button
          onClick={handleSyncFromSpecs}
          disabled={!selectedProjectId || loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-200 rounded transition-colors"
        >
          <span>⟳</span>
          Sync from Specs
        </button>
      </div>

      {/* Factory flow diagram */}
      {projectLoops.length > 0 && (
        <div className="flex-shrink-0 border-b border-gray-700">
          <FactoryFlowView
            loops={projectLoops}
            selectedLoopKey={selectedLoopKey}
            onSelectLoop={(loop) => setSelectedLoopKey(getLoopKey(loop))}
            onRestartLoop={(loop) => {
              window.api.factory.restartContainer(loop.projectId, loop.role ?? '').catch(() => {});
            }}
          />
        </div>
      )}

      {/* Kanban board — scrollable */}
      <div className="flex-1 overflow-hidden">
        {selectedProjectId ? (
          <KanbanBoard
            tasks={tasks}
            pipeline={pipeline}
            onMoveTask={handleMoveTask}
            onRemoveTask={handleRemoveTask}
            onSelectTask={setSelectedTask}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Select a project to view tasks.
          </div>
        )}
      </div>

      {/* Add task form */}
      {selectedProjectId && (
        <div className="flex-shrink-0 border-t border-gray-700 px-4 py-3">
          <AddTaskForm
            onAdd={async (title, description) => {
              await addTask(title, description);
            }}
          />
        </div>
      )}

      {/* Task detail side panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          pipeline={pipeline}
          tasks={tasks}
          onClose={() => setSelectedTask(null)}
          onMove={async (taskId, targetColumn) => {
            await handleMoveTask(taskId, targetColumn);
          }}
          onUpdate={async (taskId, updates) => {
            await handleUpdateTask(taskId, updates);
          }}
          onRemove={async (taskId) => {
            await handleRemoveTask(taskId);
          }}
        />
      )}
    </div>
  );
};
