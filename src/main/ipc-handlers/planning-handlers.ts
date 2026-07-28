// IPC handlers for planning sessions — an interactive human↔agent chat used to
// draft spec files for a project before the factory picks them up.
//
// A planning session is deliberately *not* a loop:
//   - it does not go through ContainerOrchestrator, so it never occupies one of
//     the max_concurrent_containers slots and never appears in the Loops UI
//   - no factory notify hooks are injected — it is a plain conversation
//   - the container is throwaway: created on open, removed on close
//
// The only state it produces is spec files. Existing ProjectConfig.spec_files
// are written into <local_path>/specs before the session starts, and the
// directory is read back into ProjectConfig.spec_files when it closes, keeping
// the store the source of truth.

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { ipcMain } from 'electron';

import { IPC } from '../../shared/ipc-channels';
import { getLogger } from '../../services/logging';
import type { AuthInjector } from '../../services/auth-injector';
import type { ConfigManager } from '../../services/config-manager';
import type { ContainerRuntime } from '../../services/container-runtime';
import type { CredentialManager } from '../../services/credential-manager';
import type { ProjectStore } from '../../services/project-store';
import type { TerminalManager } from '../../services/terminal-manager';
import type { AppSettings } from '../../shared/models';

const logger = getLogger('ipc');

/** Where the Kiro CLI expects its auth database inside the container. */
const KIRO_DB_DEST = '/home/ralph/.local/share/kiro-cli/data.sqlite3';

export interface PlanningServices {
  runtime: ContainerRuntime;
  terminalManager: TerminalManager;
  projectStore: ProjectStore;
  configManager: ConfigManager;
  authInjector: AuthInjector;
  credentialManager: CredentialManager;
}

/** Options the renderer may pass when opening a planning session. */
export interface PlanningOpenOpts {
  rows?: number;
  cols?: number;
}

/** Container + terminal session pair tracked for the lifetime of a session. */
interface PlanningSessionState {
  sessionId: string;
  containerId: string;
  projectId: string;
  /** Absolute host path of the specs directory to read back on close. */
  specsDir: string;
}

const activeSessions = new Map<string, PlanningSessionState>();

/**
 * Register the planning-session IPC handlers.
 *
 * @returns a disposer that tears down any still-open sessions (used on quit).
 */
export function registerPlanningHandlers(services: PlanningServices): () => Promise<void> {
  const { runtime, terminalManager, projectStore, configManager, authInjector, credentialManager } =
    services;

  // ── Open a planning session ──────────────────────────────────────────────

  ipcMain.handle(IPC.PLANNING_OPEN, async (_event, projectId: string, opts?: PlanningOpenOpts) => {
    let containerId: string | undefined;
    try {
      const project = projectStore.getProject(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      if (!project.local_path) {
        throw new Error(
          'This project has no local path configured. Set one in the project settings so spec files can be saved.'
        );
      }
      const image = project.docker_image;
      if (!image) throw new Error('This project has no container image configured.');

      const settings = configManager.loadJson<AppSettings>('settings.json');
      const provider = settings?.llm_provider ?? 'claude';

      // Seed the workspace with the specs we already know about so the agent
      // can read and revise them in place.
      const specsDir = path.join(project.local_path, 'specs');
      await fs.mkdir(specsDir, { recursive: true });
      for (const [filename, content] of Object.entries(project.spec_files ?? {})) {
        await fs.writeFile(path.join(specsDir, path.basename(filename)), content, 'utf8');
      }

      const auth = await authInjector.getContainerAuthConfig();
      const binds = [`${project.local_path}:/workspace`, ...auth.volumeMounts];

      // Engine config: only what the agent needs to authenticate and behave
      // like the configured engine. No factory hooks — this is a conversation.
      const kiroDbStaged = await prepareEngineConfig({
        provider,
        projectId,
        project,
        settings,
        auth,
        credentialManager,
        binds,
      });

      containerId = await runtime.createContainer({
        image,
        projectId,
        name: `zephyr-plan-${projectId.slice(0, 8)}-${Date.now().toString(36)}`,
        // Idle PID 1 — the terminal attaches via exec, so the container just
        // needs to stay alive for the duration of the session.
        command: ['sleep', 'infinity'],
        env: auth.envVars,
        binds,
        labels: { 'zephyr.session': 'planning' },
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
          logger.warn('Failed to copy Kiro DB inside planning container', { err });
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
        specsDir,
      });

      return { success: true, session };
    } catch (error) {
      // Never leave a container behind when the session failed to attach.
      if (containerId) {
        try {
          await runtime.removeContainer(containerId, true);
        } catch (err) {
          logger.warn('Failed to remove planning container after open error', { err });
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to open planning session', { projectId, error: message });
      return { success: false, error: message };
    }
  });

  // ── Close a planning session ─────────────────────────────────────────────

  ipcMain.handle(IPC.PLANNING_CLOSE, async (_event, sessionId: string) => {
    const state = activeSessions.get(sessionId);
    if (!state) {
      return { success: false, error: `Planning session ${sessionId} not found` };
    }
    activeSessions.delete(sessionId);

    try {
      const specFiles = await teardownSession(state, runtime, terminalManager);
      // Write back last so a failed teardown never silently drops the specs.
      projectStore.updateProject(state.projectId, { spec_files: specFiles });
      return { success: true, specFiles };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to close planning session', { sessionId, error: message });
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
          projectStore.updateProject(state.projectId, { spec_files: specFiles });
        } catch (err) {
          logger.warn('Failed to clean up planning session on shutdown', { err });
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
 * @returns true when the Kiro DB was staged and needs the post-start copy.
 */
async function prepareEngineConfig(args: {
  provider: string;
  projectId: string;
  project: { kiro_config?: string };
  settings: AppSettings | null;
  auth: { authMethod: string };
  credentialManager: CredentialManager;
  binds: string[];
}): Promise<boolean> {
  const { provider, projectId, project, settings, auth, credentialManager, binds } = args;

  if (provider === 'kiro') {
    // Kiro config lives at ~/.kiro; the container runs as `ralph`.
    if (project.kiro_config) {
      const kiroDir = path.join(os.tmpdir(), `zephyr-plan-kiro-${projectId}`);
      try {
        await fs.mkdir(kiroDir, { recursive: true });
        await fs.writeFile(path.join(kiroDir, 'config.json'), project.kiro_config, 'utf8');
        binds.push(`${kiroDir}:/home/ralph/.kiro`);
      } catch (err) {
        logger.warn('Failed to prepare .kiro directory for planning session', { err });
      }
    }

    // Copy the host auth DB to a temp file first: mounting the live DB can be
    // truncated by VirtioFS, and it must be read-only to the container.
    const hostDb = settings?.kiro_db_path;
    if (hostDb) {
      try {
        const tmpFile = path.join(os.tmpdir(), `zephyr-plan-kiro-db-${projectId}.sqlite3`);
        await fs.copyFile(hostDb, tmpFile);
        await fs.chmod(tmpFile, 0o644);
        binds.push(`${tmpFile}:/tmp/kiro-data.sqlite3:ro`);
        return true;
      } catch (err) {
        logger.warn('Failed to stage Kiro DB for planning session', { err });
      }
    }
    return false;
  }

  // Claude with browser_session auth needs ~/.claude/.credentials.json present
  // before the agent starts.
  if (auth.authMethod === 'browser_session') {
    const claudeDir = path.join(os.tmpdir(), `zephyr-plan-claude-${projectId}`);
    try {
      await fs.mkdir(claudeDir, { recursive: true });
      const sessionJson = await credentialManager.getApiKey('anthropic_session');
      if (sessionJson) {
        await fs.writeFile(path.join(claudeDir, '.credentials.json'), sessionJson, 'utf8');
      } else {
        logger.warn(
          'browser_session auth: no stored session; planning container may lack credentials'
        );
      }
      binds.push(`${claudeDir}:/home/ralph/.claude`);
    } catch (err) {
      logger.warn('Failed to prepare .claude directory for planning session', { err });
    }
  }

  return false;
}

/**
 * Closes the terminal, removes the throwaway container, and reads the specs
 * directory back into a spec_files map.
 */
async function teardownSession(
  state: PlanningSessionState,
  runtime: ContainerRuntime,
  terminalManager: TerminalManager
): Promise<Record<string, string>> {
  try {
    await terminalManager.closeSession(state.sessionId);
  } catch {
    // Session may already have ended when the agent exited — not an error.
  }

  try {
    await runtime.removeContainer(state.containerId, true);
  } catch (err) {
    logger.warn('Failed to remove planning container', { err });
  }

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
