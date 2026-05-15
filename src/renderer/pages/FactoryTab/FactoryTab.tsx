import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { KanbanBoard } from './KanbanBoard';
import { TaskDetailPanel } from './TaskDetailPanel';
import { AddTaskForm } from './AddTaskForm';
import { FactoryFlowView } from './FactoryFlowView';
import { LogViewer } from '../../components/LogViewer/LogViewer';
import { useFactoryTasks } from '../../hooks/useFactoryTasks';
import { useAppStore } from '../../stores/app-store';
import type { FactoryTask } from '../../../shared/factory-types';
import type { LoopState } from '../../../shared/loop-types';
import { getLoopKey, isLoopTerminal, LoopMode } from '../../../shared/loop-types';
import { useLoops } from '../../hooks/useLoops';
import { parseLogLine } from '../../utils/parseLogLine';

interface FactoryTabProps {
  initialTaskDescription?: string;
  onInitialTaskConsumed?: () => void;
}

export const FactoryTab: React.FC<FactoryTabProps> = ({ initialTaskDescription, onInitialTaskConsumed }) => {
  const projects = useAppStore((s) => s.projects);
  const projectsLoading = useAppStore((s) => s.projectsLoading);
  const loops = useAppStore((s) => s.loops);
  const refreshFactoryTasks = useAppStore((s) => s.refreshFactoryTasks);

  // Filter to factory-enabled projects only
  const factoryProjects = projects.filter((p) => p.factory_config?.enabled === true);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<FactoryTask | null>(null);
  const [selectedLoopKey, setSelectedLoopKey] = useState<string | null>(null);
  const [hasSynced, setHasSynced] = useState<Record<string, boolean>>({});
  const { factoryStart, factoryStop } = useLoops();
  const [startingFactory, setStartingFactory] = useState(false);

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

  // Keep selectedTask in sync with live task data (e.g. lockedBy updates from FACTORY_TASK_CHANGED)
  useEffect(() => {
    if (!selectedTask) return;
    const live = tasks.find((t) => t.id === selectedTask.id);
    if (live && live !== selectedTask) {
      setSelectedTask(live);
    }
  }, [tasks, selectedTask]);

  // Loops for the selected project
  const projectLoops = useMemo<LoopState[]>(
    () => selectedProjectId ? loops.filter((l) => l.projectId === selectedProjectId) : [],
    [loops, selectedProjectId],
  );

  // Count running instances per stage from live loop state
  const runningInstances = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const loop of projectLoops) {
      if (isLoopTerminal(loop.status) || !loop.role) continue;
      const dashIdx = loop.role.lastIndexOf('-');
      if (dashIdx > 0) {
        const stageId = loop.role.substring(0, dashIdx);
        counts[stageId] = (counts[stageId] ?? 0) + 1;
      }
    }
    return counts;
  }, [projectLoops]);

  // Derive selected loop and its parsed log lines for the drawer
  const selectedLoop = useMemo<LoopState | undefined>(
    () => selectedLoopKey ? loops.find((l) => getLoopKey(l) === selectedLoopKey) : undefined,
    [loops, selectedLoopKey],
  );

  const parsedLogs = useMemo(
    () => (selectedLoop?.logs ?? []).map(parseLogLine),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedLoop?.logs],
  );

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
      if (!selectedProjectId) return;
      const updated = await window.api.factoryTasks.update(
        selectedProjectId,
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

  const factoryNotRunning =
    !!selectedProjectId && projectLoops.every((l) => isLoopTerminal(l.status));

  const handleStartFactory = useCallback(async () => {
    if (!selectedProjectId) return;
    const project = factoryProjects.find((p) => p.id === selectedProjectId);
    if (!project) return;
    setStartingFactory(true);
    try {
      const kiroDbPath = useAppStore.getState().settings?.kiro_db_path;
      const extraMounts = [
        ...(project.additional_mounts ?? []).map((hostPath) => {
          const basename = hostPath.split('/').filter(Boolean).pop() ?? hostPath;
          return `${hostPath}:/mnt/${basename}`;
        }),
        ...(kiroDbPath ? [`${kiroDbPath}:/home/ralph/.local/share/kiro-cli/data.sqlite3:ro`] : []),
      ];
      await factoryStart(project.id, {
        projectId: project.id,
        projectName: project.name,
        dockerImage: project.docker_image || '',
        mode: LoopMode.CONTINUOUS,
        ...(project.local_path || extraMounts.length > 0
          ? {
              volumeMounts: [
                ...(project.local_path ? [`${project.local_path}:/workspace`] : []),
                ...extraMounts,
              ],
              ...(project.local_path ? { workDir: '/workspace' } : {}),
            }
          : {}),
        ...(project.sandbox_type === 'vm'
          ? { sandboxType: 'vm' as const, vmConfig: project.vm_config }
          : {}),
      });
    } catch {
      // start failure is non-fatal — UI already shows factory-not-running banner
    } finally {
      setStartingFactory(false);
    }
  }, [selectedProjectId, factoryProjects, factoryStart]);

  const handleStopFactory = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      await factoryStop(selectedProjectId);
    } catch {
      // stop failure is non-fatal
    }
  }, [selectedProjectId, factoryStop]);

  // Loading state while projects load initially
  if (projectsLoading && projects.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading projects…
      </div>
    );
  }

  // Empty state — no projects at all
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400">
        <div className="text-5xl mb-4">🏭</div>
        <h2 className="text-xl font-semibold text-gray-200 mb-2">No Projects</h2>
        <p className="text-sm text-center max-w-sm">
          Create a project first, then enable factory mode in its settings.
        </p>
      </div>
    );
  }

  // Empty state — no factory-enabled projects
  if (factoryProjects.length === 0) {
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

        {selectedProjectId && !factoryNotRunning && (
          <button
            onClick={handleStopFactory}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
          >
            ■ Stop Factory
          </button>
        )}
      </div>

      {/* Factory flow diagram */}
      {projectLoops.length > 0 && (
        <div className="flex-shrink-0 border-b border-gray-700">
          <FactoryFlowView
            loops={projectLoops}
            selectedLoopKey={selectedLoopKey}
            onSelectLoop={(loop) => setSelectedLoopKey(getLoopKey(loop))}
            onRestartLoop={(loop) => {
              window.api.factory.restartContainer(loop.projectId, loop.role ?? '').catch(() => undefined);
            }}
          />
        </div>
      )}

      {/* Factory not running banner */}
      {selectedProjectId && factoryNotRunning && (
        <div className="flex items-center gap-2 px-4 py-2 bg-yellow-900/40 border-b border-yellow-700/50 text-yellow-300 text-xs">
          <span>⚠️</span>
          <span>Factory is not running. Agents cannot pick up tasks until the factory is started.</span>
          <button
            onClick={handleStartFactory}
            disabled={startingFactory}
            className="ml-auto px-3 py-1 text-xs font-medium bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded transition-colors"
          >
            {startingFactory ? 'Starting…' : 'Start Factory'}
          </button>
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
            onScaleUp={selectedProjectId && !factoryNotRunning ? (stageId) => {
              window.api.factory.scaleUp(selectedProjectId, stageId).catch((err: unknown) => {
                console.error('Scale up failed:', err);
              });
            } : undefined}
            onScaleDown={selectedProjectId && !factoryNotRunning ? (stageId) => {
              window.api.factory.scaleDown(selectedProjectId, stageId).catch((err: unknown) => {
                console.error('Scale down failed:', err);
              });
            } : undefined}
            runningInstances={runningInstances}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Select a project to view tasks.
          </div>
        )}
      </div>

      {/* Agent log drawer */}
      {selectedLoop && (
        <div className="flex-shrink-0 border-t border-gray-700" style={{ height: '280px' }}>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border-b border-gray-700">
            <span className="text-xs font-medium text-gray-300 truncate">
              Logs: {selectedLoop.role ?? selectedLoop.projectId}
            </span>
            <div className="flex-1" />
            <button
              onClick={() => {
                window.api.logs.export(selectedLoop.projectId, 'text').catch(() => undefined);
              }}
              className="px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
              title="Export logs"
            >
              Export
            </button>
            <button
              onClick={() => setSelectedLoopKey(null)}
              className="px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
              title="Close log viewer"
            >
              ✕
            </button>
          </div>
          <div className="h-[calc(100%-32px)]">
            <LogViewer lines={parsedLogs} autoScroll={true} />
          </div>
        </div>
      )}

      {/* Add task form */}
      {selectedProjectId && (
        <div className="flex-shrink-0 border-t border-gray-700 px-4 py-3">
          <AddTaskForm
            onAdd={async (title, description) => {
              await addTask(title, description);
            }}
            initialDescription={initialTaskDescription}
            onInitialDescriptionConsumed={onInitialTaskConsumed}
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
          onUnlock={async (taskId) => {
            const updated = await window.api.factoryTasks.unlock(selectedProjectId ?? '', taskId);
            setSelectedTask((prev) => (prev?.id === taskId ? updated : prev));
          }}
        />
      )}
    </div>
  );
};
