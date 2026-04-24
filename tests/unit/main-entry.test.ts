/**
 * Unit tests for src/main/index.ts
 *
 * Verifies that the main entry point correctly:
 * - Instantiates all services with proper dependencies
 * - Registers all IPC handler modules
 * - Creates windows with security settings
 * - Handles app lifecycle events (ready, window-all-closed, activate)
 * - Sets up logging and Docker health monitoring
 *
 * Why we test the entry point: The main entry point is the orchestration layer
 * that wires together all services and handlers. Testing this ensures all
 * dependencies are correctly instantiated and connected, catching integration
 * issues early without needing a full Electron instance.
 */

import { describe, it, expect, vi } from 'vitest';
import type { BrowserWindow as BrowserWindowType } from 'electron';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  handlerRegistry,
  appEventListeners,
  mockWebContents,
  mockBrowserWindow,
  BrowserWindowConstructor,
  mockApp,
  mockIpcMain,
  mockPath,
  mockOs,
} = vi.hoisted(() => {
  // Track registered handlers and event listeners
  const handlerRegistry: Record<string, (...args: unknown[]) => unknown> = {};
  const appEventListeners: Record<string, ((...args: unknown[]) => unknown)[]> = {};

  // Mock BrowserWindow instance
  const mockWebContents = {
    send: vi.fn(),
    isLoading: vi.fn().mockReturnValue(false),
    once: vi.fn(),
  };

  const mockBrowserWindow = {
    loadURL: vi.fn().mockResolvedValue(undefined),
    loadFile: vi.fn().mockResolvedValue(undefined),
    webContents: mockWebContents,
  };

  // Mock BrowserWindow constructor
  const BrowserWindowConstructor = vi.fn(function() { return mockBrowserWindow; });
  BrowserWindowConstructor.getAllWindows = vi.fn(() => []);

  // Mock app
  const mockApp = {
    quit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      if (!appEventListeners[event]) {
        appEventListeners[event] = [];
      }
      appEventListeners[event].push(handler);
    }),
    getAppPath: vi.fn(() => '/mock/app/path'),
    getPath: vi.fn((name: string) => {
      if (name === 'logs') return '/mock/logs';
      return '/mock';
    }),
  };

  // Mock ipcMain
  const mockIpcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlerRegistry[channel] = handler;
    }),
  };

  // Mock path
  const mockPath = {
    join: vi.fn((...args: string[]) => args.join('/')),
  };

  // Mock os
  const mockOs = {
    homedir: vi.fn(() => '/mock/home'),
  };

  return {
    handlerRegistry,
    appEventListeners,
    mockWebContents,
    mockBrowserWindow,
    BrowserWindowConstructor,
    mockApp,
    mockIpcMain,
    mockPath,
    mockOs,
  };
});

// ── Mock electron-updater ───────────────────────────────────────────────────

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    currentVersion: { version: '0.1.0' },
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn(),
  },
}));

// ── Mock electron ────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: BrowserWindowConstructor,
  ipcMain: mockIpcMain,
  dialog: {
    showMessageBox: vi.fn(),
  },
}));

vi.mock('node:path', () => ({
  default: mockPath,
}));

vi.mock('node:os', () => ({
  default: mockOs,
}));

vi.mock('electron-squirrel-startup', () => ({
  default: false,
}));

// ── Mock services ────────────────────────────────────────────────────────────

const {
  mockConfigManager,
  mockProjectStore,
  mockImportExport,
  mockDockerRuntime,
  mockRuntimeHealth,
  mockDockerHealth,
  mockCredentialManager,
  mockLoginManager,
  mockLogParser,
  mockLoopRunner,
  mockScheduler,
  mockLogExporter,
  mockTerminalManager,
  mockSelfUpdater,
  mockCleanupManager,
  mockPreValidationStore,
  mockHooksStore,
  mockLoopScriptsStore,
  mockClaudeSettingsStore,
  mockVmManager,
  mockSshKeyManager,
  mockDeployKeyStore,
  mockKiroHooksStore,
  MockConfigManager,
  MockProjectStore,
  MockImportExportService,
  MockDockerRuntime,
  MockPodmanRuntime,
  MockRuntimeHealthMonitor,
  MockDockerHealthMonitor,
  MockCredentialManager,
  MockLoginManager,
  MockLogParser,
  MockLoopRunner,
  MockLoopScheduler,
  MockLogExporter,
  MockTerminalManager,
  MockSelfUpdater,
  MockCleanupManager,
  MockPreValidationStore,
  MockHooksStore,
  MockLoopScriptsStore,
  MockClaudeSettingsStore,
  MockVMManager,
  MockSSHKeyManager,
  MockDeployKeyStore,
  MockKiroHooksStore,
} = vi.hoisted(() => {
  const mockConfigManager = {
    loadJson: vi.fn(),
    saveJson: vi.fn(),
    ensureConfigDir: vi.fn(),
    getConfigDir: vi.fn(() => '/mock/config'),
  };

  const mockProjectStore = {
    listProjects: vi.fn(),
    getProject: vi.fn(),
    addProject: vi.fn(),
    updateProject: vi.fn(),
    removeProject: vi.fn(),
  };

  const mockImportExport = {
    exportConfig: vi.fn(),
    importConfig: vi.fn(),
  };

  const mockDockerRuntime = {
    runtimeType: 'docker' as const,
    isAvailable: vi.fn().mockResolvedValue(true),
    listContainers: vi.fn().mockResolvedValue([]),
  };

  const mockRuntimeHealth = {
    start: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn(),
  };

  // Keep for legacy compat in tests that still reference it
  const mockDockerHealth = mockRuntimeHealth;

  const mockCredentialManager = {
    store: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  };

  const mockLoginManager = {
    login: vi.fn(),
    logout: vi.fn(),
    isLoggedIn: vi.fn(),
  };

  const mockLogParser = {
    parse: vi.fn(),
    parseStream: vi.fn(),
  };

  const mockLoopRunner = {
    start: vi.fn(),
    stop: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
  };

  const mockScheduler = {
    schedule: vi.fn(),
    cancel: vi.fn(),
    list: vi.fn(),
  };

  const mockLogExporter = {
    export: vi.fn(),
    exportAll: vi.fn(),
  };

  const mockTerminalManager = {
    open: vi.fn(),
    close: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    setWebContents: vi.fn(),
  };

  const mockSelfUpdater = {
    checkForUpdates: vi.fn(),
    applyUpdate: vi.fn(),
  };

  const mockCleanupManager = {
    registerContainer: vi.fn(),
    unregisterContainer: vi.fn(),
    getTrackedContainers: vi.fn(),
    cleanupAll: vi.fn(),
  };

  // ── Mock service constructors ──────────────────────────────────────────────

  const MockConfigManager = vi.fn(function() { return mockConfigManager; });
  const MockProjectStore = vi.fn(function() { return mockProjectStore; });
  const MockImportExportService = vi.fn(function() { return mockImportExport; });
  const MockDockerRuntime = vi.fn(function() { return mockDockerRuntime; });
  const MockPodmanRuntime = vi.fn(function() { return ({}); });
  const MockRuntimeHealthMonitor = vi.fn(function() { return mockRuntimeHealth; });
  // Alias kept for tests that reference the old name
  const MockDockerHealthMonitor = MockRuntimeHealthMonitor;
  const MockCredentialManager = vi.fn(function() { return mockCredentialManager; });
  const MockLoginManager = vi.fn(function() { return mockLoginManager; });
  const MockLogParser = vi.fn(function() { return mockLogParser; });
  const MockLoopRunner = vi.fn(function() { return mockLoopRunner; });
  const MockLoopScheduler = vi.fn(function() { return mockScheduler; });
  const MockLogExporter = vi.fn(function() { return mockLogExporter; });
  const MockTerminalManager = vi.fn(function() { return mockTerminalManager; });
  const MockSelfUpdater = vi.fn(function() { return mockSelfUpdater; });
  const MockCleanupManager = vi.fn(function() { return mockCleanupManager; });

  const mockPreValidationStore = {};
  const MockPreValidationStore = vi.fn(function() { return mockPreValidationStore; });

  const mockHooksStore = {};
  const MockHooksStore = vi.fn(function() { return mockHooksStore; });

  const mockLoopScriptsStore = {};
  const MockLoopScriptsStore = vi.fn(function() { return mockLoopScriptsStore; });

  const mockClaudeSettingsStore = {};
  const MockClaudeSettingsStore = vi.fn(function() { return mockClaudeSettingsStore; });

  const mockVmManager = {
    isMultipassAvailable: vi.fn().mockResolvedValue(false),
    listVMs: vi.fn().mockResolvedValue([]),
    isZephyrVM: vi.fn().mockReturnValue(false),
  };
  const MockVMManager = vi.fn(function() { return mockVmManager; });

  const mockSshKeyManager = {};
  const MockSSHKeyManager = vi.fn(function() { return mockSshKeyManager; });

  const mockDeployKeyStore = {
    detectOrphans: vi.fn(),
    listOrphaned: vi.fn().mockReturnValue([]),
    listActiveByProject: vi.fn().mockReturnValue([]),
    record: vi.fn(),
    markCleaned: vi.fn(),
  };
  const MockDeployKeyStore = vi.fn(function() { return mockDeployKeyStore; });

  const mockKiroHooksStore = {};
  const MockKiroHooksStore = vi.fn(function() { return mockKiroHooksStore; });

  return {
    mockConfigManager,
    mockProjectStore,
    mockImportExport,
    mockDockerRuntime,
    mockRuntimeHealth,
    mockDockerHealth,
    mockCredentialManager,
    mockLoginManager,
    mockLogParser,
    mockLoopRunner,
    mockScheduler,
    mockLogExporter,
    mockTerminalManager,
    mockSelfUpdater,
    mockCleanupManager,
    mockPreValidationStore,
    mockHooksStore,
    mockLoopScriptsStore,
    mockClaudeSettingsStore,
    mockVmManager,
    mockSshKeyManager,
    mockDeployKeyStore,
    mockKiroHooksStore,
    MockConfigManager,
    MockProjectStore,
    MockImportExportService,
    MockDockerRuntime,
    MockPodmanRuntime,
    MockRuntimeHealthMonitor,
    MockDockerHealthMonitor,
    MockCredentialManager,
    MockLoginManager,
    MockLogParser,
    MockLoopRunner,
    MockLoopScheduler,
    MockLogExporter,
    MockTerminalManager,
    MockSelfUpdater,
    MockCleanupManager,
    MockPreValidationStore,
    MockHooksStore,
    MockLoopScriptsStore,
    MockClaudeSettingsStore,
    MockVMManager,
    MockSSHKeyManager,
    MockDeployKeyStore,
    MockKiroHooksStore,
  };
});

vi.mock('../../src/services/config-manager', () => ({
  ConfigManager: MockConfigManager,
}));

vi.mock('../../src/services/project-store', () => ({
  ProjectStore: MockProjectStore,
}));

vi.mock('../../src/services/import-export', () => ({
  ImportExportService: MockImportExportService,
}));

vi.mock('../../src/services/docker-runtime', () => ({
  DockerRuntime: MockDockerRuntime,
}));

vi.mock('../../src/services/podman-runtime', () => ({
  PodmanRuntime: MockPodmanRuntime,
}));

vi.mock('../../src/services/runtime-health', () => ({
  RuntimeHealthMonitor: MockRuntimeHealthMonitor,
}));

vi.mock('../../src/services/credential-manager', () => ({
  CredentialManager: MockCredentialManager,
}));

vi.mock('../../src/services/login-manager', () => ({
  LoginManager: MockLoginManager,
}));

vi.mock('../../src/services/log-parser', () => ({
  LogParser: MockLogParser,
}));

vi.mock('../../src/services/loop-runner', () => ({
  LoopRunner: MockLoopRunner,
}));

vi.mock('../../src/services/scheduler', () => ({
  LoopScheduler: MockLoopScheduler,
}));

vi.mock('../../src/services/log-exporter', () => ({
  LogExporter: MockLogExporter,
}));

vi.mock('../../src/services/terminal-manager', () => ({
  TerminalManager: MockTerminalManager,
}));

vi.mock('../../src/services/self-updater', () => ({
  SelfUpdater: MockSelfUpdater,
}));

vi.mock('../../src/services/cleanup-manager', () => ({
  CleanupManager: MockCleanupManager,
}));

vi.mock('../../src/services/pre-validation-store', () => ({
  PreValidationStore: MockPreValidationStore,
}));

vi.mock('../../src/services/hooks-store', () => ({
  HooksStore: MockHooksStore,
}));

vi.mock('../../src/services/loop-scripts-store', () => ({
  LoopScriptsStore: MockLoopScriptsStore,
}));

vi.mock('../../src/services/claude-settings-store', () => ({
  ClaudeSettingsStore: MockClaudeSettingsStore,
}));

vi.mock('../../src/services/vm-manager', () => ({
  VMManager: MockVMManager,
}));

vi.mock('../../src/services/ssh-key-manager', () => ({
  SSHKeyManager: MockSSHKeyManager,
}));

vi.mock('../../src/services/deploy-key-store', () => ({
  DeployKeyStore: MockDeployKeyStore,
}));

vi.mock('../../src/services/kiro-hooks-store', () => ({
  KiroHooksStore: MockKiroHooksStore,
}));

// ── Mock logging ─────────────────────────────────────────────────────────────

const {
  mockLogger,
  mockSetupLogging,
  mockGetLogger,
  mockSetLogLevel,
} = vi.hoisted(() => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    silly: vi.fn(),
  };

  const mockSetupLogging = vi.fn();
  const mockGetLogger = vi.fn(() => mockLogger);
  const mockSetLogLevel = vi.fn();

  return {
    mockLogger,
    mockSetupLogging,
    mockGetLogger,
    mockSetLogLevel,
  };
});

vi.mock('../../src/services/logging', () => ({
  setupLogging: mockSetupLogging,
  getLogger: mockGetLogger,
  setLogLevel: mockSetLogLevel,
}));

// ── Mock IPC handlers ────────────────────────────────────────────────────────

const {
  mockRegisterDataHandlers,
  mockRegisterDockerHandlers,
  mockRegisterCredentialHandlers,
  mockRegisterLoopHandlers,
  mockRegisterLogHandlers,
  mockRegisterTerminalHandlers,
  mockRegisterUpdateHandlers,
  mockRegisterVMHandlers,
  mockRegisterFactoryTaskHandlers,
  MockFactoryTaskStore,
} = vi.hoisted(() => {
  const mockRegisterDataHandlers = vi.fn();
  const mockRegisterDockerHandlers = vi.fn();
  const mockRegisterCredentialHandlers = vi.fn();
  const mockRegisterLoopHandlers = vi.fn();
  const mockRegisterLogHandlers = vi.fn();
  const mockRegisterTerminalHandlers = vi.fn();
  const mockRegisterUpdateHandlers = vi.fn();
  const mockRegisterVMHandlers = vi.fn();
  const mockRegisterFactoryTaskHandlers = vi.fn();
  const MockFactoryTaskStore = vi.fn(function() { return {}; });

  return {
    mockRegisterDataHandlers,
    mockRegisterDockerHandlers,
    mockRegisterCredentialHandlers,
    mockRegisterLoopHandlers,
    mockRegisterLogHandlers,
    mockRegisterTerminalHandlers,
    mockRegisterUpdateHandlers,
    mockRegisterVMHandlers,
    mockRegisterFactoryTaskHandlers,
    MockFactoryTaskStore,
  };
});

vi.mock('../../src/main/ipc-handlers/data-handlers', () => ({
  registerDataHandlers: mockRegisterDataHandlers,
}));

vi.mock('../../src/main/ipc-handlers/runtime-handlers', () => ({
  registerRuntimeHandlers: mockRegisterDockerHandlers,
}));

vi.mock('../../src/main/ipc-handlers/credential-handlers', () => ({
  registerCredentialHandlers: mockRegisterCredentialHandlers,
}));

vi.mock('../../src/main/ipc-handlers/loop-handlers', () => ({
  registerLoopHandlers: mockRegisterLoopHandlers,
}));

vi.mock('../../src/main/ipc-handlers/log-handlers', () => ({
  registerLogHandlers: mockRegisterLogHandlers,
}));

vi.mock('../../src/main/ipc-handlers/terminal-handlers', () => ({
  registerTerminalHandlers: mockRegisterTerminalHandlers,
}));

vi.mock('../../src/main/ipc-handlers/update-handlers', () => ({
  registerUpdateHandlers: mockRegisterUpdateHandlers,
}));

vi.mock('../../src/main/ipc-handlers/vm-handlers', () => ({
  registerVMHandlers: mockRegisterVMHandlers,
}));

vi.mock('../../src/main/ipc-handlers/factory-task-handlers', () => ({
  registerFactoryTaskHandlers: mockRegisterFactoryTaskHandlers,
}));

vi.mock('../../src/services/factory-task-store', () => ({
  FactoryTaskStore: MockFactoryTaskStore,
}));

// ── Mock menu ────────────────────────────────────────────────────────────────

const { mockBuildApplicationMenu } = vi.hoisted(() => {
  const mockBuildApplicationMenu = vi.fn();
  return { mockBuildApplicationMenu };
});

vi.mock('../../src/main/menu', () => ({
  buildApplicationMenu: mockBuildApplicationMenu,
}));

// ── Mock globals ─────────────────────────────────────────────────────────────

// @ts-expect-error - global declaration for Vite dev server URL
global.MAIN_WINDOW_VITE_DEV_SERVER_URL = undefined;
// @ts-expect-error - global declaration for Vite name
global.MAIN_WINDOW_VITE_NAME = 'main_window';

// ── Helper to trigger app events ─────────────────────────────────────────────

async function triggerAppReady() {
  const readyHandlers = appEventListeners['ready'] || [];
  for (const handler of readyHandlers) {
    await handler();
  }
}

function triggerWindowAllClosed() {
  const handlers = appEventListeners['window-all-closed'] || [];
  for (const handler of handlers) {
    handler();
  }
}

function triggerActivate() {
  const handlers = appEventListeners['activate'] || [];
  for (const handler of handlers) {
    handler();
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

// Import the main entry point at module level
// This triggers all service instantiation and IPC handler registration
import '../../src/main/index';

describe('Main Entry Point', () => {
  describe('Service Instantiation', () => {
    it('should instantiate ConfigManager', () => {
      expect(MockConfigManager).toHaveBeenCalled();
    });

    it('should instantiate ProjectStore with ConfigManager', () => {
      expect(MockProjectStore).toHaveBeenCalledWith(mockConfigManager);
    });

    it('should instantiate ImportExportService with ConfigManager', () => {
      expect(MockImportExportService).toHaveBeenCalledWith(mockConfigManager);
    });

    it('should instantiate RuntimeHealthMonitor with a ContainerRuntime', () => {
      expect(MockRuntimeHealthMonitor).toHaveBeenCalledWith(mockDockerRuntime);
    });

    it('should instantiate CredentialManager with zephyr config dir', () => {
      expect(MockCredentialManager).toHaveBeenCalledWith('/mock/home/.zephyr');
    });

    it('should instantiate LoginManager with CredentialManager', () => {
      expect(MockLoginManager).toHaveBeenCalledWith(mockCredentialManager);
    });

    it('should instantiate LogParser', () => {
      expect(MockLogParser).toHaveBeenCalled();
    });

    it('should instantiate LoopRunner with ContainerRuntime, LogParser, max concurrent 3, and VMManager', () => {
      expect(MockLoopRunner).toHaveBeenCalledWith(mockDockerRuntime, mockLogParser, 3, mockVmManager);
    });

    it('should instantiate LoopScheduler with LoopRunner', () => {
      expect(MockLoopScheduler).toHaveBeenCalledWith(mockLoopRunner);
    });

    it('should instantiate LogExporter', () => {
      expect(MockLogExporter).toHaveBeenCalled();
    });

    it('should instantiate TerminalManager with ContainerRuntime', () => {
      expect(MockTerminalManager).toHaveBeenCalledWith(mockDockerRuntime);
    });

    it('should instantiate SelfUpdater with app path and LoopRunner', () => {
      expect(MockSelfUpdater).toHaveBeenCalledWith('/mock/app/path', mockLoopRunner);
    });

    it('should instantiate CleanupManager with ContainerRuntime', () => {
      expect(MockCleanupManager).toHaveBeenCalledWith(mockDockerRuntime);
    });
  });

  describe('IPC Handler Registration', () => {
    it('should register data handlers with ConfigManager, ProjectStore, ImportExport, PreValidationStore, HooksStore, LoopRunner, ContainerRuntime, CredentialManager, SSHKeyManager, and DeployKeyStore', () => {
      expect(mockRegisterDataHandlers).toHaveBeenCalledWith({
        configManager: mockConfigManager,
        projectStore: mockProjectStore,
        importExport: mockImportExport,
        preValidationStore: mockPreValidationStore,
        hooksStore: mockHooksStore,
        kiroHooksStore: mockKiroHooksStore,
        loopScriptsStore: mockLoopScriptsStore,
        claudeSettingsStore: mockClaudeSettingsStore,
        loopRunner: mockLoopRunner,
        runtime: mockDockerRuntime,
        credentialManager: mockCredentialManager,
        sshKeyManager: mockSshKeyManager,
        deployKeyStore: mockDeployKeyStore,
      });
    });

    it('should register runtime handlers with runtime and runtimeHealth', () => {
      expect(mockRegisterDockerHandlers).toHaveBeenCalledWith({
        runtime: mockDockerRuntime,
        runtimeHealth: mockRuntimeHealth,
      });
    });

    it('should register credential handlers with CredentialManager and LoginManager', () => {
      expect(mockRegisterCredentialHandlers).toHaveBeenCalledWith({
        credentialManager: mockCredentialManager,
        loginManager: mockLoginManager,
      });
    });

    it('should register loop handlers with LoopRunner, Scheduler, CleanupManager, and injection services', () => {
      expect(mockRegisterLoopHandlers).toHaveBeenCalledWith(
        expect.objectContaining({
          loopRunner: mockLoopRunner,
          scheduler: mockScheduler,
          cleanupManager: mockCleanupManager,
          projectStore: mockProjectStore,
          preValidationStore: mockPreValidationStore,
          hooksStore: mockHooksStore,
          runtime: mockDockerRuntime,
        })
      );
    });

    it('should register log handlers with LogExporter and LoopRunner', () => {
      expect(mockRegisterLogHandlers).toHaveBeenCalledWith({
        logExporter: mockLogExporter,
        loopRunner: mockLoopRunner,
      });
    });

    it('should register terminal handlers with TerminalManager', () => {
      expect(mockRegisterTerminalHandlers).toHaveBeenCalledWith({
        terminalManager: mockTerminalManager,
        vmManager: mockVmManager,
      });
    });

    it('should register update handlers with SelfUpdater', () => {
      expect(mockRegisterUpdateHandlers).toHaveBeenCalledWith({
        selfUpdater: mockSelfUpdater,
      });
    });

    it('should register VM handlers with VMManager and LoopRunner', () => {
      expect(mockRegisterVMHandlers).toHaveBeenCalledWith({
        vmManager: mockVmManager,
        loopRunner: mockLoopRunner,
      });
    });

    it('should register legacy ping handler', async () => {
      expect(handlerRegistry['ping']).toBeDefined();
      const result = await handlerRegistry['ping']();
      expect(result).toBe('pong');
    });
  });

  describe('Window Creation', () => {
    it('should create BrowserWindow with correct dimensions', async () => {
      mockConfigManager.loadJson.mockResolvedValue({});
      vi.clearAllMocks();
      await triggerAppReady();

      expect(BrowserWindowConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 1200,
          height: 800,
        })
      );
    });

    it('should create BrowserWindow with security settings', async () => {
      mockConfigManager.loadJson.mockResolvedValue({});
      vi.clearAllMocks();
      await triggerAppReady();

      expect(BrowserWindowConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          webPreferences: expect.objectContaining({
            contextIsolation: true,
            nodeIntegration: false,
            preload: expect.stringContaining('preload.js'),
          }),
        })
      );
    });

    it('should set TerminalManager webContents after window creation', async () => {
      mockConfigManager.loadJson.mockResolvedValue({});
      vi.clearAllMocks();
      await triggerAppReady();

      expect(mockTerminalManager.setWebContents).toHaveBeenCalledWith(mockWebContents);
    });

    it('should load static file in production', async () => {
      mockConfigManager.loadJson.mockResolvedValue({});
      vi.clearAllMocks();
      await triggerAppReady();

      expect(mockBrowserWindow.loadFile).toHaveBeenCalledWith(
        expect.stringContaining('renderer/main_window/index.html')
      );
    });
  });

  describe('App Lifecycle - ready', () => {
    it('should log application starting', async () => {
      mockConfigManager.loadJson.mockResolvedValue({});
      vi.clearAllMocks();
      await triggerAppReady();

      expect(mockLogger.info).toHaveBeenCalledWith('Application starting');
    });

    it('should load settings and set log level', async () => {
      mockConfigManager.loadJson.mockResolvedValue({ log_level: 'DEBUG' });
      vi.clearAllMocks();
      await triggerAppReady();

      expect(mockConfigManager.loadJson).toHaveBeenCalledWith('settings.json');
      expect(mockSetLogLevel).toHaveBeenCalledWith('debug');
      expect(mockLogger.info).toHaveBeenCalledWith('Log level set from settings', { level: 'debug' });
    });

    it('should handle missing settings gracefully', async () => {
      mockConfigManager.loadJson.mockResolvedValue(null);
      vi.clearAllMocks();
      await triggerAppReady();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Could not load settings, using default log level',
        expect.anything()
      );
    });

    it('should build application menu', async () => {
      mockConfigManager.loadJson.mockResolvedValue({});
      vi.clearAllMocks();
      await triggerAppReady();

      expect(mockBuildApplicationMenu).toHaveBeenCalled();
    });

    it('should start runtime health monitoring', async () => {
      mockConfigManager.loadJson.mockResolvedValue({});
      vi.clearAllMocks();
      await triggerAppReady();

      expect(mockRuntimeHealth.start).toHaveBeenCalled();
    });

    it('should log successful startup', async () => {
      mockConfigManager.loadJson.mockResolvedValue({});
      vi.clearAllMocks();
      await triggerAppReady();

      expect(mockLogger.info).toHaveBeenCalledWith('Application started successfully');
    });
  });

  describe('App Lifecycle - window-all-closed', () => {
    it('should not stop runtime health monitoring on window-all-closed (moved to before-quit)', () => {
      vi.clearAllMocks();
      triggerWindowAllClosed();

      // Runtime health monitoring is now stopped in before-quit, not window-all-closed
      expect(mockRuntimeHealth.stop).not.toHaveBeenCalled();
    });

    it('should quit app on non-macOS platforms', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', writable: true });

      vi.clearAllMocks();
      triggerWindowAllClosed();

      expect(mockApp.quit).toHaveBeenCalled();

      // Restore
      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    });

    it('should not quit app on macOS', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });

      vi.clearAllMocks();
      triggerWindowAllClosed();

      expect(mockApp.quit).not.toHaveBeenCalled();

      // Restore
      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    });
  });

  describe('App Lifecycle - activate', () => {
    it('should create window if none exist', async () => {
      BrowserWindowConstructor.getAllWindows = vi.fn(() => []);
      mockConfigManager.loadJson.mockResolvedValue({});
      vi.clearAllMocks();

      triggerActivate();

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(BrowserWindowConstructor).toHaveBeenCalled();
    });

    it('should not create window if one already exists', () => {
      BrowserWindowConstructor.getAllWindows = vi.fn(() => [mockBrowserWindow as unknown as BrowserWindowType]);

      vi.clearAllMocks();

      triggerActivate();

      expect(BrowserWindowConstructor).not.toHaveBeenCalled();
    });
  });

  describe('Integration', () => {
    it('should register all app lifecycle handlers', () => {
      expect(appEventListeners['ready']).toBeDefined();
      expect(appEventListeners['ready'].length).toBeGreaterThan(0);
      expect(appEventListeners['window-all-closed']).toBeDefined();
      expect(appEventListeners['window-all-closed'].length).toBeGreaterThan(0);
      expect(appEventListeners['activate']).toBeDefined();
      expect(appEventListeners['activate'].length).toBeGreaterThan(0);
    });
  });
});
