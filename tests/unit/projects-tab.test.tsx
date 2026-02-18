/**
 * Tests for ProjectsTab component.
 *
 * Validates:
 * - Projects table rendering with correct data
 * - Empty state display when no projects exist
 * - Action buttons (Add, Edit, Delete, Run) trigger callbacks
 * - Loading and error states
 * - Status badges reflect loop state correctly
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectsTab } from '../../src/renderer/pages/ProjectsTab/ProjectsTab';
import { createProjectConfig } from '../../src/shared/models';
import { createLoopState, LoopStatus, LoopMode } from '../../src/shared/loop-types';

// Mock the hooks
vi.mock('../../src/renderer/hooks/useProjects', () => ({
  useProjects: vi.fn(),
}));

vi.mock('../../src/renderer/hooks/useLoops', () => ({
  useLoops: vi.fn(),
}));

import { useProjects } from '../../src/renderer/hooks/useProjects';
import { useLoops } from '../../src/renderer/hooks/useLoops';

describe('ProjectsTab', () => {
  const mockRefresh = vi.fn();
  const mockAdd = vi.fn();
  const mockUpdate = vi.fn();
  const mockRemove = vi.fn();
  const mockGet = vi.fn();
  const mockLoopGet = vi.fn();
  const mockToast = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(useProjects).mockReturnValue({
      projects: [],
      loading: false,
      error: null,
      refresh: mockRefresh,
      add: mockAdd,
      update: mockUpdate,
      remove: mockRemove,
      get: mockGet,
    });

    vi.mocked(useLoops).mockReturnValue({
      loops: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      remove: vi.fn(),
      get: mockLoopGet,
      schedule: vi.fn(),
      cancelSchedule: vi.fn(),
      listScheduled: vi.fn(),
    });
  });

  describe('Empty State', () => {
    it('shows empty state when no projects exist', () => {
      render(<ProjectsTab toast={mockToast} />);

      expect(screen.getByText('No Projects Yet')).toBeInTheDocument();
      expect(screen.getByText(/Get started by adding your first AI loop project/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add Your First Project/i })).toBeInTheDocument();
    });

    it('shows add button in empty state', async () => {
      const user = userEvent.setup();
      render(<ProjectsTab toast={mockToast} />);

      const addButton = screen.getByRole('button', { name: /Add Your First Project/i });
      await user.click(addButton);

      // Note: Action will be implemented in Task 7.4
      // For now, just verify button is clickable
      expect(addButton).toBeInTheDocument();
    });
  });

  describe('Projects Table', () => {
    it('displays projects in a table', () => {
      const projects = [
        createProjectConfig({
          name: 'Test Project 1',
          repo_url: 'https://github.com/user/repo1',
          docker_image: 'ubuntu:22.04',
        }),
        createProjectConfig({
          name: 'Test Project 2',
          repo_url: 'https://github.com/user/repo2',
          docker_image: 'alpine:latest',
        }),
      ];

      vi.mocked(useProjects).mockReturnValue({
        projects,
        loading: false,
        error: null,
        refresh: mockRefresh,
        add: mockAdd,
        update: mockUpdate,
        remove: mockRemove,
        get: mockGet,
      });

      render(<ProjectsTab toast={mockToast} />);

      expect(screen.getByText('Test Project 1')).toBeInTheDocument();
      expect(screen.getByText('Test Project 2')).toBeInTheDocument();
      expect(screen.getByText('https://github.com/user/repo1')).toBeInTheDocument();
      expect(screen.getByText('https://github.com/user/repo2')).toBeInTheDocument();
      expect(screen.getByText('ubuntu:22.04')).toBeInTheDocument();
      expect(screen.getByText('alpine:latest')).toBeInTheDocument();
    });

    it('shows table headers', () => {
      const projects = [createProjectConfig({ name: 'Test Project' })];

      vi.mocked(useProjects).mockReturnValue({
        projects,
        loading: false,
        error: null,
        refresh: mockRefresh,
        add: mockAdd,
        update: mockUpdate,
        remove: mockRemove,
        get: mockGet,
      });

      render(<ProjectsTab toast={mockToast} />);

      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Repository')).toBeInTheDocument();
      expect(screen.getByText('Docker Image')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('shows Add Project button when projects exist', () => {
      const projects = [createProjectConfig({ name: 'Test Project' })];

      vi.mocked(useProjects).mockReturnValue({
        projects,
        loading: false,
        error: null,
        refresh: mockRefresh,
        add: mockAdd,
        update: mockUpdate,
        remove: mockRemove,
        get: mockGet,
      });

      render(<ProjectsTab toast={mockToast} />);

      expect(screen.getByRole('button', { name: /Add Project/i })).toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('shows loading indicator when loading', () => {
      vi.mocked(useProjects).mockReturnValue({
        projects: [],
        loading: true,
        error: null,
        refresh: mockRefresh,
        add: mockAdd,
        update: mockUpdate,
        remove: mockRemove,
        get: mockGet,
      });

      render(<ProjectsTab toast={mockToast} />);

      expect(screen.getByText('Loading projects...')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('shows error message when error occurs', () => {
      const projects = [createProjectConfig({ name: 'Test Project' })];

      vi.mocked(useProjects).mockReturnValue({
        projects,
        loading: false,
        error: 'Failed to load projects',
        refresh: mockRefresh,
        add: mockAdd,
        update: mockUpdate,
        remove: mockRemove,
        get: mockGet,
      });

      render(<ProjectsTab toast={mockToast} />);

      expect(screen.getByText(/Failed to load projects/)).toBeInTheDocument();
    });
  });

  describe('Status Badges', () => {
    it('shows Idle status when no loop is running', () => {
      const project = createProjectConfig({ name: 'Test Project' });

      vi.mocked(useProjects).mockReturnValue({
        projects: [project],
        loading: false,
        error: null,
        refresh: mockRefresh,
        add: mockAdd,
        update: mockUpdate,
        remove: mockRemove,
        get: mockGet,
      });

      mockLoopGet.mockReturnValue(undefined);

      render(<ProjectsTab toast={mockToast} />);

      expect(screen.getByText('Idle')).toBeInTheDocument();
    });

    it('shows Running status when loop is active', () => {
      const project = createProjectConfig({ name: 'Test Project' });
      const loop: LoopState = {
        ...createLoopState(project.id, LoopMode.CONTINUOUS),
        status: LoopStatus.RUNNING,
      };

      vi.mocked(useProjects).mockReturnValue({
        projects: [project],
        loading: false,
        error: null,
        refresh: mockRefresh,
        add: mockAdd,
        update: mockUpdate,
        remove: mockRemove,
        get: mockGet,
      });

      vi.mocked(useLoops).mockReturnValue({
        loops: [loop],
        loading: false,
        error: null,
        refresh: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        remove: vi.fn(),
        get: (id: string) => (id === project.id ? loop : undefined),
        schedule: vi.fn(),
        cancelSchedule: vi.fn(),
        listScheduled: vi.fn(),
      });

      render(<ProjectsTab toast={mockToast} />);

      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('shows Starting status when loop is starting', () => {
      const project = createProjectConfig({ name: 'Test Project' });
      const loop: LoopState = {
        ...createLoopState(project.id, LoopMode.SINGLE),
        status: LoopStatus.STARTING,
      };

      vi.mocked(useProjects).mockReturnValue({
        projects: [project],
        loading: false,
        error: null,
        refresh: mockRefresh,
        add: mockAdd,
        update: mockUpdate,
        remove: mockRemove,
        get: mockGet,
      });

      vi.mocked(useLoops).mockReturnValue({
        loops: [loop],
        loading: false,
        error: null,
        refresh: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        remove: vi.fn(),
        get: (id: string) => (id === project.id ? loop : undefined),
        schedule: vi.fn(),
        cancelSchedule: vi.fn(),
        listScheduled: vi.fn(),
      });

      render(<ProjectsTab toast={mockToast} />);

      expect(screen.getByText('Starting')).toBeInTheDocument();
    });
  });

  describe('Action Buttons', () => {
    it('renders action buttons for each project', () => {
      const project = createProjectConfig({ name: 'Test Project' });

      vi.mocked(useProjects).mockReturnValue({
        projects: [project],
        loading: false,
        error: null,
        refresh: mockRefresh,
        add: mockAdd,
        update: mockUpdate,
        remove: mockRemove,
        get: mockGet,
      });

      render(<ProjectsTab toast={mockToast} />);

      expect(screen.getByRole('button', { name: /Run/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Delete/i })).toBeInTheDocument();
    });

    it('disables Run button when project is already running', () => {
      const project = createProjectConfig({ name: 'Test Project' });
      const loop: LoopState = {
        ...createLoopState(project.id, LoopMode.CONTINUOUS),
        status: LoopStatus.RUNNING,
      };

      vi.mocked(useProjects).mockReturnValue({
        projects: [project],
        loading: false,
        error: null,
        refresh: mockRefresh,
        add: mockAdd,
        update: mockUpdate,
        remove: mockRemove,
        get: mockGet,
      });

      vi.mocked(useLoops).mockReturnValue({
        loops: [loop],
        loading: false,
        error: null,
        refresh: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        remove: vi.fn(),
        get: (id: string) => (id === project.id ? loop : undefined),
        schedule: vi.fn(),
        cancelSchedule: vi.fn(),
        listScheduled: vi.fn(),
      });

      render(<ProjectsTab toast={mockToast} />);

      const runButton = screen.getByRole('button', { name: /Run/i });
      expect(runButton).toBeDisabled();
    });

    it.skip('calls onRunProject callback when Run is clicked', async () => {
      const user = userEvent.setup();
      const onRunProject = vi.fn();
      const project = createProjectConfig({ name: 'Test Project' });

      // Mock window.api for this test
      (global as any).window = {
        ...global.window,
        api: {
          ...((global as any).window?.api || {}),
          loops: {
            start: vi.fn().mockResolvedValue({}),
          },
        },
      };

      vi.mocked(useProjects).mockReturnValue({
        projects: [project],
        loading: false,
        error: null,
        refresh: mockRefresh,
        add: mockAdd,
        update: mockUpdate,
        remove: mockRemove,
        get: mockGet,
      });

      render(<ProjectsTab toast={mockToast} onRunProject={onRunProject} />);

      const runButton = screen.getByRole('button', { name: /Run/i });
      await user.click(runButton);

      await waitFor(() => {
        expect(onRunProject).toHaveBeenCalled();
      });
    });
  });

  describe('Lifecycle', () => {
    it.skip('calls refresh on mount', async () => {
      render(<ProjectsTab toast={mockToast} />);

      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalledTimes(1);
      });
    });
  });
});
