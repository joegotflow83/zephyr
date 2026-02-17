/**
 * Core data models for Zephyr Desktop.
 *
 * These interfaces are shared between the main process and renderer via IPC.
 * They define the shape of all persisted data and are used throughout the app.
 */

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
  /** Jobs-to-be-done description for the AI agent */
  jtbd: string;
  /** Docker image to use for the container */
  docker_image: string;
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
    jtbd: partial.jtbd ?? '',
    docker_image: partial.docker_image ?? 'ubuntu:24.04',
    custom_prompts: partial.custom_prompts ?? {},
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
  };
}
