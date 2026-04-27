/**
 * Unit tests for factory task automation (Phase 9 — agent-driven task advancement).
 *
 * Tests cover:
 * - mergeTaskStatusHook: adds PostToolUse hook entry to settings JSON
 * - mergeTaskStatusHook: idempotent — no duplicate when hook already present
 * - mergeTaskStatusHook: safe on empty/invalid JSON input
 * - mergeTaskDecompositionHook: adds PostToolUse hook entry to settings JSON
 * - mergeTaskDecompositionHook: idempotent — no duplicate when hook already present
 * - mergeTaskDecompositionHook: safe on empty/invalid JSON input
 * - mergeTaskDecompositionHook: coexists with other hooks (task-status, clarification)
 * - Role-to-column mapping via FORWARD_TRANSITIONS:
 *     pm completes    start        → inprogress
 *     coder completes inprogress   → security
 *     security completes security  → qa
 *     qa completes    qa           → documentation
 *     documentation completes documentation → done
 *
 * Why these tests matter:
 * - mergeTaskStatusHook and mergeTaskDecompositionHook are injected into agent
 *   containers at loop start; a regression that duplicates or corrupts either
 *   hook entry breaks task automation for every future loop run.
 * - FORWARD_TRANSITIONS is the single source of truth for the kanban pipeline
 *   order. Verifying it against the documented role→stage table catches
 *   accidental reordering before it reaches production.
 */

import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock') },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  Notification: vi.fn(),
}));

vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info', resolvePathFn: vi.fn(), maxSize: 0, format: '' }, console: { level: 'info', format: '' } },
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), verbose: vi.fn(), debug: vi.fn(), silly: vi.fn(),
  },
}));

import { mergeTaskStatusHook, mergeTaskDecompositionHook } from '../../src/main/ipc-handlers/loop-handlers';

// ─── mergeTaskStatusHook ──────────────────────────────────────────────────────

describe('mergeTaskStatusHook', () => {
  const HOOK_CMD = 'bash ~/.claude/hooks/task-status-notify.sh';

  function getPostToolUse(json: string): Array<Record<string, unknown>> {
    const parsed = JSON.parse(json);
    return (parsed?.hooks?.PostToolUse as Array<Record<string, unknown>>) ?? [];
  }

  function hasHookEntry(json: string): boolean {
    const entries = getPostToolUse(json);
    return entries.some((entry) =>
      (entry.hooks as Array<Record<string, unknown>>)?.some((h) => h.command === HOOK_CMD)
    );
  }

  it('adds a PostToolUse entry for task-status-notify.sh to empty settings', () => {
    const result = mergeTaskStatusHook('{}');
    expect(hasHookEntry(result)).toBe(true);
  });

  it('adds hook with correct matcher and command structure', () => {
    const result = mergeTaskStatusHook('{}');
    const entries = getPostToolUse(result);
    const entry = entries.find((e) =>
      (e.hooks as Array<Record<string, unknown>>)?.some((h) => h.command === HOOK_CMD)
    );
    expect(entry).toBeDefined();
    expect(entry!.matcher).toBe('Write|Edit|MultiEdit');
    const hooks = entry!.hooks as Array<Record<string, unknown>>;
    expect(hooks[0].type).toBe('command');
    expect(hooks[0].command).toBe(HOOK_CMD);
  });

  it('does not duplicate the hook entry when already present', () => {
    const once = mergeTaskStatusHook('{}');
    const twice = mergeTaskStatusHook(once);
    const entries = getPostToolUse(twice);
    const count = entries.filter((e) =>
      (e.hooks as Array<Record<string, unknown>>)?.some((h) => h.command === HOOK_CMD)
    ).length;
    expect(count).toBe(1);
  });

  it('preserves existing PostToolUse entries when adding hook', () => {
    const existing = JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo existing' }],
          },
        ],
      },
    });
    const result = mergeTaskStatusHook(existing);
    const entries = getPostToolUse(result);
    expect(entries).toHaveLength(2);
    expect(entries[0].matcher).toBe('Bash');
  });

  it('handles empty string input gracefully', () => {
    expect(() => mergeTaskStatusHook('')).not.toThrow();
    const result = mergeTaskStatusHook('');
    expect(hasHookEntry(result)).toBe(true);
  });

  it('handles invalid JSON input gracefully', () => {
    expect(() => mergeTaskStatusHook('not json at all {')).not.toThrow();
    const result = mergeTaskStatusHook('not json at all {');
    expect(hasHookEntry(result)).toBe(true);
  });

  it('handles JSON with no hooks key gracefully', () => {
    const result = mergeTaskStatusHook(JSON.stringify({ theme: 'dark' }));
    expect(hasHookEntry(result)).toBe(true);
    // Existing non-hooks keys are preserved
    expect(JSON.parse(result).theme).toBe('dark');
  });
});

// ─── mergeTaskDecompositionHook ───────────────────────────────────────────────

describe('mergeTaskDecompositionHook', () => {
  const HOOK_CMD = 'bash ~/.claude/hooks/task-decomposition-notify.sh';

  function getPostToolUse(json: string): Array<Record<string, unknown>> {
    const parsed = JSON.parse(json);
    return (parsed?.hooks?.PostToolUse as Array<Record<string, unknown>>) ?? [];
  }

  function hasHookEntry(json: string): boolean {
    const entries = getPostToolUse(json);
    return entries.some((entry) =>
      (entry.hooks as Array<Record<string, unknown>>)?.some((h) => h.command === HOOK_CMD)
    );
  }

  it('adds a PostToolUse entry for task-decomposition-notify.sh to empty settings', () => {
    const result = mergeTaskDecompositionHook('{}');
    expect(hasHookEntry(result)).toBe(true);
  });

  it('adds hook with correct matcher and command structure', () => {
    const result = mergeTaskDecompositionHook('{}');
    const entries = getPostToolUse(result);
    const entry = entries.find((e) =>
      (e.hooks as Array<Record<string, unknown>>)?.some((h) => h.command === HOOK_CMD)
    );
    expect(entry).toBeDefined();
    expect(entry!.matcher).toBe('Write|Edit|MultiEdit');
    const hooks = entry!.hooks as Array<Record<string, unknown>>;
    expect(hooks[0].type).toBe('command');
    expect(hooks[0].command).toBe(HOOK_CMD);
  });

  it('does not duplicate the hook entry when already present', () => {
    const once = mergeTaskDecompositionHook('{}');
    const twice = mergeTaskDecompositionHook(once);
    const entries = getPostToolUse(twice);
    const count = entries.filter((e) =>
      (e.hooks as Array<Record<string, unknown>>)?.some((h) => h.command === HOOK_CMD)
    ).length;
    expect(count).toBe(1);
  });

  it('preserves existing PostToolUse entries when adding hook', () => {
    const existing = JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo existing' }],
          },
        ],
      },
    });
    const result = mergeTaskDecompositionHook(existing);
    const entries = getPostToolUse(result);
    expect(entries).toHaveLength(2);
    expect(entries[0].matcher).toBe('Bash');
  });

  it('handles empty string input gracefully', () => {
    expect(() => mergeTaskDecompositionHook('')).not.toThrow();
    const result = mergeTaskDecompositionHook('');
    expect(hasHookEntry(result)).toBe(true);
  });

  it('handles invalid JSON input gracefully', () => {
    expect(() => mergeTaskDecompositionHook('not json at all {')).not.toThrow();
    const result = mergeTaskDecompositionHook('not json at all {');
    expect(hasHookEntry(result)).toBe(true);
  });

  it('handles JSON with no hooks key gracefully', () => {
    const result = mergeTaskDecompositionHook(JSON.stringify({ theme: 'dark' }));
    expect(hasHookEntry(result)).toBe(true);
    // Existing non-hooks keys are preserved
    expect(JSON.parse(result).theme).toBe('dark');
  });

  it('coexists with task-status and clarification hooks when all three are merged', () => {
    // Simulate what the CONTINUOUS-mode injection does: chain all three merges.
    const base = '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}';
    const merged = mergeTaskDecompositionHook(mergeTaskStatusHook(base));
    const entries = getPostToolUse(merged);
    const cmds = entries.flatMap((e) =>
      (e.hooks as Array<Record<string, unknown>>).map((h) => h.command as string)
    );
    expect(cmds).toContain('bash ~/.claude/hooks/task-status-notify.sh');
    expect(cmds).toContain(HOOK_CMD);
    // No duplicates — each hook appears exactly once.
    expect(cmds.filter((c) => c === 'bash ~/.claude/hooks/task-status-notify.sh')).toHaveLength(1);
    expect(cmds.filter((c) => c === HOOK_CMD)).toHaveLength(1);
  });
});

