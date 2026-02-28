import React, { useState, useEffect, useCallback } from 'react';
import {
  Terminal,
  TerminalHandle,
} from '../../components/Terminal/Terminal';
import type { ContainerInfo } from '../../../services/docker-manager';
import type { TerminalSession } from '../../../services/terminal-manager';
import type { LoopState } from '../../../shared/loop-types';
import { LoopStatus } from '../../../shared/loop-types';
import { useAppStore } from '../../stores/app-store';

interface OpenTerminalSession extends TerminalSession {
  containerId: string;
  containerName: string;
  terminalRef: React.RefObject<TerminalHandle>;
  disconnected?: boolean;
  /** Present for VM-backed sessions; used to reconnect through the right path. */
  vmName?: string;
}

/** Derive the Docker container name from a loop state (mirrors LoopRunner.deriveContainerName). */
function deriveContainerName(loop: LoopState): string {
  return (
    loop.projectName
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+/, '') || loop.projectId.substring(0, 8)
  );
}

export const TerminalTab: React.FC = () => {
  const { settings } = useAppStore();
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [vmLoops, setVmLoops] = useState<LoopState[]>([]);
  // Encoded as "docker:{containerId}" or "vm:{vmName}:{containerName}"
  const [selectedTarget, setSelectedTarget] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<string>('default');
  const [sessions, setSessions] = useState<OpenTerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState<number>(14);

  // Determine theme from settings
  const theme = settings?.theme === 'light' ? 'light' : 'dark';

  // Load running containers and VM loops on mount, refresh every 5 seconds
  useEffect(() => {
    const load = async () => {
      try {
        const [containerList, loopList] = await Promise.all([
          window.api.docker.listContainers(),
          window.api.loops.list(),
        ]);
        setContainers(containerList);
        // Running VM-backed loops whose container is accessible via multipass exec
        const running = loopList.filter(
          (l) => l.sandboxType === 'vm' && l.vmName && l.status === LoopStatus.RUNNING,
        );
        setVmLoops(running);

        // Auto-select first available target
        if (!selectedTarget) {
          if (containerList.length > 0) {
            setSelectedTarget(`docker:${containerList[0].id}`);
          } else if (running.length > 0) {
            const loop = running[0];
            setSelectedTarget(`vm:${loop.vmName}:${deriveContainerName(loop)}`);
          }
        }
      } catch (err) {
        console.error('Failed to load containers:', err);
        setError('Failed to load containers');
      }
    };

    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [selectedTarget]);

  // Set up global terminal event listeners
  useEffect(() => {
    const cleanupData = window.api.terminal.onData((sessionId, data) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (session?.terminalRef.current) {
        session.terminalRef.current.write(data);
      }
    });

    const cleanupClosed = window.api.terminal.onClosed((sessionId) => {
      // Mark session as disconnected instead of removing it
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, disconnected: true } : s))
      );
    });

    const cleanupError = window.api.terminal.onError((sessionId, errorMsg) => {
      console.error(`Terminal session ${sessionId} error:`, errorMsg);
      setError(errorMsg);
    });

    return () => {
      cleanupData();
      cleanupClosed();
      cleanupError();
    };
  }, [sessions]);

  const openTerminal = async () => {
    if (!selectedTarget) {
      setError('Please select a container');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const opts = {
        user: selectedUser === 'root' ? 'root' : undefined,
        shell: 'bash',
        rows: 24,
        cols: 80,
      };

      let result: { success: boolean; session?: TerminalSession; error?: string };
      let displayName: string;
      let vmName: string | undefined;
      let containerId: string;

      if (selectedTarget.startsWith('vm:')) {
        // VM-backed container: "vm:{vmName}:{containerName}"
        const parts = selectedTarget.split(':');
        const vName = parts[1];
        const cName = parts.slice(2).join(':');
        result = await window.api.terminal.openVM(vName, cName, opts);
        displayName = `${cName} [VM]`;
        vmName = vName;
        containerId = cName;
      } else {
        // Regular Docker container: "docker:{containerId}"
        const cId = selectedTarget.replace(/^docker:/, '');
        result = await window.api.terminal.open(cId, opts);
        const container = containers.find((c) => c.id === cId);
        displayName = container?.name || 'Unknown';
        containerId = cId;
      }

      if (!result.success || !result.session) {
        throw new Error(result.error || 'Failed to open terminal session');
      }

      const terminalRef = React.createRef<TerminalHandle>();

      const newSession: OpenTerminalSession = {
        ...result.session,
        containerId,
        containerName: displayName,
        terminalRef,
        vmName,
      };

      setSessions((prev) => [...prev, newSession]);
      setActiveSessionId(result.session.id);
    } catch (err) {
      console.error('Failed to open terminal:', err);
      setError(err instanceof Error ? err.message : 'Failed to open terminal');
    } finally {
      setLoading(false);
    }
  };

  const closeSession = async (sessionId: string) => {
    try {
      await window.api.terminal.close(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        const remainingSessions = sessions.filter((s) => s.id !== sessionId);
        setActiveSessionId(
          remainingSessions.length > 0 ? remainingSessions[0].id : null
        );
      }
    } catch (err) {
      console.error('Failed to close terminal session:', err);
      setError(err instanceof Error ? err.message : 'Failed to close session');
    }
  };

  const handleTerminalData = (sessionId: string, data: string) => {
    window.api.terminal.write(sessionId, data);
  };

  const handleTerminalResize = async (
    sessionId: string,
    cols: number,
    rows: number
  ) => {
    try {
      await window.api.terminal.resize(sessionId, cols, rows);
    } catch (err) {
      console.error('Failed to resize terminal:', err);
    }
  };

  const reconnectSession = useCallback(
    async (session: OpenTerminalSession) => {
      setLoading(true);
      setError(null);

      try {
        const opts = {
          user: session.user === 'root' ? 'root' : undefined,
          shell: 'bash',
          rows: 24,
          cols: 80,
        };

        const result = session.vmName
          ? await window.api.terminal.openVM(session.vmName, session.containerId, opts)
          : await window.api.terminal.open(session.containerId, opts);

        if (!result.success || !result.session) {
          throw new Error(result.error || 'Failed to reconnect terminal session');
        }

        // Update the session with new session ID and clear disconnected flag
        setSessions((prev) =>
          prev.map((s) =>
            s.id === session.id
              ? {
                  ...s,
                  id: result.session.id,
                  disconnected: false,
                  createdAt: result.session.createdAt,
                }
              : s
          )
        );

        // Update active session ID if this was the active one
        if (activeSessionId === session.id) {
          setActiveSessionId(result.session.id);
        }
      } catch (err) {
        console.error('Failed to reconnect terminal:', err);
        setError(err instanceof Error ? err.message : 'Failed to reconnect terminal');
      } finally {
        setLoading(false);
      }
    },
    [activeSessionId]
  );

  const removeSession = useCallback(async (sessionId: string) => {
    // Close the session via IPC and remove from state
    await closeSession(sessionId);
  }, []);

  // Keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeSession = sessions.find((s) => s.id === activeSessionId);
      if (!activeSession || activeSession.disconnected) return;

      const terminal = activeSession.terminalRef.current;
      if (!terminal) return;

      // Ctrl+Shift+F: Search
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        terminal.search();
      }

      // Ctrl+Shift+C: Copy
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        terminal.copy();
      }

      // Ctrl+Shift+V: Paste
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          terminal.paste(text);
        });
      }

      // Ctrl+=: Increase font size
      if (e.ctrlKey && e.key === '=') {
        e.preventDefault();
        terminal.increaseFontSize();
        setFontSize(terminal.getCurrentFontSize());
      }

      // Ctrl+-: Decrease font size
      if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        terminal.decreaseFontSize();
        setFontSize(terminal.getCurrentFontSize());
      }

      // Ctrl+0: Reset font size
      if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        terminal.resetFontSize();
        setFontSize(terminal.getCurrentFontSize());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessions, activeSessionId]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="p-4 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center gap-4">
          {/* Container selector */}
          <div className="flex-1">
            <label htmlFor="container-select" className="block text-sm text-gray-400 mb-1">
              Container
            </label>
            <select
              id="container-select"
              value={selectedTarget}
              onChange={(e) => setSelectedTarget(e.target.value)}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            >
              <option value="">Select a container...</option>
              {containers.length > 0 && (
                <optgroup label="Docker (host)">
                  {containers.map((container) => (
                    <option key={container.id} value={`docker:${container.id}`}>
                      {container.name} ({container.image})
                    </option>
                  ))}
                </optgroup>
              )}
              {vmLoops.length > 0 && (
                <optgroup label="VM containers">
                  {vmLoops.map((loop) => {
                    const cName = deriveContainerName(loop);
                    return (
                      <option key={loop.projectId} value={`vm:${loop.vmName}:${cName}`}>
                        {cName} — {loop.projectName} [VM]
                      </option>
                    );
                  })}
                </optgroup>
              )}
            </select>
          </div>

          {/* User selector */}
          <div className="w-40">
            <label htmlFor="user-select" className="block text-sm text-gray-400 mb-1">User</label>
            <select
              id="user-select"
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            >
              <option value="default">Default</option>
              <option value="root">Root</option>
            </select>
          </div>

          {/* Open button */}
          <div className="pt-6">
            <button
              onClick={openTerminal}
              disabled={loading || !selectedTarget}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Opening...' : 'Open Terminal'}
            </button>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="mt-2 p-2 bg-red-900/50 border border-red-700 rounded text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Info message when no containers */}
        {containers.length === 0 && vmLoops.length === 0 && (
          <div className="mt-2 p-2 bg-blue-900/50 border border-blue-700 rounded text-blue-200 text-sm">
            No running containers found. Start a loop or container to use the
            terminal.
          </div>
        )}
      </div>

      {/* Session tabs and controls */}
      {sessions.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
          <div className="flex items-center gap-2 overflow-x-auto">
            {sessions.map((session) => (
            <div
              key={session.id}
              className={`flex items-center gap-2 px-3 py-1 rounded cursor-pointer transition-colors ${
                activeSessionId === session.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              } ${session.disconnected ? 'opacity-60' : ''}`}
              onClick={() => {
                setActiveSessionId(session.id);
                // Re-focus the terminal when switching tabs
                setTimeout(() => session.terminalRef.current?.focus(), 0);
              }}
            >
              <span className="text-sm">
                {session.containerName}
                {session.user && ` (${session.user})`}
                {session.disconnected && ' [Disconnected]'}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeSession(session.id);
                }}
                className="text-gray-400 hover:text-white"
                aria-label="Close session"
              >
                ✕
              </button>
            </div>
          ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>Font: {fontSize}px</span>
            <span className="text-gray-600">|</span>
            <span title="Search: Ctrl+Shift+F">🔍</span>
            <span title="Copy: Ctrl+Shift+C">📋</span>
            <span title="Zoom: Ctrl+/-/0">🔍±</span>
          </div>
        </div>
      )}

      {/* Terminal display area */}
      <div className="flex-1 bg-gray-900 overflow-hidden relative">
        {sessions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <p className="text-lg mb-2">No active terminal sessions</p>
              <p className="text-sm">
                Select a container and click &quot;Open Terminal&quot; to start
              </p>
            </div>
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`h-full ${
                activeSessionId === session.id ? 'block' : 'hidden'
              }`}
            >
              {session.disconnected ? (
                <div className="flex items-center justify-center h-full bg-gray-900 text-gray-400">
                  <div className="text-center">
                    <p className="text-lg mb-4">Session Disconnected</p>
                    <p className="text-sm mb-6">
                      The terminal session has ended. You can reconnect or close
                      this session.
                    </p>
                    <div className="flex gap-4 justify-center">
                      <button
                        onClick={() => reconnectSession(session)}
                        disabled={loading}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
                      >
                        {loading ? 'Reconnecting...' : 'Reconnect'}
                      </button>
                      <button
                        onClick={() => removeSession(session.id)}
                        className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors"
                      >
                        Close Session
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <Terminal
                  ref={session.terminalRef}
                  onData={(data) => handleTerminalData(session.id, data)}
                  onResize={(cols, rows) =>
                    handleTerminalResize(session.id, cols, rows)
                  }
                  fontSize={fontSize}
                  theme={theme}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
