import { DockerManager } from './docker-manager';

/**
 * Callback type for Docker status change events
 */
export type DockerStatusChangeCallback = (isAvailable: boolean) => void;

/**
 * DockerHealthMonitor - monitors Docker daemon availability via periodic polling
 *
 * This service:
 * - Periodically checks Docker daemon availability
 * - Tracks connection state (connected/disconnected)
 * - Fires callbacks only on state transitions (not every poll)
 * - Provides start/stop control for polling
 *
 * Intended usage in Electron main process:
 * - Start monitoring on app startup
 * - Register callbacks that emit IPC events to renderer
 * - Stop monitoring on app quit
 */
export class DockerHealthMonitor {
  private dockerManager: DockerManager;
  private intervalId: NodeJS.Timeout | null = null;
  private lastKnownStatus: boolean | null = null;
  private callbacks: DockerStatusChangeCallback[] = [];
  private defaultIntervalMs = 30000; // 30 seconds

  /**
   * Create a new DockerHealthMonitor
   * @param dockerManager - DockerManager instance to check availability
   */
  constructor(dockerManager: DockerManager) {
    this.dockerManager = dockerManager;
  }

  /**
   * Start monitoring Docker daemon availability
   * @param intervalMs - Polling interval in milliseconds (default: 5000)
   */
  start(intervalMs?: number): void {
    // If already running, stop first
    if (this.intervalId !== null) {
      this.stop();
    }

    const interval = intervalMs ?? this.defaultIntervalMs;

    // Immediately check status on start
    this.checkStatus();

    // Then poll at interval
    this.intervalId = setInterval(() => {
      this.checkStatus();
    }, interval);
  }

  /**
   * Stop monitoring Docker daemon availability
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Register a callback to be invoked on status transitions
   * @param callback - Function to call when Docker availability changes
   */
  onStatusChange(callback: DockerStatusChangeCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Remove a previously registered callback
   * @param callback - The callback to remove
   */
  removeCallback(callback: DockerStatusChangeCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index !== -1) {
      this.callbacks.splice(index, 1);
    }
  }

  /**
   * Get the current known Docker availability status
   * @returns true if Docker was last known to be available, false if unavailable, null if not yet checked
   */
  getLastKnownStatus(): boolean | null {
    return this.lastKnownStatus;
  }

  /**
   * Check Docker status and fire callbacks if state has changed
   */
  private async checkStatus(): Promise<void> {
    try {
      const isAvailable = await this.dockerManager.isDockerAvailable();

      // Only fire callbacks if status has changed
      if (this.lastKnownStatus !== isAvailable) {
        this.lastKnownStatus = isAvailable;

        // Invoke all registered callbacks
        for (const callback of this.callbacks) {
          try {
            callback(isAvailable);
          } catch (error) {
            // Log error but don't stop processing other callbacks
            console.error('Error in DockerHealthMonitor callback:', error);
          }
        }
      }
    } catch (error) {
      // If checking fails, treat as unavailable
      console.error('Error checking Docker availability:', error);

      if (this.lastKnownStatus !== false) {
        this.lastKnownStatus = false;

        // Fire callbacks for transition to unavailable
        for (const callback of this.callbacks) {
          try {
            callback(false);
          } catch (error) {
            console.error('Error in DockerHealthMonitor callback:', error);
          }
        }
      }
    }
  }

  /**
   * Check if monitoring is currently active
   * @returns true if monitoring is running, false otherwise
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }
}
