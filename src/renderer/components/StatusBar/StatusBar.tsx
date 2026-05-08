import React from 'react';
import { useRuntimeStatus } from '../../hooks/useRuntimeStatus';

export interface StatusBarProps {
  /**
   * Number of projects with active factory containers (RUNNING or STARTING status)
   */
  activeFactoryCount?: number;

  /**
   * Application version to display (optional)
   */
  appVersion?: string;
}

/**
 * StatusBar component displays real-time system status at the bottom of the application.
 * Shows runtime connection state, active factory count, and optional version information.
 */
export function StatusBar({ activeFactoryCount = 0, appVersion }: StatusBarProps) {
  const { available, info, runtimeType } = useRuntimeStatus();
  const runtimeLabel = runtimeType === 'docker' ? 'Docker' : 'Podman';

  return (
    <div className="h-7 bg-gray-50 dark:bg-gray-800 flex items-center justify-between px-4 text-sm text-gray-700 dark:text-gray-300">
      {/* Left section: runtime status */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              available ? 'bg-green-500' : 'bg-red-500'
            }`}
            title={available ? `${runtimeLabel} connected` : `${runtimeLabel} disconnected`}
          />
          <span className="text-xs">
            {runtimeLabel} {available ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {available && info && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            v{info.version}
          </span>
        )}
      </div>

      {/* Center section: Active factories */}
      <div className="flex items-center space-x-2">
        {activeFactoryCount > 0 && (
          <div className="flex items-center space-x-1.5">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-xs">
              {activeFactoryCount} {activeFactoryCount === 1 ? 'factory' : 'factories'} running
            </span>
          </div>
        )}
      </div>

      {/* Right section: App version */}
      {appVersion && (
        <div className="text-xs text-gray-500 dark:text-gray-500">
          Zephyr v{appVersion}
        </div>
      )}
    </div>
  );
}
