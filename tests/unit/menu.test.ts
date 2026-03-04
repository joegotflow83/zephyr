/**
 * Unit tests for src/main/menu.ts
 *
 * Verifies that buildApplicationMenu() creates a valid Electron menu structure
 * with all required menu items (File, Edit, View, Help), correct labels,
 * accelerators, and appropriate menu actions.
 *
 * Why we test the menu: The menu is a critical user-facing feature. A missing
 * menu item or broken accelerator degrades UX. Testing the menu structure
 * ensures all items are present and properly configured.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Menu, MenuItemConstructorOptions, MessageBoxReturnValue, BrowserWindow } from 'electron';

// ── Mock electron ────────────────────────────────────────────────────────────

const { mockApp, mockDialog, mockShell, mockMenu, mockBrowserWindow, getBuiltMenu, getApplicationMenu, setBuiltMenu, setApplicationMenu } = vi.hoisted(() => {
  let builtMenu: MenuItemConstructorOptions[] | null = null;
  let applicationMenu: Menu | null = null;

  const mockApp = {
    getVersion: vi.fn(() => '0.1.0'),
    quit: vi.fn(),
    name: 'Zephyr Desktop',
  };

  const mockDialog = {
    showMessageBox: vi.fn<[options: Electron.MessageBoxOptions], Promise<MessageBoxReturnValue>>(),
  };

  const mockShell = {
    openExternal: vi.fn<[url: string], Promise<void>>(),
  };

  const mockMenu = {
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]): Menu => {
      builtMenu = template;
      return { items: template } as unknown as Menu;
    }),
    setApplicationMenu: vi.fn((menu: Menu | null) => {
      applicationMenu = menu;
    }),
  };

  const mockBrowserWindow = {
    getFocusedWindow: vi.fn(),
    getAllWindows: vi.fn(() => []),
  };

  return {
    mockApp,
    mockDialog,
    mockShell,
    mockMenu,
    mockBrowserWindow,
    getBuiltMenu: () => builtMenu,
    getApplicationMenu: () => applicationMenu,
    setBuiltMenu: (menu: MenuItemConstructorOptions[] | null) => { builtMenu = menu; },
    setApplicationMenu: (menu: Menu | null) => { applicationMenu = menu; },
  };
});

vi.mock('electron', () => ({
  Menu: mockMenu,
  dialog: mockDialog,
  app: mockApp,
  shell: mockShell,
  BrowserWindow: mockBrowserWindow,
}));

// ── Import subject under test (after mocks are in place) ─────────────────────

import { buildApplicationMenu, clearApplicationMenu } from '../../src/main/menu';

// ── Setup ─────────────────────────────────────────────────────────────────────

describe('menu.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setBuiltMenu(null);
    setApplicationMenu(null);
  });

  afterEach(() => {
    clearApplicationMenu();
  });

  describe('buildApplicationMenu()', () => {
    it('builds and sets the application menu', () => {
      const menu = buildApplicationMenu();

      expect(mockMenu.buildFromTemplate).toHaveBeenCalledOnce();
      expect(mockMenu.setApplicationMenu).toHaveBeenCalledWith(menu);
      expect(getBuiltMenu()).toBeTruthy();
    });

    it('creates File menu with Import Config, Export Config, and Quit items', () => {
      buildApplicationMenu();

      expect(getBuiltMenu()).toBeTruthy();
      const fileMenu = getBuiltMenu()!.find((item) => item.label === 'File');
      expect(fileMenu).toBeTruthy();
      expect(fileMenu!.submenu).toBeInstanceOf(Array);

      const submenu = fileMenu!.submenu as MenuItemConstructorOptions[];
      const labels = submenu.map((item) => item.label || item.type);

      expect(labels).toContain('Import Config...');
      expect(labels).toContain('Export Config...');
      expect(labels).toContain('separator');
      expect(labels).toContain('Quit');
    });

    it('assigns accelerators to Import (CmdOrCtrl+O) and Export (CmdOrCtrl+S)', () => {
      buildApplicationMenu();

      const fileMenu = getBuiltMenu()!.find((item) => item.label === 'File');
      const submenu = fileMenu!.submenu as MenuItemConstructorOptions[];

      const importItem = submenu.find((item) => item.label === 'Import Config...');
      expect(importItem?.accelerator).toBe('CmdOrCtrl+O');

      const exportItem = submenu.find((item) => item.label === 'Export Config...');
      expect(exportItem?.accelerator).toBe('CmdOrCtrl+Shift+S');
    });

    it('assigns accelerator to Quit (CmdOrCtrl+Q)', () => {
      buildApplicationMenu();

      const fileMenu = getBuiltMenu()!.find((item) => item.label === 'File');
      const submenu = fileMenu!.submenu as MenuItemConstructorOptions[];

      const quitItem = submenu.find((item) => item.label === 'Quit');
      expect(quitItem?.accelerator).toBe('CmdOrCtrl+Q');
    });

    it('Quit menu item calls app.quit() when clicked', async () => {
      buildApplicationMenu();

      const fileMenu = getBuiltMenu()!.find((item) => item.label === 'File');
      const submenu = fileMenu!.submenu as MenuItemConstructorOptions[];
      const quitItem = submenu.find((item) => item.label === 'Quit');

      expect(quitItem?.click).toBeDefined();
      await quitItem!.click!({} as any, {} as any, {} as any);

      expect(mockApp.quit).toHaveBeenCalledOnce();
    });

    it('creates Edit menu with standard edit roles', () => {
      buildApplicationMenu();

      const editMenu = getBuiltMenu()!.find((item) => item.label === 'Edit');
      expect(editMenu).toBeTruthy();

      const submenu = editMenu!.submenu as MenuItemConstructorOptions[];
      const roles = submenu.map((item) => item.role || item.type);

      expect(roles).toContain('undo');
      expect(roles).toContain('redo');
      expect(roles).toContain('separator');
      expect(roles).toContain('cut');
      expect(roles).toContain('copy');
      expect(roles).toContain('paste');
      expect(roles).toContain('selectAll');
    });

    it('creates View menu with reload, devtools, and zoom roles', () => {
      buildApplicationMenu();

      const viewMenu = getBuiltMenu()!.find((item) => item.label === 'View');
      expect(viewMenu).toBeTruthy();

      const submenu = viewMenu!.submenu as MenuItemConstructorOptions[];
      const roles = submenu.map((item) => item.role || item.type);

      expect(roles).toContain('reload');
      expect(roles).toContain('forceReload');
      expect(roles).toContain('toggleDevTools');
      expect(roles).toContain('resetZoom');
      expect(roles).toContain('zoomIn');
      expect(roles).toContain('zoomOut');
      expect(roles).toContain('togglefullscreen');
    });

    it('creates Help menu with About and Documentation items', () => {
      buildApplicationMenu();

      const helpMenu = getBuiltMenu()!.find((item) => item.label === 'Help');
      expect(helpMenu).toBeTruthy();

      const submenu = helpMenu!.submenu as MenuItemConstructorOptions[];
      const labels = submenu.map((item) => item.label);

      expect(labels).toContain('About Zephyr Desktop');
      expect(labels).toContain('Documentation');
    });

    it('About menu item shows message box with version when clicked', async () => {
      mockDialog.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false });
      buildApplicationMenu();

      const helpMenu = getBuiltMenu()!.find((item) => item.label === 'Help');
      const submenu = helpMenu!.submenu as MenuItemConstructorOptions[];
      const aboutItem = submenu.find((item) => item.label === 'About Zephyr Desktop');

      expect(aboutItem?.click).toBeDefined();
      await aboutItem!.click!({} as any, {} as any, {} as any);

      expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
      const callArgs = mockDialog.showMessageBox.mock.calls[0][0];
      expect(callArgs.title).toBe('About Zephyr Desktop');
      expect(callArgs.message).toBe('Zephyr Desktop');
      expect(callArgs.detail).toContain('Version: 0.1.0');
      expect(callArgs.detail).toContain('AI loop execution manager');
    });

    it('Documentation menu item opens external URL when clicked', async () => {
      mockShell.openExternal.mockResolvedValue();
      buildApplicationMenu();

      const helpMenu = getBuiltMenu()!.find((item) => item.label === 'Help');
      const submenu = helpMenu!.submenu as MenuItemConstructorOptions[];
      const docItem = submenu.find((item) => item.label === 'Documentation');

      expect(docItem?.click).toBeDefined();
      await docItem!.click!({} as any, {} as any, {} as any);

      expect(mockShell.openExternal).toHaveBeenCalledWith(
        'https://github.com/anthropics/zephyr-desktop'
      );
    });

    it('Import Config sends IPC event to focused window when clicked', async () => {
      const mockWebContents = { send: vi.fn() };
      const mockWindow = { webContents: mockWebContents };
      mockBrowserWindow.getFocusedWindow.mockReturnValue(mockWindow as unknown as BrowserWindow);

      buildApplicationMenu();

      const fileMenu = getBuiltMenu()!.find((item) => item.label === 'File');
      const submenu = fileMenu!.submenu as MenuItemConstructorOptions[];
      const importItem = submenu.find((item) => item.label === 'Import Config...');

      expect(importItem?.click).toBeDefined();
      await importItem!.click!({} as any, {} as any, {} as any);

      expect(mockWebContents.send).toHaveBeenCalledWith('menu:import-config');
    });

    it('Export Config sends IPC event to focused window when clicked', async () => {
      const mockWebContents = { send: vi.fn() };
      const mockWindow = { webContents: mockWebContents };
      mockBrowserWindow.getFocusedWindow.mockReturnValue(mockWindow as unknown as BrowserWindow);

      buildApplicationMenu();

      const fileMenu = getBuiltMenu()!.find((item) => item.label === 'File');
      const submenu = fileMenu!.submenu as MenuItemConstructorOptions[];
      const exportItem = submenu.find((item) => item.label === 'Export Config...');

      expect(exportItem?.click).toBeDefined();
      await exportItem!.click!({} as any, {} as any, {} as any);

      expect(mockWebContents.send).toHaveBeenCalledWith('menu:export-config');
    });

    it('Import Config does nothing when no window is focused', async () => {
      mockBrowserWindow.getFocusedWindow.mockReturnValue(null);

      buildApplicationMenu();

      const fileMenu = getBuiltMenu()!.find((item) => item.label === 'File');
      const submenu = fileMenu!.submenu as MenuItemConstructorOptions[];
      const importItem = submenu.find((item) => item.label === 'Import Config...');

      // Should not throw
      await expect(importItem!.click!({} as any, {} as any, {} as any)).resolves.toBeUndefined();
    });

    it('Export Config does nothing when no window is focused', async () => {
      mockBrowserWindow.getFocusedWindow.mockReturnValue(null);

      buildApplicationMenu();

      const fileMenu = getBuiltMenu()!.find((item) => item.label === 'File');
      const submenu = fileMenu!.submenu as MenuItemConstructorOptions[];
      const exportItem = submenu.find((item) => item.label === 'Export Config...');

      // Should not throw
      await expect(exportItem!.click!({} as any, {} as any, {} as any)).resolves.toBeUndefined();
    });
  });

  describe('clearApplicationMenu()', () => {
    it('sets application menu to null', () => {
      buildApplicationMenu();
      expect(getApplicationMenu()).not.toBeNull();

      clearApplicationMenu();
      expect(mockMenu.setApplicationMenu).toHaveBeenCalledWith(null);
    });
  });
});
