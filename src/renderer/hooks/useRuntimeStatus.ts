import { useState, useEffect } from 'react';

/**
 * Runtime info returned by the container runtime health monitor.
 * Mirrors RuntimeInfo from container-runtime.ts but defined here
 * as a renderer-side type to avoid importing from main-process services.
 */
export interface RuntimeInfo {
  version: string;
  containers: number;
  images: number;
  osType?: string;
  architecture?: string;
}

export interface RuntimeStatus {
  available: boolean;
  info?: RuntimeInfo;
  runtimeType: 'docker' | 'podman';
}

/**
 * React hook for subscribing to container runtime status changes.
 *
 * Why this exists: the old useDockerStatus was Docker-specific. This hook
 * is runtime-agnostic — it subscribes to RUNTIME_STATUS_CHANGED and also
 * reads the current container_runtime setting so callers know which runtime
 * is active without needing to load settings themselves.
 *
 * @returns RuntimeStatus with availability, info, and which runtime is active
 */
export function useRuntimeStatus(): RuntimeStatus {
  const [status, setStatus] = useState<RuntimeStatus>({
    available: false,
    info: undefined,
    runtimeType: 'docker',
  });

  useEffect(() => {
    let isMounted = true;

    const loadStatus = async () => {
      // Determine active runtime from settings
      let runtimeType: 'docker' | 'podman' = 'docker';
      try {
        const settings = await window.api.settings.load();
        runtimeType = settings.container_runtime ?? 'docker';
      } catch {
        // Default to docker if settings can't be loaded
      }

      // Query initial runtime availability
      try {
        const result = await window.api.docker.status();
        if (isMounted) {
          setStatus({
            available: result.available,
            // DockerInfo and RuntimeInfo are structurally identical; cast is safe
            info: result.available ? (result.info as unknown as RuntimeInfo) : undefined,
            runtimeType,
          });
        }
      } catch {
        if (isMounted) {
          setStatus({ available: false, info: undefined, runtimeType });
        }
      }
    };

    loadStatus();

    // Subscribe to runtime availability changes
    const cleanup = window.api.docker.onStatusChanged((isAvailable, info) => {
      if (isMounted) {
        setStatus((prev) => ({
          available: isAvailable,
          info: isAvailable ? (info as unknown as RuntimeInfo) : undefined,
          runtimeType: prev.runtimeType,
        }));
      }
    });

    return () => {
      isMounted = false;
      cleanup();
    };
  }, []);

  return status;
}
