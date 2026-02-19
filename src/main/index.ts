import { app, BrowserWindow, ipcMain, dialog } from 'electron';
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
import { CleanupManager } from '../services/cleanup-manager';
import { getAutoUpdater } from '../services/auto-updater';
import { setupLogging, getLogger, setLogLevel, type LogLevel } from '../services/logging';
import { registerDataHandlers } from './ipc-handlers/data-handlers';
import { registerDockerHandlers } from './ipc-handlers/docker-handlers';
import { registerCredentialHandlers } from './ipc-handlers/credential-handlers';
import { registerLoopHandlers } from './ipc-handlers/loop-handlers';
import { registerLogHandlers } from './ipc-handlers/log-handlers';
import { registerTerminalHandlers } from './ipc-handlers/terminal-handlers';
import { registerUpdateHandlers } from './ipc-handlers/update-handlers';
import { registerAutoUpdateHandlers } from './ipc-handlers/auto-update-handlers';
import { buildApplicationMenu } from './menu';
import { IPC } from '../shared/ipc-channels';
import os from 'node:os';
import type { AppSettings } from '../shared/models';
import { isLoopActive } from '../shared/loop-types';

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
const cleanupManager = new CleanupManager(dockerManager);
const autoUpdater = getAutoUpdater();

// Register all IPC handlers before the window is created.
registerDataHandlers({ configManager, projectStore, importExport });
registerDockerHandlers({ dockerManager, dockerHealth });
registerCredentialHandlers({ credentialManager, loginManager });
registerLoopHandlers({ loopRunner, scheduler, cleanupManager });
registerLogHandlers({ logExporter, loopRunner });
registerTerminalHandlers({ terminalManager });
registerUpdateHandlers({ selfUpdater });
registerAutoUpdateHandlers({ autoUpdater });

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

  // Set the main window for auto-updater notifications
  autoUpdater.setMainWindow(mainWindow);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  return mainWindow;
};

/**
 * Recover running loops on startup (best-effort).
 *
 * After a crash or force-quit, re-attach to any Docker containers that are still running.
 * This function never throws - recovery failures are logged but don't block startup.
 */
async function recoverLoops(): Promise<void> {
  try {
    logger.info('Attempting to recover running loops');

    // 1. Check if Docker is available
    const dockerAvailable = await dockerManager.isDockerAvailable();
    if (!dockerAvailable) {
      logger.info('Docker not available, skipping loop recovery');
      return;
    }

    // 2. List running containers with zephyr-managed label
    const containers = await dockerManager.listRunningContainers();
    if (containers.length === 0) {
      logger.info('No running containers found, nothing to recover');
      return;
    }

    logger.info(`Found ${containers.length} running container(s), attempting recovery`);

    // 3. Recover loops via LoopRunner
    const recoveredIds = await loopRunner.recoverLoops(containers, projectStore);

    // 4. Register recovered containers with cleanup manager
    for (const projectId of recoveredIds) {
      const state = loopRunner.getLoopState(projectId);
      if (state?.containerId) {
        cleanupManager.registerContainer(state.containerId);
      }
    }

    logger.info(`Successfully recovered ${recoveredIds.length} loop(s)`, {
      projectIds: recoveredIds,
    });
  } catch (error) {
    // Log error but don't throw - recovery is best-effort
    logger.error('Error during loop recovery (non-fatal)', { error });
  }
}

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
  // Recover any loops that survived a crash or force-quit
  await recoverLoops();
  // Start Docker health monitoring
  dockerHealth.start();
  // Check for updates on startup (with delay)
  autoUpdater.checkForUpdatesOnStartup();

  logger.info('Application started successfully');
});

// Track if shutdown is already in progress to prevent double execution
let isShuttingDown = false;

/**
 * Graceful shutdown handler - cleans up all resources before app exits
 */
async function gracefulShutdown(): Promise<void> {
  if (isShuttingDown) {
    logger.debug('Shutdown already in progress, skipping');
    return;
  }

  isShuttingDown = true;
  logger.info('Starting graceful shutdown');

  try {
    // 1. Stop all running loops
    const runningLoops = loopRunner.listRunning();
    if (runningLoops.length > 0) {
      logger.info(`Stopping ${runningLoops.length} running loop(s)`);
      await Promise.all(
        runningLoops.map(async (loop) => {
          try {
            await loopRunner.stopLoop(loop.projectId);
          } catch (error) {
            logger.error('Error stopping loop during shutdown', {
              projectId: loop.projectId,
              error,
            });
          }
        })
      );
    }

    // 2. Cancel all scheduled loops
    const scheduled = scheduler.listScheduled();
    if (scheduled.length > 0) {
      logger.info(`Cancelling ${scheduled.length} scheduled loop(s)`);
      scheduled.forEach((projectId) => {
        try {
          scheduler.cancelSchedule(projectId);
        } catch (error) {
          logger.error('Error cancelling schedule during shutdown', {
            projectId,
            error,
          });
        }
      });
    }

    // 3. Stop Docker health monitor
    logger.debug('Stopping Docker health monitor');
    dockerHealth.stop();

    // 4. Close all terminal sessions
    logger.debug('Closing all terminal sessions');
    await terminalManager.closeAllSessions();

    // 5. Run cleanup manager to stop tracked containers
    logger.debug('Running cleanup manager');
    await cleanupManager.cleanupAll();

    logger.info('Graceful shutdown complete');
  } catch (error) {
    logger.error('Error during graceful shutdown', { error });
  } finally {
    isShuttingDown = false;
  }
}

/**
 * Check if user confirmation is needed before quitting
 * @returns true if app should quit, false to cancel quit
 */
async function confirmQuitIfNeeded(): Promise<boolean> {
  const activeLoops = loopRunner
    .listAll()
    .filter((loop) => isLoopActive(loop.status));

  if (activeLoops.length === 0) {
    return true; // No active loops, safe to quit
  }

  // Show confirmation dialog
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) {
    // No window available, proceed with quit
    return true;
  }

  const response = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Quit Zephyr Desktop',
    message: `${activeLoops.length} loop(s) are still running.`,
    detail: 'Quitting will stop all running loops and clean up containers. Are you sure?',
    buttons: ['Cancel', 'Quit Anyway'],
    defaultId: 0,
    cancelId: 0,
  });

  return response.response === 1; // Quit if user clicked "Quit Anyway"
}

app.on('window-all-closed', () => {
  // On macOS, don't quit when windows close (stay in dock)
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  if (isShuttingDown) {
    // Shutdown already in progress, allow quit to proceed
    return;
  }

  // Prevent immediate quit to allow graceful shutdown
  event.preventDefault();

  // Check if user confirmation is needed
  const shouldQuit = await confirmQuitIfNeeded();
  if (!shouldQuit) {
    logger.info('User cancelled quit');
    return;
  }

  // Run graceful shutdown
  await gracefulShutdown();

  // Now allow the quit to proceed
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle SIGINT and SIGTERM for graceful shutdown on Unix systems
process.on('SIGINT', async () => {
  logger.info('Received SIGINT signal');
  await gracefulShutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal');
  await gracefulShutdown();
  process.exit(0);
});
