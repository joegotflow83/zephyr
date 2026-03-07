import { test, expect } from '@playwright/test';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';
import { ElectronApplication, _electron as electron } from 'playwright';
import { spawn } from 'child_process';
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

    // Diagnostic: spawn the binary briefly to capture stderr (Playwright doesn't expose it)
    if (process.env.CI) {
      await new Promise<void>((resolve) => {
        console.log('=== Diagnostic: spawning binary for 5s ===');
        const proc = spawn(appInfo.executable, [
          '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
          '--enable-logging', '--v=1',
        ], { timeout: 5000, env: { ...process.env, ELECTRON_ENABLE_LOGGING: 'true' } });
        proc.stdout.on('data', (d: Buffer) => console.log('ELECTRON STDOUT:', d.toString()));
        proc.stderr.on('data', (d: Buffer) => console.log('ELECTRON STDERR:', d.toString()));
        proc.on('error', (err) => console.log('ELECTRON SPAWN ERROR:', err.message));
        proc.on('close', (code, signal) => {
          console.log(`=== Diagnostic done: exit code=${code}, signal=${signal} ===`);
          resolve();
        });
        // Force kill after 5s in case timeout doesn't work
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 5000);
      });
    }

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
