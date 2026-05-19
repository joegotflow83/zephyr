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
  const all = columnsFor(pipeline); // [backlog, ...stages, done, blocked, needs_input]

  // Debrief stages are excluded from the regular task flow. They are only
  // entered by epics via a direct column assignment inside moveTask (Phase 2.9)
  // and never by individual child tasks. Including them in the flow would make
  // deriveTransitions().forward['lastRegularStage'] point at the debrief stage
  // instead of 'done', causing child tasks to land there on every forward signal.
  const debriefIds = new Set(
    pipeline.stages.filter((s) => s.role === 'debrief').map((s) => s.id),
  );

  const flow = all.filter(
    (c) => c !== 'blocked' && c !== 'needs_input' && !debriefIds.has(c),
  ); // [backlog, ...non-debrief stages, done]

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
    moves.push('needs_input');

    allowed[col] = moves;
    forward[col] = next;
  }

  // Debrief stages sit outside the regular flow but still need a forward
  // entry so the debrief agent can advance the epic to 'done' when it signals
  // 'forward'. Each debrief stage maps directly to 'done'.
  for (const id of debriefIds) {
    forward[id] = 'done';
    // Debrief stages are not reachable by drag-and-drop for regular tasks,
    // but include them in allowed so the kanban can render their column.
    allowed[id] = ['done', 'blocked'];
  }

  // Human override: from Blocked, move the task to any flow column to resume.
  allowed['blocked'] = [...flow];
  forward['blocked'] = null;

  // Needs Input: same semantics — human parks a task here, can return it anywhere.
  allowed['needs_input'] = [...flow];
  forward['needs_input'] = null;

  return { allowed, forward };
}
