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

  docker: {
    status: () => ipcRenderer.invoke(IPC.DOCKER_STATUS),
    pullImage: (image: string) => ipcRenderer.invoke(IPC.DOCKER_PULL_IMAGE, image),
    createContainer: (opts: unknown) => ipcRenderer.invoke(IPC.DOCKER_CREATE_CONTAINER, opts),
    start: (containerId: string) => ipcRenderer.invoke(IPC.DOCKER_START, containerId),
    stop: (containerId: string, timeout?: number) =>
      ipcRenderer.invoke(IPC.DOCKER_STOP, containerId, timeout),
    remove: (containerId: string, force?: boolean) =>
      ipcRenderer.invoke(IPC.DOCKER_REMOVE, containerId, force),
    listContainers: () => ipcRenderer.invoke(IPC.DOCKER_LIST_CONTAINERS),
    getContainerStatus: (containerId: string) =>
      ipcRenderer.invoke(IPC.DOCKER_CONTAINER_STATUS, containerId),
    exec: (containerId: string, cmd: string[], opts?: unknown) =>
      ipcRenderer.invoke(IPC.DOCKER_EXEC, containerId, cmd, opts),

    // Event listeners
    onStatusChanged: (callback: (isAvailable: boolean) => void) => {
      const listener = (_event: unknown, isAvailable: boolean) => callback(isAvailable);
      ipcRenderer.on(IPC.DOCKER_STATUS_CHANGED, listener);
      // Return cleanup function
      return () => ipcRenderer.removeListener(IPC.DOCKER_STATUS_CHANGED, listener);
    },
    onPullProgress: (callback: (data: { image: string; progress: unknown }) => void) => {
      const listener = (_event: unknown, data: { image: string; progress: unknown }) => callback(data);
      ipcRenderer.on(IPC.DOCKER_PULL_PROGRESS, listener);
      // Return cleanup function
      return () => ipcRenderer.removeListener(IPC.DOCKER_PULL_PROGRESS, listener);
    },
  },
});
