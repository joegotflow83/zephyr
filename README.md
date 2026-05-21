# Zephyr Desktop

A native Electron + React + TypeScript desktop application for running AI pipelines — multiple agents working in parallel and coordinated through a kanban-style pipeline.

## What It Does

Zephyr Desktop lets you run your own customized **Agentic Pipelines**: a set of AI agents that each operate in their own container, share a workspace on disk, and hand tasks off to each other through a pipeline. You manage everything — tasks, pipelines, agents, and logs — from a single desktop UI.

### Core features

- **Pipeline Factory** — define a pipeline of agent stages (e.g. PM → Coder → Reviewer → QA); tasks flow automatically between stages as agents complete them; supports multiple parallel instances per stage
- **Kanban board** — drag tasks between columns, view per-task history, lock/unlock agents, track epic progress, and delete completed tasks
- **Pipeline builder** — create and edit pipelines with custom stages, agent prompts, icons, colors, and instance counts; built-in pipelines included
- **Task management** — add tasks manually or sync from spec files; tasks can be decomposed into epics by the PM agent; epic progress tracked automatically
- **Project management** — create and edit projects with Docker image selection, git identity, spec files, and pipeline assignment
- **Deployment choice** — run agent containers directly on this machine (Local Containers) or inside an isolated Ubuntu VM via Multipass (VM + Containers)
- **Terminal** — interactive xterm.js terminal with full PTY sessions via Docker exec
- **Image builder** — build and manage custom Docker images from within the app
- **Credential management** — securely store API keys and session cookies via Electron's `safeStorage`
- **AWS Bedrock auth** — built-in support for AWS Bedrock authentication
- **GitHub / GitLab deploy keys** — ephemeral SSH deploy key management; keys are created at loop start and cleaned up automatically on exit
- **Runtime health monitoring** — background polling detects Docker/Podman daemon availability and warns when disk space is low
- **Self-update** — check for and apply updates via `electron-updater`
- **Desktop notifications** — get notified when loops complete or fail
- **Log export** — export individual or all loop logs to disk
- **Podman support** — use Podman as an alternative container runtime; auto-detected at startup
- **Kiro CLI support** — use Kiro (Amazon) as the LLM provider inside containers
- **Per-project git identity** — configure `git user.name` and `user.email` per project, injected into the container at run time
- **Spec files** — attach specification documents to a project; synced into the task backlog automatically

## Requirements

- Node.js 18+
- Docker Desktop or Podman (required for running the factory; project management works without either)
- Multipass (optional; required for VM + Containers deployment mode)

## Installation

```bash
git clone https://github.com/joegotflow83/zephyr.git && cd zephyr
npm install
```

## Running

```bash
npm start
```

## Quick Start

1. **Build or pick a Docker image** — go to the Images tab and build a Zephyr image, or use any public image (e.g. `ubuntu:24.04`)
2. **Create a project** — fill in the project name, local path (the repo folder on your machine), and select the image
3. **Choose deployment** — "Local Containers" runs agents directly on this machine; "VM + Containers" runs them inside an isolated Multipass VM
4. **Assign a pipeline** — pick a built-in pipeline or create one in Settings → Pipelines; the pipeline defines the agent stages and their prompts
5. **Add tasks** — type tasks into the Factory tab's add-task form, or attach spec files to the project and click "Sync from Specs"
6. **Start the factory** — click "Start Factory"; agents will begin picking up tasks from their columns automatically

## Development

### Project Structure

```
src/
  main/
    index.ts                  # Electron main process entry point
    preload.ts                # Context bridge / preload script
    ipc-handlers/
      loop-handlers.ts        # Factory start/stop, container lifecycle, file watchers
      factory-task-handlers.ts# Kanban task CRUD and workspace sync
      pipeline-handlers.ts    # Pipeline CRUD
      data-handlers.ts        # Project, settings, image CRUD
  renderer/
    App.tsx                   # Root React component and tab routing
    pages/
      FactoryTab/             # Kanban board, task detail panel, factory controls
      ProjectsTab/            # Project list and management
      TerminalTab/            # Interactive terminal
      ImagesTab/              # Docker image builder
      SettingsTab/            # Settings, pipeline library, credential config
    components/
      ProjectDialog/          # Add/edit project modal
      PipelineBuilderDialog/  # Pipeline create/edit modal
      ImageBuilderDialog/     # Image build modal
      LogViewer/              # Virtualized log viewer
    stores/
      app-store.ts            # Zustand global state
    hooks/                    # useFactoryTasks, useLoops, useActiveFactories, etc.
    utils/
      parseLogLine.ts         # Log line parsing and timestamp stripping
  services/
    container-orchestrator.ts # Container/VM lifecycle, log streaming, state tracking
    factory-task-store.ts     # Kanban task persistence and transition logic
    pipeline-store.ts         # Pipeline persistence
    project-store.ts          # Project CRUD
    config-manager.ts         # JSON configuration persistence
    log-parser.ts             # Structured log output parsing
    credential-manager.ts     # safeStorage-backed credential storage
    asset-injector.ts         # Hook/prompt file injection into containers
    image-builder.ts          # Docker image build orchestration
    terminal-manager.ts       # xterm.js PTY session management
    vm-manager.ts             # Multipass VM lifecycle and Docker-in-VM execution
    git-manager.ts            # Git repository operations
    self-updater.ts           # In-app update mechanism
    ssh-key-manager.ts        # Ephemeral GitHub/GitLab SSH deploy key management
    import-export.ts          # Project configuration import/export
  shared/
    ipc-channels.ts           # IPC channel name constants
    models.ts                 # Shared data models (ProjectConfig, AppSettings, etc.)
    factory-types.ts          # FactoryTask, pipeline kanban types
    pipeline-types.ts         # Pipeline, PipelineStage type definitions
    pipeline-builtins.ts      # Built-in pipeline definitions
    loop-types.ts             # LoopState, LoopStatus enums
  lib/
    pipeline/
      transitions.ts          # Derive allowed kanban transitions from a pipeline
      slugify.ts              # Stage ID normalization
```

### Running Tests

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests (requires display)
npm run test:e2e

# All tests
npm test

# Linting
npm run lint
npm run lint:fix
```

### Building

```bash
# Package the application
npm run package

# Create distributable (dmg, deb, exe, etc.)
npm run make
```

Builds produce platform-native packages: `.dmg` on macOS, `.deb`/`.rpm` on Linux, `.exe` (Squirrel) on Windows.

### CI/CD

GitHub Actions workflows in `.github/workflows/`:

- **ci.yml** — runs type-check, unit tests, integration tests, linting, and E2E tests on every push
- **release.yml** — triggered by `v*` tags; builds for macOS, Linux, and Windows, then publishes a GitHub release with artifacts

## Architecture

The application follows Electron's process model with strict security (`contextIsolation: true`, `nodeIntegration: false`). All IPC channel names are defined as constants in `src/shared/ipc-channels.ts`. The React renderer communicates with backend services exclusively via the context bridge.

### How the factory works

1. On `FACTORY_START`, one container per pipeline stage is launched running a bash polling loop that watches for `@current-task-<stageId>.json` in `/workspace`
2. When a task enters a stage column (via drag-drop or agent status update), the host writes that file and restarts any idle container for that stage
3. The agent reads the file, works on the task, writes `@task-status.json` to signal completion or rejection
4. The host's file watcher picks up the status update, moves the task to the next column, writes the next stage's current-task file, and dispatches that stage
5. Epics (tasks decomposed by the PM agent into sub-tasks) are tracked in a progress strip above the board; when all sub-tasks reach Done, the epic auto-advances
6. A stuck-agent watchdog runs every 5 minutes and force-restarts any container whose task hasn't been updated in 30 minutes

Key design decisions:

- **Best-effort resilience** — Docker unavailability, disk check failures, and git errors are caught and logged but never prevent the app from starting
- **Secure credentials** — all secrets stored via `electron.safeStorage`; never written to plaintext config files
- **Atomic task storage** — task queues are written to `.tmp` then renamed to prevent partial-write corruption
- **Zustand state** — renderer state is managed with Zustand stores, keeping UI logic out of components
- **Virtual log rendering** — `@tanstack/react-virtual` enables smooth scrolling through large log outputs

## License

MIT
