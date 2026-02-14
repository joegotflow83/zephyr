# Zephyr Desktop

A native PyQt6 desktop application for managing and orchestrating Ralph loops via Docker containers.

## What It Does

Zephyr Desktop provides a graphical interface for:

- **Project management** -- create, edit, import/export project configurations with Docker container settings, environment variables, and shared assets
- **Loop execution** -- start, stop, and monitor long-running Docker-based loops with real-time log streaming and parsing
- **Scheduling** -- schedule loops with cron expressions for automated execution
- **Credential management** -- securely store API keys and session cookies via the system keyring; optionally use browser-based login via Playwright
- **Docker health monitoring** -- background polling detects Docker daemon availability changes and warns when disk space is low
- **Self-update** -- check for and apply updates from the upstream Git repository
- **Desktop notifications** -- get notified when loops complete or fail
- **Log export** -- export individual or all loop logs to disk

## Requirements

- Python 3.12+
- Docker Desktop (for loop execution; project management works without it)
- System keyring backend (for credential storage)

## Installation

```bash
# Clone the repository
git clone <repo-url> && cd zephyr-desktop

# Install in development mode
pip install -e ".[dev]"

# Install Playwright browsers (needed for login mode)
playwright install chromium
```

## Running

```bash
# Via the installed entry point
zephyr

# Or directly
python -m src.main
```

## Development

### Project Structure

```
src/
  main.py                 # Application entry point and service wiring
  lib/
    app_controller.py     # Central UI-to-backend coordinator
    config_manager.py     # JSON configuration persistence
    models.py             # Data models (ProjectConfig, LoopConfig, AppSettings)
    project_store.py      # Project CRUD operations
    docker_manager.py     # Docker container lifecycle and log streaming
    loop_runner.py        # Loop execution engine
    log_parser.py         # Structured log output parsing
    scheduler.py          # Cron-based loop scheduling
    credential_manager.py # Keyring-backed credential storage
    login_manager.py      # Playwright browser-based authentication
    asset_injector.py     # Shared file injection into containers
    notifier.py           # Desktop notification service
    log_exporter.py       # Log export to files
    log_bridge.py         # Thread-safe Qt signal bridging for logs
    docker_health.py      # Background Docker daemon health polling
    disk_checker.py       # Pre-launch disk space validation
    git_manager.py        # Git repository operations
    self_updater.py       # In-app update mechanism
    cleanup.py            # Graceful shutdown and signal handling
    logging_config.py     # Application-wide logging setup
    import_export.py      # Project configuration import/export
    _version.py           # Version string (generated, not committed)
  ui/
    main_window.py        # Tab-based main window
    projects_tab.py       # Project list and management
    loops_tab.py          # Running loops display and log viewer
    settings_tab.py       # Application settings and updates
    project_dialog.py     # Add/edit project dialog
    credential_dialog.py  # Credential input dialog
tests/                    # 1376+ tests covering all modules
scripts/
  build.sh                # PyInstaller build wrapper
  generate_icon.py        # Application icon generation
  generate_icns.sh        # macOS .icns icon conversion
```

### Running Tests

```bash
# Full test suite
./validate.sh

# Specific tests
./validate.sh targeted tests/test_config_manager.py

# Re-run only last-failed tests
./validate.sh lf

# Failed-first ordering
./validate.sh ff

# Linting (black + pylint)
./validate.sh lint
```

The test suite requires `QT_QPA_PLATFORM=offscreen` for headless environments (set automatically by `validate.sh`).

### Building

```bash
# Build standalone application via PyInstaller
./scripts/build.sh

# Output: dist/Zephyr/
```

Builds produce platform-native packages: `.app` bundle on macOS, standalone binary on Linux, `.exe` on Windows.

### CI/CD

GitHub Actions workflows in `.github/workflows/`:

- **ci.yml** -- runs tests and linting on every push
- **release.yml** -- triggered by `v*` tags; builds for macOS, Linux, and Windows, then publishes a GitHub release with artifacts

## Architecture

The application follows a service-oriented architecture with a central `AppController` that wires 12+ backend services to the PyQt6 UI. All Docker operations, credential access, and long-running tasks happen in background threads with results bridged to the Qt event loop via signals and queued connections.

Key design decisions:

- **Best-effort resilience** -- Docker unavailability, disk check failures, and git validation errors are caught and logged but never prevent the app from starting or project management from working
- **Thread-safe log bridging** -- a dedicated `LogBridge` with an internal `QObject` emitter uses `QueuedConnection` to safely forward logs from worker threads to the UI
- **Secure credentials** -- all secrets stored via the system keyring; never written to plaintext config files

## License

MIT
