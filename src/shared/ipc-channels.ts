// IPC channel name constants shared between main and renderer.
// All channel strings are defined here — never hard-code channel names elsewhere.

export const IPC = {
  // Project CRUD
  PROJECTS_LIST: 'projects:list',
  PROJECTS_GET: 'projects:get',
  PROJECTS_ADD: 'projects:add',
  PROJECTS_UPDATE: 'projects:update',
  PROJECTS_REMOVE: 'projects:remove',

  // App settings
  SETTINGS_LOAD: 'settings:load',
  SETTINGS_SAVE: 'settings:save',

  // Config import/export
  CONFIG_EXPORT: 'config:export',
  CONFIG_IMPORT: 'config:import',

  // Docker operations
  DOCKER_STATUS: 'docker:status',
  DOCKER_PULL_IMAGE: 'docker:pull-image',
  DOCKER_CREATE_CONTAINER: 'docker:create-container',
  DOCKER_START: 'docker:start',
  DOCKER_STOP: 'docker:stop',
  DOCKER_REMOVE: 'docker:remove',
  DOCKER_LIST_CONTAINERS: 'docker:list-containers',
  DOCKER_EXEC: 'docker:exec',
  DOCKER_CONTAINER_STATUS: 'docker:container-status',

  // Docker events (bidirectional)
  DOCKER_STATUS_CHANGED: 'docker:status-changed',
  DOCKER_PULL_PROGRESS: 'docker:pull-progress',

  // Misc
  PING: 'ping',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
