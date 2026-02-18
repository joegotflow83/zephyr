import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StatusBar } from '../../src/renderer/components/StatusBar/StatusBar';

describe('StatusBar Component', () => {
  let statusChangedCallback: ((available: boolean, info?: any) => void) | null = null;

  beforeEach(() => {
    statusChangedCallback = null;

    // Mock window.api.docker
    global.window.api = {
      docker: {
        status: vi.fn().mockResolvedValue({
          available: true,
          info: {
            version: '24.0.7',
            containers: 5,
            images: 12,
            osType: 'linux',
            architecture: 'x86_64',
          },
        }),
        onStatusChanged: vi.fn((callback) => {
          statusChangedCallback = callback;
          return vi.fn(); // cleanup function
        }),
      },
      loops: {
        list: vi.fn().mockResolvedValue([]),
        onStateChanged: vi.fn(() => vi.fn()),
      },
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Docker Status Display', () => {
    it('renders with green indicator when Docker is connected', async () => {
      render(<StatusBar />);

      await waitFor(() => {
        const indicator = screen.getByTitle('Docker connected');
        expect(indicator).toHaveClass('bg-green-500');
      });

      expect(screen.getByText(/Docker Connected/i)).toBeInTheDocument();
    });

    it('renders with red indicator when Docker is disconnected', async () => {
      global.window.api.docker.status = vi.fn().mockResolvedValue({
        available: false,
        info: undefined,
      });

      render(<StatusBar />);

      await waitFor(() => {
        const indicator = screen.getByTitle('Docker disconnected');
        expect(indicator).toHaveClass('bg-red-500');
      });

      expect(screen.getByText(/Docker Disconnected/i)).toBeInTheDocument();
    });

    it('displays Docker version when connected', async () => {
      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText('v24.0.7')).toBeInTheDocument();
      });
    });

    it('does not display Docker version when disconnected', async () => {
      global.window.api.docker.status = vi.fn().mockResolvedValue({
        available: false,
        info: undefined,
      });

      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/Docker Disconnected/i)).toBeInTheDocument();
      });

      expect(screen.queryByText(/v\d+\.\d+\.\d+/)).not.toBeInTheDocument();
    });

    it('updates status when Docker connection changes', async () => {
      render(<StatusBar />);

      // Wait for initial connected state
      await waitFor(() => {
        expect(screen.getByText(/Docker Connected/i)).toBeInTheDocument();
      });

      // Simulate Docker disconnection
      if (statusChangedCallback) {
        statusChangedCallback(false, undefined);
      }

      await waitFor(() => {
        expect(screen.getByText(/Docker Disconnected/i)).toBeInTheDocument();
        const indicator = screen.getByTitle('Docker disconnected');
        expect(indicator).toHaveClass('bg-red-500');
      });
    });

    it('handles Docker status query errors gracefully', async () => {
      global.window.api.docker.status = vi.fn().mockRejectedValue(new Error('Connection failed'));

      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/Docker Disconnected/i)).toBeInTheDocument();
      });
    });
  });

  describe('Active Loop Count Display', () => {
    it('does not display loop count when no loops are active', () => {
      render(<StatusBar activeLoopCount={0} />);

      expect(screen.queryByText(/loop/i)).not.toBeInTheDocument();
    });

    it('displays singular "loop" when 1 loop is active', async () => {
      render(<StatusBar activeLoopCount={1} />);

      await waitFor(() => {
        expect(screen.getByText('1 loop running')).toBeInTheDocument();
      });
    });

    it('displays plural "loops" when multiple loops are active', async () => {
      render(<StatusBar activeLoopCount={3} />);

      await waitFor(() => {
        expect(screen.getByText('3 loops running')).toBeInTheDocument();
      });
    });

    it('shows pulsing indicator for active loops', async () => {
      render(<StatusBar activeLoopCount={2} />);

      await waitFor(() => {
        const indicator = screen.getByText('2 loops running')
          .previousSibling as HTMLElement;
        expect(indicator).toHaveClass('bg-blue-500', 'animate-pulse');
      });
    });

    it('updates loop count when prop changes', async () => {
      const { rerender } = render(<StatusBar activeLoopCount={1} />);

      await waitFor(() => {
        expect(screen.getByText('1 loop running')).toBeInTheDocument();
      });

      rerender(<StatusBar activeLoopCount={5} />);

      await waitFor(() => {
        expect(screen.getByText('5 loops running')).toBeInTheDocument();
      });
    });
  });

  describe('App Version Display', () => {
    it('does not display version when not provided', () => {
      render(<StatusBar />);

      expect(screen.queryByText(/Zephyr v/)).not.toBeInTheDocument();
    });

    it('displays app version when provided', () => {
      render(<StatusBar appVersion="1.0.0" />);

      expect(screen.getByText('Zephyr v1.0.0')).toBeInTheDocument();
    });

    it('displays version with correct styling', () => {
      render(<StatusBar appVersion="2.5.1" />);

      const versionElement = screen.getByText('Zephyr v2.5.1');
      expect(versionElement).toHaveClass('text-xs', 'text-gray-500');
    });
  });

  describe('Layout and Styling', () => {
    it('renders with fixed positioning at bottom', () => {
      const { container } = render(<StatusBar />);

      const statusBar = container.firstChild as HTMLElement;
      expect(statusBar).toHaveClass('fixed', 'bottom-0', 'left-0', 'right-0');
    });

    it('has correct height and background color', () => {
      const { container } = render(<StatusBar />);

      const statusBar = container.firstChild as HTMLElement;
      expect(statusBar).toHaveClass('h-7', 'bg-gray-800', 'border-t', 'border-gray-700');
    });

    it('uses flex layout for content positioning', () => {
      const { container } = render(<StatusBar />);

      const statusBar = container.firstChild as HTMLElement;
      expect(statusBar).toHaveClass('flex', 'items-center', 'justify-between');
    });

    it('has high z-index to stay above other content', () => {
      const { container } = render(<StatusBar />);

      const statusBar = container.firstChild as HTMLElement;
      expect(statusBar).toHaveClass('z-50');
    });
  });

  describe('Integration', () => {
    it('subscribes to Docker status changes on mount', async () => {
      render(<StatusBar />);

      await waitFor(() => {
        expect(global.window.api.docker.status).toHaveBeenCalled();
        expect(global.window.api.docker.onStatusChanged).toHaveBeenCalled();
      });
    });

    it('cleans up subscriptions on unmount', async () => {
      const cleanupFn = vi.fn();
      global.window.api.docker.onStatusChanged = vi.fn(() => cleanupFn);

      const { unmount } = render(<StatusBar />);

      await waitFor(() => {
        expect(global.window.api.docker.onStatusChanged).toHaveBeenCalled();
      });

      unmount();

      expect(cleanupFn).toHaveBeenCalled();
    });

    it('renders all sections simultaneously when all props provided', async () => {
      render(<StatusBar activeLoopCount={2} appVersion="1.0.0" />);

      await waitFor(() => {
        expect(screen.getByText(/Docker Connected/i)).toBeInTheDocument();
        expect(screen.getByText('2 loops running')).toBeInTheDocument();
        expect(screen.getByText('Zephyr v1.0.0')).toBeInTheDocument();
      });
    });
  });
});
