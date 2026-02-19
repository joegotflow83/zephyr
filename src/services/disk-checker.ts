/**
 * DiskChecker service
 * Checks disk space availability and warns when low
 */

import checkDiskSpace from 'check-disk-space';
import * as fs from 'fs';
import * as path from 'path';

export interface DiskSpaceInfo {
  free: number;
  size: number;
  used: number;
}

export interface DiskWarning {
  path: string;
  available: number;
  threshold: number;
  message: string;
}

export class DiskChecker {
  // Default threshold: 1GB in bytes
  private static readonly DEFAULT_THRESHOLD = 1024 * 1024 * 1024;

  /**
   * Get available disk space for a given path
   * @param dirPath Path to check (must exist)
   * @returns Disk space information in bytes
   */
  async getAvailableSpace(dirPath: string): Promise<DiskSpaceInfo> {
    try {
      // Resolve to absolute path
      const absPath = path.resolve(dirPath);

      // Check if path exists
      if (!fs.existsSync(absPath)) {
        throw new Error(`Path does not exist: ${absPath}`);
      }

      const diskSpace = await checkDiskSpace(absPath);

      return {
        free: diskSpace.free,
        size: diskSpace.size,
        used: diskSpace.size - diskSpace.free,
      };
    } catch (error) {
      throw new Error(
        `Failed to check disk space for ${dirPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Calculate the size of a repository directory
   * @param repoPath Path to repository
   * @returns Total size in bytes
   */
  async checkRepoSize(repoPath: string): Promise<number> {
    try {
      // Resolve to absolute path
      const absPath = path.resolve(repoPath);

      // Check if path exists
      if (!fs.existsSync(absPath)) {
        throw new Error(`Repository path does not exist: ${absPath}`);
      }

      // Check if it's a directory
      const stats = fs.statSync(absPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${absPath}`);
      }

      return await this.calculateDirectorySize(absPath);
    } catch (error) {
      throw new Error(
        `Failed to check repo size for ${repoPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check disk space and return warning if below threshold
   * @param dirPath Path to check
   * @param thresholdBytes Minimum free space in bytes (default: 1GB)
   * @returns Warning object if below threshold, null otherwise
   */
  async warnIfLow(
    dirPath: string,
    thresholdBytes: number = DiskChecker.DEFAULT_THRESHOLD
  ): Promise<DiskWarning | null> {
    try {
      const spaceInfo = await this.getAvailableSpace(dirPath);

      if (spaceInfo.free < thresholdBytes) {
        const availableMB = Math.floor(spaceInfo.free / (1024 * 1024));
        const thresholdMB = Math.floor(thresholdBytes / (1024 * 1024));

        return {
          path: dirPath,
          available: spaceInfo.free,
          threshold: thresholdBytes,
          message: `Low disk space warning: Only ${availableMB} MB available (threshold: ${thresholdMB} MB)`,
        };
      }

      return null;
    } catch (error) {
      throw new Error(
        `Failed to check disk space warning for ${dirPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Recursively calculate directory size
   * @param dirPath Directory path
   * @returns Total size in bytes
   */
  private async calculateDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        try {
          if (entry.isDirectory()) {
            // Recursively calculate subdirectory size
            totalSize += await this.calculateDirectorySize(fullPath);
          } else if (entry.isFile() || entry.isSymbolicLink()) {
            // Get file size
            const stats = fs.statSync(fullPath);
            totalSize += stats.size;
          }
        } catch (error) {
          // Skip files/directories that can't be accessed (permissions, etc.)
          // This is expected for some system directories
          continue;
        }
      }

      return totalSize;
    } catch (error) {
      // If we can't read the directory, return 0 rather than failing
      // This allows the function to continue even if some subdirectories are inaccessible
      return totalSize;
    }
  }
}
