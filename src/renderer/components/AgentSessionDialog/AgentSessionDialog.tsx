import React, { useState, useEffect, useCallback, useRef } from 'react';

import { Terminal, TerminalHandle } from '../Terminal/Terminal';
import { useAppStore } from '../../stores/app-store';
import { logger } from '../../utils/logger';
import type { ProjectConfig } from '../../../shared/models';

interface AgentSessionDialogProps {
  project: ProjectConfig;
  /** 'plan' drafts spec files; 'work' edits the project directly. */
  mode: 'plan' | 'work';
  /** Called after the session is closed; receives spec files in plan mode. */
  onClose: (specFiles?: Record<string, string>) => void;
}

/**
 * Full-screen modal hosting an interactive chat with the configured LLM engine,
 * running inside a throwaway container with the project mounted at /workspace.
 *
 * In 'plan' mode the project is mounted read-only and only /workspace/specs is
 * writable; the specs are read back into ProjectConfig.spec_files on close, so
 * the store stays the source of truth and the code itself cannot be touched. In
 * 'work' mode the agent edits the project itself; the bind mount writes through
 * to the host, so there is nothing to read back.
 */
export const AgentSessionDialog: React.FC<AgentSessionDialogProps> = ({
  project,
  mode,
  onClose,
}) => {
  const isPlan = mode === 'plan';
  const { settings } = useAppStore();
  const theme = settings?.theme === 'light' ? 'light' : 'dark';
  const engineLabel = settings?.llm_provider === 'kiro' ? 'Kiro' : 'Claude Code';

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'starting' | 'running' | 'ended' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const terminalRef = useRef<TerminalHandle>(null);
  // Read inside IPC listeners so they can register once and still see the
  // current session without re-subscribing on every state change.
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;

  // Start the session once, on mount.
  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      const result = await window.api.agentSession.open(project.id, mode, { rows: 24, cols: 80 });
      if (cancelled) {
        // The dialog closed while the container was starting — do not leak it.
        if (result.success && result.session) {
          void window.api.agentSession.close(result.session.id);
        }
        return;
      }
      if (!result.success || !result.session) {
        setError(result.error ?? 'Failed to start the session');
        setStatus('error');
        return;
      }
      setSessionId(result.session.id);
      setStatus('running');
      setTimeout(() => terminalRef.current?.focus(), 0);
    };

    void start().catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    });

    return () => {
      cancelled = true;
    };
  }, [project.id, mode]);

  // Agent sessions reuse the terminal:* streams, so filter by session ID.
  useEffect(() => {
    const offData = window.api.terminal.onData((id, data) => {
      if (id === sessionIdRef.current) terminalRef.current?.write(data);
    });
    const offClosed = window.api.terminal.onClosed((id) => {
      if (id === sessionIdRef.current) setStatus('ended');
    });
    const offError = window.api.terminal.onError((id, message) => {
      if (id !== sessionIdRef.current) return;
      setError(message);
      setStatus('error');
    });
    return () => {
      offData();
      offClosed();
      offError();
    };
  }, []);

  const handleData = useCallback((data: string) => {
    if (sessionIdRef.current) window.api.terminal.write(sessionIdRef.current, data);
  }, []);

  const handleResize = useCallback((cols: number, rows: number) => {
    if (sessionIdRef.current) {
      void window.api.terminal.resize(sessionIdRef.current, cols, rows);
    }
  }, []);

  // Ends the session, removes the container, and reports any spec files back.
  const handleClose = useCallback(async () => {
    if (closing) return;
    if (!sessionId) {
      onClose();
      return;
    }
    setClosing(true);
    try {
      const result = await window.api.agentSession.close(sessionId);
      if (!result.success) {
        logger.error('Failed to close agent session', result.error);
      }
      onClose(result.specFiles);
    } catch (err) {
      logger.error('Failed to close agent session', err);
      onClose();
    }
  }, [closing, sessionId, onClose]);

  const specCount = Object.keys(project.spec_files ?? {}).length;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200] p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-session-dialog-title"
    >
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg shadow-xl w-full h-full max-w-6xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2
              id="agent-session-dialog-title"
              className="text-xl font-bold text-gray-900 dark:text-white"
            >
              {isPlan ? 'Plan' : 'Work'}: {project.name}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {engineLabel} in {project.local_path ?? 'no local path'} —{' '}
              {isPlan ? (
                <>
                  read-only except /workspace/specs, which is saved to the project on close
                  {specCount > 0 &&
                    ` (${specCount} existing spec file${specCount === 1 ? '' : 's'})`}
                </>
              ) : (
                'edits are saved directly to this directory'
              )}
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={closing}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {closing ? (isPlan ? 'Saving specs...' : 'Closing...') : 'End Session'}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 bg-white dark:bg-gray-900 overflow-hidden rounded-b-lg">
          {status === 'starting' && (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
              <p className="text-sm">Starting {engineLabel} in a fresh container...</p>
            </div>
          )}

          {status === 'error' && (
            <div className="flex items-center justify-center h-full p-6">
              <div className="text-center max-w-lg">
                <p className="text-lg mb-2 text-red-600 dark:text-red-400">
                  Could not start the {isPlan ? 'planning' : 'work'} session
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
              </div>
            </div>
          )}

          {(status === 'running' || status === 'ended') && (
            <div className="h-full flex flex-col">
              {status === 'ended' && (
                <div className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                  The agent exited.
                  {isPlan ? ' Close the session to save any spec files it wrote.' : ''}
                </div>
              )}
              <div className="flex-1 overflow-hidden">
                <Terminal
                  ref={terminalRef}
                  onData={handleData}
                  onResize={handleResize}
                  theme={theme}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
