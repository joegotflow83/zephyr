/**
 * Derive kanban transition rules from a pipeline definition.
 *
 * Replaces the hardcoded `ALLOWED_TRANSITIONS` / `FORWARD_TRANSITIONS` maps in
 * `src/shared/factory-types.ts` with a data-driven equivalent computed from
 * `Pipeline.stages` order. Used by both the renderer (drag-and-drop validation)
 * and the main process (`FactoryTaskStore.moveTask` bounce accounting).
 *
 * Lives under `src/lib/` because it's a pure helper reused on both sides of
 * the IPC boundary — no process-specific imports.
 */
import type { Pipeline } from '../../shared/pipeline-types';
import { columnsFor } from '../../shared/pipeline-types';

/**
 * Transition rules derived from a pipeline's stage order.
 *
 * `allowed[col]` — columns a task currently in `col` may be dragged to
 *   (manual kanban moves). Includes forward and backward adjacency plus
 *   `"blocked"` as an always-available human override.
 * `forward[col]` — the single next column in pipeline flow, or `null` when
 *   `col` is terminal (`done`, `blocked`). Used by agent auto-advance and
 *   "Move to next stage" UI actions.
 */
export interface DerivedTransitions {
  allowed: Record<string, string[]>;
  forward: Record<string, string | null>;
}

/**
 * Compute allowed and forward transitions for a pipeline.
 *
 * For stages `[s1, s2, …, sN]` the flow columns are
 * `[backlog, s1, s2, …, sN, done]` (Blocked is separate). Each flow column
 * can move to its neighbours on either side; every column — flow or Blocked —
 * can additionally be dragged into `blocked`. From `blocked`, the human may
 * return the task to any flow column (spec §Blocked State).
 *
 * Terminal columns have `forward` set to `null`:
 * - `done` — end of pipeline, no natural next step
 * - `blocked` — awaits manual triage; forward movement is a human decision
 */
export function deriveTransitions(pipeline: Pipeline): DerivedTransitions {
  const all = columnsFor(pipeline); // [backlog, ...stages, done, blocked]
  const flow = all.filter((c) => c !== 'blocked'); // [backlog, ...stages, done]

  const allowed: Record<string, string[]> = {};
  const forward: Record<string, string | null> = {};

  for (let i = 0; i < flow.length; i++) {
    const col = flow[i];
    const next = i + 1 < flow.length ? flow[i + 1] : null;
    const prev = i > 0 ? flow[i - 1] : null;

    const moves: string[] = [];
    if (next) moves.push(next);
    if (prev) moves.push(prev);
    moves.push('blocked');

    allowed[col] = moves;
    forward[col] = next;
  }

  // Human override: from Blocked, move the task to any flow column to resume.
  allowed['blocked'] = [...flow];
  forward['blocked'] = null;

  return { allowed, forward };
}
