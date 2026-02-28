/**
 * Unit tests for src/services/vm-manager.ts
 *
 * VMManager wraps the Multipass CLI to manage Ubuntu VMs. Tests mock
 * child_process.spawn so no real Multipass binary is required.
 *
 * Why we test VMManager thoroughly: it is the only interface between Zephyr
 * and the host VM lifecycle. Bugs here could leave orphaned VMs consuming
 * significant host resources or cause data loss if the wrong VM is deleted.
 */

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { EventEmitter } from 'events';

// Hoist mocks so they are available when vi.mock factory runs
const { mockSpawn, mockWriteFileSync, mockUnlinkSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  default: {
    spawn: mockSpawn,
  },
}));

vi.mock('fs', () => ({
  default: {
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
  },
}));

vi.mock('os', () => ({
  default: {
    tmpdir: () => '/tmp',
  },
}));

import { VMManager } from '../../src/services/vm-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake child process that emits stdout/stderr data and then closes */
function makeChild(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  spawnError?: Error;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn() };
  child.kill = vi.fn();

  // Schedule async emission so tests can await the Promise
  setTimeout(() => {
    if (opts.spawnError) {
      child.emit('error', opts.spawnError);
      return;
    }
    if (opts.stdout) {
      child.stdout.emit('data', Buffer.from(opts.stdout));
    }
    if (opts.stderr) {
      child.stderr.emit('data', Buffer.from(opts.stderr));
    }
    child.emit('spawn');
    child.emit('close', opts.exitCode ?? 0);
  }, 0);

  return child;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VMManager', () => {
  let vm: VMManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vm = new VMManager();
  });

  // -------------------------------------------------------------------------
  describe('isMultipassAvailable', () => {
    it('returns true when multipass version exits 0', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0, stdout: 'multipass  1.14.0\n' }));

      const result = await vm.isMultipassAvailable();

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith('multipass', ['version'], expect.any(Object));
    });

    it('returns false when multipass version exits non-zero', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 1, stderr: 'not found' }));

      const result = await vm.isMultipassAvailable();

      expect(result).toBe(false);
    });

    it('returns false when spawn throws (binary not found)', async () => {
      mockSpawn.mockReturnValue(makeChild({ spawnError: new Error('ENOENT') }));

      const result = await vm.isMultipassAvailable();

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('getVersion', () => {
    it('returns version string on success', async () => {
      mockSpawn.mockReturnValue(makeChild({ stdout: 'multipass  1.14.0+mac\n' }));

      const version = await vm.getVersion();

      expect(version).toBe('1.14.0+mac');
    });

    it('throws when exit code is non-zero', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 1, stderr: 'command not found' }));

      await expect(vm.getVersion()).rejects.toThrow('multipass version failed');
    });
  });

  // -------------------------------------------------------------------------
  describe('createVM', () => {
    it('writes cloud-init to a temp file and launches VM', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0 }));

      await vm.createVM({ name: 'zephyr-abc12345-x1y2', cpus: 2, memoryGb: 4, diskGb: 20 });

      // Temp file should have been written with default cloud-init
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/tmp/zephyr-cloud-init-zephyr-abc12345-x1y2.yaml',
        expect.stringContaining('#cloud-config'),
        'utf-8'
      );

      // multipass launch should have been called with correct args
      expect(mockSpawn).toHaveBeenCalledWith(
        'multipass',
        [
          'launch',
          '--name', 'zephyr-abc12345-x1y2',
          '--cpus', '2',
          '--memory', '4G',
          '--disk', '20G',
          '--cloud-init', '/tmp/zephyr-cloud-init-zephyr-abc12345-x1y2.yaml',
        ],
        expect.any(Object)
      );

      // Temp file should be cleaned up
      expect(mockUnlinkSync).toHaveBeenCalledWith('/tmp/zephyr-cloud-init-zephyr-abc12345-x1y2.yaml');
    });

    it('uses custom cloud-init YAML when provided', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0 }));
      const customYaml = '#cloud-config\npackages: [curl]';

      await vm.createVM({ name: 'test-vm', cpus: 1, memoryGb: 2, diskGb: 10, cloudInit: customYaml });

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.any(String),
        customYaml,
        'utf-8'
      );
    });

    it('cleans up temp file even when launch fails', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 1, stderr: 'launch failed' }));

      await expect(
        vm.createVM({ name: 'fail-vm', cpus: 2, memoryGb: 4, diskGb: 20 })
      ).rejects.toThrow('Failed to create VM');

      // Temp file must be cleaned up regardless
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('throws with descriptive message when launch fails', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 1, stderr: 'not enough disk space' }));

      await expect(
        vm.createVM({ name: 'fail-vm', cpus: 2, memoryGb: 4, diskGb: 20 })
      ).rejects.toThrow('not enough disk space');
    });
  });

  // -------------------------------------------------------------------------
  describe('startVM', () => {
    it('calls multipass start with VM name', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0 }));

      await vm.startVM('zephyr-abc-x1y2');

      expect(mockSpawn).toHaveBeenCalledWith('multipass', ['start', 'zephyr-abc-x1y2'], expect.any(Object));
    });

    it('throws when multipass start fails', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 1, stderr: 'No such instance' }));

      await expect(vm.startVM('nonexistent')).rejects.toThrow('Failed to start VM');
    });
  });

  // -------------------------------------------------------------------------
  describe('stopVM', () => {
    it('calls multipass stop with VM name', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0 }));

      await vm.stopVM('zephyr-abc-x1y2');

      expect(mockSpawn).toHaveBeenCalledWith('multipass', ['stop', 'zephyr-abc-x1y2'], expect.any(Object));
    });

    it('throws when multipass stop fails', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 1, stderr: 'Failed to stop' }));

      await expect(vm.stopVM('running-vm')).rejects.toThrow('Failed to stop VM');
    });
  });

  // -------------------------------------------------------------------------
  describe('deleteVM', () => {
    it('calls multipass delete without purge by default', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0 }));

      await vm.deleteVM('zephyr-abc-x1y2');

      expect(mockSpawn).toHaveBeenCalledWith('multipass', ['delete', 'zephyr-abc-x1y2'], expect.any(Object));
      expect(mockSpawn).toHaveBeenCalledTimes(1); // No purge call
    });

    it('calls multipass purge when force=true', async () => {
      mockSpawn
        .mockReturnValueOnce(makeChild({ exitCode: 0 }))    // delete
        .mockReturnValueOnce(makeChild({ exitCode: 0 }));   // purge

      await vm.deleteVM('zephyr-abc-x1y2', true);

      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(mockSpawn).toHaveBeenNthCalledWith(2, 'multipass', ['purge'], expect.any(Object));
    });

    it('throws when delete fails', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 1, stderr: 'No such instance' }));

      await expect(vm.deleteVM('nonexistent')).rejects.toThrow('Failed to delete VM');
    });

    it('continues (ignores purge errors) when purge fails after successful delete', async () => {
      mockSpawn
        .mockReturnValueOnce(makeChild({ exitCode: 0 }))    // delete succeeds
        .mockReturnValueOnce(makeChild({ exitCode: 1, stderr: 'purge failed' }));  // purge fails

      // Should resolve without throwing
      await expect(vm.deleteVM('zephyr-abc', true)).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('waitForCloudInit', () => {
    it('resolves when cloud-init status exits 0', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0, stdout: 'status: done' }));

      await expect(vm.waitForCloudInit('zephyr-abc-x1y2')).resolves.toBeUndefined();

      expect(mockSpawn).toHaveBeenCalledWith(
        'multipass',
        ['exec', 'zephyr-abc-x1y2', '--', 'cloud-init', 'status', '--wait'],
        expect.any(Object)
      );
    });

    it('throws when cloud-init exits non-zero', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 1, stderr: 'cloud-init failed' }));

      await expect(vm.waitForCloudInit('broken-vm')).rejects.toThrow('cloud-init failed');
    });

    it('rejects on timeout', async () => {
      // Make the spawn never emit close to simulate a hang
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { end: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end: vi.fn() };
      child.kill = vi.fn();
      // Never emit close — simulates hanging cloud-init
      setTimeout(() => child.emit('spawn'), 0);

      mockSpawn.mockReturnValue(child);

      await expect(vm.waitForCloudInit('slow-vm', 50)).rejects.toThrow('Timed out');
    }, 2000);
  });

  // -------------------------------------------------------------------------
  describe('listVMs', () => {
    it('returns parsed VM list from multipass list --format json', async () => {
      const json = JSON.stringify({
        list: [
          { name: 'zephyr-abc12345-x1y2', state: 'Running', ipv4: ['192.168.64.2'], release: '22.04 LTS' },
          { name: 'zephyr-def67890-a3b4', state: 'Stopped', release: '22.04 LTS' },
        ],
      });
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0, stdout: json }));

      const vms = await vm.listVMs();

      expect(vms).toHaveLength(2);
      expect(vms[0]).toMatchObject({ name: 'zephyr-abc12345-x1y2', state: 'Running', ipv4: '192.168.64.2' });
      expect(vms[1]).toMatchObject({ name: 'zephyr-def67890-a3b4', state: 'Stopped', ipv4: undefined });
    });

    it('returns empty array when no VMs exist', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0, stdout: JSON.stringify({ list: [] }) }));

      const vms = await vm.listVMs();

      expect(vms).toEqual([]);
    });

    it('returns empty array on non-zero exit', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 1, stderr: 'some error' }));

      const vms = await vm.listVMs();

      expect(vms).toEqual([]);
    });

    it('returns empty array on JSON parse error', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0, stdout: 'not-json' }));

      const vms = await vm.listVMs();

      expect(vms).toEqual([]);
    });

    it('passes --format json flag', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0, stdout: JSON.stringify({ list: [] }) }));

      await vm.listVMs();

      expect(mockSpawn).toHaveBeenCalledWith('multipass', ['list', '--format', 'json'], expect.any(Object));
    });
  });

  // -------------------------------------------------------------------------
  describe('getVMInfo', () => {
    it('returns parsed VMInfo for a running VM', async () => {
      const json = JSON.stringify({
        info: {
          'zephyr-abc-x1y2': {
            state: 'Running',
            ipv4: ['192.168.64.5'],
            cpu_count: '2',
            memory: { total: '4.0G' },
            disk: { total: '20.0G' },
            image_release: '22.04 LTS',
          },
        },
      });
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0, stdout: json }));

      const info = await vm.getVMInfo('zephyr-abc-x1y2');

      expect(info).toMatchObject({
        name: 'zephyr-abc-x1y2',
        state: 'Running',
        ipv4: '192.168.64.5',
        cpus: 2,
        memory: '4.0G',
        disk: '20.0G',
        release: '22.04 LTS',
      });
    });

    it('returns null when VM does not exist (non-zero exit)', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 1, stderr: 'No such instance' }));

      const info = await vm.getVMInfo('nonexistent');

      expect(info).toBeNull();
    });

    it('returns null when JSON parse fails', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0, stdout: 'invalid json' }));

      const info = await vm.getVMInfo('broken');

      expect(info).toBeNull();
    });

    it('returns null when VM name is not in info response', async () => {
      const json = JSON.stringify({ info: {} });
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0, stdout: json }));

      const info = await vm.getVMInfo('missing-vm');

      expect(info).toBeNull();
    });

    it('calls multipass info with --format json', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 1 }));

      await vm.getVMInfo('test-vm');

      expect(mockSpawn).toHaveBeenCalledWith(
        'multipass',
        ['info', 'test-vm', '--format', 'json'],
        expect.any(Object)
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('execInVM', () => {
    it('runs multipass exec with command args', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0, stdout: 'hello\n' }));

      const result = await vm.execInVM('zephyr-abc', ['echo', 'hello']);

      expect(mockSpawn).toHaveBeenCalledWith(
        'multipass',
        ['exec', 'zephyr-abc', '--', 'echo', 'hello'],
        expect.any(Object)
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello\n');
    });

    it('returns non-zero exit code on failure', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 127, stderr: 'command not found' }));

      const result = await vm.execInVM('vm', ['badcmd']);

      expect(result.exitCode).toBe(127);
      expect(result.stderr).toBe('command not found');
    });

    it('wraps command in sh -c when workDir is specified', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0 }));

      await vm.execInVM('vm', ['ls'], { workDir: '/home/ubuntu' });

      const spawnArgs = (mockSpawn as MockedFunction<typeof mockSpawn>).mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('sh');
      expect(spawnArgs).toContain('-c');
      const shCmd = spawnArgs[spawnArgs.length - 1];
      expect(shCmd).toContain("cd '/home/ubuntu'");
    });

    it('wraps command in sh -c when env vars are specified', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0 }));

      await vm.execInVM('vm', ['printenv', 'FOO'], { env: { FOO: 'bar' } });

      const spawnArgs = (mockSpawn as MockedFunction<typeof mockSpawn>).mock.calls[0][1] as string[];
      const shCmd = spawnArgs[spawnArgs.length - 1];
      expect(shCmd).toContain("export FOO='bar'");
    });
  });

  // -------------------------------------------------------------------------
  describe('streamExecInVM', () => {
    it('returns AbortController and delivers lines to callback', async () => {
      // Build a child that emits stdout data and then closes
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { end: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end: vi.fn() };
      child.kill = vi.fn();

      mockSpawn.mockReturnValue(child);

      const lines: string[] = [];
      const controllerPromise = vm.streamExecInVM('zephyr-vm', ['docker', 'run', '--rm', 'ubuntu'], (line) => {
        lines.push(line);
      });

      // Emit spawn so the promise resolves
      setTimeout(() => {
        child.emit('spawn');
        child.stdout.emit('data', Buffer.from('line one\nline two\n'));
        child.stderr.emit('data', Buffer.from('err line\n'));
        child.emit('close', 0);
      }, 0);

      const controller = await controllerPromise;

      // Wait a tick for line processing
      await new Promise((r) => setTimeout(r, 10));

      expect(controller).toBeInstanceOf(AbortController);
      expect(lines).toContain('line one');
      expect(lines).toContain('line two');
      expect(lines).toContain('err line');
    });

    it('calls kill on the child process when AbortController is aborted', async () => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { end: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end: vi.fn() };
      child.kill = vi.fn();

      mockSpawn.mockReturnValue(child);

      // Emit spawn immediately
      setTimeout(() => child.emit('spawn'), 0);

      const controller = await vm.streamExecInVM('vm', ['sleep', '100'], () => {});

      controller.abort();

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('rejects when spawn emits an error', async () => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { end: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end: vi.fn() };
      child.kill = vi.fn();

      setTimeout(() => child.emit('error', new Error('ENOENT multipass')), 0);

      mockSpawn.mockReturnValue(child);

      await expect(vm.streamExecInVM('vm', ['cmd'], () => {})).rejects.toThrow('ENOENT multipass');
    });
  });

  // -------------------------------------------------------------------------
  describe('transfer', () => {
    it('calls multipass transfer with correct arguments', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 0 }));

      await vm.transfer('zephyr-abc', '/local/script.sh', '/home/ubuntu/script.sh');

      expect(mockSpawn).toHaveBeenCalledWith(
        'multipass',
        ['transfer', '/local/script.sh', 'zephyr-abc:/home/ubuntu/script.sh'],
        expect.any(Object)
      );
    });

    it('throws on transfer failure', async () => {
      mockSpawn.mockReturnValue(makeChild({ exitCode: 1, stderr: 'transfer failed' }));

      await expect(vm.transfer('vm', '/src', '/dst')).rejects.toThrow('Failed to transfer');
    });
  });

  // -------------------------------------------------------------------------
  describe('generatePersistentVMName', () => {
    it('returns name starting with zephyr- prefix', () => {
      const name = vm.generatePersistentVMName('proj-1234-5678-abcd');
      expect(name).toMatch(/^zephyr-proj-123-[a-z0-9]{4}$/);
    });

    it('uses first 8 chars of projectId', () => {
      const name = vm.generatePersistentVMName('abcdefgh-rest-of-id');
      expect(name).toMatch(/^zephyr-abcdefgh-[a-z0-9]{4}$/);
    });

    it('generates different names on successive calls (random suffix)', () => {
      const names = new Set<string>();
      for (let i = 0; i < 10; i++) {
        names.add(vm.generatePersistentVMName('proj-1234'));
      }
      // Very unlikely all 10 are identical — randomness check
      expect(names.size).toBeGreaterThan(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('generateEphemeralVMName', () => {
    it('returns name starting with zephyr- prefix', () => {
      const name = vm.generateEphemeralVMName('proj-1234-5678-abcd');
      expect(name).toMatch(/^zephyr-proj-123-\d+$/);
    });

    it('uses first 8 chars of projectId', () => {
      const name = vm.generateEphemeralVMName('abcdefghijklmnop');
      expect(name).toMatch(/^zephyr-abcdefgh-\d+$/);
    });

    it('generates unique names for rapid successive calls', async () => {
      // Freeze time isn't needed — Date.now() changes fast enough
      const a = vm.generateEphemeralVMName('test-proj');
      await new Promise((r) => setTimeout(r, 2)); // ensure different ms
      const b = vm.generateEphemeralVMName('test-proj');
      expect(a).not.toBe(b);
    });
  });

  // -------------------------------------------------------------------------
  describe('isZephyrVM', () => {
    it('returns true for names starting with zephyr-', () => {
      expect(vm.isZephyrVM('zephyr-abc12345-x1y2')).toBe(true);
      expect(vm.isZephyrVM('zephyr-abc-1234567890')).toBe(true);
    });

    it('returns false for names not starting with zephyr-', () => {
      expect(vm.isZephyrVM('ubuntu-vm')).toBe(false);
      expect(vm.isZephyrVM('my-zephyr-vm')).toBe(false);
      expect(vm.isZephyrVM('')).toBe(false);
    });
  });
});
