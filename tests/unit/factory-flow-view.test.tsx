/**
 * Tests for FactoryFlowView composite role key handling (Phase 2.14).
 *
 * Validates:
 * - Composite role keys (e.g. "coder-0") render correctly.
 * - Pipeline stage order is preserved (Map insertion order = spawn order).
 * - Single-instance stages show a clean label (no instance suffix).
 * - Multi-instance stages show numbered labels ("coder 1", "coder 2").
 * - Stage ids are used directly as labels.
 * - Old-style non-composite roles still work.
 * - stageIdFromRole and instanceIndexFromRole helpers cover edge cases.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  FactoryFlowView,
  stageIdFromRole,
  instanceIndexFromRole,
} from '../../src/renderer/pages/LoopsTab/FactoryFlowView';
import { createLoopState, LoopStatus, LoopMode } from '../../src/shared/loop-types';

/* ── Helper ──────────────────────────────────────────────────────────────── */

function makeLoop(projectId: string, role: string, status = LoopStatus.RUNNING) {
  return {
    ...createLoopState(projectId, LoopMode.SINGLE, 'test-project', role),
    status,
    iteration: 1,
    lastLogAt: Date.now(),
  };
}

/* ── stageIdFromRole ─────────────────────────────────────────────────────── */

describe('stageIdFromRole', () => {
  it('strips numeric suffix from composite key', () => {
    expect(stageIdFromRole('coder-0')).toBe('coder');
    expect(stageIdFromRole('coder-1')).toBe('coder');
    expect(stageIdFromRole('pm-0')).toBe('pm');
    expect(stageIdFromRole('qa-99')).toBe('qa');
  });

  it('is a no-op for non-composite role names', () => {
    expect(stageIdFromRole('pm')).toBe('pm');
    expect(stageIdFromRole('coder')).toBe('coder');
    expect(stageIdFromRole('security')).toBe('security');
  });

  it('handles stage names that contain hyphens', () => {
    expect(stageIdFromRole('pen-tester-0')).toBe('pen-tester');
    expect(stageIdFromRole('static-analyser-2')).toBe('static-analyser');
  });

  it('does not strip non-numeric trailing segments', () => {
    expect(stageIdFromRole('coder-alpha')).toBe('coder-alpha');
    expect(stageIdFromRole('reviewer-2stage')).toBe('reviewer-2stage');
  });
});

/* ── instanceIndexFromRole ───────────────────────────────────────────────── */

describe('instanceIndexFromRole', () => {
  it('parses the numeric instance index', () => {
    expect(instanceIndexFromRole('coder-0')).toBe(0);
    expect(instanceIndexFromRole('coder-1')).toBe(1);
    expect(instanceIndexFromRole('qa-99')).toBe(99);
  });

  it('returns null for non-composite roles', () => {
    expect(instanceIndexFromRole('pm')).toBeNull();
    expect(instanceIndexFromRole('coder')).toBeNull();
  });

  it('returns null for roles with non-numeric suffix', () => {
    expect(instanceIndexFromRole('coder-alpha')).toBeNull();
  });

  it('handles hyphenated stage names', () => {
    expect(instanceIndexFromRole('pen-tester-0')).toBe(0);
    expect(instanceIndexFromRole('pen-tester-2')).toBe(2);
  });
});

/* ── FactoryFlowView rendering ───────────────────────────────────────────── */

describe('FactoryFlowView', () => {
  const projectId = 'proj-abc';

  beforeEach(() => {
    // Freeze time so lastLogAt comparisons are deterministic
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('renders nothing when loops list is empty', () => {
    it('returns null', () => {
      const { container } = render(
        <FactoryFlowView loops={[]} selectedLoopKey={null} onSelectLoop={() => {}} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('single-instance composite role keys', () => {
    it('renders a node for each composite role in pipeline order', () => {
      const loops = [
        makeLoop(projectId, 'pm-0'),
        makeLoop(projectId, 'coder-0'),
        makeLoop(projectId, 'security-0'),
        makeLoop(projectId, 'qa-0'),
      ];

      render(
        <FactoryFlowView loops={loops} selectedLoopKey={null} onSelectLoop={() => {}} />
      );

      expect(screen.getByText('pm')).toBeInTheDocument();
      expect(screen.getByText('coder')).toBeInTheDocument();
      expect(screen.getByText('security')).toBeInTheDocument();
      expect(screen.getByText('qa')).toBeInTheDocument();
    });

    it('does not append instance number for single-instance stages', () => {
      const loops = [makeLoop(projectId, 'pm-0'), makeLoop(projectId, 'coder-0')];

      render(
        <FactoryFlowView loops={loops} selectedLoopKey={null} onSelectLoop={() => {}} />
      );

      expect(screen.getByText('pm')).toBeInTheDocument();
      expect(screen.getByText('coder')).toBeInTheDocument();
      // Must NOT have numbered variants
      expect(screen.queryByText('pm 1')).toBeNull();
      expect(screen.queryByText('coder 1')).toBeNull();
    });
  });

  describe('multi-instance stages', () => {
    it('renders one node per instance with numbered labels', () => {
      const loops = [
        makeLoop(projectId, 'pm-0'),
        makeLoop(projectId, 'coder-0'),
        makeLoop(projectId, 'coder-1'),
        makeLoop(projectId, 'qa-0'),
      ];

      render(
        <FactoryFlowView loops={loops} selectedLoopKey={null} onSelectLoop={() => {}} />
      );

      expect(screen.getByText('coder 1')).toBeInTheDocument();
      expect(screen.getByText('coder 2')).toBeInTheDocument();
      // Non-duplicated stages are unlabelled with numbers
      expect(screen.getByText('pm')).toBeInTheDocument();
      expect(screen.getByText('qa')).toBeInTheDocument();
    });

    it('preserves pipeline stage order with multiple instances interleaved', () => {
      const loops = [
        makeLoop(projectId, 'pm-0'),
        makeLoop(projectId, 'coder-0'),
        makeLoop(projectId, 'coder-1'),
        makeLoop(projectId, 'qa-0'),
      ];

      const { container } = render(
        <FactoryFlowView loops={loops} selectedLoopKey={null} onSelectLoop={() => {}} />
      );

      // Read all node labels in DOM order
      const buttons = container.querySelectorAll('button');
      const labels = Array.from(buttons).map(
        (btn) => btn.querySelector('span.text-xs.font-semibold')?.textContent
      );

      expect(labels).toEqual(['pm', 'coder 1', 'coder 2', 'qa']);
    });
  });

  describe('unknown / custom stage ids', () => {
    it('uses stageId directly as label for unknown stage ids', () => {
      const loops = [
        makeLoop(projectId, 'pen-tester-0'),
        makeLoop(projectId, 'remediation-coder-0'),
      ];

      render(
        <FactoryFlowView loops={loops} selectedLoopKey={null} onSelectLoop={() => {}} />
      );

      expect(screen.getByText('pen-tester')).toBeInTheDocument();
      expect(screen.getByText('remediation-coder')).toBeInTheDocument();
    });

    it('numbers custom multi-instance stages', () => {
      const loops = [
        makeLoop(projectId, 'pen-tester-0'),
        makeLoop(projectId, 'pen-tester-1'),
      ];

      render(
        <FactoryFlowView loops={loops} selectedLoopKey={null} onSelectLoop={() => {}} />
      );

      expect(screen.getByText('pen-tester 1')).toBeInTheDocument();
      expect(screen.getByText('pen-tester 2')).toBeInTheDocument();
    });
  });

  describe('old-style non-composite roles (backward compat)', () => {
    it('renders legacy roles without instance index', () => {
      const loops = [
        makeLoop(projectId, 'pm'),
        makeLoop(projectId, 'coder'),
        makeLoop(projectId, 'security'),
        makeLoop(projectId, 'qa'),
      ];

      render(
        <FactoryFlowView loops={loops} selectedLoopKey={null} onSelectLoop={() => {}} />
      );

      expect(screen.getByText('pm')).toBeInTheDocument();
      expect(screen.getByText('coder')).toBeInTheDocument();
      expect(screen.getByText('security')).toBeInTheDocument();
      expect(screen.getByText('qa')).toBeInTheDocument();
    });
  });

  describe('node selection', () => {
    it('calls onSelectLoop with the correct loop when a node is clicked', async () => {
      // Use real timers for click test to avoid userEvent / fake-timer conflicts
      vi.useRealTimers();
      const user = userEvent.setup();
      const onSelectLoop = vi.fn();
      const loops = [
        makeLoop(projectId, 'pm-0'),
        makeLoop(projectId, 'coder-0'),
      ];

      render(
        <FactoryFlowView loops={loops} selectedLoopKey={null} onSelectLoop={onSelectLoop} />
      );

      await user.click(screen.getByText('coder'));
      expect(onSelectLoop).toHaveBeenCalledWith(loops[1]);
    });

    it('highlights the selected node', () => {
      const loops = [makeLoop(projectId, 'pm-0'), makeLoop(projectId, 'coder-0')];
      const { getByText } = render(
        <FactoryFlowView
          loops={loops}
          selectedLoopKey={`${projectId}:coder-0`}
          onSelectLoop={() => {}}
        />
      );

      const coderButton = getByText('coder').closest('button')!;
      expect(coderButton.className).toContain('ring-blue-500');
    });
  });

  describe('arrow connectors', () => {
    it('renders N-1 arrows for N nodes', () => {
      const loops = [
        makeLoop(projectId, 'pm-0'),
        makeLoop(projectId, 'coder-0'),
        makeLoop(projectId, 'qa-0'),
      ];

      const { container } = render(
        <FactoryFlowView loops={loops} selectedLoopKey={null} onSelectLoop={() => {}} />
      );

      // Each arrow is a div with a horizontal line child
      const arrows = container.querySelectorAll('.w-6.h-px.bg-gray-500');
      expect(arrows).toHaveLength(2); // 3 nodes → 2 arrows
    });
  });
});
