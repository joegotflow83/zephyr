/**
 * Unit tests for src/services/docker-manager.ts (connection and image operations)
 *
 * DockerManager is a main-process service that wraps dockerode for Docker
 * operations. Tests mock dockerode to avoid requiring a real Docker daemon.
 *
 * Why we test connection and image ops separately: these are the foundation
 * methods that later lifecycle/exec tests will depend on. Clear unit test
 * separation helps isolate failures.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.hoisted ensures these mocks are available when vi.mock factory runs
const {
  mockPing,
  mockInfo,
  mockVersion,
  mockGetImage,
  mockPull,
  mockFollowProgress,
} = vi.hoisted(() => ({
  mockPing: vi.fn(),
  mockInfo: vi.fn(),
  mockVersion: vi.fn(),
  mockGetImage: vi.fn(),
  mockPull: vi.fn(),
  mockFollowProgress: vi.fn(),
}));

// Mock dockerode module
vi.mock('dockerode', () => {
  const MockDockerode = vi.fn().mockImplementation(function () {
    return {
      ping: mockPing,
      info: mockInfo,
      version: mockVersion,
      getImage: mockGetImage,
      pull: mockPull,
      modem: {
        followProgress: mockFollowProgress,
      },
    };
  });

  return {
    default: MockDockerode,
  };
});

import { DockerManager } from '../../src/services/docker-manager';

describe('DockerManager - connection and image operations', () => {
  let dockerManager: DockerManager;

  beforeEach(() => {
    vi.clearAllMocks();
    dockerManager = new DockerManager();
  });

  describe('constructor', () => {
    it('should create a Dockerode instance', () => {
      expect(dockerManager).toBeDefined();
    });

    it('should accept custom Docker options', () => {
      const customOpts = { socketPath: '/custom/docker.sock' };
      const customManager = new DockerManager(customOpts);
      expect(customManager).toBeDefined();
    });
  });

  describe('isDockerAvailable', () => {
    it('should return true when Docker ping succeeds', async () => {
      mockPing.mockResolvedValue('OK');

      const result = await dockerManager.isDockerAvailable();

      expect(result).toBe(true);
      expect(mockPing).toHaveBeenCalledOnce();
    });

    it('should return false when Docker ping fails', async () => {
      mockPing.mockRejectedValue(new Error('Connection refused'));

      const result = await dockerManager.isDockerAvailable();

      expect(result).toBe(false);
      expect(mockPing).toHaveBeenCalledOnce();
    });

    it('should handle timeout errors', async () => {
      mockPing.mockRejectedValue(new Error('ETIMEDOUT'));

      const result = await dockerManager.isDockerAvailable();

      expect(result).toBe(false);
    });
  });

  describe('getDockerInfo', () => {
    it('should return Docker information', async () => {
      mockInfo.mockResolvedValue({
        Containers: 5,
        Images: 10,
        OSType: 'linux',
        Architecture: 'x86_64',
      });
      mockVersion.mockResolvedValue({
        Version: '24.0.7',
      });

      const result = await dockerManager.getDockerInfo();

      expect(result).toEqual({
        version: '24.0.7',
        containers: 5,
        images: 10,
        osType: 'linux',
        architecture: 'x86_64',
      });
      expect(mockInfo).toHaveBeenCalledOnce();
      expect(mockVersion).toHaveBeenCalledOnce();
    });

    it('should handle missing optional fields', async () => {
      mockInfo.mockResolvedValue({
        Containers: 0,
        Images: 0,
      });
      mockVersion.mockResolvedValue({
        Version: '20.10.0',
      });

      const result = await dockerManager.getDockerInfo();

      expect(result).toEqual({
        version: '20.10.0',
        containers: 0,
        images: 0,
        osType: undefined,
        architecture: undefined,
      });
    });

    it('should handle missing version field', async () => {
      mockInfo.mockResolvedValue({
        Containers: 2,
        Images: 3,
      });
      mockVersion.mockResolvedValue({});

      const result = await dockerManager.getDockerInfo();

      expect(result.version).toBe('unknown');
      expect(result.containers).toBe(2);
      expect(result.images).toBe(3);
    });

    it('should throw error when Docker is not available', async () => {
      mockInfo.mockRejectedValue(new Error('Docker not running'));

      await expect(dockerManager.getDockerInfo()).rejects.toThrow('Docker not running');
    });
  });

  describe('isImageAvailable', () => {
    it('should return true when image exists', async () => {
      const mockImage = {
        inspect: vi.fn().mockResolvedValue({ Id: 'abc123' }),
      };
      mockGetImage.mockReturnValue(mockImage);

      const result = await dockerManager.isImageAvailable('ubuntu:22.04');

      expect(result).toBe(true);
      expect(mockGetImage).toHaveBeenCalledWith('ubuntu:22.04');
      expect(mockImage.inspect).toHaveBeenCalledOnce();
    });

    it('should return false when image does not exist', async () => {
      const mockImage = {
        inspect: vi.fn().mockRejectedValue(new Error('No such image')),
      };
      mockGetImage.mockReturnValue(mockImage);

      const result = await dockerManager.isImageAvailable('nonexistent:latest');

      expect(result).toBe(false);
      expect(mockGetImage).toHaveBeenCalledWith('nonexistent:latest');
    });

    it('should handle image names without tags', async () => {
      const mockImage = {
        inspect: vi.fn().mockResolvedValue({ Id: 'def456' }),
      };
      mockGetImage.mockReturnValue(mockImage);

      const result = await dockerManager.isImageAvailable('alpine');

      expect(result).toBe(true);
      expect(mockGetImage).toHaveBeenCalledWith('alpine');
    });
  });

  describe('pullImage', () => {
    it('should pull image successfully', async () => {
      const mockStream = {
        on: vi.fn(),
      } as unknown as NodeJS.ReadableStream;

      mockPull.mockImplementation(
        (image: string, callback: (err: Error | undefined, stream: NodeJS.ReadableStream) => void) => {
          callback(undefined, mockStream);
        }
      );

      mockFollowProgress.mockImplementation(
        (stream: NodeJS.ReadableStream, onFinished: (err: Error | null) => void) => {
          onFinished(null);
        }
      );

      await dockerManager.pullImage('ubuntu:22.04');

      expect(mockPull).toHaveBeenCalledWith('ubuntu:22.04', expect.any(Function));
      expect(mockFollowProgress).toHaveBeenCalled();
    });

    it('should reject when pull fails', async () => {
      mockPull.mockImplementation(
        (image: string, callback: (err: Error | undefined, stream: NodeJS.ReadableStream) => void) => {
          callback(new Error('Network error'), {} as NodeJS.ReadableStream);
        }
      );

      await expect(dockerManager.pullImage('ubuntu:22.04')).rejects.toThrow('Network error');
    });

    it('should reject when followProgress fails', async () => {
      const mockStream = {
        on: vi.fn(),
      } as unknown as NodeJS.ReadableStream;

      mockPull.mockImplementation(
        (image: string, callback: (err: Error | undefined, stream: NodeJS.ReadableStream) => void) => {
          callback(undefined, mockStream);
        }
      );

      mockFollowProgress.mockImplementation(
        (stream: NodeJS.ReadableStream, onFinished: (err: Error | null) => void) => {
          onFinished(new Error('Pull failed'));
        }
      );

      await expect(dockerManager.pullImage('ubuntu:22.04')).rejects.toThrow('Pull failed');
    });

    it('should call onProgress callback with progress updates', async () => {
      const mockStream = {
        on: vi.fn(),
      } as unknown as NodeJS.ReadableStream;

      mockPull.mockImplementation(
        (image: string, callback: (err: Error | undefined, stream: NodeJS.ReadableStream) => void) => {
          callback(undefined, mockStream);
        }
      );

      mockFollowProgress.mockImplementation(
        (
          stream: NodeJS.ReadableStream,
          onFinished: (err: Error | null) => void,
          onProgress: (event: unknown) => void
        ) => {
          // Simulate progress events
          onProgress({ status: 'Downloading', id: 'layer1', progressDetail: { current: 100, total: 1000 } });
          onProgress({ status: 'Downloading', id: 'layer2', progressDetail: { current: 200, total: 2000 } });
          onProgress({ status: 'Pull complete' });
          onFinished(null);
        }
      );

      const progressSpy = vi.fn();
      await dockerManager.pullImage('ubuntu:22.04', progressSpy);

      expect(progressSpy).toHaveBeenCalledWith({
        status: 'Downloading',
        current: 100,
        total: 1000,
      });
      expect(progressSpy).toHaveBeenCalledWith({
        status: 'Downloading',
        current: 300,
        total: 3000,
      });
      expect(progressSpy).toHaveBeenCalledWith({
        status: 'Pull complete',
      });
    });

    it('should work without onProgress callback', async () => {
      const mockStream = {
        on: vi.fn(),
      } as unknown as NodeJS.ReadableStream;

      mockPull.mockImplementation(
        (image: string, callback: (err: Error | undefined, stream: NodeJS.ReadableStream) => void) => {
          callback(undefined, mockStream);
        }
      );

      mockFollowProgress.mockImplementation(
        (
          stream: NodeJS.ReadableStream,
          onFinished: (err: Error | null) => void,
          onProgress?: (event: unknown) => void
        ) => {
          if (onProgress) {
            onProgress({ status: 'Downloading' });
          }
          onFinished(null);
        }
      );

      await expect(dockerManager.pullImage('alpine')).resolves.toBeUndefined();
    });

    it('should aggregate progress across multiple layers', async () => {
      const mockStream = {
        on: vi.fn(),
      } as unknown as NodeJS.ReadableStream;

      mockPull.mockImplementation(
        (image: string, callback: (err: Error | undefined, stream: NodeJS.ReadableStream) => void) => {
          callback(undefined, mockStream);
        }
      );

      mockFollowProgress.mockImplementation(
        (
          stream: NodeJS.ReadableStream,
          onFinished: (err: Error | null) => void,
          onProgress: (event: unknown) => void
        ) => {
          // Simulate multiple layers being downloaded
          onProgress({ status: 'Downloading', id: 'a', progressDetail: { current: 50, total: 100 } });
          onProgress({ status: 'Downloading', id: 'b', progressDetail: { current: 75, total: 150 } });
          onProgress({ status: 'Downloading', id: 'a', progressDetail: { current: 100, total: 100 } });
          onFinished(null);
        }
      );

      const progressSpy = vi.fn();
      await dockerManager.pullImage('test:latest', progressSpy);

      // First call: layer a at 50/100
      expect(progressSpy).toHaveBeenNthCalledWith(1, {
        status: 'Downloading',
        current: 50,
        total: 100,
      });

      // Second call: layer a at 50/100 + layer b at 75/150
      expect(progressSpy).toHaveBeenNthCalledWith(2, {
        status: 'Downloading',
        current: 125,
        total: 250,
      });

      // Third call: layer a at 100/100 + layer b at 75/150
      expect(progressSpy).toHaveBeenNthCalledWith(3, {
        status: 'Downloading',
        current: 175,
        total: 250,
      });
    });
  });
});
