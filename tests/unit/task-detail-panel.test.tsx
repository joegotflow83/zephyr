/**
 * TaskDetailPanel tests — Phase 3.7
 *
 * Validates:
 * - Pipeline stage name used in the stage badge header (not hardcoded labels).
 * - Stage icon displayed in badge when set.
 * - Stage color applied as inline style on badge.
 * - Falls back to raw column id when pipeline is null and column is not a known implicit column.
 * - Parent breadcrumb shown when parentTaskId is set.
 * - Parent task title used when parent found in tasks list.
 * - Parent task id used as fallback when parent not found.
 * - No breadcrumb section when parentTaskId is absent.
 * - Sub-task list shown for epic tasks (isEpic: true).
 * - Progress counter (X/Y done) displayed in sub-task section label.
 * - "No sub-tasks yet" placeholder for epic with no children.
 * - Lock owner (🔒 + container name) shown in header when lockedBy is set.
 * - Bounce count pill shown when bounceCount > 0.
 * - No lock indicator when task.lockedBy is falsy.
 * - No bounce pill when bounceCount is 0 or absent.
 * - Move-forward button label uses pipeline stage name.
 * - Move-backward button label uses pipeline stage name.
 * - Move-forward button uses raw column id when pipeline is null.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TaskDetailPanel } from '../../src/renderer/pages/FactoryTab/TaskDetailPanel';
import type { Pipeline } from '../../src/shared/pipeline-types';
import type { FactoryTask } from '../../src/shared/factory-types';

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'pipe-1',
    name: 'Test Pipeline',
    stages: [
      {
        id: 'coder',
        name: 'Coder',
        agentPrompt: 'write code',
        instances: 1,
        color: '#3b82f6',
        icon: '💻',
      },
      {
        id: 'qa',
        name: 'Quality Assurance',
        agentPrompt: 'review code',
        instances: 1,
        // no color or icon
      },
    ],
    bounceLimit: 3,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTask(overrides: Partial<FactoryTask> = {}): FactoryTask {
  return {
    id: 'task-1',
    title: 'Fix the widget',
    description: 'A description',
    column: 'coder',
    projectId: 'proj-1',
    bounceCount: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const noop = vi.fn().mockResolvedValue(undefined);

function renderPanel(
  task: FactoryTask,
  pipeline: Pipeline | null | undefined = null,
  tasks: FactoryTask[] = []
) {
  return render(
    <TaskDetailPanel
      task={task}
      pipeline={pipeline}
      tasks={tasks}
      onClose={noop}
      onMove={noop}
      onUpdate={noop}
      onRemove={noop}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ── Stage badge label ────────────────────────────────────────────────────── */

describe('TaskDetailPanel — stage badge', () => {
  it('shows pipeline stage name in badge for a known stage id', () => {
    renderPanel(makeTask({ column: 'coder' }), makePipeline());
    // The badge in the header should show the stage name
    expect(screen.getByText('Coder')).toBeInTheDocument();
  });

  it('falls back to raw column id when pipeline is null and column is not implicit', () => {
    renderPanel(makeTask({ column: 'inprogress' }), null);
    expect(screen.getByText('inprogress')).toBeInTheDocument();
  });

  it('falls back to raw column id when pipeline is null and no label entry', () => {
    renderPanel(makeTask({ column: 'custom-stage' }), null);
    expect(screen.getByText('custom-stage')).toBeInTheDocument();
  });

  it('shows stage icon in badge when stage has an icon', () => {
    renderPanel(makeTask({ column: 'coder' }), makePipeline());
    expect(screen.getByText('💻')).toBeInTheDocument();
  });

  it('does not render icon span when stage has no icon', () => {
    renderPanel(makeTask({ column: 'qa' }), makePipeline());
    // The badge for 'qa' stage should not have an icon span
    const badge = screen.getByText('Quality Assurance').closest('span');
    const iconSpans = badge?.querySelectorAll('span[aria-hidden="true"]') ?? [];
    expect(iconSpans).toHaveLength(0);
  });

  it('applies stage color as inline background style on badge', () => {
    renderPanel(makeTask({ column: 'coder' }), makePipeline());
    const badge = screen.getByText('Coder').closest('span');
    expect(badge).toHaveStyle({ color: '#3b82f6' });
  });
});

/* ── Parent breadcrumb ────────────────────────────────────────────────────── */

describe('TaskDetailPanel — parent breadcrumb', () => {
  it('shows Epic section with parent title when parent found in tasks list', () => {
    const parent = makeTask({ id: 'parent-1', title: 'Auth Refactor', column: 'backlog', isEpic: true });
    const child = makeTask({ id: 'child-1', parentTaskId: 'parent-1' });
    renderPanel(child, null, [parent, child]);
    // The "Epic" section label must be present
    expect(screen.getByText('Epic')).toBeInTheDocument();
    expect(screen.getByLabelText('parent task')).toHaveTextContent('📌 Auth Refactor');
  });

  it('shows parent id as fallback when parent task not found in tasks list', () => {
    const child = makeTask({ id: 'child-1', parentTaskId: 'unknown-parent' });
    renderPanel(child, null, [child]);
    expect(screen.getByLabelText('parent task')).toHaveTextContent('📌 unknown-parent');
  });

  it('does not render Epic section when parentTaskId is absent', () => {
    renderPanel(makeTask({ id: 'task-1', parentTaskId: undefined }), null, []);
    expect(screen.queryByLabelText('parent task')).not.toBeInTheDocument();
  });
});

/* ── Sub-task list ────────────────────────────────────────────────────────── */

describe('TaskDetailPanel — sub-task list', () => {
  it('shows sub-task list for epic tasks', () => {
    const epic = makeTask({ id: 'epic-1', isEpic: true });
    const sub1 = makeTask({ id: 'sub-1', title: 'Sub A', column: 'coder', parentTaskId: 'epic-1' });
    const sub2 = makeTask({ id: 'sub-2', title: 'Sub B', column: 'done', parentTaskId: 'epic-1' });
    renderPanel(epic, null, [epic, sub1, sub2]);
    const subList = screen.getByRole('list', { name: /sub-tasks/i });
    expect(subList).toBeInTheDocument();
    expect(screen.getByText('Sub A')).toBeInTheDocument();
    expect(screen.getByText('Sub B')).toBeInTheDocument();
  });

  it('shows "No sub-tasks yet" placeholder for epic with no children', () => {
    const epic = makeTask({ id: 'epic-1', isEpic: true });
    renderPanel(epic, null, [epic]);
    expect(screen.getByText(/no sub-tasks yet/i)).toBeInTheDocument();
  });

  it('shows X/Y done progress count in sub-task section label', () => {
    const epic = makeTask({ id: 'epic-1', isEpic: true });
    const sub1 = makeTask({ id: 'sub-1', title: 'Sub A', column: 'coder', parentTaskId: 'epic-1' });
    const sub2 = makeTask({ id: 'sub-2', title: 'Sub B', column: 'done', parentTaskId: 'epic-1' });
    renderPanel(epic, null, [epic, sub1, sub2]);
    // Label should contain "1/2 done"
    expect(screen.getByText(/1\/2 done/i)).toBeInTheDocument();
  });

  it('does not render sub-task list for non-epic tasks', () => {
    renderPanel(makeTask({ isEpic: false }), null, []);
    expect(screen.queryByRole('list', { name: /sub-tasks/i })).not.toBeInTheDocument();
  });

  it('shows pipeline stage label for sub-task column', () => {
    const pipeline = makePipeline();
    // Epic is in backlog; sub-task is in coder — "Coder" only appears in sub-task row
    const epic = makeTask({ id: 'epic-1', isEpic: true, column: 'backlog' });
    const sub = makeTask({ id: 'sub-1', title: 'Sub A', column: 'coder', parentTaskId: 'epic-1' });
    renderPanel(epic, pipeline, [epic, sub]);
    expect(screen.getByText('Coder')).toBeInTheDocument();
  });
});

/* ── Lock owner indicator ─────────────────────────────────────────────────── */

describe('TaskDetailPanel — lock indicator', () => {
  it('shows lock icon and container name when lockedBy is set', () => {
    renderPanel(makeTask({ lockedBy: 'zephyr-myproject-coder-0' }), null);
    const lockEl = screen.getByLabelText('locked');
    expect(lockEl).toBeInTheDocument();
    expect(lockEl).toHaveTextContent('🔒');
    expect(lockEl).toHaveTextContent('zephyr-myproject-coder-0');
  });

  it('does not show lock indicator when lockedBy is absent', () => {
    renderPanel(makeTask({ lockedBy: undefined }), null);
    expect(screen.queryByLabelText('locked')).not.toBeInTheDocument();
  });
});

/* ── Bounce count pill ────────────────────────────────────────────────────── */

describe('TaskDetailPanel — bounce count', () => {
  it('shows bounce pill when bounceCount > 0', () => {
    renderPanel(makeTask({ bounceCount: 3 }), null);
    const pill = screen.getByLabelText(/bounce count 3/i);
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent('↩ 3');
  });

  it('does not show bounce pill when bounceCount is 0', () => {
    renderPanel(makeTask({ bounceCount: 0 }), null);
    expect(screen.queryByLabelText(/bounce count/i)).not.toBeInTheDocument();
  });

  it('does not show bounce pill when bounceCount is undefined', () => {
    renderPanel(makeTask({ bounceCount: undefined }), null);
    expect(screen.queryByLabelText(/bounce count/i)).not.toBeInTheDocument();
  });
});

/* ── Move button labels ───────────────────────────────────────────────────── */

describe('TaskDetailPanel — move button labels', () => {
  it('forward button uses pipeline stage name for target', () => {
    // coder -> qa in the pipeline (qa = "Quality Assurance")
    renderPanel(makeTask({ column: 'coder' }), makePipeline());
    expect(
      screen.getByRole('button', { name: /move to quality assurance/i })
    ).toBeInTheDocument();
  });

  it('backward button uses pipeline stage name for source', () => {
    // qa -> coder backward (coder = "Coder")
    renderPanel(makeTask({ column: 'qa' }), makePipeline());
    expect(
      screen.getByRole('button', { name: /send back to coder/i })
    ).toBeInTheDocument();
  });

  it('forward button is disabled when pipeline is null', () => {
    // no pipeline → no transitions → forward button shows terminal message
    renderPanel(makeTask({ column: 'backlog' }), null);
    const btn = screen.getByRole('button', { name: /done — no further stages/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it('forward button shows terminal message when task is in done column', () => {
    renderPanel(makeTask({ column: 'done' }), makePipeline());
    expect(
      screen.getByRole('button', { name: /done — no further stages/i })
    ).toBeInTheDocument();
  });
});
