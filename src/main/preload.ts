// Preload script: bridges main process and renderer via contextBridge.
// All window.api.* calls are defined here.
// See src/shared/ipc-channels.ts for channel constants.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  ping: () => ipcRenderer.invoke('ping'),
});
