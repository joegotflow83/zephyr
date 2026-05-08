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
