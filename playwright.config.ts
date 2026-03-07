import { defineConfig } from '@playwright/test';
import path from 'path';

// Playwright E2E configuration for Electron app testing.
// Uses electron-playwright-helpers to launch the packaged Electron app
// and interact with its windows as a real user would.
// E2E tests require a display (DISPLAY env var) and a built app — they are
// skipped in headless CI environments without a display server.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120000,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    // Capture screenshot on failure for debugging
    screenshot: 'only-on-failure',
    // Capture video on first retry
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'electron',
      use: {
        // The Electron app entry point (compiled by Vite/Electron Forge)
        // Tests must call electronApp = await electron.launch({ args: ['.'] })
        // from within the test using electron-playwright-helpers.
      },
    },
  ],
});
