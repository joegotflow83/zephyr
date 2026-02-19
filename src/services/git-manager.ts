/**
 * Git repository manager for Zephyr Desktop.
 *
 * Provides clone, validation, info retrieval, and recent commit listing
 * using simple-git. Used by the loop runner to validate repos before
 * starting containers.
 */

import { SimpleGit, simpleGit } from 'simple-git';
import path from 'path';
import { existsSync, readdirSync, mkdirSync, rmSync } from 'fs';

/**
 * Type definitions for Git operations
 */
export interface RepoInfo {
  /** Current branch name or detached HEAD hash */
  branch: string;
  /** URL of the 'origin' remote, empty string if not found */
  remoteUrl: string;
  /** Whether the working directory has uncommitted changes */
  isDirty: boolean;
}

export interface Commit {
  /** Full commit SHA hash */
  hash: string;
  /** First line of commit message */
  message: string;
  /** Author name and email */
  author: string;
  /** ISO 8601 timestamp */
  date: string;
}

/**
 * Progress callback for clone operations.
 * Called periodically during git clone with progress information.
 */
export type CloneProgressCallback = (progress: string) => void;

/**
 * Manages Git repository operations for Zephyr projects.
 *
 * Wraps simple-git to provide clone, validation, info, and commit
 * history functionality needed by the loop execution engine.
 */
export class GitManager {
  private git: SimpleGit;

  constructor() {
    this.git = simpleGit();
  }

  /**
   * Clone a remote repository to a local directory.
   *
   * @param url - Remote repository URL (HTTPS or SSH)
   * @param dest - Local path to clone into. Must not already exist as a non-empty directory
   * @param onProgress - Optional callback receiving progress strings from the clone operation
   * @throws Error if clone fails (network, auth, invalid URL, etc.)
   * @throws Error if destination directory already exists and is non-empty
   */
  async cloneRepo(
    url: string,
    dest: string,
    onProgress?: CloneProgressCallback
  ): Promise<void> {
    if (!url || !url.trim()) {
      throw new Error('Repository URL must not be empty');
    }

    const destPath = path.resolve(dest);

    // Check if destination exists and is non-empty
    if (existsSync(destPath)) {
      const files = readdirSync(destPath);
      if (files.length > 0) {
        throw new Error(
          `Target directory already exists and is non-empty: ${destPath}`
        );
      }
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(destPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    try {
      // Clone the repository
      // Note: simple-git progress callbacks work differently than gitpython
      // We receive a ProgressSummary object during clone
      await this.git.clone(url, destPath);

      if (onProgress) {
        onProgress('Clone complete');
      }
    } catch (error) {
      // Clean up the destination directory if clone failed
      if (existsSync(destPath)) {
        try {
          rmSync(destPath, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
      throw error;
    }
  }

  /**
   * Check whether a path is a valid Git repository.
   *
   * @param repoPath - Directory to check
   * @returns True if the path is a valid Git repo, false otherwise
   */
  async validateRepo(repoPath: string): Promise<boolean> {
    try {
      const gitDir = path.resolve(repoPath);

      if (!existsSync(gitDir)) {
        return false;
      }

      const repo = simpleGit(gitDir);
      // Try to access git directory to verify it's a valid repo
      await repo.revparse('--git-dir');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return metadata about the repository at the given path.
   *
   * @param repoPath - Root of a Git repository
   * @returns Object with branch, remoteUrl, and isDirty properties
   * @throws Error if the path is not a valid Git repository
   */
  async getRepoInfo(repoPath: string): Promise<RepoInfo> {
    const gitDir = path.resolve(repoPath);

    if (!existsSync(gitDir)) {
      throw new Error(`Repository path does not exist: ${gitDir}`);
    }

    const repo = simpleGit(gitDir);

    try {
      // Verify it's a valid git repo
      await repo.revparse('--git-dir');
    } catch {
      throw new Error(`Not a valid Git repository: ${gitDir}`);
    }

    // Get current branch
    let branch = '';
    try {
      const status = await repo.status();
      branch = status.current || 'detached';
    } catch {
      branch = 'unknown';
    }

    // Get remote URL
    let remoteUrl = '';
    try {
      const remotes = await repo.getRemotes(true);
      const originRemote = remotes.find((r) => r.name === 'origin');
      if (originRemote) {
        remoteUrl = originRemote.refs.fetch || '';
      }
    } catch {
      // Ignore error, remoteUrl remains empty
    }

    // Check if working directory is dirty
    let isDirty = false;
    try {
      const status = await repo.status();
      isDirty = !status.isClean();
    } catch {
      isDirty = false;
    }

    return {
      branch,
      remoteUrl,
      isDirty,
    };
  }

  /**
   * Return the count most recent commits from HEAD.
   *
   * @param repoPath - Root of a Git repository
   * @param count - Maximum number of commits to return (default 10)
   * @returns Array of commit objects with hash, message, author, and date
   * @throws Error if the path is not a valid Git repository
   */
  async getRecentCommits(repoPath: string, count = 10): Promise<Commit[]> {
    const gitDir = path.resolve(repoPath);

    if (!existsSync(gitDir)) {
      throw new Error(`Repository path does not exist: ${gitDir}`);
    }

    const repo = simpleGit(gitDir);

    try {
      // Verify it's a valid git repo
      await repo.revparse('--git-dir');
    } catch {
      throw new Error(`Not a valid Git repository: ${gitDir}`);
    }

    try {
      const log = await repo.log({ maxCount: count });
      return log.all.map((commit) => ({
        hash: commit.hash,
        message: commit.message.split('\n')[0], // First line only
        author: commit.author_name || 'unknown',
        date: new Date(commit.date).toISOString(),
      }));
    } catch (error) {
      // Empty repo or no commits
      if ((error as any)?.message?.includes('your current branch')) {
        return [];
      }
      throw error;
    }
  }
}
