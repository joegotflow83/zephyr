# 01 — Project Scaffold

## Overview
Replace the Python/PyQt6 project structure with an Electron + React + TypeScript stack.
Remove all Python files and set up the new toolchain.

---

### Task 1: Initialize Electron Forge project with Vite + React + TypeScript

**Context**: Start fresh with `@electron-forge/cli` using the Vite + TypeScript template.

**Changes**:
- Run `npm init electron-app@latest` with `--template=vite-typescript` in a temp dir
- Move generated files into project root (preserve `specs/`, `.git`)
- Add React 18, react-dom, @types/react, @types/react-dom
- Configure Vite for React (add `@vitejs/plugin-react`)
- Verify `npm start` launches a blank Electron window

**Acceptance**: `npm start` opens an Electron window rendering a React component.

---

### Task 2: Configure Tailwind CSS

**Context**: Add Tailwind v3 to the renderer for utility-first styling.

**Changes**:
- Install `tailwindcss`, `postcss`, `autoprefixer`
- Create `tailwind.config.js` with content paths pointing to `src/**/*.tsx`
- Create `postcss.config.js`
- Add Tailwind directives (`@tailwind base/components/utilities`) to a global CSS file
- Import global CSS in renderer entry point

**Acceptance**: A `<div className="text-blue-500 text-2xl">Hello</div>` renders correctly.

---

### Task 3: Set up project directory structure

**Context**: Establish conventions for the Electron app codebase.

**Changes**:
- Create directory layout:
  ```
  src/
    main/           # Electron main process
      index.ts       # Main entry point
      preload.ts     # Context bridge / preload script
    renderer/        # React UI
      App.tsx
      index.tsx
      index.html
      components/    # Reusable UI components
      pages/         # Tab-level page components
      hooks/         # Custom React hooks
      stores/        # State management
      types/         # Shared TypeScript types
    services/        # Backend logic (runs in main process)
    shared/          # Types/constants shared between main & renderer
  specs/             # Feature task specs (keep existing)
  resources/         # Icons, static assets
  ```
- Create placeholder files for each directory
- Set up path aliases in tsconfig (`@components/`, `@services/`, etc.)

**Acceptance**: Build compiles with no errors, directory structure in place.

---

### Task 4: Configure IPC bridge (preload + context bridge)

**Context**: Electron's security model requires a preload script to expose main-process
APIs to the renderer via `contextBridge`. This is the foundation for all service calls.

**Changes**:
- `src/main/preload.ts`: Define `contextBridge.exposeInMainWorld('api', { ... })` with typed channels
- `src/shared/ipc-channels.ts`: Define string constants for all IPC channel names
- `src/shared/ipc-types.ts`: Define TypeScript interfaces for IPC request/response payloads
- `src/renderer/types/global.d.ts`: Augment `Window` interface with `api` property
- Wire preload script in `BrowserWindow` config with `contextIsolation: true`, `nodeIntegration: false`

**Acceptance**: Renderer can call `window.api.ping()` and receive `"pong"` from main process.

---

### Task 5: Set up testing infrastructure

**Context**: Need both unit tests (Vitest) and E2E tests (Playwright or Electron's built-in testing).

**Changes**:
- Install `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`
- Configure `vitest.config.ts` for React component testing (jsdom environment)
- Install `@playwright/test` and `electron` Playwright support for E2E
- Create `tests/unit/` and `tests/e2e/` directories
- Write a sample unit test (renders App component) and sample E2E test (window opens)
- Add npm scripts: `test`, `test:unit`, `test:e2e`

**Acceptance**: `npm test` runs both unit and E2E suites successfully.

---

### Task 6: Configure ESLint + Prettier

**Context**: Enforce consistent code style across the project.

**Changes**:
- Install `eslint`, `@typescript-eslint/*`, `eslint-plugin-react`, `eslint-plugin-react-hooks`
- Install `prettier`, `eslint-config-prettier`
- Create `.eslintrc.cjs` with TypeScript + React rules
- Create `.prettierrc` with project conventions (single quotes, trailing commas, etc.)
- Add npm scripts: `lint`, `lint:fix`, `format`

**Acceptance**: `npm run lint` passes on all source files.

---

### Task 7: Remove Python source files

**Context**: Clean up the Python/PyQt6 code now that the Electron scaffold is in place.
The Python code is preserved on `master` and tagged `v0.1.0-python`.

**Changes**:
- Remove `src/lib/`, `src/ui/`, `src/main.py`, `src/__init__.py`
- Remove `tests/` Python test files
- Remove `pyproject.toml`, `requirements.txt`, `setup.cfg` (if exists)
- Remove `validate.sh`, `zephyr.spec`, `scripts/build.sh`, `scripts/generate_*.py`
- Remove Python-specific entries from `.gitignore`, add Node entries
- Keep `specs/` directory intact
- Keep `resources/icon.png`

**Acceptance**: No `.py` files remain in `src/` or `tests/`. `npm start` still works.

---

### Task 8: Create `validate.sh` for Electron

**Context**: Maintain a single entry point for CI validation, matching the convention from the Python version.

**Changes**:
- New `validate.sh` that runs:
  - `npm ci` (install deps)
  - `npm run lint`
  - `npm run test:unit`
  - Exit with non-zero on any failure
- Make it executable

**Acceptance**: `bash validate.sh` runs lint + unit tests and reports pass/fail.
