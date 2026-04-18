// IPC handlers for loop execution services (LoopRunner, LoopScheduler).
// Registered once during app startup via registerLoopHandlers().
// All handlers run in the main process and delegate to service instances.

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ipcMain, BrowserWindow, Notification } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { LoopRunner } from '../../services/loop-runner';
import type { LoopScheduler } from '../../services/scheduler';
import type { LoopState, LoopStartOpts } from '../../shared/loop-types';
import { isLoopTerminal, LoopMode, LoopStatus, getLoopKey } from '../../shared/loop-types';
import type { ScheduledLoop } from '../../services/scheduler';
import type { AppSettings, ProjectConfig } from '../../shared/models';
import type { ConfigManager } from '../../services/config-manager';
import type { PreValidationStore } from '../../services/pre-validation-store';
import type { HooksStore } from '../../services/hooks-store';
import type { KiroHooksStore } from '../../services/kiro-hooks-store';
import type { ClaudeSettingsStore } from '../../services/claude-settings-store';
import type { ContainerRuntime } from '../../services/container-runtime';
import type { AuthInjector } from '../../services/auth-injector';
import type { CredentialManager } from '../../services/credential-manager';
import type { SSHKeyManager } from '../../services/ssh-key-manager';
import type { DeployKeyStore } from '../../services/deploy-key-store';
import type { LoopScriptsStore } from '../../services/loop-scripts-store';
import { getLogger } from '../../services/logging';

/**
 * Bash hook script injected into containers for factory mode loops.
 * Runs as a PostToolUse hook: when the agent writes @human_clarification.md,
 * it writes a timestamp to @human_clarification.requested so the host-side
 * file watcher can trigger an OS notification without false-positives from
 * user edits to the clarification file itself.
 */
const CLARIFICATION_HOOK_SCRIPT = `#!/bin/bash
# Description: Signal host when agent writes @human_clarification.md
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
if [[ "$FILE_PATH" == *"@human_clarification.md"* ]]; then
  date -u +"%Y-%m-%dT%H:%M:%SZ" > /workspace/@human_clarification.requested
fi
exit 0
`;

/**
 * Merges the clarification PostToolUse hook registration into a Claude
 * settings.json string, returning the merged JSON. Safe to call on an
 * empty string or invalid JSON (falls back to a minimal object).
 */
function mergeClarificationHook(settingsContent: string): string {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(settingsContent);
  } catch { /* start from empty */ }

  const hooks = (settings.hooks as Record<string, unknown[]> | undefined) ?? {};
  const postToolUse = ((hooks.PostToolUse as unknown[]) ?? []) as Array<Record<string, unknown>>;

  const hookCmd = 'bash ~/.claude/hooks/clarification-notify.sh';
  const alreadyPresent = postToolUse.some((entry) =>
    (entry.hooks as Array<Record<string, unknown>>)?.some((h) => h.command === hookCmd)
  );

  if (!alreadyPresent) {
    postToolUse.push({
      matcher: 'Write|Edit|MultiEdit',
      hooks: [{ type: 'command', command: hookCmd }],
    });
  }

  settings.hooks = { ...hooks, PostToolUse: postToolUse };
  return JSON.stringify(settings, null, 2);
}

export interface LoopServices {
  loopRunner: LoopRunner;
  scheduler: LoopScheduler;
  cleanupManager?: { registerContainer: (id: string) => void };
  projectStore?: { getProject: (id: string) => ProjectConfig | null };
  preValidationStore?: PreValidationStore;
  hooksStore?: HooksStore;
  kiroHooksStore?: KiroHooksStore;
  claudeSettingsStore?: ClaudeSettingsStore;
  runtime?: Pick<ContainerRuntime, 'execCommand'>;
  authInjector?: AuthInjector;
  credentialManager?: CredentialManager;
  sshKeyManager?: SSHKeyManager;
  deployKeyStore?: DeployKeyStore;
  loopScriptsStore?: LoopScriptsStore;
  configManager?: ConfigManager;
}

export function registerLoopHandlers(services: LoopServices): void {
  const {
    loopRunner,
    scheduler,
    cleanupManager,
    projectStore,
    preValidationStore,
    hooksStore,
    kiroHooksStore,
    claudeSettingsStore,
    runtime,
    authInjector,
    credentialManager,
    sshKeyManager,
    deployKeyStore,
    loopScriptsStore,
    configManager,
  } = services;

  const logger = getLogger('loop');

  // Shell snippet that ensures ~/.claude.json exists with minimal onboarding state.
  // Used as a preamble in SINGLE-mode container CMDs: the agent starts immediately
  // so there is no pre-exec window to create the file after the container boots.
  const ENSURE_CLAUDE_JSON = `test -f ~/.claude.json || printf '{"hasCompletedOnboarding":true}\\n' > ~/.claude.json`;

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

      // Write the loop script to the project's local_path root so it appears
      // at /workspace/<script> in the container via volume mount, executable.
      if (project && project.local_path && project.loop_script && loopScriptsStore) {
        try {
          const content = await loopScriptsStore.getScript(project.loop_script);
          if (content) {
            const dest = path.join(project.local_path, project.loop_script);
            await fs.writeFile(dest, content, { mode: 0o755 });
          } else {
            logger.warn(`Loop script "${project.loop_script}" not found in store`);
          }
        } catch (err) {
          logger.warn(`Failed to write loop script ${project.loop_script} to local_path`, { err });
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
      // Hooks and settings go into a temp dir mounted at /home/ralph/.claude.
      // Prompt files for single-mode container runs go to /workspace (see below).
      const isVm = opts.sandboxType === 'vm';
      const isSingleContainer = opts.mode === LoopMode.SINGLE && !isVm;
      if ((isVm || isSingleContainer) && project) {
        const hasHooks = project.hooks.length > 0 && !!hooksStore;
        const hasPrompts = Object.keys(project.custom_prompts).length > 0;
        const hasSpecFiles = Object.keys(project.spec_files ?? {}).length > 0;
        const hasClaudeSettings = !!project.claude_settings_file && !!claudeSettingsStore;
        // browser_session credentials must be pre-mounted for VM/SINGLE runs because
        // docker exec injection would race against (or miss) the agent startup.
        const hasBrowserSession = authMethod === 'browser_session';

        const hasKiroConfig = !!project.kiro_config;
        const hasKiroHooks = (project.kiro_hooks ?? []).length > 0 && !!kiroHooksStore;

        if (hasHooks || hasClaudeSettings || hasBrowserSession || !!project.local_path) {
          const claudeDir = path.join(os.tmpdir(), `zephyr-claude-${opts.projectId}${opts.role ? `-${opts.role}` : ''}`);
          try {
            await fs.mkdir(path.join(claudeDir, 'hooks'), { recursive: true });

            // Write default settings to keep the auto-updater disabled and onboarding
            // pre-completed even when this directory is bind-mounted over the image's
            // pre-baked /home/ralph/.claude. If the user has a custom settings file it
            // will overwrite this below.
            await fs.writeFile(path.join(claudeDir, 'settings.json'), '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}\n', 'utf8');

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

            // Inject the built-in clarification notify hook for workspace-backed loops.
            // Merges the PostToolUse registration into whatever settings.json was written
            // above (default or user's), then writes the hook script alongside it.
            if (project.local_path) {
              try {
                const existingSettings = await fs.readFile(path.join(claudeDir, 'settings.json'), 'utf8').catch(() => '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}');
                await fs.writeFile(path.join(claudeDir, 'settings.json'), mergeClarificationHook(existingSettings), 'utf8');
                await fs.writeFile(path.join(claudeDir, 'hooks', 'clarification-notify.sh'), CLARIFICATION_HOOK_SCRIPT, { mode: 0o755 });
              } catch (err) {
                logger.warn('Failed to inject clarification notify hook for .claude mount', { err });
              }
            }

            // Pre-write OAuth credentials to .credentials.json so they are available
            // before the agent CMD starts (exec injection happens too late for SINGLE/VM).
            if (hasBrowserSession && credentialManager) {
              try {
                const sessionJson = await credentialManager.getApiKey('anthropic_session');
                if (sessionJson) {
                  await fs.writeFile(path.join(claudeDir, '.credentials.json'), sessionJson, 'utf8');
                } else {
                  logger.warn('browser_session auth: no session data stored; container may lack credentials');
                }
              } catch (err) {
                logger.warn('Failed to write browser session credentials for .claude mount', { err });
              }
            }

            opts = {
              ...opts,
              // Mount at the ralph user's home .claude dir, not /root/.claude.
              // The container runs as the "ralph" user (HOME=/home/ralph), so
              // /root/.claude is inaccessible (drwx------ owned by root).
              volumeMounts: [...(opts.volumeMounts ?? []), `${claudeDir}:/home/ralph/.claude`],
            };
          } catch (err) {
            logger.warn('Failed to prepare .claude directory for loop', { err });
          }
        }

        // Pre-mount Kiro config and hooks at /home/ralph/.kiro for VM/single-mode runs.
        if (hasKiroConfig || hasKiroHooks) {
          const kiroDir = path.join(os.tmpdir(), `zephyr-kiro-${opts.projectId}${opts.role ? `-${opts.role}` : ''}`);
          try {
            await fs.mkdir(path.join(kiroDir, 'hooks'), { recursive: true });

            if (hasKiroConfig && project.kiro_config) {
              await fs.writeFile(path.join(kiroDir, 'config.json'), project.kiro_config, 'utf8');
            }

            if (hasKiroHooks && kiroHooksStore) {
              for (const filename of project.kiro_hooks ?? []) {
                try {
                  const content = await kiroHooksStore.getHook(filename);
                  if (content) {
                    const safe = path.basename(filename);
                    await fs.writeFile(path.join(kiroDir, 'hooks', safe), content, { mode: 0o755 });
                  }
                } catch (err) {
                  logger.warn(`Failed to write kiro hook ${filename} for .kiro mount`, { err });
                }
              }
            }

            opts = {
              ...opts,
              // Same reason as the .claude mount: ralph's home is /home/ralph.
              volumeMounts: [...(opts.volumeMounts ?? []), `${kiroDir}:/home/ralph/.kiro`],
            };
          } catch (err) {
            logger.warn('Failed to prepare .kiro directory for loop', { err });
          }
        }

        // For single-mode container runs: write prompt files to /workspace so the
        // claude CMD can read them at /workspace/<filename>. Writing to /home/ralph/.claude
        // would shadow the mount but prompts belong in /workspace where the agent reads them.
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

        // Write spec files to specs/ inside the workspace for single-mode and VM runs.
        // When local_path is set it is already volume-mounted as /workspace, so writing
        // to local_path/specs/ makes them available at /workspace/specs/ in the container.
        if (hasSpecFiles) {
          const specFilesMap = project.spec_files ?? {};
          if (project.local_path) {
            const specsDir = path.join(project.local_path, 'specs');
            try {
              await fs.mkdir(specsDir, { recursive: true });
              for (const [filename, content] of Object.entries(specFilesMap)) {
                const safe = path.basename(filename);
                await fs.writeFile(path.join(specsDir, safe), content, 'utf8');
              }
            } catch (err) {
              logger.warn('Failed to write spec files to local_path/specs for run', { err });
            }
          } else {
            // No local_path: write to a temp dir and mount it as a separate volume at /workspace/specs.
            const specsDir = path.join(os.tmpdir(), `zephyr-specs-${opts.projectId}`);
            try {
              await fs.mkdir(specsDir, { recursive: true });
              for (const [filename, content] of Object.entries(specFilesMap)) {
                const safe = path.basename(filename);
                await fs.writeFile(path.join(specsDir, safe), content, 'utf8');
              }
              opts = {
                ...opts,
                volumeMounts: [...(opts.volumeMounts ?? []), `${specsDir}:/workspace/specs`],
              };
            } catch (err) {
              logger.warn('Failed to prepare spec files directory for run', { err });
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

      // For single-mode runs with no explicit cmd, build cmd from the project's loop script.
      // Mirrors factory mode: ./loop-script <role> <maxIterations>
      // The role (e.g. "plan", "build") comes from the dialog selection; maxIterations from envVars.
      // Falls back to claude --print if no loop script is configured.
      if (opts.mode === LoopMode.SINGLE && !opts.cmd && project) {
        const loopScript = project.loop_script;
        const maxIterations = opts.envVars?.MAX_ITERATIONS ?? '10';
        const role = opts.role;
        opts = {
          ...opts,
          cmd: loopScript
            ? ['bash', '-c', role
                ? `${ENSURE_CLAUDE_JSON} && ./${loopScript} ${role} ${maxIterations}`
                : `${ENSURE_CLAUDE_JSON} && ./${loopScript} ${maxIterations}`]
            : ['bash', '-c', role
                ? `${ENSURE_CLAUDE_JSON} && claude --dangerously-skip-permissions --max-turns ${maxIterations} --output-format json --print "$(cat /workspace/PROMPT_${role}.md)"`
                : `${ENSURE_CLAUDE_JSON} && claude --dangerously-skip-permissions --max-turns ${maxIterations} --output-format json`],
        };
      }

      // Remove any stale terminal loops for this project before starting a new one.
      // This clears leftover factory role loops when switching to a non-factory run
      // (and vice versa), so the UI doesn't show ghost entries from the previous mode.
      for (const stale of loopRunner.listByProject(opts.projectId)) {
        if (isLoopTerminal(stale.status)) {
          loopRunner.removeLoop(stale.projectId, stale.role);
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
      if (state.containerId && runtime) {
        // Python: install any requirements.txt / requirements-*.txt in /workspace
        try {
          await runtime.execCommand(
            state.containerId,
            ['sh', '-c', 'find /workspace -maxdepth 1 -name "requirements*.txt" | while read f; do pip3 install --break-system-packages -q -r "$f"; done'],
            { user: 'root' },
          );
        } catch (err) {
          logger.warn('Failed to install Python workspace dependencies', { err });
        }

        // Node.js: run npm install if package.json exists in /workspace
        try {
          await runtime.execCommand(
            state.containerId,
            ['sh', '-c', '[ -f /workspace/package.json ] && cd /workspace && npm install 2>&1 || true'],
            { user: 'root' },
          );
        } catch (err) {
          logger.warn('Failed to install Node.js workspace dependencies', { err });
        }

        // Rust: fetch Cargo dependencies if Cargo.toml exists in /workspace
        try {
          await runtime.execCommand(
            state.containerId,
            ['sh', '-c', '[ -f /workspace/Cargo.toml ] && cd /workspace && cargo fetch 2>&1 || true'],
            { user: 'ralph' },
          );
        } catch (err) {
          logger.warn('Failed to fetch Rust workspace dependencies', { err });
        }

        // Go: download module dependencies if go.mod exists in /workspace
        try {
          await runtime.execCommand(
            state.containerId,
            ['sh', '-c', '[ -f /workspace/go.mod ] && cd /workspace && go mod download 2>&1 || true'],
            { user: 'ralph' },
          );
        } catch (err) {
          logger.warn('Failed to download Go workspace dependencies', { err });
        }
      }

      // Ensure ~/.claude.json exists — safety net for containers running images built
      // before this file was added to generateClaudeCodeConfigBlock().
      // Only needed for CONTINUOUS mode; SINGLE-mode containers use the CMD preamble above.
      if (opts.mode !== LoopMode.SINGLE && state.containerId && runtime) {
        try {
          await runtime.execCommand(state.containerId, [
            'sh', '-c', ENSURE_CLAUDE_JSON,
          ]);
        } catch (err) {
          logger.warn('Failed to ensure ~/.claude.json exists in container', { err });
        }
      }

      // For browser_session auth: exec-write OAuth credentials to ~/.claude/.credentials.json
      // This is the file the Claude Code CLI reads for browser-based auth (not ~/.claude.json).
      if (authMethod === 'browser_session' && state.containerId && credentialManager && runtime) {
        try {
          const sessionJson = await credentialManager.getApiKey('anthropic_session');
          if (sessionJson) {
            const encoded = Buffer.from(sessionJson).toString('base64');
            await runtime.execCommand(state.containerId, [
              'sh', '-c',
              `mkdir -p ~/.claude && printf '%s' '${encoded}' | base64 -d > ~/.claude/.credentials.json`,
            ]);
            logger.info('Wrote browser session credentials to ~/.claude/.credentials.json in container');
          } else {
            logger.warn('browser_session auth mode but no session data stored; container may lack credentials');
          }
        } catch (err) {
          logger.warn('Failed to write browser session credentials to container', { err });
        }
      }

      // Configure git user identity in the container so commits have a proper author.
      if (state.containerId && runtime) {
        try {
          const gitName = project?.git_user_name?.trim() || 'Ralph';
          const gitEmail = project?.git_user_email?.trim() || 'ralph@placeholder.com';
          await runtime.execCommand(state.containerId, [
            'sh', '-c',
            `git config --global user.name "${gitName}" && git config --global user.email "${gitEmail}"`,
          ]);
          logger.info('Configured git user identity in container', { gitName, gitEmail });
        } catch (err) {
          logger.warn('Failed to configure git user identity in container', { err });
        }
      }

      // Inject hook files into ~/.claude/hooks inside the container.
      // Uses base64 to safely transfer file contents via docker exec.
      // Skipped for single-mode container runs: those already have hooks pre-mounted
      // as a volume (handled above), and the agent CMD starts before exec can run.
      if (project && project.hooks.length > 0 && state.containerId && hooksStore && runtime && opts.mode !== LoopMode.SINGLE) {
        try {
          await runtime.execCommand(state.containerId, [
            'sh', '-c', 'mkdir -p ~/.claude/hooks',
          ]);

          for (const filename of project.hooks) {
            try {
              const content = await hooksStore.getHook(filename);
              if (content) {
                // Buffer.from().toString('base64') produces no newlines, safe for single-quoting
                const encoded = Buffer.from(content).toString('base64');
                const safe = path.basename(filename);
                await runtime.execCommand(state.containerId, [
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
      if (project && Object.keys(project.custom_prompts).length > 0 && state.containerId && runtime && opts.mode !== LoopMode.SINGLE) {
        try {
          await runtime.execCommand(state.containerId, [
            'sh', '-c', 'mkdir -p ~/.claude',
          ]);

          for (const [filename, content] of Object.entries(project.custom_prompts)) {
            try {
              const encoded = Buffer.from(content).toString('base64');
              const safe = path.basename(filename);
              await runtime.execCommand(state.containerId, [
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

      // Inject spec files into /workspace/specs/ inside the container.
      // Uses base64 to safely transfer file contents via docker exec.
      // Single-mode container and VM runs handle this via volume mount above.
      if (project && Object.keys(project.spec_files ?? {}).length > 0 && state.containerId && runtime && opts.mode !== LoopMode.SINGLE) {
        try {
          await runtime.execCommand(state.containerId, [
            'sh', '-c', 'mkdir -p /workspace/specs',
          ]);

          for (const [filename, content] of Object.entries(project.spec_files ?? {})) {
            try {
              const encoded = Buffer.from(content).toString('base64');
              const safe = path.basename(filename);
              await runtime.execCommand(state.containerId, [
                'sh', '-c',
                `printf '%s' '${encoded}' | base64 -d > /workspace/specs/${safe}`,
              ]);
            } catch (err) {
              logger.warn(`Failed to inject spec file ${filename} into container`, { err });
            }
          }
        } catch (err) {
          logger.warn('Failed to create /workspace/specs in container for spec files', { err });
        }
      }

      // Inject claude settings.json into ~/.claude/settings.json inside the container.
      // Uses base64 to safely transfer file contents via docker exec.
      // Skipped for single-mode container and VM runs: those already have the file
      // pre-mounted as a volume (handled above).
      if (project && project.claude_settings_file && state.containerId && claudeSettingsStore && runtime && opts.mode !== LoopMode.SINGLE) {
        try {
          const content = await claudeSettingsStore.getFile(project.claude_settings_file);
          if (content) {
            const encoded = Buffer.from(content).toString('base64');
            await runtime.execCommand(state.containerId, [
              'sh', '-c',
              `mkdir -p ~/.claude && printf '%s' '${encoded}' | base64 -d > ~/.claude/settings.json`,
            ]);
          }
        } catch (err) {
          logger.warn('Failed to inject claude settings.json into container', { err });
        }
      }

      // Inject built-in clarification notify hook for workspace-backed continuous loops.
      // Must run AFTER the user's settings.json injection above so the merge sees the
      // final user settings rather than the image default.
      if (project?.local_path && state.containerId && runtime && opts.mode !== LoopMode.SINGLE) {
        try {
          await runtime.execCommand(state.containerId, ['sh', '-c', 'mkdir -p ~/.claude/hooks']);
          const hookEncoded = Buffer.from(CLARIFICATION_HOOK_SCRIPT).toString('base64');
          await runtime.execCommand(state.containerId, [
            'sh', '-c',
            `printf '%s' '${hookEncoded}' | base64 -d > ~/.claude/hooks/clarification-notify.sh && chmod +x ~/.claude/hooks/clarification-notify.sh`,
          ]);
          // Load user settings (if any) so we merge rather than clobber them.
          const baseSettings = project.claude_settings_file && claudeSettingsStore
            ? (await claudeSettingsStore.getFile(project.claude_settings_file) ?? '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}')
            : '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}';
          const settingsEncoded = Buffer.from(mergeClarificationHook(baseSettings)).toString('base64');
          await runtime.execCommand(state.containerId, [
            'sh', '-c',
            `printf '%s' '${settingsEncoded}' | base64 -d > ~/.claude/settings.json`,
          ]);
        } catch (err) {
          logger.warn('Failed to inject clarification notify hook into container', { err });
        }
      }

      // Inject Kiro config into ~/.kiro/config.json inside the container.
      // Uses base64 to safely transfer the JSON content via docker exec.
      // Skipped for single-mode and VM runs: those already have the file pre-mounted.
      if (project && project.kiro_config && state.containerId && runtime && opts.mode !== LoopMode.SINGLE) {
        try {
          const encoded = Buffer.from(project.kiro_config).toString('base64');
          await runtime.execCommand(state.containerId, [
            'sh', '-c',
            `mkdir -p ~/.kiro && printf '%s' '${encoded}' | base64 -d > ~/.kiro/config.json`,
          ]);
        } catch (err) {
          logger.warn('Failed to inject kiro config.json into container', { err });
        }
      }

      // Inject Kiro hook files into ~/.kiro/hooks inside the container.
      // Uses base64 to safely transfer file contents via docker exec.
      // Skipped for single-mode and VM runs: those already have hooks pre-mounted.
      if (project && (project.kiro_hooks ?? []).length > 0 && state.containerId && kiroHooksStore && runtime && opts.mode !== LoopMode.SINGLE) {
        try {
          await runtime.execCommand(state.containerId, [
            'sh', '-c', 'mkdir -p ~/.kiro/hooks',
          ]);

          for (const filename of project.kiro_hooks ?? []) {
            try {
              const content = await kiroHooksStore.getHook(filename);
              if (content) {
                const encoded = Buffer.from(content).toString('base64');
                const safe = path.basename(filename);
                await runtime.execCommand(state.containerId, [
                  'sh', '-c',
                  `printf '%s' '${encoded}' | base64 -d > ~/.kiro/hooks/${safe} && chmod +x ~/.kiro/hooks/${safe}`,
                ]);
              }
            } catch (err) {
              logger.warn(`Failed to inject kiro hook ${filename} into container`, { err });
            }
          }
        } catch (err) {
          logger.warn('Failed to create ~/.kiro/hooks in container', { err });
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
          if (!pat) {
            logger.warn('No GitHub PAT stored for this project — SSH deploy key setup skipped. Add a PAT in the project settings to enable git push over SSH.', { projectId: opts.projectId });
          } else {
            const { privateKey, publicKey } = sshKeyManager.generateKeyPair();
            const keyTitle = `zephyr-${opts.projectId.slice(0, 8)}-${Date.now()}`;
            logger.info('Registering GitHub deploy key', { projectId: opts.projectId, repoUrl: project.repo_url });
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
          logger.warn('Failed to set up GitHub SSH deploy key; loop continues without SSH access', { projectId: opts.projectId, err });
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
          if (!pat) {
            logger.warn('No GitLab PAT stored for this project — SSH deploy key setup skipped. Add a PAT in the project settings to enable git push over SSH.', { projectId: opts.projectId });
          } else {
            const { privateKey, publicKey } = sshKeyManager.generateKeyPair();
            const keyTitle = `zephyr-${opts.projectId.slice(0, 8)}-${Date.now()}`;
            logger.info('Registering GitLab deploy key', { projectId: opts.projectId, repoUrl: project.repo_url });
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
          logger.warn('Failed to set up GitLab SSH deploy key; loop continues without SSH access', { projectId: opts.projectId, err });
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
    // Create directory tree with world-writable permissions so the container's
    // ralph user can write regardless of host UID mismatch.
    for (const dir of [
      path.join(workspacePath, 'team', 'handovers'),
      path.join(workspacePath, 'team', 'tasks', 'pending'),
      path.join(workspacePath, 'tasks', 'pending'),
    ]) {
      await fs.mkdir(dir, { recursive: true });
      await fs.chmod(dir, 0o777);
    }

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
      'team/complete.flag': '',
      '.gitignore': [
        'team/handovers/',
        'team/complete.flag',
        'team/status.log',
        '@human_clarifications.md',
        '.*_checked_*',
        '.last_*',
        'tasks/pending/*',
        'team/human_*.md',
      ].join('\n') + '\n',
    };

    for (const [filePath, defaultContent] of Object.entries(files)) {
      const fullPath = path.join(workspacePath, filePath);
      try {
        await fs.access(fullPath);
        // File exists — ensure it's writable by the container user.
        await fs.chmod(fullPath, 0o777);
      } catch {
        await fs.writeFile(fullPath, defaultContent, { encoding: 'utf8', mode: 0o777 });
      }
    }

    // Always reset the clarification-requested flag so stale requests from a
    // previous factory run don't cause agents to stall waiting for human input.
    await fs.writeFile(path.join(workspacePath, '@human_clarification.requested'), '', { encoding: 'utf8', mode: 0o666 });
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
      // Each role gets its own prompt if one exists with the naming convention PROMPT_<role>.md.
      // In SINGLE mode, build a per-role CMD that runs the agent against the role's prompt file
      // with a MAX_ITERATIONS cap passed via --max-turns.
      const isSingleFactory = baseOpts.mode === LoopMode.SINGLE;
      const maxIterations = baseOpts.envVars?.MAX_ITERATIONS ?? '10';
      const loopScript = project.loop_script;

      const results: LoopState[] = [];
      for (const role of factoryConfig.roles) {
        let roleCmd: string[] | undefined;
        if (isSingleFactory) {
          const promptFile = `PROMPT_${role}.md`;
          roleCmd = loopScript
            ? ['bash', '-c', `${ENSURE_CLAUDE_JSON} && ./${loopScript} ${promptFile} ${maxIterations}`]
            : ['bash', '-c', `${ENSURE_CLAUDE_JSON} && claude --dangerously-skip-permissions --max-turns ${maxIterations} --output-format json --print "$(cat /workspace/${promptFile})"`];
        }

        const roleOpts: LoopStartOpts = {
          ...baseOpts,
          projectId,
          projectName: project.name,
          role,
          ...(roleCmd ? { cmd: roleCmd } : {}),
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

  // Watchers for @human_clarification.requested per active loop key.
  // The trigger file is written only by the injected hook when the agent writes
  // @human_clarification.md, so no cooldown is needed.
  const clarificationWatchers = new Map<string, fsSync.FSWatcher>();

  loopRunner.onStateChange((state: LoopState) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send(IPC.LOOP_STATE_CHANGED, state);
    });

    const loopKey = getLoopKey(state.projectId, state.role);
    const project = projectStore?.getProject(state.projectId);

    // Start watching @human_clarification.md when a loop becomes active
    if (state.status === LoopStatus.RUNNING && !clarificationWatchers.has(loopKey)) {
      const workspacePath = project?.local_path;
      if (workspacePath) {
        const clarificationFile = path.join(workspacePath, '@human_clarification.requested');
        try {
          const watcher = fsSync.watch(clarificationFile, () => {
            const settings = configManager?.loadJson<AppSettings>('settings.json');
            if (settings?.notification_enabled) {
              const projectName = project?.name ?? state.projectId;
              new Notification({
                title: 'Agent needs clarification',
                body: `"${projectName}" is waiting for your input in @human_clarification.md`,
              }).show();
            }
          });
          clarificationWatchers.set(loopKey, watcher);
        } catch {
          // File may not exist yet — ignore
        }
      }
    }

    // Tear down the watcher when the loop reaches a terminal state
    if (isLoopTerminal(state.status)) {
      const watcher = clarificationWatchers.get(loopKey);
      if (watcher) {
        watcher.close();
        clarificationWatchers.delete(loopKey);
      }
    }

    // Fire OS desktop notification on loop completion or failure
    if (state.status === LoopStatus.COMPLETED || state.status === LoopStatus.FAILED) {
      const settings = configManager?.loadJson<AppSettings>('settings.json');
      if (settings?.notification_enabled) {
        const projectName = project?.name ?? state.projectId;
        const isCompleted = state.status === LoopStatus.COMPLETED;
        new Notification({
          title: isCompleted ? 'Loop completed' : 'Loop failed',
          body: isCompleted
            ? `"${projectName}" finished successfully.`
            : `"${projectName}" stopped with an error.`,
        }).show();
      }
    }
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
