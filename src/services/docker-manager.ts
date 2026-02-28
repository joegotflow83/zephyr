import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

import Dockerode from 'dockerode';
import { Readable } from 'stream';

/**
 * A single event emitted during a docker image build.
 */
export interface BuildProgressEvent {
  stream?: string;
  error?: string;
  status?: string;
  progress?: string;
}

/**
 * Docker information returned by getDockerInfo
 */
export interface DockerInfo {
  version: string;
  containers: number;
  images: number;
  osType?: string;
  architecture?: string;
}

/**
 * Options for creating a container
 */
export interface ContainerCreateOpts {
  image: string;
  projectId: string;
  name?: string;
  cmd?: string[];
  env?: Record<string, string>;
  workingDir?: string;
  volumes?: Record<string, string>; // hostPath: containerPath
  autoRemove?: boolean;
}

/**
 * Container status information
 */
export interface ContainerStatus {
  id: string;
  state: 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead';
  status: string; // Human-readable status string
  startedAt?: string;
  finishedAt?: string;
}

/**
 * Container information
 */
export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: string;
  projectId?: string;
}

/**
 * Result of a non-interactive exec command
 */
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Options for exec command execution
 */
export interface ExecCommandOpts {
  user?: string;
  workingDir?: string;
  env?: string[];
}

/**
 * Options for creating an interactive exec session
 */
export interface ExecSessionOpts {
  shell?: string; // e.g., 'bash', 'sh', 'zsh'
  user?: string;
  workingDir?: string;
  env?: string[];
  rows?: number;
  cols?: number;
}

/**
 * Interactive exec session with duplex stream
 */
export interface ExecSession {
  id: string;
  stream: NodeJS.ReadWriteStream;
}

/**
 * DockerManager - handles Docker daemon connection and container lifecycle
 *
 * This service provides methods for:
 * - Checking Docker availability
 * - Retrieving Docker daemon information
 * - Checking and pulling Docker images
 * - Creating and managing containers
 * - Container lifecycle operations (start, stop, remove)
 */
export class DockerManager {
  private docker: Dockerode;

  /**
   * Create a new DockerManager instance
   * @param dockerOpts - Optional Dockerode connection options (for testing)
   */
  constructor(dockerOpts?: Dockerode.DockerOptions) {
    // Auto-detect Docker socket if no options provided
    this.docker = new Dockerode(dockerOpts);
  }

  /**
   * Check if Docker daemon is available and responding
   * @returns true if Docker is available, false otherwise
   */
  async isDockerAvailable(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get information about the Docker daemon
   * @returns Docker daemon information including version and counts
   * @throws Error if Docker is not available
   */
  async getDockerInfo(): Promise<DockerInfo> {
    const info = await this.docker.info();
    const version = await this.docker.version();

    return {
      version: version.Version || 'unknown',
      containers: info.Containers || 0,
      images: info.Images || 0,
      osType: info.OSType,
      architecture: info.Architecture,
    };
  }

  /**
   * Check if a Docker image is available locally
   * @param image - Image name with optional tag (e.g., "ubuntu:22.04")
   * @returns true if image exists locally, false otherwise
   */
  async isImageAvailable(image: string): Promise<boolean> {
    try {
      await this.docker.getImage(image).inspect();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Save a Docker image to a tar file on disk.
   * @param tag - Image tag to save (e.g. "zephyr-python-dev:latest")
   * @param outputPath - Absolute path for the output tar file
   * @throws Error if the image is not found or write fails
   */
  async saveImage(tag: string, outputPath: string): Promise<void> {
    const image = this.docker.getImage(tag);
    const stream = (await image.get()) as Readable;
    const writeStream = createWriteStream(outputPath);
    await pipeline(stream, writeStream);
  }

  /**
   * Pull a Docker image from registry
   * @param image - Image name with optional tag (e.g., "ubuntu:22.04")
   * @param onProgress - Optional callback for pull progress updates
   * @throws Error if pull fails
   */
  async pullImage(
    image: string,
    onProgress?: (progress: { status: string; current?: number; total?: number }) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(image, (err: Error | undefined, stream: NodeJS.ReadableStream) => {
        if (err) {
          reject(err);
          return;
        }

        // Track progress per layer
        const layerProgress = new Map<string, { current: number; total: number }>();

        this.docker.modem.followProgress(
          stream,
          (err: Error | null, _output: unknown[]) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          },
          (event: {
            status?: string;
            id?: string;
            progressDetail?: { current?: number; total?: number };
          }) => {
            if (onProgress) {
              // Aggregate progress across all layers
              if (event.id && event.progressDetail) {
                layerProgress.set(event.id, {
                  current: event.progressDetail.current || 0,
                  total: event.progressDetail.total || 0,
                });

                // Calculate total progress
                let totalCurrent = 0;
                let totalSize = 0;
                layerProgress.forEach((progress) => {
                  totalCurrent += progress.current;
                  totalSize += progress.total;
                });

                onProgress({
                  status: event.status || 'pulling',
                  current: totalCurrent,
                  total: totalSize,
                });
              } else if (event.status) {
                // Status without progress (e.g., "Pull complete")
                onProgress({ status: event.status });
              }
            }
          }
        );
      });
    });
  }

  /**
   * Create a new container with Zephyr-specific labels
   * @param opts - Container creation options
   * @returns Container ID
   * @throws Error if container creation fails
   */
  async createContainer(opts: ContainerCreateOpts): Promise<string> {
    const { image, projectId, name, cmd, env, workingDir, volumes, autoRemove } = opts;

    // Build environment variables array
    const envArray = env ? Object.entries(env).map(([key, value]) => `${key}=${value}`) : undefined;

    // Build volume bindings
    const binds = volumes
      ? Object.entries(volumes).map(([hostPath, containerPath]) => `${hostPath}:${containerPath}`)
      : undefined;

    // Create container with Zephyr labels
    const container = await this.docker.createContainer({
      Image: image,
      name,
      Cmd: cmd,
      Env: envArray,
      WorkingDir: workingDir,
      Labels: {
        'zephyr-managed': 'true',
        'zephyr.project_id': projectId,
      },
      HostConfig: {
        Binds: binds,
        AutoRemove: autoRemove,
      },
    });

    return container.id;
  }

  /**
   * Start a container
   * @param id - Container ID
   * @throws Error if container start fails
   */
  async startContainer(id: string): Promise<void> {
    const container = this.docker.getContainer(id);
    await container.start();
  }

  /**
   * Stop a container
   * @param id - Container ID
   * @param timeout - Optional timeout in seconds (default: 10)
   * @throws Error if container stop fails
   */
  async stopContainer(id: string, timeout?: number): Promise<void> {
    const container = this.docker.getContainer(id);
    await container.stop({ t: timeout || 10 });
  }

  /**
   * Remove a container
   * @param id - Container ID
   * @param force - Force removal even if running
   * @throws Error if container removal fails
   */
  async removeContainer(id: string, force?: boolean): Promise<void> {
    const container = this.docker.getContainer(id);
    await container.remove({ force });
  }

  /**
   * Get container status
   * @param id - Container ID
   * @returns Container status information
   * @throws Error if container inspection fails
   */
  async getContainerStatus(id: string): Promise<ContainerStatus> {
    const container = this.docker.getContainer(id);
    const inspect = await container.inspect();

    return {
      id: inspect.Id,
      state: inspect.State.Status as ContainerStatus['state'],
      status: inspect.State.Status,
      startedAt: inspect.State.StartedAt,
      finishedAt: inspect.State.FinishedAt,
    };
  }

  /**
   * List running containers managed by Zephyr
   * @returns Array of container information
   */
  async listRunningContainers(): Promise<ContainerInfo[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: {
        label: ['zephyr-managed=true'],
      },
    });

    return containers.map((container) => ({
      id: container.Id,
      name: container.Names[0]?.replace(/^\//, '') || 'unknown',
      image: container.Image,
      state: container.State,
      status: container.Status,
      created: new Date(container.Created * 1000).toISOString(),
      projectId: container.Labels['zephyr.project_id'],
    }));
  }

  /**
   * Get container creation timestamp
   * @param id - Container ID
   * @returns ISO 8601 timestamp string, or null if container not found
   */
  async getContainerCreated(id: string): Promise<string | null> {
    try {
      const container = this.docker.getContainer(id);
      const inspect = await container.inspect();
      return inspect.Created;
    } catch (error) {
      return null;
    }
  }

  /**
   * Stream logs from a container
   * @param containerId - Container ID to stream logs from
   * @param onLine - Callback function called for each log line
   * @param since - Optional Unix timestamp to stream logs since (for resuming)
   * @returns AbortController to stop the stream
   * @throws Error if log streaming fails to start
   */
  async streamLogs(
    containerId: string,
    onLine: (line: string) => void,
    since?: number
  ): Promise<AbortController> {
    const container = this.docker.getContainer(containerId);
    const abortController = new AbortController();

    // Build log options
    const logOptions: {
      follow: true;
      stdout: boolean;
      stderr: boolean;
      timestamps: boolean;
      since?: number;
    } = {
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: true,
    };

    if (since !== undefined) {
      logOptions.since = since;
    }

    // Start streaming logs
    const stream = (await container.logs(logOptions)) as unknown as Readable;

    // Buffer for incomplete lines
    let buffer = '';

    // Handle data events
    stream.on('data', (chunk: Buffer) => {
      if (abortController.signal.aborted) {
        return;
      }

      // Docker multiplexes stdout/stderr with an 8-byte header
      // Format: [STREAM_TYPE, 0, 0, 0, SIZE1, SIZE2, SIZE3, SIZE4, ...PAYLOAD...]
      let offset = 0;
      const chunkBuffer = Buffer.from(chunk);

      while (offset < chunkBuffer.length) {
        // Check if we have at least the header (8 bytes)
        if (offset + 8 > chunkBuffer.length) {
          break;
        }

        // Read header
        // Byte 0: stream type (1=stdout, 2=stderr)
        // Bytes 4-7: payload size (big-endian uint32)
        const payloadSize =
          (chunkBuffer[offset + 4] << 24) |
          (chunkBuffer[offset + 5] << 16) |
          (chunkBuffer[offset + 6] << 8) |
          chunkBuffer[offset + 7];

        // Check if we have the full payload
        if (offset + 8 + payloadSize > chunkBuffer.length) {
          break;
        }

        // Extract payload
        const payload = chunkBuffer.subarray(offset + 8, offset + 8 + payloadSize).toString('utf8');

        // Add to buffer
        buffer += payload;

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim() && !abortController.signal.aborted) {
            onLine(line);
          }
        }

        offset += 8 + payloadSize;
      }
    });

    // Handle stream end
    stream.on('end', () => {
      // Process any remaining buffered data
      if (buffer.trim() && !abortController.signal.aborted) {
        onLine(buffer);
      }
      stream.destroy();
    });

    // Handle errors
    stream.on('error', (error: Error) => {
      if (!abortController.signal.aborted) {
        // Log error but don't throw - let the stream end naturally
        console.error(`Log stream error for container ${containerId}:`, error);
      }
      stream.destroy();
    });

    // Set up abort handling
    abortController.signal.addEventListener('abort', () => {
      stream.destroy();
    });

    return abortController;
  }

  /**
   * Execute a command in a container (non-interactive)
   * @param containerId - Container ID to execute command in
   * @param cmd - Command to execute (array of strings)
   * @param opts - Optional execution options (user, workingDir, env)
   * @returns ExecResult with exit code, stdout, and stderr
   * @throws Error if exec creation or execution fails
   */
  async execCommand(containerId: string, cmd: string[], opts?: ExecCommandOpts): Promise<ExecResult> {
    const container = this.docker.getContainer(containerId);

    // Create exec instance
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      User: opts?.user,
      WorkingDir: opts?.workingDir,
      Env: opts?.env,
    });

    // Start exec and get stream
    const stream = await exec.start({ Detach: false });

    // Collect stdout and stderr
    let stdout = '';
    let stderr = '';

    return new Promise((resolve, reject) => {
      // Docker multiplexes stdout/stderr with an 8-byte header
      stream.on('data', (chunk: Buffer) => {
        let offset = 0;
        const chunkBuffer = Buffer.from(chunk);

        while (offset < chunkBuffer.length) {
          // Check if we have at least the header (8 bytes)
          if (offset + 8 > chunkBuffer.length) {
            break;
          }

          // Read header
          // Byte 0: stream type (1=stdout, 2=stderr)
          const streamType = chunkBuffer[offset];
          // Bytes 4-7: payload size (big-endian uint32)
          const payloadSize =
            (chunkBuffer[offset + 4] << 24) |
            (chunkBuffer[offset + 5] << 16) |
            (chunkBuffer[offset + 6] << 8) |
            chunkBuffer[offset + 7];

          // Check if we have the full payload
          if (offset + 8 + payloadSize > chunkBuffer.length) {
            break;
          }

          // Extract payload
          const payload = chunkBuffer.subarray(offset + 8, offset + 8 + payloadSize).toString('utf8');

          // Route to stdout or stderr
          if (streamType === 1) {
            stdout += payload;
          } else if (streamType === 2) {
            stderr += payload;
          }

          offset += 8 + payloadSize;
        }
      });

      stream.on('end', async () => {
        try {
          // Get exit code
          const inspectResult = await exec.inspect();
          resolve({
            exitCode: inspectResult.ExitCode || 0,
            stdout,
            stderr,
          });
        } catch (error) {
          reject(error);
        }
      });

      stream.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  /**
   * Create an interactive exec session with PTY
   * @param containerId - Container ID to create session in
   * @param opts - Session options (shell, user, workingDir, env, rows, cols)
   * @returns ExecSession with session ID and duplex stream
   * @throws Error if exec session creation fails
   */
  async createExecSession(containerId: string, opts?: ExecSessionOpts): Promise<ExecSession> {
    const container = this.docker.getContainer(containerId);

    // Default shell is bash
    const shell = opts?.shell || 'bash';

    // Create exec instance with PTY
    const exec = await container.exec({
      Cmd: [shell],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true, // PTY mode
      User: opts?.user,
      WorkingDir: opts?.workingDir,
      Env: opts?.env,
    });

    // Start exec and get duplex stream
    // hijack: true is required to upgrade the connection to a raw bidirectional
    // TCP socket so that stdin writes actually reach the container process.
    // Without it, exec.start() returns a read-only HTTP response stream.
    const stream = (await exec.start({
      hijack: true,
      Detach: false,
      Tty: true,
      stdin: true,
    })) as NodeJS.ReadWriteStream;

    // Resize if dimensions provided
    if (opts?.rows && opts?.cols) {
      try {
        await exec.resize({ h: opts.rows, w: opts.cols });
      } catch (error) {
        // Resize may fail if exec not started yet, that's OK
        console.warn('Initial resize failed:', error);
      }
    }

    return {
      id: exec.id,
      stream,
    };
  }

  /**
   * Resize an exec session terminal
   * @param execId - Exec session ID
   * @param rows - Number of rows
   * @param cols - Number of columns
   * @throws Error if resize fails
   */
  async resizeExec(execId: string, rows: number, cols: number): Promise<void> {
    // Get exec instance by ID
    const exec = this.docker.getExec(execId);
    await exec.resize({ h: rows, w: cols });
  }

  /**
   * Build a Docker image from a context directory containing a Dockerfile.
   *
   * Uses dockerode's ImageBuildContext to pass the directory and file list
   * directly, avoiding manual tar creation. Progress events are streamed
   * line-by-line to the optional callback.
   *
   * @param contextDir - Absolute path to the build context directory (must contain a Dockerfile)
   * @param tag - Docker image tag (e.g. "zephyr-python-dev:latest")
   * @param buildArgs - Optional build-time ARG values (e.g. { HOST_UID: "1000" })
   * @param onProgress - Optional callback receiving each build progress event
   * @throws Error if the build fails
   */
  async buildImage(
    contextDir: string,
    tag: string,
    buildArgs?: Record<string, string>,
    onProgress?: (event: BuildProgressEvent) => void
  ): Promise<void> {
    const context: Dockerode.ImageBuildContext = {
      context: contextDir,
      src: ['Dockerfile'],
    };

    const options: Dockerode.ImageBuildOptions = {
      t: tag,
      ...(buildArgs ? { buildargs: buildArgs } : {}),
    };

    const stream = await this.docker.buildImage(context, options);

    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err: Error | null, _output: unknown[]) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
        (event: BuildProgressEvent) => {
          if (event.error) {
            // Surface build errors surfaced in the stream as real errors
            reject(new Error(event.error));
          } else if (onProgress) {
            onProgress(event);
          }
        }
      );
    });
  }
}
