// Global type augmentations for the renderer process.
// window.api is exposed by the preload script via contextBridge.

import type { AppSettings, ProjectConfig, VMConfig, ZephyrImage, ImageBuildConfig } from '../../shared/models';
import type { FactoryTask, FactoryColumn } from '../../shared/factory-types';
import type { DeployKeyRecord } from '../../services/deploy-key-store';
import type { PreValidationScript } from '../../services/pre-validation-store';
import type { HookFile } from '../../services/hooks-store';
import type { KiroHookFile } from '../../services/kiro-hooks-store';
import type { LoopScript } from '../../services/loop-scripts-store';
import type { ClaudeSettingsFile } from '../../services/claude-settings-store';
import type {
  RuntimeInfo,
  ContainerCreateOpts,
  ContainerStatus,
  ContainerSummary,
  ExecResult,
  ExecOpts,
} from '../../services/container-runtime';
import type { CredentialService } from '../../services/credential-manager';
import type { LoginResult } from '../../services/login-manager';
import type { LoopState, LoopStartOpts } from '../../shared/loop-types';
import type { ScheduledLoop } from '../../services/scheduler';
import type { ParsedLogLine } from '../../services/log-parser';
import type { TerminalSession, TerminalSessionOpts } from '../../services/terminal-manager';
import type { UpdateInfo } from '../../services/self-updater';
import type { AutoUpdateState } from '../../services/auto-updater';
import type { VMInfo } from '../../services/vm-manager';

export {};

declare global {
  interface Window {
    api: {
      ping: () => Promise<string>;

      projects: {
        list: () => Promise<ProjectConfig[]>;
        get: (id: string) => Promise<ProjectConfig | null>;
        add: (
          config: Omit<ProjectConfig, 'id' | 'created_at' | 'updated_at'>,
        ) => Promise<ProjectConfig>;
        update: (
          id: string,
          partial: Partial<Omit<ProjectConfig, 'id' | 'created_at'>>,
        ) => Promise<ProjectConfig>;
        remove: (id: string) => Promise<boolean>;
      };

      settings: {
        load: () => Promise<AppSettings>;
        save: (settings: AppSettings) => Promise<void>;
      };

      config: {
        /** Opens a save dialog and exports config to the chosen path. Returns path or null if cancelled. */
        export: () => Promise<string | null>;
        /** Opens an open dialog and imports from the chosen zip. Returns true on success, false if cancelled. */
        import: () => Promise<boolean>;
      };

      docker: {
        /** Check Docker availability and get daemon info */
        status: () => Promise<
          | { available: false }
          | { available: true; info: RuntimeInfo }
        >;
        /** Pull a Docker image with progress updates via onPullProgress */
        pullImage: (image: string) => Promise<{ success: boolean }>;
        /** Create a new container */
        createContainer: (opts: ContainerCreateOpts) => Promise<string>;
        /** Start a container by ID */
        start: (containerId: string) => Promise<void>;
        /** Stop a container by ID */
        stop: (containerId: string, timeout?: number) => Promise<void>;
        /** Remove a container by ID */
        remove: (containerId: string, force?: boolean) => Promise<void>;
        /** List all Zephyr-managed running containers */
        listContainers: () => Promise<ContainerSummary[]>;
        /** Get container status by ID */
        getContainerStatus: (containerId: string) => Promise<ContainerStatus>;
        /** Execute a command in a container (non-interactive) */
        exec: (
          containerId: string,
          cmd: string[],
          opts?: ExecOpts,
        ) => Promise<ExecResult>;

        // Event listeners
        /** Listen for Docker availability changes. Returns cleanup function. */
        onStatusChanged: (callback: (isAvailable: boolean, info?: RuntimeInfo) => void) => () => void;
        /** Listen for image pull progress. Returns cleanup function. */
        onPullProgress: (
          callback: (data: { image: string; progress: unknown }) => void,
        ) => () => void;
      };

      credentials: {
        /** Store an API key for a service */
        store: (service: CredentialService, key: string) => Promise<void>;
        /** Get a masked API key for display. Returns null if not stored. */
        get: (service: CredentialService) => Promise<string | null>;
        /** Delete an API key for a service */
        delete: (service: CredentialService) => Promise<void>;
        /** List all services with stored credentials */
        list: () => Promise<string[]>;
        /** Open browser-based login window for a service */
        login: (service: string) => Promise<LoginResult>;
        /** Check which auth methods are currently configured */
        checkAuth: () => Promise<{ api_key: boolean; browser_session: boolean; aws_bedrock: boolean }>;
      };

      loops: {
        /** Start a new loop execution */
        start: (opts: LoopStartOpts) => Promise<LoopState>;
        /** Stop a running loop. Pass role for factory loops. */
        stop: (projectId: string, role?: string) => Promise<void>;
        /** List all loop states (running and terminal) */
        list: () => Promise<LoopState[]>;
        /** Get a single loop state by project ID and optional role */
        get: (projectId: string, role?: string) => Promise<LoopState | null>;
        /** Remove a loop from tracking (only terminal states). Pass role for factory loops. */
        remove: (projectId: string, role?: string) => Promise<void>;
        /** Schedule a loop for recurring execution */
        schedule: (
          projectId: string,
          schedule: string,
          loopOpts: Omit<LoopStartOpts, 'mode'>,
        ) => Promise<void>;
        /** Cancel a scheduled loop */
        cancelSchedule: (projectId: string) => Promise<void>;
        /** List all scheduled loops */
        listScheduled: () => Promise<ScheduledLoop[]>;

        // Event listeners
        /** Listen for loop state changes. Returns cleanup function. */
        onStateChanged: (callback: (state: LoopState) => void) => () => void;
        /** Listen for parsed log lines. Returns cleanup function. */
        onLogLine: (
          callback: (projectId: string, line: ParsedLogLine) => void,
        ) => () => void;
      };

      factory: {
        /** Start all factory roles for a project */
        start: (projectId: string, baseOpts: LoopStartOpts) => Promise<LoopState[]>;
        /** Stop all factory roles for a project */
        stop: (projectId: string) => Promise<void>;
      };

      factoryTasks: {
        /** List all tasks for a project */
        list: (projectId: string) => Promise<FactoryTask[]>;
        /** Get a single task by ID */
        get: (projectId: string, taskId: string) => Promise<FactoryTask | null>;
        /** Add a new task to the backlog */
        add: (projectId: string, title: string, description: string) => Promise<FactoryTask>;
        /** Move a task to a different column (validates against ALLOWED_TRANSITIONS) */
        move: (projectId: string, taskId: string, toColumn: FactoryColumn) => Promise<FactoryTask>;
        /** Remove a task by ID */
        remove: (projectId: string, taskId: string) => Promise<boolean>;
        /** Update task fields (title, description) */
        update: (projectId: string, taskId: string, updates: Partial<Pick<FactoryTask, 'title' | 'description'>>) => Promise<FactoryTask>;
        /** Sync tasks from spec files in the project's specs directory */
        sync: (projectId: string) => Promise<FactoryTask[]>;
        /** Listen for task changes broadcast from the main process. Returns cleanup function. */
        onChanged: (callback: (projectId: string, tasks: FactoryTask[]) => void) => () => void;
      };

      logs: {
        /** Export a single loop's logs. Opens save dialog. Returns result with success status and path. */
        export: (
          projectId: string,
          format?: 'text' | 'json',
        ) => Promise<{ success: boolean; path?: string; error?: string }>;
        /** Export all loop logs to a zip file. Opens save dialog. Returns result with success status and path. */
        exportAll: (
          format?: 'text' | 'json',
        ) => Promise<{ success: boolean; path?: string; error?: string }>;
      };

      terminal: {
        /** Open a new terminal session to a Docker container on the host */
        open: (
          containerId: string,
          opts?: TerminalSessionOpts,
        ) => Promise<{ success: boolean; session?: TerminalSession; error?: string }>;
        /** Open a terminal session to a Docker container running inside a Multipass VM */
        openVM: (
          vmName: string,
          containerName: string,
          opts?: TerminalSessionOpts,
        ) => Promise<{ success: boolean; session?: TerminalSession; error?: string }>;
        /** Close a terminal session */
        close: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
        /** Write data to a terminal session (fire-and-forget, no return value) */
        write: (sessionId: string, data: string) => void;
        /** Resize a terminal session PTY */
        resize: (
          sessionId: string,
          cols: number,
          rows: number,
        ) => Promise<{ success: boolean; error?: string }>;

        // Event listeners
        /** Listen for terminal output data. Returns cleanup function. */
        onData: (callback: (sessionId: string, data: string) => void) => () => void;
        /** Listen for terminal session close events. Returns cleanup function. */
        onClosed: (callback: (sessionId: string) => void) => () => void;
        /** Listen for terminal session errors. Returns cleanup function. */
        onError: (callback: (sessionId: string, error: string) => void) => () => void;
      };

      updates: {
        /** Check for available application updates */
        check: () => Promise<UpdateInfo>;
        /** Apply an update by starting a self-update loop */
        apply: (dockerImage: string, envVars?: Record<string, string>) => Promise<void>;
      };

      autoUpdate: {
        /** Get current auto-update state */
        getState: () => Promise<AutoUpdateState>;
        /** Check for updates (result reflected in state changes) */
        check: () => Promise<void>;
        /** Download the available update */
        download: () => Promise<void>;
        /** Install the downloaded update and restart */
        install: () => Promise<void>;
        /** Listen for auto-update state changes. Returns cleanup function. */
        onStateChanged: (callback: (state: AutoUpdateState) => void) => () => void;
      };

      images: {
        /** List all built images in the library */
        list: () => Promise<ZephyrImage[]>;
        /** Get a single image by ID */
        get: (id: string) => Promise<ZephyrImage | null>;
        /** Start building an image from config. Progress is streamed via onBuildProgress. */
        build: (config: ImageBuildConfig) => Promise<ZephyrImage>;
        /** Rebuild an image using its original config */
        rebuild: (id: string) => Promise<ZephyrImage>;
        /** Delete an image from the library */
        delete: (id: string) => Promise<boolean>;
        /** Listen for build progress lines. Returns cleanup function. */
        onBuildProgress: (callback: (line: string) => void) => () => void;
      };

      preValidation: {
        /** List all pre-validation scripts in ~/.zephyr/pre_validation_scripts/ */
        list: () => Promise<PreValidationScript[]>;
        /** Get the content of a specific script */
        get: (filename: string) => Promise<string | null>;
        /** Add or overwrite a custom script */
        add: (filename: string, content: string) => Promise<void>;
        /** Remove a script. Returns true if deleted, false if not found. */
        remove: (filename: string) => Promise<boolean>;
      };

      hooks: {
        /** List all hook files in ~/.zephyr/hooks/ */
        list: () => Promise<HookFile[]>;
        /** Get the content of a specific hook file */
        get: (filename: string) => Promise<string | null>;
        /** Add or overwrite a hook file */
        add: (filename: string, content: string) => Promise<void>;
        /** Remove a hook file. Returns true if deleted, false if not found. */
        remove: (filename: string) => Promise<boolean>;
      };

      loopScripts: {
        /** List all loop scripts in ~/.zephyr/loop_scripts/ */
        list: () => Promise<LoopScript[]>;
        /** Get the content of a specific loop script */
        get: (filename: string) => Promise<string | null>;
        /** Add or overwrite a loop script */
        add: (filename: string, content: string) => Promise<void>;
        /** Remove a loop script. Returns true if deleted, false if not found. */
        remove: (filename: string) => Promise<boolean>;
      };

      kiroHooks: {
        /** List all Kiro hook files in ~/.zephyr/kiro_hooks/ */
        list: () => Promise<KiroHookFile[]>;
        /** Get the content of a specific Kiro hook file */
        get: (filename: string) => Promise<string | null>;
        /** Add or overwrite a Kiro hook file */
        add: (filename: string, content: string) => Promise<void>;
        /** Remove a Kiro hook file. Returns true if deleted, false if not found. */
        remove: (filename: string) => Promise<boolean>;
      };

      claudeSettings: {
        /** List all Claude settings files in ~/.zephyr/claude_settings/ */
        list: () => Promise<ClaudeSettingsFile[]>;
        /** Get the content of a specific settings file */
        get: (filename: string) => Promise<string | null>;
        /** Add or overwrite a settings file */
        add: (filename: string, content: string) => Promise<void>;
        /** Remove a settings file. Returns true if deleted, false if not found. */
        remove: (filename: string) => Promise<boolean>;
      };

      githubPat: {
        /** Store a GitHub PAT for a project (encrypted) */
        set: (projectId: string, pat: string) => Promise<void>;
        /** Check whether a GitHub PAT is stored for a project. Returns true if stored. */
        has: (projectId: string) => Promise<boolean>;
        /** Delete the GitHub PAT for a project */
        delete: (projectId: string) => Promise<void>;
      };

      gitlabPat: {
        /** Store a GitLab PAT for a project (encrypted) */
        set: (projectId: string, pat: string) => Promise<void>;
        /** Check whether a GitLab PAT is stored for a project. Returns true if stored. */
        has: (projectId: string) => Promise<boolean>;
        /** Delete the GitLab PAT for a project */
        delete: (projectId: string) => Promise<void>;
      };

      deployKeys: {
        /** List all orphaned deploy keys (keys that were never cleaned up) */
        listOrphaned: () => Promise<DeployKeyRecord[]>;
        /** Get the deploy keys management URL for a repo. Pass service to get GitLab URL. */
        getUrl: (repo: string, service?: 'github' | 'gitlab') => Promise<string>;
        /** Mark an orphaned key as cleaned so it no longer appears in the UI */
        markCleaned: (keyId: number) => Promise<void>;
      };

      app: {
        /** Listen for the app-ready event (fires after startup completes). Returns cleanup function. */
        onReady: (callback: () => void) => () => void;
      };

      shell: {
        /** Open a URL in the system's default browser */
        openExternal: (url: string) => Promise<void>;
      };

      vm: {
        /** Check Multipass availability and version */
        status: () => Promise<{ available: false } | { available: true; version?: string }>;
        /** List all Multipass VMs */
        list: () => Promise<VMInfo[]>;
        /** Get detailed info for a specific VM by name */
        get: (name: string) => Promise<VMInfo | null>;
        /** Start (or provision-then-start) the persistent VM for a project */
        start: (projectId: string, vmConfig?: VMConfig) => Promise<VMInfo>;
        /** Stop the persistent VM for a project */
        stop: (projectId: string) => Promise<void>;
        /** Delete a VM by name and purge it from disk */
        delete: (name: string) => Promise<void>;

        // Event listeners
        /** Listen for VM status changes. Returns cleanup function. */
        onStatusChanged: (callback: (info: VMInfo) => void) => () => void;
      };
    };
  }
}
