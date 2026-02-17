# 07 — UI Shell (Main Window + Navigation)

## Overview
Build the main application shell with tabbed navigation, status bar, and menu bar.
Uses React with Tailwind CSS.

---

### Task 1: Implement app layout and tab navigation

**Context**: Port `main_window.py` — the main window with tabs.

**Changes**:
- `src/renderer/App.tsx`:
  - Top-level layout: sidebar or tab bar + content area
  - Tabs: Projects, Running Loops, Terminal, Settings
  - Active tab state management (React state or URL-based)
  - Keyboard shortcuts for tab switching (Ctrl+1/2/3/4)
- `src/renderer/components/TabBar/TabBar.tsx`:
  - Horizontal tab bar with icons and labels
  - Active tab indicator
  - Badge support (e.g., number of running loops)
- `src/renderer/components/Layout/Layout.tsx`:
  - Overall page layout wrapper (header, content, status bar)

**Acceptance**: Clicking tabs switches content. Keyboard shortcuts work. Active tab is visually distinct.

---

### Task 2: Implement status bar

**Context**: Port the status bar showing Docker connection status.

**Changes**:
- `src/renderer/components/StatusBar/StatusBar.tsx`:
  - Fixed bottom bar
  - Docker status indicator: green dot = connected, red dot = disconnected
  - Subscribes to `docker:status-changed` IPC events
  - Optional: version display, active loop count
- Custom hook: `src/renderer/hooks/useDockerStatus.ts`
  - Subscribes to Docker health events from main process
  - Returns `{ isConnected, dockerInfo }`

**Acceptance**: Status bar shows real-time Docker connection state. Reacts to connect/disconnect.

---

### Task 3: Implement menu bar

**Context**: Port File menu (Import, Export, Quit) and Help menu (About).

**Changes**:
- `src/main/menu.ts`:
  - Build native Electron `Menu` using `Menu.buildFromTemplate()`
  - File menu: Import Config, Export Config, separator, Quit
  - Help menu: About Zephyr Desktop
  - Import/Export trigger IPC calls to config service
  - About opens a simple dialog (`dialog.showMessageBox`)
- Wire menu item clicks to corresponding IPC handlers

**Acceptance**: Menu bar renders with all items. Import/Export open file dialogs. Quit closes app.

---

### Task 4: Implement global state management

**Context**: Set up lightweight state management for the renderer.

**Changes**:
- `src/renderer/stores/app-store.ts`:
  - Use Zustand (lightweight, no boilerplate) or React Context + useReducer
  - Stores: projects list, loop states, app settings, Docker status
  - Actions: refreshProjects, refreshLoops, updateSettings
  - IPC event listeners update store automatically
- Install `zustand` if chosen
- `src/renderer/hooks/useProjects.ts`, `useLoops.ts`, `useSettings.ts`:
  - Convenience hooks that select from store

**Acceptance**: Components can read and update global state. IPC events trigger store updates.

---

### Task 5: Implement notification toasts

**Context**: Port `notifier.py` — but use both OS-native and in-app toast notifications.

**Changes**:
- `src/renderer/components/Toast/Toast.tsx`:
  - In-app toast notification component (bottom-right corner)
  - Types: success, error, warning, info
  - Auto-dismiss with configurable duration
  - Stack multiple toasts
- `src/renderer/hooks/useToast.ts`:
  - `showToast(message, type)` function
- Main process: use `Notification` API for OS-native desktop notifications
  (when app is minimized or in background)

**Acceptance**: Toasts appear for loop events, errors. Native notifications work when app is backgrounded.
