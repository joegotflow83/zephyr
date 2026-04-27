/**
 * Sanity + snapshot tests for `pipeline-builtins.ts` (Phase 6.5).
 *
 * Why these tests matter:
 * - The built-in pipelines are shipped data that agents read at runtime.
 *   An accidental truncation, stub left in, or PROTOCOL_PREAMBLE dropped
 *   causes silent agent misbehaviour that is very hard to debug.
 * - Snapshots pin the full prompt text so any unintentional edit fails CI
 *   immediately and requires a deliberate snapshot update, not an accidental
 *   silent regression.
 * - The sanity assertions (no stubs, PROTOCOL_PREAMBLE present, PM-exclusive
 *   escalation) catch the structural class of bugs before touching snapshots.
 *
 * Strategy: pure data — no IO, no mocks. Imports the module directly and
 * drives assertions off the frozen exports.
 */

import { describe, it, expect } from 'vitest';

import {
  BUILTIN_PIPELINES,
  BUILTIN_PIPELINE_IDS,
  BUILTIN_TIMESTAMP,
  DEFAULT_MIGRATION_PIPELINE_ID,
  STUB_PROMPT_PREFIX,
  PIPELINE_BUILDER_STARTER_PROMPTS,
  STARTER_PROMPT_PM,
  STARTER_PROMPT_GENERIC_STAGE,
  STARTER_PROMPT_SECURITY_REVIEWER,
  STARTER_PROMPT_TECHNICAL_WRITER,
} from '../../src/shared/pipeline-builtins';

// ─── Structural invariants ────────────────────────────────────────────────────

describe('BUILTIN_PIPELINES — structural invariants', () => {
  it('exports exactly 4 built-in pipelines in canonical order', () => {
    expect(BUILTIN_PIPELINES.map((p) => p.id)).toEqual([
      'classic-factory',
      'rapid-prototype',
      'security-sprint',
      'documentation-pass',
    ]);
  });

  it('BUILTIN_PIPELINE_IDS mirrors BUILTIN_PIPELINES order', () => {
    expect([...BUILTIN_PIPELINE_IDS]).toEqual(BUILTIN_PIPELINES.map((p) => p.id));
  });

  it('all built-ins carry builtIn: true', () => {
    for (const p of BUILTIN_PIPELINES) {
      expect(p.builtIn, `${p.id}.builtIn`).toBe(true);
    }
  });

  it('all built-ins use BUILTIN_TIMESTAMP for createdAt and updatedAt', () => {
    for (const p of BUILTIN_PIPELINES) {
      expect(p.createdAt, `${p.id}.createdAt`).toBe(BUILTIN_TIMESTAMP);
      expect(p.updatedAt, `${p.id}.updatedAt`).toBe(BUILTIN_TIMESTAMP);
    }
  });

  it('DEFAULT_MIGRATION_PIPELINE_ID is a member of BUILTIN_PIPELINE_IDS', () => {
    expect(BUILTIN_PIPELINE_IDS).toContain(DEFAULT_MIGRATION_PIPELINE_ID);
  });

  it('every pipeline has a non-empty name and description', () => {
    for (const p of BUILTIN_PIPELINES) {
      expect(p.name.length, `${p.id}.name`).toBeGreaterThan(0);
      expect(p.description.length, `${p.id}.description`).toBeGreaterThan(0);
    }
  });

  it('every stage id within a pipeline is unique', () => {
    for (const p of BUILTIN_PIPELINES) {
      const ids = p.stages.map((s) => s.id);
      expect(new Set(ids).size, `${p.id} stage ids`).toBe(ids.length);
    }
  });
});

// ─── Per-pipeline stage counts and ids ───────────────────────────────────────

describe('BUILTIN_PIPELINES — stage layout', () => {
  it('classic-factory has 5 stages in the canonical order', () => {
    const p = BUILTIN_PIPELINES.find((p) => p.id === 'classic-factory')!;
    expect(p.stages.map((s) => s.id)).toEqual(['pm', 'coder', 'security', 'qa', 'docs']);
  });

  it('rapid-prototype has 2 stages', () => {
    const p = BUILTIN_PIPELINES.find((p) => p.id === 'rapid-prototype')!;
    expect(p.stages.map((s) => s.id)).toEqual(['coder', 'qa']);
  });

  it('security-sprint has 4 stages', () => {
    const p = BUILTIN_PIPELINES.find((p) => p.id === 'security-sprint')!;
    expect(p.stages.map((s) => s.id)).toEqual([
      'static-analyser',
      'pen-tester',
      'remediation-coder',
      'qa',
    ]);
  });

  it('documentation-pass has 3 stages', () => {
    const p = BUILTIN_PIPELINES.find((p) => p.id === 'documentation-pass')!;
    expect(p.stages.map((s) => s.id)).toEqual(['code-analyser', 'technical-writer', 'reviewer']);
  });

  it('every stage has instances ≥ 1', () => {
    for (const p of BUILTIN_PIPELINES) {
      for (const s of p.stages) {
        expect(s.instances, `${p.id}/${s.id}.instances`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('every stage has a non-empty icon and color', () => {
    for (const p of BUILTIN_PIPELINES) {
      for (const s of p.stages) {
        expect((s.icon ?? '').length, `${p.id}/${s.id}.icon`).toBeGreaterThan(0);
        expect((s.color ?? '').length, `${p.id}/${s.id}.color`).toBeGreaterThan(0);
      }
    }
  });
});

// ─── agentPrompt sanity checks ───────────────────────────────────────────────

describe('BUILTIN_PIPELINES — agentPrompt sanity', () => {
  it('no production prompt contains the stub prefix sentinel', () => {
    for (const p of BUILTIN_PIPELINES) {
      for (const s of p.stages) {
        expect(s.agentPrompt, `${p.id}/${s.id}`).not.toContain(STUB_PROMPT_PREFIX);
      }
    }
  });

  it('every agentPrompt is at least 200 characters (not a one-liner stub)', () => {
    for (const p of BUILTIN_PIPELINES) {
      for (const s of p.stages) {
        expect(s.agentPrompt.length, `${p.id}/${s.id} prompt length`).toBeGreaterThan(200);
      }
    }
  });

  it('every agentPrompt embeds PROTOCOL_PREAMBLE signal-file header', () => {
    for (const p of BUILTIN_PIPELINES) {
      for (const s of p.stages) {
        expect(s.agentPrompt, `${p.id}/${s.id} SIGNAL FILES`).toContain('SIGNAL FILES');
        expect(s.agentPrompt, `${p.id}/${s.id} @task-status.json`).toContain('@task-status.json');
      }
    }
  });

  it('every agentPrompt embeds PROTOCOL_PREAMBLE lock protocol', () => {
    for (const p of BUILTIN_PIPELINES) {
      for (const s of p.stages) {
        expect(s.agentPrompt, `${p.id}/${s.id} LOCK PROTOCOL`).toContain('LOCK PROTOCOL');
        expect(s.agentPrompt, `${p.id}/${s.id} INSTANCE_INDEX`).toContain('INSTANCE_INDEX');
      }
    }
  });

  it('every agentPrompt embeds PROTOCOL_PREAMBLE routing signal section', () => {
    for (const p of BUILTIN_PIPELINES) {
      for (const s of p.stages) {
        expect(s.agentPrompt, `${p.id}/${s.id} ROUTING SIGNAL`).toContain('ROUTING SIGNAL');
      }
    }
  });

  it('only PM-stage agentPrompts write @human_clarification.md directly', () => {
    for (const p of BUILTIN_PIPELINES) {
      for (const s of p.stages) {
        if (s.id === 'pm') {
          expect(s.agentPrompt, `${p.id}/pm must escalate`).toContain('@human_clarification.md');
        } else {
          // Non-PM stages reference the file in PROTOCOL_PREAMBLE's QUESTIONS
          // section only as a "do not write" instruction, not as a write target.
          // Verify they do not contain a direct write instruction.
          expect(s.agentPrompt, `${p.id}/${s.id} must not write escalation directly`).not.toContain(
            'Write /workspace/@human_clarification.md',
          );
        }
      }
    }
  });

  it('PM-stage agentPrompt includes epic decomposition schema', () => {
    const classicPM = BUILTIN_PIPELINES.find((p) => p.id === 'classic-factory')!.stages.find(
      (s) => s.id === 'pm',
    )!;
    expect(classicPM.agentPrompt).toContain('@task-decomposition.json');
    expect(classicPM.agentPrompt).toContain('"action": "decompose"');
    expect(classicPM.agentPrompt).toContain('"parentTaskId"');
  });

  it('ROUTING SIGNAL uses workspace-root @task-status.json path (not tasks/pending/)', () => {
    for (const p of BUILTIN_PIPELINES) {
      for (const s of p.stages) {
        expect(s.agentPrompt, `${p.id}/${s.id} wrong signal path`).not.toContain(
          '/workspace/tasks/pending/@task-status.json',
        );
        expect(s.agentPrompt, `${p.id}/${s.id} signal path`).toContain(
          '/workspace/@task-status.json',
        );
      }
    }
  });

  it('forward ROUTING SIGNAL does not include toStage (host derives next stage)', () => {
    // toStage in a forward signal is redundant — the host derives the next
    // stage from the pipeline definition. Including it in the example could
    // mislead agents into thinking they control routing for forward moves.
    for (const p of BUILTIN_PIPELINES) {
      for (const s of p.stages) {
        // The ROUTING SIGNAL section shows the forward example; it must not
        // include toStage there. (rejected examples elsewhere legitimately do.)
        const routingBlock = s.agentPrompt.match(/ROUTING SIGNAL[\s\S]*?(?=\n[A-Z]|\n\n[A-Z]|$)/)?.[0] ?? '';
        expect(routingBlock, `${p.id}/${s.id} forward signal should omit toStage`).not.toMatch(
          /"toStage".*"forward"/,
        );
      }
    }
  });
});

// ─── Full agentPrompt snapshots ───────────────────────────────────────────────
//
// These snapshots pin the exact prompt text. If a prompt changes, the snapshot
// diff is the review surface — reviewers can judge whether the change was
// intentional before approving `vitest --update-snapshots`.

describe('BUILTIN_PIPELINES — agentPrompt snapshots', () => {
  for (const pipeline of BUILTIN_PIPELINES) {
    for (const s of pipeline.stages) {
      it(`${pipeline.id}/${s.id}`, () => {
        expect(s.agentPrompt).toMatchSnapshot();
      });
    }
  }
});

// ─── PIPELINE_BUILDER_STARTER_PROMPTS structure ───────────────────────────────

describe('PIPELINE_BUILDER_STARTER_PROMPTS', () => {
  it('has exactly 4 entries', () => {
    expect(PIPELINE_BUILDER_STARTER_PROMPTS).toHaveLength(4);
  });

  it('exposes labels in display order', () => {
    expect(PIPELINE_BUILDER_STARTER_PROMPTS.map((p) => p.label)).toEqual([
      'PM (Product Manager)',
      'Generic Stage',
      'Security Reviewer',
      'Technical Writer',
    ]);
  });

  it('individual starter exports match the array entries', () => {
    expect(PIPELINE_BUILDER_STARTER_PROMPTS[0].prompt).toBe(STARTER_PROMPT_PM);
    expect(PIPELINE_BUILDER_STARTER_PROMPTS[1].prompt).toBe(STARTER_PROMPT_GENERIC_STAGE);
    expect(PIPELINE_BUILDER_STARTER_PROMPTS[2].prompt).toBe(STARTER_PROMPT_SECURITY_REVIEWER);
    expect(PIPELINE_BUILDER_STARTER_PROMPTS[3].prompt).toBe(STARTER_PROMPT_TECHNICAL_WRITER);
  });

  it('no starter prompt contains the stub prefix sentinel', () => {
    for (const { label, prompt } of PIPELINE_BUILDER_STARTER_PROMPTS) {
      expect(prompt, label).not.toContain(STUB_PROMPT_PREFIX);
    }
  });

  it('every starter prompt embeds PROTOCOL_PREAMBLE key phrases', () => {
    for (const { label, prompt } of PIPELINE_BUILDER_STARTER_PROMPTS) {
      expect(prompt, `${label} LOCK PROTOCOL`).toContain('LOCK PROTOCOL');
      expect(prompt, `${label} @task-status.json`).toContain('@task-status.json');
      expect(prompt, `${label} INSTANCE_INDEX`).toContain('INSTANCE_INDEX');
    }
  });

  it('PM starter includes decomposition and human-escalation sections', () => {
    expect(STARTER_PROMPT_PM).toContain('@task-decomposition.json');
    expect(STARTER_PROMPT_PM).toContain('"action": "decompose"');
    expect(STARTER_PROMPT_PM).toContain('@human_clarification.md');
    expect(STARTER_PROMPT_PM).toContain('HUMAN ESCALATION');
  });

  it('generic-stage starter contains <angle-bracket> user-customisation placeholders', () => {
    expect(STARTER_PROMPT_GENERIC_STAGE).toContain('<YourPipeline>');
    expect(STARTER_PROMPT_GENERIC_STAGE).toContain('<your_stage_id>');
    expect(STARTER_PROMPT_GENERIC_STAGE).toContain('<next_stage>');
    expect(STARTER_PROMPT_GENERIC_STAGE).toContain('<prev_stage>');
  });

  it('security-reviewer starter covers the required audit categories', () => {
    expect(STARTER_PROMPT_SECURITY_REVIEWER).toContain('Injection');
    expect(STARTER_PROMPT_SECURITY_REVIEWER).toContain('Authentication');
    expect(STARTER_PROMPT_SECURITY_REVIEWER).toContain('Hardcoded secrets');
  });

  it('technical-writer starter covers README, JSDoc, and changelog', () => {
    expect(STARTER_PROMPT_TECHNICAL_WRITER).toContain('README');
    expect(STARTER_PROMPT_TECHNICAL_WRITER).toContain('JSDoc');
    expect(STARTER_PROMPT_TECHNICAL_WRITER).toContain('changelog');
  });
});

// ─── Starter prompt snapshots ─────────────────────────────────────────────────

describe('PIPELINE_BUILDER_STARTER_PROMPTS — snapshots', () => {
  for (const { label, prompt } of PIPELINE_BUILDER_STARTER_PROMPTS) {
    it(label, () => {
      expect(prompt).toMatchSnapshot();
    });
  }
});
