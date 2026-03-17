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
    versions: ['1.23.0', '1.22.0', '1.21.0'],
    defaultVersion: '1.23.0',
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
  /** Which container runtime was used to build this image. Defaults to 'docker' for legacy images. */
  runtime?: 'docker' | 'podman';
}

/**
 * Predefined roles for a coding factory.
 * Each role maps to a separate container running a dedicated AI agent.
 */
export type FactoryRole = 'pm' | 'coder' | 'security' | 'qa';

/**
 * All available factory roles, in pipeline order.
 */
export const FACTORY_ROLES: FactoryRole[] = ['pm', 'coder', 'security', 'qa'];

/**
 * Human-readable labels for factory roles.
 */
export const FACTORY_ROLE_LABELS: Record<FactoryRole, string> = {
  pm: 'Project Manager',
  coder: 'Coder',
  security: 'Security',
  qa: 'QA',
};

/**
 * Configuration for running a project as a coding factory.
 * When enabled, the project runs multiple containers — one per role.
 */
export interface FactoryConfig {
  /** Whether factory mode is enabled for this project */
  enabled: boolean;
  /** Which roles to start when the factory launches */
  roles: FactoryRole[];
}

/**
 * VM configuration for a project using VM-backed sandbox execution.
 */
export interface VMConfig {
  /** Whether the VM persists between runs or is created fresh each time */
  vm_mode: 'persistent' | 'ephemeral';
  /** Number of vCPUs to allocate (default: 2) */
  cpus: number;
  /** RAM in gigabytes (default: 4) */
  memory_gb: number;
  /** Disk size in gigabytes (default: 20) */
  disk_gb: number;
  /** Optional cloud-init YAML override; omit to use the built-in Docker-install template */
  cloud_init?: string;
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
  /** Filenames of Kiro hook files to inject into ~/.kiro/hooks in the container */
  kiro_hooks: string[];
  /** Filename of the loop script to use as the container command (optional, single selection) */
  loop_script?: string;
  /** Filename of the Claude settings file to inject into ~/.claude/settings.json (optional, single selection) */
  claude_settings_file?: string;
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
  /**
   * GitLab Personal Access Token for ephemeral deploy key management.
   * Required only when repo_url points to a GitLab repository and the agent
   * needs to push commits. The actual PAT is stored encrypted in credentials.json
   * via CredentialManager.setGitlabPat(); this flag indicates a PAT is configured.
   * PAT with api or write_repository scope, scoped to the repo.
   */
  gitlab_pat?: string;
  /**
   * Additional host paths to mount into the container.
   * Each path is mounted at /mnt/<basename> inside the container.
   * e.g. ["/home/user/data"] mounts at /mnt/data
   */
  additional_mounts?: string[];
  /**
   * Whether to run loops inside a VM (via Multipass) or directly in a Docker container.
   * Defaults to 'container' when absent.
   */
  sandbox_type?: 'container' | 'vm';
  /** VM configuration; only relevant when sandbox_type === 'vm' */
  vm_config?: VMConfig;
  /**
   * Coding factory configuration.
   * When enabled, the project runs multiple containers — one per role —
   * with shared team coordination files in /workspace.
   */
  factory_config?: FactoryConfig;
  /**
   * Initial content to write to @feature_requests.md when scaffolding the
   * coding factory workspace. If omitted, the default template is used.
   * The file is never overwritten if it already exists on disk.
   */
  feature_requests_content?: string;
  /**
   * Raw JSON content to inject into the container at ~/.kiro/config.json.
   * Used to configure the Kiro (Amazon) AI agent when it is the active agent.
   */
  kiro_config?: string;
  /** Git user.name to set in the container via git config --global. Defaults to "Ralph". */
  git_user_name?: string;
  /** Git user.email to set in the container via git config --global. Defaults to "ralph@placeholder.com". */
  git_user_email?: string;
}

/**
 * Authentication method for Anthropic API access.
 * - api_key: ANTHROPIC_API_KEY injected as env var
 * - browser_session: claude.ai cookies written to ~/.claude.json in container
 * - aws_bedrock: AWS Bedrock env vars injected at container start
 */
export type AnthropicAuthMethod = 'api_key' | 'browser_session' | 'aws_bedrock';

/**
 * Podman-specific settings stub for future configuration.
 * Currently a placeholder; extended as Podman features are added.
 */
export type PodmanSettings = Record<string, never>;

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
  /**
   * Active container runtime. Defaults to 'docker'.
   * Changing this setting requires an app restart and images must be rebuilt.
   */
  container_runtime: 'docker' | 'podman';
  /** Podman-specific settings stub for future configuration */
  podman_settings?: PodmanSettings;
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
    anthropic_auth_method: 'api_key',
    container_runtime: 'docker',
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
    kiro_hooks: partial.kiro_hooks ?? [],
    loop_script: partial.loop_script,
    claude_settings_file: partial.claude_settings_file,
    custom_prompts: partial.custom_prompts ?? {},
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
    github_pat: partial.github_pat,
    gitlab_pat: partial.gitlab_pat,
    additional_mounts: partial.additional_mounts,
    sandbox_type: partial.sandbox_type,
    vm_config: partial.vm_config,
    factory_config: partial.factory_config,
    feature_requests_content: partial.feature_requests_content,
    kiro_config: partial.kiro_config,
  };
}
