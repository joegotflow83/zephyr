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

import fs from 'fs';
import os from 'os';
import path from 'path';

import type { ContainerRuntime, ContainerSummary, LogStream } from './container-runtime';
import type { LogParser, ParsedLogLine } from './log-parser';
import type { VMManager, VMInfo } from './vm-manager';
import type { VMConfig } from '../shared/models';
import {
  LoopState,
  LoopStatus,
  LoopMode,
  LoopStartOpts,
  createLoopState,
  validateLoopStartOpts,
  isLoopTerminal,
  getLoopKey,
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
  private docker: ContainerRuntime;
  private parser: LogParser;
  private vm?: VMManager;
  private states: Map<string, LoopState> = new Map();
  private maxConcurrent: number;
  private stateCallbacks: Set<StateChangeCallback> = new Set();
  private logCallbacks: Set<LogLineCallback> = new Set();
  /** Log streams for direct container execution (non-VM path) */
  private logStreams: Map<string, LogStream> = new Map();
  /** Abort controllers for VM-backed execution (from streamExecInVM) */
  private vmLogAbortControllers: Map<string, AbortController> = new Map();
  /** Throttle timers for batching log-driven state broadcasts */
  private logBroadcastTimers: Map<string, NodeJS.Timeout> = new Map();
  /** Stores the VM name for each persistent-VM project across loop runs */
  private persistentVMNames: Map<string, string> = new Map();

  /**
   * Create a new LoopRunner.
   *
   * @param docker - ContainerRuntime instance for container operations
   * @param parser - LogParser instance for log classification
   * @param maxConcurrent - Maximum number of concurrent loops (default: 3)
   * @param vm - Optional VMManager for VM-backed loop execution
   */
  constructor(docker: ContainerRuntime, parser: LogParser, maxConcurrent = 3, vm?: VMManager) {
    this.docker = docker;
    this.parser = parser;
    this.maxConcurrent = maxConcurrent;
    this.vm = vm;
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

    const key = getLoopKey(opts.projectId, opts.role);

    // Check if already actively running — terminal states (COMPLETED, FAILED, STOPPED) can be restarted
    const existingState = this.states.get(key);
    if (existingState && !isLoopTerminal(existingState.status)) {
      throw new Error(`Loop for project ${opts.projectId}${opts.role ? ` (${opts.role})` : ''} is already running`);
    }
    // Clear stale terminal state so we start fresh
    if (existingState) {
      this.states.delete(key);
    }

    // Check concurrency limit
    const runningCount = this.listRunning().length;
    if (runningCount >= this.maxConcurrent) {
      throw new Error(
        `Concurrency limit reached: ${runningCount}/${this.maxConcurrent} loops running`,
      );
    }

    // Initialize state as IDLE
    const state = createLoopState(opts.projectId, opts.mode, opts.projectName, opts.role);
    this.states.set(key, state);

    // Branch to VM execution if requested
    if (opts.sandboxType === 'vm') {
      return this.vmStartLoop(opts);
    }

    try {
      // Transition to STARTING
      this.updateState(key, {
        status: LoopStatus.STARTING,
        startedAt: new Date().toISOString(),
      });

      // Derive a stable, Docker-safe container name from the project name.
      // Docker names must match [a-zA-Z0-9][a-zA-Z0-9_.-]*, so we lowercase,
      // replace any invalid characters with hyphens, and trim leading hyphens.
      // For factory roles, append the role to avoid name collisions.
      const safeName = opts.projectName
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, '-')
        .replace(/^-+/, '') || opts.projectId.substring(0, 8);
      const containerName = opts.role ? `zephyr-${safeName}-${opts.role}` : `zephyr-${safeName}`;

      // Remove any stale (stopped/exited) container with this name so we can
      // reuse it on subsequent runs.
      await this.removeStaleContainer(containerName);

      // Create container
      const containerId = await this.docker.createContainer({
        image: opts.dockerImage,
        projectId: opts.projectId,
        name: containerName,
        command: opts.cmd,
        env: opts.envVars,
        workingDir: opts.workDir,
        binds: opts.volumeMounts,
        autoRemove: false, // We manage cleanup
      });

      this.updateState(key, { containerId });

      // Start container
      await this.docker.startContainer(containerId);

      // Transition to RUNNING
      this.updateState(key, { status: LoopStatus.RUNNING });

      // Start log streaming
      this.startLogStream(key, containerId, opts.mode);

      return this.states.get(key)!;
    } catch (error) {
      // Mark as FAILED
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateState(key, {
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
  async stopLoop(projectId: string, role?: string): Promise<void> {
    const key = getLoopKey(projectId, role);
    const state = this.states.get(key);
    if (!state) {
      throw new Error(`No loop found for project ${projectId}${role ? ` (${role})` : ''}`);
    }

    if (isLoopTerminal(state.status)) {
      throw new Error(`Loop for project ${projectId}${role ? ` (${role})` : ''} is already in terminal state ${state.status}`);
    }

    // VM-backed loop path
    if (state.sandboxType === 'vm' && state.vmName) {
      return this.vmStopLoop(key, state.vmName);
    }

    if (!state.containerId) {
      // No container created yet, just mark as stopped
      this.updateState(key, {
        status: LoopStatus.STOPPED,
        stoppedAt: new Date().toISOString(),
      });
      return;
    }

    try {
      // Transition to STOPPING
      this.updateState(key, { status: LoopStatus.STOPPING });

      // Stop log streaming and pending broadcast
      const logStream = this.logStreams.get(key);
      if (logStream) {
        logStream.stop();
        this.logStreams.delete(key);
      }
      this.clearLogBroadcastTimer(key);

      // Stop container (10 second timeout)
      await this.docker.stopContainer(state.containerId, 10);

      // Transition to STOPPED
      this.updateState(key, {
        status: LoopStatus.STOPPED,
        stoppedAt: new Date().toISOString(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateState(key, {
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
  getLoopState(projectId: string, role?: string): LoopState | null {
    return this.states.get(getLoopKey(projectId, role)) || null;
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
   * List all loops belonging to a given project (used for factory multi-container projects).
   */
  listByProject(projectId: string): LoopState[] {
    return Array.from(this.states.values()).filter((s) => s.projectId === projectId);
  }

  /**
   * Remove a loop from tracking.
   *
   * Only works for loops in terminal states (STOPPED, FAILED, COMPLETED).
   *
   * @param projectId - Project ID to remove
   * @throws Error if loop is still active
   */
  removeLoop(projectId: string, role?: string): void {
    const key = getLoopKey(projectId, role);
    const state = this.states.get(key);
    if (!state) {
      return; // Already removed
    }

    if (!isLoopTerminal(state.status)) {
      throw new Error(`Cannot remove active loop for project ${projectId}${role ? ` (${role})` : ''}`);
    }

    this.clearLogBroadcastTimer(key);
    this.states.delete(key);
  }

  /**
   * Recover loops from existing containers after app restart.
   *
   * This method re-attaches to running containers that survived an app restart
   * (e.g., after a force-quit). It skips containers for deleted projects and
   * respects the concurrency limit.
   *
   * @param containers - List of containers to attempt recovery from
   * @param projectStore - ProjectStore instance to check if projects still exist
   * @returns Array of project IDs that were successfully recovered
   */
  async recoverLoops(
    containers: ContainerSummary[],
    projectStore: { getProject: (id: string) => { id: string } | null },
  ): Promise<string[]> {
    const recovered: string[] = [];

    for (const container of containers) {
      let projectId: string | undefined;
      try {
        // Extract project ID from container info
        projectId = container.projectId;
        if (!projectId) {
          continue; // Skip containers without project ID
        }

        // Skip if already tracked
        if (this.states.has(projectId)) {
          continue;
        }

        // Skip non-running containers (e.g., stopped containers from a previous session)
        if (container.state !== 'running') {
          continue;
        }

        // Skip if project was deleted
        const project = projectStore.getProject(projectId);
        if (!project) {
          continue;
        }

        // Check concurrency limit
        const runningCount = this.listRunning().length;
        if (runningCount >= this.maxConcurrent) {
          break; // Stop recovering if we hit the limit
        }

        // Create loop state for the recovered container
        // We don't know the original mode, so default to CONTINUOUS
        const state = createLoopState(projectId, LoopMode.CONTINUOUS);
        state.containerId = container.id;
        state.status = LoopStatus.RUNNING;
        state.startedAt = container.created;

        this.states.set(projectId, state);

        // Resume log streaming from the point the container started
        await this.resumeLogStream(projectId, container.id, container.created);

        recovered.push(projectId);
      } catch (error) {
        console.error(`Failed to recover container ${container.id}:`, error);
        // Remove the failed state if we added it
        if (projectId) {
          this.states.delete(projectId);
        }
        // Continue with next container
      }
    }

    return recovered;
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

  // -- VM management public API ------------------------------------------------

  /**
   * Start a persistent VM for a project (independent of loop execution).
   * Called by IPC handlers to pre-warm or restart a persistent VM.
   *
   * @param projectId - Project ID whose VM to start
   * @returns Current VMInfo after starting
   * @throws if VMManager is not configured or VM is not found
   */
  async startProjectVM(projectId: string, vmConfig?: VMConfig): Promise<VMInfo> {
    if (!this.vm) {
      throw new Error('VMManager is not configured');
    }

    let vmName = this.persistentVMNames.get(projectId);
    if (!vmName) {
      // In-memory map is empty (e.g. after app restart). Try to rediscover the
      // VM by matching the project ID prefix embedded in the VM name.
      const prefix = `zephyr-${projectId.slice(0, 8)}-`;
      const vms = await this.vm.listVMs();
      const match = vms.find((v) => v.name.startsWith(prefix));
      if (match) {
        vmName = match.name;
        this.persistentVMNames.set(projectId, vmName);
      } else if (vmConfig) {
        // VM has never been created — provision it now using the project's VM config.
        vmName = this.vm.generatePersistentVMName(projectId);
        this.persistentVMNames.set(projectId, vmName);
        await this.vm.createVM({
          name: vmName,
          cpus: vmConfig.cpus ?? 2,
          memoryGb: vmConfig.memory_gb ?? 4,
          diskGb: vmConfig.disk_gb ?? 20,
          cloudInit: vmConfig.cloud_init,
          runtime: this.docker.runtimeType,
        });
        await this.vm.waitForCloudInit(vmName);
        const created = await this.vm.getVMInfo(vmName);
        return created ?? { name: vmName, state: 'Running', cpus: vmConfig.cpus ?? 2, memory: '', disk: '', release: '' };
      } else {
        throw new Error(`No persistent VM found for project ${projectId}`);
      }
    }

    const info = await this.vm.getVMInfo(vmName);
    if (!info) {
      throw new Error(`VM "${vmName}" not found`);
    }

    if (info.state !== 'Running') {
      await this.vm.startVM(vmName);
      const updated = await this.vm.getVMInfo(vmName);
      return updated ?? info;
    }

    return info;
  }

  /**
   * Stop a persistent VM for a project.
   * Refuses if a loop is actively running in the VM.
   *
   * @param projectId - Project ID whose VM to stop
   * @throws if VMManager is not configured, VM not found, or loop is running
   */
  async stopProjectVM(projectId: string): Promise<void> {
    if (!this.vm) {
      throw new Error('VMManager is not configured');
    }

    // Don't stop VM if a loop is actively running in it
    const state = this.states.get(projectId);
    if (state && !isLoopTerminal(state.status)) {
      throw new Error(`Cannot stop VM while a loop is running for project ${projectId}`);
    }

    let vmName = this.persistentVMNames.get(projectId);
    if (!vmName) {
      const prefix = `zephyr-${projectId.slice(0, 8)}-`;
      const vms = await this.vm.listVMs();
      const match = vms.find((v) => v.name.startsWith(prefix));
      if (!match) {
        throw new Error(`No persistent VM registered for project ${projectId}`);
      }
      vmName = match.name;
      this.persistentVMNames.set(projectId, vmName);
    }

    await this.vm.stopVM(vmName);
  }

  /**
   * Get VMInfo for a project's persistent VM.
   *
   * @param projectId - Project ID to query
   * @returns VMInfo or null if no VM is registered for this project
   */
  async getProjectVMInfo(projectId: string): Promise<VMInfo | null> {
    if (!this.vm) {
      return null;
    }

    let vmName = this.persistentVMNames.get(projectId);
    if (!vmName) {
      const prefix = `zephyr-${projectId.slice(0, 8)}-`;
      const vms = await this.vm.listVMs();
      const match = vms.find((v) => v.name.startsWith(prefix));
      if (!match) {
        return null;
      }
      vmName = match.name;
      this.persistentVMNames.set(projectId, vmName);
    }

    return this.vm.getVMInfo(vmName);
  }

  // -- Private methods ----------------------------------------------------------

  /**
   * Update loop state and notify listeners.
   */
  private updateState(loopKey: string, updates: Partial<LoopState>): void {
    const state = this.states.get(loopKey);
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
    loopKey: string,
    containerId: string,
    mode: LoopMode,
  ): Promise<void> {
    try {
      const logStream = await this.docker.streamLogs(
        containerId,
        (line) => this.handleLogLine(loopKey, line),
      );

      this.logStreams.set(loopKey, logStream);

      // React immediately when the log process ends naturally (container exited).
      // This fires before the next monitorContainerExit poll (up to 8s later),
      // allowing deploy key cleanup to happen right away instead of being delayed.
      logStream.onEnded?.(() => this.handleContainerExited(loopKey, containerId, mode));

      // Keep the polling loop as a fallback in case the log stream end event
      // is missed (e.g., the stream never started cleanly).
      this.monitorContainerExit(loopKey, containerId, mode);
    } catch (error) {
      console.error(`Failed to start log stream for ${loopKey}:`, error);
      this.updateState(loopKey, {
        status: LoopStatus.FAILED,
        error: `Log streaming failed: ${error instanceof Error ? error.message : String(error)}`,
        stoppedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Resume log streaming from a container (used during recovery).
   *
   * Similar to startLogStream but uses a 'since' timestamp to avoid
   * re-processing logs from before the app restart.
   * Throws errors to allow the caller to handle recovery failures.
   */
  private async resumeLogStream(
    loopKey: string,
    containerId: string,
    sinceTimestamp: string,
  ): Promise<void> {
    // Convert ISO timestamp to Unix timestamp (seconds since epoch)
    const since = Math.floor(new Date(sinceTimestamp).getTime() / 1000);

    const logStream = await this.docker.streamLogs(
      containerId,
      (line) => this.handleLogLine(loopKey, line),
      since,
    );

    this.logStreams.set(loopKey, logStream);

    logStream.onEnded?.(() => this.handleContainerExited(loopKey, containerId, LoopMode.CONTINUOUS));

    // Monitor container exit (assuming CONTINUOUS mode for recovered loops)
    this.monitorContainerExit(loopKey, containerId, LoopMode.CONTINUOUS);
  }

  /**
   * Immediately handle a container that has exited on its own.
   *
   * Called by the LogStream.onEnded callback when the log process closes
   * naturally (i.e., the container stopped without stopLoop() being invoked).
   * Performs the same state transition as monitorContainerExit() but without
   * the polling delay, so deploy key cleanup triggers right away.
   */
  private async handleContainerExited(
    loopKey: string,
    containerId: string,
    mode: LoopMode,
  ): Promise<void> {
    const state = this.states.get(loopKey);
    if (!state || isLoopTerminal(state.status) || state.status === LoopStatus.STOPPING) {
      // Already handled — manual stop or prior terminal transition.
      return;
    }

    const stoppedAt = new Date().toISOString();

    try {
      const status = await this.docker.getContainerStatus(containerId);
      if (status.state === 'exited' || status.state === 'dead') {
        if (mode === LoopMode.SINGLE) {
          this.updateState(loopKey, { status: LoopStatus.COMPLETED, stoppedAt });
        } else {
          this.updateState(loopKey, {
            status: LoopStatus.FAILED,
            error: 'Container exited unexpectedly',
            stoppedAt,
          });
        }
        this.logStreams.delete(loopKey);
        this.clearLogBroadcastTimer(loopKey);
      }
      // If status is still 'running', the log stream ended for another reason;
      // monitorContainerExit will catch the eventual exit on the next poll.
    } catch {
      // Container no longer exists — treat as lost.
      this.updateState(loopKey, {
        status: LoopStatus.FAILED,
        error: 'Container lost',
        stoppedAt,
      });
      this.logStreams.delete(loopKey);
      this.clearLogBroadcastTimer(loopKey);
    }
  }

  /**
   * Handle a single log line from a container.
   *
   * PERFORMANCE: Log buffer updates are done in-place without broadcasting
   * state changes. A throttled timer broadcasts the full state at most once
   * per second, preventing IPC storms when logs stream at 100+ lines/sec.
   * Meaningful events (commits, errors, iterations) still broadcast immediately.
   */
  private handleLogLine(loopKey: string, line: string): void {
    const state = this.states.get(loopKey);
    if (!state) {
      return;
    }

    // Parse the line
    const parsed = this.parser.parseLine(line);

    // Update state for meaningful events (broadcast immediately)
    if (parsed.type === 'commit' && parsed.commit_hash) {
      if (!state.commits.includes(parsed.commit_hash)) {
        state.commits.push(parsed.commit_hash);
        this.updateState(loopKey, { commits: [...state.commits] });
      }
    } else if (parsed.type === 'error') {
      this.updateState(loopKey, { errors: state.errors + 1 });
    }

    const iteration = this.parser.parseIterationBoundary(line);
    if (iteration !== null && iteration > state.iteration) {
      this.updateState(loopKey, { iteration });
    }

    // Track last log activity timestamp for activity detection
    state.lastLogAt = Date.now();

    // Update log buffer in-place (no broadcast per line)
    state.logs.push(line);
    if (state.logs.length > 1000) {
      state.logs.shift();
    }

    // Schedule a throttled state broadcast for log updates (once per second)
    if (!this.logBroadcastTimers.has(loopKey)) {
      this.logBroadcastTimers.set(loopKey, setTimeout(() => {
        this.logBroadcastTimers.delete(loopKey);
        const currentState = this.states.get(loopKey);
        if (currentState) {
          this.stateCallbacks.forEach((callback) => {
            try {
              callback({ ...currentState });
            } catch (error) {
              console.error('Error in state change callback:', error);
            }
          });
        }
      }, 1000));
    }

    // Notify log listeners
    this.logCallbacks.forEach((callback) => {
      try {
        callback(state.projectId, parsed);
      } catch (error) {
        console.error('Error in log line callback:', error);
      }
    });
  }

  /**
   * Clear a pending log broadcast timer for a loop.
   */
  private clearLogBroadcastTimer(loopKey: string): void {
    const timer = this.logBroadcastTimers.get(loopKey);
    if (timer) {
      clearTimeout(timer);
      this.logBroadcastTimers.delete(loopKey);
    }
  }

  /**
   * Monitor container exit and update loop state accordingly.
   */
  private async monitorContainerExit(
    loopKey: string,
    containerId: string,
    mode: LoopMode,
  ): Promise<void> {
    try {
      // Poll container status until it exits
      const checkInterval = 8000; // 8 seconds

      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, checkInterval));

        const state = this.states.get(loopKey);
        if (!state || isLoopTerminal(state.status) || state.status === LoopStatus.STOPPING) {
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
              this.updateState(loopKey, {
                status: LoopStatus.COMPLETED,
                stoppedAt,
              });
            } else {
              // CONTINUOUS or SCHEDULED mode shouldn't exit normally
              this.updateState(loopKey, {
                status: LoopStatus.FAILED,
                error: 'Container exited unexpectedly',
                stoppedAt,
              });
            }

            // Clean up
            this.logStreams.delete(loopKey);
            this.clearLogBroadcastTimer(loopKey);
            return;
          }
        } catch (error) {
          // Container no longer exists
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.updateState(loopKey, {
            status: LoopStatus.FAILED,
            error: `Container lost: ${errorMessage}`,
            stoppedAt: new Date().toISOString(),
          });
          this.logStreams.delete(loopKey);
          this.clearLogBroadcastTimer(loopKey);
          return;
        }
      }
    } catch (error) {
      console.error(`Error monitoring container ${containerId}:`, error);
    }
  }

  /**
   * Remove a stopped/exited container by name, if one exists.
   * Silently ignores errors so a failed removal never blocks a new run.
   */
  private async removeStaleContainer(name: string): Promise<void> {
    try {
      const containers = await this.docker.listContainers();
      const stale = containers.find(
        // 'stopped' is Podman's state string for stopped containers; Docker uses 'exited'.
        (c) => c.name === name && (c.state === 'exited' || c.state === 'stopped' || c.state === 'created' || c.state === 'dead'),
      );
      if (stale) {
        await this.docker.removeContainer(stale.id);
      }
    } catch {
      // Best-effort — don't block the new container creation
    }
  }

  /**
   * Derive a Docker-safe container name from project name/id.
   * Used for both the host container path and the container-inside-VM name.
   */
  private deriveContainerName(projectName: string, projectId: string): string {
    return (
      projectName
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, '-')
        .replace(/^-+/, '') || projectId.substring(0, 8)
    );
  }

  /**
   * Build docker run CLI args from LoopStartOpts.
   * Produces: [-e KEY=VAL ...] [-v host:container ...] [-w dir] [-u user]
   */
  private buildDockerRunArgs(opts: LoopStartOpts): string[] {
    const args: string[] = [];

    if (opts.envVars) {
      for (const [key, value] of Object.entries(opts.envVars)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    if (opts.volumeMounts) {
      for (const mount of opts.volumeMounts) {
        args.push('-v', mount);
      }
    }

    if (opts.workDir) {
      args.push('-w', opts.workDir);
    }

    if (opts.user) {
      args.push('-u', opts.user);
    }

    return args;
  }

  /**
   * Execute a VM-backed loop. Called from startLoop() when sandboxType === 'vm'.
   *
   * Handles both persistent and ephemeral VM modes:
   * - Persistent: reuses (or creates) a named VM; VM survives loop end
   * - Ephemeral: creates a fresh VM per run, deleted on any terminal state
   *
   * State transitions: IDLE -> STARTING -> RUNNING (then COMPLETED/FAILED/STOPPED on exit)
   */
  private async vmStartLoop(opts: LoopStartOpts): Promise<LoopState> {
    const key = getLoopKey(opts.projectId, opts.role);
    if (!this.vm) {
      const errorMessage = 'VMManager is not configured';
      this.updateState(key, {
        status: LoopStatus.FAILED,
        error: errorMessage,
        stoppedAt: new Date().toISOString(),
      });
      throw new Error(errorMessage);
    }

    const { projectId, mode } = opts;
    const vmMode = opts.vmConfig?.vm_mode ?? 'ephemeral';

    try {
      this.updateState(key, {
        status: LoopStatus.STARTING,
        startedAt: new Date().toISOString(),
        sandboxType: 'vm',
      });

      let vmName: string;

      if (vmMode === 'persistent') {
        // Reuse the stable VM name across runs.
        // After an app restart the in-memory map is empty, so fall back to
        // prefix-based discovery (same logic as startProjectVM / stopProjectVM)
        // before generating a brand-new name to avoid creating a duplicate VM.
        vmName = this.persistentVMNames.get(projectId);
        if (!vmName) {
          const prefix = `zephyr-${projectId.slice(0, 8)}-`;
          const vms = await this.vm.listVMs();
          const match = vms.find((v) => v.name.startsWith(prefix));
          vmName = match?.name ?? this.vm.generatePersistentVMName(projectId);
        }
        this.persistentVMNames.set(projectId, vmName);

        const vmInfo = await this.vm.getVMInfo(vmName);
        if (!vmInfo) {
          // VM doesn't exist yet — create and provision it
          await this.vm.createVM({
            name: vmName,
            cpus: opts.vmConfig?.cpus ?? 2,
            memoryGb: opts.vmConfig?.memory_gb ?? 4,
            diskGb: opts.vmConfig?.disk_gb ?? 20,
            cloudInit: opts.vmConfig?.cloud_init,
            runtime: this.docker.runtimeType,
          });
          await this.vm.waitForCloudInit(vmName);
        } else if (vmInfo.state === 'Stopped') {
          await this.vm.startVM(vmName);
        }
        // state === 'Running' → proceed immediately
      } else {
        // Ephemeral: create a fresh VM for this run
        vmName = this.vm.generateEphemeralVMName(projectId);
        await this.vm.createVM({
          name: vmName,
          cpus: opts.vmConfig?.cpus ?? 2,
          memoryGb: opts.vmConfig?.memory_gb ?? 4,
          diskGb: opts.vmConfig?.disk_gb ?? 20,
          cloudInit: opts.vmConfig?.cloud_init,
          runtime: this.docker.runtimeType,
        });
        await this.vm.waitForCloudInit(vmName);
      }

      // Record VM name in state
      this.updateState(key, { vmName });

      // If the image exists locally on the host (e.g. a locally-built Zephyr image),
      // export it and load it into the VM. Otherwise pull from the registry inside the VM.
      const isLocalImage = await this.docker.isImageAvailable(opts.dockerImage);
      if (isLocalImage) {
        await this.transferImageToVM(vmName, opts.dockerImage);
      } else {
        const pullResult = await this.vm.execInVM(vmName, [this.docker.runtimeType, 'pull', opts.dockerImage]);
        if (pullResult.exitCode !== 0) {
          throw new Error(`${this.docker.runtimeType} pull failed inside VM: ${pullResult.stderr || pullResult.stdout}`);
        }
      }

      // Mount host volume paths into the VM so docker can bind-mount them.
      // Volume mount strings are "hostPath:containerPath"; the host path must
      // exist inside the VM's filesystem for docker run -v to work. We mount
      // each host path at the same path inside the VM so the existing -v flags
      // need no translation. Best-effort: log warnings but don't abort the loop.
      if (opts.volumeMounts && opts.volumeMounts.length > 0) {
        for (const mount of opts.volumeMounts) {
          const hostPath = mount.split(':')[0];
          if (hostPath) {
            await this.vm!.mountIntoVM(vmName, hostPath, hostPath).catch((err) => {
              console.warn(`Failed to mount "${hostPath}" into VM ${vmName}:`, err);
            });
          }
        }
      }

      // Derive container name (reused for docker stop on manual stop)
      const containerName = this.deriveContainerName(opts.projectName, opts.projectId);

      // Remove any stale container left over from a previous run. This can
      // happen when the docker run client process is killed (e.g. on manual
      // stop) before Docker's --rm cleanup fires, leaving the named container
      // behind. Best-effort: ignore errors (container may not exist).
      await this.vm!.execInVM(vmName, [this.docker.runtimeType, 'rm', '-f', containerName]).catch(() => undefined);

      // Build docker run args
      const dockerRunArgs = this.buildDockerRunArgs(opts);
      // Podman rootless requires --userns=keep-id for bind mounts to have correct ownership
      const runtimeRunFlags = this.docker.runtimeType === 'podman' ? ['--userns=keep-id'] : [];

      // Transition to RUNNING before starting the stream
      this.updateState(key, { status: LoopStatus.RUNNING });

      // Stream container run output from inside the VM
      const abortController = await this.vm.streamExecInVM(
        vmName,
        [this.docker.runtimeType, 'run', '--rm', ...runtimeRunFlags, '--name', containerName, ...dockerRunArgs, opts.dockerImage],
        (line) => this.handleLogLine(key, line),
        {
          onExit: (exitCode) => {
            this.handleVMContainerExit(key, vmName, containerName, mode, vmMode, exitCode);
          },
        },
      );

      this.vmLogAbortControllers.set(key, abortController);

      return this.states.get(key)!;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateState(key, {
        status: LoopStatus.FAILED,
        error: `Failed to start VM loop: ${errorMessage}`,
        stoppedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  /**
   * Export a host-local Docker image and load it into a VM.
   *
   * Used when the project image was built locally on the host (e.g. via the
   * Zephyr image builder) and therefore doesn't exist in any remote registry.
   * Flow: docker save → write to host temp file → multipass transfer → docker load.
   */
  private async transferImageToVM(vmName: string, imageTag: string): Promise<void> {
    const tmpFile = path.join(os.tmpdir(), `zephyr-image-${Date.now()}.tar`);
    try {
      await this.docker.saveImage(imageTag, tmpFile);
      await this.vm!.transfer(vmName, tmpFile, '/tmp/zephyr-image.tar');
      const loadResult = await this.vm!.execInVM(vmName, [this.docker.runtimeType, 'load', '-i', '/tmp/zephyr-image.tar']);
      if (loadResult.exitCode !== 0) {
        throw new Error(`${this.docker.runtimeType} load failed inside VM: ${loadResult.stderr || loadResult.stdout}`);
      }
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
      // Best-effort removal of the tar inside the VM
      this.vm!.execInVM(vmName, ['rm', '-f', '/tmp/zephyr-image.tar']).catch(() => undefined);
    }
  }

  /**
   * Stop a VM-backed loop. Called from stopLoop() when sandboxType === 'vm'.
   *
   * Aborts the stream, stops the Docker container inside the VM, and for
   * ephemeral VMs also deletes the VM. Persistent VMs keep running.
   */
  private async vmStopLoop(loopKey: string, vmName: string): Promise<void> {
    const state = this.states.get(loopKey)!;

    try {
      this.updateState(loopKey, { status: LoopStatus.STOPPING });

      // Abort log streaming
      const abortController = this.vmLogAbortControllers.get(loopKey);
      if (abortController) {
        abortController.abort();
        this.vmLogAbortControllers.delete(loopKey);
      }

      // Stop the docker container running inside the VM
      const containerName = this.deriveContainerName(state.projectName, state.projectId);
      await this.vm!.execInVM(vmName, [this.docker.runtimeType, 'stop', containerName]);

      // For ephemeral VMs, delete the VM on stop; for persistent VMs, unmount
      // host directories that were mounted for this loop run.
      const isPersistent = this.persistentVMNames.has(state.projectId);
      if (!isPersistent) {
        await this.vm!.deleteVM(vmName, true).catch((err) => {
          console.error(`Failed to delete ephemeral VM ${vmName} on stop:`, err);
        });
      } else {
        await this.vm!.unmountFromVM(vmName).catch((err) => {
          console.error(`Failed to unmount directories from VM ${vmName} on stop:`, err);
        });
      }

      this.updateState(loopKey, {
        status: LoopStatus.STOPPED,
        stoppedAt: new Date().toISOString(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateState(loopKey, {
        status: LoopStatus.FAILED,
        error: `Failed to stop VM loop: ${errorMessage}`,
        stoppedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  /**
   * Handle a natural (non-manual) exit of the Docker container running inside a VM.
   * Mirrors monitorContainerExit() logic for the VM execution path.
   *
   * Called via the onExit callback from streamExecInVM when the docker run
   * process terminates. Skips update if state is already terminal (manual stop).
   */
  private handleVMContainerExit(
    loopKey: string,
    vmName: string,
    _containerName: string,
    mode: LoopMode,
    vmMode: 'persistent' | 'ephemeral',
    _exitCode: number,
  ): void {
    const state = this.states.get(loopKey);
    if (!state || isLoopTerminal(state.status) || state.status === LoopStatus.STOPPING) {
      // Already handled (e.g., stopLoop was called manually)
      return;
    }

    const stoppedAt = new Date().toISOString();

    if (mode === LoopMode.SINGLE) {
      this.updateState(loopKey, {
        status: LoopStatus.COMPLETED,
        stoppedAt,
      });
    } else {
      // CONTINUOUS or SCHEDULED should not exit on their own
      this.updateState(loopKey, {
        status: LoopStatus.FAILED,
        error: 'Container exited unexpectedly',
        stoppedAt,
      });
    }

    this.vmLogAbortControllers.delete(loopKey);
    this.clearLogBroadcastTimer(loopKey);

    // Clean up after the loop ends: delete ephemeral VMs; unmount host
    // directories from persistent VMs.
    if (vmMode === 'ephemeral') {
      this.vm!.deleteVM(vmName, true).catch((err) => {
        console.error(`Failed to delete ephemeral VM ${vmName} after exit:`, err);
      });
    } else {
      this.vm!.unmountFromVM(vmName).catch((err) => {
        console.error(`Failed to unmount directories from VM ${vmName} after exit:`, err);
      });
    }
  }
}
