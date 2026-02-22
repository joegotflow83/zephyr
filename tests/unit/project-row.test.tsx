/**
 * Tests for ProjectRow component.
 *
 * Validates:
 * - Project data rendering
 * - Status badges for different loop states
 * - Action button callbacks
 * - Button enabled/disabled states based on loop status
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectRow } from '../../src/renderer/pages/ProjectsTab/ProjectRow';
import { createProjectConfig } from '../../src/shared/models';
import { createLoopState, LoopStatus, LoopMode } from '../../src/shared/loop-types';

describe('ProjectRow', () => {
  const mockOnEdit = vi.fn();
  const mockOnDelete = vi.fn();
  const mockOnRun = vi.fn();

  const defaultProject = createProjectConfig({
    name: 'Test Project',
    repo_url: 'https://github.com/user/repo',
    docker_image: 'ubuntu:22.04',
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('displays project name', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });

    it('displays repository URL', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('https://github.com/user/repo')).toBeInTheDocument();
    });

    it('displays docker image', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('ubuntu:22.04')).toBeInTheDocument();
    });

    it('truncates long URLs with title attribute', () => {
      const projectWithLongUrl = createProjectConfig({
        ...defaultProject,
        repo_url: 'https://github.com/very-long-username/very-long-repository-name-that-exceeds-normal-length',
      });

      const { container } = render(
        <table>
          <tbody>
            <ProjectRow
              project={projectWithLongUrl}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      const urlCell = container.querySelector('td[title*="github.com"]');
      expect(urlCell).toHaveAttribute('title', projectWithLongUrl.repo_url);
    });
  });

  describe('Status Badges', () => {
    it('shows Idle badge when no loop provided', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Idle')).toBeInTheDocument();
    });

    it('shows Idle badge when loop is in terminal state', () => {
      const loop: LoopState = {
        ...createLoopState(defaultProject.id, LoopMode.SINGLE),
        status: LoopStatus.STOPPED,
      };

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              loop={loop}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Idle')).toBeInTheDocument();
    });

    it('shows Starting badge when loop is starting', () => {
      const loop: LoopState = {
        ...createLoopState(defaultProject.id, LoopMode.CONTINUOUS),
        status: LoopStatus.STARTING,
      };

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              loop={loop}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Starting')).toBeInTheDocument();
    });

    it('shows Running badge when loop is running', () => {
      const loop: LoopState = {
        ...createLoopState(defaultProject.id, LoopMode.CONTINUOUS),
        status: LoopStatus.RUNNING,
      };

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              loop={loop}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('shows Paused badge when loop is paused', () => {
      const loop: LoopState = {
        ...createLoopState(defaultProject.id, LoopMode.CONTINUOUS),
        status: LoopStatus.PAUSED,
      };

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              loop={loop}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Paused')).toBeInTheDocument();
    });

    it('shows Stopping badge when loop is stopping', () => {
      const loop: LoopState = {
        ...createLoopState(defaultProject.id, LoopMode.CONTINUOUS),
        status: LoopStatus.STOPPING,
      };

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              loop={loop}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Stopping')).toBeInTheDocument();
    });
  });

  describe('Action Buttons', () => {
    it('renders all action buttons', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Run/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Delete/i })).toBeInTheDocument();
    });

    it('calls onRun when Run button is clicked', async () => {
      const user = userEvent.setup();

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      const runButton = screen.getByRole('button', { name: /Run/i });
      await user.click(runButton);

      expect(mockOnRun).toHaveBeenCalledWith(defaultProject);
      expect(mockOnRun).toHaveBeenCalledTimes(1);
    });

    it('calls onEdit when Edit button is clicked', async () => {
      const user = userEvent.setup();

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      const editButton = screen.getByRole('button', { name: /Edit/i });
      await user.click(editButton);

      expect(mockOnEdit).toHaveBeenCalledWith(defaultProject);
      expect(mockOnEdit).toHaveBeenCalledTimes(1);
    });

    it('calls onDelete when Delete button is clicked', async () => {
      const user = userEvent.setup();

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      const deleteButton = screen.getByRole('button', { name: /Delete/i });
      await user.click(deleteButton);

      expect(mockOnDelete).toHaveBeenCalledWith(defaultProject);
      expect(mockOnDelete).toHaveBeenCalledTimes(1);
    });

    it('disables Run button when loop is starting', () => {
      const loop: LoopState = {
        ...createLoopState(defaultProject.id, LoopMode.SINGLE),
        status: LoopStatus.STARTING,
      };

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              loop={loop}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Run/i })).toBeDisabled();
    });

    it('disables Run button when loop is running', () => {
      const loop: LoopState = {
        ...createLoopState(defaultProject.id, LoopMode.CONTINUOUS),
        status: LoopStatus.RUNNING,
      };

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              loop={loop}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Run/i })).toBeDisabled();
    });

    it('disables Run button when loop is paused', () => {
      const loop: LoopState = {
        ...createLoopState(defaultProject.id, LoopMode.CONTINUOUS),
        status: LoopStatus.PAUSED,
      };

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              loop={loop}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Run/i })).toBeDisabled();
    });

    it('disables Run button when loop is stopping', () => {
      const loop: LoopState = {
        ...createLoopState(defaultProject.id, LoopMode.CONTINUOUS),
        status: LoopStatus.STOPPING,
      };

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              loop={loop}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Run/i })).toBeDisabled();
    });

    it('enables Run button when loop is stopped', () => {
      const loop: LoopState = {
        ...createLoopState(defaultProject.id, LoopMode.SINGLE),
        status: LoopStatus.STOPPED,
      };

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              loop={loop}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Run/i })).not.toBeDisabled();
    });

    it('enables Run button when loop is completed', () => {
      const loop: LoopState = {
        ...createLoopState(defaultProject.id, LoopMode.SINGLE),
        status: LoopStatus.COMPLETED,
      };

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              loop={loop}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Run/i })).not.toBeDisabled();
    });

    it('enables Run button when loop is failed', () => {
      const loop: LoopState = {
        ...createLoopState(defaultProject.id, LoopMode.SINGLE),
        status: LoopStatus.FAILED,
      };

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              loop={loop}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Run/i })).not.toBeDisabled();
    });
  });

  describe('Accessibility', () => {
    it('has appropriate button titles', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Run/i })).toHaveAttribute('title', 'Run this project');
      expect(screen.getByRole('button', { name: /Edit/i })).toHaveAttribute('title', 'Edit project');
      expect(screen.getByRole('button', { name: /Delete/i })).toHaveAttribute('title', 'Delete project');
    });

    it('shows disabled tooltip when project is running', () => {
      const loop: LoopState = {
        ...createLoopState(defaultProject.id, LoopMode.CONTINUOUS),
        status: LoopStatus.RUNNING,
      };

      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              loop={loop}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Run/i })).toHaveAttribute('title', 'Already running');
    });
  });
});
