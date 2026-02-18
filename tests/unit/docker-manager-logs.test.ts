/**
 * Unit tests for src/services/docker-manager.ts (log streaming operations)
 *
 * Tests the log streaming functionality including:
 * - Line-by-line callback delivery
 * - Abort functionality to stop streams
 * - Support for 'since' timestamp for resumed streaming
 * - Proper handling of Docker's multiplexed stream format
 *
 * Why separate logs tests: Log streaming is a distinct asynchronous operation
 * that requires different mocking patterns (streams) compared to the request-response
 * patterns used in lifecycle and connection tests.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// vi.hoisted ensures these mocks are available when vi.mock factory runs
const { mockGetContainer, mockContainerLogs } = vi.hoisted(() => ({
  mockGetContainer: vi.fn(),
  mockContainerLogs: vi.fn(),
}));

// Mock dockerode module
vi.mock('dockerode', () => {
  const MockDockerode = vi.fn().mockImplementation(function () {
    return {
      getContainer: mockGetContainer,
    };
  });

  return {
    default: MockDockerode,
  };
});

import { DockerManager } from '../../src/services/docker-manager';

/**
 * Create a mock Docker log stream
 * Docker multiplexes stdout/stderr with an 8-byte header per frame:
 * [STREAM_TYPE, 0, 0, 0, SIZE1, SIZE2, SIZE3, SIZE4, ...PAYLOAD...]
 */
function createMockLogStream() {
  return new EventEmitter() as EventEmitter & NodeJS.ReadableStream & { destroy: () => void };
}

/**
 * Create a Docker multiplexed frame
 * @param streamType - 1 for stdout, 2 for stderr
 * @param payload - The log line payload
 */
function createDockerFrame(streamType: 1 | 2, payload: string): Buffer {
  const payloadBuffer = Buffer.from(payload);
  const header = Buffer.alloc(8);

  // Stream type
  header[0] = streamType;
  // Bytes 1-3 are padding (zeros)
  // Bytes 4-7 are payload size (big-endian uint32)
  header.writeUInt32BE(payloadBuffer.length, 4);

  return Buffer.concat([header, payloadBuffer]);
}

describe('DockerManager - log streaming', () => {
  let dockerManager: DockerManager;
  let mockStream: EventEmitter & { destroy: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    dockerManager = new DockerManager();

    // Create fresh mock stream for each test
    mockStream = createMockLogStream();
    mockStream.destroy = vi.fn();

    // Setup container mock to return our stream
    mockContainerLogs.mockResolvedValue(mockStream);
    mockGetContainer.mockReturnValue({
      logs: mockContainerLogs,
    });
  });

  afterEach(() => {
    // Clean up any lingering event listeners
    mockStream.removeAllListeners();
  });

  describe('streamLogs', () => {
    it('should stream logs line by line', async () => {
      const receivedLines: string[] = [];
      const onLine = vi.fn((line: string) => receivedLines.push(line));

      const abortController = await dockerManager.streamLogs('container-123', onLine);

      // Simulate log data with Docker multiplexed format
      const frame1 = createDockerFrame(1, '2024-01-01T10:00:00.000Z First log line\n');
      const frame2 = createDockerFrame(1, '2024-01-01T10:00:01.000Z Second log line\n');

      mockStream.emit('data', frame1);
      mockStream.emit('data', frame2);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onLine).toHaveBeenCalledTimes(2);
      expect(receivedLines).toEqual([
        '2024-01-01T10:00:00.000Z First log line',
        '2024-01-01T10:00:01.000Z Second log line',
      ]);

      // Cleanup
      abortController.abort();
    });

    it('should handle multiple lines in a single frame', async () => {
      const receivedLines: string[] = [];
      const onLine = vi.fn((line: string) => receivedLines.push(line));

      const abortController = await dockerManager.streamLogs('container-123', onLine);

      // Multiple lines in one frame
      const frame = createDockerFrame(
        1,
        '2024-01-01T10:00:00.000Z Line 1\n2024-01-01T10:00:01.000Z Line 2\n2024-01-01T10:00:02.000Z Line 3\n'
      );

      mockStream.emit('data', frame);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onLine).toHaveBeenCalledTimes(3);
      expect(receivedLines).toEqual([
        '2024-01-01T10:00:00.000Z Line 1',
        '2024-01-01T10:00:01.000Z Line 2',
        '2024-01-01T10:00:02.000Z Line 3',
      ]);

      abortController.abort();
    });

    it('should handle incomplete lines across frames', async () => {
      const receivedLines: string[] = [];
      const onLine = vi.fn((line: string) => receivedLines.push(line));

      const abortController = await dockerManager.streamLogs('container-123', onLine);

      // First frame with partial line (no newline)
      const frame1 = createDockerFrame(1, '2024-01-01T10:00:00.000Z Partial');
      mockStream.emit('data', frame1);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // No callback yet - line is incomplete
      expect(onLine).not.toHaveBeenCalled();

      // Second frame completes the line
      const frame2 = createDockerFrame(1, ' line\n');
      mockStream.emit('data', frame2);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onLine).toHaveBeenCalledTimes(1);
      expect(receivedLines[0]).toBe('2024-01-01T10:00:00.000Z Partial line');

      abortController.abort();
    });

    it('should flush remaining buffer on stream end', async () => {
      const receivedLines: string[] = [];
      const onLine = vi.fn((line: string) => receivedLines.push(line));

      await dockerManager.streamLogs('container-123', onLine);

      // Send a line without newline
      const frame = createDockerFrame(1, '2024-01-01T10:00:00.000Z Last line');
      mockStream.emit('data', frame);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Not called yet
      expect(onLine).not.toHaveBeenCalled();

      // Stream ends - should flush buffer
      mockStream.emit('end');

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onLine).toHaveBeenCalledTimes(1);
      expect(receivedLines[0]).toBe('2024-01-01T10:00:00.000Z Last line');
    });

    it('should stop streaming when aborted', async () => {
      const receivedLines: string[] = [];
      const onLine = vi.fn((line: string) => receivedLines.push(line));

      const abortController = await dockerManager.streamLogs('container-123', onLine);

      // Send first line
      const frame1 = createDockerFrame(1, '2024-01-01T10:00:00.000Z First line\n');
      mockStream.emit('data', frame1);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onLine).toHaveBeenCalledTimes(1);

      // Abort the stream
      abortController.abort();

      // Send more data after abort
      const frame2 = createDockerFrame(1, '2024-01-01T10:00:01.000Z Second line\n');
      mockStream.emit('data', frame2);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should still only have 1 call - no new lines processed
      expect(onLine).toHaveBeenCalledTimes(1);
      expect(receivedLines).toEqual(['2024-01-01T10:00:00.000Z First line']);

      // Verify stream was destroyed
      expect(mockStream.destroy).toHaveBeenCalled();
    });

    it('should handle stderr stream type', async () => {
      const receivedLines: string[] = [];
      const onLine = vi.fn((line: string) => receivedLines.push(line));

      const abortController = await dockerManager.streamLogs('container-123', onLine);

      // Stream type 2 = stderr
      const frame = createDockerFrame(2, '2024-01-01T10:00:00.000Z Error message\n');
      mockStream.emit('data', frame);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onLine).toHaveBeenCalledTimes(1);
      expect(receivedLines[0]).toBe('2024-01-01T10:00:00.000Z Error message');

      abortController.abort();
    });

    it('should pass since timestamp option to Docker API', async () => {
      const onLine = vi.fn();
      const sinceTimestamp = 1704110400; // Unix timestamp

      await dockerManager.streamLogs('container-123', onLine, sinceTimestamp);

      expect(mockContainerLogs).toHaveBeenCalledWith({
        follow: true,
        stdout: true,
        stderr: true,
        timestamps: true,
        since: sinceTimestamp,
      });
    });

    it('should not include since option when not provided', async () => {
      const onLine = vi.fn();

      await dockerManager.streamLogs('container-123', onLine);

      expect(mockContainerLogs).toHaveBeenCalledWith({
        follow: true,
        stdout: true,
        stderr: true,
        timestamps: true,
      });
    });

    it('should handle stream errors gracefully', async () => {
      const receivedLines: string[] = [];
      const onLine = vi.fn((line: string) => receivedLines.push(line));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const abortController = await dockerManager.streamLogs('container-123', onLine);

      // Send a line
      const frame = createDockerFrame(1, '2024-01-01T10:00:00.000Z Line before error\n');
      mockStream.emit('data', frame);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onLine).toHaveBeenCalledTimes(1);

      // Emit error
      const testError = new Error('Stream error');
      mockStream.emit('error', testError);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Error should be logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Log stream error for container container-123:',
        testError
      );

      // Stream should be destroyed
      expect(mockStream.destroy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      abortController.abort();
    });

    it('should skip empty lines', async () => {
      const receivedLines: string[] = [];
      const onLine = vi.fn((line: string) => receivedLines.push(line));

      const abortController = await dockerManager.streamLogs('container-123', onLine);

      // Frame with empty lines
      const frame = createDockerFrame(
        1,
        '2024-01-01T10:00:00.000Z First\n\n\n2024-01-01T10:00:01.000Z Second\n'
      );
      mockStream.emit('data', frame);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Empty lines should be skipped
      expect(onLine).toHaveBeenCalledTimes(2);
      expect(receivedLines).toEqual([
        '2024-01-01T10:00:00.000Z First',
        '2024-01-01T10:00:01.000Z Second',
      ]);

      abortController.abort();
    });

    it('should handle multiple Docker frames in single data event', async () => {
      const receivedLines: string[] = [];
      const onLine = vi.fn((line: string) => receivedLines.push(line));

      const abortController = await dockerManager.streamLogs('container-123', onLine);

      // Multiple frames concatenated
      const frame1 = createDockerFrame(1, '2024-01-01T10:00:00.000Z Line 1\n');
      const frame2 = createDockerFrame(1, '2024-01-01T10:00:01.000Z Line 2\n');
      const combinedFrames = Buffer.concat([frame1, frame2]);

      mockStream.emit('data', combinedFrames);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onLine).toHaveBeenCalledTimes(2);
      expect(receivedLines).toEqual([
        '2024-01-01T10:00:00.000Z Line 1',
        '2024-01-01T10:00:01.000Z Line 2',
      ]);

      abortController.abort();
    });
  });
});
