/**
 * MailboxStore — persistent storage for mailbox messages.
 *
 * Messages live in a single JSON file at `<basePath>/mailbox.json` (typically
 * `~/.zephyr/mailbox.json`). A message is created when an epic completes its
 * pipeline run (via FactoryTaskStore) and surfaces in the MailboxPanel UI so
 * the user can review what was done and any follow-up suggestions from a
 * debrief stage.
 *
 * Atomic writes mirror the PipelineStore / FactoryTaskStore pattern: serialise
 * to a `.tmp` file first, then atomically rename over the destination to avoid
 * partial-write corruption if the app is killed mid-write.
 *
 * The store is deliberately stateless (no in-memory cache): every read hits
 * disk. The file is tiny and IPC callers broadcast `MAILBOX_CHANGED` after
 * every mutation so renderers invalidate their own caches.
 */

import fs from 'fs';
import path from 'path';

import type { MailboxMessage } from '../shared/mailbox-types';

const FILE_NAME = 'mailbox.json';

/** On-disk envelope. */
interface MailboxFile {
  messages: MailboxMessage[];
}

export class MailboxStore {
  private readonly basePath: string;

  /**
   * @param basePath - Directory that holds `mailbox.json`. Typically
   *   `~/.zephyr/`. Tests pass a temp dir for isolation.
   */
  constructor(basePath: string) {
    this.basePath = basePath;
    fs.mkdirSync(this.basePath, { recursive: true });
  }

  private filePath(): string {
    return path.join(this.basePath, FILE_NAME);
  }

  /**
   * Read and parse `mailbox.json`. Returns an empty array if the file is
   * missing or corrupt so the store self-heals on first use.
   */
  private load(): MailboxMessage[] {
    try {
      const text = fs.readFileSync(this.filePath(), 'utf-8');
      const parsed = JSON.parse(text) as MailboxFile;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.messages)) {
        return [];
      }
      return parsed.messages;
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return [];
      }
      // eslint-disable-next-line no-console
      console.warn('[MailboxStore] Failed to load mailbox.json, returning empty:', err);
      return [];
    }
  }

  /**
   * Atomically write the message list to disk (`.tmp` → rename).
   */
  private save(messages: MailboxMessage[]): void {
    fs.mkdirSync(this.basePath, { recursive: true });
    const dest = this.filePath();
    const tmp = `${dest}.tmp`;
    const envelope: MailboxFile = { messages };
    try {
      fs.writeFileSync(tmp, JSON.stringify(envelope, null, 2), 'utf-8');
      fs.renameSync(tmp, dest);
    } catch (err) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // Ignore cleanup errors.
      }
      throw err;
    }
  }

  /**
   * Return all messages sorted by `createdAt` descending (newest first).
   */
  list(): MailboxMessage[] {
    const messages = this.load();
    return messages.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Append a new message and persist.
   */
  add(msg: MailboxMessage): void {
    const messages = this.load();
    messages.push(msg);
    this.save(messages);
  }

  /**
   * Mark a single message as read by id. No-op if the id is not found.
   */
  markRead(id: string): void {
    const messages = this.load();
    const msg = messages.find((m) => m.id === id);
    if (msg) {
      msg.read = true;
      this.save(messages);
    }
  }

  /**
   * Mark all messages as read.
   */
  markAllRead(): void {
    const messages = this.load();
    let changed = false;
    for (const msg of messages) {
      if (!msg.read) {
        msg.read = true;
        changed = true;
      }
    }
    if (changed) {
      this.save(messages);
    }
  }

  /**
   * Delete a message by id. No-op if the id is not found.
   */
  delete(id: string): void {
    const messages = this.load();
    const idx = messages.findIndex((m) => m.id === id);
    if (idx !== -1) {
      messages.splice(idx, 1);
      this.save(messages);
    }
  }

  /**
   * Return the count of unread messages.
   */
  unreadCount(): number {
    const messages = this.load();
    return messages.filter((m) => !m.read).length;
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
