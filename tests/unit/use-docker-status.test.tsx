import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDockerStatus } from '../../src/renderer/hooks/useDockerStatus';

describe('useDockerStatus Hook', () => {
  let statusChangedCallback: ((available: boolean, info?: any) => void) | null = null;
  let cleanupFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    statusChangedCallback = null;
    cleanupFn = vi.fn();

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
          return cleanupFn;
        }),
      },
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial Status Query', () => {
    it('queries Docker status on mount', async () => {
      renderHook(() => useDockerStatus());

      await waitFor(() => {
        expect(global.window.api.docker.status).toHaveBeenCalledTimes(1);
      });
    });

    it('returns connected state when Docker is available', async () => {
      const { result } = renderHook(() => useDockerStatus());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.dockerInfo).toEqual({
          version: '24.0.7',
          containers: 5,
          images: 12,
          osType: 'linux',
          architecture: 'x86_64',
        });
      });
    });

    it('returns disconnected state when Docker is unavailable', async () => {
      global.window.api.docker.status = vi.fn().mockResolvedValue({
        available: false,
        info: undefined,
      });

      const { result } = renderHook(() => useDockerStatus());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(result.current.dockerInfo).toBeUndefined();
      });
    });

    it('handles status query errors gracefully', async () => {
      global.window.api.docker.status = vi.fn().mockRejectedValue(new Error('Connection failed'));

      const { result } = renderHook(() => useDockerStatus());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(result.current.dockerInfo).toBeUndefined();
      });
    });

    it('starts with disconnected state before initial query completes', () => {
      const { result } = renderHook(() => useDockerStatus());

      // Check initial state before async resolution
      expect(result.current.isConnected).toBe(false);
      expect(result.current.dockerInfo).toBeUndefined();
    });
  });

  describe('Status Change Subscription', () => {
    it('subscribes to status changes on mount', async () => {
      renderHook(() => useDockerStatus());

      await waitFor(() => {
        expect(global.window.api.docker.onStatusChanged).toHaveBeenCalledTimes(1);
        expect(global.window.api.docker.onStatusChanged).toHaveBeenCalledWith(
          expect.any(Function)
        );
      });
    });

    it('updates status when Docker connects', async () => {
      global.window.api.docker.status = vi.fn().mockResolvedValue({
        available: false,
        info: undefined,
      });

      const { result } = renderHook(() => useDockerStatus());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
      });

      // Simulate Docker connection
      if (statusChangedCallback) {
        statusChangedCallback(true, {
          version: '24.0.7',
          containers: 0,
          images: 0,
          osType: 'linux',
          architecture: 'x86_64',
        });
      }

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.dockerInfo?.version).toBe('24.0.7');
      });
    });

    it('updates status when Docker disconnects', async () => {
      const { result } = renderHook(() => useDockerStatus());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      // Simulate Docker disconnection
      if (statusChangedCallback) {
        statusChangedCallback(false, undefined);
      }

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(result.current.dockerInfo).toBeUndefined();
      });
    });

    it('handles multiple status changes', async () => {
      const { result } = renderHook(() => useDockerStatus());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      // Disconnect
      if (statusChangedCallback) {
        statusChangedCallback(false, undefined);
      }

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
      });

      // Reconnect
      if (statusChangedCallback) {
        statusChangedCallback(true, {
          version: '25.0.0',
          containers: 3,
          images: 5,
        });
      }

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.dockerInfo?.version).toBe('25.0.0');
      });
    });
  });

  describe('Cleanup', () => {
    it('calls cleanup function on unmount', async () => {
      const { unmount } = renderHook(() => useDockerStatus());

      await waitFor(() => {
        expect(global.window.api.docker.onStatusChanged).toHaveBeenCalled();
      });

      unmount();

      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });

    it('does not update state after unmount', async () => {
      const { result, unmount } = renderHook(() => useDockerStatus());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      unmount();

      // Try to trigger status change after unmount
      if (statusChangedCallback) {
        statusChangedCallback(false, undefined);
      }

      // State should remain as it was before unmount
      expect(result.current.isConnected).toBe(true);
    });
  });

  describe('Concurrent Operations', () => {
    it('handles rapid status changes correctly', async () => {
      const { result } = renderHook(() => useDockerStatus());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      // Simulate rapid status changes
      if (statusChangedCallback) {
        statusChangedCallback(false, undefined);
        statusChangedCallback(true, { version: '24.0.7', containers: 0, images: 0 });
        statusChangedCallback(false, undefined);
        statusChangedCallback(true, { version: '25.0.0', containers: 1, images: 2 });
      }

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.dockerInfo?.version).toBe('25.0.0');
      });
    });

    it('ignores status updates during initial query', async () => {
      // Create a slow initial query
      let resolveStatus: (value: any) => void;
      global.window.api.docker.status = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveStatus = resolve;
          })
      );

      const { result } = renderHook(() => useDockerStatus());

      // Trigger status change before initial query completes
      if (statusChangedCallback) {
        statusChangedCallback(false, undefined);
      }

      // Complete initial query
      resolveStatus!({
        available: true,
        info: { version: '24.0.7', containers: 0, images: 0 },
      });

      await waitFor(() => {
        // Should show connected from initial query, not disconnected from event
        expect(result.current.isConnected).toBe(true);
      });
    });
  });
});
