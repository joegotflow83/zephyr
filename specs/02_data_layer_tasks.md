# 02 — Data Layer (Config, Models, Storage)

## Overview
Port the Python config/data layer to TypeScript. All data services run in the main process
and are exposed to the renderer via IPC.

---

### Task 1: Define TypeScript data models

**Context**: Port `models.py` — `ProjectConfig` and `AppSettings`.

**Changes**:
- `src/shared/models.ts`:
  - `ProjectConfig` interface: id, name, repo_url, jtbd, docker_image, custom_prompts (Record<string, string>), created_at, updated_at
  - `AppSettings` interface: max_concurrent_containers, notification_enabled, theme, log_level
  - Helper functions: `createDefaultSettings()`, `createProjectConfig(partial)` with UUID generation and timestamps

**Acceptance**: Types compile, helper functions produce valid objects with defaults.
Unit tests verify defaults, UUID uniqueness, timestamp generation.

---

### Task 2: Implement ConfigManager service

**Context**: Port `config_manager.py` — manages `~/.zephyr/` config directory and JSON file I/O.

**Changes**:
- `src/services/config-manager.ts`:
  - `ensureConfigDir()`: Creates `~/.zephyr/` if missing (uses `fs.mkdir` recursive)
  - `loadJson<T>(filename)`: Read and parse JSON file, return `T | null`
  - `saveJson(filename, data)`: Atomic write (write to `.tmp`, rename)
  - `getConfigDir()`: Returns resolved config directory path
- Uses `electron.app.getPath('userData')` or `~/.zephyr/` for compatibility

**Acceptance**: Unit tests: creates dir, reads/writes JSON atomically, handles missing files gracefully.

---

### Task 3: Implement ProjectStore service

**Context**: Port `project_store.py` — CRUD operations for projects.

**Changes**:
- `src/services/project-store.ts`:
  - Constructor takes `ConfigManager`
  - `listProjects(): ProjectConfig[]`
  - `getProject(id): ProjectConfig | null`
  - `addProject(config): ProjectConfig` — assigns ID + timestamps, saves
  - `updateProject(id, partial): ProjectConfig` — merges changes, updates `updated_at`
  - `removeProject(id): boolean`
  - All operations read/write through ConfigManager (`projects.json`)

**Acceptance**: Unit tests cover CRUD, duplicate detection, not-found handling.

---

### Task 4: Implement import/export service

**Context**: Port `import_export.py` — zip-based backup/restore.

**Changes**:
- `src/services/import-export.ts`:
  - `exportConfig(outputPath)`: Creates zip of `projects.json`, `settings.json`, custom prompts
  - `importConfig(zipPath)`: Extracts zip to config directory
  - Uses `archiver` (for creating) and `adm-zip` or `extract-zip` (for reading)

**Acceptance**: Unit tests: round-trip export/import preserves all data.

---

### Task 5: Wire data services to IPC

**Context**: Expose ProjectStore and ConfigManager to renderer via IPC handlers.

**Changes**:
- `src/main/ipc-handlers/data-handlers.ts`:
  - Register `ipcMain.handle()` for each operation:
    - `projects:list`, `projects:get`, `projects:add`, `projects:update`, `projects:remove`
    - `settings:load`, `settings:save`
    - `config:export`, `config:import`
  - Each handler calls the corresponding service method
- Update `src/main/preload.ts` to expose typed wrapper functions
- Update `src/shared/ipc-channels.ts` with new channel constants

**Acceptance**: From renderer, `window.api.projects.list()` returns project array. Unit tests mock IPC and verify handler routing.
