/**
 * Types and constants for the Coding Factory kanban pipeline.
 *
 * These are shared between the main process (IPC handlers, persistence) and
 * the renderer (UI components, Zustand store).
 */

/**
 * Pipeline column identifiers, in order from left to right.
 */
export type FactoryColumn =
  | 'backlog'
  | 'start'
  | 'inprogress'
  | 'security'
  | 'qa'
  | 'documentation'
  | 'done';

/**
 * All pipeline columns in display order (backlog → done).
 */
export const FACTORY_COLUMNS: FactoryColumn[] = [
  'backlog',
  'start',
  'inprogress',
  'security',
  'qa',
  'documentation',
  'done',
];

/**
 * Human-readable labels for each pipeline column.
 */
export const FACTORY_COLUMN_LABELS: Record<FactoryColumn, string> = {
  backlog: 'Backlog',
  start: 'Ready',
  inprogress: 'In Progress',
  security: 'Security Review',
  qa: 'QA',
  documentation: 'Documentation',
  done: 'Done',
};

/**
 * A single task tracked through the factory pipeline.
 */
export interface FactoryTask {
  /** UUID v4 identifier */
  id: string;
  /** Display name (derived from spec filename or user input) */
  title: string;
  /** Markdown content (spec file body or user-entered) */
  description: string;
  /** Current pipeline position */
  column: FactoryColumn;
  /** Owning project ID */
  projectId: string;
  /** Original spec filename if auto-imported (e.g. "auth-refactor.md") */
  sourceFile?: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last-updated timestamp */
  updatedAt: string;
}

/**
 * Full task queue state for a project.
 */
export interface FactoryTaskQueue {
  projectId: string;
  tasks: FactoryTask[];
}

/**
 * Allowed transitions for each column.
 *
 * Forward movement follows the pipeline; backward movement allows
 * sending tasks back for rework. The UI enforces this set when
 * the user drags cards — the backend validates it too.
 */
export const ALLOWED_TRANSITIONS: Record<FactoryColumn, FactoryColumn[]> = {
  backlog: ['start'],
  start: ['inprogress', 'backlog'],
  inprogress: ['security', 'start'],
  security: ['qa', 'inprogress'],
  qa: ['documentation', 'inprogress'],
  documentation: ['done', 'qa'],
  done: ['backlog'], // reopen — send back to backlog for another pass
};

/**
 * Forward-only transitions (single next stage per column).
 *
 * Agents can only advance tasks, not regress them. UI "Move to Next Stage"
 * buttons also use this map to determine the target column.
 * `null` means the task is in the terminal column (done).
 */
export const FORWARD_TRANSITIONS: Record<FactoryColumn, FactoryColumn | null> = {
  backlog: 'start',
  start: 'inprogress',
  inprogress: 'security',
  security: 'qa',
  qa: 'documentation',
  documentation: 'done',
  done: null,
};
