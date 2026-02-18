// Global type augmentations for the renderer process.
// window.api is exposed by the preload script via contextBridge.

import type { AppSettings, ProjectConfig } from '../../shared/models';
import type {
  DockerInfo,
  ContainerCreateOpts,
  ContainerStatus,
  ContainerInfo,
  ExecResult,
  ExecCommandOpts,
} from '../../services/docker-manager';
import type { CredentialService } from '../../services/credential-manager';
import type { LoginResult } from '../../services/login-manager';
import type { LoopState, LoopStartOpts } from '../../shared/loop-types';
import type { ScheduledLoop } from '../../services/scheduler';
import type { ParsedLogLine } from '../../services/log-parser';

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
          | { available: true; info: DockerInfo }
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
        listContainers: () => Promise<ContainerInfo[]>;
        /** Get container status by ID */
        getContainerStatus: (containerId: string) => Promise<ContainerStatus>;
        /** Execute a command in a container (non-interactive) */
        exec: (
          containerId: string,
          cmd: string[],
          opts?: ExecCommandOpts,
        ) => Promise<ExecResult>;

        // Event listeners
        /** Listen for Docker availability changes. Returns cleanup function. */
        onStatusChanged: (callback: (isAvailable: boolean) => void) => () => void;
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
      };

      loops: {
        /** Start a new loop execution */
        start: (opts: LoopStartOpts) => Promise<LoopState>;
        /** Stop a running loop */
        stop: (projectId: string) => Promise<void>;
        /** List all loop states (running and terminal) */
        list: () => Promise<LoopState[]>;
        /** Get a single loop state by project ID */
        get: (projectId: string) => Promise<LoopState | null>;
        /** Remove a loop from tracking (only terminal states) */
        remove: (projectId: string) => Promise<void>;
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
    };
  }
}
