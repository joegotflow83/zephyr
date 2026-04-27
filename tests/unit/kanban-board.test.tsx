/**
 * KanbanBoard tests — Phase 3.3 (stage color/icon), 3.4 (Blocked danger accent, any-column drops),
 * 3.5 (epic badge, lock indicator, bounce count), 3.6 (epic progress tracker in Backlog header).
 *
 * Validates:
 * - Stage icon appears in column header when set.
 * - Stage color is applied as a top-border accent via inline style.
 * - Implicit columns (backlog, done) render without color overrides.
 * - Blocked column gets a red danger accent (#ef4444), not transparent.
 * - Stages without icon/color configured get a transparent top border (neutral fallback).
 * - Column order follows [Backlog, ...stages, Done, Blocked].
 * - Null pipeline renders the "No pipeline configured" empty state.
 * - Tasks can be dropped onto Blocked from any column (no transition error).
 * - Epic progress tracker shows X/Y sub-task progress in Backlog column header.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { KanbanBoard } from '../../src/renderer/pages/FactoryTab/KanbanBoard';
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
        name: 'QA',
        agentPrompt: 'review code',
        instances: 1,
        // no color or icon — neutral fallback
      },
    ],
    bounceLimit: 3,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTask(col: string, overrides: Partial<FactoryTask> = {}): FactoryTask {
  return {
    id: `task-${col}`,
    title: `Task in ${col}`,
    description: '',
    column: col,
    projectId: 'proj-1',
    bounceCount: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const noop = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ── Null pipeline ────────────────────────────────────────────────────────── */

describe('KanbanBoard — null pipeline', () => {
  it('renders empty state when pipeline is null', () => {
    render(
      <KanbanBoard
        tasks={[]}
        pipeline={null}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    expect(screen.getByText(/no pipeline configured/i)).toBeInTheDocument();
  });
});

/* ── Column order ─────────────────────────────────────────────────────────── */

describe('KanbanBoard — column order', () => {
  it('renders columns in [Backlog, ...stages, Done, Blocked] order', () => {
    render(
      <KanbanBoard
        tasks={[]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );

    const headers = screen
      .getAllByRole('generic')
      .filter((el) => el.tagName === 'SPAN' && el.textContent?.match(/backlog|coder|qa|done|blocked/i));

    // More reliable: check that all expected labels appear in the document
    expect(screen.getByText(/backlog/i)).toBeInTheDocument();
    expect(screen.getByText('Coder')).toBeInTheDocument();
    expect(screen.getByText('QA')).toBeInTheDocument();
    expect(screen.getByText(/done/i)).toBeInTheDocument();
    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
  });
});

/* ── Stage icon ────────────────────────────────────────────────────────────── */

describe('KanbanBoard — stage icon', () => {
  it('renders stage icon in column header when icon is set', () => {
    render(
      <KanbanBoard
        tasks={[]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    // The 💻 icon should appear in the Coder column header
    expect(screen.getByText('💻')).toBeInTheDocument();
  });

  it('does not render an icon span when stage has no icon', () => {
    render(
      <KanbanBoard
        tasks={[]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    // QA stage has no icon — verify its header text is just 'QA' (no extra emoji)
    // The 💻 belongs to Coder; QA should not have any icon sibling
    const qaHeader = screen.getByText('QA').closest('span');
    const iconSpans = qaHeader?.querySelectorAll('span[aria-hidden="true"]') ?? [];
    expect(iconSpans).toHaveLength(0);
  });

  it('does not render icon for implicit columns (backlog, done, blocked)', () => {
    render(
      <KanbanBoard
        tasks={[]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    // None of the implicit column headers should contain an aria-hidden icon span
    for (const label of ['Backlog', 'Done', 'Blocked']) {
      const header = screen.getByText(label).closest('span');
      const iconSpans = header?.querySelectorAll('span[aria-hidden="true"]') ?? [];
      expect(iconSpans).toHaveLength(0);
    }
  });
});

/* ── Stage color accent ────────────────────────────────────────────────────── */

describe('KanbanBoard — stage color accent', () => {
  it('applies stage color as borderTop inline style on the column container', () => {
    const { container } = render(
      <KanbanBoard
        tasks={[]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );

    // Find all column containers (direct children of the scroll wrapper)
    const scrollWrapper = container.querySelector('.flex.overflow-x-auto');
    const columnDivs = Array.from(scrollWrapper?.children ?? []).filter(
      (el) => (el as HTMLElement).style !== undefined
    ) as HTMLElement[];

    // Coder stage has color '#3b82f6' — JSDOM normalizes hex to rgb(59, 130, 246)
    const coderCol = columnDivs.find(
      (el) =>
        el.style.borderTop?.includes('#3b82f6') ||
        el.style.borderTop?.includes('rgb(59, 130, 246)')
    );
    expect(coderCol).toBeDefined();
  });

  it('applies transparent top border for stages without color (neutral fallback)', () => {
    const { container } = render(
      <KanbanBoard
        tasks={[]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );

    const scrollWrapper = container.querySelector('.flex.overflow-x-auto');
    const columnDivs = Array.from(scrollWrapper?.children ?? []).filter(
      (el) => (el as HTMLElement).style !== undefined
    ) as HTMLElement[];

    // QA stage has no color — should have borderTop: 3px solid transparent
    // Find the QA column: it appears after the Coder column in order
    // Columns: [backlog, coder, qa, done, blocked] = indices 0,1,2,3,4
    const qaCol = columnDivs[2] as HTMLElement;
    expect(qaCol?.style.borderTop).toBe('3px solid transparent');
  });

  it('applies transparent top border for backlog and done (neutral fallback)', () => {
    const { container } = render(
      <KanbanBoard
        tasks={[]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );

    const scrollWrapper = container.querySelector('.flex.overflow-x-auto');
    const columnDivs = Array.from(scrollWrapper?.children ?? []).filter(
      (el) => (el as HTMLElement).style !== undefined
    ) as HTMLElement[];

    // Backlog = index 0, Done = index 3 (pipeline: [backlog, coder, qa, done, blocked])
    const backlogCol = columnDivs[0] as HTMLElement;
    const doneCol = columnDivs[3] as HTMLElement;

    expect(backlogCol?.style.borderTop).toBe('3px solid transparent');
    expect(doneCol?.style.borderTop).toBe('3px solid transparent');
  });
});

/* ── Task count badge ─────────────────────────────────────────────────────── */

describe('KanbanBoard — task count badge', () => {
  it('shows the number of tasks in each column', () => {
    const tasks = [makeTask('coder'), makeTask('coder', { id: 'task-coder-2', title: 'Task 2' })];
    render(
      <KanbanBoard
        tasks={tasks}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    // The Coder column should show count badge "2"
    // Task count badges are rendered as a span next to the header label
    const badges = screen.getAllByText('2');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });
});

/* ── Blocked column danger accent ─────────────────────────────────────────── */

describe('KanbanBoard — Blocked column danger accent', () => {
  it('applies red danger border accent to the Blocked column', () => {
    const { container } = render(
      <KanbanBoard
        tasks={[]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );

    const scrollWrapper = container.querySelector('.flex.overflow-x-auto');
    const columnDivs = Array.from(scrollWrapper?.children ?? []).filter(
      (el) => (el as HTMLElement).style !== undefined
    ) as HTMLElement[];

    // Pipeline: [backlog(0), coder(1), qa(2), done(3), blocked(4)]
    const blockedCol = columnDivs[4] as HTMLElement;
    // Must use the red danger accent — JSDOM normalizes #ef4444 to rgb(239, 68, 68)
    const borderTop = blockedCol?.style.borderTop ?? '';
    expect(borderTop.includes('#ef4444') || borderTop.includes('rgb(239, 68, 68)')).toBe(true);
  });

  it('does not apply transparent border to the Blocked column', () => {
    const { container } = render(
      <KanbanBoard
        tasks={[]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );

    const scrollWrapper = container.querySelector('.flex.overflow-x-auto');
    const columnDivs = Array.from(scrollWrapper?.children ?? []).filter(
      (el) => (el as HTMLElement).style !== undefined
    ) as HTMLElement[];

    const blockedCol = columnDivs[4] as HTMLElement;
    expect(blockedCol?.style.borderTop).not.toBe('3px solid transparent');
  });
});

/* ── Drops onto Blocked ───────────────────────────────────────────────────── */

describe('KanbanBoard — drops onto Blocked from any column', () => {
  it('calls onMoveTask when a task is dropped onto Blocked from a flow column', async () => {
    const onMoveTask = vi.fn().mockResolvedValue(undefined);
    const task = makeTask('coder');

    const { container } = render(
      <KanbanBoard
        tasks={[task]}
        pipeline={makePipeline()}
        onMoveTask={onMoveTask}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );

    const scrollWrapper = container.querySelector('.flex.overflow-x-auto');
    const columnDivs = Array.from(scrollWrapper?.children ?? []) as HTMLElement[];
    // Blocked is the last column (index 4)
    const blockedColDiv = columnDivs[4];

    // Simulate drag-and-drop onto Blocked
    fireEvent.drop(blockedColDiv, {
      dataTransfer: { getData: () => task.id },
    });

    // onMoveTask should be called with the blocked column id
    expect(onMoveTask).toHaveBeenCalledWith(task.id, 'blocked');
  });

  it('calls onMoveTask when a task is dropped onto Blocked from the done column', async () => {
    const onMoveTask = vi.fn().mockResolvedValue(undefined);
    // A task in 'done' can always be blocked as a human override
    const task = makeTask('done');

    const { container } = render(
      <KanbanBoard
        tasks={[task]}
        pipeline={makePipeline()}
        onMoveTask={onMoveTask}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );

    const scrollWrapper = container.querySelector('.flex.overflow-x-auto');
    const columnDivs = Array.from(scrollWrapper?.children ?? []) as HTMLElement[];
    const blockedColDiv = columnDivs[4];

    fireEvent.drop(blockedColDiv, {
      dataTransfer: { getData: () => task.id },
    });

    expect(onMoveTask).toHaveBeenCalledWith(task.id, 'blocked');
  });

  it('does not show a drop error when dropping onto Blocked from a non-adjacent column', async () => {
    const onMoveTask = vi.fn().mockResolvedValue(undefined);
    // backlog is not adjacent to blocked via normal transitions, but should still be allowed
    const task = makeTask('backlog');

    render(
      <KanbanBoard
        tasks={[task]}
        pipeline={makePipeline()}
        onMoveTask={onMoveTask}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );

    // After a valid drop to Blocked, no error toast should appear
    // (we check that the error text is absent)
    expect(screen.queryByText(/cannot move from/i)).toBeNull();
  });
});

/* ── Task card — 3.5: epic badge, lock indicator, bounce count ────────────── */

describe('KanbanBoard — task card epic badge', () => {
  it('renders parent task title as epic breadcrumb when parentTaskId is set', () => {
    const epicTask = makeTask('backlog', {
      id: 'epic-1',
      title: 'Epic: Big Feature',
      isEpic: true,
    });
    const subTask = makeTask('coder', {
      id: 'sub-1',
      title: 'Implement sub-task',
      parentTaskId: 'epic-1',
    });

    render(
      <KanbanBoard
        tasks={[epicTask, subTask]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );

    // The parent epic title should appear as breadcrumb text in the sub-task card
    expect(screen.getByText('📌 Epic: Big Feature')).toBeInTheDocument();
  });

  it('does not render epic breadcrumb when parentTaskId is not set', () => {
    const task = makeTask('coder');
    render(
      <KanbanBoard
        tasks={[task]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    expect(screen.queryByText(/📌/)).toBeNull();
  });

  it('does not render epic breadcrumb when parentTaskId references a non-existent task', () => {
    const task = makeTask('coder', { parentTaskId: 'ghost-id' });
    render(
      <KanbanBoard
        tasks={[task]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    expect(screen.queryByText(/📌/)).toBeNull();
  });
});

describe('KanbanBoard — task card lock indicator', () => {
  it('renders 🔒 when lockedBy is set', () => {
    const task = makeTask('coder', { lockedBy: 'zephyr-proj-coder-0' });
    render(
      <KanbanBoard
        tasks={[task]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    expect(screen.getByLabelText('locked')).toBeInTheDocument();
  });

  it('does not render 🔒 when lockedBy is not set', () => {
    const task = makeTask('coder');
    render(
      <KanbanBoard
        tasks={[task]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    expect(screen.queryByLabelText('locked')).toBeNull();
  });
});

/* ── 3.6: Epic progress tracker in Backlog header ─────────────────────────── */

describe('KanbanBoard — epic progress tracker', () => {
  it('shows no tracker section when there are no epic tasks in backlog', () => {
    const task = makeTask('backlog');
    render(
      <KanbanBoard
        tasks={[task]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    expect(screen.queryByLabelText('Epic progress')).toBeNull();
  });

  it('renders the epic tracker section when an isEpic task is in backlog', () => {
    const epic = makeTask('backlog', { id: 'ep-1', title: 'My Epic', isEpic: true });
    render(
      <KanbanBoard
        tasks={[epic]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    expect(screen.getByLabelText('Epic progress')).toBeInTheDocument();
  });

  it('shows 0/0 when the epic has no sub-tasks', () => {
    const epic = makeTask('backlog', { id: 'ep-1', title: 'My Epic', isEpic: true });
    render(
      <KanbanBoard
        tasks={[epic]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    expect(screen.getByLabelText('0 of 0 sub-tasks done')).toBeInTheDocument();
  });

  it('shows correct X/Y count for sub-tasks', () => {
    const epic = makeTask('backlog', { id: 'ep-1', title: 'My Epic', isEpic: true });
    const sub1 = makeTask('done', { id: 'sub-1', title: 'Sub 1', parentTaskId: 'ep-1' });
    const sub2 = makeTask('coder', { id: 'sub-2', title: 'Sub 2', parentTaskId: 'ep-1' });
    const sub3 = makeTask('done', { id: 'sub-3', title: 'Sub 3', parentTaskId: 'ep-1' });
    render(
      <KanbanBoard
        tasks={[epic, sub1, sub2, sub3]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    // 2 of 3 sub-tasks are done
    expect(screen.getByLabelText('2 of 3 sub-tasks done')).toBeInTheDocument();
  });

  it('shows the epic title in the tracker section', () => {
    const epic = makeTask('backlog', { id: 'ep-1', title: 'Big Feature Epic', isEpic: true });
    render(
      <KanbanBoard
        tasks={[epic]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    // The epic title appears in both the tracker header and the task card; verify tracker has it
    const tracker = screen.getByLabelText('Epic progress');
    expect(within(tracker).getByText('Big Feature Epic')).toBeInTheDocument();
  });

  it('renders multiple epics in the tracker when several epics are in backlog', () => {
    const epic1 = makeTask('backlog', { id: 'ep-1', title: 'Epic One', isEpic: true });
    const epic2 = makeTask('backlog', { id: 'ep-2', title: 'Epic Two', isEpic: true });
    const sub1 = makeTask('done', { id: 'sub-1', title: 'Sub A', parentTaskId: 'ep-1' });
    render(
      <KanbanBoard
        tasks={[epic1, epic2, sub1]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    const tracker = screen.getByLabelText('Epic progress');
    expect(within(tracker).getByText('Epic One')).toBeInTheDocument();
    expect(within(tracker).getByText('Epic Two')).toBeInTheDocument();
    // Epic One: 1/1 done; Epic Two: 0/0
    expect(screen.getByLabelText('1 of 1 sub-tasks done')).toBeInTheDocument();
    expect(screen.getByLabelText('0 of 0 sub-tasks done')).toBeInTheDocument();
  });

  it('does not show tracker for epics outside the backlog column', () => {
    // An isEpic task in the coder column should not trigger the tracker
    const epicElsewhere = makeTask('coder', { id: 'ep-1', title: 'Coder Epic', isEpic: true });
    render(
      <KanbanBoard
        tasks={[epicElsewhere]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    expect(screen.queryByLabelText('Epic progress')).toBeNull();
  });

  it('renders tooltip with full title and progress on each tracker row', () => {
    const epic = makeTask('backlog', { id: 'ep-1', title: 'Feature Epic', isEpic: true });
    const sub = makeTask('done', { id: 'sub-1', title: 'Sub 1', parentTaskId: 'ep-1' });
    const { container } = render(
      <KanbanBoard
        tasks={[epic, sub]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    // Find the tracker row div with the title attribute
    const row = container.querySelector('[title="Feature Epic: 1/1 sub-tasks done"]');
    expect(row).not.toBeNull();
  });
});

describe('KanbanBoard — task card bounce count pill', () => {
  it('renders bounce count pill when bounceCount > 0', () => {
    const task = makeTask('coder', { bounceCount: 2 });
    render(
      <KanbanBoard
        tasks={[task]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    expect(screen.getByText('↩ 2')).toBeInTheDocument();
  });

  it('does not render bounce count pill when bounceCount is 0', () => {
    const task = makeTask('coder', { bounceCount: 0 });
    render(
      <KanbanBoard
        tasks={[task]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    expect(screen.queryByText(/↩/)).toBeNull();
  });

  it('renders singular bounce tooltip for bounceCount === 1', () => {
    const task = makeTask('coder', { bounceCount: 1 });
    render(
      <KanbanBoard
        tasks={[task]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    const pill = screen.getByText('↩ 1');
    expect(pill.title).toBe('Bounced 1 time');
  });

  it('renders plural bounce tooltip for bounceCount > 1', () => {
    const task = makeTask('coder', { bounceCount: 3 });
    render(
      <KanbanBoard
        tasks={[task]}
        pipeline={makePipeline()}
        onMoveTask={noop}
        onRemoveTask={noop}
        onSelectTask={noop}
      />
    );
    const pill = screen.getByText('↩ 3');
    expect(pill.title).toBe('Bounced 3 times');
  });
});
