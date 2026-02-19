import React, { useState, useEffect } from 'react';
import { useDockerStatus } from '../../hooks/useDockerStatus';
import { useSettings } from '../../hooks/useSettings';

/**
 * DockerSection component for Settings tab
 *
 * Displays:
 * - Docker connection status indicator (green/red with text)
 * - Max concurrent containers spinner (number input)
 * - Docker info (version, running containers, images)
 *
 * Changes are debounced and saved via window.api.settings.save()
 */
export const DockerSection: React.FC = () => {
  const { isConnected, dockerInfo } = useDockerStatus();
  const { settings, update } = useSettings();
  const [maxContainers, setMaxContainers] = useState(
    settings?.max_concurrent_containers ?? 3
  );
  const [isSaving, setIsSaving] = useState(false);

  // Sync with settings when they change
  useEffect(() => {
    if (settings) {
      setMaxContainers(settings.max_concurrent_containers);
    }
  }, [settings]);

  // Debounced save handler
  useEffect(() => {
    if (settings && maxContainers !== settings.max_concurrent_containers) {
      setIsSaving(true);
      const timer = setTimeout(() => {
        update({ max_concurrent_containers: maxContainers })
          .catch((err) => {
            console.error('Failed to save max containers setting:', err);
          })
          .finally(() => {
            setIsSaving(false);
          });
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [maxContainers, settings, update]);

  const handleMaxContainersChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value >= 1 && value <= 20) {
      setMaxContainers(value);
    }
  };

  const incrementMaxContainers = () => {
    if (maxContainers < 20) {
      setMaxContainers(maxContainers + 1);
    }
  };

  const decrementMaxContainers = () => {
    if (maxContainers > 1) {
      setMaxContainers(maxContainers - 1);
    }
  };

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Connection Status
        </label>
        <div className="flex items-center">
          <div
            className={`w-3 h-3 rounded-full mr-3 ${
              isConnected ? 'bg-green-500' : 'bg-red-500'
            }`}
            data-testid="docker-status-indicator"
          />
          <span className="text-gray-200">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Max Concurrent Containers */}
      <div>
        <label
          htmlFor="max-containers"
          className="block text-sm font-medium text-gray-300 mb-2"
        >
          Max Concurrent Containers
        </label>
        <div className="flex items-center">
          <div className="relative inline-flex items-center">
            <button
              type="button"
              onClick={decrementMaxContainers}
              disabled={maxContainers <= 1}
              className="px-3 py-2 bg-gray-700 text-gray-200 rounded-l border border-gray-600 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Decrease max containers"
            >
              -
            </button>
            <input
              id="max-containers"
              type="number"
              min="1"
              max="20"
              value={maxContainers}
              onChange={handleMaxContainersChange}
              className="w-20 px-3 py-2 bg-gray-800 text-gray-100 border-t border-b border-gray-600 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
              data-testid="max-containers-input"
            />
            <button
              type="button"
              onClick={incrementMaxContainers}
              disabled={maxContainers >= 20}
              className="px-3 py-2 bg-gray-700 text-gray-200 rounded-r border border-gray-600 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Increase max containers"
            >
              +
            </button>
          </div>
          {isSaving && (
            <span className="ml-3 text-sm text-gray-400">Saving...</span>
          )}
        </div>
        <p className="mt-2 text-sm text-gray-400">
          Maximum number of Docker containers that can run simultaneously
        </p>
      </div>

      {/* Docker Info */}
      {isConnected && dockerInfo && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Docker Information
          </label>
          <div className="bg-gray-900 rounded p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Version:</span>
              <span className="text-gray-200">{dockerInfo.version}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Running Containers:</span>
              <span className="text-gray-200">{dockerInfo.containers}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Images:</span>
              <span className="text-gray-200">{dockerInfo.images}</span>
            </div>
            {dockerInfo.osType && (
              <div className="flex justify-between">
                <span className="text-gray-400">OS Type:</span>
                <span className="text-gray-200">{dockerInfo.osType}</span>
              </div>
            )}
            {dockerInfo.architecture && (
              <div className="flex justify-between">
                <span className="text-gray-400">Architecture:</span>
                <span className="text-gray-200">{dockerInfo.architecture}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {!isConnected && (
        <div className="bg-yellow-900/20 border border-yellow-600/30 rounded p-4 text-sm text-yellow-200">
          Docker is not running or not available. Please ensure Docker Desktop is
          running and try again.
        </div>
      )}
    </div>
  );
};
