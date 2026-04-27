// IPC handlers for the Pipeline library (data-driven factory stages).
// Registered once during app startup via registerPipelineHandlers().
// All handlers run in the main process and delegate to PipelineStore.

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { PipelineStore } from '../../services/pipeline-store';
import type { ProjectStore } from '../../services/project-store';
import type { Pipeline } from '../../shared/pipeline-types';

export interface PipelineServices {
  pipelineStore: PipelineStore;
  projectStore: ProjectStore;
}

/**
 * Input shape for PIPELINE_ADD.
 *
 * Mirrors {@link PipelineStore.addPipeline}: `createdAt`/`updatedAt` are
 * server-stamped, `id` is optional (generated when omitted), and `builtIn`
 * on input is ignored — the persisted pipeline is always `builtIn: false`.
 */
type PipelineAddInput = Omit<Pipeline, 'createdAt' | 'updatedAt'> &
  Partial<Pick<Pipeline, 'createdAt' | 'updatedAt'>>;

/**
 * Broadcast the full pipeline list to every renderer window.
 *
 * Called after every mutation (add/update/remove) so all open windows stay
 * in sync without polling. The payload carries the reconciled list rather
 * than a bare event so the renderer can update its cache directly and skip
 * the follow-up IPC round-trip.
 */
function broadcastPipelineChanged(pipelineStore: PipelineStore): void {
  const pipelines = pipelineStore.listPipelines();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.PIPELINE_CHANGED, pipelines);
    }
  }
}

export function registerPipelineHandlers(services: PipelineServices): void {
  const { pipelineStore, projectStore } = services;

  // List all pipelines (built-in + user), built-ins first.
  ipcMain.handle(IPC.PIPELINE_LIST, (): Pipeline[] => {
    return pipelineStore.listPipelines();
  });

  // Get a single pipeline by id, or null if not found.
  ipcMain.handle(IPC.PIPELINE_GET, (_event, id: string): Pipeline | null => {
    return pipelineStore.getPipeline(id);
  });

  // Add a new user pipeline. Store throws on id collision.
  ipcMain.handle(
    IPC.PIPELINE_ADD,
    (_event, input: PipelineAddInput): Pipeline => {
      const pipeline = pipelineStore.addPipeline(input);
      broadcastPipelineChanged(pipelineStore);
      return pipeline;
    },
  );

  // Patch a user pipeline. Store throws when id is unknown or built-in.
  ipcMain.handle(
    IPC.PIPELINE_UPDATE,
    (_event, id: string, patch: Partial<Pipeline>): Pipeline => {
      const pipeline = pipelineStore.updatePipeline(id, patch);
      broadcastPipelineChanged(pipelineStore);
      return pipeline;
    },
  );

  // Delete a user pipeline. Store throws when id is unknown or built-in.
  // Also clears the dangling pipelineId from any projects that referenced it so
  // projects.json stays consistent and the renderer disables the Factory button
  // for those projects (checked via the live pipelines list on PIPELINE_CHANGED).
  ipcMain.handle(IPC.PIPELINE_REMOVE, (_event, id: string): void => {
    pipelineStore.removePipeline(id);
    projectStore.clearDanglingPipelineId(id);
    broadcastPipelineChanged(pipelineStore);
  });
}
