import React, { useState, useEffect } from 'react';
import {
  Terminal,
  TerminalHandle,
} from '../../components/Terminal/Terminal';
import type { ContainerInfo } from '../../../services/docker-manager';
import type { TerminalSession } from '../../../services/terminal-manager';

interface OpenTerminalSession extends TerminalSession {
  containerId: string;
  containerName: string;
  terminalRef: React.RefObject<TerminalHandle>;
}

export const TerminalTab: React.FC = () => {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [selectedContainerId, setSelectedContainerId] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<string>('default');
  const [sessions, setSessions] = useState<OpenTerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load running containers on mount
  useEffect(() => {
    const loadContainers = async () => {
      try {
        const containerList = await window.api.docker.listContainers();
        setContainers(containerList);
        // Auto-select first container if available
        if (containerList.length > 0 && !selectedContainerId) {
          setSelectedContainerId(containerList[0].id);
        }
      } catch (err) {
        console.error('Failed to load containers:', err);
        setError('Failed to load containers');
      }
    };

    loadContainers();
    // Refresh container list every 5 seconds
    const interval = setInterval(loadContainers, 5000);
    return () => clearInterval(interval);
  }, [selectedContainerId]);

  // Set up global terminal event listeners
  useEffect(() => {
    const cleanupData = window.api.terminal.onData((sessionId, data) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (session?.terminalRef.current) {
        session.terminalRef.current.write(data);
      }
    });

    const cleanupClosed = window.api.terminal.onClosed((sessionId) => {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setActiveSessionId((prev) => (prev === sessionId ? null : prev));
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
    if (!selectedContainerId) {
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

      const result = await window.api.terminal.open(selectedContainerId, opts);

      if (!result.success || !result.session) {
        throw new Error(result.error || 'Failed to open terminal session');
      }

      const container = containers.find((c) => c.id === selectedContainerId);
      const terminalRef = React.createRef<TerminalHandle>();

      const newSession: OpenTerminalSession = {
        ...result.session,
        containerId: selectedContainerId,
        containerName: container?.name || 'Unknown',
        terminalRef,
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

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="p-4 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center gap-4">
          {/* Container selector */}
          <div className="flex-1">
            <label className="block text-sm text-gray-400 mb-1">
              Container
            </label>
            <select
              value={selectedContainerId}
              onChange={(e) => setSelectedContainerId(e.target.value)}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            >
              <option value="">Select a container...</option>
              {containers.map((container) => (
                <option key={container.id} value={container.id}>
                  {container.name} ({container.image})
                </option>
              ))}
            </select>
          </div>

          {/* User selector */}
          <div className="w-40">
            <label className="block text-sm text-gray-400 mb-1">User</label>
            <select
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
              disabled={loading || !selectedContainerId}
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
        {containers.length === 0 && (
          <div className="mt-2 p-2 bg-blue-900/50 border border-blue-700 rounded text-blue-200 text-sm">
            No running containers found. Start a loop or container to use the
            terminal.
          </div>
        )}
      </div>

      {/* Session tabs */}
      {sessions.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700 overflow-x-auto">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`flex items-center gap-2 px-3 py-1 rounded cursor-pointer transition-colors ${
                activeSessionId === session.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              onClick={() => setActiveSessionId(session.id)}
            >
              <span className="text-sm">
                {session.containerName}
                {session.user && ` (${session.user})`}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeSession(session.id);
                }}
                className="text-gray-400 hover:text-white"
                aria-label="Close session"
              >
                ✕
              </button>
            </div>
          ))}
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
              <Terminal
                ref={session.terminalRef}
                onData={(data) => handleTerminalData(session.id, data)}
                onResize={(cols, rows) =>
                  handleTerminalResize(session.id, cols, rows)
                }
                fontSize={14}
                theme="dark"
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
};
