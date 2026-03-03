import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UpdatesSection } from '../../src/renderer/pages/SettingsTab/UpdatesSection';

// Mock window.api.updates
const mockUpdates = {
  check: vi.fn(),
};

// @ts-expect-error - mocking window.api
globalThis.window.api = {
  ...globalThis.window.api,
  updates: mockUpdates,
};

describe('UpdatesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdates.check.mockResolvedValue({
      available: false,
      currentVersion: '0.1.0',
      latestVersion: '0.1.0',
    });
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

    it('should not render docker image input', () => {
      render(<UpdatesSection />);

      expect(screen.queryByTestId('docker-image-input')).not.toBeInTheDocument();
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

    it('should not show releases link when no update available', async () => {
      mockUpdates.check.mockResolvedValue({
        available: false,
        currentVersion: '0.1.0',
        latestVersion: '0.1.0',
      });

      render(<UpdatesSection />);

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        expect(screen.queryByTestId('releases-link')).not.toBeInTheDocument();
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

    it('should display releases link when update available', async () => {
      mockUpdates.check.mockResolvedValue({
        available: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
      });

      render(<UpdatesSection />);

      fireEvent.click(screen.getByTestId('check-updates-button'));

      await waitFor(() => {
        const link = screen.getByTestId('releases-link');
        expect(link).toBeInTheDocument();
        expect(link).toHaveTextContent('Download Latest Release');
        expect(link).toHaveAttribute('href', 'https://github.com/joegotflow83/zephyr/releases');
      });
    });
  });

  describe('UI Elements', () => {
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
