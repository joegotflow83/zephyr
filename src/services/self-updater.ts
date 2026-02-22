/**
 * Self-update service for Zephyr Desktop.
 *
 * Checks for updates to the application itself by comparing the current
 * version (from package.json) with the latest version available in the
 * remote repository. Can trigger a self-update loop using the reserved
 * project ID "zephyr-self-update".
 */

import { GitManager } from './git-manager';
import type { LoopRunner } from './loop-runner';
import { LoopMode } from '../shared/loop-types';
import path from 'path';
import { readFileSync } from 'fs';

/**
 * Information about available updates.
 */
export interface UpdateInfo {
  /** Whether an update is available */
  available: boolean;
  /** Current installed version */
  currentVersion: string;
  /** Latest available version (or same as current if no update) */
  latestVersion: string;
  /** Optional changelog or release notes */
  changelog?: string;
}

/**
 * Reserved project ID for self-update operations.
 * This ID is used by the LoopRunner when executing self-updates.
 */
export const SELF_UPDATE_PROJECT_ID = 'zephyr-self-update';

/**
 * Compare two semver version strings (X.Y.Z format).
 * Returns positive if a > b, negative if a < b, zero if equal.
 *
 * @param a - First version string
 * @param b - Second version string
 * @returns Positive, negative, or zero
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

/**
 * Manages application self-updates.
 *
 * Uses GitManager to check for new versions by fetching and comparing
 * the remote repository. Can trigger a self-update loop via LoopRunner
 * using the reserved project ID.
 */
export class SelfUpdater {
  private gitManager: GitManager;
  private loopRunner: LoopRunner | null;
  private appDir: string;

  /**
   * Create a new SelfUpdater.
   *
   * @param gitManager - GitManager instance for repository operations
   * @param appDir - Root directory of the application (contains package.json)
   * @param loopRunner - Optional LoopRunner for triggering self-update loops
   */
  constructor(
    gitManager: GitManager,
    appDir: string,
    loopRunner: LoopRunner | null = null
  ) {
    this.gitManager = gitManager;
    this.appDir = appDir;
    this.loopRunner = loopRunner;
  }

  /**
   * Set the LoopRunner instance.
   * Useful for dependency injection after construction.
   *
   * @param loopRunner - LoopRunner instance
   */
  setLoopRunner(loopRunner: LoopRunner): void {
    this.loopRunner = loopRunner;
  }

  /**
   * Get the current application version from package.json.
   *
   * @returns Version string (e.g., "0.1.0")
   * @throws Error if package.json cannot be read or parsed
   */
  getCurrentVersion(): string {
    try {
      const packageJsonPath = path.join(this.appDir, 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      return packageJson.version || '0.0.0';
    } catch (error) {
      throw new Error(`Failed to read current version: ${(error as Error).message}`);
    }
  }

  /**
   * Check for available updates.
   *
   * Validates that the app directory is a git repository, fetches the latest
   * remote commits, and compares version strings. If the remote has a newer
   * version in package.json, returns UpdateInfo with available=true.
   *
   * @returns Update information with availability status
   * @throws Error if the app directory is not a valid git repository
   * @throws Error if git operations fail (network, auth, etc.)
   */
  async checkForUpdates(): Promise<UpdateInfo> {
    // Validate that appDir is a git repository
    const isRepo = await this.gitManager.validateRepo(this.appDir);
    if (!isRepo) {
      throw new Error(
        'Application directory is not a valid Git repository. Cannot check for updates.'
      );
    }

    // Get current version
    const currentVersion = this.getCurrentVersion();

    try {
      // Fetch the latest remote changes so origin/HEAD is up to date
      await this.gitManager.fetchRemote(this.appDir);

      // Verify repo info is accessible
      await this.gitManager.getRepoInfo(this.appDir);

      // Read remote package.json to get the latest published version
      let latestVersion = currentVersion;
      try {
        const remoteContent = await this.gitManager.getRemoteFileContent(
          this.appDir,
          'origin/HEAD',
          'package.json'
        );
        const remotePkg = JSON.parse(remoteContent);
        if (remotePkg.version) {
          latestVersion = remotePkg.version;
        }
      } catch {
        // If the remote package.json cannot be read (e.g., no network, missing
        // file), treat as no update available — don't surface a hard error.
        latestVersion = currentVersion;
      }

      // Get recent commits for changelog
      const commits = await this.gitManager.getRecentCommits(this.appDir, 5);
      let changelog = '';
      if (commits.length > 0) {
        changelog = commits
          .map((c) => `- ${c.message} (${c.hash.slice(0, 7)})`)
          .join('\n');
      }

      // An update is available only when the remote version is strictly newer
      const available = compareVersions(latestVersion, currentVersion) > 0;

      return {
        available,
        currentVersion,
        latestVersion,
        changelog,
      };
    } catch (error) {
      throw new Error(`Failed to check for updates: ${(error as Error).message}`);
    }
  }

  /**
   * Start a self-update loop.
   *
   * Triggers a loop execution using the reserved project ID "zephyr-self-update".
   * The loop will run in SINGLE mode, executing one update iteration.
   *
   * @param dockerImage - Docker image to use for the update loop
   * @param envVars - Optional environment variables for the update container
   * @returns The loop state after starting
   * @throws Error if no LoopRunner is configured
   * @throws Error if the self-update loop is already running
   */
  async startSelfUpdate(
    dockerImage: string,
    envVars?: Record<string, string>
  ): Promise<void> {
    if (!this.loopRunner) {
      throw new Error('LoopRunner not configured. Cannot start self-update.');
    }

    // Check if a self-update loop is already running
    const existingState = this.loopRunner.getLoopState(SELF_UPDATE_PROJECT_ID);
    if (existingState) {
      throw new Error('A self-update loop is already running.');
    }

    // Mount the application directory as a volume
    const volumeMounts = [`${this.appDir}:/workspace`];

    // Start the loop
    await this.loopRunner.startLoop({
      projectId: SELF_UPDATE_PROJECT_ID,
      dockerImage,
      mode: LoopMode.SINGLE,
      envVars,
      volumeMounts,
      workDir: '/workspace',
    });
  }
}
