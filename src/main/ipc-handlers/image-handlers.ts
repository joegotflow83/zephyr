// IPC handlers for the image library (build, rebuild, list, get, delete).
// Registered once during app startup via registerImageHandlers().
// Progress events from docker builds are streamed back to the renderer via
// webContents.send so the UI can display live build output.

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { ImageStore } from '../../services/image-store';
import type { ImageBuilder } from '../../services/image-builder';
import type { ImageBuildConfig } from '../../shared/models';

export interface ImageServices {
  imageStore: ImageStore;
  imageBuilder: ImageBuilder;
}

export function registerImageHandlers(services: ImageServices): void {
  const { imageStore, imageBuilder } = services;

  // ── List all images ────────────────────────────────────────────────────────

  ipcMain.handle(IPC.IMAGE_LIST, async () => {
    return imageStore.listImages();
  });

  // ── Get a single image by ID ───────────────────────────────────────────────

  ipcMain.handle(IPC.IMAGE_GET, async (_event, id: string) => {
    return imageStore.getImage(id);
  });

  // ── Build a new image (streams progress back to renderer) ──────────────────

  ipcMain.handle(IPC.IMAGE_BUILD, async (event, config: ImageBuildConfig) => {
    return imageBuilder.buildImage(config, (progressEvent) => {
      const line = progressEvent.stream ?? progressEvent.status ?? '';
      if (line) {
        event.sender.send(IPC.IMAGE_BUILD_PROGRESS, line);
      }
    });
  });

  // ── Rebuild an existing image (streams progress back to renderer) ──────────

  ipcMain.handle(IPC.IMAGE_REBUILD, async (event, id: string) => {
    return imageBuilder.rebuildImage(id, (progressEvent) => {
      const line = progressEvent.stream ?? progressEvent.status ?? '';
      if (line) {
        event.sender.send(IPC.IMAGE_BUILD_PROGRESS, line);
      }
    });
  });

  // ── Delete an image by ID ─────────────────────────────────────────────────

  ipcMain.handle(IPC.IMAGE_DELETE, async (_event, id: string) => {
    return imageStore.removeImage(id);
  });
}
