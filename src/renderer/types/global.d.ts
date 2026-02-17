// Global type augmentations for the renderer process.
// window.api is exposed by the preload script via contextBridge.

import type { AppSettings, ProjectConfig } from '../../shared/models';

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
    };
  }
}
