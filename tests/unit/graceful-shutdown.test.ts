/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MessageBoxReturnValue } from 'electron';

// Create shared mock instances
const mockLoopRunnerInstance = {
  listRunning: vi.fn(() => []),
  listAll: vi.fn(() => []),
  stopLoop: vi.fn().mockResolvedValue(undefined),
};

const mockSchedulerInstance = {
  listScheduled: vi.fn(() => []),
  cancelSchedule: vi.fn(),
};

const mockDockerHealthInstance = {
  start: vi.fn(),
  stop: vi.fn(),
};

const mockTerminalManagerInstance = {
  setWebContents: vi.fn(),
  closeAllSessions: vi.fn().mockResolvedValue(undefined),
};

const mockCleanupManagerInstance = {
  cleanupAll: vi.fn().mockResolvedValue(undefined),
};

const mockConfigManagerInstance = {
  loadJson: vi.fn().mockResolvedValue({ log_level: 'INFO' }),
};

// Mock electron module
vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    quit: vi.fn(),
    getAppPath: vi.fn(() => '/app'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn(),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
}));

// Mock electron-squirrel-startup
vi.mock('electron-squirrel-startup', () => ({ default: false }));

// Mock all service modules with class constructors
vi.mock('../../src/services/config-manager', () => ({
  ConfigManager: class ConfigManager {
    constructor() {
      return mockConfigManagerInstance;
    }
  },
}));

vi.mock('../../src/services/project-store', () => ({
  ProjectStore: class ProjectStore {},
}));

vi.mock('../../src/services/import-export', () => ({
  ImportExportService: class ImportExportService {},
}));

vi.mock('../../src/services/docker-manager', () => ({
  DockerManager: class DockerManager {},
}));

vi.mock('../../src/services/docker-health', () => ({
  DockerHealthMonitor: class DockerHealthMonitor {
    constructor() {
      return mockDockerHealthInstance;
    }
  },
}));

vi.mock('../../src/services/credential-manager', () => ({
  CredentialManager: class CredentialManager {},
}));

vi.mock('../../src/services/login-manager', () => ({
  LoginManager: class LoginManager {},
}));

vi.mock('../../src/services/log-parser', () => ({
  LogParser: class LogParser {},
}));

vi.mock('../../src/services/loop-runner', () => ({
  LoopRunner: class LoopRunner {
    constructor() {
      return mockLoopRunnerInstance;
    }
  },
}));

vi.mock('../../src/services/scheduler', () => ({
  LoopScheduler: class LoopScheduler {
    constructor() {
      return mockSchedulerInstance;
    }
  },
}));

vi.mock('../../src/services/log-exporter', () => ({
  LogExporter: class LogExporter {},
}));

vi.mock('../../src/services/terminal-manager', () => ({
  TerminalManager: class TerminalManager {
    constructor() {
      return mockTerminalManagerInstance;
    }
  },
}));

vi.mock('../../src/services/git-manager', () => ({
  GitManager: class GitManager {},
}));

vi.mock('../../src/services/self-updater', () => ({
  SelfUpdater: class SelfUpdater {},
}));

vi.mock('../../src/services/cleanup-manager', () => ({
  CleanupManager: class CleanupManager {
    constructor() {
      return mockCleanupManagerInstance;
    }
  },
}));

vi.mock('../../src/services/logging', () => ({
  setupLogging: vi.fn(),
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  setLogLevel: vi.fn(),
}));

// Mock IPC handler registration modules
vi.mock('../../src/main/ipc-handlers/data-handlers', () => ({
  registerDataHandlers: vi.fn(),
}));

vi.mock('../../src/main/ipc-handlers/docker-handlers', () => ({
  registerDockerHandlers: vi.fn(),
}));

vi.mock('../../src/main/ipc-handlers/credential-handlers', () => ({
  registerCredentialHandlers: vi.fn(),
}));

vi.mock('../../src/main/ipc-handlers/loop-handlers', () => ({
  registerLoopHandlers: vi.fn(),
}));

vi.mock('../../src/main/ipc-handlers/log-handlers', () => ({
  registerLogHandlers: vi.fn(),
}));

vi.mock('../../src/main/ipc-handlers/terminal-handlers', () => ({
  registerTerminalHandlers: vi.fn(),
}));

vi.mock('../../src/main/ipc-handlers/update-handlers', () => ({
  registerUpdateHandlers: vi.fn(),
}));

vi.mock('../../src/main/menu', () => ({
  buildApplicationMenu: vi.fn(),
}));

vi.mock('../../src/shared/loop-types', () => ({
  isLoopActive: vi.fn((status: string) => ['RUNNING', 'STARTING'].includes(status)),
}));

describe('Graceful Shutdown', () => {
  let electron: any;
  let appEventHandlers: Map<string, Function>;
  let processEventHandlers: Map<string, Function>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mock instance methods
    mockLoopRunnerInstance.listRunning.mockReturnValue([]);
    mockLoopRunnerInstance.listAll.mockReturnValue([]);
    mockLoopRunnerInstance.stopLoop.mockResolvedValue(undefined);
    mockSchedulerInstance.listScheduled.mockReturnValue([]);
    mockDockerHealthInstance.stop.mockReset();
    mockTerminalManagerInstance.closeAllSessions.mockResolvedValue(undefined);
    mockCleanupManagerInstance.cleanupAll.mockResolvedValue(undefined);

    // Reset event handler maps
    appEventHandlers = new Map();
    processEventHandlers = new Map();

    // Mock app.on to capture event handlers
    electron = await import('electron');
    electron.app.on = vi.fn((event: string, handler: Function) => {
      appEventHandlers.set(event, handler);
    });

    // Mock process.on to capture signal handlers
    const originalProcessOn = process.on.bind(process);
    vi.spyOn(process, 'on').mockImplementation((event: any, handler: any) => {
      if (event === 'SIGINT' || event === 'SIGTERM') {
        processEventHandlers.set(event, handler);
        return process;
      }
      return originalProcessOn(event, handler);
    });

    // Mock process.exit
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadMainModule() {
    // Clear module cache to ensure fresh imports
    vi.resetModules();
    await import('../../src/main/index');
  }

  describe('before-quit event handler', () => {
    it('should register before-quit event handler', async () => {
      await loadMainModule();
      const electron = await import('electron');
      expect(electron.app.on).toHaveBeenCalledWith('before-quit', expect.any(Function));
    });

    it('should call graceful shutdown when before-quit is triggered with no active loops', async () => {
      await loadMainModule();

      const beforeQuitHandler = appEventHandlers.get('before-quit');
      expect(beforeQuitHandler).toBeDefined();

      const mockEvent = { preventDefault: vi.fn() };
      await beforeQuitHandler!(mockEvent);

      // Should stop health monitor
      expect(mockDockerHealthInstance.stop).toHaveBeenCalled();

      // Should close all terminal sessions
      expect(mockTerminalManagerInstance.closeAllSessions).toHaveBeenCalled();

      // Should run cleanup manager
      expect(mockCleanupManagerInstance.cleanupAll).toHaveBeenCalled();
    });

    it('should stop all running loops during shutdown', async () => {
      const mockLoop1 = { projectId: 'proj1', status: 'RUNNING' };
      const mockLoop2 = { projectId: 'proj2', status: 'RUNNING' };

      mockLoopRunnerInstance.listRunning.mockReturnValue([mockLoop1, mockLoop2]);
      mockLoopRunnerInstance.listAll.mockReturnValue([mockLoop1, mockLoop2]);

      await loadMainModule();

      const electron = await import('electron');
      (electron.BrowserWindow.getAllWindows as any).mockReturnValue([{ id: 1 }]);
      (electron.dialog.showMessageBox as any).mockResolvedValue({
        response: 1,
      } as MessageBoxReturnValue);

      const beforeQuitHandler = appEventHandlers.get('before-quit');
      const mockEvent = { preventDefault: vi.fn() };
      await beforeQuitHandler!(mockEvent);

      // Should stop both loops
      expect(mockLoopRunnerInstance.stopLoop).toHaveBeenCalledWith('proj1');
      expect(mockLoopRunnerInstance.stopLoop).toHaveBeenCalledWith('proj2');
    });

    it('should cancel all scheduled loops during shutdown', async () => {
      mockSchedulerInstance.listScheduled.mockReturnValue(['proj1', 'proj2']);

      await loadMainModule();

      const beforeQuitHandler = appEventHandlers.get('before-quit');
      const mockEvent = { preventDefault: vi.fn() };
      await beforeQuitHandler!(mockEvent);

      // Should cancel both schedules
      expect(mockSchedulerInstance.cancelSchedule).toHaveBeenCalledWith('proj1');
      expect(mockSchedulerInstance.cancelSchedule).toHaveBeenCalledWith('proj2');
    });

    it('should show confirmation dialog when active loops are running', async () => {
      const mockActiveLoop = { projectId: 'proj1', status: 'RUNNING' };
      const mockIdleLoop = { projectId: 'proj2', status: 'STOPPED' };

      mockLoopRunnerInstance.listRunning.mockReturnValue([]);
      mockLoopRunnerInstance.listAll.mockReturnValue([mockActiveLoop, mockIdleLoop]);

      await loadMainModule();

      const electron = await import('electron');
      const mockWindow = { id: 1 };
      (electron.BrowserWindow.getAllWindows as any).mockReturnValue([mockWindow]);
      (electron.dialog.showMessageBox as any).mockResolvedValue({
        response: 0, // User clicked Cancel
      } as MessageBoxReturnValue);

      const beforeQuitHandler = appEventHandlers.get('before-quit');
      const mockEvent = { preventDefault: vi.fn() };
      await beforeQuitHandler!(mockEvent);

      // Should show confirmation dialog
      expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(
        mockWindow,
        expect.objectContaining({
          type: 'warning',
          title: 'Quit Zephyr Desktop',
          message: expect.stringContaining('1 loop(s) are still running'),
        })
      );

      // Should prevent quit since user clicked Cancel
      expect(electron.app.quit).not.toHaveBeenCalled();
    });

    it('should proceed with quit when user confirms in dialog', async () => {
      const mockActiveLoop = { projectId: 'proj1', status: 'RUNNING' };

      mockLoopRunnerInstance.listRunning.mockReturnValue([mockActiveLoop]);
      mockLoopRunnerInstance.listAll.mockReturnValue([mockActiveLoop]);

      await loadMainModule();

      const electron = await import('electron');
      const mockWindow = { id: 1 };
      (electron.BrowserWindow.getAllWindows as any).mockReturnValue([mockWindow]);
      (electron.dialog.showMessageBox as any).mockResolvedValue({
        response: 1, // User clicked "Quit Anyway"
      } as MessageBoxReturnValue);

      const beforeQuitHandler = appEventHandlers.get('before-quit');
      const mockEvent = { preventDefault: vi.fn() };
      await beforeQuitHandler!(mockEvent);

      // Should proceed with quit
      expect(electron.app.quit).toHaveBeenCalled();
    });

    it('should not show dialog when no windows are available', async () => {
      const mockActiveLoop = { projectId: 'proj1', status: 'RUNNING' };

      mockLoopRunnerInstance.listRunning.mockReturnValue([mockActiveLoop]);
      mockLoopRunnerInstance.listAll.mockReturnValue([mockActiveLoop]);

      await loadMainModule();

      const electron = await import('electron');
      (electron.BrowserWindow.getAllWindows as any).mockReturnValue([]);

      const beforeQuitHandler = appEventHandlers.get('before-quit');
      const mockEvent = { preventDefault: vi.fn() };
      await beforeQuitHandler!(mockEvent);

      // Should not show dialog when no windows
      expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();

      // Should proceed with quit
      expect(electron.app.quit).toHaveBeenCalled();
    });

    it('should handle errors during loop stopping gracefully', async () => {
      const mockLoop1 = { projectId: 'proj1', status: 'RUNNING' };
      const mockLoop2 = { projectId: 'proj2', status: 'RUNNING' };

      mockLoopRunnerInstance.listRunning.mockReturnValue([mockLoop1, mockLoop2]);
      mockLoopRunnerInstance.listAll.mockReturnValue([]);
      mockLoopRunnerInstance.stopLoop
        .mockRejectedValueOnce(new Error('Stop failed'))
        .mockResolvedValueOnce(undefined);

      await loadMainModule();

      const beforeQuitHandler = appEventHandlers.get('before-quit');
      const mockEvent = { preventDefault: vi.fn() };

      // Should not throw despite error
      await expect(beforeQuitHandler!(mockEvent)).resolves.toBeUndefined();

      // Should attempt to stop both loops
      expect(mockLoopRunnerInstance.stopLoop).toHaveBeenCalledTimes(2);
    });

    it('should prevent double shutdown execution', async () => {
      await loadMainModule();

      const beforeQuitHandler = appEventHandlers.get('before-quit');
      const mockEvent1 = { preventDefault: vi.fn() };
      const mockEvent2 = { preventDefault: vi.fn() };

      // Trigger shutdown twice in rapid succession
      const shutdown1 = beforeQuitHandler!(mockEvent1);
      const shutdown2 = beforeQuitHandler!(mockEvent2);

      await Promise.all([shutdown1, shutdown2]);

      // Cleanup should only be called once
      expect(mockCleanupManagerInstance.cleanupAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('SIGINT and SIGTERM handlers', () => {
    it('should register SIGINT handler', async () => {
      await loadMainModule();
      expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    });

    it('should register SIGTERM handler', async () => {
      await loadMainModule();
      expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    });

    it('should perform graceful shutdown on SIGINT', async () => {
      await loadMainModule();

      const sigintHandler = processEventHandlers.get('SIGINT');
      expect(sigintHandler).toBeDefined();

      await sigintHandler!();

      // Should run cleanup
      expect(mockCleanupManagerInstance.cleanupAll).toHaveBeenCalled();

      // Should exit process
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('should perform graceful shutdown on SIGTERM', async () => {
      await loadMainModule();

      const sigtermHandler = processEventHandlers.get('SIGTERM');
      expect(sigtermHandler).toBeDefined();

      await sigtermHandler!();

      // Should run cleanup
      expect(mockCleanupManagerInstance.cleanupAll).toHaveBeenCalled();

      // Should exit process
      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });

  describe('window-all-closed handler', () => {
    it('should quit on non-macOS when all windows closed', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      });

      await loadMainModule();

      const electron = await import('electron');
      const windowClosedHandler = appEventHandlers.get('window-all-closed');
      expect(windowClosedHandler).toBeDefined();

      windowClosedHandler!();

      expect(electron.app.quit).toHaveBeenCalled();

      // Restore original platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true,
      });
    });

    it('should not quit on macOS when all windows closed', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      await loadMainModule();

      const electron = await import('electron');
      const windowClosedHandler = appEventHandlers.get('window-all-closed');
      expect(windowClosedHandler).toBeDefined();

      windowClosedHandler!();

      expect(electron.app.quit).not.toHaveBeenCalled();

      // Restore original platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true,
      });
    });
  });
});
