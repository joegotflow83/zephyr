import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerManager, ExecResult, ExecSession } from '../../src/services/docker-manager';
import { EventEmitter } from 'stream';

// Mock Dockerode
vi.mock('dockerode');

describe('DockerManager — exec sessions', () => {
  let dockerManager: DockerManager;
  let mockContainer: any;
  let mockExec: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock exec instance
    mockExec = {
      id: 'exec123',
      start: vi.fn(),
      inspect: vi.fn(),
      resize: vi.fn(),
    };

    // Mock container
    mockContainer = {
      exec: vi.fn().mockResolvedValue(mockExec),
    };

    // Mock docker client
    const mockDocker: any = {
      getContainer: vi.fn().mockReturnValue(mockContainer),
      getExec: vi.fn().mockReturnValue(mockExec),
    };

    // Create DockerManager with mocked docker client
    dockerManager = new DockerManager();
    (dockerManager as any).docker = mockDocker;
  });

  describe('execCommand', () => {
    it('should execute a command and return stdout', async () => {
      // Mock stream with stdout data
      const mockStream = new EventEmitter();
      mockExec.start.mockResolvedValue(mockStream);
      mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

      // Start the command execution
      const resultPromise = dockerManager.execCommand('container123', ['echo', 'hello']);

      // Emit events asynchronously to allow promise handlers to attach
      await new Promise((resolve) => setImmediate(resolve));

      // Simulate Docker multiplexed stream format for stdout
      // Header: [1, 0, 0, 0, 0, 0, 0, 6] (stream type 1=stdout, size 6)
      // Payload: "hello\n"
      const header = Buffer.from([1, 0, 0, 0, 0, 0, 0, 6]);
      const payload = Buffer.from('hello\n');
      const chunk = Buffer.concat([header, payload]);

      mockStream.emit('data', chunk);
      mockStream.emit('end');

      const result = await resultPromise;

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello\n');
      expect(result.stderr).toBe('');
    });

    it('should execute a command and return stderr', async () => {
      // Mock stream with stderr data
      const mockStream = new EventEmitter();
      mockExec.start.mockResolvedValue(mockStream);
      mockExec.inspect.mockResolvedValue({ ExitCode: 1 });

      const resultPromise = dockerManager.execCommand('container123', ['cat', '/nonexistent']);

      // Emit events asynchronously
      await new Promise((resolve) => setImmediate(resolve));

      // Simulate Docker multiplexed stream format for stderr
      // Header: [2, 0, 0, 0, 0, 0, 0, 20] (stream type 2=stderr, size 20)
      // Payload: "cat: no such file\n"
      const errorMsg = 'cat: no such file\n';
      const header = Buffer.from([2, 0, 0, 0, 0, 0, 0, errorMsg.length]);
      const payload = Buffer.from(errorMsg);
      const chunk = Buffer.concat([header, payload]);

      mockStream.emit('data', chunk);
      mockStream.emit('end');

      const result = await resultPromise;

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(errorMsg);
    });

    it('should handle both stdout and stderr', async () => {
      // Mock stream with both stdout and stderr
      const mockStream = new EventEmitter();
      mockExec.start.mockResolvedValue(mockStream);
      mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

      const resultPromise = dockerManager.execCommand('container123', ['sh', '-c', 'echo out; echo err >&2']);

      // Emit events asynchronously
      await new Promise((resolve) => setImmediate(resolve));

      // Stdout chunk
      const stdoutMsg = 'out\n';
      const stdoutHeader = Buffer.from([1, 0, 0, 0, 0, 0, 0, stdoutMsg.length]);
      const stdoutPayload = Buffer.from(stdoutMsg);
      mockStream.emit('data', Buffer.concat([stdoutHeader, stdoutPayload]));

      // Stderr chunk
      const stderrMsg = 'err\n';
      const stderrHeader = Buffer.from([2, 0, 0, 0, 0, 0, 0, stderrMsg.length]);
      const stderrPayload = Buffer.from(stderrMsg);
      mockStream.emit('data', Buffer.concat([stderrHeader, stderrPayload]));

      mockStream.emit('end');

      const result = await resultPromise;

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(stdoutMsg);
      expect(result.stderr).toBe(stderrMsg);
    });

    it('should handle multiple chunks of data', async () => {
      // Mock stream with multiple data chunks
      const mockStream = new EventEmitter();
      mockExec.start.mockResolvedValue(mockStream);
      mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

      const resultPromise = dockerManager.execCommand('container123', ['echo', 'multi']);

      // Emit events asynchronously
      await new Promise((resolve) => setImmediate(resolve));

      // Send data in multiple chunks
      const msg1 = 'hel';
      const header1 = Buffer.from([1, 0, 0, 0, 0, 0, 0, msg1.length]);
      mockStream.emit('data', Buffer.concat([header1, Buffer.from(msg1)]));

      const msg2 = 'lo\n';
      const header2 = Buffer.from([1, 0, 0, 0, 0, 0, 0, msg2.length]);
      mockStream.emit('data', Buffer.concat([header2, Buffer.from(msg2)]));

      mockStream.emit('end');

      const result = await resultPromise;

      expect(result.stdout).toBe('hello\n');
    });

    it('should pass execution options to container.exec', async () => {
      const mockStream = new EventEmitter();
      mockExec.start.mockResolvedValue(mockStream);
      mockExec.inspect.mockResolvedValue({ ExitCode: 0 });

      const resultPromise = dockerManager.execCommand('container123', ['whoami'], {
        user: 'root',
        workingDir: '/app',
        env: ['FOO=bar'],
      });

      // Emit events asynchronously
      await new Promise((resolve) => setImmediate(resolve));

      mockStream.emit('end');
      await resultPromise;

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['whoami'],
        AttachStdout: true,
        AttachStderr: true,
        User: 'root',
        WorkingDir: '/app',
        Env: ['FOO=bar'],
      });
    });

    it('should handle stream errors', async () => {
      const mockStream = new EventEmitter();
      mockExec.start.mockResolvedValue(mockStream);

      const resultPromise = dockerManager.execCommand('container123', ['fail']);

      // Emit events asynchronously
      await new Promise((resolve) => setImmediate(resolve));

      const error = new Error('Stream error');
      mockStream.emit('error', error);

      await expect(resultPromise).rejects.toThrow('Stream error');
    });

    it('should handle exec inspect errors', async () => {
      const mockStream = new EventEmitter();
      mockExec.start.mockResolvedValue(mockStream);
      mockExec.inspect.mockRejectedValue(new Error('Inspect failed'));

      const resultPromise = dockerManager.execCommand('container123', ['cmd']);

      // Emit events asynchronously
      await new Promise((resolve) => setImmediate(resolve));

      mockStream.emit('end');

      await expect(resultPromise).rejects.toThrow('Inspect failed');
    });
  });

  describe('createExecSession', () => {
    it('should create an interactive exec session with PTY', async () => {
      const mockStream = new EventEmitter() as any;
      mockStream.write = vi.fn();
      mockExec.start.mockResolvedValue(mockStream);

      const session = await dockerManager.createExecSession('container123');

      expect(session.id).toBe('exec123');
      expect(session.stream).toBe(mockStream);

      // Verify exec was created with PTY settings
      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['bash'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        User: undefined,
        WorkingDir: undefined,
        Env: undefined,
      });

      // Verify exec was started in TTY mode
      expect(mockExec.start).toHaveBeenCalledWith({
        Detach: false,
        Tty: true,
        stdin: true,
      });
    });

    it('should use custom shell', async () => {
      const mockStream = new EventEmitter() as any;
      mockExec.start.mockResolvedValue(mockStream);

      await dockerManager.createExecSession('container123', { shell: 'zsh' });

      expect(mockContainer.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          Cmd: ['zsh'],
        })
      );
    });

    it('should pass session options', async () => {
      const mockStream = new EventEmitter() as any;
      mockExec.start.mockResolvedValue(mockStream);
      mockExec.resize.mockResolvedValue(undefined);

      await dockerManager.createExecSession('container123', {
        shell: 'sh',
        user: 'developer',
        workingDir: '/workspace',
        env: ['TERM=xterm-256color'],
        rows: 24,
        cols: 80,
      });

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['sh'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        User: 'developer',
        WorkingDir: '/workspace',
        Env: ['TERM=xterm-256color'],
      });

      // Should attempt initial resize
      expect(mockExec.resize).toHaveBeenCalledWith({ h: 24, w: 80 });
    });

    it('should handle resize failure gracefully', async () => {
      const mockStream = new EventEmitter() as any;
      mockExec.start.mockResolvedValue(mockStream);
      mockExec.resize.mockRejectedValue(new Error('Not ready'));

      // Should not throw even if resize fails
      const session = await dockerManager.createExecSession('container123', {
        rows: 24,
        cols: 80,
      });

      expect(session.id).toBe('exec123');
    });

    it('should return a duplex stream', async () => {
      const mockStream = new EventEmitter() as any;
      mockStream.write = vi.fn();
      mockStream.read = vi.fn();
      mockExec.start.mockResolvedValue(mockStream);

      const session = await dockerManager.createExecSession('container123');

      // Verify it's a readable/writable stream
      expect(typeof session.stream.write).toBe('function');
      expect(typeof session.stream.on).toBe('function');
    });
  });

  describe('resizeExec', () => {
    it('should resize an exec session', async () => {
      mockExec.resize.mockResolvedValue(undefined);

      await dockerManager.resizeExec('exec123', 30, 120);

      const mockDocker = (dockerManager as any).docker;
      expect(mockDocker.getExec).toHaveBeenCalledWith('exec123');
      expect(mockExec.resize).toHaveBeenCalledWith({ h: 30, w: 120 });
    });

    it('should handle resize errors', async () => {
      mockExec.resize.mockRejectedValue(new Error('Resize failed'));

      await expect(dockerManager.resizeExec('exec123', 24, 80)).rejects.toThrow('Resize failed');
    });

    it('should accept various terminal sizes', async () => {
      mockExec.resize.mockResolvedValue(undefined);

      // Small terminal
      await dockerManager.resizeExec('exec123', 10, 40);
      expect(mockExec.resize).toHaveBeenCalledWith({ h: 10, w: 40 });

      // Large terminal
      await dockerManager.resizeExec('exec123', 60, 200);
      expect(mockExec.resize).toHaveBeenCalledWith({ h: 60, w: 200 });
    });
  });
});
