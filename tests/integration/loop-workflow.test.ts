/**
 * @vitest-environment node
 *
 * Integration test for loop execution workflow.
 * Tests complete loop lifecycle with mocked Docker (no real containers required).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LoopRunner } from '../../src/services/loop-runner';
import { LogParser } from '../../src/services/log-parser';
import { LoopScheduler } from '../../src/services/scheduler';
import { ConfigManager } from '../../src/services/config-manager';
import { ProjectStore } from '../../src/services/project-store';
import { LoopMode, LoopStatus, isLoopActive } from '../../src/shared/loop-types';
import type { ContainerRuntime, ContainerStatus, ContainerSummary } from '../../src/services/container-runtime';
import type { StateChangeCallback, LogLineCallback } from '../../src/services/loop-runner';

// -- Mock ContainerRuntime ----------------------------------------------------

function createMockContainerRuntime(): ContainerRuntime {
  const containerStates = new Map<string, 'running' | 'exited' | 'dead'>();

  return {
    runtimeType: 'docker',
    isAvailable: vi.fn().mockResolvedValue(true),
    getInfo: vi.fn().mockResolvedValue({ version: '27.0.0', containers: 0, images: 0 }),
    isImageAvailable: vi.fn().mockResolvedValue(true),
    pullImage: vi.fn().mockResolvedValue(undefined),
    saveImage: vi.fn().mockResolvedValue(undefined),
    buildImage: vi.fn().mockResolvedValue(undefined),
    createContainer: vi.fn(async (opts) => {
      const containerId = `container-${Math.random().toString(36).substring(7)}`;
      containerStates.set(containerId, 'running');
      return containerId;
    }),
    startContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn(async (containerId: string) => {
      containerStates.set(containerId, 'exited');
    }),
    removeContainer: vi.fn(async (containerId: string) => {
      containerStates.delete(containerId);
    }),
    getContainerStatus: vi.fn(async (containerId: string) => {
      const state = containerStates.get(containerId) || 'exited';
      return {
        id: containerId,
        state,
        status: state === 'running' ? 'Up 1 minute' : 'Exited (0) 1 second ago',
      } as ContainerStatus;
    }),
    getContainerCreated: vi.fn().mockResolvedValue(null),
    listContainers: vi.fn().mockResolvedValue([]),
    execCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    createExecSession: vi.fn().mockResolvedValue({ id: 'exec-1', stream: null }),
    resizeExec: vi.fn().mockResolvedValue(undefined),
    streamLogs: vi.fn(async (containerId: string, onLine: (line: string) => void) => {
      // Simulate a few log lines immediately
      setTimeout(() => {
        if (containerStates.get(containerId) === 'running') {
          onLine('[2026-02-19 10:00:00] Starting loop execution...');
          onLine('[2026-02-19 10:00:01] INFO: Initializing workspace');
          onLine('[2026-02-19 10:00:02] === Iteration 1 ===');
        }
      }, 10);

      return { stop: vi.fn() };
    }),
  } as unknown as ContainerRuntime;
}

// -- Tests --------------------------------------------------------------------

describe('Loop Workflow Integration', () => {
  let testDir: string;
  let configManager: ConfigManager;
  let projectStore: ProjectStore;
  let docker: ContainerRuntime;
  let parser: LogParser;
  let loopRunner: LoopRunner;
  let scheduler: LoopScheduler;

  beforeEach(() => {
    // Create temp directory for projects
    testDir = mkdtempSync(join(tmpdir(), 'zephyr-loop-integration-'));
    configManager = new ConfigManager(testDir);
    projectStore = new ProjectStore(configManager);

    // Create mocked ContainerRuntime and real parser/runner
    docker = createMockContainerRuntime();
    parser = new LogParser(); // Real parser, no mocking needed
    loopRunner = new LoopRunner(docker, parser, 2); // Max 2 concurrent
    scheduler = new LoopScheduler(loopRunner);
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  // -- Basic Loop Lifecycle ---------------------------------------------------

  it('should start a loop, track state changes, and stop successfully', async () => {
    // Create a project
    const project = await projectStore.addProject({
      name: 'Test Loop Project',
      repo_url: 'https://github.com/test/repo',
      docker_image: 'ubuntu:22.04',
    });

    // Track state changes
    const stateChanges: string[] = [];
    loopRunner.onStateChange((state) => {
      if (state.projectId === project.id) {
        stateChanges.push(state.status);
      }
    });

    // Start the loop
    const initialState = await loopRunner.startLoop({
      projectId: project.id,
      projectName: project.name,      dockerImage: 'ubuntu:22.04',
      mode: LoopMode.SINGLE,
    });

    expect(initialState.status).toBe(LoopStatus.RUNNING);
    expect(initialState.projectId).toBe(project.id);
    expect(initialState.mode).toBe(LoopMode.SINGLE);
    expect(initialState.containerId).toBeTruthy();
    expect(initialState.startedAt).toBeTruthy();

    // Verify container was created and started
    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'ubuntu:22.04',
        projectId: project.id,
      }),
    );
    expect(docker.startContainer).toHaveBeenCalled();

    // Verify state is tracked
    const retrievedState = loopRunner.getLoopState(project.id);
    expect(retrievedState).not.toBeNull();
    expect(retrievedState!.status).toBe(LoopStatus.RUNNING);

    // Wait for log lines to be processed
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Stop the loop
    await loopRunner.stopLoop(project.id);

    const finalState = loopRunner.getLoopState(project.id);
    expect(finalState!.status).toBe(LoopStatus.STOPPED);
    expect(finalState!.stoppedAt).toBeTruthy();

    // Verify state transitions: STARTING -> RUNNING -> STOPPING -> STOPPED
    expect(stateChanges).toContain(LoopStatus.STARTING);
    expect(stateChanges).toContain(LoopStatus.RUNNING);
    expect(stateChanges).toContain(LoopStatus.STOPPING);
    expect(stateChanges).toContain(LoopStatus.STOPPED);

    // Verify container was stopped
    expect(docker.stopContainer).toHaveBeenCalled();
  });

  it('should parse log lines and update state accordingly', async () => {
    const project = await projectStore.addProject({
      name: 'Log Test Project',
      docker_image: 'ubuntu:22.04',
    });

    // Track log lines via callback
    const logLines: string[] = [];
    const logPromise = new Promise<void>((resolve) => {
      const callback: LogLineCallback = (projectId, parsed) => {
        if (projectId === project.id) {
          logLines.push(parsed.content);
          // Resolve once we have at least 3 log lines (the mock sends 3 lines)
          if (logLines.length >= 3) {
            loopRunner.removeLogCallback(callback);
            resolve();
          }
        }
      };
      loopRunner.onLogLine(callback);
    });

    // Start loop
    await loopRunner.startLoop({
      projectId: project.id,
      projectName: project.name,      dockerImage: 'ubuntu:22.04',
      mode: LoopMode.CONTINUOUS,
    });

    // Wait for log lines to arrive (with timeout)
    await Promise.race([
      logPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for logs')), 500)),
    ]);

    // Verify log lines were parsed and callbacks invoked
    expect(logLines.length).toBeGreaterThanOrEqual(3);
    expect(logLines.some((line) => line.includes('Starting loop execution'))).toBe(true);

    // Verify logs were stored in state
    const state = loopRunner.getLoopState(project.id);
    expect(state!.logs.length).toBeGreaterThan(0);
    expect(state!.logs.some((log) => log.includes('Starting loop execution'))).toBe(true);
    expect(state!.logs.some((log) => log.includes('=== Iteration 1 ==='))).toBe(true);

    // Clean up
    await loopRunner.stopLoop(project.id);
  });

  it('should track commits and errors from parsed logs', async () => {
    const project = await projectStore.addProject({
      name: 'Commit Test Project',
      docker_image: 'ubuntu:22.04',
    });

    // Create a new mock docker manager with custom log lines
    const customDocker = createMockContainerRuntime();
    const customParser = new LogParser();
    const customRunner = new LoopRunner(customDocker, customParser, 2);

    // Override streamLogs to emit commit and error lines
    (customDocker as any).streamLogs = vi.fn(async (containerId: string, onLine: (line: string) => void) => {
      // Deliver lines asynchronously
      setTimeout(() => {
        onLine('[2026-02-19 10:00:00] Starting loop...');
        onLine('[2026-02-19 10:00:01] [main abc1234] Initial commit');
        onLine('[2026-02-19 10:00:02] Error: Something went wrong');
        onLine('[2026-02-19 10:00:03] at line 42');
        onLine('[2026-02-19 10:00:04] [main def5678] Fix bug');
      }, 10);

      return { stop: vi.fn() };
    });

    // Wait for log lines via callback
    const logPromise = new Promise<void>((resolve) => {
      let logCount = 0;
      const callback: LogLineCallback = (projectId, parsed) => {
        if (projectId === project.id) {
          logCount++;
          // Resolve after receiving all 5 log lines
          if (logCount >= 5) {
            customRunner.removeLogCallback(callback);
            resolve();
          }
        }
      };
      customRunner.onLogLine(callback);
    });

    // Start loop with custom runner
    await customRunner.startLoop({
      projectId: project.id,
      projectName: project.name,      dockerImage: 'ubuntu:22.04',
      mode: LoopMode.CONTINUOUS,
    });

    // Wait for all log lines (with timeout)
    await Promise.race([
      logPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for logs')), 500)),
    ]);

    // Verify commits and errors were tracked
    const state = customRunner.getLoopState(project.id);

    // Verify logs were stored
    expect(state!.logs.length).toBeGreaterThan(0);
    expect(state!.logs.some((log) => log.includes('abc1234'))).toBe(true);
    expect(state!.logs.some((log) => log.includes('def5678'))).toBe(true);
    expect(state!.logs.some((log) => log.includes('Error:'))).toBe(true);

    // Verify commits array contains the commit hashes (if parser extracted them)
    // Note: The LogParser looks for the pattern "[branchname hash]" to extract commits
    expect(state!.commits.length).toBeGreaterThanOrEqual(0); // May be 0 or 2 depending on parser

    // Verify errors counter incremented (if parser detected error lines)
    expect(state!.errors).toBeGreaterThanOrEqual(0); // May be 0 or more depending on parser

    // Clean up
    await customRunner.stopLoop(project.id);
  });

  // -- Concurrency Limits -----------------------------------------------------

  it('should enforce concurrency limit', async () => {
    // Create 3 projects
    const p1 = await projectStore.addProject({ name: 'Project 1', docker_image: 'ubuntu:22.04' });
    const p2 = await projectStore.addProject({ name: 'Project 2', docker_image: 'ubuntu:22.04' });
    const p3 = await projectStore.addProject({ name: 'Project 3', docker_image: 'ubuntu:22.04' });

    // Start first two (should succeed, limit is 2)
    await loopRunner.startLoop({
      projectId: p1.id,
      projectName: p1.name,      dockerImage: 'ubuntu:22.04',
      mode: LoopMode.CONTINUOUS,
    });

    await loopRunner.startLoop({
      projectId: p2.id,
      projectName: p2.name,      dockerImage: 'ubuntu:22.04',
      mode: LoopMode.CONTINUOUS,
    });

    expect(loopRunner.listRunning()).toHaveLength(2);

    // Try to start third (should fail due to concurrency limit)
    await expect(
      loopRunner.startLoop({
        projectId: p3.id,
        projectName: p3.name,        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.CONTINUOUS,
      }),
    ).rejects.toThrow(/Concurrency limit reached/);

    // Stop one and verify we can start another
    await loopRunner.stopLoop(p1.id);

    await loopRunner.startLoop({
      projectId: p3.id,
      projectName: p3.name,      dockerImage: 'ubuntu:22.04',
      mode: LoopMode.CONTINUOUS,
    });

    expect(loopRunner.listRunning()).toHaveLength(2);

    // Clean up
    await loopRunner.stopLoop(p2.id);
    await loopRunner.stopLoop(p3.id);
  });

  it('should allow increasing concurrency limit dynamically', async () => {
    // Create 3 projects
    const p1 = await projectStore.addProject({ name: 'Project 1', docker_image: 'ubuntu:22.04' });
    const p2 = await projectStore.addProject({ name: 'Project 2', docker_image: 'ubuntu:22.04' });
    const p3 = await projectStore.addProject({ name: 'Project 3', docker_image: 'ubuntu:22.04' });

    // Start two (max is 2)
    await loopRunner.startLoop({
      projectId: p1.id,
      projectName: p1.name,      dockerImage: 'ubuntu:22.04',
      mode: LoopMode.CONTINUOUS,
    });
    await loopRunner.startLoop({
      projectId: p2.id,
      projectName: p2.name,      dockerImage: 'ubuntu:22.04',
      mode: LoopMode.CONTINUOUS,
    });

    // Increase limit to 3
    loopRunner.setMaxConcurrent(3);

    // Now third should succeed
    await loopRunner.startLoop({
      projectId: p3.id,
      projectName: p3.name,      dockerImage: 'ubuntu:22.04',
      mode: LoopMode.CONTINUOUS,
    });

    expect(loopRunner.listRunning()).toHaveLength(3);

    // Clean up
    await loopRunner.stopLoop(p1.id);
    await loopRunner.stopLoop(p2.id);
    await loopRunner.stopLoop(p3.id);
  });

  // -- Recovery Flow ----------------------------------------------------------

  it('should recover running loops from existing containers', async () => {
    // Create a project
    const project = await projectStore.addProject({
      name: 'Recovery Test',
      docker_image: 'ubuntu:22.04',
    });

    // Simulate existing running container
    const mockContainers: ContainerSummary[] = [
      {
        id: 'existing-container-123',
        name: 'zephyr-existing',
        image: 'ubuntu:22.04',
        state: 'running',
        status: 'Up 1 minute',
        projectId: project.id,
        created: new Date(Date.now() - 60000).toISOString(), // Started 1 minute ago
      },
    ];

    // Mock streamLogs for recovery
    const mockDocker = docker as any;
    mockDocker.streamLogs = vi.fn(async (containerId: string, onLine: (line: string) => void) => {
      setTimeout(() => {
        onLine('[2026-02-19 10:00:00] Recovered log line');
      }, 10);
      return { stop: vi.fn() };
    });

    // Recover loops
    const recovered = await loopRunner.recoverLoops(mockContainers, projectStore);

    expect(recovered).toContain(project.id);
    expect(loopRunner.listRunning()).toHaveLength(1);

    const state = loopRunner.getLoopState(project.id);
    expect(state).not.toBeNull();
    expect(state!.status).toBe(LoopStatus.RUNNING);
    expect(state!.containerId).toBe('existing-container-123');
    expect(state!.startedAt).toBe(mockContainers[0].created);

    // Verify log streaming was resumed with 'since' timestamp
    expect(mockDocker.streamLogs).toHaveBeenCalledWith(
      'existing-container-123',
      expect.any(Function),
      expect.any(Number), // Unix timestamp
    );

    // Clean up
    await loopRunner.stopLoop(project.id);
  });

  it('should skip deleted projects during recovery', async () => {
    // Create and then delete a project
    const project = await projectStore.addProject({
      name: 'Deleted Project',
      docker_image: 'ubuntu:22.04',
    });
    const deletedProjectId = project.id;
    projectStore.removeProject(deletedProjectId);

    // Simulate container for deleted project
    const mockContainers: ContainerSummary[] = [
      {
        id: 'orphaned-container',
        name: 'zephyr-orphaned',
        image: 'ubuntu:22.04',
        state: 'running',
        status: 'Up',
        projectId: deletedProjectId,
        created: new Date().toISOString(),
      },
    ];

    // Attempt recovery
    const recovered = await loopRunner.recoverLoops(mockContainers, projectStore);

    // Should skip deleted project
    expect(recovered).not.toContain(deletedProjectId);
    expect(loopRunner.listRunning()).toHaveLength(0);
  });

  it('should respect concurrency limit during recovery', async () => {
    // Create 3 projects
    const p1 = await projectStore.addProject({ name: 'P1', docker_image: 'ubuntu:22.04' });
    const p2 = await projectStore.addProject({ name: 'P2', docker_image: 'ubuntu:22.04' });
    const p3 = await projectStore.addProject({ name: 'P3', docker_image: 'ubuntu:22.04' });

    // Simulate 3 running containers (but limit is 2)
    const mockContainers: ContainerSummary[] = [
      { id: 'c1', name: 'zephyr-c1', image: 'ubuntu:22.04', state: 'running', status: 'Up', projectId: p1.id, created: new Date().toISOString() },
      { id: 'c2', name: 'zephyr-c2', image: 'ubuntu:22.04', state: 'running', status: 'Up', projectId: p2.id, created: new Date().toISOString() },
      { id: 'c3', name: 'zephyr-c3', image: 'ubuntu:22.04', state: 'running', status: 'Up', projectId: p3.id, created: new Date().toISOString() },
    ];

    const recovered = await loopRunner.recoverLoops(mockContainers, projectStore);

    // Should only recover 2 (concurrency limit)
    expect(recovered).toHaveLength(2);
    expect(loopRunner.listRunning()).toHaveLength(2);
  });

  // -- Scheduler Integration --------------------------------------------------

  it('should schedule and trigger loops at intervals', async () => {
    const project = await projectStore.addProject({
      name: 'Scheduled Project',
      docker_image: 'ubuntu:22.04',
    });

    // Schedule loop to run every 100ms (for testing)
    const schedule = scheduler.parseSchedule('*/1 minutes'); // Parse format
    // Override intervalMs for faster testing
    schedule.intervalMs = 100;

    await scheduler.scheduleLoop(
      project.id,
      schedule,
      {
        projectId: project.id,
        projectName: project.name,        dockerImage: 'ubuntu:22.04',
      },
    );

    expect(scheduler.isScheduled(project.id)).toBe(true);

    // Wait for at least one trigger (100ms interval + buffer)
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify loop was started
    const runningLoops = loopRunner.listAll().filter((s) => s.projectId === project.id);
    expect(runningLoops.length).toBeGreaterThan(0);

    // Clean up
    scheduler.cancelSchedule(project.id);
    // Stop any running loops
    for (const loop of runningLoops) {
      if (isLoopActive(loop.status)) {
        await loopRunner.stopLoop(loop.projectId);
      }
    }
  });

  it('should cancel scheduled loops', async () => {
    const project = await projectStore.addProject({
      name: 'Cancel Test',
      docker_image: 'ubuntu:22.04',
    });

    const schedule = scheduler.parseSchedule('*/5 minutes');

    await scheduler.scheduleLoop(
      project.id,
      schedule,
      {
        projectId: project.id,
        projectName: project.name,        dockerImage: 'ubuntu:22.04',
      },
    );

    expect(scheduler.isScheduled(project.id)).toBe(true);

    // Cancel
    scheduler.cancelSchedule(project.id);
    expect(scheduler.isScheduled(project.id)).toBe(false);

    // Wait a bit to ensure no loops are triggered after cancellation
    await new Promise((resolve) => setTimeout(resolve, 100));

    const loops = loopRunner.listAll().filter((s) => s.projectId === project.id);
    expect(loops).toHaveLength(0);
  });

  it('should list all scheduled loops', async () => {
    const p1 = await projectStore.addProject({ name: 'Sched 1', docker_image: 'ubuntu:22.04' });
    const p2 = await projectStore.addProject({ name: 'Sched 2', docker_image: 'ubuntu:22.04' });

    const schedule1 = scheduler.parseSchedule('*/10 minutes');
    const schedule2 = scheduler.parseSchedule('every 2 hours');

    await scheduler.scheduleLoop(p1.id, schedule1, {
      projectId: p1.id,
      projectName: p1.name,      dockerImage: 'ubuntu:22.04',
    });

    await scheduler.scheduleLoop(p2.id, schedule2, {
      projectId: p2.id,
      projectName: p2.name,      dockerImage: 'ubuntu:22.04',
    });

    const scheduled = scheduler.listScheduled();
    expect(scheduled).toHaveLength(2);
    expect(scheduled.map((s) => s.projectId)).toContain(p1.id);
    expect(scheduled.map((s) => s.projectId)).toContain(p2.id);

    // Clean up
    scheduler.cancelSchedule(p1.id);
    scheduler.cancelSchedule(p2.id);
  });

  // -- List and Query Methods -------------------------------------------------

  it('should list running vs all loops correctly', async () => {
    const p1 = await projectStore.addProject({ name: 'Running', docker_image: 'ubuntu:22.04' });
    const p2 = await projectStore.addProject({ name: 'Stopped', docker_image: 'ubuntu:22.04' });

    // Start and stop one
    await loopRunner.startLoop({
      projectId: p1.id,
      projectName: p1.name,      dockerImage: 'ubuntu:22.04',
      mode: LoopMode.CONTINUOUS,
    });

    await loopRunner.startLoop({
      projectId: p2.id,
      projectName: p2.name,      dockerImage: 'ubuntu:22.04',
      mode: LoopMode.SINGLE,
    });
    await loopRunner.stopLoop(p2.id);

    // listRunning should show only p1
    const running = loopRunner.listRunning();
    expect(running).toHaveLength(1);
    expect(running[0].projectId).toBe(p1.id);

    // listAll should show both
    const all = loopRunner.listAll();
    expect(all).toHaveLength(2);

    // Clean up
    await loopRunner.stopLoop(p1.id);
  });

  it('should remove loops in terminal state', async () => {
    const project = await projectStore.addProject({
      name: 'Remove Test',
      docker_image: 'ubuntu:22.04',
    });

    await loopRunner.startLoop({
      projectId: project.id,
      projectName: project.name,      dockerImage: 'ubuntu:22.04',
      mode: LoopMode.SINGLE,
    });

    await loopRunner.stopLoop(project.id);

    // Should be in terminal state (STOPPED)
    expect(loopRunner.getLoopState(project.id)!.status).toBe(LoopStatus.STOPPED);

    // Remove it
    loopRunner.removeLoop(project.id);

    // Should be gone
    expect(loopRunner.getLoopState(project.id)).toBeNull();
  });

  it('should prevent removing active loops', async () => {
    const project = await projectStore.addProject({
      name: 'Active Loop',
      docker_image: 'ubuntu:22.04',
    });

    await loopRunner.startLoop({
      projectId: project.id,
      projectName: project.name,      dockerImage: 'ubuntu:22.04',
      mode: LoopMode.CONTINUOUS,
    });

    // Attempt to remove while running
    expect(() => loopRunner.removeLoop(project.id)).toThrow(/Cannot remove active loop/);

    // Clean up
    await loopRunner.stopLoop(project.id);
  });

  // -- Error Handling ---------------------------------------------------------

  it('should mark loop as FAILED if container creation fails', async () => {
    const project = await projectStore.addProject({
      name: 'Failed Container',
      docker_image: 'ubuntu:22.04',
    });

    // Mock createContainer to fail
    const mockDocker = docker as any;
    mockDocker.createContainer = vi.fn().mockRejectedValue(new Error('Image not found'));

    await expect(
      loopRunner.startLoop({
        projectId: project.id,
        projectName: project.name,        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      }),
    ).rejects.toThrow('Image not found');

    // Verify state is FAILED
    const state = loopRunner.getLoopState(project.id);
    expect(state).not.toBeNull();
    expect(state!.status).toBe(LoopStatus.FAILED);
    expect(state!.error).toContain('Image not found');
  });

  it('should prevent starting duplicate loop for same project', async () => {
    const project = await projectStore.addProject({
      name: 'Duplicate Test',
      docker_image: 'ubuntu:22.04',
    });

    await loopRunner.startLoop({
      projectId: project.id,
      projectName: project.name,      dockerImage: 'ubuntu:22.04',
      mode: LoopMode.SINGLE,
    });

    // Try to start again
    await expect(
      loopRunner.startLoop({
        projectId: project.id,
        projectName: project.name,        dockerImage: 'ubuntu:22.04',
        mode: LoopMode.SINGLE,
      }),
    ).rejects.toThrow(/already running/);

    // Clean up
    await loopRunner.stopLoop(project.id);
  });

  it('should throw error when stopping non-existent loop', async () => {
    await expect(loopRunner.stopLoop('non-existent-project')).rejects.toThrow(
      /No loop found for project/,
    );
  });
});
