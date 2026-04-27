/**
 * Tests for PipelineLibrarySection — Phase 5, task 5.8.
 *
 * Validates:
 * - Library listing (built-in templates, user pipelines, empty states, stage counts)
 * - Clone action (payload, in-progress state, error banner)
 * - Delete flow (modal open, reference-count warning, cancel, confirm, error)
 * - Create/Edit via PipelineBuilderDialog
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PipelineLibrarySection } from '../../src/renderer/pages/SettingsTab/PipelineLibrarySection';
import { useAppStore } from '../../src/renderer/stores/app-store';
import type { Pipeline } from '../../src/shared/pipeline-types';
import type { ProjectConfig } from '../../src/shared/models';

// Mock PipelineBuilderDialog to avoid its IPC/store dependencies.
vi.mock(
  '../../src/renderer/components/PipelineBuilderDialog/PipelineBuilderDialog',
  () => ({
    default: ({
      isOpen,
      pipeline,
    }: {
      isOpen: boolean;
      onClose: () => void;
      pipeline?: Pipeline | null;
    }) => {
      if (!isOpen) return null;
      return (
        <div data-testid="pipeline-builder-dialog">
          {pipeline ? `Editing: ${pipeline.name}` : 'Creating new pipeline'}
        </div>
      );
    },
  })
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBuiltIn(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'classic-factory',
    name: 'Classic Factory',
    description: 'A built-in pipeline',
    stages: [
      { id: 'pm', name: 'PM', agentPrompt: '', instances: 1 },
      { id: 'coder', name: 'Coder', agentPrompt: '', instances: 2 },
    ],
    bounceLimit: 3,
    builtIn: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeUserPipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'my-pipeline',
    name: 'My Custom Pipeline',
    stages: [{ id: 'dev', name: 'Dev', agentPrompt: '', instances: 1 }],
    bounceLimit: 3,
    builtIn: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeProject(pipelineId: string): ProjectConfig {
  return {
    id: 'proj-1',
    name: 'Test Project',
    repoUrl: 'https://github.com/test/repo',
    dockerImage: 'ubuntu:24.04',
    workDir: '/workspace',
    customPrompt: '',
    factory: { enabled: true },
    pipelineId,
  };
}

// ---------------------------------------------------------------------------
// window.api mock
// ---------------------------------------------------------------------------

const mockPipelinesApi = {
  list: vi.fn().mockResolvedValue([]),
  get: vi.fn().mockResolvedValue(null),
  add: vi.fn().mockResolvedValue({ id: 'new-clone-id' }),
  update: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  onChanged: vi.fn().mockReturnValue(() => {}),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPipelinesApi.add.mockResolvedValue({ id: 'new-clone-id' });
  mockPipelinesApi.remove.mockResolvedValue(undefined);
  Object.defineProperty(window, 'api', {
    value: { pipelines: mockPipelinesApi },
    writable: true,
    configurable: true,
  });
  useAppStore.setState({ pipelines: [], projects: [] });
});

// ---------------------------------------------------------------------------
// Library listing
// ---------------------------------------------------------------------------

describe('PipelineLibrarySection — library listing', () => {
  it('renders Built-in Templates and Your Pipelines headings', () => {
    render(<PipelineLibrarySection />);
    expect(screen.getByText('Built-in Templates')).toBeInTheDocument();
    expect(screen.getByText('Your Pipelines')).toBeInTheDocument();
  });

  it('shows empty state when no built-in templates', () => {
    render(<PipelineLibrarySection />);
    expect(screen.getByText('No built-in templates available.')).toBeInTheDocument();
  });

  it('shows empty state when no user pipelines', () => {
    render(<PipelineLibrarySection />);
    expect(
      screen.getByText(/No custom pipelines yet/i)
    ).toBeInTheDocument();
  });

  it('renders built-in pipeline with "built-in" badge', () => {
    useAppStore.setState({ pipelines: [makeBuiltIn()] });
    render(<PipelineLibrarySection />);
    expect(screen.getByText('Classic Factory')).toBeInTheDocument();
    expect(screen.getByText('built-in')).toBeInTheDocument();
  });

  it('renders user pipeline without "built-in" badge', () => {
    useAppStore.setState({ pipelines: [makeUserPipeline()] });
    render(<PipelineLibrarySection />);
    expect(screen.getByText('My Custom Pipeline')).toBeInTheDocument();
    expect(screen.queryByText('built-in')).not.toBeInTheDocument();
  });

  it('shows stage count for each pipeline', () => {
    useAppStore.setState({ pipelines: [makeBuiltIn()] });
    render(<PipelineLibrarySection />);
    expect(screen.getByText(/2 stages/i)).toBeInTheDocument();
  });

  it('shows singular "stage" for 1-stage pipeline', () => {
    useAppStore.setState({ pipelines: [makeUserPipeline()] });
    render(<PipelineLibrarySection />);
    expect(screen.getByText(/1 stage(?!s)/i)).toBeInTheDocument();
  });

  it('appends description after stage count when present', () => {
    useAppStore.setState({ pipelines: [makeBuiltIn()] });
    render(<PipelineLibrarySection />);
    expect(screen.getByText(/A built-in pipeline/i)).toBeInTheDocument();
  });

  it('built-in pipeline has Clone button but no Edit or Delete', () => {
    useAppStore.setState({ pipelines: [makeBuiltIn()] });
    render(<PipelineLibrarySection />);
    expect(screen.getByRole('button', { name: /^Clone$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete$/i })).not.toBeInTheDocument();
  });

  it('user pipeline has Edit, Clone, and Delete buttons', () => {
    useAppStore.setState({ pipelines: [makeUserPipeline()] });
    render(<PipelineLibrarySection />);
    expect(screen.getByRole('button', { name: /^Edit$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Clone$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Delete$/i })).toBeInTheDocument();
  });

  it('renders + New Pipeline button', () => {
    render(<PipelineLibrarySection />);
    expect(screen.getByRole('button', { name: /\+ New Pipeline/i })).toBeInTheDocument();
  });

  it('shows extra-stage count overflow indicator for > 5 stages', () => {
    const manyStages = Array.from({ length: 7 }, (_, i) => ({
      id: `stage-${i}`,
      name: `Stage ${i}`,
      agentPrompt: '',
      instances: 1,
    }));
    useAppStore.setState({ pipelines: [makeBuiltIn({ stages: manyStages })] });
    render(<PipelineLibrarySection />);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Clone action
// ---------------------------------------------------------------------------

describe('PipelineLibrarySection — clone action', () => {
  it('calls window.api.pipelines.add with cloned payload on Clone click', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ pipelines: [makeBuiltIn()] });
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /^Clone$/i }));

    await waitFor(() => {
      expect(mockPipelinesApi.add).toHaveBeenCalledOnce();
    });

    const payload = mockPipelinesApi.add.mock.calls[0][0];
    expect(payload.name).toBe('Classic Factory (copy)');
    expect(payload.builtIn).toBe(false);
    expect(payload.stages).toEqual(makeBuiltIn().stages);
    expect(payload.bounceLimit).toBe(makeBuiltIn().bounceLimit);
    expect(payload.description).toBe(makeBuiltIn().description);
  });

  it('shows Cloning… and disables button while cloning', async () => {
    const user = userEvent.setup();
    // Delay the add call so we can observe in-progress state
    mockPipelinesApi.add.mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 200))
    );
    useAppStore.setState({ pipelines: [makeBuiltIn()] });
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /^Clone$/i }));
    expect(screen.getByRole('button', { name: /Cloning…/i })).toBeDisabled();
  });

  it('shows clone error banner when add fails', async () => {
    const user = userEvent.setup();
    mockPipelinesApi.add.mockRejectedValue(new Error('Network error'));
    useAppStore.setState({ pipelines: [makeBuiltIn()] });
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /^Clone$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Clone failed: Network error/i)).toBeInTheDocument();
    });
  });

  it('clone button returns to normal state after success', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ pipelines: [makeBuiltIn()] });
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /^Clone$/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Cloning…/i)).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /^Clone$/i })).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Delete flow
// ---------------------------------------------------------------------------

describe('PipelineLibrarySection — delete flow', () => {
  it('clicking Delete opens confirmation modal with pipeline name', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ pipelines: [makeUserPipeline()] });
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /^Delete$/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/This cannot be undone/i)).toBeInTheDocument();
    // Pipeline name appears inside the confirmation text
    expect(within(dialog).getByText(/My Custom Pipeline/i)).toBeInTheDocument();
  });

  it('shows no reference warning when no projects use the pipeline', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ pipelines: [makeUserPipeline()], projects: [] });
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /^Delete$/i }));

    expect(screen.queryByText(/project.*will have.*factory disabled/i)).not.toBeInTheDocument();
  });

  it('shows singular reference warning when 1 project uses the pipeline', async () => {
    const user = userEvent.setup();
    const pipeline = makeUserPipeline();
    useAppStore.setState({
      pipelines: [pipeline],
      projects: [makeProject(pipeline.id)],
    });
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /^Delete$/i }));

    expect(screen.getByText(/1 project will have their factory disabled/i)).toBeInTheDocument();
  });

  it('shows plural reference warning when 2+ projects use the pipeline', async () => {
    const user = userEvent.setup();
    const pipeline = makeUserPipeline();
    const proj1 = makeProject(pipeline.id);
    const proj2 = { ...makeProject(pipeline.id), id: 'proj-2', name: 'Second Project' };
    useAppStore.setState({
      pipelines: [pipeline],
      projects: [proj1, proj2],
    });
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /^Delete$/i }));

    expect(screen.getByText(/2 projects will have their factory disabled/i)).toBeInTheDocument();
  });

  it('Cancel button closes modal without calling remove', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ pipelines: [makeUserPipeline()] });
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /^Delete$/i }));
    await user.click(screen.getByRole('button', { name: /^Cancel$/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockPipelinesApi.remove).not.toHaveBeenCalled();
  });

  it('confirming delete calls window.api.pipelines.remove with the pipeline id', async () => {
    const user = userEvent.setup();
    const pipeline = makeUserPipeline();
    useAppStore.setState({ pipelines: [pipeline] });
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /^Delete$/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Delete$/i }));

    await waitFor(() => {
      expect(mockPipelinesApi.remove).toHaveBeenCalledWith(pipeline.id);
    });
  });

  it('modal closes after successful delete', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ pipelines: [makeUserPipeline()] });
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /^Delete$/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Delete$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('shows error inside modal when delete fails', async () => {
    const user = userEvent.setup();
    mockPipelinesApi.remove.mockRejectedValue(new Error('Permission denied'));
    useAppStore.setState({ pipelines: [makeUserPipeline()] });
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /^Delete$/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Delete$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
    });
    // Modal stays open on error
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Delete confirm button shows Deleting… while in progress', async () => {
    const user = userEvent.setup();
    mockPipelinesApi.remove.mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 200))
    );
    useAppStore.setState({ pipelines: [makeUserPipeline()] });
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /^Delete$/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Delete$/i }));

    expect(within(dialog).getByRole('button', { name: /Deleting…/i })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Create / Edit
// ---------------------------------------------------------------------------

describe('PipelineLibrarySection — create and edit', () => {
  it('clicking + New Pipeline opens builder dialog without pipeline', async () => {
    const user = userEvent.setup();
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /\+ New Pipeline/i }));

    expect(screen.getByTestId('pipeline-builder-dialog')).toBeInTheDocument();
    expect(screen.getByText('Creating new pipeline')).toBeInTheDocument();
  });

  it('clicking Edit opens builder dialog with the pipeline', async () => {
    const user = userEvent.setup();
    const pipeline = makeUserPipeline();
    useAppStore.setState({ pipelines: [pipeline] });
    render(<PipelineLibrarySection />);

    await user.click(screen.getByRole('button', { name: /^Edit$/i }));

    expect(screen.getByTestId('pipeline-builder-dialog')).toBeInTheDocument();
    expect(screen.getByText(`Editing: ${pipeline.name}`)).toBeInTheDocument();
  });
});
