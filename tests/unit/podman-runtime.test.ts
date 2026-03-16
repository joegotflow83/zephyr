/**
 * @vitest-environment node
 *
 * Tests for PodmanRuntime — ContainerRuntime implementation backed by Podman CLI.
 *
 * Why: PodmanRuntime wraps the podman CLI via spawn(). Tests mock child_process
 * to verify that the correct CLI arguments are assembled and that output is
 * parsed correctly, without requiring a real Podman installation.
 *
 * All child processes use explicit arg arrays (no shell strings), so tests
 * directly assert the spawned args array to catch argument injection regressions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Hoisted mocks — must be defined before any imports that use them ──────────

const { mockSpawn, mockSpawnSync, mockExistsSync, mockReaddirSync } = vi.hoisted(() => {
  const mockSpawnSync = vi.fn();
  const mockSpawn = vi.fn();
  const mockExistsSync = vi.fn().mockReturnValue(false);
  const mockReaddirSync = vi.fn().mockReturnValue([]);
  return { mockSpawn, mockSpawnSync, mockExistsSync, mockReaddirSync };
});

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  spawnSync: mockSpawnSync,
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
}));

import { PodmanRuntime } from '../../src/services/podman-runtime';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; destroyed: boolean };
  kill: ReturnType<typeof vi.fn>;
  pid?: number;
}

/**
 * Creates a mock child process that emits stdout/stderr data then closes.
 * Uses setImmediate so the caller has time to attach listeners before data flows.
 */
function createMockChild(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn(), destroyed: false };
  child.kill = vi.fn();
  child.pid = 12345;

  setImmediate(() => {
    if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr));
    child.emit('close', opts.exitCode ?? 0);
  });

  return child;
}

/** Make spawnSync('which', ['podman']) succeed with the given resolved path. */
function mockWhichPodman(path = '/usr/bin/podman') {
  mockSpawnSync.mockReturnValue({ status: 0, stdout: path, stderr: '' });
}

/** Make spawnSync('which', ['podman']) fail (not found in PATH). */
function mockWhichNotFound() {
  mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '' });
}

// ── Binary detection ──────────────────────────────────────────────────────────

describe('PodmanRuntime — binary detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('uses path returned by which when podman is in PATH', () => {
    mockWhichPodman('/usr/bin/podman');
    const runtime = new PodmanRuntime();
    expect(runtime.podmanPath).toBe('/usr/bin/podman');
  });

  it('falls back to /opt/homebrew/bin/podman when not in PATH', () => {
    mockWhichNotFound();
    mockExistsSync.mockImplementation((p: string) => p === '/opt/homebrew/bin/podman');
    const runtime = new PodmanRuntime();
    expect(runtime.podmanPath).toBe('/opt/homebrew/bin/podman');
  });

  it('falls back to /usr/local/bin/podman when homebrew path absent', () => {
    mockWhichNotFound();
    mockExistsSync.mockImplementation((p: string) => p === '/usr/local/bin/podman');
    const runtime = new PodmanRuntime();
    expect(runtime.podmanPath).toBe('/usr/local/bin/podman');
  });

  it('falls back to /usr/bin/podman when only that path exists', () => {
    mockWhichNotFound();
    mockExistsSync.mockImplementation((p: string) => p === '/usr/bin/podman');
    const runtime = new PodmanRuntime();
    expect(runtime.podmanPath).toBe('/usr/bin/podman');
  });

  it('returns bare "podman" string when no path can be resolved', () => {
    mockWhichNotFound();
    mockExistsSync.mockReturnValue(false);
    const runtime = new PodmanRuntime();
    expect(runtime.podmanPath).toBe('podman');
  });
});

// ── isAvailable ───────────────────────────────────────────────────────────────

describe('PodmanRuntime — isAvailable', () => {
  let runtime: PodmanRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWhichPodman();
    runtime = new PodmanRuntime();
  });

  it('returns true when podman info exits 0', async () => {
    mockSpawn.mockReturnValue(createMockChild({ exitCode: 0 }));

    await expect(runtime.isAvailable()).resolves.toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/podman',
      ['info', '--format', 'json'],
      expect.any(Object)
    );
  });

  it('returns false when podman info exits non-zero (machine not running)', async () => {
    mockSpawn.mockReturnValue(
      createMockChild({ exitCode: 125, stderr: 'Error: podman machine is not running' })
    );

    await expect(runtime.isAvailable()).resolves.toBe(false);
  });

  it('exposes runtimeType as "podman"', () => {
    expect(runtime.runtimeType).toBe('podman');
  });
});

// ── createContainer ───────────────────────────────────────────────────────────

describe('PodmanRuntime — createContainer', () => {
  let runtime: PodmanRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWhichPodman();
    runtime = new PodmanRuntime();
  });

  it('always includes --userns=keep-id for rootless bind mount compatibility', async () => {
    mockSpawn.mockReturnValue(createMockChild({ stdout: 'abc123\n', exitCode: 0 }));

    await runtime.createContainer({ image: 'ubuntu:22.04', projectId: 'proj-1' });

    const spawnArgs: string[] = mockSpawn.mock.calls[0][1];
    expect(spawnArgs).toContain('--userns=keep-id');
  });

  it('always includes --label zephyr-managed=true', async () => {
    mockSpawn.mockReturnValue(createMockChild({ stdout: 'abc123\n', exitCode: 0 }));

    await runtime.createContainer({ image: 'ubuntu:22.04', projectId: 'proj-1' });

    const spawnArgs: string[] = mockSpawn.mock.calls[0][1];
    const idx = spawnArgs.indexOf('zephyr-managed=true');
    expect(idx).toBeGreaterThan(-1);
    expect(spawnArgs[idx - 1]).toBe('--label');
  });

  it('always includes --label zephyr.project_id=<projectId>', async () => {
    mockSpawn.mockReturnValue(createMockChild({ stdout: 'abc123\n', exitCode: 0 }));

    await runtime.createContainer({ image: 'ubuntu:22.04', projectId: 'my-project-id' });

    const spawnArgs: string[] = mockSpawn.mock.calls[0][1];
    const idx = spawnArgs.indexOf('zephyr.project_id=my-project-id');
    expect(idx).toBeGreaterThan(-1);
    expect(spawnArgs[idx - 1]).toBe('--label');
  });

  it('translates name, workingDir, env, binds, and command args', async () => {
    mockSpawn.mockReturnValue(createMockChild({ stdout: 'container-abc\n', exitCode: 0 }));

    const id = await runtime.createContainer({
      image: 'node:20',
      projectId: 'proj-2',
      name: 'my-container',
      command: ['node', 'server.js'],
      env: { FOO: 'bar', BAZ: 'qux' },
      binds: ['/host/path:/container/path'],
      workingDir: '/app',
    });

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args[0]).toBe('create');

    // name
    expect(args[args.indexOf('--name') + 1]).toBe('my-container');
    // workingDir
    expect(args[args.indexOf('--workdir') + 1]).toBe('/app');
    // env vars (--env KEY=VALUE pairs)
    const fooIdx = args.indexOf('FOO=bar');
    expect(fooIdx).toBeGreaterThan(-1);
    expect(args[fooIdx - 1]).toBe('--env');
    const bazIdx = args.indexOf('BAZ=qux');
    expect(bazIdx).toBeGreaterThan(-1);
    expect(args[bazIdx - 1]).toBe('--env');
    // binds (--volume) — podman-runtime appends :z for SELinux relabeling
    const volIdx = args.indexOf('/host/path:/container/path:z');
    expect(volIdx).toBeGreaterThan(-1);
    expect(args[volIdx - 1]).toBe('--volume');
    // image and command at end
    const imgIdx = args.lastIndexOf('node:20');
    expect(imgIdx).toBeGreaterThan(-1);
    expect(args[imgIdx + 1]).toBe('node');
    expect(args[imgIdx + 2]).toBe('server.js');
    // returns trimmed container id
    expect(id).toBe('container-abc');
  });

  it('passes --cap-add and --security-opt when provided', async () => {
    mockSpawn.mockReturnValue(createMockChild({ stdout: 'cap-container\n', exitCode: 0 }));

    await runtime.createContainer({
      image: 'ubuntu:22.04',
      projectId: 'proj-3',
      capAdd: ['NET_ADMIN'],
      securityOpts: ['no-new-privileges'],
    });

    const args: string[] = mockSpawn.mock.calls[0][1];
    const capIdx = args.indexOf('NET_ADMIN');
    expect(capIdx).toBeGreaterThan(-1);
    expect(args[capIdx - 1]).toBe('--cap-add');
    const secIdx = args.indexOf('no-new-privileges');
    expect(secIdx).toBeGreaterThan(-1);
    expect(args[secIdx - 1]).toBe('--security-opt');
  });

  it('throws when podman create exits non-zero', async () => {
    mockSpawn.mockReturnValue(createMockChild({ stderr: 'image not found', exitCode: 1 }));

    await expect(
      runtime.createContainer({ image: 'bad-image', projectId: 'p1' })
    ).rejects.toThrow('podman create failed');
  });
});

// ── listContainers ────────────────────────────────────────────────────────────

describe('PodmanRuntime — listContainers', () => {
  let runtime: PodmanRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWhichPodman();
    runtime = new PodmanRuntime();
  });

  function makeContainerJson(projectId: string, id: string) {
    return {
      Id: id,
      Names: [`zephyr-${projectId.slice(0, 8)}`],
      Image: 'ubuntu:22.04',
      State: 'running',
      Status: 'Up 5 minutes',
      Created: '2026-03-01T10:00:00Z',
      Labels: { 'zephyr-managed': 'true', 'zephyr.project_id': projectId },
    };
  }

  it('passes --filter label=zephyr-managed=true at CLI level', async () => {
    mockSpawn.mockReturnValue(
      createMockChild({ stdout: JSON.stringify([makeContainerJson('proj-1', 'id-1')]), exitCode: 0 })
    );

    await runtime.listContainers();

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--filter');
    expect(args[args.indexOf('--filter') + 1]).toBe('label=zephyr-managed=true');
  });

  it('filters results by projectId client-side', async () => {
    const containers = [
      makeContainerJson('proj-1', 'id-1'),
      makeContainerJson('proj-2', 'id-2'),
    ];
    mockSpawn.mockReturnValue(createMockChild({ stdout: JSON.stringify(containers), exitCode: 0 }));

    const results = await runtime.listContainers({ projectId: 'proj-1' });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('id-1');
    expect(results[0].projectId).toBe('proj-1');
  });

  it('returns all containers when no filters provided', async () => {
    const containers = [
      makeContainerJson('proj-1', 'id-1'),
      makeContainerJson('proj-2', 'id-2'),
    ];
    mockSpawn.mockReturnValue(createMockChild({ stdout: JSON.stringify(containers), exitCode: 0 }));

    const results = await runtime.listContainers();

    expect(results).toHaveLength(2);
  });

  it('returns empty array when podman ps fails', async () => {
    mockSpawn.mockReturnValue(createMockChild({ exitCode: 1 }));

    await expect(runtime.listContainers()).resolves.toEqual([]);
  });

  it('returns empty array when stdout is empty', async () => {
    mockSpawn.mockReturnValue(createMockChild({ stdout: '', exitCode: 0 }));

    await expect(runtime.listContainers()).resolves.toEqual([]);
  });

  it('handles Unix timestamp Created field', async () => {
    const container = {
      ...makeContainerJson('proj-1', 'id-1'),
      Created: 1740823200, // Unix seconds
    };
    mockSpawn.mockReturnValue(createMockChild({ stdout: JSON.stringify([container]), exitCode: 0 }));

    const results = await runtime.listContainers();

    expect(results[0].created).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO string
  });
});

// ── streamLogs ────────────────────────────────────────────────────────────────

describe('PodmanRuntime — streamLogs', () => {
  let runtime: PodmanRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWhichPodman();
    runtime = new PodmanRuntime();
  });

  function createLiveChild(): MockChildProcess {
    const child = new EventEmitter() as MockChildProcess;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(), end: vi.fn(), destroyed: false };
    child.kill = vi.fn();
    child.pid = 9999;
    return child;
  }

  it('emits stdout lines to the callback', async () => {
    const child = createLiveChild();
    mockSpawn.mockReturnValue(child);

    const lines: string[] = [];
    await runtime.streamLogs('container-1', (line) => lines.push(line));

    child.stdout.emit('data', Buffer.from('line 1\nline 2\n'));

    expect(lines).toEqual(['line 1', 'line 2']);
  });

  it('emits stderr lines to the callback (podman writes logs to stderr when following)', async () => {
    const child = createLiveChild();
    mockSpawn.mockReturnValue(child);

    const lines: string[] = [];
    await runtime.streamLogs('container-1', (line) => lines.push(line));

    child.stderr.emit('data', Buffer.from('stderr line 1\nstderr line 2\n'));

    expect(lines).toEqual(['stderr line 1', 'stderr line 2']);
  });

  it('stop() sends SIGTERM to the child process', async () => {
    const child = createLiveChild();
    mockSpawn.mockReturnValue(child);

    const logStream = await runtime.streamLogs('container-x', vi.fn());
    logStream.stop();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('spawns with --follow --timestamps and container id', async () => {
    const child = createLiveChild();
    mockSpawn.mockReturnValue(child);

    await runtime.streamLogs('my-container', vi.fn());

    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/podman',
      ['logs', '--follow', '--timestamps', 'my-container'],
      expect.any(Object)
    );
  });

  it('passes --since when since parameter provided', async () => {
    const child = createLiveChild();
    mockSpawn.mockReturnValue(child);

    await runtime.streamLogs('container-1', vi.fn(), 1740000000);

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--since');
    expect(args[args.indexOf('--since') + 1]).toBe('1740000000');
  });
});

// ── buildImage ────────────────────────────────────────────────────────────────

describe('PodmanRuntime — buildImage', () => {
  let runtime: PodmanRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWhichPodman();
    runtime = new PodmanRuntime();
  });

  it('passes --build-arg KEY=VALUE for each entry in buildArgs', async () => {
    mockSpawn.mockReturnValue(createMockChild({ exitCode: 0 }));

    await runtime.buildImage('/ctx', 'myapp:latest', { VERSION: '1.0', DEBUG: 'false' });

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args[0]).toBe('build');

    const buildArgPairs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--build-arg') buildArgPairs.push(args[i + 1]);
    }
    expect(buildArgPairs).toContain('VERSION=1.0');
    expect(buildArgPairs).toContain('DEBUG=false');
  });

  it('sets -t <tag> and appends contextDir as last arg', async () => {
    mockSpawn.mockReturnValue(createMockChild({ exitCode: 0 }));

    await runtime.buildImage('/my/context', 'my-tag:v2');

    const args: string[] = mockSpawn.mock.calls[0][1];
    const tIdx = args.indexOf('-t');
    expect(tIdx).toBeGreaterThan(-1);
    expect(args[tIdx + 1]).toBe('my-tag:v2');
    expect(args[args.length - 1]).toBe('/my/context');
  });

  it('emits progress lines via onProgress callback', async () => {
    const child = new EventEmitter() as MockChildProcess;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    mockSpawn.mockReturnValue(child);

    const progressLines: string[] = [];
    const buildPromise = runtime.buildImage('/ctx', 'tag:1', undefined, (p) => {
      if (p.stream) progressLines.push(p.stream);
    });

    child.stdout.emit('data', Buffer.from('Step 1/3 : FROM ubuntu\nStep 2/3 : RUN apt-get update\n'));
    child.emit('close', 0);

    await buildPromise;

    expect(progressLines).toContain('Step 1/3 : FROM ubuntu');
    expect(progressLines).toContain('Step 2/3 : RUN apt-get update');
  });

  it('rejects when build exits non-zero', async () => {
    mockSpawn.mockReturnValue(createMockChild({ exitCode: 2 }));

    await expect(runtime.buildImage('/ctx', 'bad:tag')).rejects.toThrow('exited with code 2');
  });
});
