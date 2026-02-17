# 03 — Docker Service

## Overview
Port Docker integration to Node.js using `dockerode`. This covers container lifecycle,
log streaming, and health monitoring — all running in the main process.

---

### Task 1: Implement DockerManager — connection and image operations

**Context**: Port the connection check and image management parts of `docker_manager.py`.

**Changes**:
- Install `dockerode` and `@types/dockerode`
- `src/services/docker-manager.ts`:
  - Constructor: creates `Dockerode` instance (auto-detects socket)
  - `isDockerAvailable(): Promise<boolean>` — pings daemon
  - `getDockerInfo(): Promise<DockerInfo>` — returns version, containers, images
  - `isImageAvailable(image): Promise<boolean>`
  - `pullImage(image, onProgress?): Promise<void>` — streams pull progress via callback

**Acceptance**: Unit tests with mocked dockerode verify all methods. Integration test pings real Docker if available.

---

### Task 2: Implement DockerManager — container lifecycle

**Context**: Port container create/start/stop/remove/status operations.

**Changes**:
- Add to `src/services/docker-manager.ts`:
  - `createContainer(opts: ContainerCreateOpts): Promise<string>` — returns container ID
    - Applies `zephyr-managed=true` and `zephyr.project_id` labels
    - Configures volume mounts, env vars, working directory
  - `startContainer(id): Promise<void>`
  - `stopContainer(id, timeout?): Promise<void>`
  - `removeContainer(id, force?): Promise<void>`
  - `getContainerStatus(id): Promise<ContainerStatus>`
  - `listRunningContainers(): Promise<ContainerInfo[]>` — filters by `zephyr-managed` label
  - `getContainerCreated(id): Promise<string | null>` — creation timestamp

**Acceptance**: Unit tests cover create, start, stop, remove, status checks, label filtering.

---

### Task 3: Implement DockerManager — log streaming

**Context**: Port log streaming. In Node.js this is simpler — dockerode provides
native Node.js streams that can be piped or consumed with `on('data')`.

**Changes**:
- Add to `src/services/docker-manager.ts`:
  - `streamLogs(containerId, onLine): Promise<AbortController>` — attaches to container logs,
    calls `onLine(line)` for each log line, returns controller to stop streaming
  - Handles container exit gracefully (stream ends)
  - Supports `since` timestamp for resumed streaming

**Acceptance**: Unit tests with mock stream verify line-by-line callback delivery and abort.

---

### Task 4: Implement DockerManager — exec sessions

**Context**: Port exec functionality for terminal access. This is the critical path for
the user's primary workflow.

**Changes**:
- Add to `src/services/docker-manager.ts`:
  - `execCommand(containerId, cmd, opts?): Promise<ExecResult>` — run command, return stdout/stderr
  - `createExecSession(containerId, opts): Promise<ExecSession>` — create interactive PTY exec
    - Returns a duplex stream for stdin/stdout
    - Configurable: shell (bash/sh/zsh), user, env, working directory
    - PTY mode with rows/cols resize support
  - `resizeExec(execId, rows, cols): Promise<void>`

**Acceptance**: Unit tests verify exec creation, stream handling, resize.

---

### Task 5: Implement DockerHealthMonitor

**Context**: Port `docker_health.py` — periodic polling with state-change events.
In Electron, we use `setInterval` + IPC events instead of Qt signals.

**Changes**:
- `src/services/docker-health.ts`:
  - `DockerHealthMonitor` class:
    - `start(intervalMs?)`: Begins polling `isDockerAvailable()` on interval
    - `stop()`: Clears interval
    - `onStatusChange(callback)`: Register listener for connected/disconnected transitions
    - Only fires callback on state transitions (not every poll)
  - Emits events to renderer via `webContents.send()` so UI can react

**Acceptance**: Unit tests verify polling, state transition detection, callback invocation.

---

### Task 6: Wire Docker services to IPC

**Context**: Expose Docker operations to renderer.

**Changes**:
- `src/main/ipc-handlers/docker-handlers.ts`:
  - `docker:status` — returns availability + info
  - `docker:pull-image` — pulls with progress (uses `ipcMain.handle` + `webContents.send` for progress)
  - `docker:create-container`, `docker:start`, `docker:stop`, `docker:remove`
  - `docker:list-containers`
  - `docker:exec` — for non-interactive commands
- `src/main/preload.ts`: Add `window.api.docker.*` methods
- For log streaming and exec sessions, use `ipcMain.on`/`webContents.send` pattern
  (bidirectional streaming via IPC events, not request/response)

**Acceptance**: Renderer can check Docker status, list containers, and start/stop them via `window.api.docker.*`.
