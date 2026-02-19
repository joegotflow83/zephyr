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
import { LogParser } from '../services/log-parser';
import { LoopRunner } from '../services/loop-runner';
import { LoopScheduler } from '../services/scheduler';
import { LogExporter } from '../services/log-exporter';
import { TerminalManager } from '../services/terminal-manager';
import { GitManager } from '../services/git-manager';
import { SelfUpdater } from '../services/self-updater';
import { setupLogging, getLogger, setLogLevel, type LogLevel } from '../services/logging';
import { registerDataHandlers } from './ipc-handlers/data-handlers';
import { registerDockerHandlers } from './ipc-handlers/docker-handlers';
import { registerCredentialHandlers } from './ipc-handlers/credential-handlers';
import { registerLoopHandlers } from './ipc-handlers/loop-handlers';
import { registerLogHandlers } from './ipc-handlers/log-handlers';
import { registerTerminalHandlers } from './ipc-handlers/terminal-handlers';
import { registerUpdateHandlers } from './ipc-handlers/update-handlers';
import { buildApplicationMenu } from './menu';
import { IPC } from '../shared/ipc-channels';
import os from 'node:os';
import type { AppSettings } from '../shared/models';

// Map AppSettings log levels to electron-log levels
function mapLogLevel(appLevel: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'): LogLevel {
  const mapping: Record<string, LogLevel> = {
    DEBUG: 'debug',
    INFO: 'info',
    WARNING: 'warn',
    ERROR: 'error',
  };
  return mapping[appLevel] || 'info';
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Initialize logging first, before any other services
setupLogging('info');
const logger = getLogger('main');

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
const logParser = new LogParser();
const loopRunner = new LoopRunner(dockerManager, logParser, 3); // Default max 3 concurrent
const scheduler = new LoopScheduler(loopRunner);
const logExporter = new LogExporter();
const terminalManager = new TerminalManager(dockerManager);
const gitManager = new GitManager();
const selfUpdater = new SelfUpdater(gitManager, loopRunner, app.getAppPath());

// Register all IPC handlers before the window is created.
registerDataHandlers({ configManager, projectStore, importExport });
registerDockerHandlers({ dockerManager, dockerHealth });
registerCredentialHandlers({ credentialManager, loginManager });
registerLoopHandlers({ loopRunner, scheduler });
registerLogHandlers({ logExporter, loopRunner });
registerTerminalHandlers({ terminalManager });
registerUpdateHandlers({ selfUpdater });

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

  // Set the webContents for terminal output streaming
  terminalManager.setWebContents(mainWindow.webContents);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

app.on('ready', async () => {
  logger.info('Application starting');

  // Load settings to configure log level
  try {
    const settings: AppSettings = await configManager.loadJson('settings.json');
    if (settings.log_level) {
      const mappedLevel = mapLogLevel(settings.log_level);
      setLogLevel(mappedLevel);
      logger.info('Log level set from settings', { level: mappedLevel });
    }
  } catch (error) {
    logger.warn('Could not load settings, using default log level', { error });
  }

  createWindow();
  // Build the application menu bar
  buildApplicationMenu();
  // Start Docker health monitoring
  dockerHealth.start();

  logger.info('Application started successfully');
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
