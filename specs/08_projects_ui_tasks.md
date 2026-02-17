# 08 — Projects Tab UI

## Overview
Port the projects table, add/edit dialog, and project actions to React.

---

### Task 1: Implement ProjectsTab page component

**Context**: Port `projects_tab.py` — table of projects with action buttons.

**Changes**:
- `src/renderer/pages/ProjectsTab/ProjectsTab.tsx`:
  - "Add Project" button at top
  - Table/list view of projects with columns:
    - Name, Repo URL, Docker Image, Status (running/idle badge), Actions
  - Action buttons per row: Edit, Delete, Run
  - Empty state: message + "Add your first project" CTA
  - Uses `useProjects()` hook for data
  - Responsive: works at various window sizes
- `src/renderer/pages/ProjectsTab/ProjectRow.tsx`:
  - Single project row component
  - Status badge (green = running, gray = idle)

**Acceptance**: Projects display in table. Buttons trigger appropriate callbacks. Empty state renders.

---

### Task 2: Implement ProjectDialog modal

**Context**: Port `project_dialog.py` — modal form for add/edit project.

**Changes**:
- `src/renderer/components/ProjectDialog/ProjectDialog.tsx`:
  - Modal overlay with form
  - Fields: Name (text), Repo URL (text), JTBD (textarea), Docker Image (text with suggestions)
  - Mode: "Add" (empty form) or "Edit" (pre-populated from project)
  - Validation: Name required, Repo URL format check
  - Save and Cancel buttons
  - Props: `mode: 'add' | 'edit'`, `project?: ProjectConfig`, `onSave(config)`, `onClose()`
- `src/renderer/components/ProjectDialog/PromptEditor.tsx`:
  - Sub-component for managing custom prompt files
  - List of prompt files with Add/Edit/Delete
  - Edit opens a text editor (textarea or simple code editor)

**Acceptance**: Can add new project, edit existing, manage custom prompts. Validation prevents empty names.

---

### Task 3: Implement project delete confirmation

**Context**: Confirm before deleting a project.

**Changes**:
- `src/renderer/components/ConfirmDialog/ConfirmDialog.tsx`:
  - Reusable confirmation modal
  - Props: `title`, `message`, `confirmLabel`, `variant: 'danger' | 'default'`, `onConfirm`, `onCancel`
  - Danger variant: red confirm button
- Wire delete button in ProjectsTab to show ConfirmDialog before calling `window.api.projects.remove()`

**Acceptance**: Delete shows confirmation. Confirming deletes project and refreshes list. Canceling does nothing.

---

### Task 4: Wire project actions to services

**Context**: Connect UI actions to IPC service calls.

**Changes**:
- In ProjectsTab:
  - Add: opens ProjectDialog in add mode → on save calls `window.api.projects.add(config)` → refreshes list
  - Edit: opens ProjectDialog in edit mode → on save calls `window.api.projects.update(id, config)` → refreshes list
  - Delete: shows ConfirmDialog → on confirm calls `window.api.projects.remove(id)` → refreshes list
  - Run: calls `window.api.loops.start(projectId)` → switches to Loops tab
- Add loading states and error handling for each action
- Show toast on success/failure

**Acceptance**: Full CRUD flow works end-to-end. Errors show toasts. Running a project starts a loop.
