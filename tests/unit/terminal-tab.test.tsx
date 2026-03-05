/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { TerminalTab } from '../../src/renderer/pages/TerminalTab/TerminalTab';
import type { ContainerInfo } from '../../src/services/docker-manager';
import type { TerminalSession } from '../../src/services/terminal-manager';

// Hoisted state for capturing Terminal component props across the mock boundary.
// Must be hoisted because vi.mock() factories are hoisted before variable declarations.
const mockState = vi.hoisted(() => ({
  latestTerminalProps: null as any,
}));

// Mock Terminal component - captures latest props for Terminal Data Flow tests.
vi.mock('../../src/renderer/components/Terminal/Terminal', () => ({
  Terminal: React.forwardRef((props: any, ref: any) => {
    mockState.latestTerminalProps = props;
    React.useImperativeHandle(ref, () => ({
      write: vi.fn(),
      clear: vi.fn(),
      search: vi.fn(),
      copy: vi.fn(),
      paste: vi.fn(),
      increaseFontSize: vi.fn(),
      decreaseFontSize: vi.fn(),
      resetFontSize: vi.fn(),
      getCurrentFontSize: vi.fn(() => 14),
    }));
    return <div data-testid="terminal-instance">{props.theme}</div>;
  }),
}));

// Mock window.api functions declared at module level for callback capture
const mockListContainers = vi.fn();
const mockListLoops = vi.fn();
const mockTerminalOpen = vi.fn();
const mockTerminalOpenVM = vi.fn();
const mockTerminalClose = vi.fn();
const mockTerminalWrite = vi.fn();
const mockTerminalResize = vi.fn();

let onDataCallback: ((sessionId: string, data: string) => void) | null = null;
let onClosedCallback: ((sessionId: string) => void) | null = null;
let onErrorCallback: ((sessionId: string, error: string) => void) | null = null;

const mockOnData = vi.fn((callback) => {
  onDataCallback = callback;
  return () => {
    onDataCallback = null;
  };
});

const mockOnClosed = vi.fn((callback) => {
  onClosedCallback = callback;
  return () => {
    onClosedCallback = null;
  };
});

const mockOnError = vi.fn((callback) => {
  onErrorCallback = callback;
  return () => {
    onErrorCallback = null;
  };
});

describe('TerminalTab', () => {
  const mockContainers: ContainerInfo[] = [
    {
      id: 'container1',
      name: 'test-container-1',
      image: 'node:20',
      state: 'running',
      status: 'Up 5 minutes',
      created: '2026-02-19T10:00:00Z',
      projectId: 'project1',
    },
    {
      id: 'container2',
      name: 'test-container-2',
      image: 'python:3.11',
      state: 'running',
      status: 'Up 10 minutes',
      created: '2026-02-19T09:55:00Z',
      projectId: 'project2',
    },
  ];

  const mockSession: TerminalSession = {
    id: 'session-123',
    containerId: 'container1',
    user: 'root',
    createdAt: new Date('2026-02-19T10:30:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    onDataCallback = null;
    onClosedCallback = null;
    onErrorCallback = null;
    mockState.latestTerminalProps = null;
    mockListContainers.mockResolvedValue(mockContainers);
    mockListLoops.mockResolvedValue([]);

    // Add api to global.window WITHOUT replacing the entire window object.
    // Replacing global.window would wipe jsdom's DOM APIs (addEventListener, etc.),
    // causing render to fail. This pattern preserves all jsdom functionality.
    global.window.api = {
      docker: {
        listContainers: mockListContainers,
      },
      loops: {
        list: mockListLoops,
      },
      terminal: {
        open: mockTerminalOpen,
        openVM: mockTerminalOpenVM,
        close: mockTerminalClose,
        write: mockTerminalWrite,
        resize: mockTerminalResize,
        onData: mockOnData,
        onClosed: mockOnClosed,
        onError: mockOnError,
      },
    } as any;
  });

  describe('Initial Rendering', () => {
    it('should render the terminal tab with toolbar', async () => {
      render(<TerminalTab isActive />);
      await waitFor(() => {
        expect(screen.getByText('Container')).toBeInTheDocument();
        expect(screen.getByText('User')).toBeInTheDocument();
        expect(screen.getByText('Open Terminal')).toBeInTheDocument();
      });
    });

    it('should load containers on mount', async () => {
      render(<TerminalTab isActive />);
      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });
    });

    it('should display empty state message when no sessions are open', async () => {
      render(<TerminalTab isActive />);
      await waitFor(() => {
        expect(screen.getByText('No active terminal sessions')).toBeInTheDocument();
      });
    });

    it('should show info message when no containers are available', async () => {
      mockListContainers.mockResolvedValue([]);
      render(<TerminalTab isActive />);
      await waitFor(() => {
        expect(
          screen.getByText(/No running containers found/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('Container Selection', () => {
    it('should populate container dropdown with available containers', async () => {
      render(<TerminalTab isActive />);
      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByText('test-container-1 (node:20)')).toBeInTheDocument();
      });
    });

    it('should auto-select first container if available', async () => {
      render(<TerminalTab isActive />);
      await waitFor(() => {
        const select = screen.getByLabelText(/container/i) as HTMLSelectElement;
        expect(select.value).toBe('docker:container1');
      });
    });

    it('should allow changing selected container', async () => {
      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      const select = screen.getByLabelText(/container/i) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: 'docker:container2' } });

      await waitFor(() => {
        expect(select.value).toBe('docker:container2');
      });
    });
  });

  describe('User Selection', () => {
    it('should render user selector with default and root options', async () => {
      render(<TerminalTab isActive />);
      await waitFor(() => {
        expect(screen.getByLabelText(/user/i)).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText('Default')).toBeInTheDocument();
        expect(screen.getByText('Root')).toBeInTheDocument();
      });
    });

    it('should default to "default" user', async () => {
      render(<TerminalTab isActive />);
      await waitFor(() => {
        const select = screen.getByLabelText(/user/i) as HTMLSelectElement;
        expect(select.value).toBe('default');
      });
    });

    it('should allow changing user selection', async () => {
      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(screen.getByLabelText(/user/i)).toBeInTheDocument();
      });

      const select = screen.getByLabelText(/user/i) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: 'root' } });

      await waitFor(() => {
        expect(select.value).toBe('root');
      });
    });
  });

  describe('Opening Terminal Sessions', () => {
    it('should open terminal session when button is clicked', async () => {
      mockTerminalOpen.mockResolvedValue({
        success: true,
        session: mockSession,
      });

      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      const button = screen.getByText('Open Terminal');
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockTerminalOpen).toHaveBeenCalledWith('container1', {
          user: undefined,
          shell: 'bash',
          rows: 24,
          cols: 80,
        });
      });
    });

    it('should pass user=root when root is selected', async () => {
      mockTerminalOpen.mockResolvedValue({
        success: true,
        session: mockSession,
      });

      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      const userSelect = screen.getByLabelText(/user/i);
      fireEvent.change(userSelect, { target: { value: 'root' } });

      const button = screen.getByText('Open Terminal');
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockTerminalOpen).toHaveBeenCalledWith('container1', {
          user: 'root',
          shell: 'bash',
          rows: 24,
          cols: 80,
        });
      });
    });

    it('should display loading state while opening terminal', async () => {
      let resolveOpen: any;
      mockTerminalOpen.mockReturnValue(new Promise((resolve) => {
        resolveOpen = resolve;
      }));

      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      const button = screen.getByText('Open Terminal');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Opening...')).toBeInTheDocument();
      });

      resolveOpen({ success: true, session: mockSession });
    });

    it('should display error when opening terminal fails', async () => {
      mockTerminalOpen.mockResolvedValue({
        success: false,
        error: 'Container not running',
      });

      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      const button = screen.getByText('Open Terminal');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText(/Container not running/i)).toBeInTheDocument();
      });
    });

    it('should disable Open Terminal button when no container is selected', async () => {
      // When no containers are available, selectedContainerId stays empty and the
      // button is disabled (disabled={loading || !selectedContainerId}). This prevents
      // the user from attempting to open a terminal with no container selected.
      mockListContainers.mockResolvedValue([]);

      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      const button = screen.getByText('Open Terminal');
      expect(button).toBeDisabled();
    });

    it('should create a new terminal session and display it', async () => {
      mockTerminalOpen.mockResolvedValue({
        success: true,
        session: mockSession,
      });

      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      const button = screen.getByText('Open Terminal');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByTestId('terminal-instance')).toBeInTheDocument();
      });
    });
  });

  describe('Session Tabs', () => {
    it('should display session tab after opening terminal', async () => {
      mockTerminalOpen.mockResolvedValue({
        success: true,
        session: mockSession,
      });

      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      const button = screen.getByText('Open Terminal');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText(/test-container-1/i)).toBeInTheDocument();
      });
    });

    it('should show user in tab label when specified', async () => {
      mockTerminalOpen.mockResolvedValue({
        success: true,
        session: { ...mockSession, user: 'root' },
      });

      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      const button = screen.getByText('Open Terminal');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText(/root/i)).toBeInTheDocument();
      });
    });

    it('should allow closing a session via close button', async () => {
      mockTerminalOpen.mockResolvedValue({
        success: true,
        session: mockSession,
      });
      mockTerminalClose.mockResolvedValue({ success: true });

      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      const button = screen.getByText('Open Terminal');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText(/test-container-1/i)).toBeInTheDocument();
      });

      const closeButton = screen.getByLabelText(/close session/i);
      fireEvent.click(closeButton);

      await waitFor(() => {
        expect(mockTerminalClose).toHaveBeenCalledWith('session-123');
      });
    });
  });

  describe('Terminal Data Flow', () => {
    it('should send terminal input via IPC write', async () => {
      mockTerminalOpen.mockResolvedValue({
        success: true,
        session: mockSession,
      });

      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      const button = screen.getByText('Open Terminal');
      fireEvent.click(button);

      // Wait for terminal to render (Terminal mock captures props into mockState)
      await waitFor(() => {
        expect(mockState.latestTerminalProps).not.toBeNull();
      });

      // Simulate user typing via the Terminal component's onData prop
      const onDataProp = mockState.latestTerminalProps?.onData;
      expect(onDataProp).toBeDefined();
      onDataProp('echo test\n');

      expect(mockTerminalWrite).toHaveBeenCalledWith('session-123', 'echo test\n');
    });

    it('should send resize events to IPC', async () => {
      mockTerminalOpen.mockResolvedValue({
        success: true,
        session: mockSession,
      });
      mockTerminalResize.mockResolvedValue({ success: true });

      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      const button = screen.getByText('Open Terminal');
      fireEvent.click(button);

      // Wait for terminal to render (Terminal mock captures props into mockState)
      await waitFor(() => {
        expect(mockState.latestTerminalProps).not.toBeNull();
      });

      // Simulate resize via the Terminal component's onResize prop
      const onResizeProp = mockState.latestTerminalProps?.onResize;
      expect(onResizeProp).toBeDefined();
      onResizeProp(100, 30);

      await waitFor(() => {
        expect(mockTerminalResize).toHaveBeenCalledWith('session-123', 100, 30);
      });
    });
  });

  describe('Session Lifecycle Events', () => {
    it('should mark session as disconnected when onClosed event is received', async () => {
      // The TerminalTab marks sessions as disconnected rather than removing them,
      // allowing the user to reconnect or manually close the session.
      mockTerminalOpen.mockResolvedValue({
        success: true,
        session: mockSession,
      });

      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      const button = screen.getByText('Open Terminal');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText(/test-container-1/i)).toBeInTheDocument();
      });

      // Simulate session closed event from IPC
      if (onClosedCallback) {
        onClosedCallback('session-123');
      }

      // Session should be marked disconnected (not removed) — shows reconnect UI
      await waitFor(() => {
        expect(screen.getByText('Session Disconnected')).toBeInTheDocument();
      });
    });

    it('should display error when onError event is received', async () => {
      mockTerminalOpen.mockResolvedValue({
        success: true,
        session: mockSession,
      });

      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalled();
      });

      const button = screen.getByText('Open Terminal');
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockTerminalOpen).toHaveBeenCalled();
      });

      // Simulate error event from IPC
      if (onErrorCallback) {
        onErrorCallback('session-123', 'Connection lost');
      }

      await waitFor(() => {
        expect(screen.getByText(/Connection lost/i)).toBeInTheDocument();
      });
    });
  });

  describe('Container Refresh', () => {
    it.skip('should refresh container list periodically', async () => {
      // Skipped: Requires vi.useFakeTimers() which conflicts with React 18's internal
      // scheduler that also uses setTimeout/MessageChannel. This causes React's
      // concurrent rendering to break in the test environment.
      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalledTimes(1);
      });

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalledTimes(2);
      });

      // Advance time by another 5 seconds
      vi.advanceTimersByTime(5000);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalledTimes(3);
      });
    });

    it.skip('should clean up interval on unmount', async () => {
      // Skipped: Same fake timers incompatibility as above.
      const { unmount } = render(<TerminalTab />);

      await waitFor(() => {
        expect(mockListContainers).toHaveBeenCalledTimes(1);
      });

      unmount();

      // Advance time and verify no more calls
      vi.advanceTimersByTime(10000);

      expect(mockListContainers).toHaveBeenCalledTimes(1);
    });
  });

  describe('Event Listener Cleanup', () => {
    it('should setup terminal event listeners', async () => {
      render(<TerminalTab isActive />);

      await waitFor(() => {
        expect(mockOnData).toHaveBeenCalled();
        expect(mockOnClosed).toHaveBeenCalled();
        expect(mockOnError).toHaveBeenCalled();
      });

      // Verify callbacks are registered and accessible for event simulation
      expect(onDataCallback).not.toBeNull();
      expect(onClosedCallback).not.toBeNull();
      expect(onErrorCallback).not.toBeNull();
    });
  });
});
