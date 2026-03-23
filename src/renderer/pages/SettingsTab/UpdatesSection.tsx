import React, { useState, useEffect } from 'react';
import type { AutoUpdateState } from '../../../services/auto-updater';

export const UpdatesSection: React.FC = () => {
  const [state, setState] = useState<AutoUpdateState>({ status: 'idle' });

  useEffect(() => {
    // Load initial state
    window.api.autoUpdate.getState().then(setState).catch(console.error);

    // Subscribe to state changes from main process
    const cleanup = window.api.autoUpdate.onStateChanged(setState);
    return cleanup;
  }, []);

  const handleCheck = async () => {
    try {
      await window.api.autoUpdate.check();
    } catch (err) {
      console.error('Failed to check for updates:', err);
    }
  };

  const handleDownload = async () => {
    try {
      await window.api.autoUpdate.download();
    } catch (err) {
      console.error('Failed to download update:', err);
    }
  };

  const handleInstall = () => {
    window.api.autoUpdate.install().catch(console.error);
  };

  const isbusy = state.status === 'checking' || state.status === 'downloading';

  return (
    <div className="space-y-6">
      {/* Check button — hidden while downloading or after download */}
      {state.status !== 'downloading' && state.status !== 'downloaded' && (
        <div>
          <button
            onClick={handleCheck}
            disabled={isbusy}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
            data-testid="check-updates-button"
          >
            {state.status === 'checking' ? 'Checking...' : 'Check for Updates'}
          </button>
        </div>
      )}

      {/* Version info */}
      {state.updateInfo && (
        <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">Latest Version:</span>
            <span
              className={`font-medium ${
                state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded'
                  ? 'text-green-400'
                  : 'text-gray-800 dark:text-gray-200'
              }`}
              data-testid="latest-version"
            >
              {state.updateInfo.version}
            </span>
          </div>
        </div>
      )}

      {/* Update available */}
      {state.status === 'available' && (
        <div className="space-y-4">
          <div
            className="p-4 bg-green-900/20 border border-green-800 rounded text-green-300"
            data-testid="update-available"
          >
            <p className="font-medium">Update Available!</p>
            {state.updateInfo?.releaseDate && (
              <p className="text-sm mt-1">
                Released {new Date(state.updateInfo.releaseDate).toLocaleDateString()}
              </p>
            )}
          </div>
          <button
            onClick={handleDownload}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800"
            data-testid="download-button"
          >
            Download Update
          </button>
        </div>
      )}

      {/* Downloading with progress */}
      {state.status === 'downloading' && (
        <div className="space-y-3" data-testid="download-progress">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Downloading update{state.downloadProgress ? ` — ${Math.round(state.downloadProgress.percent)}%` : '...'}
          </p>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${state.downloadProgress?.percent ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Downloaded — ready to install */}
      {state.status === 'downloaded' && (
        <div className="space-y-4">
          <div
            className="p-4 bg-blue-900/20 border border-blue-800 rounded text-blue-300"
            data-testid="update-downloaded"
          >
            <p className="font-medium">Update Ready</p>
            <p className="text-sm mt-1">
              Version {state.updateInfo?.version} has been downloaded and will install on restart.
            </p>
          </div>
          <button
            onClick={handleInstall}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
            data-testid="install-button"
          >
            Install & Restart
          </button>
        </div>
      )}

      {/* Up to date */}
      {state.status === 'not-available' && (
        <div
          className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-300"
          data-testid="no-update"
        >
          You&apos;re running the latest version.
        </div>
      )}

      {/* Error */}
      {state.status === 'error' && (
        <div
          className="p-4 bg-red-900/20 border border-red-800 rounded text-red-300"
          data-testid="update-error"
        >
          {state.error ?? 'Failed to check for updates.'}
        </div>
      )}

      {/* Initial state */}
      {state.status === 'idle' && (
        <div className="text-sm text-gray-500 dark:text-gray-400" data-testid="initial-message">
          Click &quot;Check for Updates&quot; to see if a newer version is available.
        </div>
      )}
    </div>
  );
};
