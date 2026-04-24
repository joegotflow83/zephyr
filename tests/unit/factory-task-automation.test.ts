/**
 * Unit tests for factory task automation (Phase 9 — agent-driven task advancement).
 *
 * Tests cover:
 * - mergeTaskStatusHook: adds PostToolUse hook entry to settings JSON
 * - mergeTaskStatusHook: idempotent — no duplicate when hook already present
 * - mergeTaskStatusHook: safe on empty/invalid JSON input
 * - Role-to-column mapping via FORWARD_TRANSITIONS:
 *     pm completes    start        → inprogress
 *     coder completes inprogress   → security
 *     security completes security  → qa
 *     qa completes    qa           → documentation
 *     documentation completes documentation → done
 *
 * Why these tests matter:
 * - mergeTaskStatusHook is injected into agent containers at loop start; a
 *   regression that duplicates or corrupts the hook entry breaks task automation
 *   for every future loop run.
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

import { mergeTaskStatusHook } from '../../src/main/ipc-handlers/loop-handlers';
import { FORWARD_TRANSITIONS } from '../../src/shared/factory-types';

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

// ─── Role → column pipeline mapping ──────────────────────────────────────────
//
// The TASK_STATUS_INSTRUCTIONS markdown (injected into containers) documents
// the following role→stage table. FORWARD_TRANSITIONS must agree with it so
// that agents advance tasks to the correct kanban column.

describe('FORWARD_TRANSITIONS — role-to-column pipeline mapping', () => {
  it('pm completion advances task from start to inprogress', () => {
    // pm signals completion while task is in "Ready" (start) column
    expect(FORWARD_TRANSITIONS['start']).toBe('inprogress');
  });

  it('coder completion advances task from inprogress to security', () => {
    // coder signals completion while task is in "In Progress"
    expect(FORWARD_TRANSITIONS['inprogress']).toBe('security');
  });

  it('security completion advances task from security to qa', () => {
    // security agent signals completion while task is in "Security Review"
    expect(FORWARD_TRANSITIONS['security']).toBe('qa');
  });

  it('qa completion advances task from qa to documentation', () => {
    // qa agent signals completion while task is in "QA"
    expect(FORWARD_TRANSITIONS['qa']).toBe('documentation');
  });

  it('documentation completion advances task from documentation to done', () => {
    // documentation agent signals completion; task reaches terminal "Done" column
    expect(FORWARD_TRANSITIONS['documentation']).toBe('done');
  });

  it('done is the terminal column — no further forward transition', () => {
    // File watcher returns early when FORWARD_TRANSITIONS[task.column] is null
    expect(FORWARD_TRANSITIONS['done']).toBeNull();
  });

  it('backlog advances to start (intake pipeline entry)', () => {
    expect(FORWARD_TRANSITIONS['backlog']).toBe('start');
  });
});
