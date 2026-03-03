// IPC handlers for loop execution services (LoopRunner, LoopScheduler).
// Registered once during app startup via registerLoopHandlers().
// All handlers run in the main process and delegate to service instances.

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { LoopRunner } from '../../services/loop-runner';
import type { LoopScheduler } from '../../services/scheduler';
import type { LoopState, LoopStartOpts } from '../../shared/loop-types';
import { isLoopTerminal } from '../../shared/loop-types';
import type { ScheduledLoop } from '../../services/scheduler';
import type { ProjectConfig } from '../../shared/models';
import type { PreValidationStore } from '../../services/pre-validation-store';
import type { HooksStore } from '../../services/hooks-store';
import type { DockerManager } from '../../services/docker-manager';
import type { AuthInjector } from '../../services/auth-injector';
import type { CredentialManager } from '../../services/credential-manager';
import type { SSHKeyManager } from '../../services/ssh-key-manager';
import type { DeployKeyStore } from '../../services/deploy-key-store';
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
  sshKeyManager?: SSHKeyManager;
  deployKeyStore?: DeployKeyStore;
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
    sshKeyManager,
    deployKeyStore,
  } = services;

  const logger = getLogger('loop');

  // In-memory map tracking active deploy keys for cleanup on loop termination.
  // Maps projectId -> { keyId, repoUrl, pat, service } so we can delete keys from
  // GitHub or GitLab when the loop stops, fails, or completes.
  const activeDeployKeys = new Map<string, { keyId: number; repoUrl: string; pat: string; service: 'github' | 'gitlab' }>();

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

      // For VM loops: hook files and custom prompt files cannot be injected via
      // `docker exec` after the container starts (there is no containerId for
      // VM-backed containers). Instead, write everything to a per-project temp
      // directory and mount it at /root/.claude. Hooks go into hooks/ and
      // prompt files sit at the directory root so Claude Code can read them.
      if (opts.sandboxType === 'vm' && project) {
        const hasHooks = project.hooks.length > 0 && !!hooksStore;
        const hasPrompts = Object.keys(project.custom_prompts).length > 0;

        if (hasHooks || hasPrompts) {
          const claudeDir = path.join(os.tmpdir(), `zephyr-claude-${opts.projectId}`);
          try {
            await fs.mkdir(path.join(claudeDir, 'hooks'), { recursive: true });

            if (hasHooks && hooksStore) {
              for (const filename of project.hooks) {
                try {
                  const content = await hooksStore.getHook(filename);
                  if (content) {
                    const safe = path.basename(filename);
                    await fs.writeFile(path.join(claudeDir, 'hooks', safe), content, { mode: 0o755 });
                  }
                } catch (err) {
                  logger.warn(`Failed to write hook ${filename} for VM mount`, { err });
                }
              }
            }

            if (hasPrompts) {
              for (const [filename, content] of Object.entries(project.custom_prompts)) {
                try {
                  const safe = path.basename(filename);
                  await fs.writeFile(path.join(claudeDir, safe), content, 'utf8');
                } catch (err) {
                  logger.warn(`Failed to write custom prompt ${filename} for VM mount`, { err });
                }
              }
            }

            opts = {
              ...opts,
              volumeMounts: [...(opts.volumeMounts ?? []), `${claudeDir}:/root/.claude`],
            };
          } catch (err) {
            logger.warn('Failed to prepare .claude directory for VM loop', { err });
          }
        }
      }

      // For VM loops: pre-validation scripts must also reach the container.
      // They are normally written to project.local_path (which is volume-mounted
      // as /workspace), but that requires local_path to be set. When it is not,
      // write them to a temp directory and mount that directory at /workspace so
      // they are still accessible to the agent at /workspace/<script>.
      if (
        opts.sandboxType === 'vm' &&
        project &&
        project.pre_validation_scripts.length > 0 &&
        preValidationStore &&
        !project.local_path
      ) {
        const pvDir = path.join(os.tmpdir(), `zephyr-pv-${opts.projectId}`);
        try {
          await fs.mkdir(pvDir, { recursive: true });
          for (const filename of project.pre_validation_scripts) {
            try {
              const content = await preValidationStore.getScript(filename);
              if (content) {
                await fs.writeFile(path.join(pvDir, path.basename(filename)), content, { mode: 0o755 });
              }
            } catch (err) {
              logger.warn(`Failed to write pre-validation script ${filename} for VM mount`, { err });
            }
          }
          opts = {
            ...opts,
            volumeMounts: [...(opts.volumeMounts ?? []), `${pvDir}:/workspace`],
            workDir: opts.workDir ?? '/workspace',
          };
        } catch (err) {
          logger.warn('Failed to prepare pre-validation scripts directory for VM loop', { err });
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

      // Inject custom prompt files into ~/.claude/ inside the container.
      // Uses base64 to safely transfer file contents via docker exec.
      // VM-backed loops handle this via volume mount above; this covers containers only.
      if (project && Object.keys(project.custom_prompts).length > 0 && state.containerId && dockerManager) {
        try {
          await dockerManager.execCommand(state.containerId, [
            'sh', '-c', 'mkdir -p ~/.claude',
          ]);

          for (const [filename, content] of Object.entries(project.custom_prompts)) {
            try {
              const encoded = Buffer.from(content).toString('base64');
              const safe = path.basename(filename);
              await dockerManager.execCommand(state.containerId, [
                'sh', '-c',
                `printf '%s' '${encoded}' | base64 -d > ~/.claude/${safe}`,
              ]);
            } catch (err) {
              logger.warn(`Failed to inject custom prompt ${filename} into container`, { err });
            }
          }
        } catch (err) {
          logger.warn('Failed to create ~/.claude in container for custom prompts', { err });
        }
      }

      // Inject ephemeral SSH deploy key for GitHub repos.
      // Only runs when: project has a GitHub repo_url, a PAT is stored, and
      // the container has started (containerId is set). Failures are non-fatal
      // — the loop continues without SSH access rather than aborting.
      if (
        project &&
        project.repo_url &&
        sshKeyManager?.isGithubUrl(project.repo_url) &&
        credentialManager &&
        state.containerId
      ) {
        try {
          const pat = await credentialManager.getGithubPat(opts.projectId);
          if (pat) {
            const { privateKey, publicKey } = sshKeyManager.generateKeyPair();
            const keyTitle = `zephyr-${opts.projectId.slice(0, 8)}-${Date.now()}`;
            const keyId = await sshKeyManager.addDeployKey(pat, project.repo_url, publicKey, keyTitle);

            // Record in store before injection so a mid-injection crash leaves a traceable entry
            if (deployKeyStore) {
              const { owner, repo } = sshKeyManager.parseGithubRepo(project.repo_url);
              deployKeyStore.record({
                key_id: keyId,
                repo: `${owner}/${repo}`,
                project_id: opts.projectId,
                project_name: opts.projectName,
                loop_id: state.containerId,
                created_at: new Date().toISOString(),
                service: 'github',
              });
            }

            await sshKeyManager.injectIntoContainer(state.containerId, privateKey);
            activeDeployKeys.set(opts.projectId, { keyId, repoUrl: project.repo_url, pat, service: 'github' });
            logger.info('SSH deploy key injected into container', { projectId: opts.projectId, keyId });
          }
        } catch (err) {
          logger.warn('Failed to set up SSH deploy key; loop continues without GitHub SSH access', { err });
        }
      }

      // Inject ephemeral SSH deploy key for GitLab repos.
      // Only runs when: project has a GitLab repo_url, a PAT is stored, and
      // the container has started (containerId is set). Failures are non-fatal.
      if (
        project &&
        project.repo_url &&
        sshKeyManager?.isGitlabUrl(project.repo_url) &&
        credentialManager &&
        state.containerId
      ) {
        try {
          const pat = await credentialManager.getGitlabPat(opts.projectId);
          if (pat) {
            const { privateKey, publicKey } = sshKeyManager.generateKeyPair();
            const keyTitle = `zephyr-${opts.projectId.slice(0, 8)}-${Date.now()}`;
            const keyId = await sshKeyManager.addGitlabDeployKey(pat, project.repo_url, publicKey, keyTitle);

            // Record in store before injection so a mid-injection crash leaves a traceable entry
            if (deployKeyStore) {
              const { owner, repo } = sshKeyManager.parseGitlabRepo(project.repo_url);
              deployKeyStore.record({
                key_id: keyId,
                repo: `${owner}/${repo}`,
                project_id: opts.projectId,
                project_name: opts.projectName,
                loop_id: state.containerId,
                created_at: new Date().toISOString(),
                service: 'gitlab',
              });
            }

            await sshKeyManager.injectIntoContainerForGitlab(state.containerId, privateKey);
            activeDeployKeys.set(opts.projectId, { keyId, repoUrl: project.repo_url, pat, service: 'gitlab' });
            logger.info('GitLab SSH deploy key injected into container', { projectId: opts.projectId, keyId });
          }
        } catch (err) {
          logger.warn('Failed to set up SSH deploy key; loop continues without GitLab SSH access', { err });
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

  // Clean up GitHub deploy keys when a loop reaches a terminal state.
  // Uses a separate onStateChange callback so cleanup is decoupled from broadcasting.
  loopRunner.onStateChange(async (state: LoopState) => {
    if (!isLoopTerminal(state.status)) {
      return;
    }

    const keyInfo = activeDeployKeys.get(state.projectId);
    if (!keyInfo || !sshKeyManager) {
      return;
    }

    // Remove from local map first so a re-entrant terminal state change is a no-op
    activeDeployKeys.delete(state.projectId);

    try {
      if (keyInfo.service === 'gitlab') {
        await sshKeyManager.removeGitlabDeployKey(keyInfo.pat, keyInfo.repoUrl, keyInfo.keyId);
        logger.info('SSH deploy key removed from GitLab', { projectId: state.projectId, keyId: keyInfo.keyId });
      } else {
        await sshKeyManager.removeDeployKey(keyInfo.pat, keyInfo.repoUrl, keyInfo.keyId);
        logger.info('SSH deploy key removed from GitHub', { projectId: state.projectId, keyId: keyInfo.keyId });
      }
      deployKeyStore?.markCleaned(keyInfo.keyId);
    } catch (err) {
      logger.warn('Failed to remove deploy key (key may need manual cleanup)', {
        err,
        projectId: state.projectId,
        keyId: keyInfo.keyId,
        service: keyInfo.service,
      });
    }
  });

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
