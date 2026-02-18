# Zephyr Desktop -- Electron Rewrite Implementation Plan

**Date**: 2026-02-16
**Branch**: `electron-rewrite`
**Goal**: Rewrite Zephyr Desktop from Python/PyQt6 to Electron + React + TypeScript, delivering a native-quality desktop application with integrated terminal (xterm.js), Docker container orchestration, and AI loop execution management.

**Status**: Phase 1 complete. Phase 2 complete (2.1–2.5 done). Phase 3 Tasks 3.1–3.2 complete. Next: Phase 3.3 (DockerManager — log streaming).

## Environment Notes
- Node.js installed via NVM: `source /home/ralph/.nvm/nvm.sh && node --version`
- All npm commands require NVM sourcing first
- TypeScript upgraded to 5.3.x (4.5.x was incompatible with @types/node)
- Electron window cannot be launched in headless CI (no display); use `npm run test:unit` for validation

---

## Phase 1: Project Scaffold

> **Priority**: Highest. All subsequent phases depend on this foundation.
> **Spec**: `specs/01_project_scaffold_tasks.md`

- [x] **1.1** Initialize Electron Forge project with Vite + React + TypeScript template
  - Used `npm init electron-app@latest --template=vite-typescript` in /tmp, merged into root
  - Files: `package.json`, `forge.config.ts`, `tsconfig.json`, `vite.main.config.ts`, `vite.renderer.config.ts`
  - TypeScript upgraded to 5.3.x (4.5.x incompatible with @types/node)

- [x] **1.2** Configure Tailwind CSS v3
  - Installed `tailwindcss@3`, `postcss`, `autoprefixer`
  - Files: `tailwind.config.js`, `postcss.config.js`, `src/renderer/index.css`
  - CSS size jump from 0.15kB to 5.9kB confirms Tailwind active

- [x] **1.3** Set up project directory structure
  - Created: `src/main/`, `src/renderer/{components,pages,hooks,stores,types}/`, `src/services/`, `src/shared/`
  - Created: `tests/unit/`, `tests/e2e/`, `tests/integration/`
  - Path aliases in `tsconfig.json` and `vite.renderer.config.ts`

- [x] **1.4** Configure IPC bridge (preload + context bridge)
  - Files: `src/main/preload.ts`, `src/renderer/types/global.d.ts`
  - `contextIsolation: true`, `nodeIntegration: false` in BrowserWindow
  - ping handler: `ipcMain.handle('ping', () => 'pong')`
  - NOTE: `src/shared/ipc-channels.ts` and `src/shared/ipc-types.ts` deferred to Task 2.5

- [x] **1.5** Set up testing infrastructure (Vitest + Playwright)
  - Installed: `vitest@4`, `@vitest/ui`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`
  - Installed: `@playwright/test`, `electron-playwright-helpers` for Electron E2E support
  - Files: `vitest.config.ts`, `playwright.config.ts`, `tests/unit/setup.ts`, `tests/unit/app.test.tsx`, `tests/e2e/launch.test.ts`
  - npm scripts already configured: `test`, `test:unit`, `test:e2e`
  - E2E tests skip gracefully when no display is available (headless CI)
  - Acceptance: `npm run test:unit` passes (2/2 tests)

- [x] **1.6** Configure ESLint + Prettier
  - Installed `prettier@3.8.1`, `eslint-config-prettier@10.1.8` (eslint, @typescript-eslint/*, eslint-plugin-react, eslint-plugin-react-hooks already present)
  - Files: `.eslintrc.cjs`, `.prettierrc`
  - npm scripts `lint`, `lint:fix`, `format` were already in package.json
  - Acceptance: `npm run lint` passes with 0 errors/warnings

- [x] **1.7** Remove Python source files
  - Removed `src/lib/`, `src/ui/`, `src/main.py`, `src/__init__.py`, `src/__pycache__/`
  - Removed all Python test files from `tests/`
  - Removed `pyproject.toml`, `requirements.txt`, `launcher.py`
  - Removed `validate.sh` (Python CI), `zephyr.spec`, `scripts/` directory
  - Updated `.gitignore` (removed Python entries, kept Node entries)
  - Kept `specs/`, `resources/icon.png`, `resources/icon.icns`
  - Unit tests still pass (2/2): `npm run test:unit`

- [x] **1.8** Create `validate.sh` for Electron CI
  - File: `validate.sh` — sources NVM, runs `npm ci`, `npm run lint`, `npm run test:unit`
  - Exits non-zero on any failure; reports pass/fail counts
  - Acceptance: `bash validate.sh` — all 3 steps passed (3/0)

---

## Phase 2: Data Layer

> **Spec**: `specs/02_data_layer_tasks.md`
> **Dependency**: Phase 1 complete (scaffold, IPC bridge, testing)

- [x] **2.1** Define TypeScript data models
  - File: `src/shared/models.ts`
  - `ProjectConfig` interface: id, name, repo_url, jtbd, docker_image, custom_prompts, created_at, updated_at
  - `AppSettings` interface: max_concurrent_containers, notification_enabled, theme, log_level
  - Helper functions: `createDefaultSettings()`, `createProjectConfig(partial)` with UUID + timestamps
  - Tests: `tests/unit/models.test.ts` — 27 tests, all passing
  - Acceptance: Types compile, helpers produce valid objects ✓

- [x] **2.2** Implement ConfigManager service
  - File: `src/services/config-manager.ts`
  - Methods: `ensureConfigDir()`, `loadJson<T>(filename)`, `saveJson(filename, data)` (atomic write), `getConfigDir()`
  - Uses `~/.zephyr/` directory (injectable via constructor for testability)
  - Tests: `tests/unit/config-manager.test.ts` — 22 tests, all passing
  - Atomic write: write to `.tmp` then `fs.renameSync` (prevents corruption on crash)
  - Note: Use `vi.hoisted()` + `vi.resetAllMocks()` pattern for fs mocking in Vitest

- [x] **2.3** Implement ProjectStore service
  - File: `src/services/project-store.ts`
  - Constructor takes ConfigManager
  - Methods: `listProjects()`, `getProject(id)`, `addProject(config)`, `updateProject(id, partial)`, `removeProject(id)`
  - All operations through ConfigManager (`projects.json`)
  - Tests: `tests/unit/project-store.test.ts` — 32 tests, all passing
  - **Dependency**: Task 2.2
  - Acceptance: CRUD, duplicate detection, not-found handling tested ✓

- [x] **2.4** Implement import/export service
  - File: `src/services/import-export.ts`
  - Installed `archiver`, `adm-zip`, `@types/archiver`, `@types/adm-zip`
  - Methods: `exportConfig(outputPath)`, `importConfig(zipPath)`
  - Includes projects.json, settings.json, custom-prompts/*.json in zip
  - Path traversal prevention in importConfig
  - Tests: `tests/unit/import-export.test.ts` — 15 tests, all passing
  - **Note**: Test file uses `@vitest-environment node` (not jsdom) — adm-zip Buffer decompression is broken in jsdom environment
  - **Dependency**: Task 2.2
  - Acceptance: Round-trip export/import preserves all data ✓

- [x] **2.5** Wire data services to IPC handlers
  - File: `src/main/ipc-handlers/data-handlers.ts`
  - Register `ipcMain.handle()` for: `projects:list`, `projects:get`, `projects:add`, `projects:update`, `projects:remove`, `settings:load`, `settings:save`, `config:export`, `config:import`
  - Updated `src/main/preload.ts` with `window.api.projects.*`, `window.api.settings.*`, `window.api.config.*`
  - Created `src/shared/ipc-channels.ts` with all channel constants as `IPC.*`
  - Updated `src/renderer/types/global.d.ts` with full typed API surface
  - Updated `src/main/index.ts` to instantiate services and call `registerDataHandlers()`
  - Tests: `tests/unit/data-handlers.test.ts` — 16 tests, all passing
  - `config:export` and `config:import` use Electron `dialog` to show native file pickers
  - Acceptance: All 114 unit tests pass ✓

---

## Phase 3: Docker Services

> **Spec**: `specs/03_docker_service_tasks.md`
> **Dependency**: Phase 1 complete

- [x] **3.1** Implement DockerManager -- connection and image operations
  - Installed `dockerode`, `@types/dockerode` (already present)
  - File: `src/services/docker-manager.ts` — created with DockerInfo interface
  - Methods: `isDockerAvailable()`, `getDockerInfo()`, `isImageAvailable(image)`, `pullImage(image, onProgress?)`
  - Tests: `tests/unit/docker-manager-connection.test.ts` — 18 tests, all passing
  - Pull image supports progress tracking with layer aggregation
  - Acceptance: Unit tests with mocked dockerode verify all methods ✓

- [x] **3.2** Implement DockerManager -- container lifecycle
  - Add to `src/services/docker-manager.ts`
  - Methods: `createContainer(opts)`, `startContainer(id)`, `stopContainer(id)`, `removeContainer(id)`, `getContainerStatus(id)`, `listRunningContainers()`, `getContainerCreated(id)`
  - Applies `zephyr-managed=true` and `zephyr.project_id` labels
  - Tests: `tests/unit/docker-manager-lifecycle.test.ts`
  - **Dependency**: Task 3.1
  - Acceptance: Create, start, stop, remove, status, label filtering tested

- [ ] **3.3** Implement DockerManager -- log streaming
  - Add to `src/services/docker-manager.ts`
  - Method: `streamLogs(containerId, onLine)` returning AbortController
  - Supports `since` timestamp for resumed streaming
  - Tests: `tests/unit/docker-manager-logs.test.ts`
  - **Dependency**: Task 3.1
  - Acceptance: Line-by-line callback delivery and abort tested

- [ ] **3.4** Implement DockerManager -- exec sessions
  - Add to `src/services/docker-manager.ts`
  - Methods: `execCommand(containerId, cmd, opts?)`, `createExecSession(containerId, opts)` (PTY duplex stream), `resizeExec(execId, rows, cols)`
  - Tests: `tests/unit/docker-manager-exec.test.ts`
  - **Dependency**: Task 3.1
  - Acceptance: Exec creation, stream handling, resize tested

- [ ] **3.5** Implement DockerHealthMonitor service
  - File: `src/services/docker-health.ts`
  - Methods: `start(intervalMs?)`, `stop()`, `onStatusChange(callback)`
  - Only fires on state transitions
  - Emits events via `webContents.send()`
  - Tests: `tests/unit/docker-health.test.ts`
  - **Dependency**: Task 3.1
  - Acceptance: Polling, state transition detection, callback invocation tested

- [ ] **3.6** Wire Docker services to IPC handlers
  - File: `src/main/ipc-handlers/docker-handlers.ts`
  - Channels: `docker:status`, `docker:pull-image`, `docker:create-container`, `docker:start`, `docker:stop`, `docker:remove`, `docker:list-containers`, `docker:exec`
  - Log streaming and exec use `ipcMain.on`/`webContents.send` pattern (bidirectional)
  - Update preload with `window.api.docker.*`
  - Tests: `tests/unit/docker-handlers.test.ts`
  - **Dependency**: Tasks 3.1-3.5, Task 1.4
  - Acceptance: Renderer can check Docker status, list/start/stop containers

---

## Phase 4: Credential Management

> **Spec**: `specs/06_credential_tasks.md`
> **Dependency**: Phase 1 (IPC bridge)

- [ ] **4.1** Implement CredentialManager service
  - File: `src/services/credential-manager.ts`
  - Uses `electron.safeStorage` for encryption (or `keytar` fallback)
  - Methods: `storeApiKey(service, key)`, `getApiKey(service)`, `deleteApiKey(service)`, `listStoredServices()`
  - Maintains JSON index file for enumeration
  - Tests: `tests/unit/credential-manager.test.ts`
  - Acceptance: Store, retrieve, delete, list tested; encryption verified

- [ ] **4.2** Implement LoginManager service
  - File: `src/services/login-manager.ts`
  - Method: `openLoginSession(service)` -- opens BrowserWindow to service login URL
  - Captures session cookies/tokens, stores via CredentialManager
  - `LoginResult` type: `{ success, service, error? }`
  - No Playwright dependency -- Electron IS the browser
  - Tests: `tests/unit/login-manager.test.ts`
  - **Dependency**: Task 4.1
  - Acceptance: Mocked BrowserWindow flow tested; correct URLs per service

- [ ] **4.3** Wire credential services to IPC handlers
  - File: `src/main/ipc-handlers/credential-handlers.ts`
  - Channels: `credentials:store`, `credentials:get` (returns masked), `credentials:delete`, `credentials:list`, `credentials:login`
  - Update preload with `window.api.credentials.*`
  - Tests: `tests/unit/credential-handlers.test.ts`
  - **Dependency**: Tasks 4.1, 4.2, Task 1.4
  - Acceptance: Renderer can check stored credentials and trigger login

---

## Phase 5: Loop Execution Engine

> **Spec**: `specs/05_loop_execution_tasks.md`
> **Dependency**: Phase 3 (DockerManager), Phase 2 (models, ProjectStore)

- [ ] **5.1** Define loop execution types
  - File: `src/shared/loop-types.ts`
  - `LoopMode` enum: SINGLE, CONTINUOUS, SCHEDULED
  - `LoopStatus` enum: IDLE, STARTING, RUNNING, PAUSED, STOPPING, STOPPED, FAILED, COMPLETED
  - `LoopState` interface, `LoopStartOpts` interface
  - Tests: `tests/unit/loop-types.test.ts`
  - Acceptance: Types compile, importable from both main and renderer

- [ ] **5.2** Implement LogParser service
  - File: `src/services/log-parser.ts`
  - Method: `parseLine(line)` returns `ParsedLogLine` (type: commit/plan/error/info)
  - Method: `detectIteration(line)` extracts iteration number
  - Regex patterns for git commits, error traces, plan markers, iteration boundaries
  - Tests: `tests/unit/log-parser.test.ts` (port all 58+ test cases from Python)
  - Acceptance: All log line classifications match Python version

- [ ] **5.3** Implement LoopRunner service
  - File: `src/services/loop-runner.ts`
  - Constructor takes DockerManager, LogParser
  - Methods: `startLoop(opts)`, `stopLoop(projectId)`, `getLoopState(projectId)`, `listRunning()`, `onStateChange(cb)`, `onLogLine(cb)`
  - Tracks state in `Map<string, LoopState>`, enforces concurrency limit
  - Tests: `tests/unit/loop-runner.test.ts`
  - **Dependency**: Tasks 3.1-3.3, 5.1, 5.2
  - Acceptance: Start, stop, state tracking, concurrency, log streaming tested

- [ ] **5.4** Implement loop recovery
  - Add `recoverLoops(containers)` to `src/services/loop-runner.ts`
  - Re-registers running containers, resumes log streaming
  - Skips deleted projects and already-tracked IDs; respects concurrency
  - Tests: `tests/unit/loop-recovery.test.ts`
  - **Dependency**: Task 5.3
  - Acceptance: Recovery happy path, skip deleted, skip duplicates, concurrency limit tested

- [ ] **5.5** Implement Scheduler service
  - File: `src/services/scheduler.ts`
  - Method: `parseSchedule(expr)` for `"*/5 minutes"`, `"every 2 hours"`, `"daily 14:30"`
  - Class methods: `scheduleLoop(projectId, schedule)`, `cancelSchedule(projectId)`, `listScheduled()`, `isScheduled(projectId)`
  - Uses `setInterval`/`setTimeout`; calls `LoopRunner.startLoop()` on trigger
  - Tests: `tests/unit/scheduler.test.ts` (fake timers)
  - **Dependency**: Task 5.3
  - Acceptance: Schedule parsing, trigger firing, cancel, list tested

- [ ] **5.6** Implement AssetInjector service
  - File: `src/services/asset-injector.ts`
  - Method: `prepareInjectionDir(project)` creates temp dir with AGENTS.md, custom prompts
  - Method: `cleanup(dir)` removes temp directory
  - Priority resolution: project override > app default > built-in default
  - Tests: `tests/unit/asset-injector.test.ts`
  - Acceptance: Directory creation, file contents, priority resolution tested

- [ ] **5.7** Wire loop services to IPC handlers
  - File: `src/main/ipc-handlers/loop-handlers.ts`
  - Channels: `loop:start`, `loop:stop`, `loop:list`, `loop:get`, `loop:schedule`, `loop:cancel-schedule`
  - Outbound events: `loop:state-changed`, `loop:log-line` (via `webContents.send`)
  - Update preload with `window.api.loops.*`
  - Tests: `tests/unit/loop-handlers.test.ts`
  - **Dependency**: Tasks 5.1-5.6, Task 1.4
  - Acceptance: Renderer can start/stop loops and receive real-time updates

---

## Phase 6: UI Shell

> **Spec**: `specs/07_ui_shell_tasks.md`
> **Dependency**: Phase 1 (scaffold, Tailwind), Phase 2 (data services for state)

- [ ] **6.1** Implement app layout and tab navigation
  - Files: `src/renderer/App.tsx`, `src/renderer/components/TabBar/TabBar.tsx`, `src/renderer/components/Layout/Layout.tsx`
  - Tabs: Projects, Running Loops, Terminal, Settings
  - Keyboard shortcuts: Ctrl+1/2/3/4
  - Tests: `tests/unit/tab-bar.test.tsx`, `tests/unit/layout.test.tsx`
  - Acceptance: Tab switching works, keyboard shortcuts work, active tab visually distinct

- [ ] **6.2** Implement status bar
  - Files: `src/renderer/components/StatusBar/StatusBar.tsx`, `src/renderer/hooks/useDockerStatus.ts`
  - Docker indicator (green/red dot), version display, active loop count
  - Subscribes to `docker:status-changed` IPC events
  - Tests: `tests/unit/status-bar.test.tsx`
  - **Dependency**: Task 3.5 (DockerHealthMonitor for events)
  - Acceptance: Real-time Docker connection state shown

- [ ] **6.3** Implement menu bar
  - File: `src/main/menu.ts`
  - File menu: Import Config, Export Config, separator, Quit
  - Help menu: About Zephyr Desktop
  - Wire menu clicks to IPC handlers
  - Tests: `tests/unit/menu.test.ts`
  - **Dependency**: Task 2.5 (data IPC for import/export)
  - Acceptance: Menu items render, Import/Export open file dialogs, Quit closes app

- [ ] **6.4** Implement global state management (Zustand)
  - Install `zustand`
  - Files: `src/renderer/stores/app-store.ts`, `src/renderer/hooks/useProjects.ts`, `src/renderer/hooks/useLoops.ts`, `src/renderer/hooks/useSettings.ts`
  - Stores: projects list, loop states, app settings, Docker status
  - IPC event listeners update store automatically
  - Tests: `tests/unit/app-store.test.ts`
  - Acceptance: Components read/update global state; IPC events trigger updates

- [ ] **6.5** Implement notification toasts
  - Files: `src/renderer/components/Toast/Toast.tsx`, `src/renderer/hooks/useToast.ts`
  - Types: success, error, warning, info with auto-dismiss
  - OS-native Notification API for background notifications
  - Tests: `tests/unit/toast.test.tsx`
  - Acceptance: Toasts appear for events; native notifications work when backgrounded

---

## Phase 7: Projects UI

> **Spec**: `specs/08_projects_ui_tasks.md`
> **Dependency**: Phase 6 (layout, state), Phase 2 (data IPC)

- [ ] **7.1** Implement ProjectsTab page component
  - Files: `src/renderer/pages/ProjectsTab/ProjectsTab.tsx`, `src/renderer/pages/ProjectsTab/ProjectRow.tsx`
  - Add Project button, table with Name/Repo URL/Docker Image/Status/Actions columns
  - Empty state with CTA
  - Uses `useProjects()` hook
  - Tests: `tests/unit/projects-tab.test.tsx`
  - Acceptance: Projects display, buttons trigger callbacks, empty state renders

- [ ] **7.2** Implement ProjectDialog modal
  - Files: `src/renderer/components/ProjectDialog/ProjectDialog.tsx`, `src/renderer/components/ProjectDialog/PromptEditor.tsx`
  - Fields: Name, Repo URL, JTBD, Docker Image
  - Modes: add (empty) / edit (pre-populated)
  - Validation: Name required, Repo URL format check
  - Custom prompt editor sub-component
  - Tests: `tests/unit/project-dialog.test.tsx`
  - Acceptance: Add/edit/prompt management works; validation prevents empty names

- [ ] **7.3** Implement ConfirmDialog (reusable)
  - File: `src/renderer/components/ConfirmDialog/ConfirmDialog.tsx`
  - Props: title, message, confirmLabel, variant (danger/default), onConfirm, onCancel
  - Tests: `tests/unit/confirm-dialog.test.tsx`
  - Acceptance: Confirm calls onConfirm, cancel calls onCancel, danger variant styles red

- [ ] **7.4** Wire project actions to services and toasts
  - Integrate in ProjectsTab: Add -> ProjectDialog -> `window.api.projects.add()`, Edit -> `window.api.projects.update()`, Delete -> ConfirmDialog -> `window.api.projects.remove()`, Run -> `window.api.loops.start()` + switch to Loops tab
  - Loading states, error handling, toast feedback
  - Tests: `tests/unit/projects-tab-actions.test.tsx`
  - **Dependency**: Tasks 7.1-7.3, 2.5, 5.7, 6.5
  - Acceptance: Full CRUD flow works end-to-end with toast feedback

---

## Phase 8: Loops UI

> **Spec**: `specs/09_loops_ui_tasks.md`
> **Dependency**: Phase 6 (layout, state), Phase 5 (loop IPC)

- [ ] **8.1** Implement LoopsTab page component
  - Files: `src/renderer/pages/LoopsTab/LoopsTab.tsx`, `src/renderer/pages/LoopsTab/LoopRow.tsx`
  - Split layout: upper table + lower log viewer (resizable)
  - Table: Project Name, Status (badge), Mode, Iteration, Started, Actions (Stop/Start)
  - Row selection shows logs in lower panel
  - Status badges: running=green, starting=blue, failed=red, completed=gray, stopping=yellow
  - Tests: `tests/unit/loops-tab.test.tsx`
  - Acceptance: Loop table displays, status badges correct, row selection works

- [ ] **8.2** Implement LogViewer component
  - File: `src/renderer/components/LogViewer/LogViewer.tsx`
  - Install `@tanstack/react-virtual` for virtualized scrolling
  - Auto-scroll with scroll-lock toggle
  - Syntax highlighting: commits=green, errors=red, plans=blue, info=gray
  - Line timestamps, search/filter (Ctrl+F), clear button
  - Tests: `tests/unit/log-viewer.test.tsx`
  - Acceptance: Handles 10k+ lines without lag, auto-scroll works, color coding applied

- [ ] **8.3** Implement log export functionality
  - File: `src/services/log-exporter.ts` (main process)
  - Methods: `exportLoopLog(projectId, outputPath)`, `exportAllLogs(outputPath)` (zip)
  - IPC handlers: `logs:export`, `logs:export-all`
  - Export buttons in LoopsTab toolbar using `dialog.showSaveDialog()`
  - Tests: `tests/unit/log-exporter.test.ts`
  - **Dependency**: Task 5.7
  - Acceptance: Single and bulk log export with correct formatting

- [ ] **8.4** Implement real-time log streaming hook
  - File: `src/renderer/hooks/useLogStream.ts`
  - Subscribes to `loop:log-line` IPC events
  - Buffers lines per project ID
  - Returns `{ lines, clearLines }` for selected project
  - Performance: batch DOM updates with `requestAnimationFrame`
  - Tests: `tests/unit/use-log-stream.test.ts`
  - **Dependency**: Task 5.7
  - Acceptance: Real-time log lines appear, no dropped lines, no UI jank

---

## Phase 9: Terminal Feature

> **Spec**: `specs/04_terminal_tasks.md`
> **Dependency**: Phase 3 (Docker exec sessions), Phase 6 (layout)

- [ ] **9.1** Set up xterm.js Terminal React component
  - Install `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `@xterm/addon-search`
  - Files: `src/renderer/components/Terminal/Terminal.tsx`, `src/renderer/components/Terminal/terminal.css`
  - Props: `onData(data)`, `onResize(cols, rows)`, `fontSize`, `theme`
  - Exposes `write(data)` and `clear()` via `useImperativeHandle`
  - FitAddon for auto-resize, WebLinksAddon for clickable URLs
  - Tests: `tests/unit/terminal-component.test.tsx`
  - Acceptance: Terminal renders, accepts keyboard input, displays output

- [ ] **9.2** Implement TerminalManager service (main process)
  - File: `src/services/terminal-manager.ts`
  - Methods: `openSession(containerId, opts?)`, `closeSession(sessionId)`, `writeToSession(sessionId, data)`, `resizeSession(sessionId, cols, rows)`, `listSessions()`
  - `TerminalSession` type: `{ id, containerId, user, createdAt }`
  - Forwards exec stdout to renderer via `webContents.send('terminal:data', sessionId, data)`
  - Tests: `tests/unit/terminal-manager.test.ts`
  - **Dependency**: Task 3.4 (Docker exec sessions)
  - Acceptance: Session open/close/write/resize lifecycle tested

- [ ] **9.3** Wire terminal IPC channels
  - File: `src/main/ipc-handlers/terminal-handlers.ts`
  - Channels: `terminal:open`, `terminal:close`, `terminal:write` (fire-and-forget via `ipcMain.on`), `terminal:resize`
  - Outbound: `terminal:data` (exec output to renderer)
  - Update preload with `window.api.terminal.*`
  - `terminal:write` uses `ipcRenderer.send` (not `invoke`) for performance
  - Tests: `tests/unit/terminal-handlers.test.ts`
  - **Dependency**: Tasks 9.2, 1.4
  - Acceptance: Data flows keyboard -> IPC -> Docker exec stdin -> stdout -> IPC -> renderer

- [ ] **9.4** Build TerminalTab page component
  - Files: `src/renderer/pages/TerminalTab/TerminalTab.tsx`, `src/renderer/pages/TerminalTab/TerminalSession.tsx`
  - Container selector dropdown, user selector (root/default), "Open Terminal" button
  - Tabbed interface for multiple concurrent sessions with close buttons
  - Session indicator (container name, user, connected status)
  - TerminalSession wrapper: connects Terminal component to IPC (open, subscribe data, write, resize, close)
  - Tests: `tests/unit/terminal-tab.test.tsx`
  - **Dependency**: Tasks 9.1, 9.3, 3.6
  - Acceptance: Open terminal to container, type commands, see output, resize, close; multiple tabs

- [ ] **9.5** Terminal UX polish
  - Search addon integration (Ctrl+Shift+F)
  - Copy/paste (Ctrl+Shift+C/V, right-click context menu)
  - Font size adjustment (Ctrl+=/Ctrl+-)
  - Theme switching (dark/light, synced with app theme)
  - Reconnection handling: detect dead session, show "Reconnect" button
  - Tests: `tests/unit/terminal-ux.test.tsx`
  - **Dependency**: Task 9.4
  - Acceptance: Search, copy/paste, font sizing, theme switching all work

---

## Phase 10: Settings UI

> **Spec**: `specs/10_settings_ui_tasks.md`
> **Dependency**: Phase 6 (layout, state), Phase 4 (credential IPC), Phase 3 (Docker IPC)

- [ ] **10.1** Implement SettingsTab page component
  - File: `src/renderer/pages/SettingsTab/SettingsTab.tsx`
  - Scrollable page with collapsible card sections: Credentials, Docker, General, Updates
  - Uses `useSettings()` hook, auto-saves on change (debounced)
  - Tests: `tests/unit/settings-tab.test.tsx`
  - Acceptance: All sections render, settings load from store on mount

- [ ] **10.2** Implement credentials section
  - Files: `src/renderer/pages/SettingsTab/CredentialsSection.tsx`, `src/renderer/components/CredentialDialog/CredentialDialog.tsx`
  - Per-service rows: Anthropic, OpenAI, GitHub with status and "Update Key" button
  - "Use Login Mode" toggle per service
  - CredentialDialog: password-masked input, login mode toggle, Save/Cancel
  - Tests: `tests/unit/credentials-section.test.tsx`
  - **Dependency**: Task 4.3
  - Acceptance: Update API keys, see stored status, toggle login mode

- [ ] **10.3** Implement Docker and general settings sections
  - Files: `src/renderer/pages/SettingsTab/DockerSection.tsx`, `src/renderer/pages/SettingsTab/GeneralSection.tsx`
  - Docker: connection status indicator, max concurrent containers spinner, Docker info
  - General: notifications toggle, log level dropdown, theme toggle, app version
  - Changes call `window.api.settings.save()` with debounce
  - Tests: `tests/unit/docker-section.test.tsx`, `tests/unit/general-section.test.tsx`
  - **Dependency**: Tasks 3.6, 2.5
  - Acceptance: Settings save and persist across restarts; Docker status real-time

- [ ] **10.4** Implement updates section
  - File: `src/renderer/pages/SettingsTab/UpdatesSection.tsx`
  - "Check for Updates" button, current vs. available version display
  - "Update App" button with progress/status display
  - Wire to `window.api.updates.check()` and `window.api.updates.apply()`
  - Tests: `tests/unit/updates-section.test.tsx`
  - **Dependency**: Task 11.3 (SelfUpdater)
  - Acceptance: Can check for and trigger updates with status display

---

## Phase 11: Monitoring and Utilities

> **Spec**: `specs/11_monitoring_tasks.md`
> **Dependency**: Phase 1 (scaffold)

- [ ] **11.1** Implement DiskChecker service
  - File: `src/services/disk-checker.ts`
  - Install `check-disk-space`
  - Methods: `getAvailableSpace(path)`, `checkRepoSize(path)`, `warnIfLow(path, thresholdBytes?)`
  - Tests: `tests/unit/disk-checker.test.ts`
  - Acceptance: Space checking, size calculation, warning threshold tested

- [ ] **11.2** Implement GitManager service
  - Install `simple-git`
  - File: `src/services/git-manager.ts`
  - Methods: `cloneRepo(url, dest, onProgress?)`, `validateRepo(path)`, `getRepoInfo(path)`, `getRecentCommits(path, count?)`
  - Types: `RepoInfo`, `Commit`
  - Tests: `tests/unit/git-manager.test.ts`
  - Acceptance: All operations tested with mocked simple-git

- [ ] **11.3** Implement SelfUpdater service
  - File: `src/services/self-updater.ts`
  - Methods: `checkForUpdates()`, `startSelfUpdate()` (uses reserved project ID `"zephyr-self-update"`)
  - Type: `UpdateInfo { available, currentVersion, latestVersion, changelog? }`
  - Wire to IPC: `updates:check`, `updates:apply`
  - Tests: `tests/unit/self-updater.test.ts`
  - **Dependency**: Task 11.2 (GitManager for version comparison)
  - Acceptance: Update check logic and trigger tested

- [ ] **11.4** Implement logging configuration
  - Install `electron-log` (or `winston`)
  - File: `src/services/logging.ts`
  - `setupLogging(level, logDir)`: file transport with rotation (10 MB, 5 backups), console with colors
  - `getLogger(subsystem)`: subsystem loggers for docker, loop, terminal, ui
  - Log level changeable at runtime from settings
  - Tests: `tests/unit/logging.test.ts`
  - Acceptance: Logs written to file with rotation; level configurable

---

## Phase 12: App Lifecycle and Shutdown

> **Spec**: `specs/12_lifecycle_tasks.md`
> **Dependency**: Phases 3, 5 (Docker + Loop services)

- [ ] **12.1** Implement CleanupManager
  - File: `src/services/cleanup-manager.ts`
  - Methods: `registerContainer(id)`, `unregisterContainer(id)`, `cleanupAll()`, `getTrackedContainers()`
  - Tests: `tests/unit/cleanup-manager.test.ts`
  - Acceptance: Register, unregister, cleanup flow tested

- [ ] **12.2** Implement main process entry point
  - File: `src/main/index.ts` (finalize)
  - `createServices()`: instantiate all services
  - `registerIpcHandlers()`: wire all handler modules
  - `createWindow()`: BrowserWindow with security settings
  - `app.whenReady()` flow: setup logging -> create services -> register IPC -> create window -> recover loops -> start health monitor
  - `app.on('window-all-closed')`: quit on non-macOS
  - Tests: `tests/unit/main-entry.test.ts`
  - **Dependency**: All service phases (2-5, 11)
  - Acceptance: App starts, creates window, all services available via IPC

- [ ] **12.3** Implement graceful shutdown
  - Add to `src/main/index.ts`:
  - `app.on('before-quit')`: stop loops, stop health monitor, close terminal sessions, run cleanup manager, flush logs
  - Handle `process.on('SIGINT')` and `process.on('SIGTERM')`
  - Confirmation dialog if loops running: "X loops are still running. Quit anyway?"
  - macOS window-close vs. app-quit distinction
  - Tests: `tests/unit/graceful-shutdown.test.ts`
  - **Dependency**: Tasks 12.1, 12.2
  - Acceptance: Closing stops containers, cleanup runs, confirmation shown if loops active

- [ ] **12.4** Implement loop recovery on startup
  - Add `recoverLoops()` to `src/main/index.ts`
  - Check Docker availability, list `zephyr-managed` containers, call `loopRunner.recoverLoops()`, register with cleanup manager
  - Entire function in try/catch (best-effort, never blocks startup)
  - Tests: `tests/unit/loop-recovery-startup.test.ts`
  - **Dependency**: Tasks 5.4, 12.1, 12.2
  - Acceptance: After force-quit and reopen, running containers reappear in Loops tab

---

## Phase 13: Packaging and Distribution

> **Spec**: `specs/13_packaging_tasks.md`
> **Dependency**: Phase 12 (app entry point working)

- [ ] **13.1** Configure Electron Forge makers
  - Update `forge.config.ts`:
  - macOS: `@electron-forge/maker-dmg`, `@electron-forge/maker-zip`
  - Windows: `@electron-forge/maker-squirrel`
  - Linux: `@electron-forge/maker-deb`, `@electron-forge/maker-rpm`
  - Install required maker packages
  - Configure app metadata: name, description, author, license
  - Acceptance: `npm run make` produces platform-appropriate installer/bundle

- [ ] **13.2** Configure app icons
  - Keep existing `resources/icon.png` as source
  - Generate `resources/icon.icns` (macOS), `resources/icon.ico` (Windows)
  - Install `electron-icon-builder` or `png2icons`
  - Add `npm run generate-icons` script
  - Reference icons in `forge.config.ts`
  - Acceptance: Built app shows correct icon on all platforms

- [ ] **13.3** Configure auto-update support
  - Install `electron-updater`
  - File: `src/services/auto-updater.ts`
  - Check for updates on startup (after delay), notify user, download/install with confirmation
  - Uses GitHub Releases as update source
  - Configure `forge.config.ts` with publisher settings
  - Wire to Settings tab update section
  - Tests: `tests/unit/auto-updater.test.ts`
  - **Dependency**: Task 10.4
  - Acceptance: App detects and installs updates from GitHub Releases

- [ ] **13.4** Create build scripts and CI configuration
  - File: `scripts/build.sh` -- runs `npm ci`, `npm run lint`, `npm test`, `npm run make`
  - Platform detection for correct maker
  - File: `.github/workflows/build.yml` (template) -- matrix build (macOS/Windows/Linux), test, build, upload artifacts
  - File: `scripts/notarize.js` (macOS Apple notarization hook)
  - Acceptance: `bash scripts/build.sh` produces distributable artifacts

---

## Phase 14: Integration and E2E Testing

> **Spec**: `specs/14_integration_testing_tasks.md`
> **Dependency**: All previous phases

- [ ] **14.1** Service integration tests -- project workflow
  - File: `tests/integration/project-workflow.test.ts`
  - Uses real ConfigManager + ProjectStore with temp directories
  - Tests: create, list, update, delete, persistence across restart, import/export round-trip
  - Verify JSON file contents on disk
  - **Dependency**: Phase 2
  - Acceptance: Tests pass with real filesystem I/O (temp dirs, cleaned up after)

- [ ] **14.2** Loop execution integration tests
  - File: `tests/integration/loop-workflow.test.ts`
  - Uses mocked DockerManager (no real Docker)
  - Tests: start loop -> state changes -> log lines -> stop -> STOPPED state
  - Recovery flow, scheduler integration, concurrency limit
  - **Dependency**: Phase 5
  - Acceptance: Full loop lifecycle tested without Docker dependency

- [ ] **14.3** E2E tests with Playwright -- app UI
  - File: `tests/e2e/app.test.ts`
  - Launch Electron with Playwright's `_electron.launch()`
  - Tests: window opens, tab navigation, add project via dialog, settings persistence, status bar
  - **Dependency**: Phases 6-10
  - Acceptance: E2E tests interact with real Electron UI and verify user flows

- [ ] **14.4** Terminal E2E tests (requires Docker)
  - File: `tests/e2e/terminal.test.ts`
  - Skip if Docker unavailable
  - Tests: create container, open terminal, type command (`echo hello`), verify output, resize, close, multiple sessions
  - **Dependency**: Phase 9
  - Acceptance: Terminal interaction works end-to-end with real Docker container

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1     | 8     | Project scaffold (Electron Forge + Vite + React + TypeScript) |
| 2     | 5     | Data layer (models, config, project store, import/export, IPC) |
| 3     | 6     | Docker services (connection, lifecycle, logs, exec, health, IPC) |
| 4     | 3     | Credential management (storage, login, IPC) |
| 5     | 7     | Loop execution engine (types, parser, runner, recovery, scheduler, assets, IPC) |
| 6     | 5     | UI shell (layout, status bar, menu, state, toasts) |
| 7     | 4     | Projects UI (table, dialog, confirm, wiring) |
| 8     | 4     | Loops UI (table, log viewer, export, streaming) |
| 9     | 5     | Terminal (xterm.js, manager, IPC, tab, polish) |
| 10    | 4     | Settings UI (layout, credentials, Docker/general, updates) |
| 11    | 4     | Monitoring and utilities (disk, git, updater, logging) |
| 12    | 4     | App lifecycle (cleanup, entry point, shutdown, recovery) |
| 13    | 4     | Packaging and distribution (makers, icons, auto-update, CI) |
| 14    | 4     | Integration and E2E testing |
| **Total** | **67** | |

## Dependency Graph (phase level)

```
Phase 1 (Scaffold)
  ├── Phase 2 (Data Layer)
  │     └── Phase 7 (Projects UI) ──┐
  ├── Phase 3 (Docker Services)     │
  │     ├── Phase 5 (Loop Engine) ──┼── Phase 8 (Loops UI)
  │     └── Phase 9 (Terminal)      │
  ├── Phase 4 (Credentials)        │
  ├── Phase 6 (UI Shell) ──────────┤
  │     ├── Phase 7 (Projects UI)   │
  │     ├── Phase 8 (Loops UI)      │
  │     ├── Phase 9 (Terminal)      │
  │     └── Phase 10 (Settings UI)  │
  ├── Phase 11 (Monitoring)         │
  └── Phase 12 (Lifecycle) ← all services
        └── Phase 13 (Packaging)
              └── Phase 14 (Testing) ← everything
```

## Recommended Execution Order

Phases can be parallelized where dependencies allow:

1. **Phase 1** (scaffold) -- must be first
2. **Phase 2 + Phase 3 + Phase 4 + Phase 11** (services, in parallel after Phase 1)
3. **Phase 5** (depends on Phase 3)
4. **Phase 6** (UI shell, can start after Phase 1, ideally after Phase 2)
5. **Phase 7 + Phase 8 + Phase 9 + Phase 10** (UI pages, in parallel after Phase 6)
6. **Phase 12** (lifecycle, after all services)
7. **Phase 13** (packaging, after Phase 12)
8. **Phase 14** (integration tests, after everything)

## Critical Files for Reference (Python Implementation)

> **NOTE**: Python files were removed in Task 1.7. Reference logic was in:
> - `docker_manager.py` — Docker container lifecycle, log streaming, exec sessions
> - `loop_runner.py` — Loop state machine, concurrency, recovery
> - `log_parser.py` — Log line classification regex patterns
> - `scheduler.py` — Schedule expression parsing and triggering
> - `credential_manager.py` — Keyring-based credential storage patterns
> - `asset_injector.py` — Asset priority resolution logic
> - `config_manager.py` — Atomic JSON file operations
> - `cleanup.py` — Container tracking and cleanup patterns
>
> Use `git show cbe143e:src/lib/<file>.py` to view any file from the last Python commit (cbe143e).
