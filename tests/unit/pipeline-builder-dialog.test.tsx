/**
 * PipelineBuilderDialog tests — Phase 4 (tasks 4.1–4.9) + Phase 6 (task 6.4).
 *
 * Validates:
 * - Dialog renders closed when isOpen=false.
 * - Dialog renders with correct header for new/edit/built-in pipelines.
 * - Stage list renders all stages with name, icon, color inputs.
 * - Selecting a stage loads its prompt in the editor.
 * - Adding a stage appends to the list and selects it.
 * - Duplicating a stage inserts a copy and selects it.
 * - Deleting a stage without a prompt removes it immediately.
 * - Deleting a stage with a prompt shows a confirm dialog.
 * - Move up/down reorders stages.
 * - Column preview reflects current stage list order.
 * - Validation: name required, at least one stage, all stage names non-empty.
 * - Save calls window.api.pipelines.update for existing user pipelines.
 * - Save as new calls window.api.pipelines.add.
 * - Built-in pipelines: inputs disabled, no save button shown.
 * - slugifyStageId generates unique slug ids.
 * - Starter prompt dropdown: visible for editable pipelines, hidden for built-ins.
 * - Selecting a starter prompt replaces the textarea content with the template.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';
import PipelineBuilderDialog from '../../src/renderer/components/PipelineBuilderDialog/PipelineBuilderDialog';
import { slugifyStageId } from '../../src/lib/pipeline/slugify';
import { PIPELINE_BUILDER_STARTER_PROMPTS } from '../../src/shared/pipeline-builtins';
import type { Pipeline } from '../../src/shared/pipeline-types';

/* ── Global mock for window.api ─────────────────────────────────────────────── */

const mockUpdate = vi.fn().mockResolvedValue({});
const mockAdd = vi.fn().mockResolvedValue({});

beforeEach(() => {
  vi.resetAllMocks();
  mockUpdate.mockResolvedValue({});
  mockAdd.mockResolvedValue({});
  (window as unknown as Record<string, unknown>).api = {
    pipelines: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      add: mockAdd,
      update: mockUpdate,
      remove: vi.fn().mockResolvedValue(undefined),
      onChanged: vi.fn().mockReturnValue(() => {}),
    },
  };
});

afterEach(() => {
  cleanup();
});

/* ── Fixtures ────────────────────────────────────────────────────────────────── */

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'pipe-1',
    name: 'Classic Factory',
    stages: [
      { id: 'coder', name: 'Coder', agentPrompt: 'Write code.', instances: 1, color: '#3b82f6', icon: '💻' },
      { id: 'qa', name: 'QA', agentPrompt: 'Review code.', instances: 2 },
    ],
    bounceLimit: 3,
    builtIn: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBuiltIn(): Pipeline {
  return makePipeline({ builtIn: true, name: 'Built-in Pipeline' });
}

function renderDialog(props: Partial<React.ComponentProps<typeof PipelineBuilderDialog>> = {}) {
  return render(
    <PipelineBuilderDialog isOpen={true} onClose={vi.fn()} {...props} />,
  );
}

/* ── slugifyStageId unit tests ─────────────────────────────────────────────── */

describe('slugifyStageId', () => {
  it('converts name to lowercase hyphen-slug', () => {
    expect(slugifyStageId('Rust Specialist')).toBe('rust-specialist');
  });

  it('strips leading/trailing hyphens', () => {
    expect(slugifyStageId('  code  ')).toBe('code');
  });

  it('falls back to "stage" for empty/whitespace names', () => {
    expect(slugifyStageId('')).toBe('stage');
    expect(slugifyStageId('   ')).toBe('stage');
  });

  it('appends numeric suffix to avoid id collisions', () => {
    expect(slugifyStageId('coder', ['coder'])).toBe('coder-2');
    expect(slugifyStageId('coder', ['coder', 'coder-2'])).toBe('coder-3');
  });

  it('returns base slug when no collision', () => {
    expect(slugifyStageId('coder', ['qa', 'security'])).toBe('coder');
  });

  it('collapses consecutive special characters to one hyphen', () => {
    expect(slugifyStageId('A--B  C')).toBe('a-b-c');
  });
});

/* ── Dialog visibility ──────────────────────────────────────────────────────── */

describe('PipelineBuilderDialog visibility', () => {
  it('renders nothing when isOpen is false', () => {
    render(<PipelineBuilderDialog isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog when isOpen is true', () => {
    renderDialog();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

/* ── Header titles ──────────────────────────────────────────────────────────── */

describe('dialog header', () => {
  it('shows "New Pipeline" when no pipeline prop', () => {
    renderDialog();
    expect(screen.getByText('New Pipeline')).toBeTruthy();
  });

  it('shows "Edit Pipeline" for user pipeline', () => {
    renderDialog({ pipeline: makePipeline() });
    expect(screen.getByText('Edit Pipeline')).toBeTruthy();
  });

  it('shows read-only header for built-in pipeline', () => {
    renderDialog({ pipeline: makeBuiltIn() });
    expect(screen.getByText(/read-only/i)).toBeTruthy();
  });
});

/* ── Stage list ─────────────────────────────────────────────────────────────── */

describe('stage list', () => {
  it('renders all stages from the pipeline', () => {
    renderDialog({ pipeline: makePipeline() });
    const nameInputs = screen.getAllByRole('textbox', { name: /stage name/i });
    expect(nameInputs).toHaveLength(2);
    expect((nameInputs[0] as HTMLInputElement).value).toBe('Coder');
    expect((nameInputs[1] as HTMLInputElement).value).toBe('QA');
  });

  it('renders a default "Stage 1" for a new pipeline', () => {
    renderDialog();
    const inputs = screen.getAllByRole('textbox', { name: /stage name/i });
    expect(inputs).toHaveLength(1);
    expect((inputs[0] as HTMLInputElement).value).toBe('Stage 1');
  });

  it('renders stage icon emoji when set', () => {
    renderDialog({ pipeline: makePipeline() });
    // icon field for the first stage should have 💻
    const iconInputs = screen.getAllByRole('textbox', { name: /icon/i });
    expect((iconInputs[0] as HTMLInputElement).value).toBe('💻');
  });
});

/* ── Prompt editor ──────────────────────────────────────────────────────────── */

describe('prompt editor', () => {
  it('shows the selected stage prompt in the textarea', () => {
    renderDialog({ pipeline: makePipeline() });
    const editor = screen.getByRole('textbox', { name: /agent prompt/i });
    expect((editor as HTMLTextAreaElement).value).toBe('Write code.');
  });

  it('switches prompt when a different stage is selected', () => {
    renderDialog({ pipeline: makePipeline() });
    const cards = screen.getAllByRole('button', { name: /stage:/i });
    fireEvent.click(cards[1]); // select QA
    const editor = screen.getByRole('textbox', { name: /agent prompt/i });
    expect((editor as HTMLTextAreaElement).value).toBe('Review code.');
  });

  it('updates stage prompt on textarea change', () => {
    renderDialog({ pipeline: makePipeline() });
    const editor = screen.getByRole('textbox', { name: /agent prompt/i });
    fireEvent.change(editor, { target: { value: 'Updated prompt.' } });
    expect((editor as HTMLTextAreaElement).value).toBe('Updated prompt.');
  });
});

/* ── Add / duplicate / delete ───────────────────────────────────────────────── */

describe('stage CRUD', () => {
  it('adds a new stage when clicking Add', () => {
    renderDialog({ pipeline: makePipeline() });
    fireEvent.click(screen.getByRole('button', { name: /add stage/i }));
    const nameInputs = screen.getAllByRole('textbox', { name: /stage name/i });
    expect(nameInputs).toHaveLength(3);
  });

  it('duplicates a stage when clicking duplicate', () => {
    renderDialog({ pipeline: makePipeline() });
    const dupButtons = screen.getAllByRole('button', { name: /duplicate stage/i });
    fireEvent.click(dupButtons[0]);
    const nameInputs = screen.getAllByRole('textbox', { name: /stage name/i });
    expect(nameInputs).toHaveLength(3);
    expect((nameInputs[1] as HTMLInputElement).value).toBe('Coder (copy)');
  });

  it('deletes a stage without a prompt immediately', () => {
    renderDialog({ pipeline: makePipeline({ stages: [
      { id: 'coder', name: 'Coder', agentPrompt: '', instances: 1 },
      { id: 'qa', name: 'QA', agentPrompt: '', instances: 1 },
    ]}) });
    const deleteButtons = screen.getAllByRole('button', { name: /delete stage/i });
    fireEvent.click(deleteButtons[0]);
    const nameInputs = screen.getAllByRole('textbox', { name: /stage name/i });
    expect(nameInputs).toHaveLength(1);
    expect((nameInputs[0] as HTMLInputElement).value).toBe('QA');
  });

  it('shows delete confirm when stage has a prompt', () => {
    renderDialog({ pipeline: makePipeline() }); // Coder has prompt "Write code."
    const deleteButtons = screen.getAllByRole('button', { name: /delete stage/i });
    fireEvent.click(deleteButtons[0]);
    expect(screen.getByText(/has a prompt that will be permanently lost/i)).toBeTruthy();
  });

  it('removes stage after confirming delete', () => {
    renderDialog({ pipeline: makePipeline() });
    const deleteButtons = screen.getAllByRole('button', { name: /delete stage/i });
    fireEvent.click(deleteButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
    const nameInputs = screen.getAllByRole('textbox', { name: /stage name/i });
    expect(nameInputs).toHaveLength(1);
  });

  it('cancels delete on cancel click', () => {
    renderDialog({ pipeline: makePipeline() });
    const deleteButtons = screen.getAllByRole('button', { name: /delete stage/i });
    fireEvent.click(deleteButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: /cancel delete/i }));
    const nameInputs = screen.getAllByRole('textbox', { name: /stage name/i });
    expect(nameInputs).toHaveLength(2);
  });
});

/* ── Move up/down ───────────────────────────────────────────────────────────── */

describe('stage reordering', () => {
  it('moves a stage up', () => {
    renderDialog({ pipeline: makePipeline() });
    const downButtons = screen.getAllByRole('button', { name: /move stage up/i });
    fireEvent.click(downButtons[1]); // move QA up
    const nameInputs = screen.getAllByRole('textbox', { name: /stage name/i });
    expect((nameInputs[0] as HTMLInputElement).value).toBe('QA');
    expect((nameInputs[1] as HTMLInputElement).value).toBe('Coder');
  });

  it('moves a stage down', () => {
    renderDialog({ pipeline: makePipeline() });
    const downButtons = screen.getAllByRole('button', { name: /move stage down/i });
    fireEvent.click(downButtons[0]); // move Coder down
    const nameInputs = screen.getAllByRole('textbox', { name: /stage name/i });
    expect((nameInputs[0] as HTMLInputElement).value).toBe('QA');
    expect((nameInputs[1] as HTMLInputElement).value).toBe('Coder');
  });
});

/* ── Column preview ─────────────────────────────────────────────────────────── */

describe('column preview', () => {
  it('renders Backlog, stage names, Done, Blocked in order', () => {
    renderDialog({ pipeline: makePipeline() });
    // Preview text appears as column chip labels
    const preview = screen.getByText('Preview:').closest('div')!;
    const text = preview.textContent ?? '';
    const backlogIdx = text.indexOf('Backlog');
    const coderIdx = text.indexOf('Coder');
    const qaIdx = text.indexOf('QA');
    const doneIdx = text.indexOf('Done');
    const blockedIdx = text.indexOf('Blocked');
    expect(backlogIdx).toBeLessThan(coderIdx);
    expect(coderIdx).toBeLessThan(qaIdx);
    expect(qaIdx).toBeLessThan(doneIdx);
    expect(doneIdx).toBeLessThan(blockedIdx);
  });
});

/* ── Validation ─────────────────────────────────────────────────────────────── */

describe('validation', () => {
  it('shows error when pipeline name is empty and save is clicked', async () => {
    renderDialog(); // new pipeline — name starts empty
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create pipeline/i }));
    });
    expect(screen.getByText(/pipeline name is required/i)).toBeTruthy();
  });

  it('shows error when a stage name is empty', async () => {
    renderDialog({ pipeline: makePipeline() });
    // clear the first stage name
    const nameInputs = screen.getAllByRole('textbox', { name: /stage name/i });
    fireEvent.change(nameInputs[0], { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    });
    expect(screen.getByText(/all stages must have a name/i)).toBeTruthy();
  });
});

/* ── Save actions ───────────────────────────────────────────────────────────── */

describe('save actions', () => {
  it('calls pipelines.update for an existing user pipeline', async () => {
    renderDialog({ pipeline: makePipeline() });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    });
    expect(mockUpdate).toHaveBeenCalledWith('pipe-1', expect.objectContaining({ name: 'Classic Factory' }));
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('calls pipelines.add for "Save as New"', async () => {
    renderDialog({ pipeline: makePipeline() });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save as new/i }));
    });
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Classic Factory', builtIn: false }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('calls pipelines.add when creating a new pipeline', async () => {
    renderDialog();
    // Set a name so validation passes
    const nameInput = screen.getByRole('textbox', { name: /pipeline name/i });
    fireEvent.change(nameInput, { target: { value: 'My New Pipeline' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create pipeline/i }));
    });
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'My New Pipeline', builtIn: false }));
  });

  it('calls onClose after a successful save', async () => {
    const onClose = vi.fn();
    render(<PipelineBuilderDialog isOpen={true} onClose={onClose} pipeline={makePipeline()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error message when save throws', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('Network error'));
    renderDialog({ pipeline: makePipeline() });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    });
    expect(screen.getByText('Network error')).toBeTruthy();
  });
});

/* ── Built-in pipeline read-only mode ──────────────────────────────────────── */

describe('built-in pipeline (read-only)', () => {
  it('disables the pipeline name input', () => {
    renderDialog({ pipeline: makeBuiltIn() });
    const nameInput = screen.getByRole('textbox', { name: /pipeline name/i });
    expect((nameInput as HTMLInputElement).disabled).toBe(true);
  });

  it('disables the prompt editor', () => {
    renderDialog({ pipeline: makeBuiltIn() });
    const editor = screen.getByRole('textbox', { name: /agent prompt/i });
    expect((editor as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('does not render Save Changes or Save as New buttons', () => {
    renderDialog({ pipeline: makeBuiltIn() });
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save as new/i })).toBeNull();
  });

  it('does not render the Add stage button', () => {
    renderDialog({ pipeline: makeBuiltIn() });
    expect(screen.queryByRole('button', { name: /add stage/i })).toBeNull();
  });
});

/* ── Starter prompt dropdown ────────────────────────────────────────────────── */

describe('starter prompt dropdown', () => {
  it('renders the "Insert starter…" select for an editable pipeline', () => {
    renderDialog({ pipeline: makePipeline() });
    expect(screen.getByRole('combobox', { name: /insert starter prompt/i })).toBeTruthy();
  });

  it('does not render the select for a built-in (read-only) pipeline', () => {
    renderDialog({ pipeline: makeBuiltIn() });
    expect(screen.queryByRole('combobox', { name: /insert starter prompt/i })).toBeNull();
  });

  it('lists all starter prompt options plus the disabled placeholder', () => {
    renderDialog({ pipeline: makePipeline() });
    const select = screen.getByRole('combobox', { name: /insert starter prompt/i });
    // +1 for the disabled "Insert starter…" placeholder option
    expect(within(select as HTMLElement).getAllByRole('option')).toHaveLength(
      PIPELINE_BUILDER_STARTER_PROMPTS.length + 1,
    );
  });

  it('replaces the prompt with the Generic Stage template when selected', () => {
    renderDialog({ pipeline: makePipeline() });
    const select = screen.getByRole('combobox', { name: /insert starter prompt/i });
    const genericIdx = PIPELINE_BUILDER_STARTER_PROMPTS.findIndex((p) =>
      p.label === 'Generic Stage',
    );
    fireEvent.change(select, { target: { value: String(genericIdx) } });
    const editor = screen.getByRole('textbox', { name: /agent prompt/i });
    expect((editor as HTMLTextAreaElement).value).toBe(
      PIPELINE_BUILDER_STARTER_PROMPTS[genericIdx].prompt,
    );
  });

  it('replaces the prompt with the PM template when selected', () => {
    renderDialog({ pipeline: makePipeline() });
    const select = screen.getByRole('combobox', { name: /insert starter prompt/i });
    const pmIdx = PIPELINE_BUILDER_STARTER_PROMPTS.findIndex((p) =>
      p.label.includes('PM'),
    );
    fireEvent.change(select, { target: { value: String(pmIdx) } });
    const editor = screen.getByRole('textbox', { name: /agent prompt/i });
    expect((editor as HTMLTextAreaElement).value).toBe(
      PIPELINE_BUILDER_STARTER_PROMPTS[pmIdx].prompt,
    );
  });

  it('replaces the prompt with the Security Reviewer template when selected', () => {
    renderDialog({ pipeline: makePipeline() });
    const select = screen.getByRole('combobox', { name: /insert starter prompt/i });
    const secIdx = PIPELINE_BUILDER_STARTER_PROMPTS.findIndex((p) =>
      p.label.includes('Security'),
    );
    fireEvent.change(select, { target: { value: String(secIdx) } });
    const editor = screen.getByRole('textbox', { name: /agent prompt/i });
    expect((editor as HTMLTextAreaElement).value).toBe(
      PIPELINE_BUILDER_STARTER_PROMPTS[secIdx].prompt,
    );
  });

  it('replaces the prompt with the Technical Writer template when selected', () => {
    renderDialog({ pipeline: makePipeline() });
    const select = screen.getByRole('combobox', { name: /insert starter prompt/i });
    const twIdx = PIPELINE_BUILDER_STARTER_PROMPTS.findIndex((p) =>
      p.label.includes('Technical Writer'),
    );
    fireEvent.change(select, { target: { value: String(twIdx) } });
    const editor = screen.getByRole('textbox', { name: /agent prompt/i });
    expect((editor as HTMLTextAreaElement).value).toBe(
      PIPELINE_BUILDER_STARTER_PROMPTS[twIdx].prompt,
    );
  });

  it('each starter prompt contains the protocol preamble signal files section', () => {
    for (const { label, prompt } of PIPELINE_BUILDER_STARTER_PROMPTS) {
      expect(prompt, `${label} missing SIGNAL FILES`).toContain('SIGNAL FILES');
      expect(prompt, `${label} missing LOCK PROTOCOL`).toContain('LOCK PROTOCOL');
      expect(prompt, `${label} missing ROUTING SIGNAL`).toContain('ROUTING SIGNAL');
    }
  });
});
