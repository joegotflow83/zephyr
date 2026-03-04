/**
 * Self-update service for Zephyr Desktop.
 *
 * Checks for updates to the application itself by comparing the current
 * version (from package.json) with the latest version available in the
 * remote repository. Can trigger a self-update loop using the reserved
 * project ID "zephyr-self-update".
 */

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

const GITHUB_RELEASES_API = 'https://api.github.com/repos/joegotflow83/zephyr/releases/latest';

/**
 * Manages application self-updates.
 *
 * Checks for new versions via the GitHub releases API and can trigger
 * a self-update loop via LoopRunner using the reserved project ID.
 */
export class SelfUpdater {
  private loopRunner: LoopRunner | null;
  private appDir: string;

  /**
   * Create a new SelfUpdater.
   *
   * @param appDir - Root directory of the application (contains package.json)
   * @param loopRunner - Optional LoopRunner for triggering self-update loops
   */
  constructor(
    appDir: string,
    loopRunner: LoopRunner | null = null
  ) {
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
   * Check for available updates via the GitHub releases API.
   *
   * Fetches the latest release from GitHub and compares its tag version
   * against the current installed version.
   *
   * @returns Update information with availability status
   * @throws Error if the GitHub API request fails
   */
  async checkForUpdates(): Promise<UpdateInfo> {
    const currentVersion = this.getCurrentVersion();

    try {
      const response = await fetch(GITHUB_RELEASES_API, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'zephyr-desktop',
        },
      });

      // No releases published yet — treat as up to date
      if (response.status === 404) {
        return {
          available: false,
          currentVersion,
          latestVersion: currentVersion,
        };
      }

      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
      }

      const release = (await response.json()) as { tag_name: string; body?: string };
      const latestVersion = release.tag_name.replace(/^v/, '');
      const changelog = release.body || '';
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
      projectName: 'Zephyr Self-Update',
      dockerImage,
      mode: LoopMode.SINGLE,
      envVars,
      volumeMounts,
      workDir: '/workspace',
    });
  }
}
