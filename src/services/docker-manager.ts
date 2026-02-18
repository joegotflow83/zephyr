import Dockerode from 'dockerode';

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
      follow: boolean;
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
    const stream = (await container.logs(logOptions)) as NodeJS.ReadableStream;

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
}
