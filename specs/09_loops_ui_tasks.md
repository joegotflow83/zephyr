# 09 — Running Loops Tab UI

## Overview
Port the running loops table and log viewer to React.

---

### Task 1: Implement LoopsTab page component

**Context**: Port `loops_tab.py` — table of active/recent loops.

**Changes**:
- `src/renderer/pages/LoopsTab/LoopsTab.tsx`:
  - Split layout: upper table + lower log viewer (resizable splitter)
  - Table columns: Project Name, Status (badge), Mode, Iteration, Started, Actions
  - Action buttons: Stop (if running), Start (if stopped)
  - Selecting a row shows its logs in the lower panel
  - Auto-selects first running loop on tab switch
  - Uses `useLoops()` hook for state
- `src/renderer/pages/LoopsTab/LoopRow.tsx`:
  - Status badges with colors: running=green, starting=blue, failed=red, completed=gray, stopping=yellow

**Acceptance**: Loop table displays with correct status badges. Row selection works.

---

### Task 2: Implement log viewer component

**Context**: Port the log viewer panel from `loops_tab.py`.

**Changes**:
- `src/renderer/components/LogViewer/LogViewer.tsx`:
  - Virtualized scrolling log display (use `react-window` or `@tanstack/react-virtual` for performance)
  - Auto-scrolls to bottom as new lines arrive (with "scroll lock" toggle)
  - Syntax highlighting for log types: commits (green), errors (red), plans (blue), info (gray)
  - Line timestamps
  - Search/filter within logs (Ctrl+F)
  - Clear logs button
  - Props: `lines: ParsedLogLine[]`, `autoScroll: boolean`
- Install `@tanstack/react-virtual` for virtualization

**Acceptance**: Handles 10k+ log lines without lag. Auto-scroll works. Color coding applied.

---

### Task 3: Implement log export functionality

**Context**: Port `log_exporter.py` — export logs to file or zip.

**Changes**:
- `src/services/log-exporter.ts` (main process):
  - `exportLoopLog(projectId, outputPath): Promise<void>` — writes single log to timestamped text file
  - `exportAllLogs(outputPath): Promise<void>` — creates zip with all loop logs + summary
- Add IPC handlers: `logs:export`, `logs:export-all`
- Add "Export Log" button on selected loop and "Export All" button in LoopsTab toolbar
- Uses Electron's `dialog.showSaveDialog()` for file picker

**Acceptance**: Can export single log and all logs. Files are correctly formatted with timestamps.

---

### Task 4: Real-time log streaming integration

**Context**: Wire real-time log lines from main process to log viewer.

**Changes**:
- `src/renderer/hooks/useLogStream.ts`:
  - Subscribes to `loop:log-line` IPC events
  - Buffers lines per project ID
  - Returns `{ lines, clearLines }` for selected project
  - Handles reconnection (if app regains focus, catches up on missed lines)
- Wire into LoopsTab: selected loop's logs stream into LogViewer in real-time
- Performance: batch DOM updates with `requestAnimationFrame` if lines arrive faster than frame rate

**Acceptance**: Log lines appear in real-time as container produces output. No dropped lines. No UI jank.
