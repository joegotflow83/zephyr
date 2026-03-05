# Zephyr Desktop

A native Electron + React + TypeScript desktop application for managing and orchestrating AI loops via Docker containers.

## Credit

Credit for creating the ralph philosophy goes to [@GeoffreyHuntley](https://x.com/GeoffreyHuntley) and credit for creating the ralph
playbook goes to [ClaytonFarr](https://github.com/ClaytonFarr/ralph-playbook?tab=readme-ov-file)

## What It Does

Zephyr Desktop provides a graphical interface for:

- **Project management** -- create, edit, import/export project configurations with Docker container settings, environment variables, and shared assets
- **Loop execution** -- start, stop, and monitor long-running Docker-based loops with real-time log streaming and parsing
- **Terminal** -- interactive xterm.js terminal with full PTY sessions via Docker exec
- **Image builder** -- build and manage custom Docker images from within the app
- **Scheduling** -- schedule loops with cron expressions for automated execution
- **Credential management** -- securely store API keys and session cookies via Electron's `safeStorage`; optionally use browser-based login via Playwright
- **AWS Bedrock auth** -- built-in support for AWS Bedrock authentication
- **GitHub deploy keys** -- ephemeral SSH deploy key management for private repositories
- **Docker health monitoring** -- background polling detects Docker daemon availability changes and warns when disk space is low
- **Self-update** -- check for and apply updates via `electron-updater`
- **Desktop notifications** -- get notified when loops complete or fail
- **Log export** -- export individual or all loop logs to disk
- **Coding Factory** -- run multiple AI agent roles (coder, reviewer, tester, planner) in parallel on a single project; each role gets its own container with shared workspace
- **VM Sandbox** -- run Docker containers inside Multipass VMs for full admin access, nested Docker, and system-level testing; supports persistent VMs (created once, reused) and ephemeral VMs (fresh per loop run)

## Requirements

- Node.js 18+
- Docker Desktop (for loop execution; project management works without it)
- Multipass (optional; required for VM Sandbox mode)

## Installation

```bash
# Clone the repository
git clone https://github.com/joegotflow83/zephyr.git && cd zephyr

# Install dependencies
npm install
```

## Running

```bash
# Start in development mode
npm start
```

## Development

### Project Structure

```
src/
  main/
    index.ts              # Electron main process entry point
    preload.ts            # Context bridge / preload script
    menu.ts               # Application menu
    ipc-handlers/         # IPC handler modules
  renderer/
    App.tsx               # Root React component
    index.tsx             # Renderer entry point
    pages/
      ProjectsTab/        # Project list and management
      LoopsTab/           # Running loops display and log viewer
      TerminalTab/        # Interactive terminal
      ImagesTab/          # Docker image builder
      SettingsTab/        # Application settings and updates
    components/           # Shared UI components (dialogs, log viewer, status bar, etc.)
    stores/               # Zustand state stores
    hooks/                # Custom React hooks
  services/
    config-manager.ts     # JSON configuration persistence
    project-store.ts      # Project CRUD operations
    docker-manager.ts     # Docker container lifecycle and log streaming
    loop-runner.ts        # Loop execution engine
    log-parser.ts         # Structured log output parsing
    scheduler.ts          # Cron-based loop scheduling
    credential-manager.ts # safeStorage-backed credential storage
    login-manager.ts      # Playwright browser-based authentication
    asset-injector.ts     # Shared file injection into containers
    image-builder.ts      # Docker image build orchestration
    terminal-manager.ts   # xterm.js PTY session management
    docker-health.ts      # Background Docker daemon health polling
    disk-checker.ts       # Pre-launch disk space validation
    git-manager.ts        # Git repository operations
    self-updater.ts       # In-app update mechanism
    ssh-key-manager.ts    # Ephemeral GitHub SSH deploy key management
    import-export.ts      # Project configuration import/export
    logging.ts            # Application-wide logging (electron-log)
    vm-manager.ts         # Multipass VM lifecycle and Docker-in-VM execution
  shared/
    ipc-channels.ts       # IPC channel name constants
    models.ts             # Shared data models
    loop-types.ts         # Loop-related type definitions
scripts/
  build.sh                # Build wrapper
  generate-icons.js       # Application icon generation
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

- **ci.yml** -- runs type-check, unit tests, integration tests, linting, and E2E tests on every push
- **release.yml** -- triggered by `v*` tags; builds for macOS, Linux, and Windows, then publishes a GitHub release with artifacts

## Architecture

The application follows Electron's process model with a strict security posture (`contextIsolation: true`, `nodeIntegration: false`). All IPC channel names are defined as constants in `src/shared/ipc-channels.ts`. The React renderer communicates with backend services exclusively via the context bridge.

Key design decisions:

- **Best-effort resilience** -- Docker unavailability, disk check failures, and git validation errors are caught and logged but never prevent the app from starting or project management from working
- **Secure credentials** -- all secrets stored via `electron.safeStorage`; never written to plaintext config files
- **Zustand state** -- renderer state is managed with Zustand stores, keeping UI logic out of components
- **Virtual log rendering** -- `@tanstack/react-virtual` enables smooth scrolling through large log outputs

## License

MIT
