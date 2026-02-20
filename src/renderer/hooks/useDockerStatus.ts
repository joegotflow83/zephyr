import { useState, useEffect } from 'react';
import { DockerInfo } from '../../services/docker-manager';

export interface DockerStatus {
  isConnected: boolean;
  dockerInfo?: DockerInfo;
}

/**
 * React hook for subscribing to Docker connection status changes.
 * Queries initial status on mount and listens for real-time updates via IPC.
 *
 * @returns DockerStatus object with connection state and optional Docker info
 */
export function useDockerStatus(): DockerStatus {
  const [status, setStatus] = useState<DockerStatus>({
    isConnected: false,
    dockerInfo: undefined,
  });

  useEffect(() => {
    let isMounted = true;

    // Query initial status
    window.api.docker
      .status()
      .then((result) => {
        if (isMounted) {
          setStatus({
            isConnected: result.available,
            dockerInfo: result.available ? result.info : undefined,
          });
        }
      })
      .catch(() => {
        // Silently handle errors (Docker might not be running yet)
        if (isMounted) {
          setStatus({ isConnected: false, dockerInfo: undefined });
        }
      });

    // Subscribe to status changes
    const cleanup = window.api.docker.onStatusChanged((available, info) => {
      if (isMounted) {
        setStatus({
          isConnected: available,
          dockerInfo: available ? (info as DockerInfo | undefined) : undefined,
        });
      }
    });

    return () => {
      isMounted = false;
      cleanup();
    };
  }, []);

  return status;
}
