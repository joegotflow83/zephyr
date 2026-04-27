// Preload script: bridges main process and renderer via contextBridge.
// All window.api.* calls are defined here.
// See src/shared/ipc-channels.ts for channel constants.

import { contextBridge, ipcRenderer, shell } from 'electron';
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
    status: () => ipcRenderer.invoke(IPC.RUNTIME_STATUS),
    pullImage: (image: string) => ipcRenderer.invoke(IPC.RUNTIME_PULL_IMAGE, image),
    createContainer: (opts: unknown) => ipcRenderer.invoke(IPC.RUNTIME_CREATE_CONTAINER, opts),
    start: (containerId: string) => ipcRenderer.invoke(IPC.RUNTIME_START, containerId),
    stop: (containerId: string, timeout?: number) =>
      ipcRenderer.invoke(IPC.RUNTIME_STOP, containerId, timeout),
    remove: (containerId: string, force?: boolean) =>
      ipcRenderer.invoke(IPC.RUNTIME_REMOVE, containerId, force),
    listContainers: () => ipcRenderer.invoke(IPC.RUNTIME_LIST_CONTAINERS),
    getContainerStatus: (containerId: string) =>
      ipcRenderer.invoke(IPC.RUNTIME_CONTAINER_STATUS, containerId),
    exec: (containerId: string, cmd: string[], opts?: unknown) =>
      ipcRenderer.invoke(IPC.RUNTIME_EXEC, containerId, cmd, opts),

    // Event listeners
    onStatusChanged: (callback: (isAvailable: boolean, info?: unknown) => void) => {
      const listener = (_event: unknown, isAvailable: boolean, info?: unknown) => callback(isAvailable, info);
      ipcRenderer.on(IPC.RUNTIME_STATUS_CHANGED, listener);
      // Return cleanup function
      return () => ipcRenderer.removeListener(IPC.RUNTIME_STATUS_CHANGED, listener);
    },
    onPullProgress: (callback: (data: { image: string; progress: unknown }) => void) => {
      const listener = (_event: unknown, data: { image: string; progress: unknown }) => callback(data);
      ipcRenderer.on(IPC.RUNTIME_PULL_PROGRESS, listener);
      // Return cleanup function
      return () => ipcRenderer.removeListener(IPC.RUNTIME_PULL_PROGRESS, listener);
    },
  },

  credentials: {
    store: (service: string, key: string) =>
      ipcRenderer.invoke(IPC.CREDENTIALS_STORE, service, key),
    get: (service: string) => ipcRenderer.invoke(IPC.CREDENTIALS_GET, service),
    delete: (service: string) => ipcRenderer.invoke(IPC.CREDENTIALS_DELETE, service),
    list: () => ipcRenderer.invoke(IPC.CREDENTIALS_LIST),
    login: (service: string) => ipcRenderer.invoke(IPC.CREDENTIALS_LOGIN, service),
    checkAuth: () => ipcRenderer.invoke(IPC.CREDENTIALS_CHECK_AUTH),
  },

  loops: {
    start: (opts: unknown) => ipcRenderer.invoke(IPC.LOOP_START, opts),
    stop: (projectId: string, role?: string) => ipcRenderer.invoke(IPC.LOOP_STOP, projectId, role),
    list: () => ipcRenderer.invoke(IPC.LOOP_LIST),
    get: (projectId: string, role?: string) => ipcRenderer.invoke(IPC.LOOP_GET, projectId, role),
    remove: (projectId: string, role?: string) => ipcRenderer.invoke(IPC.LOOP_REMOVE, projectId, role),
    schedule: (projectId: string, schedule: string, loopOpts: unknown) =>
      ipcRenderer.invoke(IPC.LOOP_SCHEDULE, projectId, schedule, loopOpts),
    cancelSchedule: (projectId: string) =>
      ipcRenderer.invoke(IPC.LOOP_CANCEL_SCHEDULE, projectId),
    listScheduled: () => ipcRenderer.invoke(IPC.LOOP_LIST_SCHEDULED),

    // Event listeners
    onStateChanged: (callback: (state: unknown) => void) => {
      const listener = (_event: unknown, state: unknown) => callback(state);
      ipcRenderer.on(IPC.LOOP_STATE_CHANGED, listener);
      // Return cleanup function
      return () => ipcRenderer.removeListener(IPC.LOOP_STATE_CHANGED, listener);
    },
    onLogLine: (callback: (projectId: string, line: unknown) => void) => {
      const listener = (_event: unknown, projectId: string, line: unknown) =>
        callback(projectId, line);
      ipcRenderer.on(IPC.LOOP_LOG_LINE, listener);
      // Return cleanup function
      return () => ipcRenderer.removeListener(IPC.LOOP_LOG_LINE, listener);
    },
  },

  factory: {
    start: (projectId: string, baseOpts: unknown) =>
      ipcRenderer.invoke(IPC.FACTORY_START, projectId, baseOpts),
    stop: (projectId: string) =>
      ipcRenderer.invoke(IPC.FACTORY_STOP, projectId),
    restartContainer: (projectId: string, role: string) =>
      ipcRenderer.invoke(IPC.FACTORY_RESTART_CONTAINER, projectId, role),
  },

  factoryTasks: {
    list: (projectId: string) =>
      ipcRenderer.invoke(IPC.FACTORY_TASK_LIST, projectId),
    get: (projectId: string, taskId: string) =>
      ipcRenderer.invoke(IPC.FACTORY_TASK_GET, projectId, taskId),
    add: (projectId: string, title: string, description: string) =>
      ipcRenderer.invoke(IPC.FACTORY_TASK_ADD, projectId, title, description),
    move: (projectId: string, taskId: string, toColumn: string) =>
      ipcRenderer.invoke(IPC.FACTORY_TASK_MOVE, projectId, taskId, toColumn),
    remove: (projectId: string, taskId: string) =>
      ipcRenderer.invoke(IPC.FACTORY_TASK_REMOVE, projectId, taskId),
    update: (projectId: string, taskId: string, updates: unknown) =>
      ipcRenderer.invoke(IPC.FACTORY_TASK_UPDATE, projectId, taskId, updates),
    sync: (projectId: string) =>
      ipcRenderer.invoke(IPC.FACTORY_TASK_SYNC, projectId),
    onChanged: (callback: (projectId: string, tasks: unknown[]) => void) => {
      const listener = (_event: unknown, projectId: string, tasks: unknown[]) =>
        callback(projectId, tasks);
      ipcRenderer.on(IPC.FACTORY_TASK_CHANGED, listener);
      // Return cleanup function
      return () => ipcRenderer.removeListener(IPC.FACTORY_TASK_CHANGED, listener);
    },
  },

  pipelines: {
    list: () => ipcRenderer.invoke(IPC.PIPELINE_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC.PIPELINE_GET, id),
    add: (input: unknown) => ipcRenderer.invoke(IPC.PIPELINE_ADD, input),
    update: (id: string, patch: unknown) =>
      ipcRenderer.invoke(IPC.PIPELINE_UPDATE, id, patch),
    remove: (id: string) => ipcRenderer.invoke(IPC.PIPELINE_REMOVE, id),
    onChanged: (callback: (pipelines: unknown[]) => void) => {
      const listener = (_event: unknown, pipelines: unknown[]) => callback(pipelines);
      ipcRenderer.on(IPC.PIPELINE_CHANGED, listener);
      // Return cleanup function
      return () => ipcRenderer.removeListener(IPC.PIPELINE_CHANGED, listener);
    },
  },

  logs: {
    export: (projectId: string, format?: 'text' | 'json') =>
      ipcRenderer.invoke(IPC.LOGS_EXPORT, projectId, format),
    exportAll: (format?: 'text' | 'json') =>
      ipcRenderer.invoke(IPC.LOGS_EXPORT_ALL, format),
  },

  terminal: {
    open: (containerId: string, opts?: unknown) =>
      ipcRenderer.invoke(IPC.TERMINAL_OPEN, containerId, opts),
    openVM: (vmName: string, containerName: string, opts?: unknown) =>
      ipcRenderer.invoke(IPC.TERMINAL_OPEN_VM, vmName, containerName, opts),
    close: (sessionId: string) =>
      ipcRenderer.invoke(IPC.TERMINAL_CLOSE, sessionId),
    write: (sessionId: string, data: string) =>
      ipcRenderer.send(IPC.TERMINAL_WRITE, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.TERMINAL_RESIZE, sessionId, cols, rows),

    // Event listeners
    onData: (callback: (sessionId: string, data: string) => void) => {
      const listener = (_event: unknown, sessionId: string, data: string) =>
        callback(sessionId, data);
      ipcRenderer.on(IPC.TERMINAL_DATA, listener);
      // Return cleanup function
      return () => ipcRenderer.removeListener(IPC.TERMINAL_DATA, listener);
    },
    onClosed: (callback: (sessionId: string) => void) => {
      const listener = (_event: unknown, sessionId: string) => callback(sessionId);
      ipcRenderer.on(IPC.TERMINAL_CLOSED, listener);
      // Return cleanup function
      return () => ipcRenderer.removeListener(IPC.TERMINAL_CLOSED, listener);
    },
    onError: (callback: (sessionId: string, error: string) => void) => {
      const listener = (_event: unknown, sessionId: string, error: string) =>
        callback(sessionId, error);
      ipcRenderer.on(IPC.TERMINAL_ERROR, listener);
      // Return cleanup function
      return () => ipcRenderer.removeListener(IPC.TERMINAL_ERROR, listener);
    },
  },

  updates: {
    check: () => ipcRenderer.invoke(IPC.UPDATES_CHECK),
    apply: (dockerImage: string, envVars?: Record<string, string>) =>
      ipcRenderer.invoke(IPC.UPDATES_APPLY, dockerImage, envVars),
  },

  autoUpdate: {
    getState: () => ipcRenderer.invoke(IPC.AUTO_UPDATE_GET_STATE),
    check: () => ipcRenderer.invoke(IPC.AUTO_UPDATE_CHECK),
    download: () => ipcRenderer.invoke(IPC.AUTO_UPDATE_DOWNLOAD),
    install: () => ipcRenderer.invoke(IPC.AUTO_UPDATE_INSTALL),
    onStateChanged: (callback: (state: unknown) => void) => {
      const listener = (_event: unknown, state: unknown) => callback(state);
      ipcRenderer.on(IPC.AUTO_UPDATE_STATE_CHANGED, listener);
      return () => ipcRenderer.removeListener(IPC.AUTO_UPDATE_STATE_CHANGED, listener);
    },
  },

  images: {
    list: () => ipcRenderer.invoke(IPC.IMAGE_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC.IMAGE_GET, id),
    build: (config: unknown) => ipcRenderer.invoke(IPC.IMAGE_BUILD, config),
    rebuild: (id: string) => ipcRenderer.invoke(IPC.IMAGE_REBUILD, id),
    delete: (id: string) => ipcRenderer.invoke(IPC.IMAGE_DELETE, id),
    onBuildProgress: (callback: (line: string) => void) => {
      const listener = (_event: unknown, line: string) => callback(line);
      ipcRenderer.on(IPC.IMAGE_BUILD_PROGRESS, listener);
      // Return cleanup function
      return () => ipcRenderer.removeListener(IPC.IMAGE_BUILD_PROGRESS, listener);
    },
  },

  preValidation: {
    list: () => ipcRenderer.invoke(IPC.PRE_VALIDATION_LIST),
    get: (filename: string) => ipcRenderer.invoke(IPC.PRE_VALIDATION_GET, filename),
    add: (filename: string, content: string) =>
      ipcRenderer.invoke(IPC.PRE_VALIDATION_ADD, filename, content),
    remove: (filename: string) => ipcRenderer.invoke(IPC.PRE_VALIDATION_REMOVE, filename),
  },

  hooks: {
    list: () => ipcRenderer.invoke(IPC.HOOKS_LIST),
    get: (filename: string) => ipcRenderer.invoke(IPC.HOOKS_GET, filename),
    add: (filename: string, content: string) =>
      ipcRenderer.invoke(IPC.HOOKS_ADD, filename, content),
    remove: (filename: string) => ipcRenderer.invoke(IPC.HOOKS_REMOVE, filename),
  },

  loopScripts: {
    list: () => ipcRenderer.invoke(IPC.LOOP_SCRIPTS_LIST),
    get: (filename: string) => ipcRenderer.invoke(IPC.LOOP_SCRIPTS_GET, filename),
    add: (filename: string, content: string) =>
      ipcRenderer.invoke(IPC.LOOP_SCRIPTS_ADD, filename, content),
    remove: (filename: string) => ipcRenderer.invoke(IPC.LOOP_SCRIPTS_REMOVE, filename),
  },

  kiroHooks: {
    list: () => ipcRenderer.invoke(IPC.KIRO_HOOKS_LIST),
    get: (filename: string) => ipcRenderer.invoke(IPC.KIRO_HOOKS_GET, filename),
    add: (filename: string, content: string) =>
      ipcRenderer.invoke(IPC.KIRO_HOOKS_ADD, filename, content),
    remove: (filename: string) => ipcRenderer.invoke(IPC.KIRO_HOOKS_REMOVE, filename),
  },

  claudeSettings: {
    list: () => ipcRenderer.invoke(IPC.CLAUDE_SETTINGS_LIST),
    get: (filename: string) => ipcRenderer.invoke(IPC.CLAUDE_SETTINGS_GET, filename),
    add: (filename: string, content: string) =>
      ipcRenderer.invoke(IPC.CLAUDE_SETTINGS_ADD, filename, content),
    remove: (filename: string) => ipcRenderer.invoke(IPC.CLAUDE_SETTINGS_REMOVE, filename),
  },

  githubPat: {
    set: (projectId: string, pat: string) =>
      ipcRenderer.invoke(IPC.GITHUB_PAT_SET, projectId, pat),
    has: (projectId: string) => ipcRenderer.invoke(IPC.GITHUB_PAT_GET, projectId),
    delete: (projectId: string) => ipcRenderer.invoke(IPC.GITHUB_PAT_DELETE, projectId),
  },

  gitlabPat: {
    set: (projectId: string, pat: string) =>
      ipcRenderer.invoke(IPC.GITLAB_PAT_SET, projectId, pat),
    has: (projectId: string) => ipcRenderer.invoke(IPC.GITLAB_PAT_GET, projectId),
    delete: (projectId: string) => ipcRenderer.invoke(IPC.GITLAB_PAT_DELETE, projectId),
  },

  deployKeys: {
    listOrphaned: () => ipcRenderer.invoke(IPC.DEPLOY_KEYS_LIST_ORPHANED),
    getUrl: (repo: string, service?: 'github' | 'gitlab') =>
      ipcRenderer.invoke(IPC.DEPLOY_KEYS_GET_URL, repo, service),
    markCleaned: (keyId: number) =>
      ipcRenderer.invoke(IPC.DEPLOY_KEYS_MARK_CLEANED, keyId),
  },

  app: {
    onReady: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.once(IPC.APP_READY, listener);
      return () => ipcRenderer.removeListener(IPC.APP_READY, listener);
    },
  },

  shell: {
    openExternal: (url: string) => shell.openExternal(url),
  },

  vm: {
    /** Check Multipass availability and version */
    status: () => ipcRenderer.invoke(IPC.VM_STATUS),
    /** List all Multipass VMs */
    list: () => ipcRenderer.invoke(IPC.VM_LIST),
    /** Get detailed info for a specific VM by name */
    get: (name: string) => ipcRenderer.invoke(IPC.VM_GET, name),
    /** Start (or provision-then-start) the persistent VM for a project */
    start: (projectId: string, vmConfig?: unknown) => ipcRenderer.invoke(IPC.VM_START, projectId, vmConfig),
    /** Stop the persistent VM for a project */
    stop: (projectId: string) => ipcRenderer.invoke(IPC.VM_STOP, projectId),
    /** Delete a VM by name and purge it from disk */
    delete: (name: string) => ipcRenderer.invoke(IPC.VM_DELETE, name),

    // Event listeners
    /** Listen for VM status changes. Returns cleanup function. */
    onStatusChanged: (callback: (info: unknown) => void) => {
      const listener = (_event: unknown, info: unknown) => callback(info);
      ipcRenderer.on(IPC.VM_STATUS_CHANGED, listener);
      // Return cleanup function
      return () => ipcRenderer.removeListener(IPC.VM_STATUS_CHANGED, listener);
    },
  },
});
