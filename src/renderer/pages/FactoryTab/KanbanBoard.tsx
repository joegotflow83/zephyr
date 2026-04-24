/**
 * KanbanBoard — horizontal pipeline view for factory tasks.
 *
 * Renders 7 pipeline columns (backlog → done) with drag-and-drop support.
 * Validates moves against ALLOWED_TRANSITIONS and highlights valid/invalid
 * drop targets during drag.
 */

import React, { useState, useMemo } from 'react';
import {
  FACTORY_COLUMNS,
  FACTORY_COLUMN_LABELS,
  ALLOWED_TRANSITIONS,
} from '../../../shared/factory-types';
import type { FactoryTask, FactoryColumn } from '../../../shared/factory-types';

export interface KanbanBoardProps {
  tasks: FactoryTask[];
  onMoveTask: (taskId: string, targetColumn: FactoryColumn) => Promise<void>;
  onRemoveTask: (taskId: string) => Promise<void>;
  onSelectTask: (task: FactoryTask) => void;
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

type DropValidity = 'forward' | 'backward' | 'invalid';

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  tasks,
  onMoveTask,
  onRemoveTask: _onRemoveTask,
  onSelectTask,
}) => {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<FactoryColumn | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  // Index lookup for quick ordering comparison
  const columnIndex = useMemo(
    () => Object.fromEntries(FACTORY_COLUMNS.map((col, i) => [col, i])) as Record<FactoryColumn, number>,
    []
  );

  const tasksByColumn = useMemo(() => {
    const map = Object.fromEntries(
      FACTORY_COLUMNS.map((col) => [col, [] as FactoryTask[]])
    ) as Record<FactoryColumn, FactoryTask[]>;
    for (const task of tasks) {
      map[task.column].push(task);
    }
    return map;
  }, [tasks]);

  const draggedTask = draggedTaskId ? tasks.find((t) => t.id === draggedTaskId) ?? null : null;

  function getDropValidity(col: FactoryColumn): DropValidity | null {
    if (!draggedTask) return null;
    const allowed = ALLOWED_TRANSITIONS[draggedTask.column];
    if (!allowed.includes(col)) return 'invalid';
    return columnIndex[col] > columnIndex[draggedTask.column] ? 'forward' : 'backward';
  }

  function getColumnHighlightClass(col: FactoryColumn): string {
    if (!draggedTask || dragOverColumn !== col) return '';
    const validity = getDropValidity(col);
    if (validity === 'forward') return 'ring-2 ring-green-500 bg-green-900/20';
    if (validity === 'backward') return 'ring-2 ring-amber-500 bg-amber-900/20';
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

  const handleDragOver = (e: React.DragEvent, col: FactoryColumn) => {
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

  const handleDrop = async (e: React.DragEvent, col: FactoryColumn) => {
    e.preventDefault();
    setDragOverColumn(null);
    const taskId = e.dataTransfer.getData('text/plain');
    setDraggedTaskId(null);

    if (!taskId) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const allowed = ALLOWED_TRANSITIONS[task.column];
    if (!allowed.includes(col)) {
      const msg = `Cannot move from "${FACTORY_COLUMN_LABELS[task.column]}" to "${FACTORY_COLUMN_LABELS[col]}". Allowed: ${allowed.map((c) => FACTORY_COLUMN_LABELS[c]).join(', ')}.`;
      setDropError(msg);
      setTimeout(() => setDropError(null), 3500);
      return;
    }

    await onMoveTask(taskId, col);
  };

  return (
    <div className="relative flex overflow-x-auto gap-3 p-4 h-full">
      {/* Drop error toast */}
      {dropError && (
        <div className="fixed top-4 right-4 z-50 max-w-sm bg-red-700 text-white text-sm px-4 py-2 rounded shadow-lg">
          {dropError}
        </div>
      )}

      {FACTORY_COLUMNS.map((col) => {
        const colTasks = tasksByColumn[col];
        const highlightClass = getColumnHighlightClass(col);

        return (
          <div
            key={col}
            className={`flex flex-col flex-shrink-0 w-48 rounded-lg bg-gray-800 dark:bg-gray-800 transition-all ${highlightClass}`}
            onDragOver={(e) => handleDragOver(e, col)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col)}
          >
            {/* Column header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
              <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide truncate">
                {FACTORY_COLUMN_LABELS[col]}
              </span>
              <span className="ml-1 flex-shrink-0 inline-flex items-center justify-center w-5 h-5 text-xs font-medium rounded-full bg-gray-700 text-gray-400">
                {colTasks.length}
              </span>
            </div>

            {/* Task list */}
            <div className="flex-1 flex flex-col gap-2 p-2 overflow-y-auto min-h-[120px]">
              {colTasks.length === 0 ? (
                <div className="flex items-center justify-center h-16 text-xs text-gray-600 select-none">
                  No tasks
                </div>
              ) : (
                colTasks.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => onSelectTask(task)}
                    className="group flex flex-col gap-1 p-2 rounded bg-gray-700 hover:bg-gray-600 cursor-pointer transition-colors border border-transparent hover:border-gray-500 select-none"
                    title={task.title}
                  >
                    {/* Title — max 2 lines */}
                    <p className="text-xs font-medium text-gray-100 line-clamp-2 leading-snug">
                      {task.title}
                    </p>

                    {/* Badges row */}
                    <div className="flex items-center gap-1 flex-wrap">
                      {task.sourceFile && (
                        <span className="inline-flex items-center px-1 py-0.5 text-[10px] font-medium rounded bg-blue-900 text-blue-300">
                          spec
                        </span>
                      )}
                      {/* Relative timestamp */}
                      <span className="text-[10px] text-gray-500 ml-auto">
                        {formatRelativeTime(task.updatedAt)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
