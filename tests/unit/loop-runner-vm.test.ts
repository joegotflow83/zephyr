/**
 * Unit tests for LoopRunner VM execution branch.
 *
 * Why these tests exist: the VM execution path wires together VMManager,
 * log streaming, state transitions, and ephemeral-VM cleanup. These tests
 * verify correctness without requiring a real Multipass installation, using
 * mocked VMManager and DockerManager instances.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoopRunner } from '../../src/services/loop-runner';
import { LogParser } from '../../src/services/log-parser';
import { LoopMode, LoopStatus } from '../../src/shared/loop-types';
import type { ContainerRuntime } from '../../src/services/container-runtime';
import type { VMManager, VMInfo, VMExecOpts } from '../../src/services/vm-manager';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockDockerManager(): ContainerRuntime {
  return {
    runtimeType: 'docker',
    isAvailable: vi.fn().mockResolvedValue(true),
    getInfo: vi.fn().mockResolvedValue({ version: '27.0', containers: 0, images: 0 }),
    isImageAvailable: vi.fn().mockResolvedValue(false),
    pullImage: vi.fn().mockResolvedValue(undefined),
    saveImage: vi.fn().mockResolvedValue(undefined),
    buildImage: vi.fn().mockResolvedValue(undefined),
    createContainer: vi.fn().mockResolvedValue('container-123'),
    startContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    listContainers: vi.fn().mockResolvedValue([]),
    getContainerStatus: vi.fn().mockResolvedValue({ id: 'c', state: 'running', status: 'Up' }),
    getContainerCreated: vi.fn().mockResolvedValue(null),
    execCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    createExecSession: vi.fn().mockResolvedValue({ id: 'exec-1', stream: {} }),
    resizeExec: vi.fn().mockResolvedValue(undefined),
    streamLogs: vi.fn().mockResolvedValue({ stop: vi.fn() }),
  } as unknown as ContainerRuntime;
}

function createMockLogParser(): LogParser {
  return {
    parseLine: vi.fn((line: string) => ({ type: 'info', content: line, timestamp: null })),
    parseIterationBoundary: vi.fn().mockReturnValue(null),
  } as unknown as LogParser;
}

/** Captures the onExit callback so tests can trigger it manually */
let capturedOnExit: ((code: number) => void) | undefined;

function createMockVMManager(): VMManager {
  const mockAbortController = { abort: vi.fn(), signal: { addEventListener: vi.fn() } };
  return {
    isMultipassAvailable: vi.fn().mockResolvedValue(true),
    getVersion: vi.fn().mockResolvedValue('1.14.0'),
    createVM: vi.fn().mockResolvedValue(undefined),
    startVM: vi.fn().mockResolvedValue(undefined),
    stopVM: vi.fn().mockResolvedValue(undefined),
    deleteVM: vi.fn().mockResolvedValue(undefined),
    waitForCloudInit: vi.fn().mockResolvedValue(undefined),
    listVMs: vi.fn().mockResolvedValue([]),
    getVMInfo: vi.fn().mockResolvedValue(null),
    execInVM: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    streamExecInVM: vi.fn().mockImplementation(
      async (
        _name: string,
        _cmd: string[],
        _onLine: (line: string) => void,
        opts?: VMExecOpts,
      ) => {
        capturedOnExit = opts?.onExit;
        return mockAbortController as unknown as AbortController;
      },
    ),
    transfer: vi.fn().mockResolvedValue(undefined),
    mountIntoVM: vi.fn().mockResolvedValue(undefined),
    unmountFromVM: vi.fn().mockResolvedValue(undefined),
    generatePersistentVMName: vi.fn().mockReturnValue('zephyr-proj1234-abcd'),
    generateEphemeralVMName: vi.fn().mockReturnValue('zephyr-proj1234-1700000000000'),
    isZephyrVM: vi.fn().mockReturnValue(true),
  } as unknown as VMManager;
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('LoopRunner — VM execution branch', () => {
  let runner: LoopRunner;
  let docker: ContainerRuntime;
  let parser: LogParser;
  let vm: VMManager;

  beforeEach(() => {
    capturedOnExit = undefined;
    docker = createMockDockerManager();
    parser = createMockLogParser();
    vm = createMockVMManager();
    runner = new LoopRunner(docker, parser, 3, vm);
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor with VMManager', () => {
    it('accepts a VMManager as 4th argument without affecting existing functionality', () => {
      const r = new LoopRunner(docker, parser, 3, vm);
      expect(r.getMaxConcurrent()).toBe(3);
    });

    it('works without VMManager (backward compat)', () => {
      const r = new LoopRunner(docker, parser);
      expect(r.getMaxConcurrent()).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // VM start — ephemeral mode (default when no vmConfig provided)
  // -------------------------------------------------------------------------

  describe('vmStartLoop — ephemeral mode', () => {
    it('creates a fresh VM and transitions to RUNNING', async () => {
      const state = await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      expect(state.status).toBe(LoopStatus.RUNNING);
      expect(state.sandboxType).toBe('vm');
      expect(state.vmName).toBeDefined();
      expect(vm.createVM).toHaveBeenCalledOnce();
      expect(vm.waitForCloudInit).toHaveBeenCalledOnce();
    });

    it('pulls from registry inside VM when image is not available locally', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'my-image:latest',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      expect(docker.isImageAvailable).toHaveBeenCalledWith('my-image:latest');
      expect(vm.execInVM).toHaveBeenCalledWith(
        expect.any(String),
        ['docker', 'pull', 'my-image:latest'],
      );
    });

    it('transfers local image into VM instead of pulling from registry', async () => {
      vi.mocked(docker.isImageAvailable).mockResolvedValueOnce(true);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'zephyr-python-dev:latest',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      expect(docker.saveImage).toHaveBeenCalledWith(
        'zephyr-python-dev:latest',
        expect.stringContaining('.tar'),
      );
      expect(vm.transfer).toHaveBeenCalled();
      expect(vm.execInVM).toHaveBeenCalledWith(
        expect.any(String),
        ['docker', 'load', '-i', '/tmp/zephyr-image.tar'],
      );
      // docker pull should NOT have been called
      expect(vm.execInVM).not.toHaveBeenCalledWith(
        expect.any(String),
        ['docker', 'pull', 'zephyr-python-dev:latest'],
      );
    });

    it('calls streamExecInVM with docker run and correct container name', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'My Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      expect(vm.streamExecInVM).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['docker', 'run', '--rm', '--name', 'my-project']),
        expect.any(Function),
        expect.objectContaining({ onExit: expect.any(Function) }),
      );
    });

    it('passes env vars as -e flags to docker run', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
        envVars: { FOO: 'bar', BAZ: 'qux' },
      });

      const call = vi.mocked(vm.streamExecInVM).mock.calls[0];
      const cmd = call[1] as string[];
      expect(cmd).toContain('-e');
      expect(cmd).toContain('FOO=bar');
      expect(cmd).toContain('BAZ=qux');
    });

    it('passes volume mounts as -v flags to docker run', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
        volumeMounts: ['/host/path:/container/path'],
      });

      const call = vi.mocked(vm.streamExecInVM).mock.calls[0];
      const cmd = call[1] as string[];
      expect(cmd).toContain('-v');
      expect(cmd).toContain('/host/path:/container/path');
    });

    it('passes workDir as -w flag to docker run', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
        workDir: '/workspace',
      });

      const call = vi.mocked(vm.streamExecInVM).mock.calls[0];
      const cmd = call[1] as string[];
      expect(cmd).toContain('-w');
      expect(cmd).toContain('/workspace');
    });

    it('passes user as -u flag to docker run', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
        user: 'root',
      });

      const call = vi.mocked(vm.streamExecInVM).mock.calls[0];
      const cmd = call[1] as string[];
      expect(cmd).toContain('-u');
      expect(cmd).toContain('root');
    });

    it('transitions to FAILED and re-throws if VM creation fails', async () => {
      vi.mocked(vm.createVM).mockRejectedValueOnce(new Error('multipass unavailable'));

      await expect(
        runner.startLoop({
          projectId: 'proj-123',
          projectName: 'Test Project',
          dockerImage: 'ubuntu:22.04',
          mode: LoopMode.SINGLE,
          sandboxType: 'vm',
          vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
        }),
      ).rejects.toThrow('multipass unavailable');

      const state = runner.getLoopState('proj-123');
      expect(state?.status).toBe(LoopStatus.FAILED);
      expect(state?.error).toContain('multipass unavailable');
      expect(state?.stoppedAt).toBeTruthy();
    });

    it('transitions to FAILED if docker pull fails inside VM', async () => {
      vi.mocked(vm.execInVM).mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'image not found',
      });

      await expect(
        runner.startLoop({
          projectId: 'proj-123',
          projectName: 'Test Project',
          dockerImage: 'bad-image:latest',
          mode: LoopMode.SINGLE,
          sandboxType: 'vm',
          vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
        }),
      ).rejects.toThrow('docker pull failed inside VM');

      const state = runner.getLoopState('proj-123');
      expect(state?.status).toBe(LoopStatus.FAILED);
    });

    it('throws if VMManager is not configured when sandboxType is vm', async () => {
      const runnerNoVM = new LoopRunner(docker, parser);

      await expect(
        runnerNoVM.startLoop({
          projectId: 'proj-123',
          projectName: 'Test Project',
          dockerImage: 'ubuntu:22.04',
          mode: LoopMode.SINGLE,
          sandboxType: 'vm',
        }),
      ).rejects.toThrow('VMManager is not configured');

      const state = runnerNoVM.getLoopState('proj-123');
      expect(state?.status).toBe(LoopStatus.FAILED);
    });
  });

  // -------------------------------------------------------------------------
  // VM start — persistent mode
  // -------------------------------------------------------------------------

  describe('vmStartLoop — persistent mode', () => {
    it('creates a new VM when none exists for the project', async () => {
      vi.mocked(vm.getVMInfo).mockResolvedValueOnce(null);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'persistent', cpus: 4, memory_gb: 8, disk_gb: 40 },
      });

      expect(vm.createVM).toHaveBeenCalledWith(
        expect.objectContaining({ cpus: 4, memoryGb: 8, diskGb: 40 }),
      );
      expect(vm.waitForCloudInit).toHaveBeenCalledOnce();
    });

    it('starts a stopped VM instead of creating a new one', async () => {
      vi.mocked(vm.getVMInfo).mockResolvedValueOnce({
        name: 'zephyr-proj1234-abcd',
        state: 'Stopped',
        cpus: 2,
        memory: '4G',
        disk: '20G',
        release: '22.04',
      } as VMInfo);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'persistent', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      expect(vm.createVM).not.toHaveBeenCalled();
      expect(vm.startVM).toHaveBeenCalledOnce();
    });

    it('proceeds directly when VM is already Running', async () => {
      vi.mocked(vm.getVMInfo).mockResolvedValueOnce({
        name: 'zephyr-proj1234-abcd',
        state: 'Running',
        cpus: 2,
        memory: '4G',
        disk: '20G',
        release: '22.04',
      } as VMInfo);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'persistent', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      expect(vm.createVM).not.toHaveBeenCalled();
      expect(vm.startVM).not.toHaveBeenCalled();
    });

    it('reuses the same VM name across multiple loop starts', async () => {
      vi.mocked(vm.getVMInfo)
        .mockResolvedValueOnce(null)  // First run: VM doesn't exist
        .mockResolvedValueOnce({      // Second run: VM is stopped
          name: 'zephyr-proj1234-abcd',
          state: 'Stopped',
          cpus: 2,
          memory: '4G',
          disk: '20G',
          release: '22.04',
        } as VMInfo);

      // First start — creates VM
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'persistent', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      // Simulate SINGLE loop completing
      capturedOnExit?.(0);
      await new Promise((r) => setTimeout(r, 10));

      // Second start — reuses existing VM name (no new generatePersistentVMName call)
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'persistent', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      // generatePersistentVMName should only be called once
      expect(vm.generatePersistentVMName).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Exit detection
  // -------------------------------------------------------------------------

  describe('exit detection via onExit callback', () => {
    it('transitions SINGLE loop to COMPLETED on natural exit', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      expect(capturedOnExit).toBeDefined();
      capturedOnExit!(0);

      const state = runner.getLoopState('proj-123');
      expect(state?.status).toBe(LoopStatus.COMPLETED);
      expect(state?.stoppedAt).toBeTruthy();
    });

    it('transitions CONTINUOUS loop to FAILED on unexpected exit', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      capturedOnExit!(1);

      const state = runner.getLoopState('proj-123');
      expect(state?.status).toBe(LoopStatus.FAILED);
      expect(state?.error).toBe('Container exited unexpectedly');
    });

    it('deletes ephemeral VM on natural exit', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      const vmName = runner.getLoopState('proj-123')!.vmName!;
      capturedOnExit!(0);

      // Wait for async deleteVM call
      await new Promise((r) => setTimeout(r, 10));

      expect(vm.deleteVM).toHaveBeenCalledWith(vmName, true);
    });

    it('does NOT delete persistent VM on natural exit', async () => {
      vi.mocked(vm.getVMInfo).mockResolvedValueOnce(null);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'persistent', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      capturedOnExit!(0);
      await new Promise((r) => setTimeout(r, 10));

      expect(vm.deleteVM).not.toHaveBeenCalled();
    });

    it('ignores onExit if loop was already manually stopped', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      await runner.stopLoop('proj-123');

      const stateAfterStop = runner.getLoopState('proj-123')!;
      expect(stateAfterStop.status).toBe(LoopStatus.STOPPED);

      // Simulate late onExit callback (race condition)
      capturedOnExit!(0);

      // State should remain STOPPED, not change to COMPLETED
      const stateFinal = runner.getLoopState('proj-123')!;
      expect(stateFinal.status).toBe(LoopStatus.STOPPED);
    });
  });

  // -------------------------------------------------------------------------
  // stopLoop() VM path
  // -------------------------------------------------------------------------

  describe('stopLoop — VM-backed loops', () => {
    it('stops the docker container inside the VM', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      await runner.stopLoop('proj-123');

      expect(vm.execInVM).toHaveBeenCalledWith(
        expect.any(String),
        ['docker', 'stop', 'test-project'],
      );
    });

    it('transitions to STOPPED after stopping VM-backed loop', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      await runner.stopLoop('proj-123');

      const state = runner.getLoopState('proj-123');
      expect(state?.status).toBe(LoopStatus.STOPPED);
      expect(state?.stoppedAt).toBeTruthy();
    });

    it('aborts log streaming when stopping VM-backed loop', async () => {
      const mockAbort = vi.fn();
      vi.mocked(vm.streamExecInVM).mockResolvedValueOnce({
        abort: mockAbort,
        signal: { addEventListener: vi.fn() },
      } as unknown as AbortController);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      await runner.stopLoop('proj-123');

      expect(mockAbort).toHaveBeenCalled();
    });

    it('deletes ephemeral VM on manual stop', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      const vmName = runner.getLoopState('proj-123')!.vmName!;

      await runner.stopLoop('proj-123');
      await new Promise((r) => setTimeout(r, 10));

      expect(vm.deleteVM).toHaveBeenCalledWith(vmName, true);
    });

    it('does NOT delete persistent VM on manual stop', async () => {
      vi.mocked(vm.getVMInfo).mockResolvedValueOnce(null);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'persistent', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      await runner.stopLoop('proj-123');
      await new Promise((r) => setTimeout(r, 10));

      expect(vm.deleteVM).not.toHaveBeenCalled();
    });

    it('transitions to FAILED if docker stop inside VM fails', async () => {
      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      // The first execInVM call was docker pull — mock stop to fail
      vi.mocked(vm.execInVM).mockRejectedValueOnce(new Error('docker stop failed'));

      await expect(runner.stopLoop('proj-123')).rejects.toThrow('docker stop failed');

      const state = runner.getLoopState('proj-123');
      expect(state?.status).toBe(LoopStatus.FAILED);
      expect(state?.error).toContain('docker stop failed');
    });
  });

  // -------------------------------------------------------------------------
  // Public VM management methods
  // -------------------------------------------------------------------------

  describe('startProjectVM', () => {
    it('throws if VMManager is not configured', async () => {
      const runnerNoVM = new LoopRunner(docker, parser);
      await expect(runnerNoVM.startProjectVM('proj-123')).rejects.toThrow(
        'VMManager is not configured',
      );
    });

    it('throws if no persistent VM is registered for the project', async () => {
      await expect(runner.startProjectVM('proj-123')).rejects.toThrow(
        'No persistent VM found for project proj-123',
      );
    });

    it('starts a stopped VM and returns updated info', async () => {
      // Register a persistent VM by starting a loop first
      vi.mocked(vm.getVMInfo)
        .mockResolvedValueOnce(null)  // During startLoop: VM doesn't exist yet
        .mockResolvedValueOnce({      // During startProjectVM: VM is stopped
          name: 'zephyr-proj1234-abcd',
          state: 'Stopped',
          cpus: 2,
          memory: '4G',
          disk: '20G',
          release: '22.04',
        } as VMInfo)
        .mockResolvedValueOnce({      // After startVM: running
          name: 'zephyr-proj1234-abcd',
          state: 'Running',
          cpus: 2,
          memory: '4G',
          disk: '20G',
          release: '22.04',
        } as VMInfo);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'persistent', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      // Mark loop as completed so we can call startProjectVM
      capturedOnExit?.(0);
      await new Promise((r) => setTimeout(r, 10));

      const info = await runner.startProjectVM('proj-123');

      expect(vm.startVM).toHaveBeenCalledTimes(1); // Only during startProjectVM
      expect(info.state).toBe('Running');
    });

    it('returns info without starting if VM is already Running', async () => {
      vi.mocked(vm.getVMInfo)
        .mockResolvedValueOnce(null)  // During startLoop
        .mockResolvedValueOnce({      // During startProjectVM
          name: 'zephyr-proj1234-abcd',
          state: 'Running',
          cpus: 2,
          memory: '4G',
          disk: '20G',
          release: '22.04',
        } as VMInfo);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'persistent', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      capturedOnExit?.(0);
      await new Promise((r) => setTimeout(r, 10));

      const info = await runner.startProjectVM('proj-123');

      expect(vm.startVM).not.toHaveBeenCalled();
      expect(info.state).toBe('Running');
    });

    it('throws if VM info not found', async () => {
      vi.mocked(vm.getVMInfo)
        .mockResolvedValueOnce(null)  // During startLoop
        .mockResolvedValueOnce(null); // During startProjectVM

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'persistent', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      capturedOnExit?.(0);
      await new Promise((r) => setTimeout(r, 10));

      await expect(runner.startProjectVM('proj-123')).rejects.toThrow('VM "zephyr-proj1234-abcd" not found');
    });
  });

  describe('stopProjectVM', () => {
    it('throws if VMManager is not configured', async () => {
      const runnerNoVM = new LoopRunner(docker, parser);
      await expect(runnerNoVM.stopProjectVM('proj-123')).rejects.toThrow(
        'VMManager is not configured',
      );
    });

    it('throws if no persistent VM is registered for the project', async () => {
      await expect(runner.stopProjectVM('proj-123')).rejects.toThrow(
        'No persistent VM registered for project proj-123',
      );
    });

    it('stops the VM when no loop is running', async () => {
      vi.mocked(vm.getVMInfo).mockResolvedValueOnce(null);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'persistent', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      // Complete the loop
      capturedOnExit?.(0);
      await new Promise((r) => setTimeout(r, 10));

      await runner.stopProjectVM('proj-123');

      expect(vm.stopVM).toHaveBeenCalledWith('zephyr-proj1234-abcd');
    });

    it('refuses to stop VM while a loop is actively running', async () => {
      vi.mocked(vm.getVMInfo).mockResolvedValueOnce(null);

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'persistent', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      await expect(runner.stopProjectVM('proj-123')).rejects.toThrow(
        'Cannot stop VM while a loop is running',
      );
    });
  });

  describe('getProjectVMInfo', () => {
    it('returns null if VMManager is not configured', async () => {
      const runnerNoVM = new LoopRunner(docker, parser);
      const info = await runnerNoVM.getProjectVMInfo('proj-123');
      expect(info).toBeNull();
    });

    it('returns null if no persistent VM is registered', async () => {
      const info = await runner.getProjectVMInfo('proj-123');
      expect(info).toBeNull();
    });

    it('returns VMInfo for a registered persistent VM', async () => {
      const vmInfoReturned: VMInfo = {
        name: 'zephyr-proj1234-abcd',
        state: 'Running',
        cpus: 2,
        memory: '4G',
        disk: '20G',
        release: '22.04',
      };

      vi.mocked(vm.getVMInfo)
        .mockResolvedValueOnce(null)         // During startLoop (create)
        .mockResolvedValueOnce(vmInfoReturned); // During getProjectVMInfo

      await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'persistent', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      capturedOnExit?.(0);
      await new Promise((r) => setTimeout(r, 10));

      const info = await runner.getProjectVMInfo('proj-123');
      expect(info).toEqual(vmInfoReturned);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrency: VM loops count towards the limit
  // -------------------------------------------------------------------------

  describe('concurrency with VM loops', () => {
    it('VM loops count towards concurrency limit', async () => {
      runner.setMaxConcurrent(1);

      await runner.startLoop({
        projectId: 'proj-1',
        projectName: 'Project 1',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
        sandboxType: 'vm',
        vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
      });

      await expect(
        runner.startLoop({
          projectId: 'proj-2',
          projectName: 'Project 2',
          dockerImage: 'ubuntu:22.04',
          mode: LoopMode.CONTINUOUS,
          sandboxType: 'vm',
          vmConfig: { vm_mode: 'ephemeral', cpus: 2, memory_gb: 4, disk_gb: 20 },
        }),
      ).rejects.toThrow('Concurrency limit reached: 1/1 loops running');
    });
  });

  // -------------------------------------------------------------------------
  // Container path unaffected
  // -------------------------------------------------------------------------

  describe('Docker container path still works with VMManager present', () => {
    it('starts a Docker container loop when sandboxType is not vm', async () => {
      const state = await runner.startLoop({
        projectId: 'proj-123',
        projectName: 'Test Project',
        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      });

      expect(state.status).toBe(LoopStatus.RUNNING);
      expect(state.containerId).toBe('container-123');
      expect(docker.createContainer).toHaveBeenCalledOnce();
      expect(vm.createVM).not.toHaveBeenCalled();
    });
  });
});
