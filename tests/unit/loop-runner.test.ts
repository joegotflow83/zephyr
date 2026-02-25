/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoopRunner } from '../../src/services/loop-runner';
import { LogParser } from '../../src/services/log-parser';
import { LoopMode, LoopStatus } from '../../src/shared/loop-types';
import type { DockerManager, ContainerStatus } from '../../src/services/docker-manager';

// -- Mocks --------------------------------------------------------------------

function createMockDockerManager(): DockerManager {
  return {
    createContainer: vi.fn().mockResolvedValue('container-123'),
    startContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    listRunningContainers: vi.fn().mockResolvedValue([]),
    getContainerStatus: vi.fn().mockResolvedValue({
      id: 'container-123',
      state: 'running',
      status: 'Up 1 minute',
    } as ContainerStatus),
    streamLogs: vi.fn().mockResolvedValue({
      abort: vi.fn(),
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

// -- Tests --------------------------------------------------------------------

describe('LoopRunner', () => {
  let runner: LoopRunner;
  let docker: DockerManager;
  let parser: LogParser;

  beforeEach(() => {
    docker = createMockDockerManager();
    parser = createMockLogParser();
    runner = new LoopRunner(docker, parser, 3);
  });

  // -- Constructor and configuration ------------------------------------------

  describe('constructor', () => {
    it('initializes with default max concurrent', () => {
      const r = new LoopRunner(docker, parser);
      expect(r.getMaxConcurrent()).toBe(3);
    });

    it('initializes with custom max concurrent', () => {
      const r = new LoopRunner(docker, parser, 5);
      expect(r.getMaxConcurrent()).toBe(5);
    });
  });

  describe('setMaxConcurrent', () => {
    it('updates max concurrent limit', () => {
      runner.setMaxConcurrent(10);
      expect(runner.getMaxConcurrent()).toBe(10);
    });

    it('throws if max is less than 1', () => {
      expect(() => runner.setMaxConcurrent(0)).toThrow('maxConcurrent must be at least 1');
    });
  });

  // -- Starting loops ---------------------------------------------------------

  describe('startLoop', () => {
    it('creates container, starts it, and transitions to RUNNING', async () => {
      const state = await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      expect(state.status).toBe(LoopStatus.RUNNING);
      expect(state.containerId).toBe('container-123');
      expect(state.mode).toBe(LoopMode.SINGLE);
      expect(state.iteration).toBe(0);
      expect(state.startedAt).toBeTruthy();

      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          image: 'ubuntu:22.04',
          projectId: 'proj-123',
        }),
      );
      expect(docker.startContainer).toHaveBeenCalledWith('container-123');
      expect(docker.streamLogs).toHaveBeenCalledWith('container-123', expect.any(Function));
    });

    it('passes env vars and volumes to Docker', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
        envVars: { FOO: 'bar', BAZ: 'qux' },
        volumeMounts: ['/host/path:/container/path', '/tmp:/data'],
      });

      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          env: { FOO: 'bar', BAZ: 'qux' },
          volumes: { '/host/path': '/container/path', '/tmp': '/data' },
        }),
      );
    });

    it('passes workDir and user options', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        workDir: '/workspace',
        user: 'root',
      });

      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          workingDir: '/workspace',
        }),
      );
    });

    it('throws if projectId is missing', async () => {
      await expect(
        runner.startLoop({
          projectId: '',
          dockerImage: 'ubuntu:22.04',
          mode: LoopMode.SINGLE,
        }),
      ).rejects.toThrow('projectId must be a non-empty string');
    });

    it('throws if dockerImage is missing', async () => {
      await expect(
        runner.startLoop({
          projectId: 'proj-123',
          projectName: 'Test Project',          dockerImage: '',
          mode: LoopMode.SINGLE,
        }),
      ).rejects.toThrow('dockerImage must be a non-empty string');
    });

    it('throws if loop is already running for project', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      await expect(
        runner.startLoop({
          projectId: 'proj-123',
          projectName: 'Test Project',          dockerImage: 'ubuntu:22.04',
          mode: LoopMode.SINGLE,
        }),
      ).rejects.toThrow('Loop for project proj-123 is already running');
    });

    it('throws if concurrency limit is reached', async () => {
      runner.setMaxConcurrent(2);

      await runner.startLoop({
        projectId: 'proj-1',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
      });

      await runner.startLoop({
        projectId: 'proj-2',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
      });

      await expect(
        runner.startLoop({
          projectId: 'proj-3',
          projectName: 'Test Project',          dockerImage: 'ubuntu:22.04',
          mode: LoopMode.CONTINUOUS,
        }),
      ).rejects.toThrow('Concurrency limit reached: 2/2 loops running');
    });

    it('transitions to FAILED if container creation fails', async () => {
      vi.mocked(docker.createContainer).mockRejectedValueOnce(new Error('Docker unavailable'));

      await expect(
        runner.startLoop({
          projectId: 'proj-123',
          projectName: 'Test Project',          dockerImage: 'ubuntu:22.04',
          mode: LoopMode.SINGLE,
        }),
      ).rejects.toThrow('Docker unavailable');

      const state = runner.getLoopState('proj-123');
      expect(state?.status).toBe(LoopStatus.FAILED);
      expect(state?.error).toContain('Docker unavailable');
      expect(state?.stoppedAt).toBeTruthy();
    });

    it('transitions to FAILED if container start fails', async () => {
      vi.mocked(docker.startContainer).mockRejectedValueOnce(new Error('Start failed'));

      await expect(
        runner.startLoop({
          projectId: 'proj-123',
          projectName: 'Test Project',          dockerImage: 'ubuntu:22.04',
          mode: LoopMode.SINGLE,
        }),
      ).rejects.toThrow('Start failed');

      const state = runner.getLoopState('proj-123');
      expect(state?.status).toBe(LoopStatus.FAILED);
      expect(state?.error).toContain('Start failed');
    });
  });

  // -- Stopping loops ---------------------------------------------------------

  describe('stopLoop', () => {
    it('stops container and transitions to STOPPED', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
      });

      await runner.stopLoop('proj-123');

      const state = runner.getLoopState('proj-123');
      expect(state?.status).toBe(LoopStatus.STOPPED);
      expect(state?.stoppedAt).toBeTruthy();
      expect(docker.stopContainer).toHaveBeenCalledWith('container-123', 10);
    });

    it('aborts log streaming when stopping', async () => {
      const abortController = { abort: vi.fn() };
      vi.mocked(docker.streamLogs).mockResolvedValueOnce(abortController as any);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
      });

      await runner.stopLoop('proj-123');

      expect(abortController.abort).toHaveBeenCalled();
    });

    it('throws if loop does not exist', async () => {
      await expect(runner.stopLoop('nonexistent')).rejects.toThrow('No loop found for project');
    });

    it('throws if loop is already in terminal state', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      await runner.stopLoop('proj-123');

      await expect(runner.stopLoop('proj-123')).rejects.toThrow(
        'already in terminal state',
      );
    });

    it('transitions to FAILED if stop fails', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
      });

      vi.mocked(docker.stopContainer).mockRejectedValueOnce(new Error('Stop failed'));

      await expect(runner.stopLoop('proj-123')).rejects.toThrow('Stop failed');

      const state = runner.getLoopState('proj-123');
      expect(state?.status).toBe(LoopStatus.FAILED);
      expect(state?.error).toContain('Stop failed');
    });

    it('handles stopping before container is created', async () => {
      // Mock createContainer to delay
      let resolveContainer: (value: string) => void;
      const containerPromise = new Promise<string>((resolve) => {
        resolveContainer = resolve;
      });

      vi.mocked(docker.createContainer).mockImplementation(() => containerPromise);

      const startPromise = runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      // Wait for state to be set to STARTING
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Now resolve the container creation
      resolveContainer!('container-123');

      // Wait for the start to complete
      await startPromise;

      const state = runner.getLoopState('proj-123');
      expect(state?.status).toBe(LoopStatus.RUNNING);
      expect(state?.containerId).toBe('container-123');
    });
  });

  // -- State queries ----------------------------------------------------------

  describe('getLoopState', () => {
    it('returns null for nonexistent loop', () => {
      expect(runner.getLoopState('nonexistent')).toBeNull();
    });

    it('returns state for existing loop', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      const state = runner.getLoopState('proj-123');
      expect(state).toBeTruthy();
      expect(state?.projectId).toBe('proj-123');
    });
  });

  describe('listRunning', () => {
    it('returns empty array when no loops', () => {
      expect(runner.listRunning()).toEqual([]);
    });

    it('lists only active loops', async () => {
      await runner.startLoop({
        projectId: 'proj-1',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
      });

      await runner.startLoop({
        projectId: 'proj-2',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
      });

      await runner.stopLoop('proj-2');

      const running = runner.listRunning();
      expect(running).toHaveLength(1);
      expect(running[0].projectId).toBe('proj-1');
    });
  });

  describe('listAll', () => {
    it('returns all loops including terminal states', async () => {
      await runner.startLoop({
        projectId: 'proj-1',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
      });

      await runner.startLoop({
        projectId: 'proj-2',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
      });

      await runner.stopLoop('proj-2');

      const all = runner.listAll();
      expect(all).toHaveLength(2);
      expect(all.map((s) => s.projectId)).toContain('proj-1');
      expect(all.map((s) => s.projectId)).toContain('proj-2');
    });
  });

  describe('removeLoop', () => {
    it('removes loop in terminal state', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      await runner.stopLoop('proj-123');

      runner.removeLoop('proj-123');
      expect(runner.getLoopState('proj-123')).toBeNull();
    });

    it('throws if loop is still active', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
      });

      expect(() => runner.removeLoop('proj-123')).toThrow('Cannot remove active loop');
    });

    it('does nothing if loop does not exist', () => {
      expect(() => runner.removeLoop('nonexistent')).not.toThrow();
    });
  });

  // -- Callbacks --------------------------------------------------------------

  describe('state change callbacks', () => {
    it('calls callbacks on state transitions', async () => {
      const callback = vi.fn();
      runner.onStateChange(callback);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      // Should be called multiple times: STARTING, containerId update, RUNNING
      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);

      const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(lastCall.status).toBe(LoopStatus.RUNNING);
    });

    it('can remove callbacks', async () => {
      const callback = vi.fn();
      runner.onStateChange(callback);
      runner.removeStateCallback(callback);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('does not throw if callback throws', async () => {
      const badCallback = vi.fn(() => {
        throw new Error('Callback error');
      });
      const goodCallback = vi.fn();

      runner.onStateChange(badCallback);
      runner.onStateChange(goodCallback);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      // Good callback should still be called
      expect(goodCallback).toHaveBeenCalled();
    });
  });

  describe('log line callbacks', () => {
    it('calls callbacks for each log line', async () => {
      const callback = vi.fn();
      runner.onLogLine(callback);

      // Set up streamLogs to call the line handler
      vi.mocked(docker.streamLogs).mockImplementationOnce(async (containerId, onLine) => {
        onLine('[main abc1234] Commit message');
        onLine('ERROR: Something went wrong');
        onLine('INFO: Normal log line');
        return { abort: vi.fn() } as any;
      });

      vi.mocked(parser.parseLine).mockImplementation((line) => {
        if (line.includes('Commit')) {
          return {
            type: 'commit',
            content: line,
            timestamp: null,
            commit_hash: 'abc1234',
          };
        }
        if (line.includes('ERROR')) {
          return { type: 'error', content: line, timestamp: null };
        }
        return { type: 'info', content: line, timestamp: null };
      });

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      // Wait for async log processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(callback).toHaveBeenCalledTimes(3);
      expect(callback).toHaveBeenCalledWith('proj-123', expect.objectContaining({ type: 'commit' }));
      expect(callback).toHaveBeenCalledWith('proj-123', expect.objectContaining({ type: 'error' }));
      expect(callback).toHaveBeenCalledWith('proj-123', expect.objectContaining({ type: 'info' }));
    });

    it('can remove callbacks', async () => {
      const callback = vi.fn();
      runner.onLogLine(callback);
      runner.removeLogCallback(callback);

      vi.mocked(docker.streamLogs).mockImplementationOnce(async (containerId, onLine) => {
        onLine('Test log line');
        return { abort: vi.fn() } as any;
      });

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(callback).not.toHaveBeenCalled();
    });
  });

  // -- Log processing ---------------------------------------------------------

  describe('log line processing', () => {
    it('tracks commits from log lines', async () => {
      vi.mocked(docker.streamLogs).mockImplementationOnce(async (containerId, onLine) => {
        onLine('[main abc1234] First commit');
        onLine('[main def5678] Second commit');
        return { abort: vi.fn() } as any;
      });

      vi.mocked(parser.parseLine).mockImplementation((line) => {
        const match = /\[main (\w+)\]/.exec(line);
        if (match) {
          return {
            type: 'commit',
            content: line,
            timestamp: null,
            commit_hash: match[1],
          };
        }
        return { type: 'info', content: line, timestamp: null };
      });

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const state = runner.getLoopState('proj-123');
      expect(state?.commits).toEqual(['abc1234', 'def5678']);
    });

    it('increments error count for error lines', async () => {
      vi.mocked(docker.streamLogs).mockImplementationOnce(async (containerId, onLine) => {
        onLine('ERROR: First error');
        onLine('ERROR: Second error');
        onLine('INFO: Normal line');
        return { abort: vi.fn() } as any;
      });

      vi.mocked(parser.parseLine).mockImplementation((line) => {
        if (line.includes('ERROR')) {
          return { type: 'error', content: line, timestamp: null };
        }
        return { type: 'info', content: line, timestamp: null };
      });

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const state = runner.getLoopState('proj-123');
      expect(state?.errors).toBe(2);
    });

    it('updates iteration from boundary markers', async () => {
      vi.mocked(docker.streamLogs).mockImplementationOnce(async (containerId, onLine) => {
        onLine('======================== LOOP 1 ========================');
        onLine('Some work...');
        onLine('======================== LOOP 2 ========================');
        return { abort: vi.fn() } as any;
      });

      vi.mocked(parser.parseIterationBoundary).mockImplementation((line) => {
        const match = /LOOP (\d+)/.exec(line);
        return match ? parseInt(match[1], 10) : null;
      });

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const state = runner.getLoopState('proj-123');
      expect(state?.iteration).toBe(2);
    });

    it('buffers logs up to 1000 lines', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 1100; i++) {
        lines.push(`Line ${i}`);
      }

      vi.mocked(docker.streamLogs).mockImplementationOnce(async (containerId, onLine) => {
        lines.forEach((line) => onLine(line));
        return { abort: vi.fn() } as any;
      });

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const state = runner.getLoopState('proj-123');
      expect(state?.logs).toHaveLength(1000);
      // Should have the last 1000 lines
      expect(state?.logs[0]).toBe('Line 100'); // First 100 dropped
      expect(state?.logs[999]).toBe('Line 1099');
    });
  });
});
