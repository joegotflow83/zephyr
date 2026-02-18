// IPC handlers for loop execution services (LoopRunner, LoopScheduler).
// Registered once during app startup via registerLoopHandlers().
// All handlers run in the main process and delegate to service instances.

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { LoopRunner } from '../../services/loop-runner';
import type { LoopScheduler } from '../../services/scheduler';
import type { LoopState, LoopStartOpts } from '../../shared/loop-types';
import type { ScheduledLoop } from '../../services/scheduler';

export interface LoopServices {
  loopRunner: LoopRunner;
  scheduler: LoopScheduler;
}

export function registerLoopHandlers(services: LoopServices): void {
  const { loopRunner, scheduler } = services;

  // ── Loop lifecycle ────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.LOOP_START,
    async (_event, opts: LoopStartOpts): Promise<LoopState> => {
      return loopRunner.startLoop(opts);
    },
  );

  ipcMain.handle(
    IPC.LOOP_STOP,
    async (_event, projectId: string): Promise<void> => {
      return loopRunner.stopLoop(projectId);
    },
  );

  ipcMain.handle(IPC.LOOP_LIST, async (): Promise<LoopState[]> => {
    return loopRunner.listAll();
  });

  ipcMain.handle(
    IPC.LOOP_GET,
    async (_event, projectId: string): Promise<LoopState | null> => {
      return loopRunner.getLoopState(projectId);
    },
  );

  ipcMain.handle(
    IPC.LOOP_REMOVE,
    async (_event, projectId: string): Promise<void> => {
      return loopRunner.removeLoop(projectId);
    },
  );

  // ── Scheduling ────────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.LOOP_SCHEDULE,
    async (
      _event,
      projectId: string,
      schedule: string,
      loopOpts: Omit<LoopStartOpts, 'mode'>,
    ): Promise<void> => {
      scheduler.scheduleLoop(projectId, schedule, loopOpts);
    },
  );

  ipcMain.handle(
    IPC.LOOP_CANCEL_SCHEDULE,
    async (_event, projectId: string): Promise<void> => {
      scheduler.cancelSchedule(projectId);
    },
  );

  ipcMain.handle(IPC.LOOP_LIST_SCHEDULED, async (): Promise<ScheduledLoop[]> => {
    return scheduler.listScheduled();
  });

  // ── Event broadcasting ────────────────────────────────────────────────────

  // Register callbacks to broadcast state changes and log lines to all renderer windows

  loopRunner.onStateChange((state: LoopState) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send(IPC.LOOP_STATE_CHANGED, state);
    });
  });

  loopRunner.onLogLine((projectId, line) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send(IPC.LOOP_LOG_LINE, projectId, line);
    });
  });
}
