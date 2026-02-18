/**
 * Unit tests for src/services/docker-manager.ts (container lifecycle operations)
 *
 * Tests the container lifecycle management methods: create, start, stop, remove,
 * status checking, and listing containers with Zephyr-specific label filtering.
 *
 * Why separate lifecycle tests: Container lifecycle operations build on the
 * connection methods tested in docker-manager-connection.test.ts. Keeping tests
 * separate makes it easier to identify which functionality is broken.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ContainerInfo, ContainerInspectInfo } from 'dockerode';

// vi.hoisted ensures these mocks are available when vi.mock factory runs
const {
  mockCreateContainer,
  mockListContainers,
  mockGetContainer,
  mockContainerStart,
  mockContainerStop,
  mockContainerRemove,
  mockContainerInspect,
} = vi.hoisted(() => ({
  mockCreateContainer: vi.fn(),
  mockListContainers: vi.fn(),
  mockGetContainer: vi.fn(),
  mockContainerStart: vi.fn(),
  mockContainerStop: vi.fn(),
  mockContainerRemove: vi.fn(),
  mockContainerInspect: vi.fn(),
}));

// Mock dockerode module
vi.mock('dockerode', () => {
  const MockDockerode = vi.fn().mockImplementation(function () {
    return {
      createContainer: mockCreateContainer,
      listContainers: mockListContainers,
      getContainer: mockGetContainer,
    };
  });

  return {
    default: MockDockerode,
  };
});

import { DockerManager } from '../../src/services/docker-manager';
import type { ContainerCreateOpts } from '../../src/services/docker-manager';

describe('DockerManager - container lifecycle', () => {
  let dockerManager: DockerManager;

  beforeEach(() => {
    vi.clearAllMocks();
    dockerManager = new DockerManager();

    // Setup default container mock
    mockGetContainer.mockReturnValue({
      start: mockContainerStart,
      stop: mockContainerStop,
      remove: mockContainerRemove,
      inspect: mockContainerInspect,
    });
  });

  describe('createContainer', () => {
    it('should create a container with minimal options', async () => {
      const mockContainer = { id: 'abc123' };
      mockCreateContainer.mockResolvedValue(mockContainer);

      const opts: ContainerCreateOpts = {
        image: 'ubuntu:22.04',
        projectId: 'project-1',
      };

      const containerId = await dockerManager.createContainer(opts);

      expect(containerId).toBe('abc123');
      expect(mockCreateContainer).toHaveBeenCalledWith({
        Image: 'ubuntu:22.04',
        name: undefined,
        Cmd: undefined,
        Env: undefined,
        WorkingDir: undefined,
        Labels: {
          'zephyr-managed': 'true',
          'zephyr.project_id': 'project-1',
        },
        HostConfig: {
          Binds: undefined,
          AutoRemove: undefined,
        },
      });
    });

    it('should create a container with all options', async () => {
      const mockContainer = { id: 'def456' };
      mockCreateContainer.mockResolvedValue(mockContainer);

      const opts: ContainerCreateOpts = {
        image: 'alpine:latest',
        projectId: 'project-2',
        name: 'test-container',
        cmd: ['/bin/sh', '-c', 'echo hello'],
        env: { FOO: 'bar', BAZ: 'qux' },
        workingDir: '/app',
        volumes: {
          '/host/path': '/container/path',
          '/host/data': '/container/data',
        },
        autoRemove: true,
      };

      const containerId = await dockerManager.createContainer(opts);

      expect(containerId).toBe('def456');
      expect(mockCreateContainer).toHaveBeenCalledWith({
        Image: 'alpine:latest',
        name: 'test-container',
        Cmd: ['/bin/sh', '-c', 'echo hello'],
        Env: ['FOO=bar', 'BAZ=qux'],
        WorkingDir: '/app',
        Labels: {
          'zephyr-managed': 'true',
          'zephyr.project_id': 'project-2',
        },
        HostConfig: {
          Binds: ['/host/path:/container/path', '/host/data:/container/data'],
          AutoRemove: true,
        },
      });
    });

    it('should apply Zephyr labels to all containers', async () => {
      const mockContainer = { id: 'labeled123' };
      mockCreateContainer.mockResolvedValue(mockContainer);

      const opts: ContainerCreateOpts = {
        image: 'test:latest',
        projectId: 'my-project',
      };

      await dockerManager.createContainer(opts);

      const callArgs = mockCreateContainer.mock.calls[0][0];
      expect(callArgs.Labels).toEqual({
        'zephyr-managed': 'true',
        'zephyr.project_id': 'my-project',
      });
    });

    it('should handle creation errors', async () => {
      mockCreateContainer.mockRejectedValue(new Error('Image not found'));

      const opts: ContainerCreateOpts = {
        image: 'nonexistent:latest',
        projectId: 'project-3',
      };

      await expect(dockerManager.createContainer(opts)).rejects.toThrow('Image not found');
    });
  });

  describe('startContainer', () => {
    it('should start a container by ID', async () => {
      mockContainerStart.mockResolvedValue(undefined);

      await dockerManager.startContainer('abc123');

      expect(mockGetContainer).toHaveBeenCalledWith('abc123');
      expect(mockContainerStart).toHaveBeenCalledOnce();
    });

    it('should handle start errors', async () => {
      mockContainerStart.mockRejectedValue(new Error('Container not found'));

      await expect(dockerManager.startContainer('missing')).rejects.toThrow('Container not found');
    });
  });

  describe('stopContainer', () => {
    it('should stop a container with default timeout', async () => {
      mockContainerStop.mockResolvedValue(undefined);

      await dockerManager.stopContainer('abc123');

      expect(mockGetContainer).toHaveBeenCalledWith('abc123');
      expect(mockContainerStop).toHaveBeenCalledWith({ t: 10 });
    });

    it('should stop a container with custom timeout', async () => {
      mockContainerStop.mockResolvedValue(undefined);

      await dockerManager.stopContainer('abc123', 30);

      expect(mockContainerStop).toHaveBeenCalledWith({ t: 30 });
    });

    it('should handle stop errors', async () => {
      mockContainerStop.mockRejectedValue(new Error('Container already stopped'));

      await expect(dockerManager.stopContainer('abc123')).rejects.toThrow('Container already stopped');
    });
  });

  describe('removeContainer', () => {
    it('should remove a container without force', async () => {
      mockContainerRemove.mockResolvedValue(undefined);

      await dockerManager.removeContainer('abc123');

      expect(mockGetContainer).toHaveBeenCalledWith('abc123');
      expect(mockContainerRemove).toHaveBeenCalledWith({ force: undefined });
    });

    it('should force remove a running container', async () => {
      mockContainerRemove.mockResolvedValue(undefined);

      await dockerManager.removeContainer('abc123', true);

      expect(mockContainerRemove).toHaveBeenCalledWith({ force: true });
    });

    it('should handle removal errors', async () => {
      mockContainerRemove.mockRejectedValue(new Error('Container is running'));

      await expect(dockerManager.removeContainer('abc123')).rejects.toThrow('Container is running');
    });
  });

  describe('getContainerStatus', () => {
    it('should return status for a running container', async () => {
      mockContainerInspect.mockResolvedValue({
        Id: 'abc123',
        State: {
          Status: 'running',
          StartedAt: '2026-02-18T10:00:00Z',
          FinishedAt: '0001-01-01T00:00:00Z',
        },
      } as ContainerInspectInfo);

      const status = await dockerManager.getContainerStatus('abc123');

      expect(status).toEqual({
        id: 'abc123',
        state: 'running',
        status: 'running',
        startedAt: '2026-02-18T10:00:00Z',
        finishedAt: '0001-01-01T00:00:00Z',
      });
      expect(mockGetContainer).toHaveBeenCalledWith('abc123');
      expect(mockContainerInspect).toHaveBeenCalledOnce();
    });

    it('should return status for an exited container', async () => {
      mockContainerInspect.mockResolvedValue({
        Id: 'def456',
        State: {
          Status: 'exited',
          StartedAt: '2026-02-18T10:00:00Z',
          FinishedAt: '2026-02-18T10:05:00Z',
        },
      } as ContainerInspectInfo);

      const status = await dockerManager.getContainerStatus('def456');

      expect(status).toEqual({
        id: 'def456',
        state: 'exited',
        status: 'exited',
        startedAt: '2026-02-18T10:00:00Z',
        finishedAt: '2026-02-18T10:05:00Z',
      });
    });

    it('should handle status errors', async () => {
      mockContainerInspect.mockRejectedValue(new Error('No such container'));

      await expect(dockerManager.getContainerStatus('missing')).rejects.toThrow('No such container');
    });
  });

  describe('listRunningContainers', () => {
    it('should list Zephyr-managed containers', async () => {
      const createdTimestamp = 1708252800; // Unix timestamp in seconds
      const mockContainers: ContainerInfo[] = [
        {
          Id: 'abc123',
          Names: ['/container1'],
          Image: 'ubuntu:22.04',
          State: 'running',
          Status: 'Up 5 minutes',
          Created: createdTimestamp,
          Labels: {
            'zephyr-managed': 'true',
            'zephyr.project_id': 'project-1',
          },
        },
        {
          Id: 'def456',
          Names: ['/container2'],
          Image: 'alpine:latest',
          State: 'exited',
          Status: 'Exited (0) 2 minutes ago',
          Created: createdTimestamp + 200,
          Labels: {
            'zephyr-managed': 'true',
            'zephyr.project_id': 'project-2',
          },
        },
      ] as ContainerInfo[];

      mockListContainers.mockResolvedValue(mockContainers);

      const containers = await dockerManager.listRunningContainers();

      expect(containers).toHaveLength(2);
      expect(containers[0]).toEqual({
        id: 'abc123',
        name: 'container1',
        image: 'ubuntu:22.04',
        state: 'running',
        status: 'Up 5 minutes',
        created: new Date(createdTimestamp * 1000).toISOString(),
        projectId: 'project-1',
      });
      expect(containers[1]).toEqual({
        id: 'def456',
        name: 'container2',
        image: 'alpine:latest',
        state: 'exited',
        status: 'Exited (0) 2 minutes ago',
        created: new Date((createdTimestamp + 200) * 1000).toISOString(),
        projectId: 'project-2',
      });

      expect(mockListContainers).toHaveBeenCalledWith({
        all: true,
        filters: {
          label: ['zephyr-managed=true'],
        },
      });
    });

    it('should return empty array when no containers exist', async () => {
      mockListContainers.mockResolvedValue([]);

      const containers = await dockerManager.listRunningContainers();

      expect(containers).toEqual([]);
    });

    it('should handle containers without project ID label', async () => {
      const createdTimestamp = 1708250000;
      const mockContainers: ContainerInfo[] = [
        {
          Id: 'xyz789',
          Names: ['/legacy-container'],
          Image: 'test:latest',
          State: 'running',
          Status: 'Up 1 hour',
          Created: createdTimestamp,
          Labels: {
            'zephyr-managed': 'true',
          },
        },
      ] as ContainerInfo[];

      mockListContainers.mockResolvedValue(mockContainers);

      const containers = await dockerManager.listRunningContainers();

      expect(containers[0].projectId).toBeUndefined();
    });

    it('should strip leading slash from container names', async () => {
      const createdTimestamp = 1708252800;
      const mockContainers: ContainerInfo[] = [
        {
          Id: 'abc123',
          Names: ['/my-container-name'],
          Image: 'test:latest',
          State: 'running',
          Status: 'Up',
          Created: createdTimestamp,
          Labels: {
            'zephyr-managed': 'true',
          },
        },
      ] as ContainerInfo[];

      mockListContainers.mockResolvedValue(mockContainers);

      const containers = await dockerManager.listRunningContainers();

      expect(containers[0].name).toBe('my-container-name');
    });

    it('should handle containers with empty names array', async () => {
      const createdTimestamp = 1708252800;
      const mockContainers: ContainerInfo[] = [
        {
          Id: 'abc123',
          Names: [],
          Image: 'test:latest',
          State: 'running',
          Status: 'Up',
          Created: createdTimestamp,
          Labels: {
            'zephyr-managed': 'true',
          },
        },
      ] as ContainerInfo[];

      mockListContainers.mockResolvedValue(mockContainers);

      const containers = await dockerManager.listRunningContainers();

      expect(containers[0].name).toBe('unknown');
    });
  });

  describe('getContainerCreated', () => {
    it('should return creation timestamp for existing container', async () => {
      mockContainerInspect.mockResolvedValue({
        Id: 'abc123',
        Created: '2026-02-18T10:00:00.000Z',
        State: {},
      } as ContainerInspectInfo);

      const created = await dockerManager.getContainerCreated('abc123');

      expect(created).toBe('2026-02-18T10:00:00.000Z');
      expect(mockGetContainer).toHaveBeenCalledWith('abc123');
      expect(mockContainerInspect).toHaveBeenCalledOnce();
    });

    it('should return null for non-existent container', async () => {
      mockContainerInspect.mockRejectedValue(new Error('No such container'));

      const created = await dockerManager.getContainerCreated('missing');

      expect(created).toBeNull();
    });

    it('should return null on any error', async () => {
      mockContainerInspect.mockRejectedValue(new Error('Connection failed'));

      const created = await dockerManager.getContainerCreated('abc123');

      expect(created).toBeNull();
    });
  });
});
