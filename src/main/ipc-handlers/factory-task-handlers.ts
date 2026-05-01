// IPC handlers for the Coding Factory kanban task board.
// Registered once during app startup via registerFactoryTaskHandlers().
// All handlers run in the main process and delegate to FactoryTaskStore.

import * as fs from 'fs/promises';
import * as path from 'path';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { FactoryTaskStore } from '../../services/factory-task-store';
import type { FactoryTask } from '../../shared/factory-types';
import type { ProjectConfig } from '../../shared/models';

/** Columns that are not pipeline stages — dispatch is skipped for these. */
const IMPLICIT_COLUMNS = new Set(['backlog', 'done', 'blocked']);

export interface FactoryTaskServices {
  factoryTaskStore: FactoryTaskStore;
  projectStore?: { getProject: (id: string) => ProjectConfig | null };
  /**
   * Called when a task enters a pipeline stage column (not backlog/done/blocked).
   * Implementors should restart the idle container for that stage so the agent
   * picks up the newly available task from @task-queue.json.
   */
  onTaskEnteredStage?: (projectId: string, stageId: string) => void;
}

/**
 * Write the current task queue to /workspace/@task-queue.json so agents
 * running inside containers can discover which tasks are in their column.
 * Silently no-ops when the project has no local_path or the write fails.
 */
async function syncQueueToWorkspace(
  factoryTaskStore: FactoryTaskStore,
  projectStore: { getProject: (id: string) => ProjectConfig | null } | undefined,
  projectId: string,
): Promise<void> {
  const project = projectStore?.getProject(projectId);
  if (!project?.local_path) return;
  try {
    const tasks = factoryTaskStore.getQueue(projectId).tasks;
    await fs.writeFile(
      path.join(project.local_path, '@task-queue.json'),
      JSON.stringify(tasks, null, 2),
      'utf-8',
    );
  } catch {
    // non-fatal — workspace may not be mounted or accessible yet
  }
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
  const { factoryTaskStore, projectStore, onTaskEnteredStage } = services;

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
    async (
      _event,
      projectId: string,
      title: string,
      description: string,
    ): Promise<FactoryTask> => {
      const task = factoryTaskStore.addTask(projectId, { title, description });
      broadcastTaskChanged(factoryTaskStore, projectId);
      await syncQueueToWorkspace(factoryTaskStore, projectStore, projectId);
      return task;
    },
  );

  // Move a task to a different column (validates transition against the
  // project's active pipeline; bounce-counts backward moves; clears lock).
  // After moving, syncs @task-queue.json to /workspace and (for stage columns)
  // notifies the loop layer so the idle container can be restarted.
  ipcMain.handle(
    IPC.FACTORY_TASK_MOVE,
    async (_event, projectId: string, taskId: string, toColumn: string): Promise<FactoryTask> => {
      const fromColumn = factoryTaskStore.getTask(projectId, taskId)?.column;
      let task = factoryTaskStore.moveTask(projectId, taskId, toColumn);
      broadcastTaskChanged(factoryTaskStore, projectId);
      await syncQueueToWorkspace(factoryTaskStore, projectStore, projectId);

      const workspacePath = projectStore?.getProject(projectId)?.local_path;

      if (!IMPLICIT_COLUMNS.has(toColumn)) {
        // Pre-lock with the stage name so the kanban badge shows immediately
        // while the agent container spins up. The agent can take over the lock
        // by writing @task-status.json with status "locked" and its instance id.
        try {
          task = factoryTaskStore.lockTask(projectId, task.id, toColumn);
          broadcastTaskChanged(factoryTaskStore, projectId);
          await syncQueueToWorkspace(factoryTaskStore, projectStore, projectId);
          // Write the current-task file so the agent's bash guard activates
          // for this stage. The agent reads this file to know exactly which
          // single task to work on, then exits — giving each task a fresh
          // context window.
          if (workspacePath) {
            await fs.writeFile(
              path.join(workspacePath, `@current-task-${toColumn}.json`),
              JSON.stringify(task, null, 2),
              'utf-8',
            ).catch(() => undefined);
          }
        } catch {
          // non-fatal — task may already be locked by an agent
        }
        // Clear the source stage's current-task file when moving out of a stage
        if (fromColumn && !IMPLICIT_COLUMNS.has(fromColumn) && workspacePath) {
          await fs.unlink(
            path.join(workspacePath, `@current-task-${fromColumn}.json`),
          ).catch(() => undefined);
        }
        onTaskEnteredStage?.(projectId, toColumn);
      }
      return task;
    },
  );

  // Remove a task permanently
  ipcMain.handle(
    IPC.FACTORY_TASK_REMOVE,
    async (_event, projectId: string, taskId: string): Promise<void> => {
      factoryTaskStore.removeTask(projectId, taskId);
      broadcastTaskChanged(factoryTaskStore, projectId);
      await syncQueueToWorkspace(factoryTaskStore, projectStore, projectId);
    },
  );

  // Update task title or description
  ipcMain.handle(
    IPC.FACTORY_TASK_UPDATE,
    async (
      _event,
      projectId: string,
      taskId: string,
      updates: Partial<Pick<FactoryTask, 'title' | 'description'>>,
    ): Promise<FactoryTask> => {
      const task = factoryTaskStore.updateTask(projectId, taskId, updates);
      broadcastTaskChanged(factoryTaskStore, projectId);
      await syncQueueToWorkspace(factoryTaskStore, projectStore, projectId);
      return task;
    },
  );

  // Force-unlock a task (manual override from UI)
  ipcMain.handle(
    IPC.FACTORY_TASK_UNLOCK,
    async (_event, projectId: string, taskId: string): Promise<FactoryTask> => {
      const task = factoryTaskStore.unlockTask(projectId, taskId);
      broadcastTaskChanged(factoryTaskStore, projectId);
      await syncQueueToWorkspace(factoryTaskStore, projectStore, projectId);
      return task;
    },
  );

  // Sync tasks from project spec files
  ipcMain.handle(
    IPC.FACTORY_TASK_SYNC,
    async (_event, projectId: string): Promise<FactoryTask[]> => {
      const project = projectStore?.getProject(projectId);
      const specFiles = project?.spec_files ?? {};
      const localPath = project?.local_path;
      const newTasks = factoryTaskStore.syncFromSpecs(projectId, specFiles, localPath);
      if (newTasks.length > 0) {
        broadcastTaskChanged(factoryTaskStore, projectId);
        await syncQueueToWorkspace(factoryTaskStore, projectStore, projectId);
      }
      return newTasks;
    },
  );
}
