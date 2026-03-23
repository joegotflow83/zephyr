import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UpdatesSection } from '../../src/renderer/pages/SettingsTab/UpdatesSection';
import type { AutoUpdateState } from '../../src/services/auto-updater';

const idleState: AutoUpdateState = { status: 'idle' };

const mockAutoUpdate = {
  getState: vi.fn().mockResolvedValue(idleState),
  check: vi.fn().mockResolvedValue(undefined),
  download: vi.fn().mockResolvedValue(undefined),
  install: vi.fn().mockResolvedValue(undefined),
  onStateChanged: vi.fn().mockReturnValue(() => {}),
};

// @ts-expect-error - mocking window.api
globalThis.window.api = {
  ...globalThis.window.api,
  autoUpdate: mockAutoUpdate,
};

describe('UpdatesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAutoUpdate.getState.mockResolvedValue(idleState);
    mockAutoUpdate.onStateChanged.mockReturnValue(() => {});
  });

  describe('Initial State', () => {
    it('should render check button and initial message', async () => {
      await act(async () => {
        render(<UpdatesSection />);
      });

      expect(screen.getByTestId('check-updates-button')).toBeInTheDocument();
      expect(screen.getByTestId('initial-message')).toBeInTheDocument();
    });

    it('should not display update info initially', async () => {
      await act(async () => {
        render(<UpdatesSection />);
      });

      expect(screen.queryByTestId('update-available')).not.toBeInTheDocument();
      expect(screen.queryByTestId('no-update')).not.toBeInTheDocument();
      expect(screen.queryByTestId('update-downloaded')).not.toBeInTheDocument();
    });
  });

  describe('Check for Updates', () => {
    it('should call window.api.autoUpdate.check when button clicked', async () => {
      await act(async () => {
        render(<UpdatesSection />);
      });

      fireEvent.click(screen.getByTestId('check-updates-button'));

      expect(mockAutoUpdate.check).toHaveBeenCalledTimes(1);
    });

    it('should show checking state while in progress', async () => {
      mockAutoUpdate.getState.mockResolvedValue({ status: 'checking' } as AutoUpdateState);

      await act(async () => {
        render(<UpdatesSection />);
      });

      expect(screen.getByTestId('check-updates-button')).toBeDisabled();
      expect(screen.getByTestId('check-updates-button')).toHaveTextContent('Checking...');
    });
  });

  describe('No Update Available', () => {
    it('should display "no update" message when up-to-date', async () => {
      mockAutoUpdate.getState.mockResolvedValue({ status: 'not-available' } as AutoUpdateState);

      await act(async () => {
        render(<UpdatesSection />);
      });

      expect(screen.getByTestId('no-update')).toBeInTheDocument();
      expect(screen.getByTestId('no-update')).toHaveTextContent("You're running the latest version");
    });
  });

  describe('Update Available', () => {
    it('should display update available message and download button', async () => {
      mockAutoUpdate.getState.mockResolvedValue({
        status: 'available',
        updateInfo: { version: '0.3.0', releaseDate: '2026-01-01T00:00:00.000Z' },
      } as AutoUpdateState);

      await act(async () => {
        render(<UpdatesSection />);
      });

      expect(screen.getByTestId('update-available')).toBeInTheDocument();
      expect(screen.getByTestId('update-available')).toHaveTextContent('Update Available!');
      expect(screen.getByTestId('download-button')).toBeInTheDocument();
    });

    it('should show latest version when update available', async () => {
      mockAutoUpdate.getState.mockResolvedValue({
        status: 'available',
        updateInfo: { version: '0.3.0' },
      } as AutoUpdateState);

      await act(async () => {
        render(<UpdatesSection />);
      });

      expect(screen.getByTestId('latest-version')).toHaveTextContent('0.3.0');
      expect(screen.getByTestId('latest-version')).toHaveClass('text-green-400');
    });

    it('should call download when download button clicked', async () => {
      mockAutoUpdate.getState.mockResolvedValue({
        status: 'available',
        updateInfo: { version: '0.3.0' },
      } as AutoUpdateState);

      await act(async () => {
        render(<UpdatesSection />);
      });

      fireEvent.click(screen.getByTestId('download-button'));
      expect(mockAutoUpdate.download).toHaveBeenCalledTimes(1);
    });
  });

  describe('Downloading', () => {
    it('should show progress bar while downloading', async () => {
      mockAutoUpdate.getState.mockResolvedValue({
        status: 'downloading',
        downloadProgress: { percent: 42, bytesPerSecond: 0, transferred: 0, total: 0 },
      } as AutoUpdateState);

      await act(async () => {
        render(<UpdatesSection />);
      });

      expect(screen.getByTestId('download-progress')).toBeInTheDocument();
      expect(screen.getByTestId('download-progress')).toHaveTextContent('42%');
    });

    it('should hide check button while downloading', async () => {
      mockAutoUpdate.getState.mockResolvedValue({
        status: 'downloading',
        downloadProgress: { percent: 10, bytesPerSecond: 0, transferred: 0, total: 0 },
      } as AutoUpdateState);

      await act(async () => {
        render(<UpdatesSection />);
      });

      expect(screen.queryByTestId('check-updates-button')).not.toBeInTheDocument();
    });
  });

  describe('Downloaded', () => {
    it('should show install button when update downloaded', async () => {
      mockAutoUpdate.getState.mockResolvedValue({
        status: 'downloaded',
        updateInfo: { version: '0.3.0' },
      } as AutoUpdateState);

      await act(async () => {
        render(<UpdatesSection />);
      });

      expect(screen.getByTestId('update-downloaded')).toBeInTheDocument();
      expect(screen.getByTestId('install-button')).toBeInTheDocument();
    });

    it('should call install when install button clicked', async () => {
      mockAutoUpdate.getState.mockResolvedValue({
        status: 'downloaded',
        updateInfo: { version: '0.3.0' },
      } as AutoUpdateState);

      await act(async () => {
        render(<UpdatesSection />);
      });

      fireEvent.click(screen.getByTestId('install-button'));
      expect(mockAutoUpdate.install).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error State', () => {
    it('should display error message on failure', async () => {
      mockAutoUpdate.getState.mockResolvedValue({
        status: 'error',
        error: 'Network error',
      } as AutoUpdateState);

      await act(async () => {
        render(<UpdatesSection />);
      });

      expect(screen.getByTestId('update-error')).toBeInTheDocument();
      expect(screen.getByTestId('update-error')).toHaveTextContent('Network error');
    });
  });

  describe('State subscription', () => {
    it('should subscribe to state changes on mount', async () => {
      await act(async () => {
        render(<UpdatesSection />);
      });

      expect(mockAutoUpdate.onStateChanged).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe on unmount', async () => {
      const cleanup = vi.fn();
      mockAutoUpdate.onStateChanged.mockReturnValue(cleanup);

      let unmount: () => void;
      await act(async () => {
        ({ unmount } = render(<UpdatesSection />));
      });

      act(() => unmount());
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });
});
