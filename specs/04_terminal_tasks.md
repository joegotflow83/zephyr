# 04 — Integrated Terminal (xterm.js)

## Overview
This is the crown jewel of the Electron rewrite. xterm.js runs natively in the renderer —
no WebSocket bridge, no QWebEngineView hack. The terminal communicates with Docker exec
sessions via Electron IPC, which is significantly simpler and faster than the Python
WebSocket-to-PTY bridge.

---

### Task 1: Set up xterm.js in renderer

**Context**: Install and configure xterm.js as a React component.

**Changes**:
- Install `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `@xterm/addon-search`
- `src/renderer/components/Terminal/Terminal.tsx`:
  - React component that mounts xterm.js to a `<div>` ref
  - Applies FitAddon for automatic resize
  - Applies WebLinksAddon for clickable URLs
  - Props: `onData(data)`, `onResize(cols, rows)`, `fontSize`, `theme`
  - Exposes `write(data)` and `clear()` via `useImperativeHandle`
  - Handles component unmount cleanup (dispose terminal)
- `src/renderer/components/Terminal/terminal.css`: Base terminal styles

**Acceptance**: Component renders a terminal that accepts keyboard input and displays output.
Unit test verifies mount/unmount lifecycle.

---

### Task 2: Implement terminal session management (main process)

**Context**: Manage the mapping between terminal UI instances and Docker exec sessions.
Replaces `terminal_bridge.py` entirely.

**Changes**:
- `src/services/terminal-manager.ts`:
  - `TerminalManager` class:
    - `openSession(containerId, opts?): Promise<TerminalSession>` — creates Docker exec,
      returns session ID + stream handle
    - `closeSession(sessionId): Promise<void>` — detaches exec, cleans up
    - `writeToSession(sessionId, data): void` — sends input to exec stdin
    - `resizeSession(sessionId, cols, rows): void` — resizes PTY
    - `listSessions(): TerminalSession[]`
  - `TerminalSession` type: { id, containerId, user, createdAt }
  - Internally holds Map of sessionId -> exec stream
  - Forwards exec stdout to renderer via `webContents.send('terminal:data', sessionId, data)`

**Acceptance**: Unit tests verify session open/close/write/resize lifecycle.

---

### Task 3: Wire terminal IPC channels

**Context**: Connect renderer terminal components to main-process terminal sessions.

**Changes**:
- `src/main/ipc-handlers/terminal-handlers.ts`:
  - `terminal:open` — calls `terminalManager.openSession()`
  - `terminal:close` — calls `terminalManager.closeSession()`
  - `terminal:write` — calls `terminalManager.writeToSession()` (uses `ipcMain.on`, not `handle`, for performance — fire-and-forget)
  - `terminal:resize` — calls `terminalManager.resizeSession()`
  - Outbound: `terminal:data` — main sends exec output to renderer
- Update preload with `window.api.terminal.*` methods
- For `terminal:write`, use `ipcRenderer.send` (not `invoke`) to avoid round-trip overhead

**Acceptance**: Data flows from keyboard input through IPC to Docker exec stdin and back.

---

### Task 4: Build TerminalTab page component

**Context**: Full terminal tab UI with session tabs and container selector.

**Changes**:
- `src/renderer/pages/TerminalTab/TerminalTab.tsx`:
  - Container selector dropdown (populated from running containers)
  - User selector (root / default user)
  - "Open Terminal" button
  - Tabbed interface for multiple concurrent sessions
  - Each tab renders a `<Terminal>` component
  - Close button on each tab
  - Session indicator (container name, user, connected status)
- `src/renderer/pages/TerminalTab/TerminalSession.tsx`:
  - Wrapper that connects a Terminal component to IPC:
    - On mount: calls `window.api.terminal.open(containerId, user)`
    - Subscribes to `terminal:data` events for this session
    - On keypress: sends to `window.api.terminal.write(sessionId, data)`
    - On resize: sends to `window.api.terminal.resize(sessionId, cols, rows)`
    - On unmount: calls `window.api.terminal.close(sessionId)`

**Acceptance**: Can open a terminal to a running Docker container, type commands, see output,
resize, and close the session. Multiple sessions in tabs work simultaneously.

---

### Task 5: Terminal UX polish

**Context**: Add quality-of-life features to the terminal.

**Changes**:
- Search addon integration (Ctrl+Shift+F to search terminal buffer)
- Copy/paste support (Ctrl+Shift+C / Ctrl+Shift+V, or right-click context menu)
- Font size adjustment (Ctrl+= / Ctrl+-)
- Terminal theme switching (dark/light, synced with app theme)
- Reconnection handling: if exec session dies, show message and offer "Reconnect" button
- Split terminal support (optional, stretch goal): vertical/horizontal split within a tab

**Acceptance**: Search, copy/paste, and font sizing work. Theme switches apply immediately.
