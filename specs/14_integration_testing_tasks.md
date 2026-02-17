# 14 — Integration & E2E Testing

## Overview
Port integration test suites and add Electron-specific E2E tests.

---

### Task 1: Service integration tests

**Context**: Port `tests/test_integration_project_workflow.py` — test project CRUD flow end-to-end.

**Changes**:
- `tests/integration/project-workflow.test.ts`:
  - Uses real ConfigManager + ProjectStore (with temp directory)
  - Tests: create project, list, update, delete, persistence across service restart
  - Import/export round-trip
  - Verify JSON file contents on disk

**Acceptance**: Tests pass with real filesystem I/O (temp dirs, cleaned up after).

---

### Task 2: Loop execution integration tests

**Context**: Port `tests/test_integration_loop_workflow.py` — test loop lifecycle.

**Changes**:
- `tests/integration/loop-workflow.test.ts`:
  - Uses mocked DockerManager (no real Docker needed)
  - Tests: start loop → state changes → log lines arrive → stop loop → state is STOPPED
  - Recovery flow: register containers, recover, verify states
  - Scheduler integration: schedule fires, loop starts
  - Concurrency limit enforcement

**Acceptance**: Full loop lifecycle tested without Docker dependency.

---

### Task 3: E2E tests with Playwright

**Context**: Port `tests/test_integration_ui.py` — test the actual Electron UI.

**Changes**:
- `tests/e2e/app.test.ts`:
  - Launch Electron app with Playwright's Electron support
  - Tests:
    - App window opens with correct title
    - Tab navigation works (click each tab)
    - Projects tab: add project via dialog, verify it appears in table
    - Settings tab: change a setting, verify it persists after reload
    - Status bar shows Docker status
  - Use `_electron.launch()` to start the app
  - Clean up: close app after each test

**Acceptance**: E2E tests interact with real Electron UI and verify user flows.

---

### Task 4: Terminal E2E tests

**Context**: Test the terminal flow end-to-end (the primary workflow).

**Changes**:
- `tests/e2e/terminal.test.ts`:
  - Requires Docker running (skip if unavailable)
  - Tests:
    - Create a container from settings
    - Open terminal tab
    - Select container, click "Open Terminal"
    - Type a command (e.g., `echo hello`), verify output appears
    - Resize window, verify terminal resizes
    - Close terminal session
    - Open multiple sessions simultaneously
  - Uses Playwright's keyboard and element interaction APIs

**Acceptance**: Terminal interaction works end-to-end with real Docker container.
