/**
 * Types for the data-driven pipeline architecture.
 *
 * A {@link Pipeline} is a reusable template that defines an ordered set of
 * {@link PipelineStage}s. Each stage drives one kanban column and one or more
 * agent containers. Pipelines live in the global library
 * (`~/.zephyr/pipelines.json`) and are referenced from a project via
 * `ProjectConfig.pipelineId`.
 *
 * Shared between the main process (storage, IPC, execution) and the renderer
 * (builder UI, kanban rendering). Keep this file free of runtime imports so
 * it can be consumed from either side without bundler surprises.
 */

/**
 * Slug identifier for a {@link PipelineStage}. Free-form string so user
 * pipelines can introduce arbitrary stage ids (e.g. `"rust-specialist"`).
 */
export type StageId = string;

/**
 * A single stage in a pipeline. Drives both a kanban column and the agent
 * container(s) that process tasks in that column.
 */
export interface PipelineStage {
  /** Slug id, e.g. `"rust-specialist"`. Must be unique within a pipeline. */
  id: StageId;
  /** Display name for column headers and the builder UI. */
  name: string;
  /** Full system prompt injected into this stage's agent container(s). */
  agentPrompt: string;
  /** Parallel worker count. Default 1; >1 spawns multiple containers. */
  instances: number;
  /** Optional kanban column accent color (CSS color string). */
  color?: string;
  /** Optional emoji shown in the column header and flow diagram. */
  icon?: string;
}

/**
 * A named, ordered list of stages. Projects reference a pipeline by id via
 * `ProjectConfig.pipelineId`; the renderer derives kanban columns and the
 * main process derives container specs from the referenced pipeline.
 */
export interface Pipeline {
  /** Stable id (slug or UUID). */
  id: string;
  /** Human-readable name shown in the library and project dialog. */
  name: string;
  /** Optional longer description. */
  description?: string;
  /** Ordered list of stages; array order defines left-to-right column order. */
  stages: PipelineStage[];
  /** `bounceCount` threshold at which a task escalates to Blocked. Default 3. */
  bounceLimit: number;
  /** True for app-shipped templates — cloneable but not editable or deletable. */
  builtIn?: boolean;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;
}

/**
 * Columns that always exist on every pipeline's kanban board, regardless of
 * the stage list. These have no associated agent containers:
 * - `backlog` — user-created epics/tasks awaiting work (leftmost)
 * - `done` — completed tasks
 * - `blocked` — tasks that exceeded `Pipeline.bounceLimit`, awaiting human triage
 *
 * Declared `as const` so the array is typed as a readonly tuple and
 * `ImplicitColumn` narrows to the literal union.
 */
export const IMPLICIT_COLUMNS = ['backlog', 'done', 'blocked'] as const;

/** Union of the three implicit column ids. */
export type ImplicitColumn = (typeof IMPLICIT_COLUMNS)[number];

/**
 * Full left-to-right column order for a pipeline's kanban board:
 * `backlog`, each stage id in `pipeline.stages` order, then `done`, `blocked`.
 *
 * The renderer uses this to lay out columns; the transition helper uses it to
 * derive allowed moves. Keeping the implicit bookends here (rather than in
 * component code) ensures main and renderer agree on column identity.
 */
export function columnsFor(pipeline: Pipeline): string[] {
  return ['backlog', ...pipeline.stages.map((s) => s.id), 'done', 'blocked'];
}

/**
 * Actions that a supervisor container (or any agent) can write to
 * `/workspace/@supervisor-action.json`. The host watcher processes this file
 * when it detects `@supervisor-action.requested` and dispatches the action.
 *
 * Only `restart` is supported in Phase 8.1. Future actions (e.g.
 * `inject-context`) can be added without breaking existing handlers.
 */
export interface SupervisorAction {
  /** Action to perform. Currently only `"restart"` is supported. */
  action: 'restart';
  /**
   * Composite role key of the target container, e.g. `"pm-0"` or `"coder-1"`.
   * Must match a loop that was started in the current factory session.
   */
  targetRole: string;
  /** Human-readable reason logged on the host for debugging. */
  reason?: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}
