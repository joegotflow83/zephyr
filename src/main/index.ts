import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { ConfigManager } from '../services/config-manager';
import { ProjectStore } from '../services/project-store';
import { ImportExportService } from '../services/import-export';
import { DockerRuntime } from '../services/docker-runtime';
import { PodmanRuntime } from '../services/podman-runtime';
import { RuntimeHealthMonitor } from '../services/runtime-health';
import type { ContainerRuntime } from '../services/container-runtime';
import { CredentialManager } from '../services/credential-manager';
import { LoginManager } from '../services/login-manager';
import { LogParser } from '../services/log-parser';
import { LoopRunner } from '../services/loop-runner';
import { LoopScheduler } from '../services/scheduler';
import { LogExporter } from '../services/log-exporter';
import { TerminalManager } from '../services/terminal-manager';
import { SelfUpdater } from '../services/self-updater';
import { CleanupManager } from '../services/cleanup-manager';
import { getAutoUpdater } from '../services/auto-updater';
import { setupLogging, getLogger, setLogLevel, type LogLevel } from '../services/logging';
import { registerDataHandlers } from './ipc-handlers/data-handlers';
import { registerRuntimeHandlers } from './ipc-handlers/runtime-handlers';
import { registerCredentialHandlers } from './ipc-handlers/credential-handlers';
import { registerLoopHandlers } from './ipc-handlers/loop-handlers';
import { registerLogHandlers } from './ipc-handlers/log-handlers';
import { registerTerminalHandlers } from './ipc-handlers/terminal-handlers';
import { registerUpdateHandlers } from './ipc-handlers/update-handlers';
import { registerAutoUpdateHandlers } from './ipc-handlers/auto-update-handlers';
import { registerImageHandlers } from './ipc-handlers/image-handlers';
import { ImageStore } from '../services/image-store';
import { ImageBuilder } from '../services/image-builder';
import { PreValidationStore } from '../services/pre-validation-store';
import { HooksStore } from '../services/hooks-store';
import { LoopScriptsStore } from '../services/loop-scripts-store';
import { ClaudeSettingsStore } from '../services/claude-settings-store';
import { KiroHooksStore } from '../services/kiro-hooks-store';
import { AuthInjector } from '../services/auth-injector';
import { DeployKeyStore } from '../services/deploy-key-store';
import { SSHKeyManager } from '../services/ssh-key-manager';
import { buildApplicationMenu } from './menu';
import { IPC } from '../shared/ipc-channels';
import { registerDeployKeyHandlers } from './ipc-handlers/deploy-key-handlers';
import { registerVMHandlers } from './ipc-handlers/vm-handlers';
import { VMManager } from '../services/vm-manager';
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

// Read container_runtime from settings synchronously (loadJson uses readFileSync).
// Defaults to 'docker' if settings are absent or the field is unset.
const initialSettings = configManager.loadJson<AppSettings>('settings.json');
const runtime: ContainerRuntime = initialSettings?.container_runtime === 'podman'
  ? new PodmanRuntime()
  : new DockerRuntime();
const runtimeHealth = new RuntimeHealthMonitor(runtime);

const credentialManager = new CredentialManager(
  path.join(os.homedir(), '.zephyr')
);
const loginManager = new LoginManager(credentialManager);
const logParser = new LogParser();
const vmManager = new VMManager();
const loopRunner = new LoopRunner(runtime, logParser, 3, vmManager); // Default max 3 concurrent
const scheduler = new LoopScheduler(loopRunner);
const logExporter = new LogExporter();
const terminalManager = new TerminalManager(runtime);
const selfUpdater = new SelfUpdater(app.getAppPath(), loopRunner);
const cleanupManager = new CleanupManager(runtime);
const autoUpdater = getAutoUpdater();
const imageStore = new ImageStore(configManager);
const imageBuilder = new ImageBuilder(runtime, imageStore);
const preValidationStore = new PreValidationStore(configManager);
const hooksStore = new HooksStore(configManager);
const loopScriptsStore = new LoopScriptsStore(configManager);
const claudeSettingsStore = new ClaudeSettingsStore(configManager);
const kiroHooksStore = new KiroHooksStore(configManager);
const authInjector = new AuthInjector(configManager, credentialManager);
const deployKeyStore = new DeployKeyStore(path.join(os.homedir(), '.zephyr'));
const sshKeyManager = new SSHKeyManager(runtime);

// Register all IPC handlers before the window is created.
registerDataHandlers({ configManager, projectStore, importExport, preValidationStore, hooksStore, kiroHooksStore, loopScriptsStore, claudeSettingsStore, loopRunner, runtime, credentialManager, sshKeyManager, deployKeyStore });
registerRuntimeHandlers({ runtime, runtimeHealth });
registerCredentialHandlers({ credentialManager, loginManager });
registerLoopHandlers({
  loopRunner,
  scheduler,
  cleanupManager,
  projectStore,
  preValidationStore,
  hooksStore,
  kiroHooksStore,
  claudeSettingsStore,
  runtime,
  authInjector,
  credentialManager,
  sshKeyManager,
  deployKeyStore,
  loopScriptsStore,
  configManager,
});
registerLogHandlers({ logExporter, loopRunner });
registerTerminalHandlers({ terminalManager, vmManager });
registerUpdateHandlers({ selfUpdater });
registerAutoUpdateHandlers({ autoUpdater });
registerImageHandlers({ imageStore, imageBuilder });
registerDeployKeyHandlers({ deployKeyStore });
registerVMHandlers({ vmManager, loopRunner });

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

    // 1. Check if the container runtime is available
    const runtimeAvailable = await runtime.isAvailable();
    if (!runtimeAvailable) {
      logger.info('Container runtime not available, skipping loop recovery');
      return;
    }

    // 2. List running containers with zephyr-managed label
    const containers = await runtime.listContainers();
    const runningContainers = containers.filter((c) => c.state === 'running');
    if (runningContainers.length === 0) {
      logger.info('No running containers found, nothing to recover');
      return;
    }

    logger.info(`Found ${runningContainers.length} running container(s), attempting recovery`);

    // 3. Recover loops via LoopRunner
    const recoveredIds = await loopRunner.recoverLoops(runningContainers, projectStore);

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

/**
 * Identify whether a Zephyr VM is ephemeral based on its name.
 *
 * Ephemeral VM names end with a millisecond Unix timestamp (≥10 digits).
 * Persistent VM names end with a 4-character base-36 random suffix.
 */
function isEphemeralVMName(name: string): boolean {
  const parts = name.split('-');
  const suffix = parts[parts.length - 1];
  return /^\d{10,}$/.test(suffix);
}

/**
 * Clean up orphaned Zephyr VMs left over from a previous session.
 *
 * Ephemeral VMs are deleted immediately (they should never survive across
 * sessions). Persistent VMs that have no active loop are logged but kept —
 * the user may want to keep them.
 */
async function cleanupOrphanedVMs(): Promise<void> {
  try {
    const available = await vmManager.isMultipassAvailable();
    if (!available) {
      logger.debug('Multipass not available, skipping orphaned VM cleanup');
      return;
    }

    const vms = await vmManager.listVMs();
    const zephyrVMs = vms.filter((vm) => vmManager.isZephyrVM(vm.name));

    if (zephyrVMs.length === 0) {
      return;
    }

    logger.info(`Found ${zephyrVMs.length} Zephyr-managed VM(s) on startup`);

    const activeProjectIds = new Set(loopRunner.listRunning().map((s) => s.projectId));

    for (const vm of zephyrVMs) {
      if (isEphemeralVMName(vm.name)) {
        // Ephemeral VMs should always be deleted — they were never cleaned up
        logger.info(`Deleting orphaned ephemeral VM "${vm.name}"`);
        vmManager.deleteVM(vm.name, true).catch((err) => {
          logger.warn(`Failed to delete orphaned ephemeral VM "${vm.name}"`, { err });
        });
      } else {
        // Persistent VMs: log if no active loop is using them
        const hasActiveLoop = Array.from(activeProjectIds).some(
          (id) => loopRunner.getLoopState(id)?.vmName === vm.name,
        );
        if (!hasActiveLoop) {
          logger.info(`Persistent VM "${vm.name}" has no active loop (state: ${vm.state})`);
        }
      }
    }
  } catch (error) {
    logger.warn('Error during orphaned VM cleanup (non-fatal)', { error });
  }
}

app.on('ready', async () => {
  logger.info('Application starting');

  // Load settings to configure log level and concurrency limit
  try {
    const settings: AppSettings = await configManager.loadJson('settings.json');
    if (settings.log_level) {
      const mappedLevel = mapLogLevel(settings.log_level);
      setLogLevel(mappedLevel);
      logger.info('Log level set from settings', { level: mappedLevel });
    }
    if (settings.max_concurrent_containers) {
      loopRunner.setMaxConcurrent(settings.max_concurrent_containers);
      logger.info('Max concurrent containers set from settings', { max: settings.max_concurrent_containers });
    }
  } catch (error) {
    logger.warn('Could not load settings, using default log level', { error });
  }

  const mainWindow = createWindow();
  // Build the application menu bar
  buildApplicationMenu();
  // Mark any deploy keys still 'active' from a previous session as orphaned
  deployKeyStore.detectOrphans();
  // Recover any loops that survived a crash or force-quit
  await recoverLoops();
  // Clean up orphaned VMs from a previous session
  await cleanupOrphanedVMs();
  // Start container runtime health monitoring
  runtimeHealth.start();
  // Check for updates on startup (with delay)
  autoUpdater.checkForUpdatesOnStartup();

  // Signal renderer that startup is complete
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send(IPC.APP_READY);
    });
  } else {
    mainWindow.webContents.send(IPC.APP_READY);
  }

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
      scheduled.forEach((scheduledLoop) => {
        try {
          scheduler.cancelSchedule(scheduledLoop.projectId);
        } catch (error) {
          logger.error('Error cancelling schedule during shutdown', {
            projectId: scheduledLoop.projectId,
            error,
          });
        }
      });
    }

    // 3. Stop container runtime health monitor
    logger.debug('Stopping runtime health monitor');
    runtimeHealth.stop();

    // 4. Close all terminal sessions
    logger.debug('Closing all terminal sessions');
    await terminalManager.closeAllSessions();

    // 5. Run cleanup manager to stop tracked containers
    logger.debug('Running cleanup manager');
    await cleanupManager.cleanupAll();

    // 6. Delete any running ephemeral VMs to avoid resource leaks
    try {
      const available = await vmManager.isMultipassAvailable();
      if (available) {
        const vms = await vmManager.listVMs();
        const ephemeralRunning = vms.filter(
          (vm) => vmManager.isZephyrVM(vm.name) && isEphemeralVMName(vm.name),
        );
        if (ephemeralRunning.length > 0) {
          logger.info(`Deleting ${ephemeralRunning.length} ephemeral VM(s) on quit`);
          await Promise.all(
            ephemeralRunning.map((vm) =>
              vmManager.deleteVM(vm.name, true).catch((err) => {
                logger.warn(`Failed to delete ephemeral VM "${vm.name}" on quit`, { err });
              }),
            ),
          );
        }
      }
    } catch (err) {
      logger.warn('Error during ephemeral VM cleanup on quit (non-fatal)', { err });
    }

    logger.info('Graceful shutdown complete');
  } catch (error) {
    logger.error('Error during graceful shutdown', { error });
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
  if (isShuttingDown || autoUpdater.isQuitAndInstallPending()) {
    // Shutdown already in progress, or Squirrel is about to replace the app —
    // let the quit through uninterrupted so the update installs correctly.
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
