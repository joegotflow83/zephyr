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
 * DockerManager - handles Docker daemon connection and image operations
 *
 * This service provides methods for:
 * - Checking Docker availability
 * - Retrieving Docker daemon information
 * - Checking and pulling Docker images
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
}
