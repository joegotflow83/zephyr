/**
 * KanbanBoard — horizontal pipeline view for factory tasks.
 *
 * Renders columns derived from the active pipeline: [Backlog, ...stages, Done, Blocked].
 * Validates drag-and-drop moves against transitions computed by deriveTransitions().
 */

import React, { useState, useMemo } from 'react';
import type { Pipeline } from '../../../shared/pipeline-types';
import { columnsFor } from '../../../shared/pipeline-types';
import { deriveTransitions } from '../../../lib/pipeline/transitions';
import type { FactoryTask } from '../../../shared/factory-types';

export interface KanbanBoardProps {
  tasks: FactoryTask[];
  pipeline: Pipeline | null;
  onMoveTask: (taskId: string, targetColumn: string) => Promise<void>;
  onRemoveTask: (taskId: string) => Promise<void>;
  onSelectTask: (task: FactoryTask) => void;
  /** Called when user clicks + to add a container instance for a stage. */
  onScaleUp?: (stageId: string) => void;
  /** Called when user clicks - to remove a container instance for a stage. */
  onScaleDown?: (stageId: string) => void;
  /** Number of running instances per stage (from loop state). */
  runningInstances?: Record<string, number>;
}

/** Format an ISO timestamp as a human-readable relative time string. */
function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSecs = Math.floor(diffMs / 1000);

  if (diffSecs < 60) return 'just now';
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/** Build a label map from pipeline stages plus the three implicit columns. */
function buildColumnLabels(pipeline: Pipeline | null): Record<string, string> {
  const base: Record<string, string> = {
    backlog: 'Backlog',
    done: 'Done',
    blocked: 'Blocked',
    needs_input: 'Needs Input',
  };
  if (!pipeline) return base;
  for (const stage of pipeline.stages) {
    base[stage.id] = stage.name;
  }
  return base;
}

interface ColumnMeta {
  icon?: string;
  color?: string;
}

/** Build icon/color metadata from pipeline stages; implicit columns get no overrides. */
function buildColumnMeta(pipeline: Pipeline | null): Record<string, ColumnMeta> {
  const base: Record<string, ColumnMeta> = {
    backlog: {},
    done: {},
    // Blocked is always rendered with a danger accent regardless of pipeline config.
    blocked: { color: '#ef4444' },
    // Needs Input uses amber to signal "waiting on human" without implying failure.
    needs_input: { icon: '✋', color: '#f59e0b' },
  };
  if (!pipeline) return base;
  for (const stage of pipeline.stages) {
    base[stage.id] = { icon: stage.icon, color: stage.color };
  }
  return base;
}

/**
 * 'block' — target is the Blocked column; always permitted as a human override
 * regardless of pipeline transition rules.
 */
type DropValidity = 'forward' | 'backward' | 'block' | 'invalid';

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  tasks,
  pipeline,
  onMoveTask,
  onRemoveTask: _onRemoveTask,
  onSelectTask,
  onScaleUp,
  onScaleDown,
  runningInstances,
}) => {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  const columns = useMemo(() => (pipeline ? columnsFor(pipeline) : []), [pipeline]);

  const transitions = useMemo(
    () => (pipeline ? deriveTransitions(pipeline) : { allowed: {}, forward: {} }),
    [pipeline]
  );

  const columnLabels = useMemo(() => buildColumnLabels(pipeline), [pipeline]);
  const columnMeta = useMemo(() => buildColumnMeta(pipeline), [pipeline]);

  // Index lookup for forward/backward direction comparison
  const columnIndex = useMemo(
    () => Object.fromEntries(columns.map((col, i) => [col, i])) as Record<string, number>,
    [columns]
  );

  const tasksByColumn = useMemo(() => {
    const map: Record<string, FactoryTask[]> = Object.fromEntries(
      columns.map((col) => [col, [] as FactoryTask[]])
    );
    for (const task of tasks) {
      // Epics are tracked in the separate epic progress section, not as cards
      if (task.isEpic) continue;
      if (map[task.column] !== undefined) {
        map[task.column].push(task);
      }
    }
    return map;
  }, [tasks, columns]);

  /** Compute sub-task progress for all epics. */
  const epicProgress = useMemo(() => {
    return tasks
      .filter((t) => t.isEpic)
      .map((epic) => {
        const subtasks = tasks.filter((t) => t.parentTaskId === epic.id);
        const done = subtasks.filter((t) => t.column === 'done').length;
        return { id: epic.id, title: epic.title, done, total: subtasks.length };
      });
  }, [tasks]);

  const draggedTask = draggedTaskId ? (tasks.find((t) => t.id === draggedTaskId) ?? null) : null;

  function getDropValidity(col: string): DropValidity | null {
    if (!draggedTask) return null;
    const fromCol = draggedTask.column;
    // Blocked and Needs Input are always valid destinations — human override.
    if (col === 'blocked') return fromCol === 'blocked' ? null : 'block';
    if (col === 'needs_input') return fromCol === 'needs_input' ? null : 'block';
    const allowed = transitions.allowed[fromCol] ?? [];
    if (!allowed.includes(col)) return 'invalid';
    return columnIndex[col] > columnIndex[fromCol] ? 'forward' : 'backward';
  }

  function getColumnHighlightClass(col: string): string {
    if (!draggedTask || dragOverColumn !== col) return '';
    const validity = getDropValidity(col);
    if (validity === 'forward') return 'ring-2 ring-green-500 bg-green-900/20';
    if (validity === 'backward') return 'ring-2 ring-amber-500 bg-amber-900/20';
    if (validity === 'block') return 'ring-2 ring-red-500 bg-red-900/20';
    return 'ring-2 ring-red-500/60';
  }

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedTaskId(taskId);
  };

  const handleDragEnd = () => {
    setDraggedTaskId(null);
    setDragOverColumn(null);
  };

  const handleDragOver = (e: React.DragEvent, col: string) => {
    e.preventDefault();
    setDragOverColumn(col);
    const validity = getDropValidity(col);
    e.dataTransfer.dropEffect = validity === 'invalid' ? 'none' : 'move';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the column entirely (not entering a child element)
    const related = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(related)) {
      setDragOverColumn(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, col: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    const taskId = e.dataTransfer.getData('text/plain');
    setDraggedTaskId(null);

    if (!taskId) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const fromCol = task.column;

    // Blocked and Needs Input are always reachable from any column as a human escalation.
    if (col !== 'blocked' && col !== 'needs_input') {
      const allowed = transitions.allowed[fromCol] ?? [];
      if (!allowed.includes(col)) {
        const fromLabel = columnLabels[fromCol] ?? fromCol;
        const toLabel = columnLabels[col] ?? col;
        const allowedLabels = allowed.map((c) => columnLabels[c] ?? c).join(', ');
        const msg = `Cannot move from "${fromLabel}" to "${toLabel}". Allowed: ${allowedLabels}.`;
        setDropError(msg);
        setTimeout(() => setDropError(null), 3500);
        return;
      }
    }

    await onMoveTask(taskId, col);
  };

  const IMPLICIT = new Set(['backlog', 'done', 'blocked', 'needs_input']);

  if (!pipeline) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        No pipeline configured for this project.
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full">
      {/* Epic tracker — shown above columns when epics exist */}
      {epicProgress.length > 0 && (
        <div
          className="flex items-center gap-4 px-4 py-2 border-b border-gray-700 bg-gray-800/50 flex-shrink-0 overflow-x-auto"
          aria-label="Epic progress"
        >
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide shrink-0">
            Epics
          </span>
          {epicProgress.map((ep) => {
            const epicTask = tasks.find((t) => t.id === ep.id) ?? null;
            const isDebriefing = !!(
              pipeline &&
              epicTask &&
              pipeline.stages.find((s) => s.id === epicTask.column && s.role === 'debrief')
            );
            return (
              <div
                key={ep.id}
                className="flex items-center gap-2 text-xs shrink-0 cursor-pointer rounded px-1 py-0.5 hover:bg-gray-700/60 transition-colors"
                title={`${ep.title}: ${ep.done}/${ep.total} sub-tasks done — click to manage`}
                onClick={() => epicTask && onSelectTask(epicTask)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && epicTask) onSelectTask(epicTask);
                }}
              >
                <span className="text-purple-400 truncate max-w-[200px]">📌 {ep.title}</span>
                {isDebriefing && (
                  <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-amber-500/20 text-amber-300 rounded border border-amber-500/30 uppercase tracking-wide shrink-0">
                    Debriefing
                  </span>
                )}
                <div className="flex items-center gap-1">
                  <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 rounded-full transition-all"
                      style={{ width: ep.total > 0 ? `${(ep.done / ep.total) * 100}%` : '0%' }}
                    />
                  </div>
                  <span
                    className="text-gray-400 font-medium text-[10px]"
                    aria-label={`${ep.done} of ${ep.total} sub-tasks done`}
                  >
                    {ep.done}/{ep.total}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Kanban columns */}
      <div className="relative flex overflow-x-auto gap-3 p-4 flex-1 min-h-0">
        {/* Drop error toast */}
        {dropError && (
          <div className="fixed top-4 right-4 z-50 max-w-sm bg-red-700 text-white text-sm px-4 py-2 rounded shadow-lg">
            {dropError}
          </div>
        )}

        {columns.map((col) => {
          const colTasks = tasksByColumn[col] ?? [];
          const highlightClass = getColumnHighlightClass(col);
          const label = columnLabels[col] ?? col;
          const meta = columnMeta[col] ?? {};
          const accentStyle = meta.color
            ? { borderTop: `3px solid ${meta.color}` }
            : { borderTop: '3px solid transparent' };

          return (
            <div
              key={col}
              style={accentStyle}
              className={`flex flex-col flex-shrink-0 w-48 rounded-lg bg-gray-800 dark:bg-gray-800 transition-all ${highlightClass}`}
              onDragOver={(e) => handleDragOver(e, col)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col)}
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
                <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide truncate flex items-center gap-1 min-w-0">
                  {meta.icon && (
                    <span className="not-italic normal-case" aria-hidden="true">
                      {meta.icon}
                    </span>
                  )}
                  {label}
                </span>
                <div className="ml-1 flex items-center gap-1 flex-shrink-0">
                  {/* Instance scale controls for pipeline stages */}
                  {onScaleUp && !IMPLICIT.has(col) && runningInstances && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onScaleDown?.(col);
                        }}
                        disabled={!onScaleDown || (runningInstances[col] ?? 0) <= 1}
                        className="w-4 h-4 flex items-center justify-center text-[10px] rounded bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        title={`Remove a ${label} container`}
                        aria-label={`Decrease ${label} instances`}
                      >
                        −
                      </button>
                      <span
                        className="text-[10px] text-gray-400 font-mono w-4 text-center"
                        title={`${runningInstances[col] ?? 0} running instance(s)`}
                      >
                        {runningInstances[col] ?? 0}×
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onScaleUp(col);
                        }}
                        className="w-4 h-4 flex items-center justify-center text-[10px] rounded bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white"
                        title={`Add a ${label} container`}
                        aria-label={`Increase ${label} instances`}
                      >
                        +
                      </button>
                    </>
                  )}
                  <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium rounded-full bg-gray-700 text-gray-400">
                    {colTasks.length}
                  </span>
                </div>
              </div>

              {/* Task list */}
              <div className="flex-1 flex flex-col gap-2 p-2 overflow-y-auto min-h-[120px]">
                {colTasks.length === 0 ? (
                  <div className="flex items-center justify-center h-16 text-xs text-gray-600 select-none">
                    No tasks
                  </div>
                ) : (
                  colTasks.map((task) => {
                    const parentTask = task.parentTaskId
                      ? tasks.find((t) => t.id === task.parentTaskId)
                      : null;
                    return (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task.id)}
                        onDragEnd={handleDragEnd}
                        onClick={() => onSelectTask(task)}
                        className="group flex flex-col gap-1 p-2 rounded bg-gray-700 hover:bg-gray-600 cursor-pointer transition-colors border border-transparent hover:border-gray-500 select-none"
                        title={task.title}
                      >
                        {/* Parent epic breadcrumb — shown when task belongs to an epic */}
                        {parentTask && (
                          <p className="text-[10px] text-purple-400 truncate leading-none">
                            📌 {parentTask.title}
                          </p>
                        )}

                        {/* Title — max 2 lines */}
                        <p className="text-xs font-medium text-gray-100 line-clamp-2 leading-snug">
                          {task.title}
                        </p>

                        {/* Badges row */}
                        <div className="flex items-center gap-1 flex-wrap">
                          {task.lockedBy &&
                            (() => {
                              const active = /^.+-\d+$/.test(task.lockedBy);
                              return active ? (
                                <span
                                  className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[10px] font-medium rounded bg-blue-900/70 text-blue-300 animate-pulse"
                                  title={`Actively worked on by ${task.lockedBy}`}
                                  aria-label={`actively worked on by ${task.lockedBy}`}
                                >
                                  ⚙ {task.lockedBy}
                                </span>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[10px] font-medium rounded bg-yellow-900/60 text-yellow-300"
                                  title={`Queued for ${task.lockedBy}`}
                                  aria-label={`queued for ${task.lockedBy}`}
                                >
                                  🔒 {task.lockedBy}
                                </span>
                              );
                            })()}
                          {task.lastError && (
                            <span
                              className="inline-flex items-center px-1 py-0.5 text-[10px] font-medium rounded bg-red-900 text-red-300"
                              title={task.lastError}
                              aria-label="has error"
                            >
                              ⚠ error
                            </span>
                          )}
                          {task.sourceFile && (
                            <span className="inline-flex items-center px-1 py-0.5 text-[10px] font-medium rounded bg-blue-900 text-blue-300">
                              spec
                            </span>
                          )}
                          {task.bounceCount > 0 && (
                            <span
                              className="inline-flex items-center px-1 py-0.5 text-[10px] font-medium rounded bg-orange-900 text-orange-300"
                              title={`Bounced ${task.bounceCount} time${task.bounceCount === 1 ? '' : 's'}`}
                            >
                              ↩ {task.bounceCount}
                            </span>
                          )}
                          {/* Relative timestamp */}
                          <span className="text-[10px] text-gray-500 ml-auto">
                            {formatRelativeTime(task.updatedAt)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
