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
import { isLoopTerminal, LoopMode, getLoopKey } from '../../shared/loop-types';
import type { ScheduledLoop } from '../../services/scheduler';
import type { ProjectConfig } from '../../shared/models';
import type { PreValidationStore } from '../../services/pre-validation-store';
import type { HooksStore } from '../../services/hooks-store';
import type { ClaudeSettingsStore } from '../../services/claude-settings-store';
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
  claudeSettingsStore?: ClaudeSettingsStore;
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
    claudeSettingsStore,
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
  // Maps loopKey -> deploy key info for cleanup on loop termination.
  const activeDeployKeys = new Map<string, { keyId: number; repoUrl: string; pat: string; service: 'github' | 'gitlab' }>();

  // ── Loop lifecycle ────────────────────────────────────────────────────────

  /**
   * Core loop start logic. Handles pre-validation scripts, auth injection,
   * hooks/prompts mounting, deploy keys, etc. Called by both LOOP_START and
   * FACTORY_START handlers.
   */
  async function startLoopCore(rawOpts: LoopStartOpts): Promise<LoopState> {
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

      // For VM loops and single-mode container loops: hook files and settings
      // cannot be injected via `docker exec` after the container starts because:
      //   - VM loops have no containerId to exec into
      //   - Single-mode container loops start the agent as their CMD, so exec
      //     injection would race against (or miss) the agent startup
      // Hooks and settings go into a temp dir mounted at /root/.claude.
      // Prompt files for single-mode container runs go to /workspace (see below).
      const isVm = opts.sandboxType === 'vm';
      const isSingleContainer = opts.mode === LoopMode.SINGLE && !isVm;
      if ((isVm || isSingleContainer) && project) {
        const hasHooks = project.hooks.length > 0 && !!hooksStore;
        const hasPrompts = Object.keys(project.custom_prompts).length > 0;
        const hasClaudeSettings = !!project.claude_settings_file && !!claudeSettingsStore;

        if (hasHooks || hasClaudeSettings) {
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
                  logger.warn(`Failed to write hook ${filename} for .claude mount`, { err });
                }
              }
            }

            if (hasClaudeSettings && project.claude_settings_file && claudeSettingsStore) {
              try {
                const content = await claudeSettingsStore.getFile(project.claude_settings_file);
                if (content) {
                  await fs.writeFile(path.join(claudeDir, 'settings.json'), content, 'utf8');
                }
              } catch (err) {
                logger.warn(`Failed to write claude settings.json for .claude mount`, { err });
              }
            }

            opts = {
              ...opts,
              volumeMounts: [...(opts.volumeMounts ?? []), `${claudeDir}:/root/.claude`],
            };
          } catch (err) {
            logger.warn('Failed to prepare .claude directory for loop', { err });
          }
        }

        // For single-mode container runs: write prompt files to /workspace so the
        // claude CMD can read them at /workspace/<filename>. Writing to /root/.claude
        // causes permission denied because the container process may not run as root.
        // Prefer project.local_path (already volume-mounted as /workspace); fall back
        // to a temp dir mounted as /workspace when local_path is absent.
        if (isSingleContainer && hasPrompts) {
          if (project.local_path) {
            for (const [filename, content] of Object.entries(project.custom_prompts)) {
              try {
                const safe = path.basename(filename);
                await fs.writeFile(path.join(project.local_path, safe), content, 'utf8');
              } catch (err) {
                logger.warn(`Failed to write prompt ${filename} to local_path for single-mode run`, { err });
              }
            }
          } else {
            const promptsDir = path.join(os.tmpdir(), `zephyr-prompts-${opts.projectId}`);
            try {
              await fs.mkdir(promptsDir, { recursive: true });
              for (const [filename, content] of Object.entries(project.custom_prompts)) {
                const safe = path.basename(filename);
                await fs.writeFile(path.join(promptsDir, safe), content, 'utf8');
              }
              opts = {
                ...opts,
                volumeMounts: [...(opts.volumeMounts ?? []), `${promptsDir}:/workspace`],
                workDir: opts.workDir ?? '/workspace',
              };
            } catch (err) {
              logger.warn('Failed to prepare prompt files directory for single-mode run', { err });
            }
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

      // Install workspace dependencies into the container so libraries are available
      // system-wide before the agent starts. Runs as root so pip can write to
      // system site-packages. Failures are non-fatal — the loop continues without them.
      if (state.containerId && dockerManager) {
        // Python: install any requirements.txt / requirements-*.txt in /workspace
        try {
          await dockerManager.execCommand(
            state.containerId,
            ['sh', '-c', 'find /workspace -maxdepth 1 -name "requirements*.txt" | while read f; do pip3 install --break-system-packages -q -r "$f"; done'],
            { user: 'root' },
          );
        } catch (err) {
          logger.warn('Failed to install Python workspace dependencies', { err });
        }

        // Node.js: run npm install if package.json exists in /workspace
        try {
          await dockerManager.execCommand(
            state.containerId,
            ['sh', '-c', '[ -f /workspace/package.json ] && cd /workspace && npm install 2>&1 || true'],
            { user: 'root' },
          );
        } catch (err) {
          logger.warn('Failed to install Node.js workspace dependencies', { err });
        }

        // Rust: fetch Cargo dependencies if Cargo.toml exists in /workspace
        try {
          await dockerManager.execCommand(
            state.containerId,
            ['sh', '-c', '[ -f /workspace/Cargo.toml ] && cd /workspace && cargo fetch 2>&1 || true'],
            { user: 'ralph' },
          );
        } catch (err) {
          logger.warn('Failed to fetch Rust workspace dependencies', { err });
        }

        // Go: download module dependencies if go.mod exists in /workspace
        try {
          await dockerManager.execCommand(
            state.containerId,
            ['sh', '-c', '[ -f /workspace/go.mod ] && cd /workspace && go mod download 2>&1 || true'],
            { user: 'ralph' },
          );
        } catch (err) {
          logger.warn('Failed to download Go workspace dependencies', { err });
        }
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
      // Skipped for single-mode container runs: those already have hooks pre-mounted
      // as a volume (handled above), and the agent CMD starts before exec can run.
      if (project && project.hooks.length > 0 && state.containerId && hooksStore && dockerManager && opts.mode !== LoopMode.SINGLE) {
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
      // VM-backed loops and single-mode container loops handle this via volume mount
      // above; this exec path covers continuous container runs only.
      if (project && Object.keys(project.custom_prompts).length > 0 && state.containerId && dockerManager && opts.mode !== LoopMode.SINGLE) {
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

      // Inject claude settings.json into ~/.claude/settings.json inside the container.
      // Uses base64 to safely transfer file contents via docker exec.
      // Skipped for single-mode container and VM runs: those already have the file
      // pre-mounted as a volume (handled above).
      if (project && project.claude_settings_file && state.containerId && claudeSettingsStore && dockerManager && opts.mode !== LoopMode.SINGLE) {
        try {
          const content = await claudeSettingsStore.getFile(project.claude_settings_file);
          if (content) {
            const encoded = Buffer.from(content).toString('base64');
            await dockerManager.execCommand(state.containerId, [
              'sh', '-c',
              `mkdir -p ~/.claude && printf '%s' '${encoded}' | base64 -d > ~/.claude/settings.json`,
            ]);
          }
        } catch (err) {
          logger.warn('Failed to inject claude settings.json into container', { err });
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
            activeDeployKeys.set(getLoopKey(opts.projectId, opts.role), { keyId, repoUrl: project.repo_url, pat, service: 'github' });
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
            activeDeployKeys.set(getLoopKey(opts.projectId, opts.role), { keyId, repoUrl: project.repo_url, pat, service: 'gitlab' });
            logger.info('GitLab SSH deploy key injected into container', { projectId: opts.projectId, keyId });
          }
        } catch (err) {
          logger.warn('Failed to set up SSH deploy key; loop continues without GitLab SSH access', { err });
        }
      }

      return state;
  }

  ipcMain.handle(
    IPC.LOOP_START,
    async (_event, rawOpts: LoopStartOpts): Promise<LoopState> => {
      return startLoopCore(rawOpts);
    },
  );

  ipcMain.handle(
    IPC.LOOP_STOP,
    async (_event, projectId: string, role?: string): Promise<void> => {
      return loopRunner.stopLoop(projectId, role);
    },
  );

  ipcMain.handle(IPC.LOOP_LIST, async (): Promise<LoopState[]> => {
    return loopRunner.listAll();
  });

  ipcMain.handle(
    IPC.LOOP_GET,
    async (_event, projectId: string, role?: string): Promise<LoopState | null> => {
      return loopRunner.getLoopState(projectId, role);
    },
  );

  ipcMain.handle(
    IPC.LOOP_REMOVE,
    async (_event, projectId: string, role?: string): Promise<void> => {
      return loopRunner.removeLoop(projectId, role);
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

  // ── Factory (multi-container coding factory) ────────────────────────────

  /**
   * Scaffold the team coordination file/folder structure inside a workspace.
   * Creates files only if they don't already exist so user edits are preserved.
   * @param featureRequestsContent - Optional custom content for @feature_requests.md.
   *   Defaults to the built-in template when omitted or empty.
   */
  async function scaffoldTeamFiles(workspacePath: string, featureRequestsContent?: string): Promise<void> {
    // Create directory tree
    await fs.mkdir(path.join(workspacePath, 'team', 'handovers'), { recursive: true });
    await fs.mkdir(path.join(workspacePath, 'team', 'tasks', 'pending'), { recursive: true });

    const defaultFeatureRequests = '# Feature Requests\n\nAdd feature requests here. Each entry should include:\n- Description of the feature\n- Priority (high/medium/low)\n- Acceptance criteria\n';

    // Files to create with default content (only if missing)
    const files: Record<string, string> = {
      '@feature_requests.md': featureRequestsContent?.trim() ? featureRequestsContent : defaultFeatureRequests,
      '@team_plan.md': '# Team Plan\n\nOverall plan and current sprint objectives.\n',
      '@human_clarification.md': '# Human Clarification\n\nUse this file to provide clarifications, answers, or guidance requested by the AI agents.\n',
      'team/handovers/coder_to_security.md': '# Coder to Security Handover\n\nDocument code changes that need security review.\n',
      'team/handovers/security_to_qa.md': '# Security to QA Handover\n\nDocument security findings and items cleared for QA testing.\n',
      'team/handovers/qa_feedback.md': '# QA Feedback\n\nDocument test results, bugs found, and items that need rework.\n',
      'team/handovers/status.log': '',
    };

    for (const [filePath, defaultContent] of Object.entries(files)) {
      const fullPath = path.join(workspacePath, filePath);
      try {
        await fs.access(fullPath);
        // File exists — don't overwrite
      } catch {
        await fs.writeFile(fullPath, defaultContent, 'utf8');
      }
    }
  }

  ipcMain.handle(
    IPC.FACTORY_START,
    async (_event, projectId: string, baseOpts: LoopStartOpts): Promise<LoopState[]> => {
      const project = projectStore?.getProject(projectId) ?? null;
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      const factoryConfig = project.factory_config;
      if (!factoryConfig?.enabled || !factoryConfig.roles.length) {
        throw new Error('Factory mode is not enabled or has no roles configured for this project');
      }

      // Scaffold team coordination files in the workspace
      if (project.local_path) {
        try {
          await scaffoldTeamFiles(project.local_path, project.feature_requests_content);
          logger.info('Team coordination files scaffolded', { projectId, path: project.local_path });
        } catch (err) {
          logger.warn('Failed to scaffold team files', { err, projectId });
        }
      }

      // Start one loop per configured role.
      // Each role gets its own prompt if one exists with the naming convention PROMPT_<role>.md
      const results: LoopState[] = [];
      for (const role of factoryConfig.roles) {
        const roleOpts: LoopStartOpts = {
          ...baseOpts,
          projectId,
          projectName: project.name,
          role,
        };

        try {
          // Delegate to the shared startLoopCore function which handles all injection
          // (auth, hooks, prompts, deploy keys) for each individual container
          const state = await startLoopCore(roleOpts);
          results.push(state);
        } catch (err) {
          logger.warn(`Failed to start factory role ${role} for project ${projectId}`, { err });
          // Continue starting other roles — partial factory is better than none
        }
      }

      return results;
    },
  );

  ipcMain.handle(
    IPC.FACTORY_STOP,
    async (_event, projectId: string): Promise<void> => {
      // Find all running loops for this project and stop them
      const projectLoops = loopRunner.listByProject(projectId);
      const activeLoops = projectLoops.filter((l) => !isLoopTerminal(l.status));

      const errors: Error[] = [];
      for (const loop of activeLoops) {
        try {
          await loopRunner.stopLoop(loop.projectId, loop.role);
        } catch (err) {
          errors.push(err instanceof Error ? err : new Error(String(err)));
        }
      }

      if (errors.length > 0) {
        throw new Error(`Failed to stop ${errors.length} factory loop(s): ${errors.map((e) => e.message).join('; ')}`);
      }
    },
  );

  // ── Event broadcasting ────────────────────────────────────────────────────

  // Clean up GitHub deploy keys when a loop reaches a terminal state.
  // Uses a separate onStateChange callback so cleanup is decoupled from broadcasting.
  loopRunner.onStateChange(async (state: LoopState) => {
    if (!isLoopTerminal(state.status)) {
      return;
    }

    const loopKey = getLoopKey(state);
    const keyInfo = activeDeployKeys.get(loopKey);
    if (!keyInfo || !sshKeyManager) {
      return;
    }

    // Remove from local map first so a re-entrant terminal state change is a no-op
    activeDeployKeys.delete(loopKey);

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

  // Throttle log line IPC broadcasts: buffer lines and flush every 250ms
  // to avoid overwhelming the renderer with individual IPC messages.
  let logLineBuffer: { projectId: string; line: unknown }[] = [];
  let logLineFlushTimer: NodeJS.Timeout | null = null;

  loopRunner.onLogLine((projectId, line) => {
    logLineBuffer.push({ projectId, line });

    if (!logLineFlushTimer) {
      logLineFlushTimer = setTimeout(() => {
        const windows = BrowserWindow.getAllWindows();
        const batch = logLineBuffer;
        logLineBuffer = [];
        logLineFlushTimer = null;

        for (const entry of batch) {
          windows.forEach((win) => {
            win.webContents.send(IPC.LOOP_LOG_LINE, entry.projectId, entry.line);
          });
        }
      }, 250);
    }
  });
}
