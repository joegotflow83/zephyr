// IPC handlers for log export functionality.
// Registered once during app startup via registerLogHandlers().
// All handlers run in the main process and delegate to service instances.

import { ipcMain, dialog } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { LogExporter } from '../../services/log-exporter';
import type { LoopRunner } from '../../services/loop-runner';

export interface LogServices {
  logExporter: LogExporter;
  loopRunner: LoopRunner;
}

export function registerLogHandlers(services: LogServices): void {
  const { logExporter, loopRunner } = services;

  // ── Export single loop log ────────────────────────────────────────────────

  ipcMain.handle(
    IPC.LOGS_EXPORT,
    async (
      _event,
      projectId: string,
      format: 'text' | 'json' = 'text'
    ): Promise<{ success: boolean; path?: string; error?: string }> => {
      try {
        // Get loop state
        const loopState = loopRunner.getLoopState(projectId);
        if (!loopState) {
          return { success: false, error: 'Loop not found' };
        }

        // Show save dialog
        const ext = format === 'text' ? 'txt' : 'json';
        const defaultFileName = `${projectId.replace(/[^a-zA-Z0-9-_]/g, '_')}_${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;

        const result = await dialog.showSaveDialog({
          title: 'Export Loop Log',
          defaultPath: defaultFileName,
          filters: [
            {
              name: format === 'text' ? 'Text Files' : 'JSON Files',
              extensions: [ext],
            },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, error: 'Export cancelled' };
        }

        // Export the log
        await logExporter.exportLoopLog(loopState, result.filePath, {
          format,
          includeMetadata: true,
        });

        return { success: true, path: result.filePath };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  );

  // ── Export all loop logs ──────────────────────────────────────────────────

  ipcMain.handle(
    IPC.LOGS_EXPORT_ALL,
    async (
      _event,
      format: 'text' | 'json' = 'text'
    ): Promise<{ success: boolean; path?: string; error?: string }> => {
      try {
        // Get all loop states
        const loopStates = loopRunner.listAll();
        if (loopStates.length === 0) {
          return { success: false, error: 'No loops to export' };
        }

        // Show save dialog
        const defaultFileName = `zephyr-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

        const result = await dialog.showSaveDialog({
          title: 'Export All Loop Logs',
          defaultPath: defaultFileName,
          filters: [
            { name: 'Zip Files', extensions: ['zip'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, error: 'Export cancelled' };
        }

        // Export all logs
        await logExporter.exportAllLogs(loopStates, result.filePath, {
          format,
          includeMetadata: true,
        });

        return { success: true, path: result.filePath };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  );
}
