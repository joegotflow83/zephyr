// Native Electron menu bar for Zephyr Desktop.
// Creates File menu (Import/Export config, Quit) and Help menu (About).
// Import/Export trigger IPC handlers that were registered in data-handlers.ts.

import { Menu, dialog, app, BrowserWindow, shell } from 'electron';

/**
 * Build and set the application menu bar.
 * Call this after app is ready and services are initialized.
 */
export function buildApplicationMenu(): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Import Config...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            // Trigger the import handler which shows the file dialog
            const mainWindow = BrowserWindow.getFocusedWindow();
            if (mainWindow) {
              // Send IPC to the main window to trigger import
              // The data-handlers already has CONFIG_IMPORT registered
              mainWindow.webContents.send('menu:import-config');
            }
          },
        },
        {
          label: 'Export Config...',
          accelerator: 'CmdOrCtrl+S',
          click: async () => {
            // Trigger the export handler which shows the file dialog
            const mainWindow = BrowserWindow.getFocusedWindow();
            if (mainWindow) {
              // Send IPC to the main window to trigger export
              mainWindow.webContents.send('menu:export-config');
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Zephyr Desktop',
          click: async () => {
            await dialog.showMessageBox({
              type: 'info',
              title: 'About Zephyr Desktop',
              message: 'Zephyr Desktop',
              detail: `Version: ${app.getVersion()}\n\nAI loop execution manager with Docker integration.\n\nBuilt with Electron, React, and TypeScript.`,
              buttons: ['OK'],
            });
          },
        },
        {
          label: 'Documentation',
          click: async () => {
            await shell.openExternal('https://github.com/anthropics/zephyr-desktop');
          },
        },
      ],
    },
  ];

  // macOS-specific menu additions
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        {
          label: 'About Zephyr Desktop',
          click: async () => {
            await dialog.showMessageBox({
              type: 'info',
              title: 'About Zephyr Desktop',
              message: 'Zephyr Desktop',
              detail: `Version: ${app.getVersion()}\n\nAI loop execution manager with Docker integration.\n\nBuilt with Electron, React, and TypeScript.`,
              buttons: ['OK'],
            });
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}

/**
 * Remove the application menu (useful for testing).
 */
export function clearApplicationMenu(): void {
  Menu.setApplicationMenu(null);
}
