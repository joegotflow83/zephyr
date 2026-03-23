import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GeneralSection } from '../../src/renderer/pages/SettingsTab/GeneralSection';

// Mock hooks
vi.mock('../../src/renderer/hooks/useSettings');

const mockUseSettings = vi.fn();

// Mock modules
await import('../../src/renderer/hooks/useSettings').then((mod) => {
  // @ts-ignore
  mod.useSettings = mockUseSettings;
});

describe('GeneralSection', () => {
  const mockUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Default mocks - update should always return a resolved promise
    mockUpdate.mockResolvedValue(undefined);

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

  describe('Notifications Toggle', () => {
    it('should display notifications toggle in enabled state', () => {
      render(<GeneralSection />);

      const toggle = screen.getByTestId('notifications-toggle');
      expect(toggle).toHaveAttribute('aria-checked', 'true');
      expect(toggle).toHaveClass('bg-blue-600');
    });

    it('should display notifications toggle in disabled state', () => {
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 3,
          notification_enabled: false,
          theme: 'system' as const,
          log_level: 'INFO' as const,
        },
        update: mockUpdate,
      });

      render(<GeneralSection />);

      const toggle = screen.getByTestId('notifications-toggle');
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(toggle).toHaveClass('bg-gray-600');
    });

    it('should toggle notifications when clicked', async () => {
      const user = userEvent.setup({ delay: null });
      render(<GeneralSection />);

      const toggle = screen.getByTestId('notifications-toggle');
      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    it('should save notifications change after debounce', async () => {
      const user = userEvent.setup({ delay: null });
      render(<GeneralSection />);

      const toggle = screen.getByTestId('notifications-toggle');
      await user.click(toggle);

      // Should not save immediately
      expect(mockUpdate).not.toHaveBeenCalled();

      // Advance timers to trigger debounce
      await act(async () => {
        vi.advanceTimersByTime(500);
        vi.runAllTimers();
      });

      expect(mockUpdate).toHaveBeenCalledWith({ notification_enabled: false });
    });

    it('should update when settings prop changes', () => {
      const { rerender } = render(<GeneralSection />);

      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 3,
          notification_enabled: false,
          theme: 'system' as const,
          log_level: 'INFO' as const,
        },
        update: mockUpdate,
      });

      rerender(<GeneralSection />);

      const toggle = screen.getByTestId('notifications-toggle');
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });
  });

  describe('Log Level Dropdown', () => {
    it('should display current log level', () => {
      render(<GeneralSection />);

      const select = screen.getByTestId('log-level-select') as HTMLSelectElement;
      expect(select.value).toBe('INFO');
    });

    it('should change log level when option selected', async () => {
      const user = userEvent.setup({ delay: null });
      render(<GeneralSection />);

      const select = screen.getByTestId('log-level-select');
      await user.selectOptions(select, 'DEBUG');

      expect((select as HTMLSelectElement).value).toBe('DEBUG');
    });

    it('should save log level change after debounce', async () => {
      const user = userEvent.setup({ delay: null });
      render(<GeneralSection />);

      const select = screen.getByTestId('log-level-select');
      await user.selectOptions(select, 'WARNING');

      // Should not save immediately
      expect(mockUpdate).not.toHaveBeenCalled();

      // Advance timers to trigger debounce
      await act(async () => {
        vi.advanceTimersByTime(500);
        vi.runAllTimers();
      });

      expect(mockUpdate).toHaveBeenCalledWith({ log_level: 'WARNING' });
    });

    it('should display all log level options', () => {
      render(<GeneralSection />);

      expect(screen.getByText(/DEBUG - Detailed debugging/)).toBeInTheDocument();
      expect(screen.getByText(/INFO - General informational/)).toBeInTheDocument();
      expect(screen.getByText(/WARNING - Warning messages/)).toBeInTheDocument();
      expect(screen.getByText(/ERROR - Error messages/)).toBeInTheDocument();
    });

    it('should update when settings prop changes', () => {
      const { rerender } = render(<GeneralSection />);

      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 3,
          notification_enabled: true,
          theme: 'system' as const,
          log_level: 'ERROR' as const,
        },
        update: mockUpdate,
      });

      rerender(<GeneralSection />);

      const select = screen.getByTestId('log-level-select') as HTMLSelectElement;
      expect(select.value).toBe('ERROR');
    });
  });

  describe('Theme Selector', () => {
    it('should display current theme', () => {
      render(<GeneralSection />);

      const select = screen.getByTestId('theme-select') as HTMLSelectElement;
      expect(select.value).toBe('system');
    });

    it('should change theme when option selected', async () => {
      const user = userEvent.setup({ delay: null });
      render(<GeneralSection />);

      const select = screen.getByTestId('theme-select');
      await user.selectOptions(select, 'dark');

      expect((select as HTMLSelectElement).value).toBe('dark');
    });

    it('should save theme change after debounce', async () => {
      const user = userEvent.setup({ delay: null });
      render(<GeneralSection />);

      const select = screen.getByTestId('theme-select');
      await user.selectOptions(select, 'light');

      // Should not save immediately
      expect(mockUpdate).not.toHaveBeenCalled();

      // Advance timers to trigger debounce
      await act(async () => {
        vi.advanceTimersByTime(500);
        vi.runAllTimers();
      });

      expect(mockUpdate).toHaveBeenCalledWith({ theme: 'light' });
    });

    it('should display all theme options', () => {
      render(<GeneralSection />);

      expect(screen.getByText(/System - Follow OS preference/)).toBeInTheDocument();
      expect(screen.getByText('Light')).toBeInTheDocument();
      expect(screen.getByText('Dark')).toBeInTheDocument();
    });

    it('should update when settings prop changes', () => {
      const { rerender } = render(<GeneralSection />);

      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 3,
          notification_enabled: true,
          theme: 'dark' as const,
          log_level: 'INFO' as const,
        },
        update: mockUpdate,
      });

      rerender(<GeneralSection />);

      const select = screen.getByTestId('theme-select') as HTMLSelectElement;
      expect(select.value).toBe('dark');
    });
  });

  describe('App Version', () => {
    it('should display application version', () => {
      render(<GeneralSection />);

      const version = screen.getByTestId('app-version');
      expect(version).toHaveTextContent(/Zephyr Desktop v\d+\.\d+\.\d+/);
    });
  });

  describe('Saving Indicator', () => {
    it('should show saving indicator during save', async () => {
      const user = userEvent.setup({ delay: null });
      mockUpdate.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 100);
          })
      );

      render(<GeneralSection />);

      const toggle = screen.getByTestId('notifications-toggle');
      await user.click(toggle);

      // Advance timers to trigger debounce but not the entire promise
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      expect(screen.getByText('Saving changes...')).toBeInTheDocument();
    });

    it('should hide saving indicator after save completes', async () => {
      const user = userEvent.setup({ delay: null });
      mockUpdate.mockResolvedValue(undefined);

      render(<GeneralSection />);

      const toggle = screen.getByTestId('notifications-toggle');
      await user.click(toggle);

      // Advance timers to trigger debounce
      await act(async () => {
        vi.advanceTimersByTime(500);
        vi.runAllTimers();
      });

      expect(mockUpdate).toHaveBeenCalled();

      // Advance a bit more to ensure state updates
      await act(async () => {
        vi.advanceTimersByTime(100);
        vi.runAllTimers();
      });

      expect(screen.queryByText('Saving changes...')).not.toBeInTheDocument();
    });
  });

  describe('Multiple Changes', () => {
    it('should handle multiple rapid changes with debouncing', async () => {
      const user = userEvent.setup({ delay: null });
      render(<GeneralSection />);

      const toggle = screen.getByTestId('notifications-toggle');
      const logLevelSelect = screen.getByTestId('log-level-select');

      // Make multiple changes
      await user.click(toggle);
      await user.selectOptions(logLevelSelect, 'DEBUG');

      // Should not save immediately
      expect(mockUpdate).not.toHaveBeenCalled();

      // Advance timers to trigger debounce
      await act(async () => {
        vi.advanceTimersByTime(500);
        vi.runAllTimers();
      });

      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle notifications update errors gracefully', async () => {
      const user = userEvent.setup({ delay: null });
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      mockUpdate.mockRejectedValue(new Error('Failed to save'));

      render(<GeneralSection />);

      const toggle = screen.getByTestId('notifications-toggle');
      await user.click(toggle);

      await act(async () => {
        vi.advanceTimersByTime(500);
        vi.runAllTimers();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to save notifications setting:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle log level update errors gracefully', async () => {
      const user = userEvent.setup({ delay: null });
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      mockUpdate.mockRejectedValue(new Error('Failed to save'));

      render(<GeneralSection />);

      const select = screen.getByTestId('log-level-select');
      await user.selectOptions(select, 'DEBUG');

      await act(async () => {
        vi.advanceTimersByTime(500);
        vi.runAllTimers();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to save log level setting:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle theme update errors gracefully', async () => {
      const user = userEvent.setup({ delay: null });
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      mockUpdate.mockRejectedValue(new Error('Failed to save'));

      render(<GeneralSection />);

      const select = screen.getByTestId('theme-select');
      await user.selectOptions(select, 'dark');

      await act(async () => {
        vi.advanceTimersByTime(500);
        vi.runAllTimers();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to save theme setting:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
