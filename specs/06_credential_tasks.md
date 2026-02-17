# 06 — Credential Management

## Overview
Port credential storage and browser-based login to Electron.
Electron has native access to system keychain via `safeStorage` or the `keytar` package.

---

### Task 1: Implement CredentialManager service

**Context**: Port `credential_manager.py` — secure API key storage.

**Changes**:
- `src/services/credential-manager.ts`:
  - `CredentialManager` class:
    - Uses `electron.safeStorage` for encryption (encrypts values, stores in JSON file)
      or `keytar` for native OS keychain access
    - `storeApiKey(service, key): Promise<void>` — service: 'anthropic' | 'openai' | 'github'
    - `getApiKey(service): Promise<string | null>`
    - `deleteApiKey(service): Promise<void>`
    - `listStoredServices(): Promise<string[]>`
  - Maintains a JSON index file listing which services have stored keys
    (keychain has no enumeration API)

**Acceptance**: Unit tests: store, retrieve, delete, list. Verify encryption is used.

---

### Task 2: Implement LoginManager service

**Context**: Port `login_manager.py` — browser-based OAuth login.
In Electron, we can open a `BrowserWindow` directly instead of launching Playwright.

**Changes**:
- `src/services/login-manager.ts`:
  - `LoginManager` class:
    - `openLoginSession(service): Promise<LoginResult>` — opens a new `BrowserWindow`
      pointed at the service's login URL
    - Captures session cookies/tokens after successful login
    - Stores captured credentials via `CredentialManager`
    - Services: Anthropic, OpenAI with service-specific URLs
    - Window closes automatically on success or user can cancel
  - `LoginResult` type: { success, service, error? }
  - No Playwright dependency needed — Electron IS the browser

**Acceptance**: Unit tests with mocked BrowserWindow verify flow. Login window opens to correct URL.

---

### Task 3: Wire credential services to IPC

**Context**: Expose credential operations to renderer.

**Changes**:
- `src/main/ipc-handlers/credential-handlers.ts`:
  - `credentials:store` — store API key
  - `credentials:get` — retrieve API key (returns masked version to renderer for display)
  - `credentials:delete` — delete API key
  - `credentials:list` — list services with stored keys
  - `credentials:login` — open login window for service
- Update preload with `window.api.credentials.*` methods

**Acceptance**: Renderer can check which credentials are stored and trigger login flow.
