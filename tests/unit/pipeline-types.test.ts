/**
 * Unit tests for `deriveTransitions` (Phase 1.14).
 *
 * Why these tests matter:
 * - `deriveTransitions` replaces the old hardcoded `ALLOWED_TRANSITIONS` /
 *   `FORWARD_TRANSITIONS` maps. The renderer's drag-and-drop validation
 *   (Phase 3.2) and the main-process `FactoryTaskStore.moveTask` bounce
 *   accounting (Phase 2.3) both call it, so a regression here silently
 *   breaks kanban moves on every pipeline.
 * - Pinning the contract shape (`{ allowed, forward }`) prevents future
 *   "helpful" refactors that rename keys or return a shape the consumers
 *   didn't expect.
 * - Blocked's human-override semantics (drop-from-anywhere, return-to-any)
 *   come from spec §Blocked State. Tests lock in that Blocked is both a
 *   universal sink and a universal source, distinct from regular flow.
 *
 * Strategy: pure function, pure data — no IO, no mocks. Each test constructs
 * a minimal `Pipeline` fixture and asserts the shape of the returned maps.
 */

import { describe, it, expect } from 'vitest';

import { deriveTransitions } from '../../src/lib/pipeline/transitions';
import type { Pipeline, PipelineStage } from '../../src/shared/pipeline-types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeStage(id: string): PipelineStage {
  return {
    id,
    name: id,
    agentPrompt: '',
    instances: 1,
  };
}

function makePipeline(stageIds: string[]): Pipeline {
  return {
    id: 'test-pipeline',
    name: 'Test Pipeline',
    stages: stageIds.map(makeStage),
    bounceLimit: 3,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

// ─── Forward transitions ─────────────────────────────────────────────────────

describe('deriveTransitions — forward', () => {
  it('chains backlog → stages → done for a classic pipeline', () => {
    const pipeline = makePipeline(['pm', 'coder', 'security', 'qa', 'docs']);
    const { forward } = deriveTransitions(pipeline);

    expect(forward['backlog']).toBe('pm');
    expect(forward['pm']).toBe('coder');
    expect(forward['coder']).toBe('security');
    expect(forward['security']).toBe('qa');
    expect(forward['qa']).toBe('docs');
    expect(forward['docs']).toBe('done');
  });

  it('marks done as terminal (forward = null)', () => {
    const pipeline = makePipeline(['coder', 'qa']);
    const { forward } = deriveTransitions(pipeline);

    expect(forward['done']).toBeNull();
  });

  it('marks blocked as terminal (forward = null)', () => {
    const pipeline = makePipeline(['coder', 'qa']);
    const { forward } = deriveTransitions(pipeline);

    expect(forward['blocked']).toBeNull();
  });

  it('collapses to backlog → done when pipeline has zero stages', () => {
    const pipeline = makePipeline([]);
    const { forward } = deriveTransitions(pipeline);

    expect(forward['backlog']).toBe('done');
    expect(forward['done']).toBeNull();
    expect(forward['blocked']).toBeNull();
  });

  it('threads through the sole stage for a single-stage pipeline', () => {
    const pipeline = makePipeline(['solo']);
    const { forward } = deriveTransitions(pipeline);

    expect(forward['backlog']).toBe('solo');
    expect(forward['solo']).toBe('done');
    expect(forward['done']).toBeNull();
  });
});

// ─── Allowed moves: backward adjacency ───────────────────────────────────────

describe('deriveTransitions — backward adjacency', () => {
  it('allows each middle stage to drop back to the previous stage', () => {
    const pipeline = makePipeline(['pm', 'coder', 'security', 'qa']);
    const { allowed } = deriveTransitions(pipeline);

    expect(allowed['coder']).toContain('pm');
    expect(allowed['security']).toContain('coder');
    expect(allowed['qa']).toContain('security');
  });

  it('allows the first stage to drop back to backlog', () => {
    const pipeline = makePipeline(['pm', 'coder']);
    const { allowed } = deriveTransitions(pipeline);

    expect(allowed['pm']).toContain('backlog');
  });

  it('allows done to drop back to the final stage (manual reopen)', () => {
    const pipeline = makePipeline(['coder', 'qa']);
    const { allowed } = deriveTransitions(pipeline);

    expect(allowed['done']).toContain('qa');
  });

  it('does not allow backlog to move backward (no prev exists)', () => {
    const pipeline = makePipeline(['coder', 'qa']);
    const { allowed } = deriveTransitions(pipeline);

    // backlog's only non-blocked move is forward to the first stage.
    expect(allowed['backlog']).toEqual(['coder', 'blocked']);
  });

  it('does not allow skipping stages (non-adjacent forward)', () => {
    const pipeline = makePipeline(['pm', 'coder', 'security', 'qa']);
    const { allowed } = deriveTransitions(pipeline);

    // From `pm` the only forward neighbour is `coder` — `security`/`qa`/`done`
    // must not appear, or the renderer would permit stage-skipping drops.
    expect(allowed['pm']).not.toContain('security');
    expect(allowed['pm']).not.toContain('qa');
    expect(allowed['pm']).not.toContain('done');
  });
});

// ─── Allowed moves: Blocked semantics ────────────────────────────────────────

describe('deriveTransitions — Blocked drop from anywhere', () => {
  it('includes blocked as an allowed target for every flow column', () => {
    const pipeline = makePipeline(['pm', 'coder', 'security', 'qa', 'docs']);
    const { allowed } = deriveTransitions(pipeline);

    for (const col of ['backlog', 'pm', 'coder', 'security', 'qa', 'docs', 'done']) {
      expect(allowed[col]).toContain('blocked');
    }
  });

  it('allows blocked to drop back to any flow column (human triage)', () => {
    const pipeline = makePipeline(['pm', 'coder', 'qa']);
    const { allowed } = deriveTransitions(pipeline);

    expect(allowed['blocked']).toEqual(['backlog', 'pm', 'coder', 'qa', 'done']);
  });

  it('does not list blocked as a target of itself (no self-loop)', () => {
    const pipeline = makePipeline(['coder']);
    const { allowed } = deriveTransitions(pipeline);

    expect(allowed['blocked']).not.toContain('blocked');
  });

  it('preserves blocked-drop on a zero-stage pipeline', () => {
    const pipeline = makePipeline([]);
    const { allowed } = deriveTransitions(pipeline);

    expect(allowed['backlog']).toContain('blocked');
    expect(allowed['done']).toContain('blocked');
    expect(allowed['blocked']).toEqual(['backlog', 'done']);
  });
});

// ─── Shape contract ──────────────────────────────────────────────────────────

describe('deriveTransitions — shape contract', () => {
  it('returns an allowed/forward entry for every column', () => {
    const pipeline = makePipeline(['pm', 'coder', 'qa']);
    const { allowed, forward } = deriveTransitions(pipeline);

    const expectedKeys = ['backlog', 'pm', 'coder', 'qa', 'done', 'blocked'];
    expect(Object.keys(allowed).sort()).toEqual([...expectedKeys].sort());
    expect(Object.keys(forward).sort()).toEqual([...expectedKeys].sort());
  });

  it('composes allowed[col] as [next?, prev?, blocked] in that order for flow columns', () => {
    // Ordering matters: consumers that want the "primary forward move" to show
    // up first in context menus rely on next-before-prev. Blocked is last so
    // it reads as a fallback, not the default.
    const pipeline = makePipeline(['pm', 'coder', 'qa']);
    const { allowed } = deriveTransitions(pipeline);

    expect(allowed['backlog']).toEqual(['pm', 'blocked']); // no prev
    expect(allowed['pm']).toEqual(['coder', 'backlog', 'blocked']);
    expect(allowed['coder']).toEqual(['qa', 'pm', 'blocked']);
    expect(allowed['qa']).toEqual(['done', 'coder', 'blocked']);
    expect(allowed['done']).toEqual(['qa', 'blocked']); // no next
  });

  it('handles arbitrary user-chosen stage ids without case-mangling', () => {
    // Stage ids are free-form slugs (spec §StageId); the helper must not
    // normalise them.
    const pipeline = makePipeline(['Rust-Specialist', 'pen_tester']);
    const { allowed, forward } = deriveTransitions(pipeline);

    expect(forward['backlog']).toBe('Rust-Specialist');
    expect(forward['Rust-Specialist']).toBe('pen_tester');
    expect(forward['pen_tester']).toBe('done');
    expect(allowed['Rust-Specialist']).toContain('pen_tester');
    expect(allowed['pen_tester']).toContain('Rust-Specialist');
  });
});
