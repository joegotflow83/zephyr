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
import type { VMInfo } from '../../src/services/vm-manager';

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
              onRun={mockOnRun}
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
              onRun={mockOnRun}
            />
          </tbody>
        </table>
      );

      expect(screen.queryByRole('button', { name: /Start VM/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Stop VM/i })).not.toBeInTheDocument();
    });

    it('shows VM Running badge when VM is running', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={persistentVMProject}
              vmInfo={runningVMInfo}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
              onStartVM={mockOnStartVM}
              onStopVM={mockOnStopVM}
            />
          </tbody>
        </table>
      );

      // VM status badge showing "Running"
      const badges = screen.getAllByText('Running');
      expect(badges.length).toBeGreaterThan(0);
    });

    it('shows VM Stopped badge when VM is stopped', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={persistentVMProject}
              vmInfo={stoppedVMInfo}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
              onStartVM={mockOnStartVM}
              onStopVM={mockOnStopVM}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });

    it('disables Run button when VM is stopped', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={persistentVMProject}
              vmInfo={stoppedVMInfo}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
              onStartVM={mockOnStartVM}
              onStopVM={mockOnStopVM}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Run/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Run/i })).toHaveAttribute('title', 'Start the VM first');
    });

    it('enables Run button when VM is running', () => {
      render(
        <table>
          <tbody>
            <ProjectRow
              project={persistentVMProject}
              vmInfo={runningVMInfo}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
              onStartVM={mockOnStartVM}
              onStopVM={mockOnStopVM}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Run/i })).not.toBeDisabled();
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
              onRun={mockOnRun}
              onStartVM={mockOnStartVM}
              onStopVM={mockOnStopVM}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Start VM/i })).toBeDisabled();
    });

    it('disables Stop VM button when loop is actively running', () => {
      const loop: LoopState = {
        ...createLoopState(persistentVMProject.id, LoopMode.CONTINUOUS),
        status: LoopStatus.RUNNING,
      };

      render(
        <table>
          <tbody>
            <ProjectRow
              project={persistentVMProject}
              loop={loop}
              vmInfo={runningVMInfo}
              onEdit={mockOnEdit}
              onDelete={mockOnDelete}
              onRun={mockOnRun}
              onStartVM={mockOnStartVM}
              onStopVM={mockOnStopVM}
            />
          </tbody>
        </table>
      );

      expect(screen.getByRole('button', { name: /Stop VM/i })).toBeDisabled();
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
              onRun={mockOnRun}
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
              onRun={mockOnRun}
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
              onRun={mockOnRun}
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
              onRun={mockOnRun}
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
