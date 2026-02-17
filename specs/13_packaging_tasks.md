# 13 — Packaging & Distribution

## Overview
Set up Electron Forge packaging for macOS, Windows, and Linux distribution.

---

### Task 1: Configure Electron Forge makers

**Context**: Replace PyInstaller with Electron Forge's built-in packaging.

**Changes**:
- Update `forge.config.ts`:
  - macOS: `@electron-forge/maker-dmg` (DMG) and `@electron-forge/maker-zip`
  - Windows: `@electron-forge/maker-squirrel` (auto-update capable installer)
  - Linux: `@electron-forge/maker-deb` and `@electron-forge/maker-rpm`
- Configure app metadata: name, description, author, license
- Set app icons per platform (icns for macOS, ico for Windows, png for Linux)
- Install required maker packages

**Acceptance**: `npm run make` produces platform-appropriate installer/bundle.

---

### Task 2: Configure app icons

**Context**: Port icon setup from `scripts/generate_icon.py` and `scripts/generate_icns.sh`.

**Changes**:
- Keep existing `resources/icon.png` as source
- Generate platform icons:
  - macOS: `resources/icon.icns` (multi-resolution)
  - Windows: `resources/icon.ico`
  - Linux: `resources/icon.png` (256x256)
- Use `electron-icon-builder` or `png2icons` npm package for generation
- Add `npm run generate-icons` script
- Reference icons in `forge.config.ts`

**Acceptance**: Built app shows correct icon on all platforms.

---

### Task 3: Configure auto-update support

**Context**: Set up Electron's built-in auto-update mechanism.

**Changes**:
- Install `electron-updater` (from `electron-builder`) or use Electron Forge's built-in publisher
- `src/services/auto-updater.ts`:
  - Check for updates on startup (after delay)
  - Notify user of available update
  - Download and install with user confirmation
  - Uses GitHub Releases as update source
- Configure `forge.config.ts` with publisher settings
- Wire to Settings tab update section

**Acceptance**: App can detect and install updates from GitHub Releases.

---

### Task 4: Create build scripts and CI configuration

**Context**: Automate builds for CI/CD.

**Changes**:
- `scripts/build.sh`:
  - Runs `npm ci`, `npm run lint`, `npm test`, `npm run make`
  - Platform detection for correct maker
  - Outputs artifacts to `out/` directory
- `.github/workflows/build.yml` (optional/template):
  - Matrix build: macOS, Windows, Linux
  - Runs tests, builds, uploads artifacts
  - Release workflow: publishes to GitHub Releases on tag push
- `scripts/notarize.js` (macOS): Apple notarization hook for Forge

**Acceptance**: `bash scripts/build.sh` produces distributable artifacts.
