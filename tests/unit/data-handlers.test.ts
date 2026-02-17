/**
 * Unit tests for src/main/ipc-handlers/data-handlers.ts
 *
 * Verifies that registerDataHandlers() correctly wires IPC channels to
 * service methods. Each handler is extracted via the mock ipcMain.handle
 * registry, then called directly to confirm routing.
 *
 * Why we test routing: the IPC layer is the boundary between renderer and
 * main process. A mis-wired channel means the renderer silently gets undefined
 * or stale data. Unit tests here catch those regressions cheaply, without
 * needing a real Electron process.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../src/shared/ipc-channels';
import { createDefaultSettings, createProjectConfig } from '../../src/shared/models';

// ── Mock electron ────────────────────────────────────────────────────────────

// Registry of handlers registered via ipcMain.handle()
const handlerRegistry: Record<string, (...args: unknown[]) => unknown> = {};

const { mockDialogShowSaveDialog, mockDialogShowOpenDialog } = vi.hoisted(() => ({
  mockDialogShowSaveDialog: vi.fn(),
  mockDialogShowOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlerRegistry[channel] = handler;
    },
  },
  dialog: {
    showSaveDialog: mockDialogShowSaveDialog,
    showOpenDialog: mockDialogShowOpenDialog,
  },
}));

// ── Import subject under test (after mocks are in place) ─────────────────────

import { registerDataHandlers } from '../../src/main/ipc-handlers/data-handlers';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fake IpcMainInvokeEvent — handlers typically ignore it. */
const fakeEvent = {} as IpcMainInvokeEvent;

/** Call a registered handler as if invoked from the renderer. */
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlerRegistry[channel];
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  return handler(fakeEvent, ...args);
}

// ── Service mocks ─────────────────────────────────────────────────────────────

const mockProjectStore = {
  listProjects: vi.fn(),
  getProject: vi.fn(),
  addProject: vi.fn(),
  updateProject: vi.fn(),
  removeProject: vi.fn(),
};

const mockConfigManager = {
  loadJson: vi.fn(),
  saveJson: vi.fn(),
  ensureConfigDir: vi.fn(),
  getConfigDir: vi.fn(),
};

const mockImportExport = {
  exportConfig: vi.fn(),
  importConfig: vi.fn(),
};

// ── Setup ─────────────────────────────────────────────────────────────────────

describe('registerDataHandlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Clear registry between test suites
    for (const key of Object.keys(handlerRegistry)) {
      delete handlerRegistry[key];
    }
    registerDataHandlers({
      configManager: mockConfigManager as never,
      projectStore: mockProjectStore as never,
      importExport: mockImportExport as never,
    });
  });

  // ── Projects ───────────────────────────────────────────────────────────────

  describe('projects:list', () => {
    it('delegates to projectStore.listProjects()', async () => {
      const projects = [createProjectConfig({ name: 'Alpha' })];
      mockProjectStore.listProjects.mockResolvedValue(projects);
      const result = await invoke(IPC.PROJECTS_LIST);
      expect(mockProjectStore.listProjects).toHaveBeenCalledOnce();
      expect(result).toEqual(projects);
    });

    it('returns empty array when store returns []', async () => {
      mockProjectStore.listProjects.mockResolvedValue([]);
      const result = await invoke(IPC.PROJECTS_LIST);
      expect(result).toEqual([]);
    });
  });

  describe('projects:get', () => {
    it('passes id to projectStore.getProject()', async () => {
      const project = createProjectConfig({ name: 'Beta' });
      mockProjectStore.getProject.mockResolvedValue(project);
      const result = await invoke(IPC.PROJECTS_GET, project.id);
      expect(mockProjectStore.getProject).toHaveBeenCalledWith(project.id);
      expect(result).toEqual(project);
    });

    it('returns null when project not found', async () => {
      mockProjectStore.getProject.mockResolvedValue(null);
      const result = await invoke(IPC.PROJECTS_GET, 'nonexistent-id');
      expect(result).toBeNull();
    });
  });

  describe('projects:add', () => {
    it('passes config to projectStore.addProject() and returns saved project', async () => {
      const input = { name: 'Gamma', repo_url: 'https://github.com/x/y', jtbd: '', docker_image: 'ubuntu', custom_prompts: {} };
      const saved = createProjectConfig(input);
      mockProjectStore.addProject.mockResolvedValue(saved);
      const result = await invoke(IPC.PROJECTS_ADD, input);
      expect(mockProjectStore.addProject).toHaveBeenCalledWith(input);
      expect(result).toEqual(saved);
    });
  });

  describe('projects:update', () => {
    it('passes id and partial to projectStore.updateProject()', async () => {
      const project = createProjectConfig({ name: 'Delta' });
      const updated = { ...project, name: 'Delta 2' };
      mockProjectStore.updateProject.mockResolvedValue(updated);
      const result = await invoke(IPC.PROJECTS_UPDATE, project.id, { name: 'Delta 2' });
      expect(mockProjectStore.updateProject).toHaveBeenCalledWith(project.id, { name: 'Delta 2' });
      expect(result).toEqual(updated);
    });
  });

  describe('projects:remove', () => {
    it('passes id to projectStore.removeProject() and returns boolean', async () => {
      mockProjectStore.removeProject.mockResolvedValue(true);
      const result = await invoke(IPC.PROJECTS_REMOVE, 'some-id');
      expect(mockProjectStore.removeProject).toHaveBeenCalledWith('some-id');
      expect(result).toBe(true);
    });

    it('returns false when project does not exist', async () => {
      mockProjectStore.removeProject.mockResolvedValue(false);
      const result = await invoke(IPC.PROJECTS_REMOVE, 'ghost-id');
      expect(result).toBe(false);
    });
  });

  // ── Settings ───────────────────────────────────────────────────────────────

  describe('settings:load', () => {
    it('returns stored settings when present', async () => {
      const stored = createDefaultSettings();
      stored.log_level = 'DEBUG';
      mockConfigManager.loadJson.mockResolvedValue(stored);
      const result = await invoke(IPC.SETTINGS_LOAD);
      expect(mockConfigManager.loadJson).toHaveBeenCalledWith('settings.json');
      expect(result).toEqual(stored);
    });

    it('returns default settings when file not found (loadJson returns null)', async () => {
      mockConfigManager.loadJson.mockResolvedValue(null);
      const result = await invoke(IPC.SETTINGS_LOAD);
      expect(result).toEqual(createDefaultSettings());
    });
  });

  describe('settings:save', () => {
    it('passes settings to configManager.saveJson()', async () => {
      const settings = createDefaultSettings();
      mockConfigManager.saveJson.mockResolvedValue(undefined);
      await invoke(IPC.SETTINGS_SAVE, settings);
      expect(mockConfigManager.saveJson).toHaveBeenCalledWith('settings.json', settings);
    });
  });

  // ── Config import/export ───────────────────────────────────────────────────

  describe('config:export', () => {
    it('opens save dialog, exports to chosen path, returns path', async () => {
      mockDialogShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/out.zip' });
      mockImportExport.exportConfig.mockResolvedValue(undefined);
      const result = await invoke(IPC.CONFIG_EXPORT);
      expect(mockDialogShowSaveDialog).toHaveBeenCalledOnce();
      expect(mockImportExport.exportConfig).toHaveBeenCalledWith('/tmp/out.zip');
      expect(result).toBe('/tmp/out.zip');
    });

    it('returns null when dialog is cancelled', async () => {
      mockDialogShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
      const result = await invoke(IPC.CONFIG_EXPORT);
      expect(mockImportExport.exportConfig).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('config:import', () => {
    it('opens open dialog, imports from chosen file, returns true', async () => {
      mockDialogShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/backup.zip'] });
      mockImportExport.importConfig.mockResolvedValue(undefined);
      const result = await invoke(IPC.CONFIG_IMPORT);
      expect(mockDialogShowOpenDialog).toHaveBeenCalledOnce();
      expect(mockImportExport.importConfig).toHaveBeenCalledWith('/tmp/backup.zip');
      expect(result).toBe(true);
    });

    it('returns false when dialog is cancelled', async () => {
      mockDialogShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
      const result = await invoke(IPC.CONFIG_IMPORT);
      expect(mockImportExport.importConfig).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });

  // ── Channel registration ───────────────────────────────────────────────────

  describe('channel registration', () => {
    it('registers all expected channels', () => {
      const expected = [
        IPC.PROJECTS_LIST,
        IPC.PROJECTS_GET,
        IPC.PROJECTS_ADD,
        IPC.PROJECTS_UPDATE,
        IPC.PROJECTS_REMOVE,
        IPC.SETTINGS_LOAD,
        IPC.SETTINGS_SAVE,
        IPC.CONFIG_EXPORT,
        IPC.CONFIG_IMPORT,
      ];
      for (const channel of expected) {
        expect(handlerRegistry[channel], `Missing handler for ${channel}`).toBeDefined();
      }
    });
  });
});
