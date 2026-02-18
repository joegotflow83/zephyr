/**
 * Unit tests for src/services/docker-health.ts
 *
 * DockerHealthMonitor is a main-process service that periodically polls Docker
 * availability and emits events on state transitions. Tests use fake timers to
 * control polling intervals and mocked DockerManager for predictable state changes.
 *
 * Why we test health monitoring: this is critical for UI feedback. The service
 * must reliably detect Docker connection/disconnection and only fire callbacks
 * on actual state changes, not every poll (to avoid event spam).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DockerHealthMonitor } from '../../src/services/docker-health';
import { DockerManager } from '../../src/services/docker-manager';

describe('DockerHealthMonitor', () => {
  let dockerManager: DockerManager;
  let healthMonitor: DockerHealthMonitor;
  let mockIsDockerAvailable: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Use fake timers for deterministic interval testing
    vi.useFakeTimers();

    // Create a mock DockerManager
    dockerManager = {
      isDockerAvailable: vi.fn(),
    } as unknown as DockerManager;

    mockIsDockerAvailable = dockerManager.isDockerAvailable as ReturnType<typeof vi.fn>;

    healthMonitor = new DockerHealthMonitor(dockerManager);
  });

  afterEach(() => {
    healthMonitor.stop();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create a DockerHealthMonitor instance', () => {
      expect(healthMonitor).toBeDefined();
      expect(healthMonitor).toBeInstanceOf(DockerHealthMonitor);
    });

    it('should not be running initially', () => {
      expect(healthMonitor.isRunning()).toBe(false);
    });

    it('should have null as initial status', () => {
      expect(healthMonitor.getLastKnownStatus()).toBeNull();
    });
  });

  describe('start', () => {
    it('should start monitoring with default interval', () => {
      mockIsDockerAvailable.mockResolvedValue(true);

      healthMonitor.start();

      expect(healthMonitor.isRunning()).toBe(true);
    });

    it('should check status immediately on start', async () => {
      mockIsDockerAvailable.mockResolvedValue(true);

      healthMonitor.start();

      // Allow async check to complete (advance minimal time for immediate check)
      await vi.advanceTimersByTimeAsync(0);

      expect(mockIsDockerAvailable).toHaveBeenCalledTimes(1);
    });

    it('should check status at custom interval', async () => {
      mockIsDockerAvailable.mockResolvedValue(true);

      healthMonitor.start(1000); // 1 second interval

      // Initial check
      await vi.advanceTimersByTimeAsync(0);
      expect(mockIsDockerAvailable).toHaveBeenCalledTimes(1);

      // Advance 1 second
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockIsDockerAvailable).toHaveBeenCalledTimes(2);

      // Advance another second
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockIsDockerAvailable).toHaveBeenCalledTimes(3);
    });

    it('should check status at default interval (5s) when not specified', async () => {
      mockIsDockerAvailable.mockResolvedValue(true);

      healthMonitor.start();

      // Initial check
      await vi.advanceTimersByTimeAsync(0);
      expect(mockIsDockerAvailable).toHaveBeenCalledTimes(1);

      // Advance 5 seconds
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockIsDockerAvailable).toHaveBeenCalledTimes(2);

      // Advance another 5 seconds
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockIsDockerAvailable).toHaveBeenCalledTimes(3);
    });

    it('should stop previous monitoring when started again', async () => {
      mockIsDockerAvailable.mockResolvedValue(true);

      healthMonitor.start(1000);
      await vi.advanceTimersByTimeAsync(0);
      const firstCallCount = mockIsDockerAvailable.mock.calls.length;

      // Start again with different interval
      healthMonitor.start(2000);
      await vi.advanceTimersByTimeAsync(0);

      // Should have stopped old interval and started new one
      expect(healthMonitor.isRunning()).toBe(true);

      // Old interval (1s) should not fire anymore
      await vi.advanceTimersByTimeAsync(1000);
      const afterOneSecond = mockIsDockerAvailable.mock.calls.length;

      // New interval (2s) should fire
      await vi.advanceTimersByTimeAsync(1000); // Total 2s
      const afterTwoSeconds = mockIsDockerAvailable.mock.calls.length;

      expect(afterTwoSeconds).toBeGreaterThan(afterOneSecond);
    });
  });

  describe('stop', () => {
    it('should stop monitoring', async () => {
      mockIsDockerAvailable.mockResolvedValue(true);

      healthMonitor.start(1000);
      await vi.advanceTimersByTimeAsync(0);

      healthMonitor.stop();

      expect(healthMonitor.isRunning()).toBe(false);

      // Advance time - no more checks should happen
      const callCountBefore = mockIsDockerAvailable.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockIsDockerAvailable).toHaveBeenCalledTimes(callCountBefore);
    });

    it('should be safe to call stop when not running', () => {
      expect(() => healthMonitor.stop()).not.toThrow();
      expect(healthMonitor.isRunning()).toBe(false);
    });

    it('should be safe to call stop multiple times', () => {
      healthMonitor.start();
      healthMonitor.stop();

      expect(() => healthMonitor.stop()).not.toThrow();
      expect(healthMonitor.isRunning()).toBe(false);
    });
  });

  describe('onStatusChange', () => {
    it('should register a callback', () => {
      const callback = vi.fn();
      healthMonitor.onStatusChange(callback);

      // Callback registration doesn't throw
      expect(callback).not.toHaveBeenCalled();
    });

    it('should call callback on state transition from null to available', async () => {
      const callback = vi.fn();
      mockIsDockerAvailable.mockResolvedValue(true);

      healthMonitor.onStatusChange(callback);
      healthMonitor.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(callback).toHaveBeenCalledWith(true);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should call callback on state transition from null to unavailable', async () => {
      const callback = vi.fn();
      mockIsDockerAvailable.mockResolvedValue(false);

      healthMonitor.onStatusChange(callback);
      healthMonitor.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(callback).toHaveBeenCalledWith(false);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should call callback on transition from available to unavailable', async () => {
      const callback = vi.fn();
      mockIsDockerAvailable.mockResolvedValue(true);

      healthMonitor.onStatusChange(callback);
      healthMonitor.start(1000);

      await vi.advanceTimersByTimeAsync(0);
      expect(callback).toHaveBeenCalledWith(true);
      expect(callback).toHaveBeenCalledTimes(1);

      // Change Docker status to unavailable
      mockIsDockerAvailable.mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(1000);

      expect(callback).toHaveBeenCalledWith(false);
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should call callback on transition from unavailable to available', async () => {
      const callback = vi.fn();
      mockIsDockerAvailable.mockResolvedValue(false);

      healthMonitor.onStatusChange(callback);
      healthMonitor.start(1000);

      await vi.advanceTimersByTimeAsync(0);
      expect(callback).toHaveBeenCalledWith(false);
      expect(callback).toHaveBeenCalledTimes(1);

      // Change Docker status to available
      mockIsDockerAvailable.mockResolvedValue(true);
      await vi.advanceTimersByTimeAsync(1000);

      expect(callback).toHaveBeenCalledWith(true);
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should NOT call callback when status remains the same', async () => {
      const callback = vi.fn();
      mockIsDockerAvailable.mockResolvedValue(true);

      healthMonitor.onStatusChange(callback);
      healthMonitor.start(1000);

      await vi.advanceTimersByTimeAsync(0);
      expect(callback).toHaveBeenCalledTimes(1);

      // Status remains true
      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenCalledTimes(1); // Still 1, not 2

      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenCalledTimes(1); // Still 1, not 3
    });

    it('should call all registered callbacks on state change', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();
      mockIsDockerAvailable.mockResolvedValue(true);

      healthMonitor.onStatusChange(callback1);
      healthMonitor.onStatusChange(callback2);
      healthMonitor.onStatusChange(callback3);
      healthMonitor.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(callback1).toHaveBeenCalledWith(true);
      expect(callback2).toHaveBeenCalledWith(true);
      expect(callback3).toHaveBeenCalledWith(true);
    });

    it('should handle callback errors gracefully', async () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Callback error');
      });
      const normalCallback = vi.fn();
      mockIsDockerAvailable.mockResolvedValue(true);

      // Mock console.error to suppress error output in tests
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      healthMonitor.onStatusChange(errorCallback);
      healthMonitor.onStatusChange(normalCallback);
      healthMonitor.start();

      await vi.advanceTimersByTimeAsync(0);

      // Both callbacks should be called despite error
      expect(errorCallback).toHaveBeenCalledWith(true);
      expect(normalCallback).toHaveBeenCalledWith(true);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('removeCallback', () => {
    it('should remove a registered callback', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      mockIsDockerAvailable.mockResolvedValue(true);

      healthMonitor.onStatusChange(callback1);
      healthMonitor.onStatusChange(callback2);
      healthMonitor.removeCallback(callback1);

      healthMonitor.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith(true);
    });

    it('should be safe to remove non-existent callback', () => {
      const callback = vi.fn();
      expect(() => healthMonitor.removeCallback(callback)).not.toThrow();
    });

    it('should handle removing callback multiple times', () => {
      const callback = vi.fn();
      healthMonitor.onStatusChange(callback);

      expect(() => {
        healthMonitor.removeCallback(callback);
        healthMonitor.removeCallback(callback);
      }).not.toThrow();
    });
  });

  describe('getLastKnownStatus', () => {
    it('should return null before first check', () => {
      expect(healthMonitor.getLastKnownStatus()).toBeNull();
    });

    it('should return true after detecting Docker available', async () => {
      mockIsDockerAvailable.mockResolvedValue(true);

      healthMonitor.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(healthMonitor.getLastKnownStatus()).toBe(true);
    });

    it('should return false after detecting Docker unavailable', async () => {
      mockIsDockerAvailable.mockResolvedValue(false);

      healthMonitor.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(healthMonitor.getLastKnownStatus()).toBe(false);
    });

    it('should update status on transitions', async () => {
      mockIsDockerAvailable.mockResolvedValue(true);

      healthMonitor.start(1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(healthMonitor.getLastKnownStatus()).toBe(true);

      mockIsDockerAvailable.mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(healthMonitor.getLastKnownStatus()).toBe(false);

      mockIsDockerAvailable.mockResolvedValue(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(healthMonitor.getLastKnownStatus()).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should treat check errors as unavailable', async () => {
      const callback = vi.fn();
      mockIsDockerAvailable.mockRejectedValue(new Error('Connection error'));

      // Mock console.error to suppress error output in tests
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      healthMonitor.onStatusChange(callback);
      healthMonitor.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(callback).toHaveBeenCalledWith(false);
      expect(healthMonitor.getLastKnownStatus()).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should fire callbacks on error if transitioning to unavailable', async () => {
      const callback = vi.fn();
      mockIsDockerAvailable.mockResolvedValue(true);

      // Mock console.error to suppress error output in tests
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      healthMonitor.onStatusChange(callback);
      healthMonitor.start(1000);

      await vi.advanceTimersByTimeAsync(0);
      expect(callback).toHaveBeenCalledWith(true);
      expect(callback).toHaveBeenCalledTimes(1);

      // Simulate error on next check
      mockIsDockerAvailable.mockRejectedValue(new Error('Connection lost'));
      await vi.advanceTimersByTimeAsync(1000);

      expect(callback).toHaveBeenCalledWith(false);
      expect(callback).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should not fire callbacks on repeated errors', async () => {
      const callback = vi.fn();
      mockIsDockerAvailable.mockRejectedValue(new Error('Connection error'));

      // Mock console.error to suppress error output in tests
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      healthMonitor.onStatusChange(callback);
      healthMonitor.start(1000);

      await vi.advanceTimersByTimeAsync(0);
      expect(callback).toHaveBeenCalledTimes(1);

      // Error again - status remains false, no callback
      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenCalledTimes(1); // Still 1

      consoleErrorSpy.mockRestore();
    });
  });

  describe('isRunning', () => {
    it('should return false when not started', () => {
      expect(healthMonitor.isRunning()).toBe(false);
    });

    it('should return true when monitoring is active', () => {
      mockIsDockerAvailable.mockResolvedValue(true);
      healthMonitor.start();

      expect(healthMonitor.isRunning()).toBe(true);
    });

    it('should return false after stopping', () => {
      mockIsDockerAvailable.mockResolvedValue(true);
      healthMonitor.start();
      healthMonitor.stop();

      expect(healthMonitor.isRunning()).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('should handle multiple state transitions correctly', async () => {
      const callback = vi.fn();
      healthMonitor.onStatusChange(callback);

      // Start unavailable
      mockIsDockerAvailable.mockResolvedValue(false);
      healthMonitor.start(1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(callback).toHaveBeenNthCalledWith(1, false);

      // Transition to available
      mockIsDockerAvailable.mockResolvedValue(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenNthCalledWith(2, true);

      // Stay available (no callback)
      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenCalledTimes(2);

      // Transition to unavailable
      mockIsDockerAvailable.mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenNthCalledWith(3, false);

      // Stay unavailable (no callback)
      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenCalledTimes(3);
    });

    it('should work correctly after stop and restart', async () => {
      const callback = vi.fn();
      mockIsDockerAvailable.mockResolvedValue(true);

      healthMonitor.onStatusChange(callback);
      healthMonitor.start(1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(callback).toHaveBeenCalledTimes(1);

      healthMonitor.stop();

      // Change status while stopped
      mockIsDockerAvailable.mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(callback).toHaveBeenCalledTimes(1); // No new calls

      // Restart - should detect new status
      healthMonitor.start(1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenNthCalledWith(2, false);
    });
  });
});
