/**
 * Unit tests for MailboxStore service (Phase 2).
 *
 * Why these tests matter:
 * - MailboxStore is the single source of truth for the user's mailbox. Bugs
 *   here mean lost messages, incorrect unread counts, or UI that shows stale
 *   data after a mark-read or delete.
 * - The atomic write contract (`.tmp` → rename) must hold; this is the only
 *   safeguard against partial-write corruption when the app is killed mid-save.
 * - Sort order (newest-first) is part of the public API consumed by the IPC
 *   layer and the MailboxPanel UI.
 *
 * Strategy: real temp directory + real file IO, mirroring PipelineStore and
 * FactoryTaskStore tests. Fast and gives high confidence without mocking fs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { MailboxStore } from '../../src/services/mailbox-store';
import type { MailboxMessage } from '../../src/shared/mailbox-types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mailbox-store-test-'));
}

function mailboxFilePath(dir: string): string {
  return path.join(dir, 'mailbox.json');
}

function readEnvelope(dir: string): { messages: MailboxMessage[] } {
  return JSON.parse(fs.readFileSync(mailboxFilePath(dir), 'utf-8'));
}

function makeMessage(overrides: Partial<MailboxMessage> = {}): MailboxMessage {
  return {
    id: 'msg-1',
    projectId: 'proj-1',
    projectName: 'Test Project',
    epicTaskId: 'epic-1',
    epicTitle: 'Build the thing',
    read: false,
    createdAt: '2024-01-01T10:00:00.000Z',
    summary: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MailboxStore', () => {
  let tmpDir: string;
  let store: MailboxStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new MailboxStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Construction ──────────────────────────────────────────────────────────

  it('creates the base directory if it does not exist', () => {
    const nested = path.join(tmpDir, 'deep', 'dir');
    new MailboxStore(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('does not create mailbox.json on construction', () => {
    expect(fs.existsSync(mailboxFilePath(tmpDir))).toBe(false);
  });

  // ── list() ────────────────────────────────────────────────────────────────

  it('list() returns empty array when no file exists', () => {
    expect(store.list()).toEqual([]);
  });

  it('list() returns empty array for corrupt file', () => {
    fs.writeFileSync(mailboxFilePath(tmpDir), 'not-json', 'utf-8');
    expect(store.list()).toEqual([]);
  });

  it('list() returns empty array for file with wrong shape', () => {
    fs.writeFileSync(mailboxFilePath(tmpDir), JSON.stringify({ wrong: true }), 'utf-8');
    expect(store.list()).toEqual([]);
  });

  it('list() returns messages sorted by createdAt descending', () => {
    const older = makeMessage({ id: 'a', createdAt: '2024-01-01T10:00:00.000Z' });
    const newer = makeMessage({ id: 'b', createdAt: '2024-06-01T10:00:00.000Z' });
    store.add(older);
    store.add(newer);
    const result = store.list();
    expect(result[0].id).toBe('b');
    expect(result[1].id).toBe('a');
  });

  // ── add() ─────────────────────────────────────────────────────────────────

  it('add() persists a message to disk', () => {
    const msg = makeMessage();
    store.add(msg);
    const envelope = readEnvelope(tmpDir);
    expect(envelope.messages).toHaveLength(1);
    expect(envelope.messages[0].id).toBe('msg-1');
  });

  it('add() appends without overwriting existing messages', () => {
    store.add(makeMessage({ id: 'a' }));
    store.add(makeMessage({ id: 'b' }));
    const envelope = readEnvelope(tmpDir);
    expect(envelope.messages).toHaveLength(2);
  });

  it('add() preserves all fields including optional suggestions', () => {
    const msg = makeMessage({
      summary: [{ stageId: 's1', stageName: 'Stage 1', actor: 'agent', content: 'note', createdAt: '2024-01-01T10:00:00.000Z' }],
      suggestions: '## Suggestions\n- Do foo',
    });
    store.add(msg);
    const result = store.list();
    expect(result[0].summary).toHaveLength(1);
    expect(result[0].suggestions).toBe('## Suggestions\n- Do foo');
  });

  // ── markRead() ────────────────────────────────────────────────────────────

  it('markRead() sets read: true on matching message', () => {
    store.add(makeMessage({ id: 'a', read: false }));
    store.markRead('a');
    const result = store.list();
    expect(result[0].read).toBe(true);
  });

  it('markRead() is a no-op for unknown id', () => {
    store.add(makeMessage({ id: 'a' }));
    expect(() => store.markRead('nonexistent')).not.toThrow();
    expect(store.list()[0].read).toBe(false);
  });

  it('markRead() does not affect other messages', () => {
    store.add(makeMessage({ id: 'a', read: false }));
    store.add(makeMessage({ id: 'b', read: false }));
    store.markRead('a');
    const byId = Object.fromEntries(store.list().map((m) => [m.id, m]));
    expect(byId['a'].read).toBe(true);
    expect(byId['b'].read).toBe(false);
  });

  // ── markAllRead() ─────────────────────────────────────────────────────────

  it('markAllRead() sets read: true on all messages', () => {
    store.add(makeMessage({ id: 'a', read: false }));
    store.add(makeMessage({ id: 'b', read: false }));
    store.markAllRead();
    const result = store.list();
    expect(result.every((m) => m.read)).toBe(true);
  });

  it('markAllRead() is a no-op when all messages already read', () => {
    store.add(makeMessage({ id: 'a', read: true }));
    const before = fs.statSync(mailboxFilePath(tmpDir)).mtimeMs;
    // Small sleep to detect write via mtime change
    store.markAllRead();
    const after = fs.statSync(mailboxFilePath(tmpDir)).mtimeMs;
    // No write should have occurred (mtime unchanged or within ms precision)
    expect(after).toBe(before);
  });

  // ── delete() ──────────────────────────────────────────────────────────────

  it('delete() removes the matching message', () => {
    store.add(makeMessage({ id: 'a' }));
    store.add(makeMessage({ id: 'b' }));
    store.delete('a');
    const result = store.list();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('delete() is a no-op for unknown id', () => {
    store.add(makeMessage({ id: 'a' }));
    expect(() => store.delete('nonexistent')).not.toThrow();
    expect(store.list()).toHaveLength(1);
  });

  // ── unreadCount() ─────────────────────────────────────────────────────────

  it('unreadCount() returns 0 when no messages', () => {
    expect(store.unreadCount()).toBe(0);
  });

  it('unreadCount() returns correct count', () => {
    store.add(makeMessage({ id: 'a', read: false }));
    store.add(makeMessage({ id: 'b', read: true }));
    store.add(makeMessage({ id: 'c', read: false }));
    expect(store.unreadCount()).toBe(2);
  });

  it('unreadCount() decrements after markRead', () => {
    store.add(makeMessage({ id: 'a', read: false }));
    store.add(makeMessage({ id: 'b', read: false }));
    expect(store.unreadCount()).toBe(2);
    store.markRead('a');
    expect(store.unreadCount()).toBe(1);
  });

  it('unreadCount() returns 0 after markAllRead', () => {
    store.add(makeMessage({ id: 'a', read: false }));
    store.add(makeMessage({ id: 'b', read: false }));
    store.markAllRead();
    expect(store.unreadCount()).toBe(0);
  });

  // ── Atomic write ──────────────────────────────────────────────────────────

  it('does not leave a .tmp file after successful write', () => {
    store.add(makeMessage());
    expect(fs.existsSync(`${mailboxFilePath(tmpDir)}.tmp`)).toBe(false);
  });
});
