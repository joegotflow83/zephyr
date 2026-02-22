/**
 * Core data models for Zephyr Desktop.
 *
 * These interfaces are shared between the main process and renderer via IPC.
 * They define the shape of all persisted data and are used throughout the app.
 */

/**
 * A supported programming language with installable versions.
 */
export interface LanguageOption {
  id: string;
  name: string;
  versions: string[];
  defaultVersion: string;
}

/**
 * A specific language + version selection for image building.
 */
export interface LanguageSelection {
  languageId: string;
  version: string;
}

/**
 * All languages available for inclusion in a Zephyr image.
 */
export const AVAILABLE_LANGUAGES: LanguageOption[] = [
  {
    id: 'python',
    name: 'Python',
    versions: ['3.12', '3.11', '3.10', '3.9'],
    defaultVersion: '3.12',
  },
  {
    id: 'nodejs',
    name: 'Node.js',
    versions: ['22', '20', '18'],
    defaultVersion: '20',
  },
  {
    id: 'rust',
    name: 'Rust',
    versions: ['stable', 'beta', 'nightly'],
    defaultVersion: 'stable',
  },
  {
    id: 'go',
    name: 'Go',
    versions: ['1.23', '1.22', '1.21'],
    defaultVersion: '1.23',
  },
];

/**
 * Configuration used to build a Zephyr Docker image.
 */
export interface ImageBuildConfig {
  name: string;
  languages: LanguageSelection[];
  baseTools?: string[];
}

/**
 * A locally built Zephyr Docker image with metadata.
 */
export interface ZephyrImage {
  id: string;
  name: string;
  dockerTag: string;
  languages: LanguageSelection[];
  buildConfig: ImageBuildConfig;
  builtAt: string;
  size?: number;
}

/**
 * Represents a user-configured AI loop project.
 * Each project maps to a Docker container running an AI agent.
 */
export interface ProjectConfig {
  /** UUID v4 identifier */
  id: string;
  /** Human-readable project name */
  name: string;
  /** Git repository URL or local path */
  repo_url: string;
  /** Docker image to use for the container */
  docker_image: string;
  /** ID of a ZephyrImage from the image library, if using a built image */
  image_id?: string;
  /** Filenames of pre-validation scripts to run before each loop */
  pre_validation_scripts: string[];
  /** Map of prompt filename → content for custom agent instructions */
  custom_prompts: Record<string, string>;
  /** ISO 8601 creation timestamp */
  created_at: string;
  /** ISO 8601 last-updated timestamp */
  updated_at: string;
}

/**
 * Global application settings persisted to ~/.zephyr/settings.json
 */
export interface AppSettings {
  /** Maximum number of Docker containers that can run simultaneously */
  max_concurrent_containers: number;
  /** Whether to show OS-native desktop notifications */
  notification_enabled: boolean;
  /** UI color theme: 'system' follows OS preference */
  theme: 'system' | 'light' | 'dark';
  /** Logging verbosity level */
  log_level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';
  /** Docker image used when running the self-update loop */
  self_update_docker_image?: string;
}

/**
 * Returns a new AppSettings object populated with all default values.
 */
export function createDefaultSettings(): AppSettings {
  return {
    max_concurrent_containers: 5,
    notification_enabled: true,
    theme: 'system',
    log_level: 'INFO',
    self_update_docker_image: 'zephyr-desktop:latest',
  };
}

/**
 * Generates a UUID v4 string (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx format).
 * Uses crypto.randomUUID() when available (Node.js 14.17+, browsers),
 * otherwise falls back to a Math.random-based implementation.
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Creates a complete ProjectConfig from a partial input.
 *
 * - Generates a UUID `id` if not provided
 * - Sets `created_at` and `updated_at` to the current ISO timestamp if not provided
 * - Fills all other missing fields with sensible defaults
 *
 * @param partial - Partial project configuration to build from
 * @returns A fully populated ProjectConfig
 */
export function createProjectConfig(partial: Partial<ProjectConfig> = {}): ProjectConfig {
  const now = new Date().toISOString();
  return {
    id: partial.id ?? generateUUID(),
    name: partial.name ?? '',
    repo_url: partial.repo_url ?? '',
    docker_image: partial.docker_image ?? 'ubuntu:24.04',
    image_id: partial.image_id,
    pre_validation_scripts: partial.pre_validation_scripts ?? [],
    custom_prompts: partial.custom_prompts ?? {},
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
  };
}
