import { ContainerRuntime } from './container-runtime';

/**
 * Callback type for runtime status change events
 */
export type RuntimeStatusChangeCallback = (isAvailable: boolean) => void;

/**
 * RuntimeHealthMonitor - monitors container runtime availability via periodic polling
 *
 * Works with any ContainerRuntime implementation (Docker, Podman, etc.).
 * Fires callbacks only on state transitions (not every poll), reducing noise.
 *
 * Intended usage in Electron main process:
 * - Start monitoring on app startup
 * - Register callbacks that emit IPC events to renderer (RUNTIME_STATUS_CHANGED)
 * - Stop monitoring on app quit
 */
export class RuntimeHealthMonitor {
  private runtime: ContainerRuntime;
  private intervalId: NodeJS.Timeout | null = null;
  private lastKnownStatus: boolean | null = null;
  private lastKnownVersion: string | null = null;
  private callbacks: RuntimeStatusChangeCallback[] = [];
  private defaultIntervalMs = 5000; // 5 seconds

  constructor(runtime: ContainerRuntime) {
    this.runtime = runtime;
  }

  /**
   * Start monitoring runtime availability
   * @param intervalMs - Polling interval in milliseconds (default: 5000)
   */
  start(intervalMs?: number): void {
    if (this.intervalId !== null) {
      this.stop();
    }

    const interval = intervalMs ?? this.defaultIntervalMs;

    // Immediately check status on start
    this.checkStatus();

    this.intervalId = setInterval(() => {
      this.checkStatus();
    }, interval);
  }

  /**
   * Stop monitoring runtime availability
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Register a callback to be invoked on status transitions
   */
  onStatusChange(callback: RuntimeStatusChangeCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Remove a previously registered callback
   */
  removeCallback(callback: RuntimeStatusChangeCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index !== -1) {
      this.callbacks.splice(index, 1);
    }
  }

  /**
   * Get the current known availability status.
   * Returns null if not yet checked.
   */
  getLastKnownStatus(): boolean | null {
    return this.lastKnownStatus;
  }

  /**
   * Check if monitoring is currently active
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Check runtime status and fire callbacks on state transitions or version changes
   */
  private async checkStatus(): Promise<void> {
    try {
      const isAvailable = await this.runtime.isAvailable();

      if (isAvailable) {
        let version: string | null = null;
        try {
          const info = await this.runtime.getInfo();
          version = info.version ?? null;
        } catch {
          // version stays null — availability still propagates correctly
        }

        const statusChanged = this.lastKnownStatus !== isAvailable;
        const versionChanged = version !== null && this.lastKnownVersion !== null && version !== this.lastKnownVersion;

        this.lastKnownStatus = isAvailable;
        this.lastKnownVersion = version;

        if (statusChanged || versionChanged) {
          this.fireCallbacks(isAvailable);
        }
      } else {
        if (this.lastKnownStatus !== isAvailable) {
          this.lastKnownStatus = isAvailable;
          this.lastKnownVersion = null;
          this.fireCallbacks(isAvailable);
        }
      }
    } catch (error) {
      console.error('Error checking runtime availability:', error);

      if (this.lastKnownStatus !== false) {
        this.lastKnownStatus = false;
        this.lastKnownVersion = null;
        this.fireCallbacks(false);
      }
    }
  }

  private fireCallbacks(isAvailable: boolean): void {
    for (const callback of this.callbacks) {
      try {
        callback(isAvailable);
      } catch (error) {
        console.error('Error in RuntimeHealthMonitor callback:', error);
      }
    }
  }
}
