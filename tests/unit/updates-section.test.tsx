import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UpdatesSection } from '../../src/renderer/pages/SettingsTab/UpdatesSection';
import type { AutoUpdateState } from '../../src/services/auto-updater';

// Capture the onStateChanged callback so tests can push state changes
let stateChangedCallback: ((state: AutoUpdateState) => void) | null = null;

const mockAutoUpdate = {
  check: vi.fn().mockResolvedValue(undefined),
  download: vi.fn().mockResolvedValue(undefined),
  install: vi.fn().mockResolvedValue(undefined),
  onStateChanged: vi.fn((cb: (state: AutoUpdateState) => void) => {
    stateChangedCallback = cb;
    return () => { stateChangedCallback = null; };
  }),
};

// @ts-expect-error - mocking window.api
globalThis.window.api = {
  ...globalThis.window.api,
  autoUpdate: mockAutoUpdate,
};

/** Push a state update to the mounted UpdatesSection */
function pushState(state: AutoUpdateState) {
  act(() => { stateChangedCallback?.(state); });
}

describe('UpdatesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateChangedCallback = null;
    mockAutoUpdate.onStateChanged.mockImplementation((cb: (state: AutoUpdateState) => void) => {
      stateChangedCallback = cb;
      return () => { stateChangedCallback = null; };
    });
  });

  describe('Initial State', () => {
    it('should render check button and initial message', () => {
      render(<UpdatesSection />);
      expect(screen.getByTestId('check-updates-button')).toBeInTheDocument();
      expect(screen.getByTestId('initial-message')).toBeInTheDocument();
    });

    it('should not display update info initially', () => {
      render(<UpdatesSection />);
      expect(screen.queryByTestId('update-available')).not.toBeInTheDocument();
      expect(screen.queryByTestId('no-update')).not.toBeInTheDocument();
      expect(screen.queryByTestId('update-downloaded')).not.toBeInTheDocument();
    });
  });

  describe('Check for Updates', () => {
    it('should call window.api.autoUpdate.check when button clicked', () => {
      render(<UpdatesSection />);
      fireEvent.click(screen.getByTestId('check-updates-button'));
      expect(mockAutoUpdate.check).toHaveBeenCalledTimes(1);
    });

    it('should show checking state', () => {
      render(<UpdatesSection />);
      pushState({ status: 'checking' });
      expect(screen.getByTestId('check-updates-button')).toBeDisabled();
      expect(screen.getByTestId('check-updates-button')).toHaveTextContent('Checking...');
    });
  });

  describe('No Update Available', () => {
    it('should display "no update" message when up-to-date', () => {
      render(<UpdatesSection />);
      pushState({ status: 'not-available' });
      expect(screen.getByTestId('no-update')).toBeInTheDocument();
      expect(screen.getByTestId('no-update')).toHaveTextContent("You're running the latest version");
    });
  });

  describe('Update Available', () => {
    it('should display update available message and download button', () => {
      render(<UpdatesSection />);
      pushState({ status: 'available', updateInfo: { version: '0.3.0', releaseDate: '2026-01-01T00:00:00.000Z' } as any });
      expect(screen.getByTestId('update-available')).toHaveTextContent('Update Available!');
      expect(screen.getByTestId('download-button')).toBeInTheDocument();
    });

    it('should show latest version when update available', () => {
      render(<UpdatesSection />);
      pushState({ status: 'available', updateInfo: { version: '0.3.0' } as any });
      expect(screen.getByTestId('latest-version')).toHaveTextContent('0.3.0');
      expect(screen.getByTestId('latest-version')).toHaveClass('text-green-400');
    });

    it('should call download when download button clicked', () => {
      render(<UpdatesSection />);
      pushState({ status: 'available', updateInfo: { version: '0.3.0' } as any });
      fireEvent.click(screen.getByTestId('download-button'));
      expect(mockAutoUpdate.download).toHaveBeenCalledTimes(1);
    });
  });

  describe('Downloading', () => {
    it('should show progress bar while downloading', () => {
      render(<UpdatesSection />);
      pushState({ status: 'downloading', downloadProgress: { percent: 42, bytesPerSecond: 0, transferred: 0, total: 0 } });
      expect(screen.getByTestId('download-progress')).toHaveTextContent('42%');
    });

    it('should hide check button while downloading', () => {
      render(<UpdatesSection />);
      pushState({ status: 'downloading', downloadProgress: { percent: 10, bytesPerSecond: 0, transferred: 0, total: 0 } });
      expect(screen.queryByTestId('check-updates-button')).not.toBeInTheDocument();
    });
  });

  describe('Downloaded', () => {
    it('should show install button when update downloaded', () => {
      render(<UpdatesSection />);
      pushState({ status: 'downloaded', updateInfo: { version: '0.3.0' } as any });
      expect(screen.getByTestId('update-downloaded')).toBeInTheDocument();
      expect(screen.getByTestId('install-button')).toBeInTheDocument();
    });

    it('should call install when install button clicked', () => {
      render(<UpdatesSection />);
      pushState({ status: 'downloaded', updateInfo: { version: '0.3.0' } as any });
      fireEvent.click(screen.getByTestId('install-button'));
      expect(mockAutoUpdate.install).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error State', () => {
    it('should display error message on failure', () => {
      render(<UpdatesSection />);
      pushState({ status: 'error', error: 'Network error' });
      expect(screen.getByTestId('update-error')).toHaveTextContent('Network error');
    });
  });

  describe('State subscription', () => {
    it('should subscribe to state changes on mount', () => {
      render(<UpdatesSection />);
      expect(mockAutoUpdate.onStateChanged).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe on unmount', () => {
      const cleanup = vi.fn();
      mockAutoUpdate.onStateChanged.mockReturnValueOnce(cleanup);
      const { unmount } = render(<UpdatesSection />);
      unmount();
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });
});
