import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DockerSection } from '../../src/renderer/pages/SettingsTab/DockerSection';

// Mock hooks
vi.mock('../../src/renderer/hooks/useDockerStatus');
vi.mock('../../src/renderer/hooks/useSettings');

const mockUseDockerStatus = vi.fn();
const mockUseSettings = vi.fn();

// Mock modules
await import('../../src/renderer/hooks/useDockerStatus').then((mod) => {
  // @ts-ignore
  mod.useDockerStatus = mockUseDockerStatus;
});
await import('../../src/renderer/hooks/useSettings').then((mod) => {
  // @ts-ignore
  mod.useSettings = mockUseSettings;
});

describe('DockerSection', () => {
  const mockUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Default mocks - update should always return a resolved promise
    mockUpdate.mockResolvedValue(undefined);

    mockUseDockerStatus.mockReturnValue({
      isConnected: false,
      dockerInfo: undefined,
    });

    mockUseSettings.mockReturnValue({
      settings: {
        max_concurrent_containers: 3,
        notification_enabled: true,
        theme: 'system' as const,
        log_level: 'INFO' as const,
      },
      update: mockUpdate,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Connection Status', () => {
    it('should show disconnected status when Docker is not available', () => {
      mockUseDockerStatus.mockReturnValue({
        isConnected: false,
        dockerInfo: undefined,
      });

      render(<DockerSection />);

      expect(screen.getByText('Disconnected')).toBeInTheDocument();
      const indicator = screen.getByTestId('docker-status-indicator');
      expect(indicator).toHaveClass('bg-red-500');
    });

    it('should show connected status when Docker is available', () => {
      mockUseDockerStatus.mockReturnValue({
        isConnected: true,
        dockerInfo: {
          version: '24.0.7',
          containers: 5,
          images: 12,
        },
      });

      render(<DockerSection />);

      expect(screen.getByText('Connected')).toBeInTheDocument();
      const indicator = screen.getByTestId('docker-status-indicator');
      expect(indicator).toHaveClass('bg-green-500');
    });

    it('should show warning message when Docker is disconnected', () => {
      mockUseDockerStatus.mockReturnValue({
        isConnected: false,
        dockerInfo: undefined,
      });

      render(<DockerSection />);

      expect(
        screen.getByText(/Docker is not running or not available/i)
      ).toBeInTheDocument();
    });

    it('should not show warning message when Docker is connected', () => {
      mockUseDockerStatus.mockReturnValue({
        isConnected: true,
        dockerInfo: {
          version: '24.0.7',
          containers: 5,
          images: 12,
        },
      });

      render(<DockerSection />);

      expect(
        screen.queryByText(/Docker is not running or not available/i)
      ).not.toBeInTheDocument();
    });
  });

  describe('Max Concurrent Containers', () => {
    it('should display current max containers value', () => {
      render(<DockerSection />);

      const input = screen.getByTestId(
        'max-containers-input'
      ) as HTMLInputElement;
      expect(input.value).toBe('3');
    });

    it('should increment max containers when + button clicked', async () => {
      const user = userEvent.setup({ delay: null });
      render(<DockerSection />);

      const incrementButton = screen.getByLabelText('Increase max containers');
      await user.click(incrementButton);

      const input = screen.getByTestId(
        'max-containers-input'
      ) as HTMLInputElement;
      expect(input.value).toBe('4');
    });

    it('should decrement max containers when - button clicked', async () => {
      const user = userEvent.setup({ delay: null });
      render(<DockerSection />);

      const decrementButton = screen.getByLabelText('Decrease max containers');
      await user.click(decrementButton);

      const input = screen.getByTestId(
        'max-containers-input'
      ) as HTMLInputElement;
      expect(input.value).toBe('2');
    });

    it('should not decrement below 1', async () => {
      const user = userEvent.setup({ delay: null });
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 1,
          notification_enabled: true,
          theme: 'system' as const,
          log_level: 'INFO' as const,
        },
        update: mockUpdate,
      });

      render(<DockerSection />);

      const decrementButton = screen.getByLabelText('Decrease max containers');
      expect(decrementButton).toBeDisabled();

      const input = screen.getByTestId(
        'max-containers-input'
      ) as HTMLInputElement;
      expect(input.value).toBe('1');
    });

    it('should not increment above 20', async () => {
      const user = userEvent.setup({ delay: null });
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 20,
          notification_enabled: true,
          theme: 'system' as const,
          log_level: 'INFO' as const,
        },
        update: mockUpdate,
      });

      render(<DockerSection />);

      const incrementButton = screen.getByLabelText('Increase max containers');
      expect(incrementButton).toBeDisabled();

      const input = screen.getByTestId(
        'max-containers-input'
      ) as HTMLInputElement;
      expect(input.value).toBe('20');
    });

    it('should allow direct input of valid number', async () => {
      const user = userEvent.setup({ delay: null });
      render(<DockerSection />);

      const input = screen.getByTestId('max-containers-input') as HTMLInputElement;

      // Use keyboard shortcuts to select all and then type
      await user.click(input);
      await user.keyboard('{Control>}a{/Control}');
      await user.keyboard('10');

      await act(async () => {
        vi.runAllTimers();
      });

      expect(input.value).toBe('10');
    });

    it('should save changes after debounce delay', async () => {
      const user = userEvent.setup({ delay: null });
      render(<DockerSection />);

      const incrementButton = screen.getByLabelText('Increase max containers');
      await user.click(incrementButton);

      // Should not save immediately
      expect(mockUpdate).not.toHaveBeenCalled();

      // Advance timers to trigger debounce
      await act(async () => {
        vi.advanceTimersByTime(500);
        vi.runAllTimers();
      });

      expect(mockUpdate).toHaveBeenCalledWith({ max_concurrent_containers: 4 });
    });

    it('should show saving indicator during save', async () => {
      const user = userEvent.setup({ delay: null });
      mockUpdate.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 100);
          })
      );

      render(<DockerSection />);

      const incrementButton = screen.getByLabelText('Increase max containers');
      await user.click(incrementButton);

      // Advance timers to trigger debounce but not the entire promise
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });

    it('should update when settings prop changes', () => {
      const { rerender } = render(<DockerSection />);

      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 5,
          notification_enabled: true,
          theme: 'system' as const,
          log_level: 'INFO' as const,
        },
        update: mockUpdate,
      });

      rerender(<DockerSection />);

      const input = screen.getByTestId(
        'max-containers-input'
      ) as HTMLInputElement;
      expect(input.value).toBe('5');
    });
  });

  describe('Docker Information', () => {
    it('should display Docker info when connected', () => {
      mockUseDockerStatus.mockReturnValue({
        isConnected: true,
        dockerInfo: {
          version: '24.0.7',
          containers: 5,
          images: 12,
          osType: 'linux',
          architecture: 'x86_64',
        },
      });

      render(<DockerSection />);

      expect(screen.getByText('24.0.7')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('linux')).toBeInTheDocument();
      expect(screen.getByText('x86_64')).toBeInTheDocument();
    });

    it('should not display Docker info when disconnected', () => {
      mockUseDockerStatus.mockReturnValue({
        isConnected: false,
        dockerInfo: undefined,
      });

      render(<DockerSection />);

      expect(screen.queryByText('Docker Information')).not.toBeInTheDocument();
    });

    it('should handle partial Docker info', () => {
      mockUseDockerStatus.mockReturnValue({
        isConnected: true,
        dockerInfo: {
          version: '24.0.7',
          containers: 5,
          images: 12,
          // osType and architecture are optional
        },
      });

      render(<DockerSection />);

      expect(screen.getByText('Docker Information')).toBeInTheDocument();
      expect(screen.getByText('24.0.7')).toBeInTheDocument();
      expect(screen.queryByText('OS Type:')).not.toBeInTheDocument();
      expect(screen.queryByText('Architecture:')).not.toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should handle update errors gracefully', async () => {
      const user = userEvent.setup({ delay: null });
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      mockUpdate.mockRejectedValue(new Error('Failed to save'));

      render(<DockerSection />);

      const incrementButton = screen.getByLabelText('Increase max containers');
      await user.click(incrementButton);

      await act(async () => {
        vi.advanceTimersByTime(500);
        vi.runAllTimers();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to save max containers setting:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
