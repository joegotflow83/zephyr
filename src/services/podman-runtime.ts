/**
 * PodmanRuntime — ContainerRuntime implementation backed by the Podman CLI.
 *
 * Why CLI and not a library: Podman doesn't have a stable Node.js client
 * library equivalent to dockerode. The CLI is the canonical interface, and
 * spawning CLI commands (similar to how VMManager wraps multipass) keeps
 * the dependency footprint minimal.
 *
 * All child processes use explicit arg arrays via spawn() — no shell strings —
 * to prevent command injection (Task 4.2 requirement).
 */

import { ChildProcess, spawn, spawnSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { Duplex } from 'stream';

import type {
  ContainerCreateOpts,
  ContainerFilters,
  ContainerRuntime,
  ContainerStatus,
  ContainerSummary,
  ExecOpts,
  ExecResult,
  ExecSession,
  ExecSessionOpts,
  LogCallback,
  LogStream,
  ProgressCallback,
  RuntimeInfo,
} from './container-runtime';

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

/**
 * Known fallback install paths checked when `podman` is not in PATH.
 * Ordered by likelihood: macOS Homebrew first, then common Linux paths.
 */
const PODMAN_FALLBACK_PATHS = [
  '/opt/homebrew/bin/podman', // macOS Homebrew (Apple Silicon / Intel)
  '/opt/podman/bin/podman', // macOS Podman installer (.pkg)
  '/usr/local/bin/podman', // macOS / Linux manual install
  '/usr/bin/podman', // Linux package managers (dnf, apt, etc.)
];

/**
 * Resolves the absolute path to the `podman` binary.
 *
 * Strategy:
 * 1. `which podman` (Unix) / `where podman` (Windows) for PATH-based lookup.
 * 2. Fall back to known install locations.
 * 3. Return the bare string 'podman' as last resort so that the runtime
 *    can still be instantiated; isAvailable() will return false.
 */
function resolvePodmanPath(): string {
  if (process.platform === 'win32') {
    const result = spawnSync('where', ['podman'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim().split('\n')[0].trim();
    }
  } else {
    const result = spawnSync('which', ['podman'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }

  for (const p of PODMAN_FALLBACK_PATHS) {
    if (existsSync(p)) {
      return p;
    }
  }

  // Not found — caller must handle isAvailable() returning false.
  return 'podman';
}

// ---------------------------------------------------------------------------
// macOS / Windows machine socket discovery
// ---------------------------------------------------------------------------

/**
 * On macOS and Windows, podman runs inside a VM ("podman machine").
 * The CLI communicates with the VM through a UNIX socket whose path is
 * stored in CONTAINER_HOST.  That variable is set by the shell when the
 * machine starts, but Electron may not inherit it (e.g., launched from
 * Finder, Spotlight, or a desktop shortcut).
 *
 * This function scans the standard podman machine config directories for a
 * running socket file and returns a CONTAINER_HOST value suitable for
 * passing to child processes.  Returns undefined when:
 *  - we're on Linux (no machine needed for rootless podman), or
 *  - CONTAINER_HOST is already set in the environment, or
 *  - no socket file is found.
 */
function resolveMachineSocket(): string | undefined {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return undefined;
  if (process.env.CONTAINER_HOST) return undefined; // already provided by the shell

  const home = os.homedir();

  // Locations where podman machine stores its provider subdirectories.
  // Each provider dir (qemu, applehv, libkrun, wsl, …) may contain a
  // podman.sock file when the machine is running.
  const searchRoots = [
    path.join(home, '.local', 'share', 'containers', 'podman', 'machine'),
    path.join(home, '.config', 'containers', 'podman', 'machine'),
  ];

  for (const root of searchRoots) {
    if (!existsSync(root)) continue;

    // Podman v5+ may place the socket directly under the machine directory.
    const rootSock = path.join(root, 'podman.sock');
    if (existsSync(rootSock)) {
      return `unix://${rootSock}`;
    }

    // Older Podman versions nest the socket under a provider subdirectory
    // (qemu, applehv, libkrun, wsl, …).
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const sockPath = path.join(root, entry, 'podman.sock');
      if (existsSync(sockPath)) {
        // CONTAINER_HOST uses the unix:// URI scheme with an absolute path,
        // so there are three slashes total: unix:///abs/path
        return `unix://${sockPath}`;
      }
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Spawns a podman sub-command, buffers all output, and resolves with
 * { stdout, stderr, exitCode }.  Never rejects — callers check exitCode.
 *
 * All args are passed as an array (no shell expansion), satisfying the
 * injection-prevention requirement.
 *
 * On macOS/Windows the resolved machine socket (if any) is injected as
 * CONTAINER_HOST so commands work even when the Electron process didn't
 * inherit it from the user's shell.
 */
function runPodman(podmanPath: string, args: string[]): Promise<RunResult> {
  const machineSocket = resolveMachineSocket();
  const env = machineSocket
    ? { ...process.env, CONTAINER_HOST: machineSocket }
    : undefined; // undefined → spawn inherits process.env as-is

  return new Promise((resolve) => {
    const child = spawn(podmanPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    child.on('error', (err) => resolve({ stdout, stderr: err.message, exitCode: 1 }));
  });
}

// ---------------------------------------------------------------------------
// PodmanRuntime
// ---------------------------------------------------------------------------

export class PodmanRuntime implements ContainerRuntime {
  readonly runtimeType = 'podman' as const;

  /** Resolved absolute path to the podman binary. */
  readonly podmanPath: string;

  /** Active interactive exec sessions keyed by generated session ID. */
  private readonly execSessions = new Map<string, ChildProcess>();

  constructor() {
    this.podmanPath = resolvePodmanPath();
  }

  // ── Availability ──────────────────────────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    const { exitCode } = await runPodman(this.podmanPath, ['info', '--format', 'json']);
    return exitCode === 0;
  }

  async getInfo(): Promise<RuntimeInfo> {
    const { stdout, exitCode } = await runPodman(this.podmanPath, [
      'info',
      '--format',
      'json',
    ]);

    if (exitCode !== 0) {
      throw new Error(
        'Podman is not available. On macOS/Windows, ensure `podman machine` is running.'
      );
    }

    // Podman info JSON structure (v4+):
    // { version: { Version }, store: { containerStore: { number }, imageStore: { number } },
    //   host: { os, arch } }
    //
    // Some podman versions (especially during storage migration) emit non-JSON
    // text before the JSON object on stdout.  Strip any leading non-JSON lines
    // so JSON.parse doesn't throw a SyntaxError.
    const jsonStart = stdout.indexOf('{');
    const jsonText = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
    const info = JSON.parse(jsonText) as {
      version?: { Version?: string };
      store?: {
        containerStore?: { number?: number };
        imageStore?: { number?: number };
      };
      host?: { os?: string; arch?: string };
    };

    return {
      version: info.version?.Version ?? 'unknown',
      containers: info.store?.containerStore?.number ?? 0,
      images: info.store?.imageStore?.number ?? 0,
      osType: info.host?.os,
      architecture: info.host?.arch,
    };
  }

  // ── Images ─────────────────────────────────────────────────────────────────

  async isImageAvailable(image: string): Promise<boolean> {
    const { exitCode } = await runPodman(this.podmanPath, ['image', 'exists', image]);
    return exitCode === 0;
  }

  async pullImage(image: string, onProgress?: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.podmanPath, ['pull', image], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buffer = '';

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed || !onProgress) return;
        onProgress({ stream: trimmed, status: trimmed });
      };

      const handleData = (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) processLine(line);
      };

      child.stdout.on('data', handleData);
      child.stderr.on('data', handleData);

      child.on('close', (code) => {
        if (buffer.trim()) processLine(buffer);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`podman pull ${image} exited with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  async saveImage(image: string, outputPath: string): Promise<void> {
    const { exitCode, stderr } = await runPodman(this.podmanPath, [
      'save',
      '-o',
      outputPath,
      image,
    ]);
    if (exitCode !== 0) {
      throw new Error(`podman save failed: ${stderr}`);
    }
  }

  async buildImage(
    contextDir: string,
    tag: string,
    buildArgs?: Record<string, string>,
    onProgress?: ProgressCallback
  ): Promise<void> {
    const args = ['build'];

    if (buildArgs) {
      for (const [key, value] of Object.entries(buildArgs)) {
        args.push('--build-arg', `${key}=${value}`);
      }
    }

    args.push('-t', tag, contextDir);

    return new Promise((resolve, reject) => {
      const child = spawn(this.podmanPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buffer = '';

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (onProgress) onProgress({ stream: trimmed });
      };

      const handleData = (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) processLine(line);
      };

      child.stdout.on('data', handleData);
      child.stderr.on('data', handleData);

      child.on('close', (code) => {
        if (buffer.trim()) processLine(buffer);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`podman build -t ${tag} exited with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  // ── Container lifecycle ─────────────────────────────────────────────────────

  async createContainer(opts: ContainerCreateOpts): Promise<string> {
    const {
      image,
      projectId,
      name,
      command,
      env,
      binds,
      labels,
      workingDir,
      autoRemove,
      capAdd,
      securityOpts,
      networkMode,
      tty,
    } = opts;

    const args = ['create'];

    // Never pull from a remote registry — all images used here are built
    // locally. If the tag doesn't exist the error is immediate and clear
    // rather than silently falling back to docker.io (which fails in
    // non-interactive mode with a confusing "access denied" error).
    args.push('--pull=never');

    // Rootless bind mount compatibility — always required for Podman rootless.
    args.push('--userns=keep-id');

    // Use file-based logging instead of journald (Fedora/RHEL default).
    // With journald, there is a race condition where podman logs --follow called
    // on a short-lived container returns empty output because the journal has not
    // yet flushed the entries. k8s-file writes directly to disk and is available
    // immediately after the container exits.
    args.push('--log-driver=k8s-file');

    // Mandatory Zephyr management labels.
    args.push('--label', 'zephyr-managed=true');
    args.push('--label', `zephyr.project_id=${projectId}`);

    if (name) args.push('--name', name);
    if (workingDir) args.push('--workdir', workingDir);
    if (autoRemove) args.push('--rm');
    if (tty) args.push('--tty');
    if (networkMode) args.push('--network', networkMode);

    if (env) {
      for (const [k, v] of Object.entries(env)) {
        args.push('--env', `${k}=${v}`);
      }
    }

    if (binds) {
      for (const bind of binds) {
        // On SELinux-enforcing systems (Fedora, RHEL) the container process is
        // denied access to bind-mounted host directories unless the mount carries
        // an SELinux relabeling option.  Append `:z` (shared label) when the
        // caller has not already specified z, Z, or a label= option.
        const selinuxLabeled = /(?:^|,)(?:z|Z|label=)/.test(bind.split(':').slice(2).join(':'));
        args.push('--volume', selinuxLabeled ? bind : `${bind}:z`);
      }
    }

    if (labels) {
      for (const [k, v] of Object.entries(labels)) {
        args.push('--label', `${k}=${v}`);
      }
    }

    if (capAdd) {
      for (const cap of capAdd) {
        args.push('--cap-add', cap);
      }
    }

    if (securityOpts) {
      for (const opt of securityOpts) {
        args.push('--security-opt', opt);
      }
    }

    args.push(image);

    if (command) {
      args.push(...command);
    }

    const { stdout, stderr, exitCode } = await runPodman(this.podmanPath, args);
    if (exitCode !== 0) {
      throw new Error(`podman create failed: ${stderr}`);
    }

    return stdout.trim();
  }

  async startContainer(id: string): Promise<void> {
    const { exitCode, stderr } = await runPodman(this.podmanPath, ['start', id]);
    if (exitCode !== 0) {
      throw new Error(`podman start ${id} failed: ${stderr}`);
    }
  }

  async stopContainer(id: string, timeout?: number): Promise<void> {
    const args = ['stop'];
    if (timeout !== undefined) args.push('--time', String(timeout));
    args.push(id);

    const { exitCode, stderr } = await runPodman(this.podmanPath, args);
    if (exitCode !== 0) {
      throw new Error(`podman stop ${id} failed: ${stderr}`);
    }
  }

  async removeContainer(id: string, force?: boolean): Promise<void> {
    const args = ['rm'];
    if (force) args.push('--force');
    args.push(id);

    const { exitCode, stderr } = await runPodman(this.podmanPath, args);
    if (exitCode !== 0) {
      throw new Error(`podman rm ${id} failed: ${stderr}`);
    }
  }

  // ── Container introspection ─────────────────────────────────────────────────

  async getContainerStatus(id: string): Promise<ContainerStatus> {
    const { stdout, exitCode, stderr } = await runPodman(this.podmanPath, [
      'inspect',
      '--format',
      'json',
      id,
    ]);
    if (exitCode !== 0) {
      throw new Error(`podman inspect ${id} failed: ${stderr}`);
    }

    const inspectArr = JSON.parse(stdout) as Array<{
      Id: string;
      State: {
        Status: string;
        StartedAt: string;
        FinishedAt: string;
      };
    }>;

    if (!Array.isArray(inspectArr) || inspectArr.length === 0) {
      throw new Error(`Container ${id} not found`);
    }

    const inspect = inspectArr[0];
    return {
      id: inspect.Id,
      state: inspect.State.Status as ContainerStatus['state'],
      status: inspect.State.Status,
      startedAt: inspect.State.StartedAt,
      finishedAt: inspect.State.FinishedAt,
    };
  }

  async getContainerCreated(id: string): Promise<string | null> {
    try {
      const { stdout, exitCode } = await runPodman(this.podmanPath, [
        'inspect',
        '--format',
        'json',
        id,
      ]);
      if (exitCode !== 0) return null;

      const inspectArr = JSON.parse(stdout) as Array<{ Created: string }>;
      if (!Array.isArray(inspectArr) || inspectArr.length === 0) return null;

      return inspectArr[0].Created;
    } catch {
      return null;
    }
  }

  async listContainers(filters?: ContainerFilters): Promise<ContainerSummary[]> {
    // Filter at the CLI level by the mandatory zephyr-managed label.
    const args = ['ps', '--all', '--format', 'json', '--filter', 'label=zephyr-managed=true'];

    const { stdout, exitCode } = await runPodman(this.podmanPath, args);
    if (exitCode !== 0) return [];

    const trimmed = stdout.trim();
    if (!trimmed) return [];

    let containers: Array<{
      Id: string;
      Names: string | string[];
      Image: string;
      State: string;
      Status: string;
      Created: string | number;
      Labels: Record<string, string>;
    }>;

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return [];
      containers = parsed;
    } catch {
      return [];
    }

    // Apply additional client-side label filters.
    return containers
      .filter((c) => {
        if (filters?.projectId) {
          return c.Labels?.['zephyr.project_id'] === filters.projectId;
        }
        return true;
      })
      .filter((c) => {
        if (filters?.label) {
          return filters.label.every((lf) => {
            const eqIdx = lf.indexOf('=');
            if (eqIdx === -1) return lf in (c.Labels ?? {});
            const k = lf.slice(0, eqIdx);
            const v = lf.slice(eqIdx + 1);
            return c.Labels?.[k] === v;
          });
        }
        return true;
      })
      .map((c) => {
        // Names is string[] in Podman v4+ but may be a plain string in older builds.
        const nameRaw = Array.isArray(c.Names) ? c.Names[0] : c.Names;
        const name = (nameRaw ?? '').replace(/^\//, '') || 'unknown';

        // Created is a Unix timestamp (number) in some Podman versions, ISO string in others.
        const createdIso =
          typeof c.Created === 'number'
            ? new Date(c.Created * 1000).toISOString()
            : c.Created;

        return {
          id: c.Id,
          name,
          image: c.Image,
          state: c.State,
          status: c.Status,
          created: createdIso,
          projectId: c.Labels?.['zephyr.project_id'],
        };
      });
  }

  // ── Exec & logs ─────────────────────────────────────────────────────────────

  async execCommand(containerId: string, cmd: string[], opts?: ExecOpts): Promise<ExecResult> {
    const args = ['exec'];

    if (opts?.user) args.push('--user', opts.user);
    if (opts?.workingDir) args.push('--workdir', opts.workingDir);
    if (opts?.env) {
      for (const e of opts.env) args.push('--env', e);
    }

    args.push(containerId, ...cmd);

    const { stdout, stderr, exitCode } = await runPodman(this.podmanPath, args);
    return { exitCode, stdout, stderr };
  }

  async createExecSession(containerId: string, opts?: ExecSessionOpts): Promise<ExecSession> {
    const shell = opts?.shell ?? 'bash';
    const args = ['exec', '--interactive', '--tty'];

    if (opts?.user) args.push('--user', opts.user);
    if (opts?.workingDir) args.push('--workdir', opts.workingDir);
    if (opts?.env) {
      for (const e of opts.env) args.push('--env', e);
    }

    args.push(containerId, shell);

    // `podman exec --tty` requires its own stdin to be a TTY, but Node.js
    // spawns it with piped stdio.  Wrap the command in `script -q -c` which
    // allocates a host-side PTY pair so podman sees a real TTY on its stdin,
    // enabling interactive programs like vi to work correctly.
    const innerCmd = [this.podmanPath, ...args]
      .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
      .join(' ');
    const child = spawn('script', ['-q', '-c', innerCmd, '/dev/null'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Build a Duplex that bridges the child's stdin/stdout so callers receive
    // the same ReadWriteStream contract they get from DockerRuntime.
    const duplexStream = new Duplex({
      read() {
        // Push-mode: data is emitted from child stdout/stderr events below.
      },
      write(chunk, _encoding, callback) {
        if (!child.stdin.destroyed) {
          child.stdin.write(chunk, callback);
        } else {
          callback();
        }
      },
      final(callback) {
        child.stdin.end(callback);
      },
    });

    child.stdout.on('data', (data: Buffer) => duplexStream.push(data));
    child.stderr.on('data', (data: Buffer) => duplexStream.push(data));
    child.on('close', () => {
      duplexStream.push(null);
    });
    child.on('error', (err: Error) => duplexStream.destroy(err));

    const sessionId = `podman-exec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.execSessions.set(sessionId, child);
    child.on('close', () => this.execSessions.delete(sessionId));

    return { id: sessionId, stream: duplexStream as unknown as NodeJS.ReadWriteStream };
  }

  async resizeExec(execId: string, _rows: number, _cols: number): Promise<void> {
    // For CLI-based exec sessions, direct PTY resize requires a PTY library
    // (e.g. node-pty). As a best-effort, send SIGWINCH so the container shell
    // re-queries its terminal size.  This has no effect without a proper PTY.
    const child = this.execSessions.get(execId);
    if (child?.pid !== undefined) {
      try {
        process.kill(child.pid, 'SIGWINCH');
      } catch {
        // Process may have already exited — safe to ignore.
      }
    }
  }

  async streamLogs(containerId: string, onLine: LogCallback, since?: number): Promise<LogStream> {
    const args = ['logs', '--follow', '--timestamps'];

    if (since !== undefined) {
      // Podman accepts Unix seconds for --since.
      args.push('--since', String(since));
    }

    args.push(containerId);

    const child = spawn(this.podmanPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';

    const handleData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    };

    child.stdout.on('data', handleData);
    // Podman writes log output to stderr when following.
    child.stderr.on('data', handleData);

    child.on('close', () => {
      if (buffer.trim()) onLine(buffer);
    });

    return {
      stop() {
        child.kill('SIGTERM');
      },
    };
  }
}
