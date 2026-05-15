/**
 * Types for the mailbox / notification system.
 *
 * When an epic completes its pipeline run (including an optional debrief
 * stage), a {@link MailboxMessage} is written to the persistent mailbox store
 * so the user can review what was done and any follow-up suggestions.
 *
 * Shared between main process (MailboxStore, IPC handlers) and renderer
 * (app store, MailboxPanel UI). Keep free of runtime imports.
 */

import type { TaskNote } from './factory-types';

/**
 * A single message in the user's mailbox, produced when an epic finishes its
 * pipeline run.
 */
export interface MailboxMessage {
  /** UUID v4 identifier. */
  id: string;
  /** ID of the project this epic belonged to. */
  projectId: string;
  /**
   * Human-readable project name — denormalized so the mailbox panel needs no
   * project lookup at read time.
   */
  projectName: string;
  /** ID of the epic task that completed. */
  epicTaskId: string;
  /** Display title of the epic. */
  epicTitle: string;
  /** Whether the user has opened this message. */
  read: boolean;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /**
   * Rolled-up notes from all child tasks that passed through non-debrief
   * stages. Each entry preserves the original stage, actor, and timestamp so
   * the panel can group them by stage.
   */
  summary: TaskNote[];
  /**
   * Markdown content produced by the debrief stage agent. Present only when
   * the pipeline had a stage with `role === 'debrief'` and that stage wrote
   * at least one note. Omitted otherwise.
   */
  suggestions?: string;
}
