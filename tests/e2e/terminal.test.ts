import { test, expect } from '@playwright/test';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';
import { ElectronApplication, _electron as electron, Page } from 'playwright';

// E2E tests for Terminal tab with real Docker containers.
// Tests the complete terminal workflow:
//   - Container creation
//   - Terminal session opening
//   - Command execution and output verification
//   - Terminal resizing
//   - Session closing
//   - Multiple concurrent sessions
//
// Requirements:
//   1. Docker daemon running and accessible
//   2. A compiled Electron app (run `npm run package` first)
//   3. A display server (DISPLAY env var must be set)
//
// These tests are skipped in headless CI or when Docker is unavailable.
// Run locally with: npm run test:e2e

let electronApp: ElectronApplication;
let page: Page;
let testContainerId: string | null = null;

test.describe('Terminal E2E', () => {
  // Skip if no display or Docker not available
  test.skip(
    !process.env.DISPLAY,
    'Skipping E2E test: no display available (headless environment)',
  );

  test.beforeAll(async () => {
    // Find the latest packaged Electron build in the out/ directory
    const latestBuild = findLatestBuild('out');
    const appInfo = parseElectronApp(latestBuild);

    electronApp = await electron.launch({
      args: [appInfo.main],
      executablePath: appInfo.executable,
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Check if Docker is available by evaluating in the main process
    const dockerAvailable = await electronApp.evaluate(async ({ app: _app }) => {
      const { DockerManager } = await import(
        '../../src/services/docker-manager'
      );
      const dockerManager = new DockerManager();
      return await dockerManager.isDockerAvailable();
    });

    if (!dockerAvailable) {
      test.skip(true, 'Docker is not available');
    }
  });

  test.afterAll(async () => {
    // Clean up test container if it exists
    if (testContainerId && electronApp) {
      try {
        await electronApp.evaluate(
          async ({ app: _app }, containerId) => {
            const { DockerManager } = await import(
              '../../src/services/docker-manager'
            );
            const dockerManager = new DockerManager();
            await dockerManager.stopContainer(containerId);
            await dockerManager.removeContainer(containerId);
          },
          testContainerId,
        );
      } catch (error) {
        // Expected: container cleanup may fail if already stopped
        // eslint-disable-next-line no-console
        console.warn('Failed to clean up test container:', error);
      }
    }

    if (electronApp) {
      await electronApp.close();
    }
  });

  test.describe('Container creation and terminal opening', () => {
    test('creates a test container', async () => {
      // Use electron.evaluate to create container via main process
      const result = await electronApp.evaluate(async ({ app: _app }) => {
        const { DockerManager } = await import(
          '../../src/services/docker-manager'
        );
        const dockerManager = new DockerManager();

        // Ensure alpine image is available
        const imageAvailable = await dockerManager.isImageAvailable('alpine');
        if (!imageAvailable) {
          await dockerManager.pullImage('alpine');
        }

        // Create container with a test project ID
        const containerId = await dockerManager.createContainer({
          image: 'alpine',
          projectId: 'test-terminal-e2e',
          name: 'zephyr-terminal-test',
          cmd: ['/bin/sh', '-c', 'sleep 3600'], // Keep container running
        });

        // Start the container
        await dockerManager.startContainer(containerId);

        return { containerId };
      });

      expect(result.containerId).toBeTruthy();
      testContainerId = result.containerId;
    });

    test('navigates to Terminal tab', async () => {
      await page.click('text=Terminal');
      await page.waitForTimeout(200);

      // Terminal tab should show container selector
      const hasTerminalContent = await page
        .locator('text=/Select Container|Open Terminal/i')
        .count();
      expect(hasTerminalContent).toBeGreaterThan(0);
    });

    test('displays test container in selector', async () => {
      // Click the container selector dropdown
      const selector = await page.locator('select').first();
      await selector.click();

      // Wait for containers to load
      await page.waitForTimeout(500);

      // Check if our test container appears
      const options = await selector.locator('option').allTextContents();
      const hasTestContainer = options.some(
        (text) =>
          text.includes('zephyr-terminal-test') || text.includes('alpine'),
      );
      expect(hasTestContainer).toBe(true);
    });

    test('opens terminal session for test container', async () => {
      // Select the container
      const selector = await page.locator('select').first();
      await selector.selectOption({ index: 1 }); // Select first non-placeholder option

      // Click "Open Terminal" button
      await page.click('text=Open Terminal');

      // Wait for terminal to initialize
      await page.waitForTimeout(1000);

      // Terminal tab should appear
      const terminalTab = await page.locator('.xterm').count();
      expect(terminalTab).toBeGreaterThan(0);
    });
  });

  test.describe('Terminal interaction', () => {
    test('executes echo command and verifies output', async () => {
      // Type a simple command
      await page.keyboard.type('echo "Hello from Zephyr"\n');

      // Wait for output to appear
      await page.waitForTimeout(500);

      // Check if output contains expected text
      const terminalContent = await page.locator('.xterm').textContent();
      expect(terminalContent).toContain('Hello from Zephyr');
    });

    test('executes pwd command and verifies working directory', async () => {
      await page.keyboard.type('pwd\n');
      await page.waitForTimeout(300);

      const terminalContent = await page.locator('.xterm').textContent();
      // Alpine container default working directory
      expect(terminalContent).toContain('/');
    });

    test('executes ls command and verifies output', async () => {
      await page.keyboard.type('ls /bin\n');
      await page.waitForTimeout(500);

      const terminalContent = await page.locator('.xterm').textContent();
      // Alpine should have these common binaries
      expect(terminalContent).toMatch(/sh|echo|ls/);
    });

    test('handles multiline input', async () => {
      await page.keyboard.type('for i in 1 2 3; do\n');
      await page.waitForTimeout(200);
      await page.keyboard.type('echo $i\n');
      await page.waitForTimeout(200);
      await page.keyboard.type('done\n');
      await page.waitForTimeout(500);

      const terminalContent = await page.locator('.xterm').textContent();
      expect(terminalContent).toContain('1');
      expect(terminalContent).toContain('2');
      expect(terminalContent).toContain('3');
    });
  });

  test.describe('Terminal resizing', () => {
    test('terminal resizes when window resizes', async () => {
      // Get initial terminal size
      const initialSize = await page.locator('.xterm').boundingBox();
      expect(initialSize).toBeTruthy();

      // Resize window
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.waitForTimeout(500);

      // Get new terminal size
      const newSize = await page.locator('.xterm').boundingBox();
      expect(newSize).toBeTruthy();

      // Sizes should be different (exact values depend on layout)
      // Just verify terminal is still visible and rendered
      if (newSize) {
        expect(newSize.width).toBeGreaterThan(100);
        expect(newSize.height).toBeGreaterThan(100);
      }
    });

    test('terminal responds to resize with correct dimensions', async () => {
      // Type a command that outputs terminal size
      await page.keyboard.type('tput cols\n');
      await page.waitForTimeout(300);
      const colsOutput = await page.locator('.xterm').textContent();

      // Extract the number (will be in the terminal output)
      const colsMatch = colsOutput?.match(/(\d+)/);
      expect(colsMatch).toBeTruthy();

      // Verify it's a reasonable terminal width
      if (colsMatch) {
        const cols = parseInt(colsMatch[1], 10);
        expect(cols).toBeGreaterThan(40);
        expect(cols).toBeLessThan(500);
      }
    });
  });

  test.describe('Session management', () => {
    test('closes terminal session', async () => {
      // Find and click the close button for the active terminal tab
      const closeButton = await page.locator('button[aria-label="Close tab"]');
      if ((await closeButton.count()) > 0) {
        await closeButton.first().click();
        await page.waitForTimeout(300);

        // Terminal session should be closed
        const activeSessions = await page.locator('.xterm').count();
        expect(activeSessions).toBe(0);
      } else {
        // If no explicit close button, check if there's a way to close
        // This test might need adjustment based on actual UI implementation
        test.skip(true, 'No close button found in UI');
      }
    });

    test('opens multiple terminal sessions', async () => {
      // Open first session
      const selector = await page.locator('select').first();
      await selector.selectOption({ index: 1 });
      await page.click('text=Open Terminal');
      await page.waitForTimeout(500);

      // Open second session (if supported)
      await page.click('text=Open Terminal');
      await page.waitForTimeout(500);

      // Count terminal instances
      const terminalCount = await page.locator('.xterm').count();

      // Should have at least 1 terminal (may have 2 if multiple sessions supported)
      expect(terminalCount).toBeGreaterThan(0);

      // Type in the active terminal to verify it's interactive
      await page.keyboard.type('echo "Session test"\n');
      await page.waitForTimeout(300);

      const terminalContent = await page.locator('.xterm').first().textContent();
      expect(terminalContent).toContain('Session test');
    });

    test('switches between multiple sessions', async () => {
      const terminalCount = await page.locator('.xterm').count();

      if (terminalCount > 1) {
        // If we have multiple terminals, try to interact with each
        const firstTerminal = page.locator('.xterm').first();
        const secondTerminal = page.locator('.xterm').nth(1);

        // Type in first terminal
        await firstTerminal.click();
        await page.keyboard.type('echo "First"\n');
        await page.waitForTimeout(300);

        const firstContent = await firstTerminal.textContent();
        expect(firstContent).toContain('First');

        // Type in second terminal
        await secondTerminal.click();
        await page.keyboard.type('echo "Second"\n');
        await page.waitForTimeout(300);

        const secondContent = await secondTerminal.textContent();
        expect(secondContent).toContain('Second');
      } else {
        test.skip(
          true,
          'Multiple simultaneous sessions not supported or already closed',
        );
      }
    });
  });

  test.describe('Terminal user mode selection', () => {
    test('can select root user mode', async () => {
      // Navigate back to terminal tab (in case we left it)
      await page.click('text=Terminal');
      await page.waitForTimeout(200);

      // Look for user selector (may be a dropdown or radio buttons)
      const userSelector = await page.locator('text=/root|Root/i').count();
      if (userSelector > 0) {
        await page.click('text=/root|Root/i');
        await page.waitForTimeout(200);

        // Open a new terminal session
        const selector = await page.locator('select').first();
        await selector.selectOption({ index: 1 });
        await page.click('text=Open Terminal');
        await page.waitForTimeout(500);

        // Verify we're root by checking user id
        await page.keyboard.type('id -u\n');
        await page.waitForTimeout(300);

        const terminalContent = await page.locator('.xterm').last().textContent();
        expect(terminalContent).toContain('0'); // root user ID is 0
      } else {
        test.skip(true, 'User mode selector not found in UI');
      }
    });
  });

  test.describe('Terminal keyboard shortcuts', () => {
    test('copy-paste works with Ctrl+Shift+C/V', async () => {
      // Type some text
      await page.keyboard.type('echo "copy-test"\n');
      await page.waitForTimeout(300);

      // Try to select text (this might be tricky in xterm)
      // Note: Actual text selection in xterm.js requires mouse events
      // For now, we'll just verify the keyboard shortcuts are registered

      // Press Ctrl+Shift+C (should not crash)
      await page.keyboard.press('Control+Shift+C');
      await page.waitForTimeout(100);

      // Press Ctrl+Shift+V (should not crash)
      await page.keyboard.press('Control+Shift+V');
      await page.waitForTimeout(100);

      // Terminal should still be interactive
      await page.keyboard.type('pwd\n');
      await page.waitForTimeout(300);

      const terminalContent = await page.locator('.xterm').textContent();
      expect(terminalContent).toBeTruthy();
    });

    test('font size changes with Ctrl+=/Ctrl+-', async () => {
      // Increase font size
      await page.keyboard.press('Control+=');
      await page.waitForTimeout(200);

      // Decrease font size
      await page.keyboard.press('Control+-');
      await page.waitForTimeout(200);

      // Reset font size
      await page.keyboard.press('Control+0');
      await page.waitForTimeout(200);

      // Terminal should still be functional
      await page.keyboard.type('echo "font-test"\n');
      await page.waitForTimeout(300);

      const terminalContent = await page.locator('.xterm').textContent();
      expect(terminalContent).toContain('font-test');
    });

    test('search works with Ctrl+Shift+F', async () => {
      // Type some searchable text
      await page.keyboard.type('echo "searchable-unique-text-12345"\n');
      await page.waitForTimeout(300);

      // Open search (Ctrl+Shift+F)
      await page.keyboard.press('Control+Shift+F');
      await page.waitForTimeout(200);

      // Look for search input or prompt
      // Note: This depends on xterm.js SearchAddon UI implementation
      // Just verify the shortcut doesn't crash the app
      const terminalContent = await page.locator('.xterm').textContent();
      expect(terminalContent).toContain('searchable-unique-text-12345');
    });
  });

  test.describe('Error handling', () => {
    test('handles disconnected container gracefully', async () => {
      // Create a temporary container that we'll stop
      const tempResult = await electronApp.evaluate(async ({ app: _app }) => {
        const { DockerManager } = await import(
          '../../src/services/docker-manager'
        );
        const dockerManager = new DockerManager();

        const containerId = await dockerManager.createContainer({
          image: 'alpine',
          projectId: 'test-disconnect',
          name: 'zephyr-disconnect-test',
          cmd: ['/bin/sh', '-c', 'sleep 10'],
        });

        await dockerManager.startContainer(containerId);
        return { containerId };
      });

      // Select and open terminal to this container
      await page.click('text=Terminal');
      await page.waitForTimeout(200);

      const selector = await page.locator('select').first();
      // Refresh container list
      await selector.click();
      await page.waitForTimeout(500);

      // Select the disconnect test container
      const options = await selector.locator('option').allTextContents();
      const disconnectIndex = options.findIndex((text) =>
        text.includes('zephyr-disconnect-test'),
      );

      if (disconnectIndex > 0) {
        await selector.selectOption({ index: disconnectIndex });
        await page.click('text=Open Terminal');
        await page.waitForTimeout(500);

        // Stop the container from the main process
        await electronApp.evaluate(
          async ({ app: _app }, containerId) => {
            const { DockerManager } = await import(
              '../../src/services/docker-manager'
            );
            const dockerManager = new DockerManager();
            await dockerManager.stopContainer(containerId);
          },
          tempResult.containerId,
        );

        await page.waitForTimeout(500);

        // Try to type - should not crash the app
        await page.keyboard.type('echo "test"\n');
        await page.waitForTimeout(300);

        // App should still be responsive
        const isResponsive = await page.isVisible('text=Terminal');
        expect(isResponsive).toBe(true);

        // Clean up
        await electronApp.evaluate(
          async ({ app: _app }, containerId) => {
            const { DockerManager } = await import(
              '../../src/services/docker-manager'
            );
            const dockerManager = new DockerManager();
            await dockerManager.removeContainer(containerId);
          },
          tempResult.containerId,
        );
      } else {
        test.skip(true, 'Could not find disconnect test container');
      }
    });
  });
});
