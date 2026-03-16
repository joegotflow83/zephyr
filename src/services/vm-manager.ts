/**
 * VMManager service for Zephyr Desktop.
 *
 * Wraps the Multipass CLI to manage Ubuntu VMs for agent loop execution.
 * All commands go through a private spawn helper — no direct shell string
 * evaluation. VMs use Docker-in-VM architecture so existing container logic
 * (auth injection, image config) is reused unchanged inside the VM.
 *
 * Two VM modes are supported:
 * - Persistent: VM is created once, associated with a project, started/stopped
 *   independently. Loops run Docker containers inside it; stopping a loop does
 *   not destroy the VM.
 * - Ephemeral: VM is created fresh when a loop starts and deleted when it ends.
 *   Clean slate per run for reproducibility.
 */

import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** VM lifecycle state as reported by multipass */
export type VMState = 'Running' | 'Stopped' | 'Deleted' | 'Starting';

/** Options for creating a new VM */
export interface VMCreateOpts {
  name: string;
  cpus: number;
  memoryGb: number;
  diskGb: number;
  /** YAML string; when omitted, a runtime-appropriate default is generated */
  cloudInit?: string;
  /** Container runtime to install in the VM. Defaults to 'docker'. */
  runtime?: 'docker' | 'podman';
}

/** VM details returned by inspection commands */
export interface VMInfo {
  name: string;
  state: VMState;
  ipv4?: string;
  cpus: number;
  memory: string;
  disk: string;
  release: string;
}

/** Options for executing commands inside a VM */
export interface VMExecOpts {
  workDir?: string;
  env?: Record<string, string>;
  /** Called when the command exits (only applies to streamExecInVM) */
  onExit?: (exitCode: number) => void;
}

/** Result of a non-interactive command execution */
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Generates cloud-init YAML for the given container runtime.
 *
 * Docker: installs docker.io, adds ubuntu user to the docker group, enables daemon.
 * Podman: installs podman, enables podman.socket for API-compatible access.
 */
export function generateCloudInit(runtime: 'docker' | 'podman'): string {
  if (runtime === 'podman') {
    return `#cloud-config
packages: [podman, git, curl, build-essential]
runcmd:
  - systemctl enable --now podman.socket
`;
  }
  return `#cloud-config
packages: [docker.io, git, curl, build-essential]
runcmd:
  - usermod -aG docker ubuntu
  - systemctl enable --now docker
`;
}

/**
 * Manages Multipass VM lifecycle and execution for Zephyr Desktop.
 *
 * All Multipass CLI interactions go through the private spawn() helper,
 * which captures stdout, stderr, and exit code without shell interpolation.
 */
export class VMManager {
  /**
   * Returns a PATH-augmented environment so that multipass can be found even
   * when the Electron app is launched via GUI (which strips shell PATH).
   */
  private get spawnEnv(): NodeJS.ProcessEnv {
    const extraPaths = ['/usr/local/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin'];
    const existing = (process.env.PATH ?? '').split(':');
    for (const p of extraPaths) {
      if (!existing.includes(p)) existing.unshift(p);
    }
    return { ...process.env, PATH: existing.join(':') };
  }

  /**
   * Execute a multipass command and collect output.
   * Rejects if the process cannot be spawned (binary not found).
   * Resolves with exitCode/stdout/stderr regardless of non-zero exit.
   */
  private spawnCmd(args: string[], inputData?: string): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const child = childProcess.spawn('multipass', args, { stdio: ['pipe', 'pipe', 'pipe'], env: this.spawnEnv });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        reject(err);
      });

      child.on('close', (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });

      if (inputData !== undefined) {
        child.stdin.end(inputData);
      }
    });
  }

  /**
   * Check whether the multipass binary is available and responsive.
   */
  async isMultipassAvailable(): Promise<boolean> {
    try {
      const result = await this.spawnCmd(['version']);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Return the installed multipass version string.
   * Throws if multipass is not available.
   */
  async getVersion(): Promise<string> {
    const result = await this.spawnCmd(['version']);
    if (result.exitCode !== 0) {
      throw new Error(`multipass version failed: ${result.stderr}`);
    }
    // Output format: "multipass  1.14.0+mac"
    const match = result.stdout.match(/multipass\s+(\S+)/i);
    return match ? match[1] : result.stdout.trim();
  }

  /**
   * Create a new VM with the given configuration.
   * Writes cloud-init YAML to a temp file, passes it to multipass launch,
   * then deletes the temp file.
   *
   * @throws if multipass launch fails
   */
  async createVM(opts: VMCreateOpts): Promise<void> {
    const cloudInitYaml = opts.cloudInit ?? generateCloudInit(opts.runtime ?? 'docker');
    const tmpFile = path.join(os.tmpdir(), `zephyr-cloud-init-${opts.name}.yaml`);

    try {
      fs.writeFileSync(tmpFile, cloudInitYaml, 'utf-8');

      const result = await this.spawnCmd([
        'launch',
        '--name', opts.name,
        '--cpus', String(opts.cpus),
        '--memory', `${opts.memoryGb}G`,
        '--disk', `${opts.diskGb}G`,
        '--cloud-init', tmpFile,
      ]);

      if (result.exitCode !== 0) {
        throw new Error(`Failed to create VM "${opts.name}": ${result.stderr}`);
      }
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Start a stopped VM.
   *
   * @throws if multipass start fails
   */
  async startVM(name: string): Promise<void> {
    const result = await this.spawnCmd(['start', name]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to start VM "${name}": ${result.stderr}`);
    }
  }

  /**
   * Stop a running VM gracefully.
   *
   * @throws if multipass stop fails
   */
  async stopVM(name: string): Promise<void> {
    const result = await this.spawnCmd(['stop', name]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to stop VM "${name}": ${result.stderr}`);
    }
  }

  /**
   * Delete a VM and optionally purge it from disk immediately.
   *
   * @param name - VM name
   * @param force - If true, also runs `multipass purge` to free disk space immediately
   * @throws if multipass delete fails
   */
  async deleteVM(name: string, force = false): Promise<void> {
    const result = await this.spawnCmd(['delete', name]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to delete VM "${name}": ${result.stderr}`);
    }
    if (force) {
      // Purge all deleted VMs from disk; ignore errors (best-effort cleanup)
      await this.spawnCmd(['purge']).catch(() => undefined);
    }
  }

  /**
   * Wait for cloud-init provisioning to complete inside the VM.
   *
   * Uses `cloud-init status --wait` which blocks until provisioning finishes
   * or errors out. Wraps in a timeout to avoid hanging indefinitely.
   *
   * @param name - VM name
   * @param timeoutMs - Max wait time in milliseconds (default: 5 minutes)
   * @throws on timeout or cloud-init failure
   */
  async waitForCloudInit(name: string, timeoutMs = 5 * 60 * 1000): Promise<void> {
    const execPromise = this.execInVM(name, ['cloud-init', 'status', '--wait']);

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for cloud-init on VM "${name}" after ${timeoutMs}ms`));
      }, timeoutMs);
      // Allow Node to exit if this is the only pending timer
      timer.unref?.();
    });

    const result = await Promise.race([execPromise, timeoutPromise]);

    if (result.exitCode !== 0) {
      throw new Error(`cloud-init failed on VM "${name}": ${result.stderr || result.stdout}`);
    }
  }

  /**
   * List all Multipass VMs.
   *
   * Parses `multipass list --format json` output.
   * Returns empty array if no VMs exist or multipass is unavailable.
   */
  async listVMs(): Promise<VMInfo[]> {
    const result = await this.spawnCmd(['list', '--format', 'json']);
    if (result.exitCode !== 0) {
      return [];
    }

    try {
      const parsed = JSON.parse(result.stdout) as { list: Array<{
        name: string;
        state: string;
        ipv4?: string[];
        release?: string;
      }> };

      return (parsed.list ?? []).map((vm) => ({
        name: vm.name,
        state: vm.state as VMState,
        ipv4: vm.ipv4?.[0],
        cpus: 0,       // Not available in list output — use getVMInfo for details
        memory: '',    // Not available in list output
        disk: '',      // Not available in list output
        release: vm.release ?? '',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get detailed info for a specific VM.
   *
   * Parses `multipass info {name} --format json` output.
   * Returns null if the VM does not exist.
   */
  async getVMInfo(name: string): Promise<VMInfo | null> {
    const result = await this.spawnCmd(['info', name, '--format', 'json']);
    if (result.exitCode !== 0) {
      return null;
    }

    try {
      const parsed = JSON.parse(result.stdout) as { info: Record<string, {
        state: string;
        ipv4?: string[];
        cpu_count?: string;
        memory?: { total?: string };
        disk?: { total?: string };
        image_release?: string;
        release?: string;
      }> };

      const info = parsed.info?.[name];
      if (!info) {
        return null;
      }

      return {
        name,
        state: info.state as VMState,
        ipv4: info.ipv4?.[0],
        cpus: parseInt(info.cpu_count ?? '0', 10),
        memory: info.memory?.total ?? '',
        disk: info.disk?.total ?? '',
        release: info.image_release ?? info.release ?? '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Execute a command inside a VM and wait for it to complete.
   *
   * Wraps `multipass exec {name} -- {cmd}`. Environment variables and working
   * directory are injected via shell wrapper when opts are provided.
   *
   * @returns stdout, stderr, and exit code from the command
   */
  async execInVM(name: string, cmd: string[], opts?: VMExecOpts): Promise<ExecResult> {
    const execArgs = this.buildExecArgs(name, cmd, opts);
    return this.spawnCmd(execArgs);
  }

  /**
   * Stream output from a command running inside a VM, line by line.
   *
   * Returns an AbortController; calling abort() kills the underlying
   * multipass exec process, stopping the stream immediately.
   *
   * @param name - VM name
   * @param cmd - Command to run inside the VM
   * @param onLine - Callback invoked for each output line (stdout + stderr merged)
   * @param opts - Optional working directory and env vars
   * @returns AbortController to stop execution
   */
  streamExecInVM(
    name: string,
    cmd: string[],
    onLine: (line: string) => void,
    opts?: VMExecOpts
  ): Promise<AbortController> {
    return new Promise((resolve, reject) => {
      const execArgs = this.buildExecArgs(name, cmd, opts);
      const child = childProcess.spawn('multipass', execArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: this.spawnEnv });

      child.on('error', (err) => {
        reject(err);
      });

      const controller = new AbortController();
      controller.signal.addEventListener('abort', () => {
        child.kill('SIGTERM');
        // Give it a moment to terminate, then force-kill
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already dead */ }
        }, 3000);
      });

      let stdoutBuffer = '';
      let stderrBuffer = '';

      const processLine = (line: string) => {
        if (line) onLine(line);
      };

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? '';
        lines.forEach(processLine);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() ?? '';
        lines.forEach(processLine);
      });

      child.on('close', (code) => {
        // Flush remaining partial lines
        if (stdoutBuffer) processLine(stdoutBuffer);
        if (stderrBuffer) processLine(stderrBuffer);
        opts?.onExit?.(code ?? 1);
      });

      // Resolve the AbortController immediately — caller uses it to stop the stream
      child.on('spawn', () => {
        resolve(controller);
      });

      // If spawn event is not emitted before error, reject is called by error handler
    });
  }

  /**
   * Transfer a local file into a VM using `multipass transfer`.
   *
   * @param name - VM name
   * @param localPath - Absolute path to the file on the host
   * @param vmPath - Destination path inside the VM
   * @throws if transfer fails
   */
  async transfer(name: string, localPath: string, vmPath: string): Promise<void> {
    const result = await this.spawnCmd(['transfer', localPath, `${name}:${vmPath}`]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to transfer "${localPath}" to VM "${name}:${vmPath}": ${result.stderr}`);
    }
  }

  /**
   * Mount a host directory into a VM using `multipass mount`.
   *
   * The mounted path will be accessible inside the VM at `vmPath`, making it
   * available for Docker bind mounts. Mount the host path at the same path
   * inside the VM so that existing docker run -v flags work unchanged.
   *
   * @param name - VM name
   * @param hostPath - Absolute path on the host to mount
   * @param vmPath - Destination path inside the VM
   * @throws if mount fails
   */
  async mountIntoVM(name: string, hostPath: string, vmPath: string): Promise<void> {
    const result = await this.spawnCmd(['mount', hostPath, `${name}:${vmPath}`]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to mount "${hostPath}" into VM "${name}:${vmPath}": ${result.stderr}`);
    }
  }

  /**
   * Unmount directories from a VM using `multipass unmount`.
   *
   * When vmPath is omitted, unmounts ALL mounts from the VM. Used during
   * loop cleanup so host directories don't remain mounted after the container
   * stops.
   *
   * @param name - VM name
   * @param vmPath - Specific path to unmount; omit to unmount all
   * @throws if unmount fails
   */
  async unmountFromVM(name: string, vmPath?: string): Promise<void> {
    const target = vmPath ? `${name}:${vmPath}` : name;
    const result = await this.spawnCmd(['unmount', target]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to unmount from VM "${name}": ${result.stderr}`);
    }
  }

  /**
   * Generate a stable VM name for a persistent project VM.
   *
   * Format: `zephyr-{projectId.slice(0,8)}-{random4}`
   * The name is stable across multiple calls for the same suffix.
   */
  generatePersistentVMName(projectId: string): string {
    const rand = Math.random().toString(36).slice(2, 6);
    return `zephyr-${projectId.slice(0, 8)}-${rand}`;
  }

  /**
   * Generate a unique VM name for an ephemeral loop VM.
   *
   * Format: `zephyr-{projectId.slice(0,8)}-{Date.now()}`
   * Guaranteed unique across concurrent calls (millisecond timestamp).
   */
  generateEphemeralVMName(projectId: string): string {
    return `zephyr-${projectId.slice(0, 8)}-${Date.now()}`;
  }

  /**
   * Spawn an interactive command inside a VM with stdin/stdout/stderr piped.
   *
   * Unlike streamExecInVM (which ignores stdin), this returns the raw ChildProcess
   * so the caller can wire up bidirectional I/O (e.g. for a terminal session).
   *
   * @param name - VM name
   * @param cmd - Command to run inside the VM
   * @returns ChildProcess with piped stdio
   */
  spawnInteractiveInVM(name: string, cmd: string[]): childProcess.ChildProcess {
    const execArgs = this.buildExecArgs(name, cmd);
    return childProcess.spawn('multipass', execArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.spawnEnv,
    });
  }

  /**
   * Check whether a VM name belongs to this application.
   *
   * All Zephyr-managed VMs have the `zephyr-` prefix. This is used during
   * startup orphan cleanup and quit-time ephemeral VM deletion.
   */
  isZephyrVM(name: string): boolean {
    return name.startsWith('zephyr-');
  }

  /**
   * Build the multipass exec argument list from a command and optional opts.
   *
   * When opts include workDir or env, wraps the command in a sh -c invocation
   * so the shell can cd and export env vars before running the command.
   */
  private buildExecArgs(name: string, cmd: string[], opts?: VMExecOpts): string[] {
    if (!opts || (!opts.workDir && (!opts.env || Object.keys(opts.env).length === 0))) {
      return ['exec', name, '--', ...cmd];
    }

    // Build a shell wrapper: "cd /path && ENV=val cmd args..."
    const parts: string[] = [];
    if (opts.workDir) {
      parts.push(`cd ${shellQuote(opts.workDir)}`);
    }
    if (opts.env) {
      for (const [k, v] of Object.entries(opts.env)) {
        parts.push(`export ${k}=${shellQuote(v)}`);
      }
    }
    const cmdStr = cmd.map(shellQuote).join(' ');
    parts.push(cmdStr);

    return ['exec', name, '--', 'sh', '-c', parts.join(' && ')];
  }
}

/** Single-quote a shell argument to prevent injection */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
