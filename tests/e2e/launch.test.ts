import { test, expect } from '@playwright/test';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';
import { ElectronApplication, _electron as electron } from 'playwright';
import path from 'path';

// E2E smoke test: verify the Electron app window opens and renders the main UI.
// This test requires:
//   1. A compiled Electron app (run `npm run package` first)
//   2. A display server (DISPLAY env var must be set)
//
// These tests are intentionally skipped in headless CI environments.
// Run locally with: npm run test:e2e

let electronApp: ElectronApplication;

test.describe('Electron app launch', () => {
  test.skip(
    !process.env.DISPLAY,
    'Skipping E2E test: no display available (headless environment)',
  );

  test.beforeAll(async () => {
    // Find the latest packaged Electron build in the out/ directory
    const latestBuild = findLatestBuild('out');
    const appInfo = parseElectronApp(latestBuild);

    // For packaged apps the executable loads from its embedded asar automatically.
    // Do NOT pass appInfo.main as args — that file is inside the asar and not on disk,
    // which causes Electron to silently exit (OnlyLoadAppFromAsar fuse blocks it).
    console.log('appInfo:', JSON.stringify(appInfo, null, 2));
    electronApp = await electron.launch({
      executablePath: appInfo.executable,
      args: process.env.CI
        ? ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--enable-logging', '--v=1']
        : [],
      timeout: 90_000,
    });
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('opens a window', async () => {
    const windowCount = electronApp.windows().length;
    expect(windowCount).toBeGreaterThan(0);
  });

  test('window has correct title', async () => {
    const page = await electronApp.firstWindow();
    const title = await page.title();
    expect(title).toContain('Zephyr');
  });

  test('renders main heading', async () => {
    const page = await electronApp.firstWindow();
    await page.waitForSelector('h1');
    const heading = await page.textContent('h1');
    expect(heading).toContain('Zephyr Desktop');
  });
});
