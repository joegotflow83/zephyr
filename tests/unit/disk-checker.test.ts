/**
 * Tests for DiskChecker service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { DiskChecker } from '../../src/services/disk-checker';
import checkDiskSpace from 'check-disk-space';

// Mock modules
vi.mock('check-disk-space');
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn(),
}));

// Import mocked fs after mocking
const fs = await import('fs');

const mockCheckDiskSpace = vi.mocked(checkDiskSpace);

describe('DiskChecker', () => {
  let diskChecker: DiskChecker;

  beforeEach(() => {
    diskChecker = new DiskChecker();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAvailableSpace', () => {
    it('should return disk space information for valid path', async () => {
      const testPath = '/test/path';
      const mockDiskSpace = {
        diskPath: testPath,
        free: 10 * 1024 * 1024 * 1024, // 10 GB
        size: 100 * 1024 * 1024 * 1024, // 100 GB
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockCheckDiskSpace.mockResolvedValue(mockDiskSpace);

      const result = await diskChecker.getAvailableSpace(testPath);

      expect(result).toEqual({
        free: 10 * 1024 * 1024 * 1024,
        size: 100 * 1024 * 1024 * 1024,
        used: 90 * 1024 * 1024 * 1024,
      });
      expect(mockCheckDiskSpace).toHaveBeenCalledWith(path.resolve(testPath));
    });

    it('should throw error if path does not exist', async () => {
      const testPath = '/nonexistent/path';

      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(diskChecker.getAvailableSpace(testPath)).rejects.toThrow(
        'Path does not exist'
      );
    });

    it('should handle check-disk-space errors', async () => {
      const testPath = '/test/path';

      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockCheckDiskSpace.mockRejectedValue(new Error('Permission denied'));

      await expect(diskChecker.getAvailableSpace(testPath)).rejects.toThrow(
        'Failed to check disk space'
      );
    });

    it('should resolve relative paths to absolute', async () => {
      const testPath = './relative/path';
      const mockDiskSpace = {
        diskPath: testPath,
        free: 5 * 1024 * 1024 * 1024,
        size: 50 * 1024 * 1024 * 1024,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockCheckDiskSpace.mockResolvedValue(mockDiskSpace);

      const result = await diskChecker.getAvailableSpace(testPath);

      expect(result.free).toBe(5 * 1024 * 1024 * 1024);
      expect(fs.existsSync).toHaveBeenCalled();
    });
  });

  describe('checkRepoSize', () => {
    it('should calculate size of directory with files', async () => {
      const repoPath = '/test/repo';

      // Mock directory structure
      vi.mocked(fs.existsSync).mockReturnValue(true);

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'file1.txt', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
        { name: 'file2.txt', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
      ] as any);

      // Mock file sizes
      let callCount = 0;
      vi.mocked(fs.statSync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call for repoPath itself
          return {
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
            size: 0,
          } as any;
        }
        // Subsequent calls for files
        return {
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
          size: 1024, // 1KB each
        } as any;
      });

      const size = await diskChecker.checkRepoSize(repoPath);

      expect(size).toBe(2048); // 2KB total
    });

    it('should calculate size recursively for nested directories', async () => {
      const repoPath = '/test/repo';

      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Track call depth for directory structure
      let readdirCallCount = 0;

      vi.mocked(fs.readdirSync).mockImplementation(() => {
        readdirCallCount++;
        if (readdirCallCount === 1) {
          // Root directory
          return [
            { name: 'subdir', isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
            { name: 'file1.txt', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
          ] as any;
        } else {
          // Subdirectory
          return [
            { name: 'file2.txt', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
          ] as any;
        }
      });

      let statCallCount = 0;
      vi.mocked(fs.statSync).mockImplementation(() => {
        statCallCount++;
        if (statCallCount === 1) {
          // First call for repoPath itself
          return {
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
            size: 0,
          } as any;
        }
        // All other calls are for files
        return {
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
          size: 512, // 512 bytes each
        } as any;
      });

      const size = await diskChecker.checkRepoSize(repoPath);

      expect(size).toBe(1024); // 2 files × 512 bytes
    });

    it('should throw error if repo path does not exist', async () => {
      const repoPath = '/nonexistent/repo';

      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(diskChecker.checkRepoSize(repoPath)).rejects.toThrow(
        'Repository path does not exist'
      );
    });

    it('should throw error if path is not a directory', async () => {
      const repoPath = '/test/file.txt';

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
        size: 1024,
      } as any);

      await expect(diskChecker.checkRepoSize(repoPath)).rejects.toThrow(
        'Path is not a directory'
      );
    });

    it('should handle permission errors gracefully', async () => {
      const repoPath = '/test/repo';

      vi.mocked(fs.existsSync).mockReturnValue(true);

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'accessible', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
        { name: 'restricted', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
      ] as any);

      let statCallCount = 0;
      vi.mocked(fs.statSync).mockImplementation((filePath) => {
        statCallCount++;
        if (statCallCount === 1) {
          // First call for repoPath itself
          return {
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
            size: 0,
          } as any;
        }
        if (String(filePath).includes('restricted')) {
          throw new Error('Permission denied');
        }
        return {
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
          size: 1024,
        } as any;
      });

      const size = await diskChecker.checkRepoSize(repoPath);

      // Should only count the accessible file
      expect(size).toBe(1024);
    });

    it('should handle empty directories', async () => {
      const repoPath = '/test/empty';

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
        size: 0,
      } as any);

      vi.mocked(fs.readdirSync).mockReturnValue([]);

      const size = await diskChecker.checkRepoSize(repoPath);

      expect(size).toBe(0);
    });
  });

  describe('warnIfLow', () => {
    it('should return null if disk space is above threshold', async () => {
      const testPath = '/test/path';
      const mockDiskSpace = {
        diskPath: testPath,
        free: 5 * 1024 * 1024 * 1024, // 5 GB
        size: 100 * 1024 * 1024 * 1024, // 100 GB
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockCheckDiskSpace.mockResolvedValue(mockDiskSpace);

      const result = await diskChecker.warnIfLow(
        testPath,
        1024 * 1024 * 1024 // 1 GB threshold
      );

      expect(result).toBeNull();
    });

    it('should return warning if disk space is below threshold', async () => {
      const testPath = '/test/path';
      const mockDiskSpace = {
        diskPath: testPath,
        free: 500 * 1024 * 1024, // 500 MB
        size: 100 * 1024 * 1024 * 1024, // 100 GB
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockCheckDiskSpace.mockResolvedValue(mockDiskSpace);

      const result = await diskChecker.warnIfLow(
        testPath,
        1024 * 1024 * 1024 // 1 GB threshold
      );

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        path: testPath,
        available: 500 * 1024 * 1024,
        threshold: 1024 * 1024 * 1024,
      });
      expect(result?.message).toContain('Low disk space warning');
      expect(result?.message).toContain('500 MB');
    });

    it('should use default threshold if not provided', async () => {
      const testPath = '/test/path';
      const mockDiskSpace = {
        diskPath: testPath,
        free: 500 * 1024 * 1024, // 500 MB
        size: 100 * 1024 * 1024 * 1024, // 100 GB
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockCheckDiskSpace.mockResolvedValue(mockDiskSpace);

      const result = await diskChecker.warnIfLow(testPath);

      expect(result).not.toBeNull();
      expect(result?.threshold).toBe(1024 * 1024 * 1024); // 1 GB default
    });

    it('should handle edge case where free space equals threshold', async () => {
      const testPath = '/test/path';
      const threshold = 1024 * 1024 * 1024; // 1 GB
      const mockDiskSpace = {
        diskPath: testPath,
        free: threshold, // Exactly at threshold
        size: 100 * 1024 * 1024 * 1024,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockCheckDiskSpace.mockResolvedValue(mockDiskSpace);

      const result = await diskChecker.warnIfLow(testPath, threshold);

      // At threshold should NOT trigger warning
      expect(result).toBeNull();
    });

    it('should handle edge case where free space is just below threshold', async () => {
      const testPath = '/test/path';
      const threshold = 1024 * 1024 * 1024; // 1 GB
      const mockDiskSpace = {
        diskPath: testPath,
        free: threshold - 1, // 1 byte below threshold
        size: 100 * 1024 * 1024 * 1024,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockCheckDiskSpace.mockResolvedValue(mockDiskSpace);

      const result = await diskChecker.warnIfLow(testPath, threshold);

      // Below threshold should trigger warning
      expect(result).not.toBeNull();
      expect(result?.available).toBe(threshold - 1);
    });

    it('should throw error if path does not exist', async () => {
      const testPath = '/nonexistent/path';

      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(diskChecker.warnIfLow(testPath)).rejects.toThrow(
        'Failed to check disk space warning'
      );
    });

    it('should format message with correct MB values', async () => {
      const testPath = '/test/path';
      const mockDiskSpace = {
        diskPath: testPath,
        free: 250 * 1024 * 1024, // 250 MB
        size: 100 * 1024 * 1024 * 1024,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockCheckDiskSpace.mockResolvedValue(mockDiskSpace);

      const result = await diskChecker.warnIfLow(
        testPath,
        500 * 1024 * 1024 // 500 MB threshold
      );

      expect(result?.message).toContain('250 MB available');
      expect(result?.message).toContain('threshold: 500 MB');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle symbolic links in checkRepoSize', async () => {
      const repoPath = '/test/repo';

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
        size: 0,
      } as any).mockReturnValue({
        isDirectory: () => false,
        isFile: () => false,
        isSymbolicLink: () => true,
        size: 2048,
      } as any);

      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'symlink', isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true },
      ] as any);

      const size = await diskChecker.checkRepoSize(repoPath);

      expect(size).toBe(2048); // Should count symlink size
    });

    it('should handle directory read errors gracefully', async () => {
      const repoPath = '/test/repo';

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
        size: 0,
      } as any);

      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const size = await diskChecker.checkRepoSize(repoPath);

      // Should return 0 when directory can't be read
      expect(size).toBe(0);
    });
  });
});
