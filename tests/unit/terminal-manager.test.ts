import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalManager } from '../../src/services/terminal-manager';
import { DockerManager } from '../../src/services/docker-manager';
import { EventEmitter } from 'events';

// Mock stream class
class MockStream extends EventEmitter {
  write = vi.fn();
  end = vi.fn(() => {
    this.emit('end');
  });
}

describe('TerminalManager', () => {
  let terminalManager: TerminalManager;
  let mockDockerManager: DockerManager;
  let mockWebContents: any;
  let mockStream: MockStream;

  beforeEach(() => {
    // Create mock stream
    mockStream = new MockStream();

    // Create mock DockerManager
    mockDockerManager = {
      createExecSession: vi.fn(),
      resizeExec: vi.fn(),
    } as any;

    // Create mock WebContents
    mockWebContents = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };

    // Create TerminalManager instance
    terminalManager = new TerminalManager(mockDockerManager, mockWebContents);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('openSession', () => {
    it('should open a terminal session successfully', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });

      const session = await terminalManager.openSession('container-123');

      expect(session).toMatchObject({
        containerId: 'container-123',
        user: undefined,
      });
      expect(session.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(mockDockerManager.createExecSession).toHaveBeenCalledWith('container-123', {});
    });

    it('should pass options to Docker exec', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });

      await terminalManager.openSession('container-123', {
        shell: 'zsh',
        user: 'root',
        workingDir: '/app',
        env: ['FOO=bar'],
        rows: 24,
        cols: 80,
      });

      expect(mockDockerManager.createExecSession).toHaveBeenCalledWith('container-123', {
        shell: 'zsh',
        user: 'root',
        workingDir: '/app',
        env: ['FOO=bar'],
        rows: 24,
        cols: 80,
      });
    });

    it('should store user in session metadata', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });

      const session = await terminalManager.openSession('container-123', { user: 'admin' });

      expect(session.user).toBe('admin');
    });

    it('should forward stdout data to renderer via IPC', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });

      const session = await terminalManager.openSession('container-123');

      // Simulate stream data
      mockStream.emit('data', Buffer.from('hello\n'));

      expect(mockWebContents.send).toHaveBeenCalledWith('terminal:data', session.id, 'hello\n');
    });

    it('should not send data if webContents is destroyed', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });
      mockWebContents.isDestroyed.mockReturnValue(true);

      await terminalManager.openSession('container-123');

      // Simulate stream data
      mockStream.emit('data', Buffer.from('hello\n'));

      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    it('should send terminal:closed event when stream ends', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });

      const session = await terminalManager.openSession('container-123');

      // Simulate stream end
      mockStream.emit('end');

      expect(mockWebContents.send).toHaveBeenCalledWith('terminal:closed', session.id);
    });

    it('should send terminal:error event on stream error', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });

      const session = await terminalManager.openSession('container-123');

      // Simulate stream error
      const error = new Error('Connection lost');
      mockStream.emit('error', error);

      expect(mockWebContents.send).toHaveBeenCalledWith('terminal:error', session.id, 'Connection lost');
    });

    it('should remove session from map on stream end', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });

      const session = await terminalManager.openSession('container-123');
      expect(terminalManager.listSessions()).toHaveLength(1);

      // Simulate stream end
      mockStream.emit('end');

      expect(terminalManager.listSessions()).toHaveLength(0);
    });

    it('should throw error if createExecSession fails', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockRejectedValue(new Error('Container not found'));

      await expect(terminalManager.openSession('invalid-container')).rejects.toThrow('Container not found');
    });
  });

  describe('closeSession', () => {
    it('should close an open session', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });

      const session = await terminalManager.openSession('container-123');
      expect(terminalManager.listSessions()).toHaveLength(1);

      await terminalManager.closeSession(session.id);

      expect(mockStream.end).toHaveBeenCalled();
      expect(terminalManager.listSessions()).toHaveLength(0);
    });

    it('should throw error if session not found', async () => {
      await expect(terminalManager.closeSession('nonexistent')).rejects.toThrow('Session nonexistent not found');
    });

    it('should remove session even if end() throws', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });

      const session = await terminalManager.openSession('container-123');

      // Mock end to throw
      mockStream.end.mockImplementation(() => {
        throw new Error('Stream error');
      });

      // Should still remove from sessions map
      await expect(terminalManager.closeSession(session.id)).rejects.toThrow('Stream error');
      expect(terminalManager.listSessions()).toHaveLength(0);
    });
  });

  describe('writeToSession', () => {
    it('should write data to session stream', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });

      const session = await terminalManager.openSession('container-123');
      terminalManager.writeToSession(session.id, 'ls -la\n');

      expect(mockStream.write).toHaveBeenCalledWith('ls -la\n');
    });

    it('should throw error if session not found', () => {
      expect(() => terminalManager.writeToSession('nonexistent', 'data')).toThrow(
        'Session nonexistent not found'
      );
    });

    it('should write multiple times to same session', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });

      const session = await terminalManager.openSession('container-123');
      terminalManager.writeToSession(session.id, 'echo ');
      terminalManager.writeToSession(session.id, 'hello\n');

      expect(mockStream.write).toHaveBeenCalledTimes(2);
      expect(mockStream.write).toHaveBeenNthCalledWith(1, 'echo ');
      expect(mockStream.write).toHaveBeenNthCalledWith(2, 'hello\n');
    });
  });

  describe('resizeSession', () => {
    it('should resize session PTY', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });
      vi.mocked(mockDockerManager.resizeExec).mockResolvedValue();

      const session = await terminalManager.openSession('container-123');
      await terminalManager.resizeSession(session.id, 120, 40);

      expect(mockDockerManager.resizeExec).toHaveBeenCalledWith('exec-123', 40, 120);
    });

    it('should throw error if session not found', async () => {
      await expect(terminalManager.resizeSession('nonexistent', 80, 24)).rejects.toThrow(
        'Session nonexistent not found'
      );
    });

    it('should propagate resize errors', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });
      vi.mocked(mockDockerManager.resizeExec).mockRejectedValue(new Error('Resize failed'));

      const session = await terminalManager.openSession('container-123');

      await expect(terminalManager.resizeSession(session.id, 80, 24)).rejects.toThrow('Resize failed');
    });
  });

  describe('listSessions', () => {
    it('should return empty array when no sessions', () => {
      expect(terminalManager.listSessions()).toEqual([]);
    });

    it('should return all active sessions', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });

      const session1 = await terminalManager.openSession('container-1');
      const session2 = await terminalManager.openSession('container-2');

      const sessions = terminalManager.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.id)).toContain(session1.id);
      expect(sessions.map((s) => s.id)).toContain(session2.id);
    });

    it('should not include closed sessions', async () => {
      const stream1 = new MockStream();
      const stream2 = new MockStream();

      vi.mocked(mockDockerManager.createExecSession)
        .mockResolvedValueOnce({ id: 'exec-1', stream: stream1 as any })
        .mockResolvedValueOnce({ id: 'exec-2', stream: stream2 as any });

      const session1 = await terminalManager.openSession('container-1');
      const session2 = await terminalManager.openSession('container-2');

      await terminalManager.closeSession(session1.id);

      const sessions = terminalManager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(session2.id);
    });
  });

  describe('getSession', () => {
    it('should return session metadata by ID', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });

      const session = await terminalManager.openSession('container-123', { user: 'root' });
      const retrieved = terminalManager.getSession(session.id);

      expect(retrieved).toEqual(session);
      expect(retrieved?.user).toBe('root');
    });

    it('should return undefined for nonexistent session', () => {
      expect(terminalManager.getSession('nonexistent')).toBeUndefined();
    });
  });

  describe('closeAllSessions', () => {
    it('should close all active sessions', async () => {
      const stream1 = new MockStream();
      const stream2 = new MockStream();
      const stream3 = new MockStream();

      vi.mocked(mockDockerManager.createExecSession)
        .mockResolvedValueOnce({ id: 'exec-1', stream: stream1 as any })
        .mockResolvedValueOnce({ id: 'exec-2', stream: stream2 as any })
        .mockResolvedValueOnce({ id: 'exec-3', stream: stream3 as any });

      await terminalManager.openSession('container-1');
      await terminalManager.openSession('container-2');
      await terminalManager.openSession('container-3');

      expect(terminalManager.listSessions()).toHaveLength(3);

      await terminalManager.closeAllSessions();

      expect(terminalManager.listSessions()).toHaveLength(0);
    });

    it('should work when no sessions are open', async () => {
      await expect(terminalManager.closeAllSessions()).resolves.not.toThrow();
    });
  });

  describe('setWebContents', () => {
    it('should update webContents reference', async () => {
      const newWebContents = {
        send: vi.fn(),
        isDestroyed: vi.fn(() => false),
      };

      terminalManager.setWebContents(newWebContents as any);

      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });

      const session = await terminalManager.openSession('container-123');
      mockStream.emit('data', Buffer.from('test\n'));

      expect(newWebContents.send).toHaveBeenCalledWith('terminal:data', session.id, 'test\n');
      expect(mockWebContents.send).not.toHaveBeenCalled();
    });
  });

  describe('session lifecycle', () => {
    it('should handle full lifecycle: open -> write -> resize -> close', async () => {
      vi.mocked(mockDockerManager.createExecSession).mockResolvedValue({
        id: 'exec-123',
        stream: mockStream as any,
      });
      vi.mocked(mockDockerManager.resizeExec).mockResolvedValue();

      // Open session
      const session = await terminalManager.openSession('container-123', {
        user: 'root',
        rows: 24,
        cols: 80,
      });

      expect(terminalManager.listSessions()).toHaveLength(1);

      // Write data
      terminalManager.writeToSession(session.id, 'pwd\n');
      expect(mockStream.write).toHaveBeenCalledWith('pwd\n');

      // Receive data
      mockStream.emit('data', Buffer.from('/app\n'));
      expect(mockWebContents.send).toHaveBeenCalledWith('terminal:data', session.id, '/app\n');

      // Resize
      await terminalManager.resizeSession(session.id, 120, 40);
      expect(mockDockerManager.resizeExec).toHaveBeenCalledWith('exec-123', 40, 120);

      // Close
      await terminalManager.closeSession(session.id);
      expect(terminalManager.listSessions()).toHaveLength(0);
    });

    it('should handle concurrent sessions independently', async () => {
      const stream1 = new MockStream();
      const stream2 = new MockStream();

      vi.mocked(mockDockerManager.createExecSession)
        .mockResolvedValueOnce({ id: 'exec-1', stream: stream1 as any })
        .mockResolvedValueOnce({ id: 'exec-2', stream: stream2 as any });

      const session1 = await terminalManager.openSession('container-1');
      const session2 = await terminalManager.openSession('container-2');

      // Write to different sessions
      terminalManager.writeToSession(session1.id, 'session1\n');
      terminalManager.writeToSession(session2.id, 'session2\n');

      expect(stream1.write).toHaveBeenCalledWith('session1\n');
      expect(stream2.write).toHaveBeenCalledWith('session2\n');

      // Data from different streams
      stream1.emit('data', Buffer.from('output1\n'));
      stream2.emit('data', Buffer.from('output2\n'));

      expect(mockWebContents.send).toHaveBeenCalledWith('terminal:data', session1.id, 'output1\n');
      expect(mockWebContents.send).toHaveBeenCalledWith('terminal:data', session2.id, 'output2\n');

      // Close one session
      await terminalManager.closeSession(session1.id);
      expect(terminalManager.listSessions()).toHaveLength(1);

      // Other session still works
      terminalManager.writeToSession(session2.id, 'still working\n');
      expect(stream2.write).toHaveBeenCalledWith('still working\n');
    });
  });
});
