import { randomUUID } from 'crypto';
import { Duplex } from 'stream';

import { DockerManager } from './docker-manager';
import type { VMManager } from './vm-manager';
import type { WebContents } from 'electron';

/**
 * Terminal session metadata
 */
export interface TerminalSession {
  id: string;
  containerId: string;
  user?: string;
  createdAt: Date;
}

/**
 * Options for opening a terminal session
 */
export interface TerminalSessionOpts {
  shell?: string; // e.g., 'bash', 'sh', 'zsh'
  user?: string; // Username to run shell as (e.g., 'root')
  workingDir?: string;
  env?: string[];
  rows?: number;
  cols?: number;
}

/**
 * Internal session state tracking
 */
interface SessionState {
  session: TerminalSession;
  /** Docker exec ID, or empty string for VM sessions */
  execId: string;
  stream: NodeJS.ReadWriteStream;
  /** Additional cleanup callback invoked on session close (e.g. kill child process) */
  cleanup?: () => void;
}

/**
 * TerminalManager
 *
 * Manages the mapping between terminal UI instances and Docker exec sessions.
 * Replaces terminal_bridge.py from the Python implementation.
 *
 * Each terminal session corresponds to one Docker exec PTY session.
 * Data flows: keyboard -> IPC -> writeToSession -> exec stdin -> stdout -> IPC -> renderer
 */
export class TerminalManager {
  private sessions = new Map<string, SessionState>();
  private dockerManager: DockerManager;
  private webContents?: WebContents;

  constructor(dockerManager: DockerManager, webContents?: WebContents) {
    this.dockerManager = dockerManager;
    this.webContents = webContents;
  }

  /**
   * Set the webContents for sending terminal data to renderer
   * @param webContents - Electron WebContents instance
   */
  setWebContents(webContents: WebContents): void {
    this.webContents = webContents;
  }

  /**
   * Open a new terminal session to a container
   * @param containerId - Docker container ID
   * @param opts - Session options (shell, user, dimensions, etc.)
   * @returns Terminal session metadata
   * @throws Error if container not found or exec creation fails
   */
  async openSession(containerId: string, opts?: TerminalSessionOpts): Promise<TerminalSession> {
    // Create Docker exec session with PTY
    const execSession = await this.dockerManager.createExecSession(containerId, {
      shell: opts?.shell,
      user: opts?.user,
      workingDir: opts?.workingDir,
      env: opts?.env,
      rows: opts?.rows,
      cols: opts?.cols,
    });

    // Create session metadata
    const sessionId = randomUUID();
    const session: TerminalSession = {
      id: sessionId,
      containerId,
      user: opts?.user,
      createdAt: new Date(),
    };

    // Store session state
    this.sessions.set(sessionId, {
      session,
      execId: execSession.id,
      stream: execSession.stream,
    });

    // Forward stdout to renderer via IPC
    execSession.stream.on('data', (data: Buffer) => {
      if (this.webContents && !this.webContents.isDestroyed()) {
        this.webContents.send('terminal:data', sessionId, data.toString('utf-8'));
      }
    });

    // Handle stream end (exec session closed)
    execSession.stream.on('end', () => {
      if (this.webContents && !this.webContents.isDestroyed()) {
        this.webContents.send('terminal:closed', sessionId);
      }
      this.sessions.delete(sessionId);
    });

    // Handle stream errors
    execSession.stream.on('error', (error: Error) => {
      if (this.webContents && !this.webContents.isDestroyed()) {
        this.webContents.send('terminal:error', sessionId, error.message);
      }
      this.sessions.delete(sessionId);
    });

    return session;
  }

  /**
   * Close a terminal session
   * @param sessionId - Session ID to close
   * @throws Error if session not found
   */
  async closeSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Remove from sessions map first to prevent double-cleanup from 'end' event
    this.sessions.delete(sessionId);

    // End the stream and run any additional cleanup (e.g. kill child process)
    state.stream.end();
    state.cleanup?.();
  }

  /**
   * Write data to a terminal session (sends to exec stdin)
   * @param sessionId - Session ID to write to
   * @param data - Data to write (keyboard input)
   * @throws Error if session not found
   */
  writeToSession(sessionId: string, data: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Write to exec stdin
    state.stream.write(data);
  }

  /**
   * Resize a terminal session PTY
   * @param sessionId - Session ID to resize
   * @param cols - Number of columns
   * @param rows - Number of rows
   * @throws Error if session not found or resize fails
   */
  async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // VM sessions don't support PTY resize (no execId)
    if (!state.execId) return;

    // Resize the Docker exec PTY
    await this.dockerManager.resizeExec(state.execId, rows, cols);
  }

  /**
   * Open a terminal session to a Docker container running inside a Multipass VM.
   *
   * Routes I/O through: renderer ↔ IPC ↔ TerminalManager ↔ multipass exec ↔ docker exec ↔ container shell
   *
   * @param vmName - Multipass VM name (e.g. "zephyr-abc12345-xyz9")
   * @param containerName - Docker container name inside the VM (e.g. "my-project")
   * @param vm - VMManager instance for spawning the process
   * @param opts - Session options (shell, user, dimensions)
   * @returns Terminal session metadata
   */
  async openVMSession(
    vmName: string,
    containerName: string,
    vm: VMManager,
    opts?: TerminalSessionOpts,
  ): Promise<TerminalSession> {
    const shell = opts?.shell ?? 'bash';

    // Build the docker exec command to run inside the VM.
    // `docker exec -t` requires its own stdin to be a TTY, but multipass exec
    // uses piped stdio on the host side. We wrap the command in `script -q -c`
    // which allocates a PTY pair inside the VM so that docker exec -it sees a
    // real TTY, enabling bash to run interactively with prompts and input echo.
    const dockerArgs = ['docker', 'exec', '-it'];
    if (opts?.user) {
      dockerArgs.push('-u', opts.user);
    }
    dockerArgs.push(containerName, shell);
    // Shell-quote each argument (single-quote style) to produce a safe shell
    // command string for `script -c`. Our inputs are controlled (container
    // names are sanitized; shell/user are from a fixed set).
    const innerCmd = dockerArgs.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    const dockerExecCmd = ['script', '-q', '-c', innerCmd, '/dev/null'];

    const child = vm.spawnInteractiveInVM(vmName, dockerExecCmd);

    // Wrap child process stdio into a Duplex stream so SessionState can use
    // the same write/end interface as Docker exec sessions.
    const stream = new Duplex({
      write(chunk, _encoding, callback) {
        child.stdin!.write(chunk, callback);
      },
      final(callback) {
        child.stdin!.end();
        callback();
      },
      read() {
        // Data is pushed from child.stdout event listener below
      },
    });

    child.stdout!.on('data', (chunk: Buffer) => {
      if (!stream.push(chunk)) {
        child.stdout!.pause();
      }
    });
    stream.on('resume', () => child.stdout!.resume());

    child.stderr!.on('data', (chunk: Buffer) => {
      // Merge stderr into the stream so the terminal shows errors too
      stream.push(chunk);
    });

    child.on('close', () => stream.push(null));
    child.on('error', (err) => stream.destroy(err));

    const sessionId = randomUUID();
    const session: TerminalSession = {
      id: sessionId,
      containerId: containerName,
      user: opts?.user,
      createdAt: new Date(),
    };

    this.sessions.set(sessionId, {
      session,
      execId: '', // No Docker exec ID for VM sessions
      stream,
      cleanup: () => { try { child.kill(); } catch { /* already dead */ } },
    });

    // Forward output to renderer
    stream.on('data', (data: Buffer) => {
      if (this.webContents && !this.webContents.isDestroyed()) {
        this.webContents.send('terminal:data', sessionId, data.toString('utf-8'));
      }
    });

    stream.on('end', () => {
      if (this.webContents && !this.webContents.isDestroyed()) {
        this.webContents.send('terminal:closed', sessionId);
      }
      this.sessions.delete(sessionId);
    });

    stream.on('error', (error: Error) => {
      if (this.webContents && !this.webContents.isDestroyed()) {
        this.webContents.send('terminal:error', sessionId, error.message);
      }
      this.sessions.delete(sessionId);
    });

    return session;
  }

  /**
   * List all active terminal sessions
   * @returns Array of session metadata
   */
  listSessions(): TerminalSession[] {
    return Array.from(this.sessions.values()).map((state) => state.session);
  }

  /**
   * Get a specific session by ID
   * @param sessionId - Session ID to retrieve
   * @returns Session metadata or undefined if not found
   */
  getSession(sessionId: string): TerminalSession | undefined {
    const state = this.sessions.get(sessionId);
    return state?.session;
  }

  /**
   * Close all terminal sessions (for cleanup on shutdown)
   */
  async closeAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map((id) => this.closeSession(id)));
  }
}
