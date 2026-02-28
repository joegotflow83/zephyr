import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UpdatesSection } from '../../src/renderer/pages/SettingsTab/UpdatesSection';

// Mock useSettings hook — controls what settings the component sees
const mockUseSettings = vi.fn();
vi.mock('../../src/renderer/hooks/useSettings', () => ({
  useSettings: () => mockUseSettings(),
}));

// Mock window.api.updates
const mockUpdates = {
  check: vi.fn(),
  apply: vi.fn(),
};

// @ts-expect-error - mocking window.api
globalThis.window.api = {
  ...globalThis.window.api,
  updates: mockUpdates,
};

const DEFAULT_IMAGE = 'zephyr-desktop:latest';

describe('UpdatesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: settings loaded with no custom docker image
    mockUseSettings.mockReturnValue({
      settings: {
        max_concurrent_containers: 5,
        notification_enabled: true,
        theme: 'system',
        log_level: 'INFO',
        self_update_docker_image: DEFAULT_IMAGE,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    });
    mockUpdates.check.mockResolvedValue({
      available: false,
      currentVersion: '0.1.0',
      latestVersion: '0.1.0',
    });
    mockUpdates.apply.mockResolvedValue(undefined);
  });

  describe('Initial State', () => {
    it('should render check button and initial message', () => {
      render(<UpdatesSection />);

      expect(screen.getByTestId('check-updates-button')).toBeInTheDocument();
      expect(screen.getByTestId('initial-message')).toBeInTheDocument();
      expect(screen.getByText(/Click "Check for Updates"/)).toBeInTheDocument();
    });

    it('should not display update info initially', () => {
      render(<UpdatesSection />);

      expect(screen.queryByTestId('current-version')).not.toBeInTheDocument();
      expect(screen.queryByTestId('latest-version')).not.toBeInTheDocument();
      expect(screen.queryByTestId('update-available')).not.toBeInTheDocument();
    });
  });

  describe('Docker Image Configuration', () => {
    it('should render docker image input with default value', () => {
      render(<UpdatesSection />);

      const input = screen.getByTestId('docker-image-input');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue(DEFAULT_IMAGE);
    });

    it('should load docker image from settings', () => {
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 5,
          notification_enabled: true,
          theme: 'system',
          log_level: 'INFO',
          self_update_docker_image: 'my-custom-image:v2',
        },
        loading: false,
        error: null,
        refresh: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
      });

      render(<UpdatesSection />);

      expect(screen.getByTestId('docker-image-input')).toHaveValue('my-custom-image:v2');
    });

    it('should default to zephyr-desktop:latest when settings has no docker image', () => {
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 5,
          notification_enabled: true,
          theme: 'system',
          log_level: 'INFO',
        },
        loading: false,
        error: null,
        refresh: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
      });

      render(<UpdatesSection />);

      expect(screen.getByTestId('docker-image-input')).toHaveValue(DEFAULT_IMAGE);
    });

    it('should update docker image input value when user types', () => {
      render(<UpdatesSection />);

      const input = screen.getByTestId('docker-image-input');
      fireEvent.change(input, { target: { value: 'my-image:latest' } });

      expect(input).toHaveValue('my-image:latest');
    });

    it('should save updated docker image on blur', async () => {
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 5,
          notification_enabled: true,
          theme: 'system',
          log_level: 'INFO',
          self_update_docker_image: DEFAULT_IMAGE,
        },
        loading: false,
        error: null,
        refresh: vi.fn(),
        update: mockUpdate,
      });

      render(<UpdatesSection />);

      const input = screen.getByTestId('docker-image-input');
      fireEvent.change(input, { target: { value: 'my-image:v3' } });
      fireEvent.blur(input);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith({ self_update_docker_image: 'my-image:v3' });
      });
    });

    it('should not save if docker image value is unchanged on blur', async () => {
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 5,
          notification_enabled: true,
          theme: 'system',
          log_level: 'INFO',
          self_update_docker_image: DEFAULT_IMAGE,
        },
        loading: false,
        error: null,
        refresh: vi.fn(),
        update: mockUpdate,
      });

      render(<UpdatesSection />);

      const input = screen.getByTestId('docker-image-input');
      fireEvent.blur(input);

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should use default image when input is blank on blur', async () => {
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 5,
          notification_enabled: true,
          theme: 'system',
          log_level: 'INFO',
          self_update_docker_image: DEFAULT_IMAGE,
        },
        loading: false,
        error: null,
        refresh: vi.fn(),
        update: mockUpdate,
      });

      render(<UpdatesSection />);

      const input = screen.getByTestId('docker-image-input');
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.blur(input);

      await waitFor(() => {
        expect(input).toHaveValue(DEFAULT_IMAGE);
      });
    });
  });

  describe('Check for Updates', () => {
    it('should call window.api.updates.check when button clicked', async () => {
      mockUpdates.check.mockResolvedValue({
        available: false,
        currentVersion: '0.1.0',
        latestVersion: '0.1.0',
      });

      render(<UpdatesSection />);

      const button = screen.getByTestId('check-updates-button');
      fireEvent.click(button);

      expect(mockUpdates.check).toHaveBeenCalledTimes(1);
    });

    it('should disable button while checking', async () => {
      mockUpdates.check.mockImplementation(
        () => new Promise(() => {}) // Never resolves — avoids dangling timers causing act() errors
      );

      render(<UpdatesSection />);

      const button = screen.getByTestId('check-updates-button');
      fireEvent.click(button);

      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Checking...');
    });

    it('should display version info after successful check', async () => {
      mockUpdates.check.mockResolvedValue({
        available: false,
        currentVersion: '0.1.0',
        latestVersion: '0.1.0',
      });

      render(<UpdatesSection />);

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        expect(screen.getByTestId('current-version')).toHaveTextContent('0.1.0');
        expect(screen.getByTestId('latest-version')).toHaveTextContent('0.1.0');
      });
    });

    it('should display error message on check failure', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockUpdates.check.mockRejectedValue(new Error('Network error'));

      render(<UpdatesSection />);

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        expect(screen.getByTestId('update-error')).toBeInTheDocument();
        expect(screen.getByTestId('update-error')).toHaveTextContent('Network error');
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to check for updates:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should clear previous error when checking again', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockUpdates.check.mockRejectedValueOnce(new Error('Network error'));

      render(<UpdatesSection />);

      // First check fails
      fireEvent.click(screen.getByTestId('check-updates-button'));
      await waitFor(() => {
        expect(screen.getByTestId('update-error')).toBeInTheDocument();
      });

      // Second check succeeds
      mockUpdates.check.mockResolvedValue({
        available: false,
        currentVersion: '0.1.0',
        latestVersion: '0.1.0',
      });

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        expect(screen.queryByTestId('update-error')).not.toBeInTheDocument();
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('No Update Available', () => {
    it('should display "no update" message when up-to-date', async () => {
      mockUpdates.check.mockResolvedValue({
        available: false,
        currentVersion: '0.1.0',
        latestVersion: '0.1.0',
      });

      render(<UpdatesSection />);

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        expect(screen.getByTestId('no-update')).toBeInTheDocument();
        expect(screen.getByTestId('no-update')).toHaveTextContent(
          "You're running the latest version"
        );
      });
    });

    it('should not show update button when no update available', async () => {
      mockUpdates.check.mockResolvedValue({
        available: false,
        currentVersion: '0.1.0',
        latestVersion: '0.1.0',
      });

      render(<UpdatesSection />);

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        expect(screen.queryByTestId('apply-update-button')).not.toBeInTheDocument();
      });
    });
  });

  describe('Update Available', () => {
    it('should display update available message', async () => {
      mockUpdates.check.mockResolvedValue({
        available: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
      });

      render(<UpdatesSection />);

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        expect(screen.getByTestId('update-available')).toBeInTheDocument();
        expect(screen.getByTestId('update-available')).toHaveTextContent(
          'Update Available!'
        );
      });
    });

    it('should highlight latest version when update available', async () => {
      mockUpdates.check.mockResolvedValue({
        available: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
      });

      render(<UpdatesSection />);

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        const latestVersion = screen.getByTestId('latest-version');
        expect(latestVersion).toHaveTextContent('0.2.0');
        expect(latestVersion).toHaveClass('text-green-400');
      });
    });

    it('should display changelog when provided', async () => {
      mockUpdates.check.mockResolvedValue({
        available: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
        changelog: 'New feature: Terminal support\nBug fix: Memory leak',
      });

      render(<UpdatesSection />);

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        const changelog = screen.getByTestId('changelog');
        expect(changelog).toBeInTheDocument();
        expect(changelog).toHaveTextContent('New feature: Terminal support');
        expect(changelog).toHaveTextContent('Bug fix: Memory leak');
      });
    });

    it('should not display changelog section when not provided', async () => {
      mockUpdates.check.mockResolvedValue({
        available: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
      });

      render(<UpdatesSection />);

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        expect(screen.queryByTestId('changelog')).not.toBeInTheDocument();
      });
    });

    it('should display update button when update available', async () => {
      mockUpdates.check.mockResolvedValue({
        available: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
      });

      render(<UpdatesSection />);

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        expect(screen.getByTestId('apply-update-button')).toBeInTheDocument();
        expect(screen.getByTestId('apply-update-button')).toHaveTextContent('Update App');
      });
    });
  });

  describe('Apply Update', () => {
    it('should call window.api.updates.apply with configured docker image', async () => {
      mockUpdates.check.mockResolvedValue({
        available: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
      });
      mockUpdates.apply.mockResolvedValue(undefined);

      render(<UpdatesSection />);

      // First check for updates
      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        expect(screen.getByTestId('apply-update-button')).toBeInTheDocument();
      });

      // Then apply update
      fireEvent.click(screen.getByTestId('apply-update-button'));

      await waitFor(() => {
        expect(mockUpdates.apply).toHaveBeenCalledTimes(1);
        expect(mockUpdates.apply).toHaveBeenCalledWith(DEFAULT_IMAGE);
      });
    });

    it('should call apply with custom docker image when configured', async () => {
      mockUseSettings.mockReturnValue({
        settings: {
          max_concurrent_containers: 5,
          notification_enabled: true,
          theme: 'system',
          log_level: 'INFO',
          self_update_docker_image: 'custom-image:v2',
        },
        loading: false,
        error: null,
        refresh: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
      });
      mockUpdates.check.mockResolvedValue({
        available: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
      });
      mockUpdates.apply.mockResolvedValue(undefined);

      render(<UpdatesSection />);

      fireEvent.click(screen.getByTestId('check-updates-button'));
      await waitFor(() => {
        expect(screen.getByTestId('apply-update-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('apply-update-button'));

      await waitFor(() => {
        expect(mockUpdates.apply).toHaveBeenCalledWith('custom-image:v2');
      });
    });

    it('should disable update button while updating', async () => {
      mockUpdates.check.mockResolvedValue({
        available: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
      });
      mockUpdates.apply.mockImplementation(
        () => new Promise(() => {}) // Never resolves — avoids dangling timers causing act() errors
      );

      render(<UpdatesSection />);

      // First check for updates
      fireEvent.click(screen.getByTestId('check-updates-button'));
      await waitFor(() => {
        expect(screen.getByTestId('apply-update-button')).toBeInTheDocument();
      });

      // Then apply update
      const updateButton = screen.getByTestId('apply-update-button');
      fireEvent.click(updateButton);

      expect(updateButton).toBeDisabled();
      expect(updateButton).toHaveTextContent('Starting Update...');
    });

    it('should display error message on update failure', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockUpdates.check.mockResolvedValue({
        available: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
      });
      mockUpdates.apply.mockRejectedValue(new Error('Failed to start update'));

      render(<UpdatesSection />);

      // First check for updates
      fireEvent.click(screen.getByTestId('check-updates-button'));
      await waitFor(() => {
        expect(screen.getByTestId('apply-update-button')).toBeInTheDocument();
      });

      // Then apply update
      fireEvent.click(screen.getByTestId('apply-update-button'));

      await waitFor(() => {
        expect(screen.getByTestId('update-error')).toBeInTheDocument();
        expect(screen.getByTestId('update-error')).toHaveTextContent(
          'Failed to start update'
        );
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to start update:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should clear error when applying update again', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockUpdates.check.mockResolvedValue({
        available: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
      });
      mockUpdates.apply.mockRejectedValueOnce(new Error('Failed to start update'));

      render(<UpdatesSection />);

      // First check for updates
      fireEvent.click(screen.getByTestId('check-updates-button'));
      await waitFor(() => {
        expect(screen.getByTestId('apply-update-button')).toBeInTheDocument();
      });

      // First update attempt fails
      fireEvent.click(screen.getByTestId('apply-update-button'));
      await waitFor(() => {
        expect(screen.getByTestId('update-error')).toBeInTheDocument();
      });

      // Second update attempt succeeds
      mockUpdates.apply.mockResolvedValue(undefined);
      fireEvent.click(screen.getByTestId('apply-update-button'));

      await waitFor(() => {
        expect(screen.queryByTestId('update-error')).not.toBeInTheDocument();
      });

      consoleErrorSpy.mockRestore();
    });

    it('should not allow update when no update available', async () => {
      mockUpdates.check.mockResolvedValue({
        available: false,
        currentVersion: '0.1.0',
        latestVersion: '0.1.0',
      });

      render(<UpdatesSection />);

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        expect(screen.queryByTestId('apply-update-button')).not.toBeInTheDocument();
      });

      expect(mockUpdates.apply).not.toHaveBeenCalled();
    });
  });

  describe('UI Elements', () => {
    it('should display informative note about update process', async () => {
      mockUpdates.check.mockResolvedValue({
        available: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
      });

      render(<UpdatesSection />);

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        expect(
          screen.getByText(/will start a self-update loop.*monitor.*Loops tab/)
        ).toBeInTheDocument();
      });
    });

    it('should hide initial message after checking', async () => {
      mockUpdates.check.mockResolvedValue({
        available: false,
        currentVersion: '0.1.0',
        latestVersion: '0.1.0',
      });

      render(<UpdatesSection />);

      expect(screen.getByTestId('initial-message')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        expect(screen.queryByTestId('initial-message')).not.toBeInTheDocument();
      });
    });
  });
});
