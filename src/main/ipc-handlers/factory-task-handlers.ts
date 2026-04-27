// IPC handlers for the Coding Factory kanban task board.
// Registered once during app startup via registerFactoryTaskHandlers().
// All handlers run in the main process and delegate to FactoryTaskStore.

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { FactoryTaskStore } from '../../services/factory-task-store';
import type { FactoryTask } from '../../shared/factory-types';
import type { ProjectConfig } from '../../shared/models';

export interface FactoryTaskServices {
  factoryTaskStore: FactoryTaskStore;
  projectStore?: { getProject: (id: string) => ProjectConfig | null };
}

/**
 * Broadcast the updated task list for a project to all renderer windows.
 *
 * Called after every mutation so all open windows stay in sync without
 * polling. Payload: (projectId, tasks[]).
 */
function broadcastTaskChanged(
  factoryTaskStore: FactoryTaskStore,
  projectId: string,
): void {
  const tasks = factoryTaskStore.getQueue(projectId).tasks;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.FACTORY_TASK_CHANGED, projectId, tasks);
    }
  }
}

export function registerFactoryTaskHandlers(services: FactoryTaskServices): void {
  const { factoryTaskStore, projectStore } = services;

  // List all tasks for a project
  ipcMain.handle(IPC.FACTORY_TASK_LIST, (_event, projectId: string): FactoryTask[] => {
    return factoryTaskStore.getQueue(projectId).tasks;
  });

  // Get a single task by ID
  ipcMain.handle(
    IPC.FACTORY_TASK_GET,
    (_event, projectId: string, taskId: string): FactoryTask | null => {
      return factoryTaskStore.getTask(projectId, taskId);
    },
  );

  // Add a new task to backlog
  ipcMain.handle(
    IPC.FACTORY_TASK_ADD,
    (
      _event,
      projectId: string,
      title: string,
      description: string,
    ): FactoryTask => {
      const task = factoryTaskStore.addTask(projectId, { title, description });
      broadcastTaskChanged(factoryTaskStore, projectId);
      return task;
    },
  );

  // Move a task to a different column (validates transition against the
  // project's active pipeline; bounce-counts backward moves; clears lock).
  ipcMain.handle(
    IPC.FACTORY_TASK_MOVE,
    (_event, projectId: string, taskId: string, toColumn: string): FactoryTask => {
      const task = factoryTaskStore.moveTask(projectId, taskId, toColumn);
      broadcastTaskChanged(factoryTaskStore, projectId);
      return task;
    },
  );

  // Remove a task permanently
  ipcMain.handle(
    IPC.FACTORY_TASK_REMOVE,
    (_event, projectId: string, taskId: string): void => {
      factoryTaskStore.removeTask(projectId, taskId);
      broadcastTaskChanged(factoryTaskStore, projectId);
    },
  );

  // Update task title or description
  ipcMain.handle(
    IPC.FACTORY_TASK_UPDATE,
    (
      _event,
      projectId: string,
      taskId: string,
      updates: Partial<Pick<FactoryTask, 'title' | 'description'>>,
    ): FactoryTask => {
      const task = factoryTaskStore.updateTask(projectId, taskId, updates);
      broadcastTaskChanged(factoryTaskStore, projectId);
      return task;
    },
  );

  // Sync tasks from project spec files
  ipcMain.handle(
    IPC.FACTORY_TASK_SYNC,
    (_event, projectId: string): FactoryTask[] => {
      const project = projectStore?.getProject(projectId);
      const specFiles = project?.spec_files ?? {};
      const localPath = project?.local_path;
      const newTasks = factoryTaskStore.syncFromSpecs(projectId, specFiles, localPath);
      if (newTasks.length > 0) {
        broadcastTaskChanged(factoryTaskStore, projectId);
      }
      return newTasks;
    },
  );
}
