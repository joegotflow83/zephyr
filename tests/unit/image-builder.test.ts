/**
 * Unit tests for src/services/image-builder.ts
 *
 * ImageBuilder orchestrates the full local image build pipeline:
 * generate Dockerfile → write to temp dir → docker build → persist ZephyrImage.
 *
 * Why these tests matter: the builder is the only service that ties together
 * DockerManager, DockerfileGenerator, and ImageStore. Verifying the wiring
 * here prevents silent integration failures (wrong tags, missing build args,
 * orphaned temp dirs) without requiring a real Docker daemon.
 *
 * All external I/O is mocked:
 *  - fs/promises: mkdtemp / rm to avoid real temp directories
 *  - dockerfile-generator: pure function, covered in its own test suite
 *  - DockerManager: mocked class instance
 *  - ImageStore: mocked class instance
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ImageBuilder, BuildProgressEvent } from '../../src/services/image-builder';
import type { ContainerRuntime } from '../../src/services/container-runtime';
import { ImageStore } from '../../src/services/image-store';
import { ImageBuildConfig, ZephyrImage } from '../../src/shared/models';

// ---------------------------------------------------------------------------
// Hoist mocks so they are available inside vi.mock factory calls
// ---------------------------------------------------------------------------
const { mockMkdtemp, mockRm, mockWriteFile } = vi.hoisted(() => ({
  mockMkdtemp: vi.fn(),
  mockRm: vi.fn(),
  mockWriteFile: vi.fn(),
}));

const { mockGenerateDockerfile, mockWriteDockerfile } = vi.hoisted(() => ({
  mockGenerateDockerfile: vi.fn(),
  mockWriteDockerfile: vi.fn(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  mkdtemp: mockMkdtemp,
  rm: mockRm,
  writeFile: mockWriteFile,
}));

// Mock dockerfile-generator
vi.mock('../../src/services/dockerfile-generator', () => ({
  generateDockerfile: mockGenerateDockerfile,
  writeDockerfile: mockWriteDockerfile,
}));

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeMockDockerManager() {
  return {
    buildImage: vi.fn(),
  };
}

function makeMockImageStore(existingImages: ZephyrImage[] = []) {
  const images = [...existingImages];

  return {
    listImages: vi.fn(() => images),
    getImage: vi.fn((id: string) => images.find((img) => img.id === id) ?? null),
    addImage: vi.fn((partial: Omit<ZephyrImage, 'id' | 'builtAt'>): ZephyrImage => {
      const newImage: ZephyrImage = {
        ...partial,
        id: 'new-image-uuid',
        builtAt: '2024-01-01T00:00:00.000Z',
      };
      images.push(newImage);
      return newImage;
    }),
    updateImage: vi.fn((id: string, patch: Partial<ZephyrImage>): ZephyrImage => {
      const idx = images.findIndex((img) => img.id === id);
      if (idx === -1) throw new Error(`Image "${id}" not found`);
      images[idx] = { ...images[idx], ...patch, id };
      return images[idx];
    }),
    removeImage: vi.fn((id: string): boolean => {
      const idx = images.findIndex((img) => img.id === id);
      if (idx === -1) return false;
      images.splice(idx, 1);
      return true;
    }),
  };
}

const SAMPLE_CONFIG: ImageBuildConfig = {
  name: 'python-dev',
  languages: [{ languageId: 'python', version: '3.12' }],
};

const SAMPLE_IMAGE: ZephyrImage = {
  id: 'existing-uuid',
  name: 'python-dev',
  dockerTag: 'zephyr-python-dev:latest',
  languages: [{ languageId: 'python', version: '3.12' }],
  buildConfig: SAMPLE_CONFIG,
  builtAt: '2023-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImageBuilder', () => {
  let dockerManager: ReturnType<typeof makeMockDockerManager>;
  let imageStore: ReturnType<typeof makeMockImageStore>;
  let builder: ImageBuilder;

  beforeEach(() => {
    vi.clearAllMocks();

    dockerManager = makeMockDockerManager();
    imageStore = makeMockImageStore();
    builder = new ImageBuilder(
      dockerManager as unknown as ContainerRuntime,
      imageStore as unknown as ImageStore
    );

    // Default mock implementations
    mockMkdtemp.mockResolvedValue('/tmp/zephyr-build-abc');
    mockRm.mockResolvedValue(undefined);
    mockGenerateDockerfile.mockReturnValue('FROM ubuntu:24.04\n');
    mockWriteDockerfile.mockResolvedValue('/tmp/zephyr-build-abc/Dockerfile');
    dockerManager.buildImage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // buildImage – core flow
  // -------------------------------------------------------------------------

  describe('buildImage()', () => {
    it('creates a temp directory for the build context', async () => {
      await builder.buildImage(SAMPLE_CONFIG);
      expect(mockMkdtemp).toHaveBeenCalledOnce();
      // Path should start with the OS tmp dir
      const arg = mockMkdtemp.mock.calls[0][0] as string;
      expect(arg).toMatch(/zephyr-build-$/);
    });

    it('generates a Dockerfile from the config', async () => {
      await builder.buildImage(SAMPLE_CONFIG);
      expect(mockGenerateDockerfile).toHaveBeenCalledWith(SAMPLE_CONFIG);
    });

    it('writes the Dockerfile to the temp dir', async () => {
      await builder.buildImage(SAMPLE_CONFIG);
      expect(mockWriteDockerfile).toHaveBeenCalledWith(
        '/tmp/zephyr-build-abc',
        'FROM ubuntu:24.04\n'
      );
    });

    it('calls ContainerRuntime.buildImage with the derived tag', async () => {
      await builder.buildImage(SAMPLE_CONFIG);
      const [contextDir, tag] = dockerManager.buildImage.mock.calls[0] as [
        string,
        string,
        unknown,
        unknown,
      ];
      expect(contextDir).toBe('/tmp/zephyr-build-abc');
      expect(tag).toBe('zephyr-python-dev:latest');
    });

    it('passes HOST_UID and HOST_GID as build args', async () => {
      await builder.buildImage(SAMPLE_CONFIG);
      const buildArgs = dockerManager.buildImage.mock.calls[0][2] as Record<string, string>;
      expect(buildArgs).toHaveProperty('HOST_UID');
      expect(buildArgs).toHaveProperty('HOST_GID');
      // Values should be numeric strings
      expect(Number(buildArgs.HOST_UID)).toBeGreaterThanOrEqual(0);
      expect(Number(buildArgs.HOST_GID)).toBeGreaterThanOrEqual(0);
    });

    it('falls back to UID/GID 1000 when process.getuid is unavailable', async () => {
      const origGetuid = process.getuid;
      const origGetgid = process.getgid;
      // @ts-expect-error – simulate environment without getuid
      process.getuid = undefined;
      // @ts-expect-error
      process.getgid = undefined;

      try {
        await builder.buildImage(SAMPLE_CONFIG);
        const buildArgs = dockerManager.buildImage.mock.calls[0][2] as Record<string, string>;
        expect(buildArgs.HOST_UID).toBe('1000');
        expect(buildArgs.HOST_GID).toBe('1000');
      } finally {
        process.getuid = origGetuid;
        process.getgid = origGetgid;
      }
    });

    it('stores the resulting image in ImageStore', async () => {
      await builder.buildImage(SAMPLE_CONFIG);
      expect(imageStore.addImage).toHaveBeenCalledOnce();
      const arg = imageStore.addImage.mock.calls[0][0] as Omit<ZephyrImage, 'id' | 'builtAt'>;
      expect(arg.name).toBe('python-dev');
      expect(arg.dockerTag).toBe('zephyr-python-dev:latest');
      expect(arg.languages).toEqual(SAMPLE_CONFIG.languages);
      expect(arg.buildConfig).toEqual(SAMPLE_CONFIG);
    });

    it('returns the ZephyrImage record created by ImageStore', async () => {
      const result = await builder.buildImage(SAMPLE_CONFIG);
      expect(result.id).toBe('new-image-uuid');
      expect(result.name).toBe('python-dev');
    });

    it('streams progress events to the callback', async () => {
      const events: BuildProgressEvent[] = [];
      const progressEvent: BuildProgressEvent = { stream: 'Step 1/5 : FROM ubuntu:24.04' };

      // Make buildImage call the progress callback during execution
      dockerManager.buildImage.mockImplementation(
        async (
          _ctx: unknown,
          _tag: unknown,
          _args: unknown,
          onProgress?: (e: BuildProgressEvent) => void
        ) => {
          onProgress?.(progressEvent);
        }
      );

      await builder.buildImage(SAMPLE_CONFIG, (e) => events.push(e));
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(progressEvent);
    });

    it('cleans up the temp dir on successful build', async () => {
      await builder.buildImage(SAMPLE_CONFIG);
      expect(mockRm).toHaveBeenCalledWith('/tmp/zephyr-build-abc', {
        recursive: true,
        force: true,
      });
    });

    it('cleans up the temp dir even when docker build fails', async () => {
      dockerManager.buildImage.mockRejectedValue(new Error('docker daemon error'));
      await expect(builder.buildImage(SAMPLE_CONFIG)).rejects.toThrow('docker daemon error');
      expect(mockRm).toHaveBeenCalledWith('/tmp/zephyr-build-abc', {
        recursive: true,
        force: true,
      });
    });

    it('propagates errors from ContainerRuntime.buildImage', async () => {
      dockerManager.buildImage.mockRejectedValue(new Error('build failed'));
      await expect(builder.buildImage(SAMPLE_CONFIG)).rejects.toThrow('build failed');
    });

    it('does not persist to ImageStore when build fails', async () => {
      dockerManager.buildImage.mockRejectedValue(new Error('network error'));
      await expect(builder.buildImage(SAMPLE_CONFIG)).rejects.toThrow();
      expect(imageStore.addImage).not.toHaveBeenCalled();
    });

    it('derives correct docker tag from multi-word image name', async () => {
      const config: ImageBuildConfig = { name: 'Python Node Dev', languages: [] };
      await builder.buildImage(config);
      const tag = dockerManager.buildImage.mock.calls[0][1] as string;
      expect(tag).toBe('zephyr-python-node-dev:latest');
    });

    it('does not double-prefix when image name starts with "Zephyr"', async () => {
      const config: ImageBuildConfig = { name: 'Zephyr Python 3.12 NodeJS 22', languages: [] };
      await builder.buildImage(config);
      const tag = dockerManager.buildImage.mock.calls[0][1] as string;
      expect(tag).toBe('zephyr-python-312-nodejs-22:latest');
    });

    it('handles empty language list (base-only image)', async () => {
      const config: ImageBuildConfig = { name: 'base-only', languages: [] };
      await builder.buildImage(config);
      expect(mockGenerateDockerfile).toHaveBeenCalledWith(config);
      expect(imageStore.addImage).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // rebuildImage – rebuild flow
  // -------------------------------------------------------------------------

  describe('rebuildImage()', () => {
    beforeEach(() => {
      imageStore = makeMockImageStore([SAMPLE_IMAGE]);
      builder = new ImageBuilder(
        dockerManager as unknown as ContainerRuntime,
        imageStore as unknown as ImageStore
      );
    });

    it('loads the existing image from ImageStore by id', async () => {
      await builder.rebuildImage('existing-uuid');
      expect(imageStore.getImage).toHaveBeenCalledWith('existing-uuid');
    });

    it('throws when imageId does not exist in ImageStore', async () => {
      await expect(builder.rebuildImage('nonexistent-id')).rejects.toThrow(
        'Image with id "nonexistent-id" not found'
      );
    });

    it('regenerates the Dockerfile from the existing buildConfig', async () => {
      await builder.rebuildImage('existing-uuid');
      expect(mockGenerateDockerfile).toHaveBeenCalledWith(SAMPLE_IMAGE.buildConfig);
    });

    it('rebuilds using the original dockerTag', async () => {
      await builder.rebuildImage('existing-uuid');
      const tag = dockerManager.buildImage.mock.calls[0][1] as string;
      expect(tag).toBe('zephyr-python-dev:latest');
    });

    it('passes HOST_UID and HOST_GID as build args on rebuild', async () => {
      await builder.rebuildImage('existing-uuid');
      const buildArgs = dockerManager.buildImage.mock.calls[0][2] as Record<string, string>;
      expect(buildArgs).toHaveProperty('HOST_UID');
      expect(buildArgs).toHaveProperty('HOST_GID');
    });

    it('updates ImageStore with a new builtAt timestamp', async () => {
      await builder.rebuildImage('existing-uuid');
      expect(imageStore.updateImage).toHaveBeenCalledWith(
        'existing-uuid',
        expect.objectContaining({ builtAt: expect.any(String) })
      );
      const patch = imageStore.updateImage.mock.calls[0][1] as Partial<ZephyrImage>;
      expect(new Date(patch.builtAt!).getTime()).toBeGreaterThan(
        new Date(SAMPLE_IMAGE.builtAt).getTime()
      );
    });

    it('returns the updated ZephyrImage from ImageStore', async () => {
      const result = await builder.rebuildImage('existing-uuid');
      expect(result.id).toBe('existing-uuid');
    });

    it('streams progress events to the callback on rebuild', async () => {
      const events: BuildProgressEvent[] = [];
      dockerManager.buildImage.mockImplementation(
        async (
          _ctx: unknown,
          _tag: unknown,
          _args: unknown,
          onProgress?: (e: BuildProgressEvent) => void
        ) => {
          onProgress?.({ stream: 'rebuild progress line' });
        }
      );

      await builder.rebuildImage('existing-uuid', (e) => events.push(e));
      expect(events[0]).toEqual({ stream: 'rebuild progress line' });
    });

    it('cleans up temp dir on successful rebuild', async () => {
      await builder.rebuildImage('existing-uuid');
      expect(mockRm).toHaveBeenCalledWith(expect.stringContaining('zephyr-build'), {
        recursive: true,
        force: true,
      });
    });

    it('cleans up temp dir even when rebuild fails', async () => {
      dockerManager.buildImage.mockRejectedValue(new Error('rebuild error'));
      await expect(builder.rebuildImage('existing-uuid')).rejects.toThrow('rebuild error');
      expect(mockRm).toHaveBeenCalled();
    });

    it('does not call ImageStore.updateImage when docker build fails', async () => {
      dockerManager.buildImage.mockRejectedValue(new Error('build failure'));
      await expect(builder.rebuildImage('existing-uuid')).rejects.toThrow();
      expect(imageStore.updateImage).not.toHaveBeenCalled();
    });
  });
});
