/**
 * ContainerRuntime — the abstraction layer over container backends.
 *
 * Why this exists: Zephyr Desktop originally hard-coded Docker (via dockerode).
 * Adding Podman support required decoupling orchestration code (LoopRunner,
 * ImageBuilder, IPC handlers) from the concrete runtime. This interface is
 * that contract — every new runtime must implement it, and every consumer
 * depends only on it.
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/**
 * Runtime information returned by getInfo().
 * Mirrors the old DockerInfo but uses generic names.
 */
export interface RuntimeInfo {
  version: string;
  containers: number;
  images: number;
  osType?: string;
  architecture?: string;
}

/**
 * Options for creating a container.
 *
 * Uses `binds` (["host:container", ...]) rather than a map so that the same
 * type works naturally with both dockerode's HostConfig.Binds and podman CLI
 * --volume flags.
 */
export interface ContainerCreateOpts {
  image: string;
  /** Zephyr project ID — runtimes stamp this as a label on the container. */
  projectId: string;
  name?: string;
  command?: string[];
  env?: Record<string, string>;
  binds?: string[]; // ["hostPath:containerPath", ...]
  labels?: Record<string, string>;
  workingDir?: string;
  autoRemove?: boolean;
  capAdd?: string[];
  securityOpts?: string[];
  networkMode?: string;
  tty?: boolean;
}

/**
 * Filters for listContainers().
 */
export interface ContainerFilters {
  projectId?: string;
  label?: string[];
}

/**
 * High-level container summary returned by listContainers().
 */
export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: string;
  projectId?: string;
}

/**
 * Detailed container status returned by getContainerStatus().
 */
export interface ContainerStatus {
  id: string;
  state: 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead';
  status: string;
  startedAt?: string;
  finishedAt?: string;
}

/**
 * Result of a non-interactive exec command.
 */
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Options for a non-interactive exec command.
 */
export interface ExecOpts {
  user?: string;
  workingDir?: string;
  env?: string[];
}

/**
 * Options for creating an interactive PTY exec session.
 */
export interface ExecSessionOpts {
  shell?: string; // e.g. 'bash', 'sh'
  user?: string;
  workingDir?: string;
  env?: string[];
  rows?: number;
  cols?: number;
}

/**
 * Interactive exec session with a duplex stream for terminal I/O.
 */
export interface ExecSession {
  id: string;
  stream: NodeJS.ReadWriteStream;
}

/**
 * Handle returned by streamLogs() — call stop() to end the stream.
 */
export interface LogStream {
  stop(): void;
  /**
   * Register a callback invoked once when the stream ends naturally
   * (i.e., the container exited on its own — not because stop() was called).
   * Use this to trigger immediate cleanup rather than waiting for a poll cycle.
   */
  onEnded?(callback: () => void): void;
}

/**
 * Progress event emitted during image pulls and builds.
 */
export interface ProgressEvent {
  stream?: string;
  error?: string;
  status?: string;
  progress?: string;
  current?: number;
  total?: number;
}

/** Callback signature for log line streaming. */
export type LogCallback = (line: string) => void;

/** Callback signature for pull/build progress. */
export type ProgressCallback = (event: ProgressEvent) => void;

// ---------------------------------------------------------------------------
// ContainerRuntime interface
// ---------------------------------------------------------------------------

/**
 * ContainerRuntime is implemented by DockerRuntime and PodmanRuntime.
 *
 * All orchestration code (LoopRunner, ImageBuilder, IPC handlers) depends only
 * on this interface — never on a concrete class. The active runtime is chosen
 * at startup from AppSettings.container_runtime and injected everywhere.
 */
export interface ContainerRuntime {
  /** Identifies which backend is in use. */
  readonly runtimeType: 'docker' | 'podman';

  // ── Availability ──────────────────────────────────────────────────────────

  /**
   * Returns true when the runtime daemon / CLI is reachable.
   * On macOS/Windows with Podman this will return false if `podman machine`
   * is not running.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Returns runtime version and daemon-level counters.
   * Throws if the runtime is not available.
   */
  getInfo(): Promise<RuntimeInfo>;

  // ── Images ────────────────────────────────────────────────────────────────

  /** Returns true if the image exists in the local image store. */
  isImageAvailable(image: string): Promise<boolean>;

  /**
   * Pulls an image from a registry, optionally reporting per-layer progress.
   */
  pullImage(image: string, onProgress?: ProgressCallback): Promise<void>;

  /** Saves an image to a tar archive at outputPath. */
  saveImage(image: string, outputPath: string): Promise<void>;

  /**
   * Builds an image from a context directory that must contain a Dockerfile.
   * Build ARG values are passed as { KEY: "value" } pairs.
   */
  buildImage(
    contextDir: string,
    tag: string,
    buildArgs?: Record<string, string>,
    onProgress?: ProgressCallback
  ): Promise<void>;

  // ── Container lifecycle ───────────────────────────────────────────────────

  /**
   * Creates a container and returns its ID.
   * Every runtime stamps `zephyr-managed=true` and
   * `zephyr.project_id=<projectId>` as labels.
   */
  createContainer(opts: ContainerCreateOpts): Promise<string>;

  startContainer(id: string): Promise<void>;

  stopContainer(id: string, timeout?: number): Promise<void>;

  removeContainer(id: string, force?: boolean): Promise<void>;

  // ── Container introspection ───────────────────────────────────────────────

  /** Returns a detailed status snapshot for a single container. */
  getContainerStatus(id: string): Promise<ContainerStatus>;

  /**
   * Returns ISO 8601 creation timestamp, or null if the container does not
   * exist.
   */
  getContainerCreated(id: string): Promise<string | null>;

  /**
   * Lists all Zephyr-managed containers, optionally filtered.
   * Equivalent to `docker/podman ps --all --filter label=zephyr-managed=true`.
   */
  listContainers(filters?: ContainerFilters): Promise<ContainerSummary[]>;

  // ── Exec & logs ───────────────────────────────────────────────────────────

  /**
   * Runs a command inside a running container and waits for it to finish.
   * Suitable for scripted, non-interactive commands.
   */
  execCommand(id: string, cmd: string[], opts?: ExecOpts): Promise<ExecResult>;

  /**
   * Opens an interactive PTY session inside a running container.
   * The returned stream is bidirectional (stdin writes / stdout+stderr reads).
   */
  createExecSession(id: string, opts?: ExecSessionOpts): Promise<ExecSession>;

  /**
   * Resizes the PTY of an active exec session (e.g. after a terminal resize
   * event from xterm.js).
   */
  resizeExec(execId: string, rows: number, cols: number): Promise<void>;

  /**
   * Begins tailing a container's logs.
   * Each complete line is delivered to onLine.  Pass `since` (Unix timestamp)
   * to resume from a prior position.  Call the returned LogStream.stop() to
   * tear down the underlying process or stream.
   */
  streamLogs(id: string, onLine: LogCallback, since?: number): Promise<LogStream>;
}
