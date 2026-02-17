# 10 — Settings Tab UI

## Overview
Port the settings tab with credentials, Docker config, general settings, and updates.

---

### Task 1: Implement SettingsTab page component

**Context**: Port `settings_tab.py` — sectioned settings page.

**Changes**:
- `src/renderer/pages/SettingsTab/SettingsTab.tsx`:
  - Scrollable settings page with sections:
    - Credentials
    - Docker
    - General
    - Updates
  - Each section is a collapsible card
  - Uses `useSettings()` hook for state
  - Auto-saves on change (debounced)

**Acceptance**: All sections render. Settings load from store on mount.

---

### Task 2: Implement credentials section

**Context**: Port credential management UI from `settings_tab.py` + `credential_dialog.py`.

**Changes**:
- `src/renderer/pages/SettingsTab/CredentialsSection.tsx`:
  - Per-service row: Anthropic, OpenAI, GitHub
  - Each row shows: service name, status (key stored / not set), "Update Key" button
  - "Use Login Mode" toggle per service
- `src/renderer/components/CredentialDialog/CredentialDialog.tsx`:
  - Modal for entering API key
  - Password-masked input field
  - Login mode toggle (shows note about browser-based auth)
  - Save / Cancel buttons
  - Props: `service`, `onSave(key)`, `onLoginMode()`, `onClose()`

**Acceptance**: Can update API keys, see stored status, toggle login mode.

---

### Task 3: Implement Docker and general settings sections

**Context**: Docker status + container limits, notifications, log level.

**Changes**:
- `src/renderer/pages/SettingsTab/DockerSection.tsx`:
  - Docker connection status indicator (green/red dot + text)
  - Max concurrent containers: number input (spinner)
  - Docker info display (version, running containers)
- `src/renderer/pages/SettingsTab/GeneralSection.tsx`:
  - Notifications: toggle switch
  - Log level: dropdown (DEBUG, INFO, WARNING, ERROR)
  - App version display
  - Theme: dropdown or toggle (light/dark/system)
- Changes call `window.api.settings.save()` with debounce

**Acceptance**: Settings save and persist across app restarts. Docker status updates in real-time.

---

### Task 4: Implement updates section

**Context**: Port self-update UI from `settings_tab.py`.

**Changes**:
- `src/renderer/pages/SettingsTab/UpdatesSection.tsx`:
  - "Check for Updates" button
  - Shows current version vs. available version
  - "Update App" button (triggers self-update loop)
  - Update progress/status display
- Wire to `window.api.updates.check()` and `window.api.updates.apply()`

**Acceptance**: Can check for updates and trigger update. Status displays correctly.
