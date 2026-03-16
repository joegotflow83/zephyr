import React, { useState, useEffect } from 'react';
import { useRuntimeStatus } from '../../hooks/useRuntimeStatus';
import { useSettings } from '../../hooks/useSettings';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog';

/**
 * ContainerRuntimeSection — settings UI for selecting and configuring the
 * active container runtime (Docker or Podman).
 *
 * Why this exists: replaces the old DockerSection which was hardcoded to Docker.
 * This component exposes a runtime toggle at the top so users can switch between
 * runtimes. Switching requires an app restart and images must be rebuilt, so we
 * show a confirmation dialog and a restart banner.
 *
 * Docker subsection: connection status + max concurrent containers.
 * Podman subsection: availability status + macOS/Windows machine note.
 */
export const ContainerRuntimeSection: React.FC = () => {
  const { available, info } = useRuntimeStatus();
  const { settings, update } = useSettings();
  const [maxContainers, setMaxContainers] = useState(settings?.max_concurrent_containers ?? 3);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingRuntime, setPendingRuntime] = useState<'docker' | 'podman' | null>(null);
  const [restartNeeded, setRestartNeeded] = useState(false);

  // Sync max containers with settings when they load/change
  useEffect(() => {
    if (settings) {
      setMaxContainers(settings.max_concurrent_containers);
    }
  }, [settings]);

  // Debounced save for max containers (Docker only)
  useEffect(() => {
    if (settings && maxContainers !== settings.max_concurrent_containers) {
      setIsSaving(true);
      const timer = setTimeout(() => {
        update({ max_concurrent_containers: maxContainers })
          .catch((err) => console.error('Failed to save max containers setting:', err))
          .finally(() => setIsSaving(false));
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [maxContainers, settings, update]);

  const currentRuntime = settings?.container_runtime ?? 'docker';

  const handleRuntimeChange = (newRuntime: 'docker' | 'podman') => {
    if (newRuntime === currentRuntime) return;
    setPendingRuntime(newRuntime);
  };

  const handleConfirmSwitch = async () => {
    if (!pendingRuntime) return;
    try {
      await update({ container_runtime: pendingRuntime });
      setRestartNeeded(true);
    } catch (err) {
      console.error('Failed to save runtime setting:', err);
    }
    setPendingRuntime(null);
  };

  return (
    <div className="space-y-6">
      {/* Runtime selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Container Runtime
        </label>
        <div className="flex gap-6">
          {(['docker', 'podman'] as const).map((rt) => (
            <label key={rt} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="container_runtime"
                value={rt}
                checked={currentRuntime === rt}
                onChange={() => handleRuntimeChange(rt)}
                className="text-blue-600"
              />
              <span className="text-sm text-gray-800 dark:text-gray-200">
                {rt === 'docker' ? 'Docker Desktop' : 'Podman'}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Restart-required banner (shown after confirming a runtime switch) */}
      {restartNeeded && (
        <div className="bg-yellow-900/20 border border-yellow-600/30 rounded p-4 text-sm text-yellow-200">
          Runtime changed. Please quit and reopen Zephyr to apply the change.
        </div>
      )}

      {/* Connection / availability status */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {currentRuntime === 'docker' ? 'Connection Status' : 'Availability'}
        </label>
        <div className="flex items-center">
          <div
            className={`w-3 h-3 rounded-full mr-3 ${available ? 'bg-green-500' : 'bg-red-500'}`}
            data-testid="runtime-status-indicator"
          />
          <span className="text-gray-800 dark:text-gray-200">
            {available ? 'Available' : 'Unavailable'}
          </span>
        </div>
      </div>

      {/* Docker-specific: max concurrent containers */}
      {currentRuntime === 'docker' && (
        <div>
          <label
            htmlFor="max-containers"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            Max Concurrent Containers
          </label>
          <div className="flex items-center">
            <div className="relative inline-flex items-center">
              <button
                type="button"
                onClick={() => setMaxContainers((v) => Math.max(1, v - 1))}
                disabled={maxContainers <= 1}
                className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-l border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
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
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 1 && val <= 20) setMaxContainers(val);
                }}
                className="w-20 px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-t border-b border-gray-200 dark:border-gray-600 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="max-containers-input"
              />
              <button
                type="button"
                onClick={() => setMaxContainers((v) => Math.min(20, v + 1))}
                disabled={maxContainers >= 20}
                className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-r border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Increase max containers"
              >
                +
              </button>
            </div>
            {isSaving && (
              <span className="ml-3 text-sm text-gray-500 dark:text-gray-400">Saving...</span>
            )}
          </div>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Maximum number of containers that can run simultaneously
          </p>
        </div>
      )}

      {/* Podman-specific: machine note for macOS/Windows */}
      {currentRuntime === 'podman' && (
        <div className="bg-blue-900/20 border border-blue-600/30 rounded p-4 text-sm text-blue-200">
          On macOS and Windows, ensure{' '}
          <code className="font-mono">podman machine</code> is running before starting loops.
          Zephyr does not manage the Podman machine lifecycle.
        </div>
      )}

      {/* Runtime info block (version, container count, etc.) */}
      {available && info && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {currentRuntime === 'docker' ? 'Docker' : 'Podman'} Information
          </label>
          <div className="bg-gray-50 dark:bg-gray-900 rounded p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Version:</span>
              <span className="text-gray-800 dark:text-gray-200">{info.version}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Containers:</span>
              <span className="text-gray-800 dark:text-gray-200">{info.containers}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Images:</span>
              <span className="text-gray-800 dark:text-gray-200">{info.images}</span>
            </div>
            {info.osType && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">OS Type:</span>
                <span className="text-gray-800 dark:text-gray-200">{info.osType}</span>
              </div>
            )}
            {info.architecture && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Architecture:</span>
                <span className="text-gray-800 dark:text-gray-200">{info.architecture}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Unavailability warning */}
      {!available && !restartNeeded && (
        <div className="bg-yellow-900/20 border border-yellow-600/30 rounded p-4 text-sm text-yellow-200">
          {currentRuntime === 'docker'
            ? 'Docker is not running or not available. Please ensure Docker Desktop is running and try again.'
            : 'Podman is not available. Please ensure Podman is installed and running.'}
        </div>
      )}

      {/* Runtime switch confirmation dialog */}
      {pendingRuntime && (
        <ConfirmDialog
          title="Switch Container Runtime"
          message={`Switching to ${pendingRuntime === 'docker' ? 'Docker Desktop' : 'Podman'} requires an app restart. Images built with ${currentRuntime === 'docker' ? 'Docker Desktop' : 'Podman'} will need to be rebuilt.\n\nContinue?`}
          confirmLabel="Switch Runtime"
          onConfirm={handleConfirmSwitch}
          onCancel={() => setPendingRuntime(null)}
        />
      )}
    </div>
  );
};
