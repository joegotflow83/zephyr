// IPC handlers for loop execution services (LoopRunner, LoopScheduler).
// Registered once during app startup via registerLoopHandlers().
// All handlers run in the main process and delegate to service instances.

import * as fs from 'fs/promises';
import * as path from 'path';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { LoopRunner } from '../../services/loop-runner';
import type { LoopScheduler } from '../../services/scheduler';
import type { LoopState, LoopStartOpts } from '../../shared/loop-types';
import type { ScheduledLoop } from '../../services/scheduler';
import type { ProjectConfig } from '../../shared/models';
import type { PreValidationStore } from '../../services/pre-validation-store';
import type { HooksStore } from '../../services/hooks-store';
import type { DockerManager } from '../../services/docker-manager';
import type { AuthInjector } from '../../services/auth-injector';
import type { CredentialManager } from '../../services/credential-manager';
import { getLogger } from '../../services/logging';

export interface LoopServices {
  loopRunner: LoopRunner;
  scheduler: LoopScheduler;
  cleanupManager?: { registerContainer: (id: string) => void };
  projectStore?: { getProject: (id: string) => ProjectConfig | null };
  preValidationStore?: PreValidationStore;
  hooksStore?: HooksStore;
  dockerManager?: Pick<DockerManager, 'execCommand'>;
  authInjector?: AuthInjector;
  credentialManager?: CredentialManager;
}

export function registerLoopHandlers(services: LoopServices): void {
  const {
    loopRunner,
    scheduler,
    cleanupManager,
    projectStore,
    preValidationStore,
    hooksStore,
    dockerManager,
    authInjector,
    credentialManager,
  } = services;

  const logger = getLogger('loop');

  // ── Loop lifecycle ────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.LOOP_START,
    async (_event, rawOpts: LoopStartOpts): Promise<LoopState> => {
      let opts = rawOpts;
      const project = projectStore?.getProject(opts.projectId) ?? null;

      // Write selected pre-validation scripts to the project's local_path root
      // so they appear at /workspace/<script> in the container via volume mount.
      if (project && project.local_path && project.pre_validation_scripts.length > 0 && preValidationStore) {
        for (const filename of project.pre_validation_scripts) {
          try {
            const content = await preValidationStore.getScript(filename);
            if (content) {
              const dest = path.join(project.local_path, filename);
              await fs.writeFile(dest, content, { mode: 0o755 });
            }
          } catch (err) {
            logger.warn(`Failed to write pre-validation script ${filename} to local_path`, { err });
          }
        }
      }

      // Inject auth credentials into container opts before starting
      let authMethod = 'unknown';
      if (authInjector) {
        try {
          const authConfig = await authInjector.getContainerAuthConfig();
          authMethod = authConfig.authMethod;
          opts = {
            ...opts,
            envVars: { ...authConfig.envVars, ...opts.envVars },
            volumeMounts: [...(authConfig.volumeMounts ?? []), ...(opts.volumeMounts ?? [])],
          };
        } catch (err) {
          logger.warn('Failed to get auth config, starting loop without auth injection', { err });
        }
      }

      const state = await loopRunner.startLoop(opts);

      // Register container with cleanup manager for automatic cleanup on shutdown
      if (cleanupManager && state.containerId) {
        cleanupManager.registerContainer(state.containerId);
      }

      // For browser_session auth: exec-write captured claude.ai cookies to ~/.claude.json
      if (authMethod === 'browser_session' && state.containerId && credentialManager && dockerManager) {
        try {
          const sessionJson = await credentialManager.getApiKey('anthropic_session');
          if (sessionJson) {
            const encoded = Buffer.from(sessionJson).toString('base64');
            await dockerManager.execCommand(state.containerId, [
              'sh', '-c',
              `mkdir -p ~/.claude && printf '%s' '${encoded}' | base64 -d > ~/.claude.json`,
            ]);
            logger.info('Wrote browser session credentials to ~/.claude.json in container');
          } else {
            logger.warn('browser_session auth mode but no session data stored; container may lack credentials');
          }
        } catch (err) {
          logger.warn('Failed to write browser session credentials to container', { err });
        }
      }

      // Inject hook files into ~/.claude/hooks inside the container.
      // Uses base64 to safely transfer file contents via docker exec.
      if (project && project.hooks.length > 0 && state.containerId && hooksStore && dockerManager) {
        try {
          await dockerManager.execCommand(state.containerId, [
            'sh', '-c', 'mkdir -p ~/.claude/hooks',
          ]);

          for (const filename of project.hooks) {
            try {
              const content = await hooksStore.getHook(filename);
              if (content) {
                // Buffer.from().toString('base64') produces no newlines, safe for single-quoting
                const encoded = Buffer.from(content).toString('base64');
                const safe = path.basename(filename);
                await dockerManager.execCommand(state.containerId, [
                  'sh', '-c',
                  `printf '%s' '${encoded}' | base64 -d > ~/.claude/hooks/${safe} && chmod +x ~/.claude/hooks/${safe}`,
                ]);
              }
            } catch (err) {
              logger.warn(`Failed to inject hook ${filename} into container`, { err });
            }
          }
        } catch (err) {
          logger.warn('Failed to create ~/.claude/hooks in container', { err });
        }
      }

      return state;
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
