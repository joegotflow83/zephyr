# 11 — Monitoring & Utilities

## Overview
Port disk checker, git manager, and self-updater services to TypeScript.

---

### Task 1: Implement DiskChecker service

**Context**: Port `disk_checker.py` — check available disk space.

**Changes**:
- `src/services/disk-checker.ts`:
  - `DiskChecker` class:
    - `getAvailableSpace(path): Promise<number>` — returns free bytes (uses `check-disk-space` npm package or `fs.statfs`)
    - `checkRepoSize(path): Promise<number>` — recursively sums directory size
    - `warnIfLow(path, thresholdBytes?): Promise<string | null>` — returns warning message if below threshold
- Install `check-disk-space` package

**Acceptance**: Unit tests verify space checking, size calculation, warning threshold.

---

### Task 2: Implement GitManager service

**Context**: Port `git_manager.py` — git operations. Use `simple-git` npm package.

**Changes**:
- Install `simple-git`
- `src/services/git-manager.ts`:
  - `GitManager` class:
    - `cloneRepo(url, dest, onProgress?): Promise<void>`
    - `validateRepo(path): Promise<boolean>`
    - `getRepoInfo(path): Promise<RepoInfo>` — remote URL, current branch, dirty status
    - `getRecentCommits(path, count?): Promise<Commit[]>`
  - `RepoInfo` and `Commit` type definitions

**Acceptance**: Unit tests with mocked simple-git verify all operations.

---

### Task 3: Implement SelfUpdater service

**Context**: Port `self_updater.py` — check for and apply updates.

**Changes**:
- `src/services/self-updater.ts`:
  - `SelfUpdater` class:
    - `checkForUpdates(): Promise<UpdateInfo>` — git fetch + compare HEAD with remote
    - `startSelfUpdate(): Promise<void>` — triggers update loop on app's own repo
    - Uses reserved project ID: `"zephyr-self-update"`
  - `UpdateInfo` type: { available, currentVersion, latestVersion, changelog? }
- Wire to IPC: `updates:check`, `updates:apply`

**Acceptance**: Unit tests verify update check logic and update trigger.

---

### Task 4: Implement logging configuration

**Context**: Port `logging_config.py` — structured logging for main process.

**Changes**:
- Install `winston` or `electron-log`
- `src/services/logging.ts`:
  - `setupLogging(level, logDir)`: Configures logger with:
    - File transport with rotation (10 MB, 5 backups)
    - Console transport with colors
    - Subsystem loggers: docker, loop, terminal, ui
  - `getLogger(subsystem): Logger`
  - Log level changeable at runtime (from settings)
- Wire into all services (replace `console.log` with structured logger)

**Acceptance**: Logs written to file with rotation. Log level configurable from settings tab.
