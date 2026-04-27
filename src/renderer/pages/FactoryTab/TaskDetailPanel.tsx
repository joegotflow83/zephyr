import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { FactoryTask } from '../../../shared/factory-types';
import type { Pipeline } from '../../../shared/pipeline-types';
import { deriveTransitions } from '../../../lib/pipeline/transitions';

export interface TaskDetailPanelProps {
  task: FactoryTask;
  pipeline?: Pipeline | null;
  tasks?: FactoryTask[];
  onClose: () => void;
  onMove: (taskId: string, targetColumn: string) => Promise<void>;
  onUpdate: (taskId: string, updates: Partial<Pick<FactoryTask, 'title' | 'description'>>) => Promise<void>;
  onRemove: (taskId: string) => Promise<void>;
}

function formatTimestamp(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

const IMPLICIT_COLUMN_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  done: 'Done',
  blocked: 'Blocked',
};

function resolveLabel(pipeline: Pipeline | null | undefined, column: string): string {
  if (pipeline) {
    const stage = pipeline.stages.find((s) => s.id === column);
    if (stage) return stage.name;
  }
  return IMPLICIT_COLUMN_LABELS[column] ?? column;
}

const IMPLICIT_BADGE_CLASSES: Record<string, string> = {
  backlog: 'bg-gray-700 text-gray-300',
  done: 'bg-green-900 text-green-300',
  blocked: 'bg-red-900 text-red-300',
};

export const TaskDetailPanel: React.FC<TaskDetailPanelProps> = ({
  task,
  pipeline,
  tasks,
  onClose,
  onMove,
  onUpdate,
  onRemove,
}) => {
  const [titleValue, setTitleValue] = useState(task.title);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState(task.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitleValue(task.title);
    setDescriptionValue(task.description);
    setIsEditingDescription(false);
    setConfirmDelete(false);
  }, [task.id]);

  const transitions = useMemo(
    () => (pipeline ? deriveTransitions(pipeline) : null),
    [pipeline]
  );

  const col = task.column;

  const forwardTarget = transitions?.forward[col] ?? null;

  const backwardTarget = (() => {
    if (!transitions) return null;
    const allowed = transitions.allowed[col] ?? [];
    const fwd = transitions.forward[col];
    return allowed.find((c) => c !== fwd && c !== 'blocked') ?? null;
  })();

  // Stage badge styling: prefer pipeline stage color, fall back to implicit classes
  const pipelineStage = pipeline?.stages.find((s) => s.id === col);
  const badgeStyle = pipelineStage?.color
    ? {
        backgroundColor: `${pipelineStage.color}26`,
        color: pipelineStage.color,
        border: `1px solid ${pipelineStage.color}66`,
      }
    : undefined;
  const badgeClass = badgeStyle
    ? ''
    : (IMPLICIT_BADGE_CLASSES[col] ?? 'bg-gray-700 text-gray-300');

  const stageIcon = pipelineStage?.icon ?? null;
  const stageName = resolveLabel(pipeline, col);

  // Hierarchy context
  const parentTask = task.parentTaskId && tasks
    ? tasks.find((t) => t.id === task.parentTaskId) ?? null
    : null;

  const subTasks = task.isEpic && tasks
    ? tasks.filter((t) => t.parentTaskId === task.id)
    : [];

  async function handleTitleSave() {
    const trimmed = titleValue.trim();
    if (!trimmed || trimmed === task.title) {
      setTitleValue(task.title);
      return;
    }
    setBusy(true);
    try {
      await onUpdate(task.id, { title: trimmed });
    } finally {
      setBusy(false);
    }
  }

  async function handleDescriptionSave() {
    setIsEditingDescription(false);
    if (descriptionValue === task.description) return;
    setBusy(true);
    try {
      await onUpdate(task.id, { description: descriptionValue });
    } finally {
      setBusy(false);
    }
  }

  async function handleMoveForward() {
    if (!forwardTarget || busy) return;
    setBusy(true);
    try {
      await onMove(task.id, forwardTarget);
    } finally {
      setBusy(false);
    }
  }

  async function handleMoveBackward() {
    if (!backwardTarget || busy) return;
    setBusy(true);
    try {
      await onMove(task.id, backwardTarget);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await onRemove(task.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div
        className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col bg-gray-900 shadow-2xl border-l border-gray-700"
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${badgeClass}`}
            style={badgeStyle}
          >
            {stageIcon && <span aria-hidden="true">{stageIcon}</span>}
            {stageName}
          </span>
          <div className="flex items-center gap-2 ml-2">
            {task.lockedBy && (
              <span
                className="text-xs text-yellow-300 flex items-center gap-1"
                aria-label="locked"
                title={`Locked by: ${task.lockedBy}`}
              >
                🔒
                <span className="font-mono truncate max-w-[120px]">{task.lockedBy}</span>
              </span>
            )}
            {(task.bounceCount ?? 0) > 0 && (
              <span
                className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold bg-orange-900 text-orange-300"
                title={`Bounced ${task.bounceCount} ${task.bounceCount === 1 ? 'time' : 'times'}`}
                aria-label={`bounce count ${task.bounceCount}`}
              >
                ↩ {task.bounceCount}
              </span>
            )}
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
              aria-label="Close panel"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Parent breadcrumb for sub-tasks */}
          {task.parentTaskId && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
                Epic
              </label>
              <p className="text-xs text-purple-300 truncate" aria-label="parent task">
                📌 {parentTask ? parentTask.title : task.parentTaskId}
              </p>
            </div>
          )}

          {/* Sub-task list for epics */}
          {task.isEpic && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
                Sub-tasks{subTasks.length > 0 && ` (${subTasks.filter((t) => t.column === 'done').length}/${subTasks.length} done)`}
              </label>
              {subTasks.length === 0 ? (
                <p className="text-xs text-gray-500 italic">No sub-tasks yet</p>
              ) : (
                <ul className="space-y-1" aria-label="sub-tasks">
                  {subTasks.map((sub) => (
                    <li key={sub.id} className="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                      <span className={sub.column === 'done' ? 'text-green-400' : 'text-gray-500'} aria-hidden="true">
                        {sub.column === 'done' ? '✓' : '○'}
                      </span>
                      <span className="truncate flex-1">{sub.title}</span>
                      <span className="text-gray-500 shrink-0">{resolveLabel(pipeline, sub.column)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Editable title */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
              Title
            </label>
            <input
              ref={titleInputRef}
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  setTitleValue(task.title);
                  e.currentTarget.blur();
                }
              }}
              disabled={busy}
              className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>

          {/* Source file (shown only if set) */}
          {task.sourceFile && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
                Source File
              </label>
              <p className="text-sm text-blue-300 font-mono truncate">{task.sourceFile}</p>
            </div>
          )}

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400">
                Description
              </label>
              {!isEditingDescription && (
                <button
                  onClick={() => setIsEditingDescription(true)}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Edit
                </button>
              )}
            </div>

            {isEditingDescription ? (
              <div className="space-y-2">
                <textarea
                  value={descriptionValue}
                  onChange={(e) => setDescriptionValue(e.target.value)}
                  rows={8}
                  className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  placeholder="Task description (Markdown supported)…"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleDescriptionSave}
                    disabled={busy}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setDescriptionValue(task.description);
                      setIsEditingDescription(false);
                    }}
                    className="rounded bg-gray-700 px-3 py-1 text-xs font-medium text-gray-300 hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded bg-gray-800 border border-gray-700 px-3 py-2 min-h-[80px]">
                {task.description ? (
                  <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                    {task.description}
                  </pre>
                ) : (
                  <p className="text-sm text-gray-600 italic">No description</p>
                )}
              </div>
            )}
          </div>

          {/* Timestamps */}
          <div className="space-y-1 text-xs text-gray-500">
            <div>
              <span className="font-medium text-gray-400">Created: </span>
              {formatTimestamp(task.createdAt)}
            </div>
            <div>
              <span className="font-medium text-gray-400">Updated: </span>
              {formatTimestamp(task.updatedAt)}
            </div>
          </div>
        </div>

        {/* Actions footer */}
        <div className="border-t border-gray-700 px-4 py-3 space-y-2">
          {/* Move to Next Stage */}
          <button
            onClick={handleMoveForward}
            disabled={!forwardTarget || busy}
            className="w-full rounded bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {forwardTarget
              ? `Move to ${resolveLabel(pipeline, forwardTarget)} →`
              : 'Done — no further stages'}
          </button>

          {/* Send Back — hidden for backlog */}
          {backwardTarget && (
            <button
              onClick={handleMoveBackward}
              disabled={busy}
              className="w-full rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-40 transition-colors"
            >
              ← Send Back to {resolveLabel(pipeline, backwardTarget)}
            </button>
          )}

          {/* Delete */}
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="w-full rounded bg-transparent border border-red-700 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/30 disabled:opacity-40 transition-colors"
            >
              Delete Task
            </button>
          ) : (
            <div className="rounded border border-red-600 bg-red-900/20 p-3 space-y-2">
              <p className="text-xs text-red-300 text-center">Are you sure? This cannot be undone.</p>
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  disabled={busy}
                  className="flex-1 rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
                >
                  Yes, Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
