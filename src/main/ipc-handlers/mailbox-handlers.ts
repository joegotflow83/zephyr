// IPC handlers for the mailbox notification system.
// Registered once during app startup via registerMailboxHandlers().
// All handlers run in the main process and delegate to MailboxStore.

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { MailboxStore } from '../../services/mailbox-store';
import type { MailboxMessage } from '../../shared/mailbox-types';

export interface MailboxServices {
  mailboxStore: MailboxStore;
}

/**
 * Broadcast the current mailbox state to every renderer window.
 *
 * Called after every mutation (markRead, markAllRead, delete) so all open
 * windows stay in sync without polling. The payload carries messages and
 * unreadCount so the renderer can update its cache directly.
 */
export function emitMailboxChanged(mailboxStore: MailboxStore): void {
  const messages = mailboxStore.list();
  const unreadCount = mailboxStore.unreadCount();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.MAILBOX_CHANGED, { messages, unreadCount });
    }
  }
}

export function registerMailboxHandlers(services: MailboxServices): void {
  const { mailboxStore } = services;

  // Return all messages sorted newest-first.
  ipcMain.handle(IPC.MAILBOX_LIST, (): MailboxMessage[] => {
    return mailboxStore.list();
  });

  // Mark a single message as read, then broadcast the updated state.
  ipcMain.handle(IPC.MAILBOX_MARK_READ, (_event, id: string): void => {
    mailboxStore.markRead(id);
    emitMailboxChanged(mailboxStore);
  });

  // Mark all messages as read, then broadcast the updated state.
  ipcMain.handle(IPC.MAILBOX_MARK_ALL_READ, (): void => {
    mailboxStore.markAllRead();
    emitMailboxChanged(mailboxStore);
  });

  // Delete a message by id, then broadcast the updated state.
  ipcMain.handle(IPC.MAILBOX_DELETE, (_event, id: string): void => {
    mailboxStore.delete(id);
    emitMailboxChanged(mailboxStore);
  });
}
