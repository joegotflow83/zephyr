# CI/CD Migration Plan: Python/PyQt → Electron

## Overview

Migrate the GitHub Actions CI/CD pipeline from the Python/PyQt6 desktop deployment to the
Electron + React + TypeScript deployment on the `electron-rewrite` branch. The existing
`.github/workflows/` files were scaffolded for Electron during Phase 1 and are partially
correct, but several gaps remain before the pipeline is production-ready.

---

## Current State

### What existed (Python/PyQt6)
- **Test:** `pytest` with PyQt6 + `pyinstaller` packaging
- **Build:** PyInstaller bundles per platform (`.app`, `.exe`, AppImage/deb)
- **Dependencies:** `pip install -r requirements.txt`, Python 3.x setup
- **Secrets:** Minimal — no code signing
- **Artifacts:** PyInstaller-bundled executables

### What is already done (Electron scaffold)
- `ci.yml`: Uses `actions/setup-node@v4`, `npm ci`, `npm run lint`, `npm run test:unit`
- `release.yml`: Three platform jobs (`build-macos`, `build-linux`, `build-windows`) each running
  `npm run test:unit` then `npm run make` via Electron Forge
- `forge.config.ts`: Defines platform-conditional makers (MakerDMG, MakerZIP, MakerDeb,
  MakerRpm, MakerSquirrel) and GitHub publisher

---

## Gaps to Address

1. macOS build requires `appdmg` installed at CI time for DMG creation (currently conditional/optional in `forge.config.ts`)
2. macOS code signing and notarization steps are missing (secrets referenced but no `electron/action` or `@electron/notarize` step)
3. Linux build needs system-level Electron dependencies (`libgtk-3-0`, `libxss1`, etc.)
4. Windows code signing is absent (no certificate secret or signing step)
5. `ci.yml` only runs `test:unit` — integration tests (`test:integration`) and a TypeScript type-check are missing
6. E2E Playwright tests are not run in CI (require a virtual framebuffer on Linux)
7. `forge.config.ts` has a stale `iconUrl` pointing to the wrong GitHub owner (`ralph` instead of `joegotflow83`)
8. `appVersion` in `forge.config.ts` is hardcoded to `0.1.0` instead of being read from `package.json`
9. No coverage report upload or threshold enforcement in `ci.yml`

---

## Tasks

### Task CI-1: Harden `ci.yml` — type-check, integration tests, coverage

**File:** `.github/workflows/ci.yml`

Add the following steps to the existing `test` job, in order after `Run unit tests`:

1. **TypeScript type-check** — runs `npx tsc --noEmit` to catch type errors without building.
2. **Run integration tests** — runs `npm run test:integration`.
3. **Upload coverage** — upload `coverage/` directory as an artifact (already partially done;
   extend `path` to include `lcov.info` or the `coverage/` folder produced by Vitest).

The job trigger already includes `electron-rewrite`; no change needed there.

```yaml
# After "Run unit tests"
- name: TypeScript type-check
  run: npx tsc --noEmit

- name: Run integration tests
  run: npm run test:integration

- name: Upload coverage
  uses: actions/upload-artifact@v4
  if: always()
  with:
    name: coverage-report
    path: coverage/
    retention-days: 14
```

---

### Task CI-2: Add E2E Playwright tests to `ci.yml`

**File:** `.github/workflows/ci.yml`

Add a separate job `e2e` that depends on `test` and runs Playwright with an Xvfb virtual display.
Electron on Linux CI requires a display server.

```yaml
e2e:
  runs-on: ubuntu-latest
  needs: test
  steps:
    - uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'

    - name: Install system dependencies
      run: |
        sudo apt-get update
        sudo apt-get install -y \
          libgtk-3-0 libxss1 libasound2 libgbm1 \
          xvfb x11-utils

    - name: Install dependencies
      run: npm ci

    - name: Install Playwright browsers
      run: npx playwright install --with-deps chromium

    - name: Run E2E tests
      run: xvfb-run --auto-servernum npm run test:e2e

    - name: Upload Playwright report
      uses: actions/upload-artifact@v4
      if: always()
      with:
        name: playwright-report
        path: playwright-report/
        retention-days: 7
```

---

### Task CI-3: Fix macOS build in `release.yml` — install `appdmg`, code signing, notarization

**File:** `.github/workflows/release.yml`, job `build-macos`

#### 3a. Install `appdmg`
`forge.config.ts` loads `MakerDMG` only when `appdmg` is resolvable. Install it before `npm run make`:

```yaml
- name: Install appdmg for DMG creation
  run: npm install --save-dev appdmg
```

#### 3b. Import signing certificate
Electron Forge's macOS codesigning reads from the system keychain. Add steps to import the
Developer ID certificate from secrets before the build step:

```yaml
- name: Import macOS signing certificate
  env:
    APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
    APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
  run: |
    echo "$APPLE_CERTIFICATE" | base64 --decode > certificate.p12
    security create-keychain -p "" build.keychain
    security import certificate.p12 -k build.keychain -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
    security list-keychains -s build.keychain
    security default-keychain -s build.keychain
    security unlock-keychain -p "" build.keychain
    security set-key-partition-list -S apple-tool:,apple: -s -k "" build.keychain
    rm certificate.p12
```

#### 3c. Pass notarization env vars to the build step
`APPLE_ID`, `APPLE_ID_PASSWORD`, and `APPLE_TEAM_ID` are already referenced; confirm they are
passed to the `Build with Electron Forge` step. Additionally set `CSC_LINK` / `CSC_KEY_PASSWORD`
if using an environment-variable-based signing approach instead of keychain import — choose one
approach and be consistent.

#### 3d. Add notarization via `@electron/notarize`
Install `@electron/notarize` as a dev dependency and wire it as an Electron Forge `afterSign`
hook in `forge.config.ts` (separate task, see **Task FC-1**).

**New secrets required:**
| Secret | Description |
|---|---|
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_ID_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | 10-character Apple Team ID |

---

### Task CI-4: Fix Linux build in `release.yml` — system dependencies

**File:** `.github/workflows/release.yml`, job `build-linux`

Add a step to install Electron's runtime system dependencies before `npm ci`. These are required
for Electron to package correctly on `ubuntu-22.04`:

```yaml
- name: Install system dependencies
  run: |
    sudo apt-get update
    sudo apt-get install -y \
      libgtk-3-0 libxss1 libasound2 libgbm1 \
      rpm fakeroot dpkg
```

The `rpm` and `fakeroot` packages are needed by `@electron-forge/maker-rpm` and
`@electron-forge/maker-deb` respectively.

---

### Task CI-5: Add Windows code signing to `release.yml`

**File:** `.github/workflows/release.yml`, job `build-windows`

Add environment variables for Electron Forge's Squirrel maker to pick up the signing certificate.
Electron Forge / `@electron/windows-sign` reads `CSC_LINK` and `CSC_KEY_PASSWORD`:

```yaml
- name: Build with Electron Forge
  env:
    CSC_LINK: ${{ secrets.WINDOWS_CERTIFICATE }}
    CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
  run: npm run make
```

**New secrets required:**
| Secret | Description |
|---|---|
| `WINDOWS_CERTIFICATE` | Base64-encoded `.p12` or `.pfx` code-signing certificate |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for the certificate |

---

### Task CI-6: Sync version from `package.json` in release jobs

**File:** `.github/workflows/release.yml`, all platform jobs

Currently `appVersion` in `forge.config.ts` is hardcoded. Add a step in each platform job
(after checkout, before build) that reads the version from `package.json` and sets it as an
output — then the artifact name can reference it without relying solely on the git tag:

```yaml
- name: Get package version
  id: pkg_version
  run: |
    VERSION=$(node -p "require('./package.json').version")
    echo "VERSION=$VERSION" >> "$GITHUB_OUTPUT"
```

Use `${{ steps.pkg_version.outputs.VERSION }}` for artifact names instead of (or alongside)
the tag-derived version.

---

### Task FC-1: Fix `forge.config.ts` — `iconUrl` owner and dynamic `appVersion`

**File:** `forge.config.ts`

Two issues to fix:

1. **`iconUrl`** in `MakerSquirrel` config references owner `ralph` (incorrect). Change to
   `joegotflow83` to match the actual GitHub repo:
   ```ts
   iconUrl: 'https://raw.githubusercontent.com/joegotflow83/zephyr/master/resources/icon.ico',
   ```

2. **`appVersion`** is hardcoded to `'0.1.0'`. Read from `package.json` at config time:
   ```ts
   import { version } from './package.json';
   // ...
   packagerConfig: {
     appVersion: version,
     // ...
   }
   ```
   Ensure `tsconfig.json` has `"resolveJsonModule": true` (check — add if missing).

3. **(Optional for CI-3d)** Add `afterSign` hook for notarization:
   ```ts
   packagerConfig: {
     // ...
     osxSign: {},
     osxNotarize: {
       tool: 'notarytool',
       appleId: process.env.APPLE_ID!,
       appleIdPassword: process.env.APPLE_ID_PASSWORD!,
       teamId: process.env.APPLE_TEAM_ID!,
     },
   }
   ```
   This requires `@electron/notarize` installed as a dev dependency.

---

### Task CI-7: Update branch triggers and add `master` merge gate

**File:** `.github/workflows/ci.yml`

Once `electron-rewrite` is merged to `master`, update triggers:

```yaml
on:
  push:
    branches: [master]
  pull_request:
    branches: [master]
```

Add a branch protection rule on `master` requiring the `test` and `e2e` CI jobs to pass before
merging. This replaces any Python-era branch protection rules that gated on pytest/pyinstaller.

---

## Secrets Checklist

The following repository secrets must be configured in **Settings → Secrets and variables → Actions**
before the release pipeline is fully operational:

| Secret | Used by | Required for |
|---|---|---|
| `APPLE_ID` | `release.yml` / `forge.config.ts` | macOS notarization |
| `APPLE_ID_PASSWORD` | `release.yml` / `forge.config.ts` | macOS notarization |
| `APPLE_TEAM_ID` | `release.yml` / `forge.config.ts` | macOS notarization |
| `APPLE_CERTIFICATE` | `release.yml` | macOS code signing |
| `APPLE_CERTIFICATE_PASSWORD` | `release.yml` | macOS code signing |
| `WINDOWS_CERTIFICATE` | `release.yml` | Windows code signing |
| `WINDOWS_CERTIFICATE_PASSWORD` | `release.yml` | Windows code signing |

The `GITHUB_TOKEN` (auto-provided) is sufficient for creating GitHub Releases via `gh release create`.

---

## Execution Order

```
FC-1   Fix forge.config.ts (iconUrl, appVersion, optional notarize hook)
CI-1   Harden ci.yml (type-check, integration tests, coverage)
CI-2   Add E2E job to ci.yml
CI-4   Fix Linux system deps in release.yml
CI-3   Fix macOS signing/notarization in release.yml
CI-5   Add Windows code signing in release.yml
CI-6   Sync version from package.json in release jobs
CI-7   Update branch triggers after electron-rewrite → master merge
```

Tasks `CI-1` through `CI-6` can be implemented independently of each other.
`CI-7` must be last (after the branch merge).
