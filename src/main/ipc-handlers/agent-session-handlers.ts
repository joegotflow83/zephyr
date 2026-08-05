// IPC handlers for agent sessions — an interactive human↔agent chat running in
// a throwaway container with the project mounted at /workspace.
//
// Two modes share all of this machinery:
//   - 'plan': draft spec files before the factory picks them up. Existing
//     ProjectConfig.spec_files are written into <local_path>/specs before the
//     session starts and read back into the store when it closes, keeping the
//     store the source of truth. The project is mounted READ-ONLY and only
//     specs/ is writable, so a planning session can never modify the code it is
//     reading — that guarantee is enforced by the mount, not by asking the agent
//     nicely, so it holds no matter what the user or the engine does.
//   - 'work': change the project directly. Nothing is seeded and nothing is
//     read back — the bind mount writes straight through to the host, so edits
//     are already saved. The project's own hooks and settings are injected so
//     the agent behaves the way it does inside a loop.
//
// An agent session is deliberately *not* a loop:
//   - it does not go through ContainerOrchestrator, so it never occupies one of
//     the max_concurrent_containers slots and never appears in the Loops UI
//   - no factory notify hooks are injected — those exist to drive the pipeline
//     and have nothing to notify in an interactive session
//   - the container is throwaway: created on open, removed on close
//
// Work sessions and loops are mutually exclusive per project so two agents
// never write to the same files: opening a work session is refused while a loop
// is active, and startLoopCore refuses while a work session is open (see
// hasActiveWorkSession below).

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { ipcMain } from 'electron';

import { IPC } from '../../shared/ipc-channels';
import { getLogger } from '../../services/logging';
import { isLoopTerminal } from '../../shared/loop-types';
import type { AuthInjector } from '../../services/auth-injector';
import type { ClaudeSettingsStore } from '../../services/claude-settings-store';
import type { ConfigManager } from '../../services/config-manager';
import type { ContainerOrchestrator } from '../../services/container-orchestrator';
import type { ContainerRuntime } from '../../services/container-runtime';
import type { CredentialManager } from '../../services/credential-manager';
import type { HooksStore } from '../../services/hooks-store';
import type { KiroHooksStore } from '../../services/kiro-hooks-store';
import type { ProjectStore } from '../../services/project-store';
import type { TerminalManager } from '../../services/terminal-manager';
import type { AppSettings, ProjectConfig } from '../../shared/models';

const logger = getLogger('ipc');

/** Where the Kiro CLI expects its auth database inside the container. */
const KIRO_DB_DEST = '/home/ralph/.local/share/kiro-cli/data.sqlite3';

/** Baseline Claude settings: no auto-update prompts, no onboarding wizard. */
const DEFAULT_CLAUDE_SETTINGS = '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}\n';

/** What the session is for. Decides seeding, read-back, and config injection. */
export type AgentSessionMode = 'plan' | 'work';

export interface AgentSessionServices {
  runtime: ContainerRuntime;
  terminalManager: TerminalManager;
  projectStore: ProjectStore;
  configManager: ConfigManager;
  authInjector: AuthInjector;
  credentialManager: CredentialManager;
  containerOrchestrator: ContainerOrchestrator;
  hooksStore: HooksStore;
  claudeSettingsStore: ClaudeSettingsStore;
  kiroHooksStore: KiroHooksStore;
}

/** Options the renderer may pass when opening a session. */
export interface AgentSessionOpenOpts {
  rows?: number;
  cols?: number;
}

/** Container + terminal session pair tracked for the lifetime of a session. */
interface AgentSessionState {
  sessionId: string;
  containerId: string;
  projectId: string;
  mode: AgentSessionMode;
  /** Absolute host path of the specs directory to read back on close (plan only). */
  specsDir: string;
}

const activeSessions = new Map<string, AgentSessionState>();

/**
 * True when the project has an open work session.
 *
 * Loop start consults this so a loop and an interactive work session never
 * write to the same working tree at the same time.
 */
export function hasActiveWorkSession(projectId: string): boolean {
  for (const state of activeSessions.values()) {
    if (state.projectId === projectId && state.mode === 'work') return true;
  }
  return false;
}

/**
 * Register the agent-session IPC handlers.
 *
 * @returns a disposer that tears down any still-open sessions (used on quit).
 */
export function registerAgentSessionHandlers(services: AgentSessionServices): () => Promise<void> {
  const {
    runtime,
    terminalManager,
    projectStore,
    configManager,
    authInjector,
    credentialManager,
    containerOrchestrator,
    hooksStore,
    claudeSettingsStore,
    kiroHooksStore,
  } = services;

  // ── Open a session ───────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.AGENT_SESSION_OPEN,
    async (_event, projectId: string, mode: AgentSessionMode, opts?: AgentSessionOpenOpts) => {
      let containerId: string | undefined;
      try {
        const project = projectStore.getProject(projectId);
        if (!project) throw new Error(`Project ${projectId} not found`);
        if (!project.local_path) {
          throw new Error(
            'This project has no local path configured. Set one in the project settings so files can be saved.'
          );
        }
        const image = project.docker_image;
        if (!image) throw new Error('This project has no container image configured.');

        // A work session edits the working tree directly, so it must not run
        // alongside a loop doing the same. Planning only touches specs/.
        if (mode === 'work') {
          const running = containerOrchestrator
            .listByProject(projectId)
            .filter((state) => !isLoopTerminal(state.status));
          if (running.length > 0) {
            throw new Error(
              'A loop is running for this project. Stop it before starting a work session so two agents do not edit the same files.'
            );
          }
        }

        const settings = configManager.loadJson<AppSettings>('settings.json');
        const provider = settings?.llm_provider ?? 'claude';

        // Planning seeds the workspace with the specs we already know about so
        // the agent can read and revise them in place.
        const specsDir = path.join(project.local_path, 'specs');
        if (mode === 'plan') {
          await fs.mkdir(specsDir, { recursive: true });
          for (const [filename, content] of Object.entries(project.spec_files ?? {})) {
            await fs.writeFile(path.join(specsDir, path.basename(filename)), content, 'utf8');
          }
        }

        const auth = await authInjector.getContainerAuthConfig();
        // Planning gets a read-only project with a writable specs/ mounted over
        // the top: the agent can read all the code it needs to write a good
        // spec, but every write outside specs/ fails at the kernel level. Work
        // mode mounts the whole tree read-write — that is the point of it.
        // (Both runtimes order binds parent-first, so the nested mount lands on
        // top of the read-only one.)
        const binds =
          mode === 'plan'
            ? [`${project.local_path}:/workspace:ro`, `${specsDir}:/workspace/specs`]
            : [`${project.local_path}:/workspace`];
        binds.push(...auth.volumeMounts);

        // Engine config: credentials, plus — in work mode — the project's own
        // hooks and settings. Never the built-in factory notify hooks; those
        // drive the pipeline and have nothing to notify here.
        const kiroDbStaged = await prepareEngineConfig({
          provider,
          mode,
          projectId,
          project,
          settings,
          auth,
          credentialManager,
          hooksStore,
          claudeSettingsStore,
          kiroHooksStore,
          binds,
        });

        containerId = await runtime.createContainer({
          image,
          projectId,
          name: `zephyr-${mode}-${projectId.slice(0, 8)}-${Date.now().toString(36)}`,
          // Idle PID 1 — the terminal attaches via exec, so the container just
          // needs to stay alive for the duration of the session.
          command: ['sleep', 'infinity'],
          env: auth.envVars,
          binds,
          labels: { 'zephyr.session': mode },
          workingDir: '/workspace',
          tty: true,
          autoRemove: true,
        });
        await runtime.startContainer(containerId);

        // SQLite needs a writable file, so the read-only mount is copied to its
        // final location inside the container (same pattern as loop start).
        if (kiroDbStaged) {
          try {
            await runtime.execCommand(containerId, [
              'sh',
              '-c',
              `mkdir -p ${path.posix.dirname(KIRO_DB_DEST)} && cp /tmp/kiro-data.sqlite3 ${KIRO_DB_DEST} && chmod 644 ${KIRO_DB_DEST}`,
            ]);
          } catch (err) {
            logger.warn('Failed to copy Kiro DB inside agent session container', { err });
          }
        }

        const session = await terminalManager.openSession(containerId, {
          command: buildEngineCommand(provider),
          user: 'ralph',
          workingDir: '/workspace',
          rows: opts?.rows,
          cols: opts?.cols,
        });

        activeSessions.set(session.id, {
          sessionId: session.id,
          containerId,
          projectId,
          mode,
          specsDir,
        });

        return { success: true, session };
      } catch (error) {
        // Never leave a container behind when the session failed to attach.
        if (containerId) {
          try {
            await runtime.removeContainer(containerId, true);
          } catch (err) {
            logger.warn('Failed to remove container after agent session open error', { err });
          }
        }
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Failed to open agent session', { projectId, mode, error: message });
        return { success: false, error: message };
      }
    }
  );

  // ── Close a session ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.AGENT_SESSION_CLOSE, async (_event, sessionId: string) => {
    const state = activeSessions.get(sessionId);
    if (!state) {
      return { success: false, error: `Agent session ${sessionId} not found` };
    }
    activeSessions.delete(sessionId);

    try {
      const specFiles = await teardownSession(state, runtime, terminalManager);
      // Write back last so a failed teardown never silently drops the specs.
      if (specFiles) projectStore.updateProject(state.projectId, { spec_files: specFiles });
      return { success: true, specFiles };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to close agent session', { sessionId, error: message });
      return { success: false, error: message };
    }
  });

  return async () => {
    const states = Array.from(activeSessions.values());
    activeSessions.clear();
    await Promise.all(
      states.map(async (state) => {
        try {
          const specFiles = await teardownSession(state, runtime, terminalManager);
          if (specFiles) projectStore.updateProject(state.projectId, { spec_files: specFiles });
        } catch (err) {
          logger.warn('Failed to clean up agent session on shutdown', { err });
        }
      })
    );
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds the argv the terminal attaches to.
 *
 * Wrapped in `bash -c` because `docker exec` does not run a login shell, so
 * ~/.local/bin (where kiro-cli and claude are installed) is not on PATH.
 * `exec` replaces bash so closing the agent closes the session.
 */
function buildEngineCommand(provider: string): string[] {
  const agent =
    provider === 'kiro'
      ? 'kiro-cli chat --trust-all-tools'
      : 'claude --dangerously-skip-permissions';
  return ['bash', '-c', `export PATH="$HOME/.local/bin:$PATH"; exec ${agent}`];
}

/**
 * Stages the engine's configuration and credentials into `binds` (mutated).
 *
 * In work mode the project's own hooks and settings are staged too. Note that
 * /home/ralph/.claude is a single mount point, so credentials and hooks have to
 * share one host directory — likewise /home/ralph/.kiro.
 *
 * @returns true when the Kiro DB was staged and needs the post-start copy.
 */
async function prepareEngineConfig(args: {
  provider: string;
  mode: AgentSessionMode;
  projectId: string;
  project: ProjectConfig;
  settings: AppSettings | null;
  auth: { authMethod: string };
  credentialManager: CredentialManager;
  hooksStore: HooksStore;
  claudeSettingsStore: ClaudeSettingsStore;
  kiroHooksStore: KiroHooksStore;
  binds: string[];
}): Promise<boolean> {
  const {
    provider,
    mode,
    projectId,
    project,
    settings,
    auth,
    credentialManager,
    hooksStore,
    claudeSettingsStore,
    kiroHooksStore,
    binds,
  } = args;

  if (provider === 'kiro') {
    // Kiro config lives at ~/.kiro; the container runs as `ralph`.
    const kiroHooks = mode === 'work' ? (project.kiro_hooks ?? []) : [];
    if (project.kiro_config || kiroHooks.length > 0) {
      const kiroDir = path.join(os.tmpdir(), `zephyr-${mode}-kiro-${projectId}`);
      try {
        await fs.mkdir(path.join(kiroDir, 'hooks'), { recursive: true });
        if (project.kiro_config) {
          await fs.writeFile(path.join(kiroDir, 'config.json'), project.kiro_config, 'utf8');
        }
        for (const filename of kiroHooks) {
          try {
            const content = await kiroHooksStore.getHook(filename);
            if (content) {
              await fs.writeFile(path.join(kiroDir, 'hooks', path.basename(filename)), content, {
                mode: 0o755,
              });
            }
          } catch (err) {
            logger.warn(`Failed to write kiro hook ${filename} for agent session`, { err });
          }
        }
        binds.push(`${kiroDir}:/home/ralph/.kiro`);
      } catch (err) {
        logger.warn('Failed to prepare .kiro directory for agent session', { err });
      }
    }

    // Copy the host auth DB to a temp file first: mounting the live DB can be
    // truncated by VirtioFS, and it must be read-only to the container.
    const hostDb = settings?.kiro_db_path;
    if (hostDb) {
      try {
        const tmpFile = path.join(os.tmpdir(), `zephyr-${mode}-kiro-db-${projectId}.sqlite3`);
        await fs.copyFile(hostDb, tmpFile);
        await fs.chmod(tmpFile, 0o644);
        binds.push(`${tmpFile}:/tmp/kiro-data.sqlite3:ro`);
        return true;
      } catch (err) {
        logger.warn('Failed to stage Kiro DB for agent session', { err });
      }
    }
    return false;
  }

  // Claude with browser_session auth needs ~/.claude/.credentials.json present
  // before the agent starts; work mode additionally wants the project's hooks
  // and settings.json. Both land in one directory — single mount point.
  const needsCredentials = auth.authMethod === 'browser_session';
  const claudeHooks = mode === 'work' ? project.hooks : [];
  const claudeSettingsFile = mode === 'work' ? project.claude_settings_file : undefined;
  if (!needsCredentials && claudeHooks.length === 0 && !claudeSettingsFile) return false;

  const claudeDir = path.join(os.tmpdir(), `zephyr-${mode}-claude-${projectId}`);
  try {
    await fs.mkdir(path.join(claudeDir, 'hooks'), { recursive: true });

    // Written first so the mount never leaves the agent without settings, then
    // overwritten by the project's own file when it has one.
    await fs.writeFile(path.join(claudeDir, 'settings.json'), DEFAULT_CLAUDE_SETTINGS, 'utf8');

    for (const filename of claudeHooks) {
      try {
        const content = await hooksStore.getHook(filename);
        if (content) {
          await fs.writeFile(path.join(claudeDir, 'hooks', path.basename(filename)), content, {
            mode: 0o755,
          });
        }
      } catch (err) {
        logger.warn(`Failed to write hook ${filename} for agent session`, { err });
      }
    }

    if (claudeSettingsFile) {
      try {
        const content = await claudeSettingsStore.getFile(claudeSettingsFile);
        if (content) {
          await fs.writeFile(path.join(claudeDir, 'settings.json'), content, 'utf8');
        }
      } catch (err) {
        logger.warn('Failed to write claude settings.json for agent session', { err });
      }
    }

    if (needsCredentials) {
      const sessionJson = await credentialManager.getApiKey('anthropic_session');
      if (sessionJson) {
        await fs.writeFile(path.join(claudeDir, '.credentials.json'), sessionJson, 'utf8');
      } else {
        logger.warn(
          'browser_session auth: no stored session; agent session container may lack credentials'
        );
      }
    }

    binds.push(`${claudeDir}:/home/ralph/.claude`);
  } catch (err) {
    logger.warn('Failed to prepare .claude directory for agent session', { err });
  }

  return false;
}

/**
 * Closes the terminal and removes the throwaway container.
 *
 * Planning sessions return the specs directory as a spec_files map; work
 * sessions have already written through the bind mount, so there is nothing to
 * collect and undefined is returned.
 */
async function teardownSession(
  state: AgentSessionState,
  runtime: ContainerRuntime,
  terminalManager: TerminalManager
): Promise<Record<string, string> | undefined> {
  try {
    await terminalManager.closeSession(state.sessionId);
  } catch {
    // Session may already have ended when the agent exited — not an error.
  }

  try {
    await runtime.removeContainer(state.containerId, true);
  } catch (err) {
    logger.warn('Failed to remove agent session container', { err });
  }

  if (state.mode !== 'plan') return undefined;
  return readSpecFiles(state.specsDir);
}

/** Reads every regular file in `specsDir` into a filename → content map. */
async function readSpecFiles(specsDir: string): Promise<Record<string, string>> {
  const specFiles: Record<string, string> = {};
  let entries;
  try {
    entries = await fs.readdir(specsDir, { withFileTypes: true });
  } catch {
    return specFiles;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      specFiles[entry.name] = await fs.readFile(path.join(specsDir, entry.name), 'utf8');
    } catch (err) {
      logger.warn(`Failed to read spec file ${entry.name} after planning session`, { err });
    }
  }
  return specFiles;
}
