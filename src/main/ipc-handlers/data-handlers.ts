// IPC handlers for data layer services (projects, settings, config import/export).
// Registered once during app startup via registerDataHandlers().
// All handlers run in the main process and delegate to service instances.

import { ipcMain, dialog } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { ConfigManager } from '../../services/config-manager';
import type { ProjectStore } from '../../services/project-store';
import type { ImportExportService } from '../../services/import-export';
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
}

export function registerDataHandlers(services: DataServices): void {
  const { configManager, projectStore, importExport } = services;
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
}
