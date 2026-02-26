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
  /** Install Claude Code globally during the image build. Defaults to true. */
  installClaudeCode?: boolean;
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
  /** Git repository URL (e.g. https://github.com/user/repo or git@github.com:user/repo) */
  repo_url: string;
  /** Absolute host path to mount into the container at /workspace */
  local_path?: string;
  /** Docker image to use for the container */
  docker_image: string;
  /** ID of a ZephyrImage from the image library, if using a built image */
  image_id?: string;
  /** Filenames of pre-validation scripts to run before each loop */
  pre_validation_scripts: string[];
  /** Filenames of hook files to inject into ~/.claude/hooks in the container */
  hooks: string[];
  /** Map of prompt filename → content for custom agent instructions */
  custom_prompts: Record<string, string>;
  /** ISO 8601 creation timestamp */
  created_at: string;
  /** ISO 8601 last-updated timestamp */
  updated_at: string;
  /**
   * GitHub Personal Access Token for ephemeral deploy key management.
   * Required only when repo_url points to a GitHub repository and the agent
   * needs to push commits. The actual PAT is stored encrypted in credentials.json
   * via CredentialManager.setGithubPat(); this flag indicates a PAT is configured.
   * Fine-grained PAT with read/write access to repository deploy keys, scoped to the repo.
   */
  github_pat?: string;
}

/**
 * Authentication method for Anthropic API access.
 * - api_key: ANTHROPIC_API_KEY injected as env var
 * - browser_session: claude.ai cookies written to ~/.claude.json in container
 * - aws_bedrock: AWS Bedrock env vars injected at container start
 */
export type AnthropicAuthMethod = 'api_key' | 'browser_session' | 'aws_bedrock';

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
  /** Which Anthropic auth method to inject into containers */
  anthropic_auth_method: AnthropicAuthMethod;
  /** AWS region for Bedrock access */
  bedrock_region?: string;
  /** Anthropic model override for Bedrock */
  bedrock_model?: string;
  /** Small/fast model override for Bedrock */
  bedrock_small_fast_model?: string;
  /** Anthropic log level for Bedrock */
  bedrock_log?: string;
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
    anthropic_auth_method: 'api_key',
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
    local_path: partial.local_path,
    docker_image: partial.docker_image ?? 'ubuntu:24.04',
    image_id: partial.image_id,
    pre_validation_scripts: partial.pre_validation_scripts ?? [],
    hooks: partial.hooks ?? [],
    custom_prompts: partial.custom_prompts ?? {},
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
    github_pat: partial.github_pat,
  };
}
