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
    };
  }
}
