/**
 * Loop execution types for Zephyr Desktop.
 *
 * Defines the data structures for orchestrating Ralph loop execution
 * in Docker containers: execution modes, lifecycle states, and options.
 */

import type { VMConfig } from './models';

/**
 * How a loop should execute.
 *
 * - SINGLE: Runs one iteration then stops automatically
 * - CONTINUOUS: Runs indefinitely until explicitly stopped
 * - SCHEDULED: Runs at cron-like intervals managed by LoopScheduler
 */
export enum LoopMode {
  SINGLE = 'single',
  CONTINUOUS = 'continuous',
  SCHEDULED = 'scheduled',
}

/**
 * Current lifecycle state of a loop.
 *
 * State transitions:
 * - IDLE -> STARTING -> RUNNING -> COMPLETED | FAILED | STOPPING -> STOPPED
 * - RUNNING -> PAUSED -> RUNNING (pause/resume)
 * - Any state -> FAILED (on unrecoverable error)
 */
export enum LoopStatus {
  IDLE = 'idle',
  STARTING = 'starting',
  RUNNING = 'running',
  PAUSED = 'paused',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  FAILED = 'failed',
  COMPLETED = 'completed',
}

/**
 * Runtime state of a single loop execution.
 *
 * Tracks the association between a project and its Docker container,
 * current iteration count, detected commits, logs, errors, and timing.
 */
export interface LoopState {
  /** UUID of the project this loop belongs to */
  projectId: string;

  /** Human-readable project name */
  projectName: string;

  /** Docker container ID, or null if not yet created */
  containerId: string | null;

  /** Execution mode (single, continuous, scheduled) */
  mode: LoopMode;

  /** Current lifecycle status */
  status: LoopStatus;

  /** Number of completed loop iterations */
  iteration: number;

  /** ISO 8601 timestamp when the loop started, or null */
  startedAt: string | null;

  /** ISO 8601 timestamp when the loop stopped, or null */
  stoppedAt: string | null;

  /** Buffered log lines from container output */
  logs: string[];

  /** Git commit SHAs detected in container output */
  commits: string[];

  /** Error count (non-fatal warnings or recoverable errors) */
  errors: number;

  /** Fatal error message if status is FAILED, else null */
  error: string | null;

  /** Multipass VM name for VM-backed loops */
  vmName?: string;

  /** Sandbox type for this loop ('container' default, 'vm' for VM-backed) */
  sandboxType?: 'container' | 'vm';

  /** Factory role when this loop is part of a coding factory */
  role?: string;

  /** Unix timestamp (ms) of the last received log line — used for activity detection */
  lastLogAt?: number;
}

/**
 * Options for starting a loop execution.
 */
export interface LoopStartOpts {
  /** UUID of the project to execute */
  projectId: string;

  /** Human-readable project name, used to name the Docker container */
  projectName: string;

  /** Docker image to use (e.g., "anthropics/anthropic-quickstarts:latest") */
  dockerImage: string;

  /** Execution mode */
  mode: LoopMode;

  /** Environment variables to inject into container */
  envVars?: Record<string, string>;

  /** Volume mounts in Docker format ["host:container", ...] */
  volumeMounts?: string[];

  /** Working directory inside container */
  workDir?: string;

  /** User to run as inside container (e.g., "root" or "1000:1000") */
  user?: string;

  /** Whether to run in a VM sandbox instead of a plain container */
  sandboxType?: 'container' | 'vm';

  /** VM configuration; only used when sandboxType === 'vm' */
  vmConfig?: VMConfig;

  /**
   * Command override for the container.
   * When set, replaces the image's default CMD (e.g. "sleep infinity").
   * Used for single-mode runs to execute a specific agent task and exit.
   */
  cmd?: string[];

  /** Factory role when starting a loop as part of a coding factory */
  role?: string;
}

/**
 * Derive a unique key for a loop from its project ID and optional factory role.
 * Non-factory loops use just the projectId; factory loops use "projectId:role".
 */
export function getLoopKey(projectIdOrState: string | { projectId: string; role?: string }, role?: string): string {
  if (typeof projectIdOrState === 'string') {
    return role ? `${projectIdOrState}:${role}` : projectIdOrState;
  }
  return projectIdOrState.role
    ? `${projectIdOrState.projectId}:${projectIdOrState.role}`
    : projectIdOrState.projectId;
}

/**
 * Creates a new LoopState with default values.
 */
export function createLoopState(
  projectId: string,
  mode: LoopMode = LoopMode.SINGLE,
  projectName = '',
  role?: string,
): LoopState {
  return {
    projectId,
    projectName,
    containerId: null,
    mode,
    status: LoopStatus.IDLE,
    iteration: 0,
    startedAt: null,
    stoppedAt: null,
    logs: [],
    commits: [],
    errors: 0,
    error: null,
    role,
  };
}

/**
 * Checks if a loop is in a terminal state (no longer running).
 */
export function isLoopTerminal(status: LoopStatus): boolean {
  return [
    LoopStatus.STOPPED,
    LoopStatus.FAILED,
    LoopStatus.COMPLETED,
  ].includes(status);
}

/**
 * Checks if a loop is actively running (can produce output).
 */
export function isLoopActive(status: LoopStatus): boolean {
  return [LoopStatus.STARTING, LoopStatus.RUNNING].includes(status);
}

/**
 * Validates a LoopStartOpts object, throwing if invalid.
 */
export function validateLoopStartOpts(opts: LoopStartOpts): void {
  if (!opts.projectId || typeof opts.projectId !== 'string') {
    throw new Error('LoopStartOpts.projectId must be a non-empty string');
  }
  if (!opts.projectName || typeof opts.projectName !== 'string') {
    throw new Error('LoopStartOpts.projectName must be a non-empty string');
  }
  if (!opts.dockerImage || typeof opts.dockerImage !== 'string') {
    throw new Error('LoopStartOpts.dockerImage must be a non-empty string');
  }
  if (!Object.values(LoopMode).includes(opts.mode)) {
    throw new Error(
      `LoopStartOpts.mode must be one of: ${Object.values(LoopMode).join(', ')}`,
    );
  }
}
