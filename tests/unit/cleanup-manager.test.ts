import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock') },
}));

vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info', resolvePathFn: vi.fn(), maxSize: 0, format: '' }, console: { level: 'info', format: '' } },
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), verbose: vi.fn(), debug: vi.fn(), silly: vi.fn(),
  },
}));

import { CleanupManager } from '../../src/services/cleanup-manager';
import type { ContainerRuntime } from '../../src/services/container-runtime';

describe('CleanupManager', () => {
  let cleanupManager: CleanupManager;
  let mockRuntime: Pick<ContainerRuntime, 'stopContainer' | 'removeContainer'>;

  beforeEach(() => {
    mockRuntime = {
      stopContainer: vi.fn(),
      removeContainer: vi.fn(),
    } as unknown as Pick<ContainerRuntime, 'stopContainer' | 'removeContainer'>;

    cleanupManager = new CleanupManager(mockRuntime as ContainerRuntime);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('registerContainer', () => {
    it('should register a valid container ID', () => {
      cleanupManager.registerContainer('container-123');
      expect(cleanupManager.getTrackedContainers()).toEqual(['container-123']);
    });

    it('should register multiple container IDs', () => {
      cleanupManager.registerContainer('container-1');
      cleanupManager.registerContainer('container-2');
      cleanupManager.registerContainer('container-3');

      const tracked = cleanupManager.getTrackedContainers();
      expect(tracked).toHaveLength(3);
      expect(tracked).toContain('container-1');
      expect(tracked).toContain('container-2');
      expect(tracked).toContain('container-3');
    });

    it('should not register duplicate container IDs', () => {
      cleanupManager.registerContainer('container-123');
      cleanupManager.registerContainer('container-123');
      cleanupManager.registerContainer('container-123');

      expect(cleanupManager.getTrackedContainers()).toEqual(['container-123']);
    });

    it('should handle empty string gracefully', () => {
      cleanupManager.registerContainer('');
      expect(cleanupManager.getTrackedContainers()).toEqual([]);
    });

    it('should handle invalid input gracefully', () => {
      cleanupManager.registerContainer(null as unknown as string);
      cleanupManager.registerContainer(undefined as unknown as string);
      cleanupManager.registerContainer(123 as unknown as string);

      expect(cleanupManager.getTrackedContainers()).toEqual([]);
    });
  });

  describe('unregisterContainer', () => {
    beforeEach(() => {
      cleanupManager.registerContainer('container-1');
      cleanupManager.registerContainer('container-2');
      cleanupManager.registerContainer('container-3');
    });

    it('should unregister an existing container ID', () => {
      cleanupManager.unregisterContainer('container-2');

      const tracked = cleanupManager.getTrackedContainers();
      expect(tracked).toHaveLength(2);
      expect(tracked).toContain('container-1');
      expect(tracked).toContain('container-3');
      expect(tracked).not.toContain('container-2');
    });

    it('should handle unregistering non-existent container ID', () => {
      cleanupManager.unregisterContainer('container-999');

      const tracked = cleanupManager.getTrackedContainers();
      expect(tracked).toHaveLength(3);
    });

    it('should handle unregistering the same container multiple times', () => {
      cleanupManager.unregisterContainer('container-1');
      cleanupManager.unregisterContainer('container-1');
      cleanupManager.unregisterContainer('container-1');

      const tracked = cleanupManager.getTrackedContainers();
      expect(tracked).toHaveLength(2);
      expect(tracked).not.toContain('container-1');
    });

    it('should handle empty string gracefully', () => {
      cleanupManager.unregisterContainer('');
      expect(cleanupManager.getTrackedContainers()).toHaveLength(3);
    });

    it('should handle invalid input gracefully', () => {
      cleanupManager.unregisterContainer(null as unknown as string);
      cleanupManager.unregisterContainer(undefined as unknown as string);
      cleanupManager.unregisterContainer(123 as unknown as string);

      expect(cleanupManager.getTrackedContainers()).toHaveLength(3);
    });
  });

  describe('getTrackedContainers', () => {
    it('should return empty array when no containers registered', () => {
      expect(cleanupManager.getTrackedContainers()).toEqual([]);
    });

    it('should return array of registered container IDs', () => {
      cleanupManager.registerContainer('container-1');
      cleanupManager.registerContainer('container-2');

      const tracked = cleanupManager.getTrackedContainers();
      expect(tracked).toHaveLength(2);
      expect(tracked).toContain('container-1');
      expect(tracked).toContain('container-2');
    });

    it('should return a new array instance (not modify internal state)', () => {
      cleanupManager.registerContainer('container-1');

      const tracked1 = cleanupManager.getTrackedContainers();
      tracked1.push('container-2'); // Modify returned array

      const tracked2 = cleanupManager.getTrackedContainers();
      expect(tracked2).toEqual(['container-1']); // Internal state unchanged
    });
  });

  describe('cleanupAll', () => {
    it('should not throw when no containers are registered', async () => {
      await expect(cleanupManager.cleanupAll()).resolves.toBeUndefined();
      expect(mockRuntime.stopContainer).not.toHaveBeenCalled();
      expect(mockRuntime.removeContainer).not.toHaveBeenCalled();
    });

    it('should stop and remove a single tracked container', async () => {
      cleanupManager.registerContainer('container-123');

      await cleanupManager.cleanupAll();

      expect(mockRuntime.stopContainer).toHaveBeenCalledWith('container-123');
      expect(mockRuntime.removeContainer).toHaveBeenCalledWith('container-123');
      expect(cleanupManager.getTrackedContainers()).toEqual([]);
    });

    it('should stop and remove multiple tracked containers', async () => {
      cleanupManager.registerContainer('container-1');
      cleanupManager.registerContainer('container-2');
      cleanupManager.registerContainer('container-3');

      await cleanupManager.cleanupAll();

      expect(mockRuntime.stopContainer).toHaveBeenCalledTimes(3);
      expect(mockRuntime.removeContainer).toHaveBeenCalledTimes(3);
      expect(mockRuntime.stopContainer).toHaveBeenCalledWith('container-1');
      expect(mockRuntime.stopContainer).toHaveBeenCalledWith('container-2');
      expect(mockRuntime.stopContainer).toHaveBeenCalledWith('container-3');
      expect(cleanupManager.getTrackedContainers()).toEqual([]);
    });

    it('should unregister containers after successful cleanup', async () => {
      cleanupManager.registerContainer('container-1');
      cleanupManager.registerContainer('container-2');

      await cleanupManager.cleanupAll();

      expect(cleanupManager.getTrackedContainers()).toEqual([]);
    });

    it('should continue cleanup even if stop fails', async () => {
      vi.mocked(mockRuntime.stopContainer).mockRejectedValueOnce(
        new Error('Stop failed')
      );

      cleanupManager.registerContainer('container-1');
      cleanupManager.registerContainer('container-2');

      await cleanupManager.cleanupAll();

      // Should still attempt to stop both containers
      expect(mockRuntime.stopContainer).toHaveBeenCalledTimes(2);
    });

    it('should continue cleanup even if remove fails', async () => {
      vi.mocked(mockRuntime.removeContainer).mockRejectedValueOnce(
        new Error('Remove failed')
      );

      cleanupManager.registerContainer('container-1');
      cleanupManager.registerContainer('container-2');

      await cleanupManager.cleanupAll();

      // Should still attempt to remove both containers
      expect(mockRuntime.removeContainer).toHaveBeenCalledTimes(2);
    });

    it('should handle multiple failures and continue cleanup', async () => {
      vi.mocked(mockRuntime.stopContainer)
        .mockRejectedValueOnce(new Error('Stop failed 1'))
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Stop failed 3'));

      vi.mocked(mockRuntime.removeContainer)
        .mockRejectedValueOnce(new Error('Remove failed 2'))
        .mockResolvedValueOnce(undefined);

      cleanupManager.registerContainer('container-1');
      cleanupManager.registerContainer('container-2');
      cleanupManager.registerContainer('container-3');

      await cleanupManager.cleanupAll();

      // All stop attempts should be made despite failures
      expect(mockRuntime.stopContainer).toHaveBeenCalledTimes(3);
      // Only container-2 reaches remove (container-1 and container-3 failed at stop)
      expect(mockRuntime.removeContainer).toHaveBeenCalledTimes(1);
      expect(mockRuntime.removeContainer).toHaveBeenCalledWith('container-2');
    });

    it('should complete successfully and not throw errors', async () => {
      vi.mocked(mockRuntime.stopContainer).mockRejectedValue(
        new Error('All stops fail')
      );
      vi.mocked(mockRuntime.removeContainer).mockRejectedValue(
        new Error('All removes fail')
      );

      cleanupManager.registerContainer('container-1');
      cleanupManager.registerContainer('container-2');

      // Should not throw even if all operations fail
      await expect(cleanupManager.cleanupAll()).resolves.toBeUndefined();
    });

    it('should call stop before remove for each container', async () => {
      const callOrder: string[] = [];

      vi.mocked(mockRuntime.stopContainer).mockImplementation(async (id) => {
        callOrder.push(`stop-${id}`);
      });

      vi.mocked(mockRuntime.removeContainer).mockImplementation(async (id) => {
        callOrder.push(`remove-${id}`);
      });

      cleanupManager.registerContainer('container-1');

      await cleanupManager.cleanupAll();

      expect(callOrder).toEqual(['stop-container-1', 'remove-container-1']);
    });

    it('should process containers in parallel (Promise.allSettled)', async () => {
      let activeOperations = 0;
      let maxConcurrent = 0;

      vi.mocked(mockRuntime.stopContainer).mockImplementation(async () => {
        activeOperations++;
        maxConcurrent = Math.max(maxConcurrent, activeOperations);
        await new Promise(resolve => setTimeout(resolve, 10));
        activeOperations--;
      });

      vi.mocked(mockRuntime.removeContainer).mockResolvedValue(undefined);

      cleanupManager.registerContainer('container-1');
      cleanupManager.registerContainer('container-2');
      cleanupManager.registerContainer('container-3');

      await cleanupManager.cleanupAll();

      // Expect at least 2 operations to run concurrently (not strictly sequential)
      expect(maxConcurrent).toBeGreaterThanOrEqual(2);
    });
  });

  describe('integration scenarios', () => {
    it('should handle typical lifecycle: register -> unregister some -> cleanup rest', async () => {
      // Register 5 containers
      cleanupManager.registerContainer('container-1');
      cleanupManager.registerContainer('container-2');
      cleanupManager.registerContainer('container-3');
      cleanupManager.registerContainer('container-4');
      cleanupManager.registerContainer('container-5');

      expect(cleanupManager.getTrackedContainers()).toHaveLength(5);

      // Unregister 2 that completed normally
      cleanupManager.unregisterContainer('container-2');
      cleanupManager.unregisterContainer('container-4');

      expect(cleanupManager.getTrackedContainers()).toHaveLength(3);

      // Cleanup remaining 3
      await cleanupManager.cleanupAll();

      expect(mockRuntime.stopContainer).toHaveBeenCalledTimes(3);
      expect(mockRuntime.removeContainer).toHaveBeenCalledTimes(3);
      expect(cleanupManager.getTrackedContainers()).toHaveLength(0);
    });

    it('should support multiple cleanup cycles', async () => {
      // First cycle
      cleanupManager.registerContainer('container-1');
      cleanupManager.registerContainer('container-2');
      await cleanupManager.cleanupAll();

      expect(cleanupManager.getTrackedContainers()).toHaveLength(0);

      // Second cycle
      cleanupManager.registerContainer('container-3');
      cleanupManager.registerContainer('container-4');
      await cleanupManager.cleanupAll();

      expect(cleanupManager.getTrackedContainers()).toHaveLength(0);
      expect(mockRuntime.stopContainer).toHaveBeenCalledTimes(4);
      expect(mockRuntime.removeContainer).toHaveBeenCalledTimes(4);
    });
  });
});
