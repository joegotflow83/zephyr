/**
 * TaskDetailPanel — slide-over sidebar for viewing and editing a factory task.
 *
 * Provides: editable title, description toggle (view/edit), stage navigation
 * (Move to Next Stage / Send Back), and delete with inline confirmation.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  FACTORY_COLUMN_LABELS,
  ALLOWED_TRANSITIONS,
  FORWARD_TRANSITIONS,
} from '../../../shared/factory-types';
import type { FactoryTask, FactoryColumn } from '../../../shared/factory-types';

export interface TaskDetailPanelProps {
  task: FactoryTask;
  onClose: () => void;
  onMove: (taskId: string, targetColumn: FactoryColumn) => Promise<void>;
  onUpdate: (taskId: string, updates: Partial<Pick<FactoryTask, 'title' | 'description'>>) => Promise<void>;
  onRemove: (taskId: string) => Promise<void>;
}

/**
 * Returns the backward transition target for a given column, or null if there
 * is no backward transition (i.e., the task is in backlog).
 */
function getBackwardTransition(column: FactoryColumn): FactoryColumn | null {
  const allowed = ALLOWED_TRANSITIONS[column];
  const forwardTarget = FORWARD_TRANSITIONS[column];
  // Backward target is an allowed transition that is NOT the forward target
  const backward = allowed.find((c) => c !== forwardTarget);
  return backward ?? null;
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

const COLUMN_BADGE_CLASSES: Record<FactoryColumn, string> = {
  backlog: 'bg-gray-700 text-gray-300',
  start: 'bg-blue-900 text-blue-300',
  inprogress: 'bg-indigo-900 text-indigo-300',
  security: 'bg-orange-900 text-orange-300',
  qa: 'bg-purple-900 text-purple-300',
  documentation: 'bg-teal-900 text-teal-300',
  done: 'bg-green-900 text-green-300',
};

export const TaskDetailPanel: React.FC<TaskDetailPanelProps> = ({
  task,
  onClose,
  onMove,
  onUpdate,
  onRemove,
}) => {
  // Editable title state — synced from prop when task changes
  const [titleValue, setTitleValue] = useState(task.title);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState(task.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);

  // Reset local state when the selected task changes
  useEffect(() => {
    setTitleValue(task.title);
    setDescriptionValue(task.description);
    setIsEditingDescription(false);
    setConfirmDelete(false);
  }, [task.id]);

  const forwardTarget = FORWARD_TRANSITIONS[task.column];
  const backwardTarget = getBackwardTransition(task.column);

  async function handleTitleSave() {
    const trimmed = titleValue.trim();
    if (!trimmed || trimmed === task.title) {
      setTitleValue(task.title); // revert if empty or unchanged
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
          <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${COLUMN_BADGE_CLASSES[task.column]}`}>
            {FACTORY_COLUMN_LABELS[task.column]}
          </span>
          <button
            onClick={onClose}
            className="ml-2 rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Editable title (7.16) */}
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

          {/* Description (7.12) */}
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
          {/* Move to Next Stage (7.13) */}
          <button
            onClick={handleMoveForward}
            disabled={!forwardTarget || busy}
            className="w-full rounded bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {forwardTarget
              ? `Move to ${FACTORY_COLUMN_LABELS[forwardTarget]} →`
              : 'Done — no further stages'}
          </button>

          {/* Send Back (7.14) — hidden for backlog */}
          {backwardTarget && (
            <button
              onClick={handleMoveBackward}
              disabled={busy}
              className="w-full rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-40 transition-colors"
            >
              ← Send Back to {FACTORY_COLUMN_LABELS[backwardTarget]}
            </button>
          )}

          {/* Delete (7.15) */}
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
