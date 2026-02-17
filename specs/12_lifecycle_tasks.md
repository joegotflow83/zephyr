# 12 — App Lifecycle (Startup, Shutdown, Recovery)

## Overview
Port application entry point, cleanup manager, and graceful shutdown.

---

### Task 1: Implement CleanupManager

**Context**: Port `cleanup.py` — track and clean up Docker containers on exit.

**Changes**:
- `src/services/cleanup-manager.ts`:
  - `CleanupManager` class:
    - `registerContainer(id): void`
    - `unregisterContainer(id): void`
    - `cleanupAll(): Promise<void>` — stops and removes all tracked containers
    - `getTrackedContainers(): string[]`
  - Thread-safe (though less critical in Node.js single-threaded model)

**Acceptance**: Unit tests verify register, unregister, cleanup flow.

---

### Task 2: Implement main process entry point

**Context**: Port `main.py` — app creation, service wiring, startup sequence.

**Changes**:
- `src/main/index.ts`:
  - `createServices()`: Instantiate all services (DockerManager, LoopRunner, ProjectStore, etc.)
  - `registerIpcHandlers()`: Wire all IPC handler modules
  - `createWindow()`: Create BrowserWindow with proper security settings
  - `app.whenReady()` flow:
    1. Setup logging
    2. Create services
    3. Register IPC handlers
    4. Create window
    5. Recover loops (best-effort)
    6. Start Docker health monitor
  - `app.on('window-all-closed')`: Quit on non-macOS
  - `app.on('before-quit')`: Run cleanup manager

**Acceptance**: App starts, creates window, services are available via IPC.

---

### Task 3: Implement graceful shutdown

**Context**: Port `cleanup.py` signal handlers and `MainWindow.closeEvent`.

**Changes**:
- In `src/main/index.ts`:
  - `app.on('before-quit')`:
    - Stop all running loops gracefully
    - Stop Docker health monitor
    - Close all terminal sessions
    - Run cleanup manager (stop tracked containers)
    - Flush logs
  - Handle `process.on('SIGINT')` and `process.on('SIGTERM')`
  - Add confirmation dialog if loops are running: "X loops are still running. Quit anyway?"
- Window close vs. app quit distinction (macOS behavior)

**Acceptance**: Closing app stops containers and cleans up. Confirmation shown if loops running.

---

### Task 4: Implement loop recovery on startup

**Context**: Port the recovery logic from `main.py` — re-attach to surviving containers.

**Changes**:
- In `src/main/index.ts`, add `recoverLoops()` function:
  - Check Docker availability
  - List running containers with `zephyr-managed` label
  - Call `loopRunner.recoverLoops(containers)`
  - Register recovered containers with cleanup manager
  - Entire function in try/catch — recovery is best-effort, never blocks startup
  - Log recovered count

**Acceptance**: After force-quitting and reopening, running containers reappear in Loops tab.
