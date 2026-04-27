/**
 * FactoryTab smoke tests.
 *
 * Verifies the top-level FactoryTab page renders correctly across the key
 * states: factory-enabled projects (kanban shown), no factory projects
 * (empty state), and form submission wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FactoryTab } from '../../src/renderer/pages/FactoryTab/FactoryTab';
import { useAppStore } from '../../src/renderer/stores/app-store';

// Minimal pipeline fixture for tests
const MOCK_PIPELINE = {
  id: 'pipe-test',
  name: 'Test Pipeline',
  stages: [
    { id: 'coder', name: 'Coder', agentPrompt: 'code', instances: 1 },
    { id: 'qa', name: 'QA', agentPrompt: 'review', instances: 1 },
  ],
  bounceLimit: 3,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

// Minimal factory-enabled project fixture
const FACTORY_PROJECT = {
  id: 'proj-factory',
  name: 'My Factory Project',
  pipelineId: 'pipe-test',
  factory_config: { enabled: true },
  local_path: '/tmp/proj-factory',
  image_id: null,
  roles: [],
  spec_files: {},
};

// Project with factory mode off — should trigger empty state
const REGULAR_PROJECT = {
  id: 'proj-regular',
  name: 'Regular Project',
  factory_config: { enabled: false },
  local_path: '/tmp/proj-regular',
  image_id: null,
  roles: [],
  spec_files: {},
};

function setupApiMocks() {
  global.window.api = {
    factoryTasks: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      add: vi.fn().mockResolvedValue({
        id: 'task-new',
        title: 'My New Task',
        description: '',
        column: 'backlog',
        projectId: 'proj-factory',
        bounceCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      move: vi.fn().mockResolvedValue({}),
      remove: vi.fn().mockResolvedValue(true),
      update: vi.fn().mockResolvedValue({}),
      sync: vi.fn().mockResolvedValue([]),
      onChanged: vi.fn(() => vi.fn()),
    },
    pipelines: {
      get: vi.fn().mockResolvedValue(MOCK_PIPELINE),
      onChanged: vi.fn(() => vi.fn()),
    },
  } as any;
}

describe('FactoryTab', () => {
  beforeEach(() => {
    setupApiMocks();
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({
      projects: [],
      projectsLoading: false,
      projectsError: null,
      loops: [],
      loopsLoading: false,
      loopsError: null,
      factoryTasks: {},
      factoryTasksLoading: false,
    });
  });

  // 10.33 — smoke test: renders without crashing
  it('renders without crashing with a factory-enabled project', async () => {
    useAppStore.setState({ projects: [FACTORY_PROJECT] });
    render(<FactoryTab />);

    await waitFor(() => {
      expect(screen.getByText('My Factory Project')).toBeInTheDocument();
    });
  });

  // 10.34 — kanban board renders dynamic pipeline columns
  it('renders pipeline columns from the active pipeline', async () => {
    useAppStore.setState({ projects: [FACTORY_PROJECT] });
    render(<FactoryTab />);

    // MOCK_PIPELINE has stages [Coder, QA] plus implicit Backlog/Done/Blocked
    const expectedLabels = ['Backlog', 'Coder', 'QA', 'Done', 'Blocked'];

    await waitFor(() => {
      for (const label of expectedLabels) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
    });
  });

  // 10.35 — Add to Backlog form submits correctly
  it('calls factoryTasks.add when the Add to Backlog form is submitted', async () => {
    useAppStore.setState({ projects: [FACTORY_PROJECT] });
    render(<FactoryTab />);

    // Wait for auto-selected project to render the add-task form
    const titleInput = await screen.findByPlaceholderText('Task title (required)');

    fireEvent.change(titleInput, { target: { value: 'My New Task' } });

    const submitButton = screen.getByRole('button', { name: /add to backlog/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(window.api.factoryTasks.add).toHaveBeenCalledWith(
        'proj-factory',
        'My New Task',
        ''
      );
    });
  });

  // 10.36 — empty state when no factory projects exist
  it('shows empty state when projects exist but none have factory mode enabled', async () => {
    useAppStore.setState({ projects: [REGULAR_PROJECT] });
    render(<FactoryTab />);

    await waitFor(() => {
      expect(screen.getByText('No Factory Projects')).toBeInTheDocument();
    });
  });
});
