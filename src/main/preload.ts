// Preload script: bridges main process and renderer via contextBridge.
// All window.api.* calls are defined here.
// See src/shared/ipc-channels.ts for channel constants.

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';

contextBridge.exposeInMainWorld('api', {
  ping: () => ipcRenderer.invoke(IPC.PING),

  projects: {
    list: () => ipcRenderer.invoke(IPC.PROJECTS_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC.PROJECTS_GET, id),
    add: (config: unknown) => ipcRenderer.invoke(IPC.PROJECTS_ADD, config),
    update: (id: string, partial: unknown) =>
      ipcRenderer.invoke(IPC.PROJECTS_UPDATE, id, partial),
    remove: (id: string) => ipcRenderer.invoke(IPC.PROJECTS_REMOVE, id),
  },

  settings: {
    load: () => ipcRenderer.invoke(IPC.SETTINGS_LOAD),
    save: (settings: unknown) => ipcRenderer.invoke(IPC.SETTINGS_SAVE, settings),
  },

  config: {
    export: () => ipcRenderer.invoke(IPC.CONFIG_EXPORT),
    import: () => ipcRenderer.invoke(IPC.CONFIG_IMPORT),
  },
});
