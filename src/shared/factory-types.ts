/**
 * Types and constants for the Coding Factory kanban pipeline.
 *
 * These are shared between the main process (IPC handlers, persistence) and
 * the renderer (UI components, Zustand store).
 */

/**
 * Pipeline column identifiers, in order from left to right.
 *
 * @deprecated Retained only for the classic 4-role factory (PM → coder →
 * security → QA → docs). Dynamic pipelines loaded from
 * `~/.zephyr/pipelines.json` use arbitrary stage ids — consumers should
 * treat `FactoryTask.column` as a plain `string` and resolve labels /
 * transitions via the active pipeline. This type will be removed in
 * Phase 7 once all references migrate to pipeline-driven columns.
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
 * A single task tracked through the factory pipeline.
 *
 * `column` is a free-form string because dynamic pipelines define their own
 * stage ids. The three implicit columns (`backlog`, `done`, `blocked`) plus
 * every `PipelineStage.id` from the project's active pipeline are valid
 * values. Transition validity is resolved via `deriveTransitions(pipeline)`,
 * not by matching against the legacy {@link FactoryColumn} union.
 */
export interface FactoryTask {
  /** UUID v4 identifier */
  id: string;
  /** Display name (derived from spec filename or user input) */
  title: string;
  /** Markdown content (spec file body or user-entered) */
  description: string;
  /**
   * Current pipeline position. One of: `'backlog'`, `'done'`, `'blocked'`, or
   * any `PipelineStage.id` from the active pipeline.
   */
  column: string;
  /** Owning project ID */
  projectId: string;
  /** Original spec filename if auto-imported (e.g. "auth-refactor.md") */
  sourceFile?: string;
  /**
   * ID of the parent epic task when this task was produced by PM
   * decomposition. Absent on standalone tasks and on epics themselves.
   */
  parentTaskId?: string;
  /**
   * True when PM has decomposed this task into sub-tasks. Epics stay in
   * Backlog and auto-advance to Done when all children reach Done.
   */
  isEpic?: boolean;
  /**
   * Identifier of the container currently holding this task (e.g.
   * `"<projectName>-<stageId>-<instanceIndex>"`). Prevents parallel workers
   * from picking up the same task. Cleared on stage transition and on
   * `FACTORY_STOP`.
   */
  lockedBy?: string;
  /**
   * Number of times this task has been bounced backward (rejected by a
   * later stage). When `bounceCount >= pipeline.bounceLimit`, the task is
   * redirected to `'blocked'` instead of the requested column. Always a
   * number — legacy queues without this field are migrated to `0`.
   */
  bounceCount: number;
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

