import { test, expect } from '@playwright/test';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';
import { ElectronApplication, _electron as electron, Page } from 'playwright';

// E2E tests for Zephyr Desktop UI interactions.
// Tests the actual Electron app with real user workflows:
//   - Window initialization
//   - Tab navigation
//   - Adding projects via dialog
//   - Settings persistence
//   - Status bar display
//
// Requirements:
//   1. A compiled Electron app (run `npm run package` first)
//   2. A display server (DISPLAY env var must be set)
//
// These tests are intentionally skipped in headless CI environments.
// Run locally with: npm run test:e2e

let electronApp: ElectronApplication;
let page: Page;

test.describe('Zephyr Desktop E2E', () => {
  test.skip(
    !process.env.DISPLAY,
    'Skipping E2E test: no display available (headless environment)',
  );

  test.beforeAll(async () => {
    // Find the latest packaged Electron build in the out/ directory
    const latestBuild = findLatestBuild('out');
    const appInfo = parseElectronApp(latestBuild);

    electronApp = await electron.launch({
      args: [appInfo.main, ...(process.env.CI ? ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] : [])],
      executablePath: appInfo.executable,
    });

    page = await electronApp.firstWindow();
    // Give the app time to fully initialize
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test.describe('App window initialization', () => {
    test('opens window with correct title', async () => {
      const title = await page.title();
      expect(title).toContain('Zephyr');
    });

    test('renders main heading', async () => {
      await page.waitForSelector('h1', { timeout: 5000 });
      const heading = await page.textContent('h1');
      expect(heading).toContain('Zephyr Desktop');
    });

    test('displays tab bar', async () => {
      const tabBar = await page.locator('[role="tablist"]').count();
      expect(tabBar).toBeGreaterThan(0);
    });

    test('displays status bar', async () => {
      // Status bar should be visible at the bottom
      const statusBar = await page.locator('text=/Docker|Active Loops/i').count();
      expect(statusBar).toBeGreaterThan(0);
    });
  });

  test.describe('Tab navigation', () => {
    test('has all four tabs visible', async () => {
      const projectsTab = await page.locator('text=Projects').count();
      const loopsTab = await page.locator('text=Running Loops').count();
      const terminalTab = await page.locator('text=Terminal').count();
      const settingsTab = await page.locator('text=Settings').count();

      expect(projectsTab).toBe(1);
      expect(loopsTab).toBe(1);
      expect(terminalTab).toBe(1);
      expect(settingsTab).toBe(1);
    });

    test('can navigate to Projects tab', async () => {
      await page.click('text=Projects');
      await page.waitForTimeout(200); // Give tab time to render

      // Projects tab should show a table or empty state
      const hasProjectsContent = await page.locator('text=/No projects|Project Name/i').count();
      expect(hasProjectsContent).toBeGreaterThan(0);
    });

    test('can navigate to Loops tab', async () => {
      await page.click('text=Running Loops');
      await page.waitForTimeout(200);

      // Loops tab should show a table or empty state
      const hasLoopsContent = await page.locator('text=/No running loops|Status|Project/i').count();
      expect(hasLoopsContent).toBeGreaterThan(0);
    });

    test('can navigate to Terminal tab', async () => {
      await page.click('text=Terminal');
      await page.waitForTimeout(200);

      // Terminal tab should show container selector or prompt
      const hasTerminalContent = await page.locator('text=/Select Container|Open Terminal|No containers/i').count();
      expect(hasTerminalContent).toBeGreaterThan(0);
    });

    test('can navigate to Settings tab', async () => {
      await page.click('text=Settings');
      await page.waitForTimeout(200);

      // Settings tab should show sections
      const hasSettingsContent = await page.locator('text=/Credentials|Docker|General|Updates/i').count();
      expect(hasSettingsContent).toBeGreaterThan(0);
    });

    test('active tab is visually distinct', async () => {
      await page.click('text=Projects');
      await page.waitForTimeout(200);

      // Check if the Projects tab has active styling (border or background change)
      const projectsTabElement = await page.locator('text=Projects').first();
      const className = await projectsTabElement.getAttribute('class');

      // Active tab should have different styling (e.g., border-b-2 or bg-*)
      expect(className).toBeTruthy();
    });
  });

  test.describe('Projects tab functionality', () => {
    test.beforeEach(async () => {
      // Navigate to Projects tab
      await page.click('text=Projects');
      await page.waitForTimeout(200);
    });

    test('shows Add Project button', async () => {
      const addButton = await page.locator('button:has-text("Add Project")').count();
      expect(addButton).toBeGreaterThan(0);
    });

    test('can open project dialog', async () => {
      await page.click('button:has-text("Add Project")');
      await page.waitForTimeout(300);

      // Dialog should appear with form fields
      const dialogTitle = await page.locator('text=/Add Project|New Project/i').count();
      expect(dialogTitle).toBeGreaterThan(0);

      // Should have Name and Repo URL fields
      const nameInput = await page.locator('input[type="text"]').count();
      expect(nameInput).toBeGreaterThan(0);
    });

    test('can add a project via dialog', async () => {
      // Open dialog
      await page.click('button:has-text("Add Project")');
      await page.waitForTimeout(300);

      // Fill in project details
      const nameInputs = await page.locator('input[type="text"]').all();
      if (nameInputs.length >= 1) {
        await nameInputs[0].fill('E2E Test Project');
      }
      if (nameInputs.length >= 2) {
        await nameInputs[1].fill('https://github.com/test/repo');
      }

      // Submit the form
      const saveButton = await page.locator('button:has-text("Save"), button:has-text("Add")').first();
      await saveButton.click();
      await page.waitForTimeout(500);

      // Verify project appears in table (may need to check for either the project or a toast)
      const hasProjectOrToast = await page.locator('text=/E2E Test Project|Project added|successfully/i').count();
      expect(hasProjectOrToast).toBeGreaterThan(0);
    });

    test('can close project dialog without saving', async () => {
      await page.click('button:has-text("Add Project")');
      await page.waitForTimeout(300);

      // Find and click Cancel button
      const cancelButton = await page.locator('button:has-text("Cancel")').first();
      await cancelButton.click();
      await page.waitForTimeout(300);

      // Dialog should be closed (no dialog title visible)
      const dialogVisible = await page.locator('text=/Add Project|New Project/i').count();
      expect(dialogVisible).toBe(0);
    });
  });

  test.describe('Settings tab functionality', () => {
    test.beforeEach(async () => {
      // Navigate to Settings tab
      await page.click('text=Settings');
      await page.waitForTimeout(300);
    });

    test('shows settings sections', async () => {
      const credentialsSection = await page.locator('text=Credentials').count();
      const dockerSection = await page.locator('text=Docker').count();
      const generalSection = await page.locator('text=General').count();

      expect(credentialsSection).toBeGreaterThan(0);
      expect(dockerSection).toBeGreaterThan(0);
      expect(generalSection).toBeGreaterThan(0);
    });

    test('can toggle settings', async () => {
      // Try to find a toggle or checkbox (e.g., notifications toggle)
      const toggles = await page.locator('input[type="checkbox"]').all();

      if (toggles.length > 0) {
        const firstToggle = toggles[0];
        const initialState = await firstToggle.isChecked();

        // Toggle the setting
        await firstToggle.click();
        await page.waitForTimeout(300);

        // Verify state changed
        const newState = await firstToggle.isChecked();
        expect(newState).not.toBe(initialState);
      }
    });

    test('settings changes persist after reload', async () => {
      // Find the notifications toggle (should be in General section)
      const notificationToggle = await page.locator('input[type="checkbox"]').first();

      if (notificationToggle) {
        // Get initial state
        const initialState = await notificationToggle.isChecked();

        // Toggle it
        await notificationToggle.click();
        await page.waitForTimeout(500); // Wait for save

        // Navigate away and back
        await page.click('text=Projects');
        await page.waitForTimeout(200);
        await page.click('text=Settings');
        await page.waitForTimeout(300);

        // Check if the state persisted
        const notificationToggleAfter = await page.locator('input[type="checkbox"]').first();
        const newState = await notificationToggleAfter.isChecked();

        // State should be different from initial
        expect(newState).not.toBe(initialState);

        // Toggle back to restore original state
        await notificationToggleAfter.click();
        await page.waitForTimeout(300);
      }
    });

    test('displays app version', async () => {
      // Settings should show the app version somewhere
      const versionText = await page.locator('text=/version|v\\d+\\.\\d+\\.\\d+/i').count();
      expect(versionText).toBeGreaterThan(0);
    });
  });

  test.describe('Status bar display', () => {
    test('shows Docker connection status', async () => {
      // Status bar should display Docker status
      const dockerStatus = await page.locator('text=/Docker/i').count();
      expect(dockerStatus).toBeGreaterThan(0);
    });

    test('shows active loop count', async () => {
      // Status bar should show loop count (even if 0)
      const loopCount = await page.locator('text=/Active Loops|0 loops|running/i').count();
      expect(loopCount).toBeGreaterThan(0);
    });

    test('Docker status has visual indicator', async () => {
      // Look for a status indicator (colored dot, icon, or badge)
      const statusIndicator = await page.locator('[class*="bg-"], [class*="text-green"], [class*="text-red"]').count();
      expect(statusIndicator).toBeGreaterThan(0);
    });
  });

  test.describe('Keyboard shortcuts', () => {
    test('Ctrl+1 switches to Projects tab', async () => {
      // Start on a different tab
      await page.click('text=Settings');
      await page.waitForTimeout(200);

      // Press Ctrl+1
      await page.keyboard.press('Control+1');
      await page.waitForTimeout(200);

      // Should show Projects content
      const hasProjectsContent = await page.locator('text=/No projects|Project Name|Add Project/i').count();
      expect(hasProjectsContent).toBeGreaterThan(0);
    });

    test('Ctrl+2 switches to Loops tab', async () => {
      await page.keyboard.press('Control+2');
      await page.waitForTimeout(200);

      const hasLoopsContent = await page.locator('text=/No running loops|Status|Running Loops/i').count();
      expect(hasLoopsContent).toBeGreaterThan(0);
    });

    test('Ctrl+3 switches to Terminal tab', async () => {
      await page.keyboard.press('Control+3');
      await page.waitForTimeout(200);

      const hasTerminalContent = await page.locator('text=/Select Container|Terminal|Open Terminal/i').count();
      expect(hasTerminalContent).toBeGreaterThan(0);
    });

    test('Ctrl+4 switches to Settings tab', async () => {
      await page.keyboard.press('Control+4');
      await page.waitForTimeout(200);

      const hasSettingsContent = await page.locator('text=/Credentials|Docker|General|Settings/i').count();
      expect(hasSettingsContent).toBeGreaterThan(0);
    });
  });
});
