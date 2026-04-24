# AGENTS.md

## Main Agent
You are building Zephyr Desktop — an Electron + React + TypeScript desktop app for managing AI loops with Docker integration.

## Runtime Environment
- Node.js: v24.13.1 system-installed at /usr/bin/node (NVM not present in this environment)
- npm/node commands work directly without NVM sourcing
- No GUI/display available in CI — cannot run `npm start` (Electron needs display)
- TypeScript 5.3.x required (4.5.x is incompatible with @types/node)

## Key Commands
- Build check: `node_modules/.bin/tsc --noEmit` (run `npm install` first if node_modules is missing)
- Unit tests: `npm run test:unit`
- If unit tests fail with `@rollup/rollup-linux-x64-gnu` missing: run `npm install @rollup/rollup-linux-x64-gnu` once
- Lint: `npm run lint`
- Validate: `bash validate.sh` (runs lint + unit tests after Phase 1.8)

## Sub-agents (when needed)
- Docker Agent: dockerode integration, container lifecycle
- Terminal Agent: xterm.js, PTY sessions via Docker exec
- UI Agent: React + Tailwind components, Zustand state
- IPC Agent: Electron main↔renderer bridge

## Rules
- All secrets through electron.safeStorage, never plaintext
- contextIsolation: true, nodeIntegration: false always
- All IPC channels defined as constants in src/shared/ipc-channels.ts
