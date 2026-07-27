/**
 * Tests for ProjectsTab component.
 *
 * Validates:
 * - Projects table rendering with correct data
 * - Empty state display when no projects exist
 * - Action buttons (Add, Edit, Delete) trigger callbacks
 * - Loading and error states
 * - Search filtering across name, repository, and docker image
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectsTab } from '../../src/renderer/pages/ProjectsTab/ProjectsTab';
import { createProjectConfig } from '../../src/shared/models';
import { useAppStore } from '../../src/renderer/stores/app-store';

// Mock the hooks
vi.mock('../../src/renderer/hooks/useProjects', () => ({
  useProjects: vi.fn(),
}));

import { useProjects } from '../../src/renderer/hooks/useProjects';

describe('ProjectsTab', () => {
  const mockRefresh = vi.fn();
  const mockAdd = vi.fn();
  const mockUpdate = vi.fn();
  const mockRemove = vi.fn();
  const mockGet = vi.fn();
  const mockToast = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();

    // Reset store state (multipassAvailable defaults to false, vmInfos to [])
    useAppStore.setState({ multipassAvailable: false, vmInfos: [] });

    // Set up window.api mock (must use global.window.api, never replace global.window)
    global.window.api = {
      projects: {
        remove: vi.fn().mockResolvedValue(undefined),
        add: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
      },
    } as any;

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

  describe('Action Buttons', () => {
    it('renders Edit and Delete buttons for each project', () => {
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

      expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Delete/i })).toBeInTheDocument();
    });
  });

  describe('Search', () => {
    const searchProjects = [
      createProjectConfig({
        name: 'Alpha Service',
        repo_url: 'https://github.com/user/alpha',
        docker_image: 'ubuntu:22.04',
      }),
      createProjectConfig({
        name: 'Beta Worker',
        repo_url: 'https://gitlab.com/user/beta',
        docker_image: 'alpine:latest',
      }),
    ];

    const mockWithProjects = () => {
      vi.mocked(useProjects).mockReturnValue({
        projects: searchProjects,
        loading: false,
        error: null,
        refresh: mockRefresh,
        add: mockAdd,
        update: mockUpdate,
        remove: mockRemove,
        get: mockGet,
      });
    };

    it('filters projects by name', async () => {
      const user = userEvent.setup();
      mockWithProjects();
      render(<ProjectsTab toast={mockToast} />);

      await user.type(screen.getByLabelText('Search projects'), 'alpha');

      expect(screen.getByText('Alpha Service')).toBeInTheDocument();
      expect(screen.queryByText('Beta Worker')).not.toBeInTheDocument();
    });

    it('matches repository url and docker image, case-insensitively', async () => {
      const user = userEvent.setup();
      mockWithProjects();
      render(<ProjectsTab toast={mockToast} />);

      const input = screen.getByLabelText('Search projects');

      await user.type(input, 'GITLAB');
      expect(screen.getByText('Beta Worker')).toBeInTheDocument();
      expect(screen.queryByText('Alpha Service')).not.toBeInTheDocument();

      await user.clear(input);
      await user.type(input, 'ubuntu');
      expect(screen.getByText('Alpha Service')).toBeInTheDocument();
      expect(screen.queryByText('Beta Worker')).not.toBeInTheDocument();
    });

    it('shows all projects when the query is blank', async () => {
      const user = userEvent.setup();
      mockWithProjects();
      render(<ProjectsTab toast={mockToast} />);

      await user.type(screen.getByLabelText('Search projects'), '   ');

      expect(screen.getByText('Alpha Service')).toBeInTheDocument();
      expect(screen.getByText('Beta Worker')).toBeInTheDocument();
    });

    it('shows a no-results message instead of the onboarding empty state', async () => {
      const user = userEvent.setup();
      mockWithProjects();
      render(<ProjectsTab toast={mockToast} />);

      await user.type(screen.getByLabelText('Search projects'), 'nonexistent');

      expect(screen.getByText(/No projects match/)).toBeInTheDocument();
      expect(screen.queryByText('No Projects Yet')).not.toBeInTheDocument();
    });

    it('restores the full list via the clear button', async () => {
      const user = userEvent.setup();
      mockWithProjects();
      render(<ProjectsTab toast={mockToast} />);

      await user.type(screen.getByLabelText('Search projects'), 'nonexistent');
      await user.click(screen.getByRole('button', { name: /Clear search/i }));

      expect(screen.getByText('Alpha Service')).toBeInTheDocument();
      expect(screen.getByText('Beta Worker')).toBeInTheDocument();
    });

    it('clears the query on Escape', async () => {
      const user = userEvent.setup();
      mockWithProjects();
      render(<ProjectsTab toast={mockToast} />);

      const input = screen.getByLabelText('Search projects');
      await user.type(input, 'alpha');
      expect(screen.queryByText('Beta Worker')).not.toBeInTheDocument();

      await user.type(input, '{Escape}');

      expect(input).toHaveValue('');
      expect(screen.getByText('Beta Worker')).toBeInTheDocument();
    });
  });

  describe('Lifecycle', () => {
    it('calls refresh on mount', async () => {
      render(<ProjectsTab toast={mockToast} />);

      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalledTimes(1);
      });
    });
  });
});
