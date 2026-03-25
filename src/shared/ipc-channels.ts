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

  // Container runtime operations (Docker or Podman)
  RUNTIME_STATUS: 'runtime:status',
  RUNTIME_PULL_IMAGE: 'runtime:pull-image',
  RUNTIME_CREATE_CONTAINER: 'runtime:create-container',
  RUNTIME_START: 'runtime:start',
  RUNTIME_STOP: 'runtime:stop',
  RUNTIME_REMOVE: 'runtime:remove',
  RUNTIME_LIST_CONTAINERS: 'runtime:list-containers',
  RUNTIME_EXEC: 'runtime:exec',
  RUNTIME_CONTAINER_STATUS: 'runtime:container-status',

  // Container runtime events (bidirectional)
  RUNTIME_STATUS_CHANGED: 'runtime:status-changed',
  RUNTIME_PULL_PROGRESS: 'runtime:pull-progress',

  // Credentials
  CREDENTIALS_STORE: 'credentials:store',
  CREDENTIALS_GET: 'credentials:get',
  CREDENTIALS_DELETE: 'credentials:delete',
  CREDENTIALS_LIST: 'credentials:list',
  CREDENTIALS_LOGIN: 'credentials:login',
  CREDENTIALS_CHECK_AUTH: 'credentials:check-auth',

  // Loop execution
  LOOP_START: 'loop:start',
  LOOP_STOP: 'loop:stop',
  LOOP_LIST: 'loop:list',
  LOOP_GET: 'loop:get',
  LOOP_REMOVE: 'loop:remove',
  LOOP_SCHEDULE: 'loop:schedule',
  LOOP_CANCEL_SCHEDULE: 'loop:cancel-schedule',
  LOOP_LIST_SCHEDULED: 'loop:list-scheduled',

  // Loop events (outbound from main to renderer)
  LOOP_STATE_CHANGED: 'loop:state-changed',
  LOOP_LOG_LINE: 'loop:log-line',

  // Factory (multi-container coding factory)
  FACTORY_START: 'factory:start',
  FACTORY_STOP: 'factory:stop',

  // Log export
  LOGS_EXPORT: 'logs:export',
  LOGS_EXPORT_ALL: 'logs:export-all',

  // Terminal operations
  TERMINAL_OPEN: 'terminal:open',
  TERMINAL_OPEN_VM: 'terminal:open-vm',
  TERMINAL_CLOSE: 'terminal:close',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',

  // Terminal events (outbound from main to renderer)
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_CLOSED: 'terminal:closed',
  TERMINAL_ERROR: 'terminal:error',

  // Updates (self-updater)
  UPDATES_CHECK: 'updates:check',
  UPDATES_APPLY: 'updates:apply',

  // Auto-update
  AUTO_UPDATE_GET_STATE: 'auto-update:get-state',
  AUTO_UPDATE_CHECK: 'auto-update:check',
  AUTO_UPDATE_DOWNLOAD: 'auto-update:download',
  AUTO_UPDATE_INSTALL: 'auto-update:install',
  AUTO_UPDATE_STATE_CHANGED: 'auto-update:state-changed',
  AUTO_UPDATE_DOWNLOAD_PROGRESS: 'auto-update:download-progress',

  // Image library
  IMAGE_LIST: 'image:list',
  IMAGE_GET: 'image:get',
  IMAGE_BUILD: 'image:build',
  IMAGE_REBUILD: 'image:rebuild',
  IMAGE_DELETE: 'image:delete',
  IMAGE_BUILD_PROGRESS: 'image:build-progress',

  // Pre-validation scripts
  PRE_VALIDATION_LIST: 'pre-validation:list',
  PRE_VALIDATION_GET: 'pre-validation:get',
  PRE_VALIDATION_ADD: 'pre-validation:add',
  PRE_VALIDATION_REMOVE: 'pre-validation:remove',

  // Claude hooks
  HOOKS_LIST: 'hooks:list',
  HOOKS_GET: 'hooks:get',
  HOOKS_ADD: 'hooks:add',
  HOOKS_REMOVE: 'hooks:remove',

  // Loop scripts
  LOOP_SCRIPTS_LIST: 'loop-scripts:list',
  LOOP_SCRIPTS_GET: 'loop-scripts:get',
  LOOP_SCRIPTS_ADD: 'loop-scripts:add',
  LOOP_SCRIPTS_REMOVE: 'loop-scripts:remove',

  // Kiro hooks
  KIRO_HOOKS_LIST: 'kiro-hooks:list',
  KIRO_HOOKS_GET: 'kiro-hooks:get',
  KIRO_HOOKS_ADD: 'kiro-hooks:add',
  KIRO_HOOKS_REMOVE: 'kiro-hooks:remove',

  // Claude settings.json files
  CLAUDE_SETTINGS_LIST: 'claude-settings:list',
  CLAUDE_SETTINGS_GET: 'claude-settings:get',
  CLAUDE_SETTINGS_ADD: 'claude-settings:add',
  CLAUDE_SETTINGS_REMOVE: 'claude-settings:remove',

  // Deploy keys (ephemeral GitHub SSH deploy keys for container access)
  DEPLOY_KEYS_LIST_ORPHANED: 'deploy-keys:list-orphaned',
  DEPLOY_KEYS_GET_URL: 'deploy-keys:get-url',
  DEPLOY_KEYS_MARK_CLEANED: 'deploy-keys:mark-cleaned',

  // GitHub PAT storage per project (for deploy key management)
  GITHUB_PAT_SET: 'github-pat:set',
  GITHUB_PAT_GET: 'github-pat:get',
  GITHUB_PAT_DELETE: 'github-pat:delete',

  // GitLab PAT storage per project (for deploy key management)
  GITLAB_PAT_SET: 'gitlab-pat:set',
  GITLAB_PAT_GET: 'gitlab-pat:get',
  GITLAB_PAT_DELETE: 'gitlab-pat:delete',

  // VM management
  VM_STATUS: 'vm:status',
  VM_LIST: 'vm:list',
  VM_GET: 'vm:get',
  VM_START: 'vm:start',
  VM_STOP: 'vm:stop',
  VM_DELETE: 'vm:delete',

  // VM events (main → renderer)
  VM_STATUS_CHANGED: 'vm:status-changed',

  // App lifecycle events (main → renderer)
  APP_READY: 'app:ready',

  // Misc
  PING: 'ping',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
