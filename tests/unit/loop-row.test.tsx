/**
 * Tests for LoopRow component.
 *
 * Validates:
 * - Loop data rendering (project name, status, mode, iteration, timestamp)
 * - Status badges with correct colors for all states
 * - Action button callbacks (stop, start)
 * - Button enabled/disabled states based on loop status
 * - Row selection behavior
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoopRow } from '../../src/renderer/pages/LoopsTab/LoopRow';
import { createProjectConfig } from '../../src/shared/models';
import { createLoopState, LoopStatus, LoopMode } from '../../src/shared/loop-types';

describe('LoopRow', () => {
  const mockOnSelect = vi.fn();
  const mockOnStop = vi.fn();
  const mockOnStart = vi.fn();

  const defaultProject = createProjectConfig({
    name: 'Test Project',
    repo_url: 'https://github.com/user/repo',
    docker_image: 'ubuntu:22.04',
  });

  const defaultLoop = {
    ...createLoopState(defaultProject.id, LoopMode.CONTINUOUS),
    iteration: 3,
    startedAt: '2026-02-18T10:30:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('displays project name when project is provided', () => {
      render(
        <table>
          <tbody>
            <LoopRow
              loop={defaultLoop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });

    it('displays projectId when project is not provided', () => {
      const loop = { ...defaultLoop, projectId: 'abc-123' };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('abc-123')).toBeInTheDocument();
    });

    it('displays mode as readable label', () => {
      render(
        <table>
          <tbody>
            <LoopRow
              loop={{ ...defaultLoop, mode: LoopMode.CONTINUOUS }}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Continuous')).toBeInTheDocument();
    });

    it('displays iteration count', () => {
      render(
        <table>
          <tbody>
            <LoopRow
              loop={{ ...defaultLoop, iteration: 5 }}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('displays formatted start time when startedAt is provided', () => {
      render(
        <table>
          <tbody>
            <LoopRow
              loop={defaultLoop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      // Should contain some date/time string (format depends on locale)
      const startedCell = screen.getByText(/202/); // Contains year
      expect(startedCell).toBeInTheDocument();
    });

    it('displays dash when startedAt is null', () => {
      const loop = { ...defaultLoop, startedAt: null };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('-')).toBeInTheDocument();
    });
  });

  describe('Status badges', () => {
    it('displays green badge for RUNNING status', () => {
      const loop = { ...defaultLoop, status: LoopStatus.RUNNING };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      const badge = screen.getByText('Running');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('bg-green-900', 'text-green-300');
    });

    it('displays blue badge for STARTING status', () => {
      const loop = { ...defaultLoop, status: LoopStatus.STARTING };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      const badge = screen.getByText('Starting');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('bg-blue-900', 'text-blue-300');
    });

    it('displays yellow badge for STOPPING status', () => {
      const loop = { ...defaultLoop, status: LoopStatus.STOPPING };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      const badge = screen.getByText('Stopping');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('bg-yellow-900', 'text-yellow-300');
    });

    it('displays red badge for FAILED status', () => {
      const loop = { ...defaultLoop, status: LoopStatus.FAILED };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      const badge = screen.getByText('Failed');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('bg-red-900', 'text-red-300');
    });

    it('displays gray badge for COMPLETED status', () => {
      const loop = { ...defaultLoop, status: LoopStatus.COMPLETED };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      const badge = screen.getByText('Completed');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('dark:bg-gray-700', 'dark:text-gray-300');
    });

    it('displays gray badge for STOPPED status', () => {
      const loop = { ...defaultLoop, status: LoopStatus.STOPPED };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      const badge = screen.getByText('Stopped');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('dark:bg-gray-700', 'dark:text-gray-300');
    });

    it('displays yellow badge for PAUSED status', () => {
      const loop = { ...defaultLoop, status: LoopStatus.PAUSED };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      const badge = screen.getByText('Paused');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('bg-yellow-900', 'text-yellow-300');
    });
  });

  describe('Action buttons', () => {
    it('shows Stop button when loop is RUNNING', () => {
      const loop = { ...defaultLoop, status: LoopStatus.RUNNING };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Stop')).toBeInTheDocument();
      expect(screen.queryByText('Start')).not.toBeInTheDocument();
    });

    it('shows Stop button when loop is STARTING', () => {
      const loop = { ...defaultLoop, status: LoopStatus.STARTING };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Stop')).toBeInTheDocument();
      expect(screen.queryByText('Start')).not.toBeInTheDocument();
    });

    it('shows Stop button when loop is PAUSED', () => {
      const loop = { ...defaultLoop, status: LoopStatus.PAUSED };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Stop')).toBeInTheDocument();
      expect(screen.queryByText('Start')).not.toBeInTheDocument();
    });

    it('shows Start button when loop is STOPPED', () => {
      const loop = { ...defaultLoop, status: LoopStatus.STOPPED };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Start')).toBeInTheDocument();
      expect(screen.queryByText('Stop')).not.toBeInTheDocument();
    });

    it('shows Start button when loop is FAILED', () => {
      const loop = { ...defaultLoop, status: LoopStatus.FAILED };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Start')).toBeInTheDocument();
      expect(screen.queryByText('Stop')).not.toBeInTheDocument();
    });

    it('shows Start button when loop is COMPLETED', () => {
      const loop = { ...defaultLoop, status: LoopStatus.COMPLETED };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Start')).toBeInTheDocument();
      expect(screen.queryByText('Stop')).not.toBeInTheDocument();
    });

    it('calls onStop when Stop button is clicked', async () => {
      const user = userEvent.setup();
      const loop = { ...defaultLoop, status: LoopStatus.RUNNING };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      await user.click(screen.getByText('Stop'));
      expect(mockOnStop).toHaveBeenCalledWith(defaultLoop.projectId, undefined);
      expect(mockOnStop).toHaveBeenCalledTimes(1);
    });

    it('calls onStart when Start button is clicked', async () => {
      const user = userEvent.setup();
      const loop = { ...defaultLoop, status: LoopStatus.STOPPED };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      await user.click(screen.getByText('Start'));
      expect(mockOnStart).toHaveBeenCalledWith(defaultLoop.projectId);
      expect(mockOnStart).toHaveBeenCalledTimes(1);
    });

    it('does not trigger onSelect when Stop button is clicked', async () => {
      const user = userEvent.setup();
      const loop = { ...defaultLoop, status: LoopStatus.RUNNING };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      await user.click(screen.getByText('Stop'));
      expect(mockOnSelect).not.toHaveBeenCalled();
    });

    it('does not trigger onSelect when Start button is clicked', async () => {
      const user = userEvent.setup();
      const loop = { ...defaultLoop, status: LoopStatus.STOPPED };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      await user.click(screen.getByText('Start'));
      expect(mockOnSelect).not.toHaveBeenCalled();
    });
  });

  describe('Row selection', () => {
    it('applies selected background when isSelected is true', () => {
      const { container } = render(
        <table>
          <tbody>
            <LoopRow
              loop={defaultLoop}
              project={defaultProject}
              isSelected={true}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      const row = container.querySelector('tr');
      expect(row).toHaveClass('dark:bg-gray-800');
    });

    it('does not apply selected background when isSelected is false', () => {
      const { container } = render(
        <table>
          <tbody>
            <LoopRow
              loop={defaultLoop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      const row = container.querySelector('tr');
      expect(row).not.toHaveClass('bg-gray-800');
    });

    it('calls onSelect when row is clicked', async () => {
      const user = userEvent.setup();
      render(
        <table>
          <tbody>
            <LoopRow
              loop={defaultLoop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      await user.click(screen.getByText('Test Project'));
      expect(mockOnSelect).toHaveBeenCalledWith(defaultLoop);
      expect(mockOnSelect).toHaveBeenCalledTimes(1);
    });
  });

  describe('Mode labels', () => {
    it('displays "Single" for SINGLE mode', () => {
      const loop = { ...defaultLoop, mode: LoopMode.SINGLE };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Single')).toBeInTheDocument();
    });

    it('displays "Scheduled" for SCHEDULED mode', () => {
      const loop = { ...defaultLoop, mode: LoopMode.SCHEDULED };
      render(
        <table>
          <tbody>
            <LoopRow
              loop={loop}
              project={defaultProject}
              isSelected={false}
              onSelect={mockOnSelect}
              onStop={mockOnStop}
              onStart={mockOnStart}
            />
          </tbody>
        </table>
      );

      expect(screen.getByText('Scheduled')).toBeInTheDocument();
    });
  });
});
