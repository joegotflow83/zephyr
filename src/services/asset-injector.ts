/**
 * AssetInjector service for Zephyr Desktop.
 *
 * Prepares temporary directories containing shared assets (AGENTS.md,
 * custom prompts, PROMPT_build.md) that get volume-mounted into Docker
 * containers so that AI loop agents can reference them.
 *
 * Priority resolution:
 * 1. Project-specific custom_prompts override any defaults
 * 2. App-level AGENTS.md is used unless project provides override
 * 3. Default PROMPT_build.md is included if not in custom_prompts
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { ProjectConfig } from '../shared/models';

/** Default PROMPT_build.md content when no override is provided */
const DEFAULT_PROMPT_BUILD = `# Build Prompt

Follow the instructions in AGENTS.md to build and test the project.
`;

/** Default path to app's AGENTS.md in project root */
const APP_ROOT = path.resolve(__dirname, '../../');
const DEFAULT_AGENTS_MD_PATH = path.join(APP_ROOT, 'AGENTS.md');

/** Container mount target path */
export const CONTAINER_MOUNT_TARGET = '/home/ralph/app';

/**
 * Prepares shared assets for injection into Docker containers.
 *
 * Assets are assembled in a temporary directory that can be
 * volume-mounted. The injector resolves file priorities:
 *
 * 1. Project-specific custom prompts override any defaults
 * 2. App-level AGENTS.md unless project overrides
 * 3. PROMPT_build.md default unless project provides it
 */
export class AssetInjector {
  private agentsMdPath: string;

  /**
   * Creates a new AssetInjector.
   *
   * @param agentsMdPath - Path to app's AGENTS.md (defaults to repo root)
   */
  constructor(agentsMdPath?: string) {
    this.agentsMdPath = agentsMdPath ?? DEFAULT_AGENTS_MD_PATH;
  }

  /**
   * Creates a temporary directory populated with shared assets.
   *
   * The directory will contain:
   * - AGENTS.md (from app root or project override)
   * - Each file listed in project.custom_prompts
   * - PROMPT_build.md (default if not in custom_prompts)
   *
   * @param project - The project whose assets should be assembled
   * @returns Path to the temporary injection directory
   * @throws If directory creation or file writing fails
   */
  async prepareInjectionDir(project: ProjectConfig): Promise<string> {
    // Create temp directory with project ID prefix
    const prefix = `zephyr-inject-${project.id.slice(0, 8)}-`;
    const injectionDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

    try {
      // Write files in priority order
      await this.writeAgentsMd(injectionDir, project);
      await this.writeCustomPrompts(injectionDir, project);
      await this.ensurePromptBuild(injectionDir, project);

      return injectionDir;
    } catch (error) {
      // Clean up partial directory on error
      await this.cleanup(injectionDir);
      throw error;
    }
  }

  /**
   * Returns Docker volume mount configuration for injection directory.
   *
   * @param injectionDir - Path to prepared injection directory
   * @returns Docker volume mount config object
   */
  getMountConfig(injectionDir: string): Record<string, { bind: string; mode: string }> {
    return {
      [injectionDir]: {
        bind: CONTAINER_MOUNT_TARGET,
        mode: 'ro',
      },
    };
  }

  /**
   * Removes a previously created injection directory.
   *
   * Silently ignores missing or already-deleted directories.
   *
   * @param injectionDir - Path returned by prepareInjectionDir
   */
  async cleanup(injectionDir: string): Promise<void> {
    try {
      await fs.rm(injectionDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors (directory may already be deleted)
    }
  }

  // -- Internal helpers --

  /**
   * Writes AGENTS.md to injection directory.
   * Project override wins over app default.
   */
  private async writeAgentsMd(injectionDir: string, project: ProjectConfig): Promise<void> {
    const target = path.join(injectionDir, 'AGENTS.md');

    // Priority 1: Project override
    if (project.custom_prompts['AGENTS.md']) {
      await fs.writeFile(target, project.custom_prompts['AGENTS.md'], 'utf8');
      return;
    }

    // Priority 2: App default
    try {
      await fs.copyFile(this.agentsMdPath, target);
    } catch (error) {
      // App AGENTS.md not found - skip (not fatal)
      // In production, the app should always have AGENTS.md,
      // but tests may not provide it
    }
  }

  /**
   * Writes all custom prompt files from project config.
   * AGENTS.md is skipped here since it's handled separately.
   */
  private async writeCustomPrompts(injectionDir: string, project: ProjectConfig): Promise<void> {
    for (const [filename, content] of Object.entries(project.custom_prompts)) {
      // Skip AGENTS.md (handled by writeAgentsMd)
      if (filename === 'AGENTS.md') {
        continue;
      }

      const target = path.join(injectionDir, filename);

      // Ensure parent directories exist for nested filenames
      await fs.mkdir(path.dirname(target), { recursive: true });

      await fs.writeFile(target, content, 'utf8');
    }
  }

  /**
   * Ensures PROMPT_build.md exists in injection directory.
   * Writes default content if not already present.
   */
  private async ensurePromptBuild(injectionDir: string, _project: ProjectConfig): Promise<void> {
    const target = path.join(injectionDir, 'PROMPT_build.md');

    // Check if already written via custom_prompts
    try {
      await fs.access(target);
      // File exists, nothing to do
      return;
    } catch {
      // File doesn't exist, write default
      await fs.writeFile(target, DEFAULT_PROMPT_BUILD, 'utf8');
    }
  }
}
