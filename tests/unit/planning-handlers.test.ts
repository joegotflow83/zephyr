/**
 * Unit tests for src/main/ipc-handlers/planning-handlers.ts
 *
 * A planning session is a throwaway container running the configured LLM engine
 * with the project mounted at /workspace, used to draft spec files. These tests
 * cover the contract that matters:
 *
 * - PLANNING_OPEN seeds ProjectConfig.spec_files into <local_path>/specs,
 *   creates + starts a container, and attaches a terminal to the right engine
 * - a failed attach never leaves a container behind
 * - PLANNING_CLOSE removes the container and writes the specs directory back
 *   into ProjectConfig.spec_files (the store stays the source of truth)
 * - the returned disposer cleans up sessions still open at quit
 *
 * The filesystem is real (a temp dir per test) because the spec round-trip is
 * the whole point of the feature; only the container runtime is mocked.
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

import { registerPlanningHandlers } from '../../src/main/ipc-handlers/planning-handlers';

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

function register(): () => Promise<void> {
  return registerPlanningHandlers({
    runtime: mockRuntime as never,
    terminalManager: mockTerminalManager as never,
    projectStore: mockProjectStore as never,
    configManager: mockConfigManager as never,
    authInjector: mockAuthInjector as never,
    credentialManager: mockCredentialManager as never,
  });
}

describe('registerPlanningHandlers', () => {
  let tmpDir: string;
  let disposer: () => Promise<void>;

  beforeEach(async () => {
    vi.resetAllMocks();
    for (const key of Object.keys(handlerRegistry)) delete handlerRegistry[key];

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zephyr-planning-test-'));

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
    mockProjectStore.getProject.mockReturnValue({
      id: 'proj-1',
      name: 'Test Project',
      local_path: tmpDir,
      docker_image: 'zephyr/test:latest',
      spec_files: {},
    });

    disposer = register();
  });

  afterEach(async () => {
    // Drop any session the test left open so state does not leak between tests.
    await disposer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Open ───────────────────────────────────────────────────────────────────

  describe('planning:open', () => {
    it('creates a throwaway container and attaches a terminal to the engine', async () => {
      const result = await invoke(IPC.PLANNING_OPEN, 'proj-1', { rows: 40, cols: 120 });

      expect(result.success).toBe(true);
      expect(result.session).toEqual({ id: 'session-1' });

      const createOpts = mockRuntime.createContainer.mock.calls[0][0];
      expect(createOpts.image).toBe('zephyr/test:latest');
      expect(createOpts.command).toEqual(['sleep', 'infinity']);
      expect(createOpts.autoRemove).toBe(true);
      expect(createOpts.workingDir).toBe('/workspace');
      expect(createOpts.binds).toContain(`${tmpDir}:/workspace`);
      expect(mockRuntime.startContainer).toHaveBeenCalledWith('container-1');

      const [containerId, sessionOpts] = mockTerminalManager.openSession.mock.calls[0];
      expect(containerId).toBe('container-1');
      expect(sessionOpts.rows).toBe(40);
      expect(sessionOpts.cols).toBe(120);
      expect(sessionOpts.command[0]).toBe('bash');
      expect(sessionOpts.command[2]).toContain('claude');
    });

    it('launches kiro-cli when the configured provider is kiro', async () => {
      mockConfigManager.loadJson.mockReturnValue({ llm_provider: 'kiro' });

      await invoke(IPC.PLANNING_OPEN, 'proj-1');

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

      await invoke(IPC.PLANNING_OPEN, 'proj-1');

      const seeded = await fs.readFile(path.join(tmpDir, 'specs', 'feature.md'), 'utf8');
      expect(seeded).toBe('# Existing spec');
    });

    it('fails when the project has no local path', async () => {
      mockProjectStore.getProject.mockReturnValue({
        id: 'proj-1',
        docker_image: 'zephyr/test:latest',
      });

      const result = await invoke(IPC.PLANNING_OPEN, 'proj-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('local path');
      expect(mockRuntime.createContainer).not.toHaveBeenCalled();
    });

    it('fails when the project has no container image', async () => {
      mockProjectStore.getProject.mockReturnValue({ id: 'proj-1', local_path: tmpDir });

      const result = await invoke(IPC.PLANNING_OPEN, 'proj-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('image');
      expect(mockRuntime.createContainer).not.toHaveBeenCalled();
    });

    it('removes the container when attaching the terminal fails', async () => {
      mockTerminalManager.openSession.mockRejectedValue(new Error('exec refused'));

      const result = await invoke(IPC.PLANNING_OPEN, 'proj-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('exec refused');
      expect(mockRuntime.removeContainer).toHaveBeenCalledWith('container-1', true);
    });
  });

  // ── Close ──────────────────────────────────────────────────────────────────

  describe('planning:close', () => {
    it('tears down the session and writes the specs dir back to the project', async () => {
      await invoke(IPC.PLANNING_OPEN, 'proj-1');
      await fs.writeFile(path.join(tmpDir, 'specs', 'new-feature.md'), '# Drafted', 'utf8');

      const result = await invoke(IPC.PLANNING_CLOSE, 'session-1');

      expect(result.success).toBe(true);
      expect(result.specFiles).toEqual({ 'new-feature.md': '# Drafted' });
      expect(mockTerminalManager.closeSession).toHaveBeenCalledWith('session-1');
      expect(mockRuntime.removeContainer).toHaveBeenCalledWith('container-1', true);
      expect(mockProjectStore.updateProject).toHaveBeenCalledWith('proj-1', {
        spec_files: { 'new-feature.md': '# Drafted' },
      });
    });

    it('still saves specs when the terminal session already ended', async () => {
      await invoke(IPC.PLANNING_OPEN, 'proj-1');
      mockTerminalManager.closeSession.mockRejectedValue(new Error('Session not found'));
      await fs.writeFile(path.join(tmpDir, 'specs', 'a.md'), 'a', 'utf8');

      const result = await invoke(IPC.PLANNING_CLOSE, 'session-1');

      expect(result.success).toBe(true);
      expect(result.specFiles).toEqual({ 'a.md': 'a' });
    });

    it('returns an error for an unknown session', async () => {
      const result = await invoke(IPC.PLANNING_CLOSE, 'nope');

      expect(result.success).toBe(false);
      expect(mockRuntime.removeContainer).not.toHaveBeenCalled();
    });
  });

  // ── Shutdown ───────────────────────────────────────────────────────────────

  it('the returned disposer cleans up sessions still open at quit', async () => {
    await invoke(IPC.PLANNING_OPEN, 'proj-1');
    await fs.writeFile(path.join(tmpDir, 'specs', 'quit.md'), 'saved on quit', 'utf8');

    await disposer();

    expect(mockRuntime.removeContainer).toHaveBeenCalledWith('container-1', true);
    expect(mockProjectStore.updateProject).toHaveBeenCalledWith('proj-1', {
      spec_files: { 'quit.md': 'saved on quit' },
    });
  });
});
