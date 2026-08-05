/**
 * Tests for ProjectRow component.
 *
 * Validates:
 * - Project data rendering
 * - Action button callbacks
 * - VM Start/Stop button states and callbacks
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectRow } from '../../src/renderer/pages/ProjectsTab/ProjectRow';
import { createProjectConfig } from '../../src/shared/models';
import type { VMInfo } from '../../src/services/vm-manager';

describe('ProjectRow', () => {
  const mockOnEdit = vi.fn();
  const mockOnDelete = vi.fn();

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
            />
          </tbody>
        </table>
      );

      const urlCell = container.querySelector('td[title*="github.com"]');
      expect(urlCell).toHaveAttribute('title', projectWithLongUrl.repo_url);
    });
  });

  describe('Action Buttons', () => {
    it('renders Edit and Delete buttons', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Delete/i })).toBeInTheDocument();
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
            />
          </tbody>
        </table>
      );

      const deleteButton = screen.getByRole('button', { name: /Delete/i });
      await user.click(deleteButton);

      expect(mockOnDelete).toHaveBeenCalledWith(defaultProject);
      expect(mockOnDelete).toHaveBeenCalledTimes(1);
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
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Edit/i })).toHaveAttribute('title', 'Edit project');
      expect(screen.getByRole('button', { name: /Delete/i })).toHaveAttribute('title', 'Delete project');
    });
  });

  describe('Agent Session Buttons (Plan / Work)', () => {
    const mockOnPlan = vi.fn();
    const mockOnWork = vi.fn();

    // Agent sessions need a directory to mount and an image to run.
    const sessionReadyProject = createProjectConfig({
      name: 'Session Project',
      repo_url: 'https://github.com/user/repo',
      docker_image: 'ubuntu:22.04',
      local_path: '/home/user/code/repo',
    });

    it('does not render the Work button without an onWork handler', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={sessionReadyProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
            />
          </tbody>
        </table>
      );

      expect(screen.queryByRole('button', { name: /Work/i })).not.toBeInTheDocument();
    });

    it('enables the Work button when the project has a local path and image', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={sessionReadyProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onPlan={mockOnPlan}
              onWork={mockOnWork}
            />
          </tbody>
        </table>
      );

      const workButton = screen.getByRole('button', { name: /Work/i });
      expect(workButton).toBeEnabled();
      expect(workButton).toHaveAttribute(
        'title',
        'Chat with the configured LLM engine to change files in this project'
      );
    });

    it('calls onWork with the project when clicked', async () => {
      const user = userEvent.setup();

      render(
        <table>
          <tbody>
            <ProjectRow
              project={sessionReadyProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onWork={mockOnWork}
            />
          </tbody>
        </table>
      );

      await user.click(screen.getByRole('button', { name: /Work/i }));

      expect(mockOnWork).toHaveBeenCalledWith(sessionReadyProject);
      expect(mockOnWork).toHaveBeenCalledTimes(1);
    });

    it('disables the Work button when the project has no local path', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onWork={mockOnWork}
            />
          </tbody>
        </table>
      );

      const workButton = screen.getByRole('button', { name: /Work/i });
      expect(workButton).toBeDisabled();
      expect(workButton).toHaveAttribute(
        'title',
        'Requires a local path and a container image on this project'
      );
    });

    it('disables the Work button while a loop is running for the project', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={sessionReadyProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onPlan={mockOnPlan}
              onWork={mockOnWork}
              hasRunningLoop={true}
            />
          </tbody>
        </table>
      );

      const workButton = screen.getByRole('button', { name: /Work/i });
      expect(workButton).toBeDisabled();
      expect(workButton).toHaveAttribute(
        'title',
        'A loop is running for this project — stop it before starting a work session'
      );

      // Planning does not touch the working tree, so a live loop must not block it.
      expect(screen.getByRole('button', { name: /Plan/i })).toBeEnabled();
    });
  });

  describe('VM Controls (persistent VM projects)', () => {
    const persistentVMProject = createProjectConfig({
      name: 'VM Project',
      repo_url: 'https://github.com/user/repo',
      docker_image: 'ubuntu:22.04',
      sandbox_type: 'vm',
      vm_config: {
        vm_mode: 'persistent',
        cpus: 2,
        memory_gb: 4,
        disk_gb: 20,
      },
    });

    const runningVMInfo: VMInfo = {
      name: 'zephyr-test1234-abc1',
      state: 'Running',
      cpus: 2,
      memory: '4G',
      disk: '20G',
      release: '22.04',
    };

    const stoppedVMInfo: VMInfo = {
      ...runningVMInfo,
      state: 'Stopped',
    };

    const mockOnStartVM = vi.fn();
    const mockOnStopVM = vi.fn();

    it('shows Start VM and Stop VM buttons for persistent VM projects', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={persistentVMProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onStartVM={mockOnStartVM}
              onStopVM={mockOnStopVM}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Start VM/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Stop VM/i })).toBeInTheDocument();
    });

    it('does not show VM buttons for container projects', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={defaultProject}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
            />
          </tbody>
        </table>
      );

      expect(screen.queryByRole('button', { name: /Start VM/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Stop VM/i })).not.toBeInTheDocument();
    });

    it('disables Start VM button when VM is already running', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={persistentVMProject}
              vmInfo={runningVMInfo}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onStartVM={mockOnStartVM}
              onStopVM={mockOnStopVM}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Start VM/i })).toBeDisabled();
    });

    it('calls onStartVM when Start VM button is clicked', async () => {
      const user = userEvent.setup();

      render(
        <table>
          <tbody>
            <ProjectRow
              project={persistentVMProject}
              vmInfo={stoppedVMInfo}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onStartVM={mockOnStartVM}
              onStopVM={mockOnStopVM}
            />
          </tbody>
        </table>
      );

      const startVMButton = screen.getByRole('button', { name: /Start VM/i });
      await user.click(startVMButton);

      expect(mockOnStartVM).toHaveBeenCalledWith(persistentVMProject);
      expect(mockOnStartVM).toHaveBeenCalledTimes(1);
    });

    it('calls onStopVM when Stop VM button is clicked', async () => {
      const user = userEvent.setup();

      render(
        <table>
          <tbody>
            <ProjectRow
              project={persistentVMProject}
              vmInfo={runningVMInfo}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onStartVM={mockOnStartVM}
              onStopVM={mockOnStopVM}
            />
          </tbody>
        </table>
      );

      const stopVMButton = screen.getByRole('button', { name: /Stop VM/i });
      await user.click(stopVMButton);

      expect(mockOnStopVM).toHaveBeenCalledWith(persistentVMProject);
      expect(mockOnStopVM).toHaveBeenCalledTimes(1);
    });

    it('shows Starting... text when VM is starting', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={persistentVMProject}
              vmInfo={stoppedVMInfo}
              isStartingVM={true}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onStartVM={mockOnStartVM}
              onStopVM={mockOnStopVM}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Starting...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Starting/i })).toBeDisabled();
    });

    it('shows Stopping... text when VM is stopping', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={persistentVMProject}
              vmInfo={runningVMInfo}
              isStoppingVM={true}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onStartVM={mockOnStartVM}
              onStopVM={mockOnStopVM}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Stopping...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Stopping/i })).toBeDisabled();
    });
  });
});
