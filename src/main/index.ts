import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { ConfigManager } from '../services/config-manager';
import { ProjectStore } from '../services/project-store';
import { ImportExportService } from '../services/import-export';
import { DockerManager } from '../services/docker-manager';
import { DockerHealthMonitor } from '../services/docker-health';
import { CredentialManager } from '../services/credential-manager';
import { LoginManager } from '../services/login-manager';
import { registerDataHandlers } from './ipc-handlers/data-handlers';
import { registerDockerHandlers } from './ipc-handlers/docker-handlers';
import { registerCredentialHandlers } from './ipc-handlers/credential-handlers';
import { IPC } from '../shared/ipc-channels';
import os from 'node:os';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Instantiate services once at startup.
const configManager = new ConfigManager();
const projectStore = new ProjectStore(configManager);
const importExport = new ImportExportService(configManager);
const dockerManager = new DockerManager();
const dockerHealth = new DockerHealthMonitor(dockerManager);
const credentialManager = new CredentialManager(
  path.join(os.homedir(), '.zephyr')
);
const loginManager = new LoginManager(credentialManager);

// Register all IPC handlers before the window is created.
registerDataHandlers({ configManager, projectStore, importExport });
registerDockerHandlers({ dockerManager, dockerHealth });
registerCredentialHandlers({ credentialManager, loginManager });

// Legacy ping handler kept for backwards compatibility with existing tests.
ipcMain.handle(IPC.PING, () => 'pong');

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

app.on('ready', () => {
  createWindow();
  // Start Docker health monitoring
  dockerHealth.start();
});

app.on('window-all-closed', () => {
  // Stop Docker health monitoring when app quits
  dockerHealth.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
