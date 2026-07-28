import React, { useState } from 'react';
import { useAppStore } from '../../stores/app-store';
import type { MailboxMessage } from '../../../shared/mailbox-types';
import type { TaskNote } from '../../../shared/factory-types';

export interface MailboxPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional: called when the user clicks "Create task from suggestion". */
  onCreateTaskFromSuggestion?: (description: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return isoString;
  }
}

function groupNotesByStage(notes: TaskNote[]): [string, TaskNote[]][] {
  const map = new Map<string, TaskNote[]>();
  for (const note of notes) {
    const list = map.get(note.stage) ?? [];
    list.push(note);
    map.set(note.stage, list);
  }
  return Array.from(map.entries());
}

/**
 * Very small Markdown → safe HTML converter for the suggestions field.
 * Escapes raw HTML first, then applies a limited set of Markdown patterns.
 * This avoids a heavy dependency while keeping the output readable.
 */
function renderMarkdown(md: string): string {
  // 1. Escape HTML entities
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // 2. Apply Markdown patterns line-by-line
  const lines = escaped.split('\n');
  const output: string[] = [];
  let inList = false;

  for (const raw of lines) {
    const line = raw;

    // Headings
    if (/^### /.test(line)) {
      if (inList) {
        output.push('</ul>');
        inList = false;
      }
      output.push(
        `<h3 class="text-sm font-bold mt-3 mb-1 text-gray-800 dark:text-gray-200">${line.slice(4)}</h3>`
      );
      continue;
    }
    if (/^## /.test(line)) {
      if (inList) {
        output.push('</ul>');
        inList = false;
      }
      output.push(
        `<h2 class="text-sm font-bold mt-3 mb-1 text-gray-800 dark:text-gray-200">${line.slice(3)}</h2>`
      );
      continue;
    }
    if (/^# /.test(line)) {
      if (inList) {
        output.push('</ul>');
        inList = false;
      }
      output.push(
        `<h1 class="text-base font-bold mt-3 mb-1 text-gray-800 dark:text-gray-200">${line.slice(2)}</h1>`
      );
      continue;
    }

    // Unordered list items
    if (/^[-*] /.test(line)) {
      if (!inList) {
        output.push('<ul class="list-disc list-inside space-y-0.5 my-1">');
        inList = true;
      }
      const content = applyInline(line.slice(2));
      output.push(`<li>${content}</li>`);
      continue;
    }

    // Non-list line — close list if open
    if (inList) {
      output.push('</ul>');
      inList = false;
    }

    // Blank line → paragraph break
    if (line.trim() === '') {
      output.push('<br>');
      continue;
    }

    output.push(`<p class="my-0.5">${applyInline(line)}</p>`);
  }

  if (inList) output.push('</ul>');
  return output.join('\n');
}

function applyInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(
      /`(.+?)`/g,
      '<code class="px-1 bg-gray-100 dark:bg-gray-700 rounded text-xs font-mono">$1</code>'
    );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface MessageRowProps {
  message: MailboxMessage;
  selected: boolean;
  onClick: () => void;
}

const MessageRow: React.FC<MessageRowProps> = ({ message, selected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full text-left px-4 py-3 border-b border-gray-200 dark:border-gray-700 transition-colors ${
      selected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
    }`}
  >
    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{message.projectName}</div>
    <div
      className={`text-sm mt-0.5 truncate flex items-center gap-1.5 ${
        !message.read
          ? 'font-semibold text-gray-900 dark:text-white'
          : 'font-normal text-gray-700 dark:text-gray-300'
      }`}
    >
      {!message.read && (
        <span
          className="inline-block w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"
          aria-label="Unread"
        />
      )}
      <span className="truncate">{message.epicTitle}</span>
    </div>
    <div className="text-xs text-gray-400 mt-0.5">{formatRelativeTime(message.createdAt)}</div>
  </button>
);

interface MessageDetailProps {
  message: MailboxMessage;
  onDelete: () => void;
  onCreateTaskFromSuggestion?: (description: string) => void;
}

const MessageDetail: React.FC<MessageDetailProps> = ({
  message,
  onDelete,
  onCreateTaskFromSuggestion,
}) => {
  const stageGroups = groupNotesByStage(message.summary);

  return (
    <div className="p-4 overflow-y-auto h-full">
      {/* Message header */}
      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0 flex-1 mr-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">{message.projectName}</div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mt-0.5 break-words">
            {message.epicTitle}
          </h3>
          <div className="text-xs text-gray-400 mt-0.5">
            {formatRelativeTime(message.createdAt)}
          </div>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="flex-shrink-0 text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors"
        >
          Delete
        </button>
      </div>

      {/* Stage summary notes */}
      {stageGroups.length > 0 && (
        <section className="mb-5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            Stage Summary
          </h4>
          <div className="space-y-1.5">
            {stageGroups.map(([stage, notes]) => (
              <details
                key={stage}
                className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden"
              >
                <summary className="px-3 py-2 cursor-pointer text-xs font-medium text-gray-700 dark:text-gray-300 select-none hover:bg-gray-50 dark:hover:bg-gray-800">
                  {stage}
                  <span className="ml-1.5 text-gray-400">({notes.length})</span>
                </summary>
                <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 space-y-3">
                  {notes.map((note, i) => (
                    <div key={i}>
                      <div className="text-xs text-gray-400 mb-1">
                        {[note.actor, new Date(note.timestamp).toLocaleString()]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                      <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-sans leading-relaxed">
                        {note.content}
                      </pre>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Suggestions from debrief stage */}
      {message.suggestions && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            Suggestions
          </h4>
          <div
            className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed"
            // suggestions come from a local agent — not external user input;
            // HTML is generated by our own renderMarkdown() which escapes raw HTML first.
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.suggestions) }}
          />
          {onCreateTaskFromSuggestion && (
            <button
              type="button"
              onClick={() => onCreateTaskFromSuggestion(message.suggestions ?? '')}
              className="mt-3 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
            >
              Create task from suggestion
            </button>
          )}
        </section>
      )}

      {/* Empty state for messages with no content */}
      {stageGroups.length === 0 && !message.suggestions && (
        <p className="text-sm text-gray-400 italic">No details available for this message.</p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const MailboxPanel: React.FC<MailboxPanelProps> = ({
  isOpen,
  onClose,
  onCreateTaskFromSuggestion,
}) => {
  const mailboxMessages = useAppStore((s) => s.mailboxMessages);
  const markMailboxRead = useAppStore((s) => s.markMailboxRead);
  const markAllMailboxRead = useAppStore((s) => s.markAllMailboxRead);
  const deleteMailboxMessage = useAppStore((s) => s.deleteMailboxMessage);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedMessage = selectedId
    ? (mailboxMessages.find((m) => m.id === selectedId) ?? null)
    : null;

  const hasUnread = mailboxMessages.some((m) => !m.read);

  const handleSelectMessage = async (msg: MailboxMessage) => {
    setSelectedId(msg.id);
    if (!msg.read) {
      await markMailboxRead(msg.id);
    }
  };

  const handleDelete = async (id: string) => {
    if (selectedId === id) setSelectedId(null);
    await deleteMailboxMessage(id);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Mailbox"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sliding panel */}
      <div className="relative flex flex-col w-full max-w-2xl bg-white dark:bg-gray-900 shadow-2xl h-full">
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Mailbox</h2>
          <div className="flex items-center gap-3">
            {hasUnread && (
              <button
                type="button"
                onClick={() => void markAllMailboxRead()}
                className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-400 transition-colors"
              >
                Mark All Read
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              aria-label="Close mailbox"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Body: list + detail */}
        <div className="flex flex-1 overflow-hidden">
          {/* Message list */}
          <div className="w-2/5 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
            {mailboxMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-2 p-4">
                <svg
                  className="w-8 h-8 opacity-40"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                <span>No messages</span>
              </div>
            ) : (
              mailboxMessages.map((msg) => (
                <MessageRow
                  key={msg.id}
                  message={msg}
                  selected={selectedId === msg.id}
                  onClick={() => void handleSelectMessage(msg)}
                />
              ))
            )}
          </div>

          {/* Detail pane */}
          <div className="flex-1 overflow-hidden">
            {selectedMessage ? (
              <MessageDetail
                message={selectedMessage}
                onDelete={() => void handleDelete(selectedMessage.id)}
                onCreateTaskFromSuggestion={onCreateTaskFromSuggestion}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-gray-400">
                Select a message to view
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
