import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRuntimeStatus } from '../../src/renderer/hooks/useRuntimeStatus';

describe('useRuntimeStatus Hook', () => {
  let statusChangedCallback: ((available: boolean, info?: any) => void) | null = null;
  let cleanupFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    statusChangedCallback = null;
    cleanupFn = vi.fn();

    global.window.api = {
      settings: {
        load: vi.fn().mockResolvedValue({
          container_runtime: 'docker',
          max_concurrent_containers: 3,
          notification_enabled: true,
          theme: 'system',
          log_level: 'INFO',
          anthropic_auth_method: 'api_key',
        }),
      },
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
    it('queries runtime status on mount', async () => {
      renderHook(() => useRuntimeStatus());

      await waitFor(() => {
        expect(global.window.api.docker.status).toHaveBeenCalledTimes(1);
      });
    });

    it('returns available state when runtime is available', async () => {
      const { result } = renderHook(() => useRuntimeStatus());

      await waitFor(() => {
        expect(result.current.available).toBe(true);
        expect(result.current.info).toEqual({
          version: '24.0.7',
          containers: 5,
          images: 12,
          osType: 'linux',
          architecture: 'x86_64',
        });
      });
    });

    it('includes runtimeType from settings', async () => {
      const { result } = renderHook(() => useRuntimeStatus());

      await waitFor(() => {
        expect(result.current.runtimeType).toBe('docker');
      });
    });

    it('returns podman runtimeType when settings say podman', async () => {
      global.window.api.settings.load = vi.fn().mockResolvedValue({
        container_runtime: 'podman',
        max_concurrent_containers: 3,
        notification_enabled: true,
        theme: 'system',
        log_level: 'INFO',
        anthropic_auth_method: 'api_key',
      });

      const { result } = renderHook(() => useRuntimeStatus());

      await waitFor(() => {
        expect(result.current.runtimeType).toBe('podman');
      });
    });

    it('returns unavailable state when runtime is not available', async () => {
      global.window.api.docker.status = vi.fn().mockResolvedValue({ available: false });

      const { result } = renderHook(() => useRuntimeStatus());

      await waitFor(() => {
        expect(result.current.available).toBe(false);
        expect(result.current.info).toBeUndefined();
      });
    });

    it('handles status query errors gracefully', async () => {
      global.window.api.docker.status = vi.fn().mockRejectedValue(new Error('Connection failed'));

      const { result } = renderHook(() => useRuntimeStatus());

      await waitFor(() => {
        expect(result.current.available).toBe(false);
        expect(result.current.info).toBeUndefined();
      });
    });

    it('handles settings load errors by defaulting to docker', async () => {
      global.window.api.settings.load = vi.fn().mockRejectedValue(new Error('Settings error'));

      const { result } = renderHook(() => useRuntimeStatus());

      await waitFor(() => {
        expect(result.current.runtimeType).toBe('docker');
      });
    });

    it('starts with unavailable state before initial query completes', () => {
      const { result } = renderHook(() => useRuntimeStatus());

      expect(result.current.available).toBe(false);
      expect(result.current.info).toBeUndefined();
    });
  });

  describe('Status Change Subscription', () => {
    it('subscribes to status changes on mount', async () => {
      renderHook(() => useRuntimeStatus());

      await waitFor(() => {
        expect(global.window.api.docker.onStatusChanged).toHaveBeenCalledTimes(1);
        expect(global.window.api.docker.onStatusChanged).toHaveBeenCalledWith(
          expect.any(Function)
        );
      });
    });

    it('updates status when runtime becomes available', async () => {
      global.window.api.docker.status = vi.fn().mockResolvedValue({ available: false });

      const { result } = renderHook(() => useRuntimeStatus());

      await waitFor(() => {
        expect(result.current.available).toBe(false);
      });

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
        expect(result.current.available).toBe(true);
        expect(result.current.info?.version).toBe('24.0.7');
      });
    });

    it('updates status when runtime becomes unavailable', async () => {
      const { result } = renderHook(() => useRuntimeStatus());

      await waitFor(() => {
        expect(result.current.available).toBe(true);
      });

      if (statusChangedCallback) {
        statusChangedCallback(false, undefined);
      }

      await waitFor(() => {
        expect(result.current.available).toBe(false);
        expect(result.current.info).toBeUndefined();
      });
    });

    it('preserves runtimeType across status changes', async () => {
      const { result } = renderHook(() => useRuntimeStatus());

      await waitFor(() => {
        expect(result.current.runtimeType).toBe('docker');
      });

      if (statusChangedCallback) {
        statusChangedCallback(false, undefined);
      }

      await waitFor(() => {
        expect(result.current.runtimeType).toBe('docker');
      });
    });
  });

  describe('Cleanup', () => {
    it('calls cleanup function on unmount', async () => {
      const { unmount } = renderHook(() => useRuntimeStatus());

      await waitFor(() => {
        expect(global.window.api.docker.onStatusChanged).toHaveBeenCalled();
      });

      unmount();

      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });

    it('does not update state after unmount', async () => {
      const { result, unmount } = renderHook(() => useRuntimeStatus());

      await waitFor(() => {
        expect(result.current.available).toBe(true);
      });

      unmount();

      if (statusChangedCallback) {
        statusChangedCallback(false, undefined);
      }

      expect(result.current.available).toBe(true);
    });
  });
});
