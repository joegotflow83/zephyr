/**
 * Tests for LoopsTab component.
 *
 * Validates:
 * - Loop table rendering with multiple loops
 * - Empty state when no loops exist
 * - Auto-selection of first running loop
 * - Row selection behavior
 * - Stop/Start action integration
 * - Resizable splitter functionality
 * - Log viewer panel shows selected loop's logs
 * - Integration with useLoops and useProjects hooks
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoopsTab } from '../../src/renderer/pages/LoopsTab/LoopsTab';
import { createProjectConfig } from '../../src/shared/models';
import { createLoopState, LoopStatus, LoopMode } from '../../src/shared/loop-types';

// Mock the hooks
const mockLoops = vi.hoisted(() => ({
  loops: [] as any[],
  loading: false,
  error: null,
  refresh: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
  get: vi.fn(),
  schedule: vi.fn(),
  cancelSchedule: vi.fn(),
  listScheduled: vi.fn(),
}));

const mockProjects = vi.hoisted(() => ({
  projects: [] as any[],
  loading: false,
  error: null,
  refresh: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  get: vi.fn(),
}));

vi.mock('../../src/renderer/hooks/useLoops', () => ({
  useLoops: () => mockLoops,
}));

vi.mock('../../src/renderer/hooks/useProjects', () => ({
  useProjects: () => mockProjects,
}));

describe('LoopsTab', () => {
  const project1 = createProjectConfig({
    name: 'Project One',
    repo_url: 'https://github.com/user/repo1',
    docker_image: 'ubuntu:22.04',
  });

  const project2 = createProjectConfig({
    name: 'Project Two',
    repo_url: 'https://github.com/user/repo2',
    docker_image: 'ubuntu:22.04',
  });

  const loop1 = {
    ...createLoopState(project1.id, LoopMode.CONTINUOUS),
    status: LoopStatus.RUNNING,
    iteration: 5,
    startedAt: '2026-02-18T10:00:00Z',
    logs: ['Log line 1', 'Log line 2', 'Log line 3'],
  };

  const loop2 = {
    ...createLoopState(project2.id, LoopMode.SINGLE),
    status: LoopStatus.COMPLETED,
    iteration: 1,
    startedAt: '2026-02-18T09:00:00Z',
    stoppedAt: '2026-02-18T09:30:00Z',
    logs: ['Other log line 1', 'Other log line 2'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoops.loops = [];
    mockLoops.loading = false;
    mockLoops.error = null;
    mockProjects.projects = [];
  });

  describe('Empty state', () => {
    it('displays message when no loops exist', () => {
      mockLoops.loops = [];
      mockProjects.projects = [];

      render(<LoopsTab />);

      expect(screen.getByText(/no active or recent loops/i)).toBeInTheDocument();
    });

    it('displays loading state', () => {
      mockLoops.loops = [];
      mockLoops.loading = true;

      render(<LoopsTab />);

      expect(screen.getByText(/loading loops/i)).toBeInTheDocument();
    });

    it('displays error state', () => {
      mockLoops.loops = [];
      mockLoops.error = 'Failed to load loops';

      render(<LoopsTab />);

      expect(screen.getByText(/error: failed to load loops/i)).toBeInTheDocument();
    });
  });

  describe('Loop table rendering', () => {
    it('renders table headers', () => {
      mockLoops.loops = [loop1];
      mockProjects.projects = [project1];

      render(<LoopsTab />);

      expect(screen.getByText('Project Name')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Mode')).toBeInTheDocument();
      expect(screen.getByText('Iteration')).toBeInTheDocument();
      expect(screen.getByText('Started')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('renders multiple loop rows', () => {
      mockLoops.loops = [loop1, loop2];
      mockProjects.projects = [project1, project2];

      render(<LoopsTab />);

      expect(screen.getByText('Project One')).toBeInTheDocument();
      expect(screen.getByText('Project Two')).toBeInTheDocument();
    });

    it('renders loop status badges', () => {
      mockLoops.loops = [loop1, loop2];
      mockProjects.projects = [project1, project2];

      render(<LoopsTab />);

      expect(screen.getByText('Running')).toBeInTheDocument();
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    it('renders loop modes', () => {
      mockLoops.loops = [loop1, loop2];
      mockProjects.projects = [project1, project2];

      render(<LoopsTab />);

      expect(screen.getByText('Continuous')).toBeInTheDocument();
      expect(screen.getByText('Single')).toBeInTheDocument();
    });

    it('renders iteration counts', () => {
      mockLoops.loops = [loop1, loop2];
      mockProjects.projects = [project1, project2];

      render(<LoopsTab />);

      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });

  describe('Auto-selection', () => {
    it('auto-selects first running loop on mount', () => {
      const stoppedLoop = { ...loop2, status: LoopStatus.STOPPED };
      mockLoops.loops = [stoppedLoop, loop1]; // loop1 is RUNNING
      mockProjects.projects = [project1, project2];

      render(<LoopsTab />);

      // Log viewer should show logs from loop1 (the running one)
      // Check for LogViewer component with 3 lines
      expect(screen.getByText('3 lines')).toBeInTheDocument();
      expect(screen.getByText('Logs: Project One')).toBeInTheDocument();
    });

    it('selects first loop if none are running', () => {
      const stoppedLoop1 = { ...loop1, status: LoopStatus.STOPPED };
      const stoppedLoop2 = { ...loop2, status: LoopStatus.STOPPED };
      mockLoops.loops = [stoppedLoop1, stoppedLoop2];
      mockProjects.projects = [project1, project2];

      render(<LoopsTab />);

      // Should select first loop by default
      // Check for LogViewer component with 3 lines (from loop1)
      expect(screen.getByText('3 lines')).toBeInTheDocument();
      expect(screen.getByText('Logs: Project One')).toBeInTheDocument();
    });

    it('updates selection when loops change and selected loop is removed', async () => {
      mockLoops.loops = [loop1];
      mockProjects.projects = [project1];

      const { rerender } = render(<LoopsTab />);

      // Initially shows loop1 logs (3 lines)
      expect(screen.getByText('3 lines')).toBeInTheDocument();

      // Simulate loop1 being removed and loop2 added
      mockLoops.loops = [loop2];
      mockProjects.projects = [project2];
      rerender(<LoopsTab />);

      // Should now show loop2 logs (2 lines)
      await waitFor(() => {
        expect(screen.getByText('2 lines')).toBeInTheDocument();
      });
    });
  });

  describe('Row selection', () => {
    it('allows manual selection of a loop row', async () => {
      const user = userEvent.setup();
      mockLoops.loops = [loop1, loop2];
      mockProjects.projects = [project1, project2];

      render(<LoopsTab />);

      // Initially shows loop1 (first running, 3 lines)
      expect(screen.getByText('3 lines')).toBeInTheDocument();
      expect(screen.getByText('Logs: Project One')).toBeInTheDocument();

      // Click on Project Two row
      await user.click(screen.getByText('Project Two'));

      // Should now show loop2 logs (2 lines)
      await waitFor(() => {
        expect(screen.getByText('2 lines')).toBeInTheDocument();
        expect(screen.getByText('Logs: Project Two')).toBeInTheDocument();
      });
    });
  });

  describe('Action buttons', () => {
    it('calls stop when Stop button is clicked', async () => {
      const user = userEvent.setup();
      mockLoops.loops = [loop1];
      mockProjects.projects = [project1];
      mockLoops.stop.mockResolvedValue(undefined);

      render(<LoopsTab />);

      await user.click(screen.getByText('Stop'));
      expect(mockLoops.stop).toHaveBeenCalledWith(project1.id, undefined);
    });

    it('calls start when Start button is clicked', async () => {
      const user = userEvent.setup();
      const stoppedLoop = { ...loop1, status: LoopStatus.STOPPED };
      mockLoops.loops = [stoppedLoop];
      mockProjects.projects = [project1];
      mockLoops.start.mockResolvedValue(stoppedLoop);

      render(<LoopsTab />);

      // Click Start to open the RunModeDialog, then confirm with default (continuous)
      await user.click(screen.getByText('Start'));
      await user.click(screen.getByRole('button', { name: /^Run$/ }));

      await waitFor(() => {
        expect(mockLoops.start).toHaveBeenCalledWith({
          projectId: project1.id,
          projectName: project1.name,
          mode: LoopMode.CONTINUOUS,
          dockerImage: project1.docker_image,
        });
      });
    });

    it('handles stop errors gracefully', async () => {
      const user = userEvent.setup();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockLoops.loops = [loop1];
      mockProjects.projects = [project1];
      mockLoops.stop.mockRejectedValue(new Error('Stop failed'));

      render(<LoopsTab />);

      await user.click(screen.getByText('Stop'));

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to stop loop:',
          expect.any(Error)
        );
      });

      consoleErrorSpy.mockRestore();
    });

    it('handles start errors gracefully', async () => {
      const user = userEvent.setup();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const stoppedLoop = { ...loop1, status: LoopStatus.STOPPED };
      mockLoops.loops = [stoppedLoop];
      mockProjects.projects = [project1];
      mockLoops.start.mockRejectedValue(new Error('Start failed'));

      render(<LoopsTab />);

      // Click Start to open the RunModeDialog, then confirm to trigger the start
      await user.click(screen.getByText('Start'));
      await user.click(screen.getByRole('button', { name: /^Run$/ }));

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to start loop:',
          expect.any(Error)
        );
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Log viewer panel', () => {
    it('displays logs for selected loop', () => {
      mockLoops.loops = [loop1];
      mockProjects.projects = [project1];

      render(<LoopsTab />);

      // LogViewer component shows the line count
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    it('displays project name in log viewer header', () => {
      mockLoops.loops = [loop1];
      mockProjects.projects = [project1];

      render(<LoopsTab />);

      expect(screen.getByText('Logs: Project One')).toBeInTheDocument();
    });

    it('displays message when selected loop has no logs', () => {
      const loopNoLogs = { ...loop1, logs: [] };
      mockLoops.loops = [loopNoLogs];
      mockProjects.projects = [project1];

      render(<LoopsTab />);

      expect(screen.getByText(/no logs yet/i)).toBeInTheDocument();
    });

    it('displays message when no loop is selected', () => {
      mockLoops.loops = [];
      mockProjects.projects = [];

      render(<LoopsTab />);

      expect(screen.getByText(/select a loop to view logs/i)).toBeInTheDocument();
    });
  });

  describe('Resizable splitter', () => {
    it('renders splitter element', () => {
      mockLoops.loops = [loop1];
      mockProjects.projects = [project1];

      const { container } = render(<LoopsTab />);

      const splitter = container.querySelector('.cursor-row-resize');
      expect(splitter).toBeInTheDocument();
    });

    it('applies hover styles to splitter', () => {
      mockLoops.loops = [loop1];
      mockProjects.projects = [project1];

      const { container } = render(<LoopsTab />);

      const splitter = container.querySelector('.cursor-row-resize');
      expect(splitter).toHaveClass('dark:hover:bg-blue-600');
    });
  });
});
