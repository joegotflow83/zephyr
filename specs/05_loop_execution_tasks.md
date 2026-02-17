# 05 — Loop Execution Engine

## Overview
Port the loop runner, log parser, scheduler, and asset injector to TypeScript.
These services orchestrate container-based Ralph loop execution.

---

### Task 1: Define loop execution types

**Context**: Port `LoopMode`, `LoopStatus`, `LoopState` from `loop_runner.py`.

**Changes**:
- `src/shared/loop-types.ts`:
  - `LoopMode` enum: SINGLE, CONTINUOUS, SCHEDULED
  - `LoopStatus` enum: IDLE, STARTING, RUNNING, PAUSED, STOPPING, STOPPED, FAILED, COMPLETED
  - `LoopState` interface: projectId, containerId, mode, status, iteration, logs, commits, errors, startedAt, stoppedAt
  - `LoopStartOpts` interface: projectId, dockerImage, mode, envVars, volumeMounts

**Acceptance**: Types compile, are importable from both main and renderer.

---

### Task 2: Implement LogParser service

**Context**: Port `log_parser.py` — classifies container log lines.

**Changes**:
- `src/services/log-parser.ts`:
  - `LogParser` class:
    - `parseLine(line): ParsedLogLine` — returns { type: 'commit'|'plan'|'error'|'info', content, metadata? }
    - Regex patterns for: git commits (short/long SHA, "creating commit"), error traces,
      plan markers, iteration boundaries
    - `detectIteration(line): number | null` — extracts iteration number from bedrock_loop.sh output
  - `ParsedLogLine` type definition

**Acceptance**: Unit tests cover all log line classifications from Python version (58+ test cases ported).

---

### Task 3: Implement LoopRunner service

**Context**: Port `loop_runner.py` — orchestrates container creation, log streaming, lifecycle.

**Changes**:
- `src/services/loop-runner.ts`:
  - `LoopRunner` class:
    - Constructor takes `DockerManager`, `LogParser`
    - `startLoop(opts: LoopStartOpts): Promise<LoopState>` — creates container, starts it, begins log streaming
    - `stopLoop(projectId): Promise<void>` — stops container gracefully
    - `getLoopState(projectId): LoopState | null`
    - `listRunning(): LoopState[]`
    - `onStateChange(callback)`: Register listener for state transitions
    - `onLogLine(callback)`: Register listener for parsed log lines
  - Tracks state in a `Map<string, LoopState>`
  - Concurrency limit (from settings)
  - Log lines parsed and classified in real-time

**Acceptance**: Unit tests cover start, stop, state tracking, concurrency limits, log streaming integration.

---

### Task 4: Implement loop recovery

**Context**: Port `recover_loops` — re-attach to containers surviving an app restart.

**Changes**:
- Add to `src/services/loop-runner.ts`:
  - `recoverLoops(containers: ContainerInfo[]): Promise<string[]>` — takes output of
    `listRunningContainers()`, re-registers running containers, resumes log streaming
  - Skips containers for deleted projects
  - Skips already-tracked project IDs
  - Respects concurrency limit
  - Returns list of recovered project IDs

**Acceptance**: Unit tests: recovery happy path, skip deleted projects, skip duplicates, concurrency limit.

---

### Task 5: Implement Scheduler service

**Context**: Port `scheduler.py` — timer-based periodic loop execution.

**Changes**:
- `src/services/scheduler.ts`:
  - `parseSchedule(expr): ScheduleConfig` — parses `"*/5 minutes"`, `"every 2 hours"`, `"daily 14:30"`
  - `LoopScheduler` class:
    - `scheduleLoop(projectId, schedule): void`
    - `cancelSchedule(projectId): void`
    - `listScheduled(): ScheduledLoop[]`
    - `isScheduled(projectId): boolean`
  - Uses `setInterval` / `setTimeout` (no external cron library needed)
  - Calls `LoopRunner.startLoop()` on trigger

**Acceptance**: Unit tests: schedule parsing, trigger firing, cancel, list. Use fake timers.

---

### Task 6: Implement AssetInjector service

**Context**: Port `asset_injector.py` — prepares shared prompt files for container volume mount.

**Changes**:
- `src/services/asset-injector.ts`:
  - `AssetInjector` class:
    - `prepareInjectionDir(project: ProjectConfig): Promise<string>` — creates temp dir with:
      - `AGENTS.md` (project override or app default)
      - Custom prompt files from project config
      - `PROMPT_build.md` (project override or default)
    - `cleanup(dir): Promise<void>` — removes temp directory
  - Uses `fs.mkdtemp` for temp dirs, `fs.cp` / `fs.writeFile` for content

**Acceptance**: Unit tests: directory creation, file contents, priority resolution (project > app > default).

---

### Task 7: Wire loop services to IPC

**Context**: Expose loop execution to renderer.

**Changes**:
- `src/main/ipc-handlers/loop-handlers.ts`:
  - `loop:start` — starts a loop, returns initial state
  - `loop:stop` — stops a running loop
  - `loop:list` — returns all loop states
  - `loop:get` — returns single loop state
  - `loop:schedule` — sets up scheduled execution
  - `loop:cancel-schedule` — cancels scheduled execution
  - Outbound events (via `webContents.send`):
    - `loop:state-changed` — when any loop changes state
    - `loop:log-line` — when a new log line is parsed
- Update preload with `window.api.loops.*` methods

**Acceptance**: Renderer can start/stop loops and receive real-time state + log updates.
