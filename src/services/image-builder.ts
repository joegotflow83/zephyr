/**
 * ImageBuilder — orchestrates the full image build pipeline.
 *
 * Build flow:
 *   1. Generate Dockerfile from ImageBuildConfig via generateDockerfile()
 *   2. Write Dockerfile to a temporary directory via writeDockerfile()
 *   3. Call DockerManager.buildImage() with host UID/GID as build args
 *   4. On success: persist the new ZephyrImage record in ImageStore
 *   5. Clean up the temporary directory (success and failure)
 *
 * Why host UID/GID as build args: the generated Dockerfile creates a `ralph`
 * user with matching UID/GID (HOST_UID / HOST_GID build args) so that bind-
 * mounted workspace files have the correct ownership inside the container.
 *
 * rebuildImage reuses the existing image's buildConfig so the Dockerfile is
 * regenerated identically, then updates the builtAt timestamp in ImageStore.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { ImageBuildConfig, ZephyrImage } from '../shared/models';
import { generateDockerfile, writeDockerfile } from './dockerfile-generator';
import { type BuildProgressEvent, DockerManager } from './docker-manager';
import { ImageStore } from './image-store';

export type { BuildProgressEvent };

/**
 * Derives a Docker tag from a human-readable image name.
 * Lowercases, replaces spaces with hyphens, strips invalid chars.
 * Example: "Python Node Dev" → "zephyr-python-node-dev:latest"
 */
function deriveDockerTag(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  return `zephyr-${slug}:latest`;
}

export class ImageBuilder {
  private readonly dockerManager: DockerManager;
  private readonly imageStore: ImageStore;

  constructor(dockerManager: DockerManager, imageStore: ImageStore) {
    this.dockerManager = dockerManager;
    this.imageStore = imageStore;
  }

  /**
   * Build a new Docker image from the given config.
   *
   * Creates a temp directory, generates the Dockerfile, runs docker build
   * with host UID/GID injected as build args, stores the result in
   * ImageStore, then removes the temp directory.
   *
   * @param config - Image build configuration (name + language selections)
   * @param onProgress - Optional streaming callback for build output lines
   * @returns The newly created ZephyrImage record
   * @throws Error if the build fails (temp dir is always cleaned up)
   */
  async buildImage(
    config: ImageBuildConfig,
    onProgress?: (event: BuildProgressEvent) => void
  ): Promise<ZephyrImage> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zephyr-build-'));

    try {
      const dockerfileContent = generateDockerfile(config);
      await writeDockerfile(tmpDir, dockerfileContent);

      const tag = deriveDockerTag(config.name);
      const uid = (process.getuid ? process.getuid() : 1000).toString();
      const gid = (process.getgid ? process.getgid() : 1000).toString();

      await this.dockerManager.buildImage(
        tmpDir,
        tag,
        { HOST_UID: uid, HOST_GID: gid },
        onProgress
      );

      const image = this.imageStore.addImage({
        name: config.name,
        dockerTag: tag,
        languages: config.languages,
        buildConfig: config,
      });

      return image;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * Rebuild an existing image using its original build config.
   *
   * Loads the image's buildConfig from ImageStore, regenerates the
   * Dockerfile, runs docker build, and updates the builtAt timestamp.
   *
   * @param imageId - UUID of the ZephyrImage to rebuild
   * @param onProgress - Optional streaming callback for build output
   * @returns The updated ZephyrImage record with new builtAt timestamp
   * @throws Error if imageId not found, or if the build fails
   */
  async rebuildImage(
    imageId: string,
    onProgress?: (event: BuildProgressEvent) => void
  ): Promise<ZephyrImage> {
    const existingImage = this.imageStore.getImage(imageId);
    if (!existingImage) {
      throw new Error(`Image with id "${imageId}" not found`);
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zephyr-build-'));

    try {
      const dockerfileContent = generateDockerfile(existingImage.buildConfig);
      await writeDockerfile(tmpDir, dockerfileContent);

      const uid = (process.getuid ? process.getuid() : 1000).toString();
      const gid = (process.getgid ? process.getgid() : 1000).toString();

      await this.dockerManager.buildImage(
        tmpDir,
        existingImage.dockerTag,
        { HOST_UID: uid, HOST_GID: gid },
        onProgress
      );

      return this.imageStore.updateImage(imageId, {
        builtAt: new Date().toISOString(),
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
}
