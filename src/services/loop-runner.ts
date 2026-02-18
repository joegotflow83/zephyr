/**
 * Loop execution orchestration for Zephyr Desktop.
 *
 * LoopRunner manages the lifecycle of Ralph loop executions:
 * - Creates and starts Docker containers for projects
 * - Streams and parses container logs in real-time
 * - Tracks loop state (iteration count, commits, errors)
 * - Enforces concurrency limits
 * - Notifies listeners of state changes and log events
 */

import type { DockerManager, ContainerInfo } from './docker-manager';
import type { LogParser, ParsedLogLine } from './log-parser';
import {
  LoopState,
  LoopStatus,
  LoopMode,
  LoopStartOpts,
  createLoopState,
  validateLoopStartOpts,
  isLoopTerminal,
} from '../shared/loop-types';

/**
 * Callback for loop state transitions
 */
export type StateChangeCallback = (state: LoopState) => void;

/**
 * Callback for parsed log lines
 */
export type LogLineCallback = (projectId: string, line: ParsedLogLine) => void;

/**
 * Orchestrates loop execution lifecycle.
 *
 * Responsibilities:
 * - Creating and starting Docker containers for loop execution
 * - Streaming and parsing container logs
 * - Tracking loop state (iteration, commits, errors)
 * - Enforcing concurrency limits (from app settings)
 * - Notifying registered callbacks on state changes and log lines
 */
export class LoopRunner {
  private docker: DockerManager;
  private parser: LogParser;
  private states: Map<string, LoopState> = new Map();
  private maxConcurrent: number;
  private stateCallbacks: Set<StateChangeCallback> = new Set();
  private logCallbacks: Set<LogLineCallback> = new Set();
  private logAbortControllers: Map<string, AbortController> = new Map();

  /**
   * Create a new LoopRunner.
   *
   * @param docker - DockerManager instance for container operations
   * @param parser - LogParser instance for log classification
   * @param maxConcurrent - Maximum number of concurrent loops (default: 3)
   */
  constructor(docker: DockerManager, parser: LogParser, maxConcurrent: number = 3) {
    this.docker = docker;
    this.parser = parser;
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Update the maximum concurrent loop limit.
   *
   * @param max - New maximum concurrent loops
   */
  setMaxConcurrent(max: number): void {
    if (max < 1) {
      throw new Error('maxConcurrent must be at least 1');
    }
    this.maxConcurrent = max;
  }

  /**
   * Get the current concurrency limit.
   */
  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  /**
   * Start a new loop execution.
   *
   * Creates a Docker container, starts it, and begins log streaming.
   * State transitions: IDLE -> STARTING -> RUNNING.
   *
   * @param opts - Loop start options (project ID, image, mode, env vars, volumes)
   * @returns The initial loop state
   * @throws Error if validation fails, Docker unavailable, or concurrency limit exceeded
   */
  async startLoop(opts: LoopStartOpts): Promise<LoopState> {
    // Validate options
    validateLoopStartOpts(opts);

    // Check if already running
    if (this.states.has(opts.projectId)) {
      throw new Error(`Loop for project ${opts.projectId} is already running`);
    }

    // Check concurrency limit
    const runningCount = this.listRunning().length;
    if (runningCount >= this.maxConcurrent) {
      throw new Error(
        `Concurrency limit reached: ${runningCount}/${this.maxConcurrent} loops running`,
      );
    }

    // Initialize state as IDLE
    const state = createLoopState(opts.projectId, opts.mode);
    this.states.set(opts.projectId, state);

    try {
      // Transition to STARTING
      this.updateState(opts.projectId, {
        status: LoopStatus.STARTING,
        startedAt: new Date().toISOString(),
      });

      // Create container
      const containerId = await this.docker.createContainer({
        image: opts.dockerImage,
        projectId: opts.projectId,
        name: `zephyr-${opts.projectId.substring(0, 8)}`,
        env: opts.envVars,
        workingDir: opts.workDir,
        volumes: this.parseVolumeMounts(opts.volumeMounts),
        autoRemove: false, // We manage cleanup
      });

      this.updateState(opts.projectId, { containerId });

      // Start container
      await this.docker.startContainer(containerId);

      // Transition to RUNNING
      this.updateState(opts.projectId, { status: LoopStatus.RUNNING });

      // Start log streaming
      this.startLogStream(opts.projectId, containerId, opts.mode);

      return this.states.get(opts.projectId)!;
    } catch (error) {
      // Mark as FAILED
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateState(opts.projectId, {
        status: LoopStatus.FAILED,
        error: `Failed to start loop: ${errorMessage}`,
        stoppedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  /**
   * Stop a running loop.
   *
   * Stops the container gracefully, aborts log streaming, and transitions to STOPPED.
   * State transitions: RUNNING -> STOPPING -> STOPPED.
   *
   * @param projectId - Project ID of the loop to stop
   * @throws Error if loop is not running or does not exist
   */
  async stopLoop(projectId: string): Promise<void> {
    const state = this.states.get(projectId);
    if (!state) {
      throw new Error(`No loop found for project ${projectId}`);
    }

    if (isLoopTerminal(state.status)) {
      throw new Error(`Loop for project ${projectId} is already in terminal state ${state.status}`);
    }

    if (!state.containerId) {
      // No container created yet, just mark as stopped
      this.updateState(projectId, {
        status: LoopStatus.STOPPED,
        stoppedAt: new Date().toISOString(),
      });
      return;
    }

    try {
      // Transition to STOPPING
      this.updateState(projectId, { status: LoopStatus.STOPPING });

      // Abort log streaming
      const abortController = this.logAbortControllers.get(projectId);
      if (abortController) {
        abortController.abort();
        this.logAbortControllers.delete(projectId);
      }

      // Stop container (10 second timeout)
      await this.docker.stopContainer(state.containerId, 10);

      // Transition to STOPPED
      this.updateState(projectId, {
        status: LoopStatus.STOPPED,
        stoppedAt: new Date().toISOString(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateState(projectId, {
        status: LoopStatus.FAILED,
        error: `Failed to stop loop: ${errorMessage}`,
        stoppedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  /**
   * Get the current state of a loop.
   *
   * @param projectId - Project ID to query
   * @returns Loop state or null if not found
   */
  getLoopState(projectId: string): LoopState | null {
    return this.states.get(projectId) || null;
  }

  /**
   * List all active loops (not in terminal states).
   *
   * @returns Array of loop states that are STARTING, RUNNING, or STOPPING
   */
  listRunning(): LoopState[] {
    return Array.from(this.states.values()).filter((state) => !isLoopTerminal(state.status));
  }

  /**
   * List all loops (including terminal states).
   *
   * @returns Array of all tracked loop states
   */
  listAll(): LoopState[] {
    return Array.from(this.states.values());
  }

  /**
   * Remove a loop from tracking.
   *
   * Only works for loops in terminal states (STOPPED, FAILED, COMPLETED).
   *
   * @param projectId - Project ID to remove
   * @throws Error if loop is still active
   */
  removeLoop(projectId: string): void {
    const state = this.states.get(projectId);
    if (!state) {
      return; // Already removed
    }

    if (!isLoopTerminal(state.status)) {
      throw new Error(`Cannot remove active loop for project ${projectId}`);
    }

    this.states.delete(projectId);
  }

  /**
   * Register a callback for loop state changes.
   *
   * @param callback - Function called when any loop state changes
   */
  onStateChange(callback: StateChangeCallback): void {
    this.stateCallbacks.add(callback);
  }

  /**
   * Unregister a state change callback.
   *
   * @param callback - The callback to remove
   */
  removeStateCallback(callback: StateChangeCallback): void {
    this.stateCallbacks.delete(callback);
  }

  /**
   * Register a callback for parsed log lines.
   *
   * @param callback - Function called for each parsed log line
   */
  onLogLine(callback: LogLineCallback): void {
    this.logCallbacks.add(callback);
  }

  /**
   * Unregister a log line callback.
   *
   * @param callback - The callback to remove
   */
  removeLogCallback(callback: LogLineCallback): void {
    this.logCallbacks.delete(callback);
  }

  // -- Private methods ----------------------------------------------------------

  /**
   * Update loop state and notify listeners.
   */
  private updateState(projectId: string, updates: Partial<LoopState>): void {
    const state = this.states.get(projectId);
    if (!state) {
      return;
    }

    // Apply updates
    Object.assign(state, updates);

    // Notify listeners
    this.stateCallbacks.forEach((callback) => {
      try {
        callback({ ...state }); // Pass a copy to prevent mutation
      } catch (error) {
        console.error('Error in state change callback:', error);
      }
    });
  }

  /**
   * Start streaming logs from a container.
   */
  private async startLogStream(
    projectId: string,
    containerId: string,
    mode: LoopMode,
  ): Promise<void> {
    try {
      const abortController = await this.docker.streamLogs(
        containerId,
        (line) => this.handleLogLine(projectId, line),
      );

      this.logAbortControllers.set(projectId, abortController);

      // When container exits, update state accordingly
      this.monitorContainerExit(projectId, containerId, mode);
    } catch (error) {
      console.error(`Failed to start log stream for ${projectId}:`, error);
      this.updateState(projectId, {
        status: LoopStatus.FAILED,
        error: `Log streaming failed: ${error instanceof Error ? error.message : String(error)}`,
        stoppedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Handle a single log line from a container.
   */
  private handleLogLine(projectId: string, line: string): void {
    const state = this.states.get(projectId);
    if (!state) {
      return;
    }

    // Parse the line
    const parsed = this.parser.parseLine(line);

    // Update state based on parsed content
    if (parsed.type === 'commit' && parsed.commit_hash) {
      // Track commit
      if (!state.commits.includes(parsed.commit_hash)) {
        state.commits.push(parsed.commit_hash);
        this.updateState(projectId, { commits: [...state.commits] });
      }
    } else if (parsed.type === 'error') {
      // Increment error count
      this.updateState(projectId, { errors: state.errors + 1 });
    }

    // Check for iteration boundary
    const iteration = this.parser.parseIterationBoundary(line);
    if (iteration !== null && iteration > state.iteration) {
      this.updateState(projectId, { iteration });
    }

    // Append to log buffer (limit to last 1000 lines to prevent memory issues)
    const logs = [...state.logs, line];
    if (logs.length > 1000) {
      logs.shift();
    }
    this.updateState(projectId, { logs });

    // Notify log listeners
    this.logCallbacks.forEach((callback) => {
      try {
        callback(projectId, parsed);
      } catch (error) {
        console.error('Error in log line callback:', error);
      }
    });
  }

  /**
   * Monitor container exit and update loop state accordingly.
   */
  private async monitorContainerExit(
    projectId: string,
    containerId: string,
    mode: LoopMode,
  ): Promise<void> {
    try {
      // Poll container status until it exits
      const checkInterval = 2000; // 2 seconds
      const maxPolls = 3600; // 2 hours max (2s * 3600 = 7200s)

      for (let i = 0; i < maxPolls; i++) {
        await new Promise((resolve) => setTimeout(resolve, checkInterval));

        const state = this.states.get(projectId);
        if (!state || isLoopTerminal(state.status)) {
          // Loop was stopped manually or already in terminal state
          return;
        }

        try {
          const status = await this.docker.getContainerStatus(containerId);

          if (status.state === 'exited' || status.state === 'dead') {
            // Container exited
            const stoppedAt = new Date().toISOString();

            // Determine final status based on mode and exit code
            if (mode === LoopMode.SINGLE) {
              this.updateState(projectId, {
                status: LoopStatus.COMPLETED,
                stoppedAt,
              });
            } else {
              // CONTINUOUS or SCHEDULED mode shouldn't exit normally
              this.updateState(projectId, {
                status: LoopStatus.FAILED,
                error: 'Container exited unexpectedly',
                stoppedAt,
              });
            }

            // Clean up abort controller
            this.logAbortControllers.delete(projectId);
            return;
          }
        } catch (error) {
          // Container no longer exists
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.updateState(projectId, {
            status: LoopStatus.FAILED,
            error: `Container lost: ${errorMessage}`,
            stoppedAt: new Date().toISOString(),
          });
          this.logAbortControllers.delete(projectId);
          return;
        }
      }

      // Timeout reached (2 hours)
      this.updateState(projectId, {
        status: LoopStatus.FAILED,
        error: 'Container monitoring timeout (2 hours)',
        stoppedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`Error monitoring container ${containerId}:`, error);
    }
  }

  /**
   * Parse volume mount strings into Docker format.
   *
   * Converts ["host:container", ...] to { host: "container", ... }
   */
  private parseVolumeMounts(
    volumeMounts?: string[],
  ): Record<string, string> | undefined {
    if (!volumeMounts || volumeMounts.length === 0) {
      return undefined;
    }

    const result: Record<string, string> = {};
    for (const mount of volumeMounts) {
      const [hostPath, containerPath] = mount.split(':');
      if (hostPath && containerPath) {
        result[hostPath] = containerPath;
      }
    }
    return result;
  }
}
