// IPC handlers for data layer services (projects, settings, config import/export).
// Registered once during app startup via registerDataHandlers().
// All handlers run in the main process and delegate to service instances.

import { ipcMain, dialog } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { ConfigManager } from '../../services/config-manager';
import type { ProjectStore } from '../../services/project-store';
import type { ImportExportService } from '../../services/import-export';
import type { PreValidationStore } from '../../services/pre-validation-store';
import type { HooksStore } from '../../services/hooks-store';
import type { LoopScriptsStore } from '../../services/loop-scripts-store';
import type { LoopRunner } from '../../services/loop-runner';
import type { DockerManager } from '../../services/docker-manager';
import type { CredentialManager } from '../../services/credential-manager';
import type { AppSettings, ProjectConfig } from '../../shared/models';
import { createDefaultSettings } from '../../shared/models';
import { setLogLevel, getLogger, type LogLevel } from '../../services/logging';

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

export interface DataServices {
  configManager: ConfigManager;
  projectStore: ProjectStore;
  importExport: ImportExportService;
  preValidationStore: PreValidationStore;
  hooksStore: HooksStore;
  loopScriptsStore: LoopScriptsStore;
  loopRunner: LoopRunner;
  dockerManager: DockerManager;
  credentialManager: CredentialManager;
}

export function registerDataHandlers(services: DataServices): void {
  const { configManager, projectStore, importExport, preValidationStore, hooksStore, loopScriptsStore, loopRunner, dockerManager, credentialManager } =
    services;
  const logger = getLogger('ipc');

  // ── Projects ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.PROJECTS_LIST, async (): Promise<ProjectConfig[]> => {
    return projectStore.listProjects();
  });

  ipcMain.handle(
    IPC.PROJECTS_GET,
    async (_event, id: string): Promise<ProjectConfig | null> => {
      return projectStore.getProject(id);
    },
  );

  ipcMain.handle(
    IPC.PROJECTS_ADD,
    async (_event, config: Omit<ProjectConfig, 'id' | 'created_at' | 'updated_at'>): Promise<ProjectConfig> => {
      return projectStore.addProject(config as ProjectConfig);
    },
  );

  ipcMain.handle(
    IPC.PROJECTS_UPDATE,
    async (
      _event,
      id: string,
      partial: Partial<Omit<ProjectConfig, 'id' | 'created_at'>>,
    ): Promise<ProjectConfig> => {
      return projectStore.updateProject(id, partial);
    },
  );

  ipcMain.handle(
    IPC.PROJECTS_REMOVE,
    async (_event, id: string): Promise<boolean> => {
      // Stop any running loop for this project before removing it
      try {
        const running = loopRunner.listRunning();
        if (running.some((l) => l.projectId === id)) {
          await loopRunner.stopLoop(id);
        }
      } catch (err) {
        logger.warn('Failed to stop loop for deleted project', { projectId: id, err });
      }

      // Remove all Docker containers associated with this project
      try {
        const containers = await dockerManager.listRunningContainers();
        const projectContainers = containers.filter((c) => c.projectId === id);
        for (const container of projectContainers) {
          try {
            await dockerManager.removeContainer(container.id, true);
          } catch (err) {
            logger.warn('Failed to remove container for deleted project', { containerId: container.id, err });
          }
        }
      } catch (err) {
        logger.warn('Failed to list containers for deleted project', { projectId: id, err });
      }

      // Clean up any stored GitHub PAT for this project
      try {
        await credentialManager.deleteGithubPat(id);
      } catch (err) {
        logger.warn('Failed to delete GitHub PAT for deleted project', { projectId: id, err });
      }

      return projectStore.removeProject(id);
    },
  );

  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.SETTINGS_LOAD, async (): Promise<AppSettings> => {
    const stored = await configManager.loadJson<AppSettings>('settings.json');
    return stored ?? createDefaultSettings();
  });

  ipcMain.handle(
    IPC.SETTINGS_SAVE,
    async (_event, settings: AppSettings): Promise<void> => {
      await configManager.saveJson('settings.json', settings);

      // Update log level if it changed
      if (settings.log_level) {
        const mappedLevel = mapLogLevel(settings.log_level);
        setLogLevel(mappedLevel);
        logger.info('Log level updated from settings', { level: mappedLevel });
      }

      // Update max concurrent containers if it changed
      if (settings.max_concurrent_containers) {
        loopRunner.setMaxConcurrent(settings.max_concurrent_containers);
        logger.info('Max concurrent containers updated from settings', { max: settings.max_concurrent_containers });
      }
    },
  );

  // ── Config import/export ──────────────────────────────────────────────────

  ipcMain.handle(IPC.CONFIG_EXPORT, async (): Promise<string | null> => {
    const result = await dialog.showSaveDialog({
      title: 'Export Zephyr Config',
      defaultPath: `zephyr-config-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await importExport.exportConfig(result.filePath);
    return result.filePath;
  });

  ipcMain.handle(IPC.CONFIG_IMPORT, async (): Promise<boolean> => {
    const result = await dialog.showOpenDialog({
      title: 'Import Zephyr Config',
      filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return false;
    await importExport.importConfig(result.filePaths[0]);
    return true;
  });

  // ── Pre-validation scripts ─────────────────────────────────────────────────

  ipcMain.handle(IPC.PRE_VALIDATION_LIST, async () => {
    return preValidationStore.listScripts();
  });

  ipcMain.handle(IPC.PRE_VALIDATION_GET, async (_event, filename: string) => {
    return preValidationStore.getScript(filename);
  });

  ipcMain.handle(
    IPC.PRE_VALIDATION_ADD,
    async (_event, filename: string, content: string): Promise<void> => {
      await preValidationStore.addScript(filename, content);
    },
  );

  ipcMain.handle(IPC.PRE_VALIDATION_REMOVE, async (_event, filename: string): Promise<boolean> => {
    return preValidationStore.removeScript(filename);
  });

  // ── Claude hooks ───────────────────────────────────────────────────────────

  ipcMain.handle(IPC.HOOKS_LIST, async () => {
    return hooksStore.listHooks();
  });

  ipcMain.handle(IPC.HOOKS_GET, async (_event, filename: string) => {
    return hooksStore.getHook(filename);
  });

  ipcMain.handle(
    IPC.HOOKS_ADD,
    async (_event, filename: string, content: string): Promise<void> => {
      await hooksStore.addHook(filename, content);
    },
  );

  ipcMain.handle(IPC.HOOKS_REMOVE, async (_event, filename: string): Promise<boolean> => {
    return hooksStore.removeHook(filename);
  });

  // ── Loop scripts ───────────────────────────────────────────────────────────

  ipcMain.handle(IPC.LOOP_SCRIPTS_LIST, async () => {
    return loopScriptsStore.listScripts();
  });

  ipcMain.handle(IPC.LOOP_SCRIPTS_GET, async (_event, filename: string) => {
    return loopScriptsStore.getScript(filename);
  });

  ipcMain.handle(
    IPC.LOOP_SCRIPTS_ADD,
    async (_event, filename: string, content: string): Promise<void> => {
      await loopScriptsStore.addScript(filename, content);
    },
  );

  ipcMain.handle(IPC.LOOP_SCRIPTS_REMOVE, async (_event, filename: string): Promise<boolean> => {
    return loopScriptsStore.removeScript(filename);
  });
}
