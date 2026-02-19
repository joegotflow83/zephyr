import React, { useState } from 'react';

/**
 * UpdateInfo type (matches src/services/self-updater.ts)
 */
interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  changelog?: string;
}

/**
 * UpdatesSection component for Settings tab
 *
 * Displays:
 * - "Check for Updates" button
 * - Current version vs. available version
 * - "Update App" button (triggers self-update loop)
 * - Update progress/status display
 *
 * Wired to window.api.updates.check() and window.api.updates.apply()
 */
export const UpdatesSection: React.FC = () => {
  const [isChecking, setIsChecking] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheckForUpdates = async () => {
    setIsChecking(true);
    setError(null);

    try {
      const info = await window.api.updates.check();
      setUpdateInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check for updates');
      console.error('Failed to check for updates:', err);
    } finally {
      setIsChecking(false);
    }
  };

  const handleApplyUpdate = async () => {
    if (!updateInfo?.available) return;

    setIsUpdating(true);
    setError(null);

    try {
      // Use default docker image for self-update
      // TODO: Allow user to specify docker image in settings
      await window.api.updates.apply('zephyr-desktop:latest');
      // Note: The actual update is triggered as a loop in the Loops tab
      // This just starts the self-update process
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start update');
      console.error('Failed to start update:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Check for Updates Button */}
      <div>
        <button
          onClick={handleCheckForUpdates}
          disabled={isChecking}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
          data-testid="check-updates-button"
        >
          {isChecking ? 'Checking...' : 'Check for Updates'}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div
          className="p-4 bg-red-900/20 border border-red-800 rounded text-red-300"
          data-testid="update-error"
        >
          {error}
        </div>
      )}

      {/* Update Info Display */}
      {updateInfo && (
        <div className="space-y-4">
          {/* Version Information */}
          <div className="p-4 bg-gray-800 border border-gray-700 rounded space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Current Version:</span>
              <span className="text-gray-200" data-testid="current-version">
                {updateInfo.currentVersion}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Latest Version:</span>
              <span
                className={`font-medium ${
                  updateInfo.available ? 'text-green-400' : 'text-gray-200'
                }`}
                data-testid="latest-version"
              >
                {updateInfo.latestVersion}
              </span>
            </div>
          </div>

          {/* Update Available Status */}
          {updateInfo.available ? (
            <div className="space-y-4">
              <div
                className="p-4 bg-green-900/20 border border-green-800 rounded text-green-300"
                data-testid="update-available"
              >
                <p className="font-medium">Update Available!</p>
                <p className="text-sm mt-1">
                  A new version of Zephyr Desktop is available.
                </p>
              </div>

              {/* Changelog */}
              {updateInfo.changelog && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">
                    What&apos;s New:
                  </label>
                  <div
                    className="p-3 bg-gray-800 border border-gray-700 rounded text-sm text-gray-300 whitespace-pre-wrap max-h-48 overflow-y-auto"
                    data-testid="changelog"
                  >
                    {updateInfo.changelog}
                  </div>
                </div>
              )}

              {/* Update Button */}
              <button
                onClick={handleApplyUpdate}
                disabled={isUpdating}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                data-testid="apply-update-button"
              >
                {isUpdating ? 'Starting Update...' : 'Update App'}
              </button>

              {/* Update Note */}
              <p className="text-sm text-gray-400">
                Note: Clicking &quot;Update App&quot; will start a self-update loop. You can monitor
                the progress in the Loops tab.
              </p>
            </div>
          ) : (
            <div
              className="p-4 bg-gray-800 border border-gray-700 rounded text-gray-300"
              data-testid="no-update"
            >
              You&apos;re running the latest version of Zephyr Desktop.
            </div>
          )}
        </div>
      )}

      {/* Initial State Message */}
      {!updateInfo && !error && !isChecking && (
        <div className="text-sm text-gray-400" data-testid="initial-message">
          Click &quot;Check for Updates&quot; to see if a newer version is available.
        </div>
      )}
    </div>
  );
};
