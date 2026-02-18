/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoopRunner } from '../../src/services/loop-runner';
import { LogParser } from '../../src/services/log-parser';
import { LoopMode, LoopStatus } from '../../src/shared/loop-types';
import type { DockerManager, ContainerInfo } from '../../src/services/docker-manager';

// -- Mocks --------------------------------------------------------------------

function createMockDockerManager(): DockerManager {
  return {
    createContainer: vi.fn().mockResolvedValue('container-123'),
    startContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    streamLogs: vi.fn().mockResolvedValue({
      abort: vi.fn(),
    }),
    getContainerStatus: vi.fn().mockResolvedValue({
      id: 'container-123',
      state: 'running',
      status: 'Up 10 minutes',
    }),
  } as unknown as DockerManager;
}

function createMockLogParser(): LogParser {
  return {
    parseLine: vi.fn((line: string) => ({
      type: 'info',
      content: line,
      timestamp: null,
    })),
    parseIterationBoundary: vi.fn().mockReturnValue(null),
  } as unknown as LogParser;
}

function createMockProjectStore() {
  return {
    getProject: vi.fn((id: string) => {
      // By default, all projects exist
      return { id };
    }),
  };
}

function createMockContainer(projectId: string, id: string = 'container-123'): ContainerInfo {
  return {
    id,
    name: `zephyr-${projectId.substring(0, 8)}`,
    image: 'ubuntu:22.04',
    state: 'running',
    status: 'Up 10 minutes',
    created: '2026-02-18T10:00:00.000Z',
    projectId,
  };
}

// -- Tests --------------------------------------------------------------------

describe('LoopRunner - recoverLoops', () => {
  let runner: LoopRunner;
  let docker: DockerManager;
  let parser: LogParser;
  let projectStore: ReturnType<typeof createMockProjectStore>;

  beforeEach(() => {
    docker = createMockDockerManager();
    parser = createMockLogParser();
    projectStore = createMockProjectStore();
    runner = new LoopRunner(docker, parser, 3);
  });

  // -- Happy path -------------------------------------------------------------

  describe('recovery happy path', () => {
    it('recovers a single running container', async () => {
      const containers = [createMockContainer('proj-1', 'container-1')];

      const recovered = await runner.recoverLoops(containers, projectStore);

      expect(recovered).toEqual(['proj-1']);
      expect(runner.listRunning()).toHaveLength(1);

      const state = runner.getLoopState('proj-1');
      expect(state).not.toBeNull();
      expect(state?.status).toBe(LoopStatus.RUNNING);
      expect(state?.containerId).toBe('container-1');
      expect(state?.mode).toBe(LoopMode.CONTINUOUS); // Default for recovered loops
      expect(state?.startedAt).toBe('2026-02-18T10:00:00.000Z');
    });

    it('recovers multiple running containers', async () => {
      const containers = [
        createMockContainer('proj-1', 'container-1'),
        createMockContainer('proj-2', 'container-2'),
        createMockContainer('proj-3', 'container-3'),
      ];

      const recovered = await runner.recoverLoops(containers, projectStore);

      expect(recovered).toHaveLength(3);
      expect(recovered).toEqual(expect.arrayContaining(['proj-1', 'proj-2', 'proj-3']));
      expect(runner.listRunning()).toHaveLength(3);
    });

    it('resumes log streaming for recovered containers', async () => {
      const containers = [createMockContainer('proj-1', 'container-1')];

      await runner.recoverLoops(containers, projectStore);

      expect(docker.streamLogs).toHaveBeenCalledWith(
        'container-1',
        expect.any(Function),
        expect.any(Number), // Unix timestamp
      );
    });
  });

  // -- Skip conditions --------------------------------------------------------

  describe('skipping containers', () => {
    it('skips containers without project ID', async () => {
      const containers = [
        {
          id: 'container-1',
          name: 'random-container',
          image: 'ubuntu:22.04',
          state: 'running',
          status: 'Up 10 minutes',
          created: '2026-02-18T10:00:00.000Z',
          // projectId is undefined
        },
      ];

      const recovered = await runner.recoverLoops(containers, projectStore);

      expect(recovered).toEqual([]);
      expect(runner.listRunning()).toHaveLength(0);
    });

    it('skips containers for deleted projects', async () => {
      projectStore.getProject.mockReturnValue(null); // Project doesn't exist

      const containers = [createMockContainer('proj-deleted', 'container-1')];

      const recovered = await runner.recoverLoops(containers, projectStore);

      expect(recovered).toEqual([]);
      expect(runner.listRunning()).toHaveLength(0);
      expect(projectStore.getProject).toHaveBeenCalledWith('proj-deleted');
    });

    it('skips already-tracked project IDs', async () => {
      // Start a loop normally
      await runner.startLoop({
        projectId: 'proj-1',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      // Try to recover the same project
      const containers = [createMockContainer('proj-1', 'container-different')];

      const recovered = await runner.recoverLoops(containers, projectStore);

      expect(recovered).toEqual([]);
      expect(runner.listRunning()).toHaveLength(1); // Still only the original
    });

    it('recovers some and skips others', async () => {
      projectStore.getProject.mockImplementation((id: string) => {
        if (id === 'proj-deleted') return null;
        return { id };
      });

      const containers = [
        createMockContainer('proj-1', 'container-1'),
        createMockContainer('proj-deleted', 'container-2'), // Will be skipped
        createMockContainer('proj-3', 'container-3'),
      ];

      const recovered = await runner.recoverLoops(containers, projectStore);

      expect(recovered).toHaveLength(2);
      expect(recovered).toEqual(expect.arrayContaining(['proj-1', 'proj-3']));
      expect(recovered).not.toContain('proj-deleted');
    });
  });

  // -- Concurrency limit ------------------------------------------------------

  describe('concurrency limit', () => {
    it('respects max concurrent limit during recovery', async () => {
      runner.setMaxConcurrent(2);

      const containers = [
        createMockContainer('proj-1', 'container-1'),
        createMockContainer('proj-2', 'container-2'),
        createMockContainer('proj-3', 'container-3'),
        createMockContainer('proj-4', 'container-4'),
      ];

      const recovered = await runner.recoverLoops(containers, projectStore);

      expect(recovered).toHaveLength(2); // Only first 2 recovered
      expect(runner.listRunning()).toHaveLength(2);
    });

    it('stops recovery when limit is reached', async () => {
      runner.setMaxConcurrent(3);

      // Start 2 loops manually
      await runner.startLoop({
        projectId: 'proj-manual-1',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });
      await runner.startLoop({
        projectId: 'proj-manual-2',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      // Try to recover 3 more (but only 1 slot available)
      const containers = [
        createMockContainer('proj-1', 'container-1'),
        createMockContainer('proj-2', 'container-2'),
        createMockContainer('proj-3', 'container-3'),
      ];

      const recovered = await runner.recoverLoops(containers, projectStore);

      expect(recovered).toHaveLength(1); // Only 1 recovered
      expect(runner.listRunning()).toHaveLength(3); // 2 manual + 1 recovered
    });
  });

  // -- Error handling ---------------------------------------------------------

  describe('error handling', () => {
    it('continues recovery if one container fails', async () => {
      vi.spyOn(docker, 'streamLogs')
        .mockResolvedValueOnce({ abort: vi.fn() }) // First succeeds
        .mockRejectedValueOnce(new Error('Stream failed')) // Second fails
        .mockResolvedValueOnce({ abort: vi.fn() }); // Third succeeds

      const containers = [
        createMockContainer('proj-1', 'container-1'),
        createMockContainer('proj-2', 'container-2'),
        createMockContainer('proj-3', 'container-3'),
      ];

      const recovered = await runner.recoverLoops(containers, projectStore);

      // Should have recovered proj-1 and proj-3 despite proj-2 failing
      expect(recovered).toHaveLength(2);
      expect(recovered).toContain('proj-1');
      expect(recovered).toContain('proj-3');
    });

    it('handles empty container list gracefully', async () => {
      const recovered = await runner.recoverLoops([], projectStore);

      expect(recovered).toEqual([]);
      expect(runner.listRunning()).toHaveLength(0);
    });

    it('handles projectStore.getProject throwing error', async () => {
      projectStore.getProject.mockImplementation((id: string) => {
        if (id === 'proj-error') {
          throw new Error('Database error');
        }
        return { id };
      });

      const containers = [
        createMockContainer('proj-1', 'container-1'),
        createMockContainer('proj-error', 'container-2'),
        createMockContainer('proj-3', 'container-3'),
      ];

      const recovered = await runner.recoverLoops(containers, projectStore);

      // Should recover proj-1 and proj-3, skip proj-error
      expect(recovered).toHaveLength(2);
      expect(recovered).toContain('proj-1');
      expect(recovered).toContain('proj-3');
      expect(recovered).not.toContain('proj-error');
    });
  });

  // -- State verification -----------------------------------------------------

  describe('recovered loop state', () => {
    it('sets correct initial state for recovered loop', async () => {
      const containers = [
        createMockContainer('proj-1', 'container-1'),
      ];

      await runner.recoverLoops(containers, projectStore);

      const state = runner.getLoopState('proj-1');
      expect(state).not.toBeNull();
      expect(state?.projectId).toBe('proj-1');
      expect(state?.containerId).toBe('container-1');
      expect(state?.status).toBe(LoopStatus.RUNNING);
      expect(state?.mode).toBe(LoopMode.CONTINUOUS);
      expect(state?.startedAt).toBe('2026-02-18T10:00:00.000Z');
      expect(state?.stoppedAt).toBeNull();
      expect(state?.error).toBeNull();
      expect(state?.iteration).toBe(0);
      expect(state?.commits).toEqual([]);
      expect(state?.errors).toBe(0);
      expect(state?.logs).toEqual([]);
    });

    it('allows stopping recovered loop', async () => {
      const containers = [createMockContainer('proj-1', 'container-1')];

      await runner.recoverLoops(containers, projectStore);

      // Should be able to stop the recovered loop
      await runner.stopLoop('proj-1');

      const state = runner.getLoopState('proj-1');
      expect(state?.status).toBe(LoopStatus.STOPPED);
    });
  });
});
