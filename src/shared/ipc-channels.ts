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

  // Misc
  PING: 'ping',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
