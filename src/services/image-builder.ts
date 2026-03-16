/**
 * ImageBuilder — orchestrates the full image build pipeline.
 *
 * Build flow:
 *   1. Generate Dockerfile from ImageBuildConfig via generateDockerfile()
 *   2. Write Dockerfile to a temporary directory via writeDockerfile()
 *   3. Call ContainerRuntime.buildImage() with host UID/GID as build args
 *   4. On success: persist the new ZephyrImage record in ImageStore,
 *      stamped with the active runtime type
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
import { type ContainerRuntime, type ProgressEvent } from './container-runtime';
import { ImageStore } from './image-store';

export type BuildProgressEvent = ProgressEvent;

/**
 * Derives a container image tag from a human-readable image name.
 * Lowercases, replaces spaces with hyphens, strips invalid chars.
 * Example: "Python Node Dev" → "zephyr-python-node-dev:latest"
 *
 * For Podman builds the tag is prefixed with `localhost/` to avoid
 * short-name resolution which, in non-interactive mode (Electron),
 * falls back to docker.io and fails for locally-built images.
 */
function deriveDockerTag(name: string, runtimeType?: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  // Avoid double prefix if the user named their image "Zephyr ..."
  const prefixed = slug.startsWith('zephyr-') ? slug : `zephyr-${slug}`;
  const tag = `${prefixed}:latest`;
  // Podman stores locally-built images under the `localhost/` registry.
  // Explicit prefix prevents ambiguous short-name resolution at container
  // creation time.
  return runtimeType === 'podman' ? `localhost/${tag}` : tag;
}

export class ImageBuilder {
  private readonly runtime: ContainerRuntime;
  private readonly imageStore: ImageStore;

  constructor(runtime: ContainerRuntime, imageStore: ImageStore) {
    this.runtime = runtime;
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

      const tag = deriveDockerTag(config.name, this.runtime.runtimeType);
      const uid = (process.getuid ? process.getuid() : 1000).toString();
      const gid = (process.getgid ? process.getgid() : 1000).toString();

      await this.runtime.buildImage(
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
        runtime: this.runtime.runtimeType,
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

      // Re-derive the tag for the current runtime. This handles the case where
      // the image was originally built with a different runtime (e.g., Docker)
      // and is now being rebuilt with Podman, which needs the localhost/ prefix.
      const newTag = deriveDockerTag(existingImage.buildConfig.name, this.runtime.runtimeType);

      await this.runtime.buildImage(
        tmpDir,
        newTag,
        { HOST_UID: uid, HOST_GID: gid },
        onProgress
      );

      return this.imageStore.updateImage(imageId, {
        builtAt: new Date().toISOString(),
        dockerTag: newTag,
        runtime: this.runtime.runtimeType,
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
}
