/**
 * Unit tests for src/main/ipc-handlers/agent-session-handlers.ts
 *
 * An agent session is a throwaway container running the configured LLM engine
 * with the project mounted at /workspace. Two modes share the machinery:
 * 'plan' drafts spec files, 'work' edits the project directly. These tests
 * cover the contract that matters:
 *
 * - plan mode seeds ProjectConfig.spec_files into <local_path>/specs, creates +
 *   starts a container, and attaches a terminal to the right engine
 * - a failed attach never leaves a container behind
 * - closing a plan session writes the specs directory back into
 *   ProjectConfig.spec_files (the store stays the source of truth)
 * - work mode seeds nothing, writes nothing back, stages the project's hooks
 *   and settings into the single /home/ralph/.claude mount, and is refused
 *   while a loop is running for the project
 * - the returned disposer cleans up sessions still open at quit
 *
 * The filesystem is real (a temp dir per test) because the spec round-trip is
 * the whole point of plan mode; only the container runtime is mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { IpcMainInvokeEvent } from 'electron';

import { IPC } from '../../src/shared/ipc-channels';

// ── Mock electron ────────────────────────────────────────────────────────────

const handlerRegistry: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlerRegistry[channel] = handler;
    },
  },
}));

// ── Import subject under test (after mocks are in place) ─────────────────────

import {
  registerAgentSessionHandlers,
  hasActiveWorkSession,
} from '../../src/main/ipc-handlers/agent-session-handlers';

// ── Helpers ──────────────────────────────────────────────────────────────────

const fakeEvent = {} as IpcMainInvokeEvent;

async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const handler = handlerRegistry[channel];
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  return handler(fakeEvent, ...args);
}

// ── Service mocks ────────────────────────────────────────────────────────────

const mockRuntime = {
  createContainer: vi.fn(),
  startContainer: vi.fn(),
  removeContainer: vi.fn(),
  execCommand: vi.fn(),
};

const mockTerminalManager = {
  openSession: vi.fn(),
  closeSession: vi.fn(),
};

const mockProjectStore = {
  getProject: vi.fn(),
  updateProject: vi.fn(),
};

const mockConfigManager = {
  loadJson: vi.fn(),
};

const mockAuthInjector = {
  getContainerAuthConfig: vi.fn(),
};

const mockCredentialManager = {
  getApiKey: vi.fn(),
};

const mockContainerOrchestrator = {
  listByProject: vi.fn(),
};

const mockHooksStore = {
  getHook: vi.fn(),
};

const mockClaudeSettingsStore = {
  getFile: vi.fn(),
};

const mockKiroHooksStore = {
  getHook: vi.fn(),
};

function register(): () => Promise<void> {
  return registerAgentSessionHandlers({
    runtime: mockRuntime as never,
    terminalManager: mockTerminalManager as never,
    projectStore: mockProjectStore as never,
    configManager: mockConfigManager as never,
    authInjector: mockAuthInjector as never,
    credentialManager: mockCredentialManager as never,
    containerOrchestrator: mockContainerOrchestrator as never,
    hooksStore: mockHooksStore as never,
    claudeSettingsStore: mockClaudeSettingsStore as never,
    kiroHooksStore: mockKiroHooksStore as never,
  });
}

/** Host directory bound at /home/ralph/.claude, or undefined when not staged. */
function claudeBindSource(): string | undefined {
  const binds: string[] = mockRuntime.createContainer.mock.calls[0][0].binds;
  const bind = binds.find((b) => b.endsWith(':/home/ralph/.claude'));
  return bind?.slice(0, -':/home/ralph/.claude'.length);
}

describe('registerAgentSessionHandlers', () => {
  let tmpDir: string;
  let disposer: () => Promise<void>;

  beforeEach(async () => {
    vi.resetAllMocks();
    for (const key of Object.keys(handlerRegistry)) delete handlerRegistry[key];

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zephyr-agent-session-test-'));

    mockRuntime.createContainer.mockResolvedValue('container-1');
    mockRuntime.startContainer.mockResolvedValue(undefined);
    mockRuntime.removeContainer.mockResolvedValue(undefined);
    mockTerminalManager.openSession.mockResolvedValue({ id: 'session-1' });
    mockTerminalManager.closeSession.mockResolvedValue(undefined);
    mockAuthInjector.getContainerAuthConfig.mockResolvedValue({
      authMethod: 'api_key',
      envVars: { ANTHROPIC_API_KEY: 'sk-test' },
      volumeMounts: [],
    });
    mockConfigManager.loadJson.mockReturnValue({ llm_provider: 'claude' });
    mockContainerOrchestrator.listByProject.mockReturnValue([]);
    mockProjectStore.getProject.mockReturnValue({
      id: 'proj-1',
      name: 'Test Project',
      local_path: tmpDir,
      docker_image: 'zephyr/test:latest',
      spec_files: {},
      hooks: [],
    });

    disposer = register();
  });

  afterEach(async () => {
    // Drop any session the test left open so state does not leak between tests.
    await disposer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Open ───────────────────────────────────────────────────────────────────

  describe('agent-session:open (plan)', () => {
    it('creates a throwaway container and attaches a terminal to the engine', async () => {
      const result = await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'plan', { rows: 40, cols: 120 });

      expect(result.success).toBe(true);
      expect(result.session).toEqual({ id: 'session-1' });

      const createOpts = mockRuntime.createContainer.mock.calls[0][0];
      expect(createOpts.image).toBe('zephyr/test:latest');
      expect(createOpts.command).toEqual(['sleep', 'infinity']);
      expect(createOpts.autoRemove).toBe(true);
      expect(createOpts.workingDir).toBe('/workspace');
      expect(mockRuntime.startContainer).toHaveBeenCalledWith('container-1');

      const [containerId, sessionOpts] = mockTerminalManager.openSession.mock.calls[0];
      expect(containerId).toBe('container-1');
      expect(sessionOpts.rows).toBe(40);
      expect(sessionOpts.cols).toBe(120);
      expect(sessionOpts.command[0]).toBe('bash');
      expect(sessionOpts.command[2]).toContain('claude');
    });

    it('mounts the project read-only with only specs/ writable', async () => {
      await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'plan');

      const binds: string[] = mockRuntime.createContainer.mock.calls[0][0].binds;
      expect(binds).toContain(`${tmpDir}:/workspace:ro`);
      expect(binds).toContain(`${path.join(tmpDir, 'specs')}:/workspace/specs`);
      // No read-write mount of the tree itself — that is the whole guarantee.
      expect(binds).not.toContain(`${tmpDir}:/workspace`);
      // The writable specs mount must come after its read-only parent.
      expect(binds.indexOf(`${tmpDir}:/workspace:ro`)).toBeLessThan(
        binds.indexOf(`${path.join(tmpDir, 'specs')}:/workspace/specs`)
      );
    });

    it('launches kiro-cli when the configured provider is kiro', async () => {
      mockConfigManager.loadJson.mockReturnValue({ llm_provider: 'kiro' });

      await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'plan');

      const sessionOpts = mockTerminalManager.openSession.mock.calls[0][1];
      expect(sessionOpts.command[2]).toContain('kiro-cli chat');
    });

    it('seeds existing spec_files into <local_path>/specs', async () => {
      mockProjectStore.getProject.mockReturnValue({
        id: 'proj-1',
        local_path: tmpDir,
        docker_image: 'zephyr/test:latest',
        spec_files: { 'feature.md': '# Existing spec' },
      });

      await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'plan');

      const seeded = await fs.readFile(path.join(tmpDir, 'specs', 'feature.md'), 'utf8');
      expect(seeded).toBe('# Existing spec');
    });

    it('fails when the project has no local path', async () => {
      mockProjectStore.getProject.mockReturnValue({
        id: 'proj-1',
        docker_image: 'zephyr/test:latest',
      });

      const result = await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'plan');

      expect(result.success).toBe(false);
      expect(result.error).toContain('local path');
      expect(mockRuntime.createContainer).not.toHaveBeenCalled();
    });

    it('fails when the project has no container image', async () => {
      mockProjectStore.getProject.mockReturnValue({ id: 'proj-1', local_path: tmpDir });

      const result = await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'plan');

      expect(result.success).toBe(false);
      expect(result.error).toContain('image');
      expect(mockRuntime.createContainer).not.toHaveBeenCalled();
    });

    it('removes the container when attaching the terminal fails', async () => {
      mockTerminalManager.openSession.mockRejectedValue(new Error('exec refused'));

      const result = await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'plan');

      expect(result.success).toBe(false);
      expect(result.error).toBe('exec refused');
      expect(mockRuntime.removeContainer).toHaveBeenCalledWith('container-1', true);
    });
  });

  // ── Close ──────────────────────────────────────────────────────────────────

  describe('agent-session:close (plan)', () => {
    it('tears down the session and writes the specs dir back to the project', async () => {
      await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'plan');
      await fs.writeFile(path.join(tmpDir, 'specs', 'new-feature.md'), '# Drafted', 'utf8');

      const result = await invoke(IPC.AGENT_SESSION_CLOSE, 'session-1');

      expect(result.success).toBe(true);
      expect(result.specFiles).toEqual({ 'new-feature.md': '# Drafted' });
      expect(mockTerminalManager.closeSession).toHaveBeenCalledWith('session-1');
      expect(mockRuntime.removeContainer).toHaveBeenCalledWith('container-1', true);
      expect(mockProjectStore.updateProject).toHaveBeenCalledWith('proj-1', {
        spec_files: { 'new-feature.md': '# Drafted' },
      });
    });

    it('still saves specs when the terminal session already ended', async () => {
      await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'plan');
      mockTerminalManager.closeSession.mockRejectedValue(new Error('Session not found'));
      await fs.writeFile(path.join(tmpDir, 'specs', 'a.md'), 'a', 'utf8');

      const result = await invoke(IPC.AGENT_SESSION_CLOSE, 'session-1');

      expect(result.success).toBe(true);
      expect(result.specFiles).toEqual({ 'a.md': 'a' });
    });

    it('returns an error for an unknown session', async () => {
      const result = await invoke(IPC.AGENT_SESSION_CLOSE, 'nope');

      expect(result.success).toBe(false);
      expect(mockRuntime.removeContainer).not.toHaveBeenCalled();
    });
  });

  // ── Work mode ──────────────────────────────────────────────────────────────

  describe('agent-session:open (work)', () => {
    it('does not seed specs and writes nothing back on close', async () => {
      mockProjectStore.getProject.mockReturnValue({
        id: 'proj-1',
        local_path: tmpDir,
        docker_image: 'zephyr/test:latest',
        spec_files: { 'feature.md': '# Existing spec' },
        hooks: [],
      });

      const opened = await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'work');
      expect(opened.success).toBe(true);
      await expect(fs.access(path.join(tmpDir, 'specs'))).rejects.toThrow();

      const closed = await invoke(IPC.AGENT_SESSION_CLOSE, 'session-1');

      expect(closed.success).toBe(true);
      expect(closed.specFiles).toBeUndefined();
      expect(mockProjectStore.updateProject).not.toHaveBeenCalled();
      expect(mockRuntime.removeContainer).toHaveBeenCalledWith('container-1', true);
    });

    it('mounts the whole project read-write', async () => {
      await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'work');

      const binds: string[] = mockRuntime.createContainer.mock.calls[0][0].binds;
      expect(binds).toContain(`${tmpDir}:/workspace`);
      expect(binds).not.toContain(`${tmpDir}:/workspace:ro`);
      expect(binds.some((b) => b.endsWith(':/workspace/specs'))).toBe(false);
    });

    it('stages the project hooks and settings into the single .claude mount', async () => {
      mockProjectStore.getProject.mockReturnValue({
        id: 'proj-1',
        local_path: tmpDir,
        docker_image: 'zephyr/test:latest',
        spec_files: {},
        hooks: ['notify.sh'],
        claude_settings_file: 'strict.json',
      });
      mockHooksStore.getHook.mockResolvedValue('#!/bin/sh\necho hi\n');
      mockClaudeSettingsStore.getFile.mockResolvedValue('{"permissions":{}}');

      await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'work');

      const binds: string[] = mockRuntime.createContainer.mock.calls[0][0].binds;
      // One mount point: hooks and settings must share the same host directory.
      expect(binds.filter((b) => b.endsWith(':/home/ralph/.claude'))).toHaveLength(1);

      const claudeDir = claudeBindSource();
      expect(claudeDir).toBeDefined();
      expect(await fs.readFile(path.join(claudeDir!, 'hooks', 'notify.sh'), 'utf8')).toContain(
        'echo hi'
      );
      expect(await fs.readFile(path.join(claudeDir!, 'settings.json'), 'utf8')).toBe(
        '{"permissions":{}}'
      );

      await fs.rm(claudeDir!, { recursive: true, force: true });
    });

    it('is refused while a loop is running for the project', async () => {
      mockContainerOrchestrator.listByProject.mockReturnValue([{ status: 'running' }]);

      const result = await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'work');

      expect(result.success).toBe(false);
      expect(result.error).toContain('loop is running');
      expect(mockRuntime.createContainer).not.toHaveBeenCalled();
    });

    it('is allowed when the project only has finished loops', async () => {
      mockContainerOrchestrator.listByProject.mockReturnValue([{ status: 'completed' }]);

      const result = await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'work');

      expect(result.success).toBe(true);
    });

    it('reports an open work session to loop start, and stops once closed', async () => {
      expect(hasActiveWorkSession('proj-1')).toBe(false);

      await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'work');
      expect(hasActiveWorkSession('proj-1')).toBe(true);
      expect(hasActiveWorkSession('other')).toBe(false);

      await invoke(IPC.AGENT_SESSION_CLOSE, 'session-1');
      expect(hasActiveWorkSession('proj-1')).toBe(false);
    });

    it('a plan session does not block loop start', async () => {
      await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'plan');

      expect(hasActiveWorkSession('proj-1')).toBe(false);
    });
  });

  // ── Shutdown ───────────────────────────────────────────────────────────────

  it('the returned disposer cleans up sessions still open at quit', async () => {
    await invoke(IPC.AGENT_SESSION_OPEN, 'proj-1', 'plan');
    await fs.writeFile(path.join(tmpDir, 'specs', 'quit.md'), 'saved on quit', 'utf8');

    await disposer();

    expect(mockRuntime.removeContainer).toHaveBeenCalledWith('container-1', true);
    expect(mockProjectStore.updateProject).toHaveBeenCalledWith('proj-1', {
      spec_files: { 'quit.md': 'saved on quit' },
    });
  });
});
