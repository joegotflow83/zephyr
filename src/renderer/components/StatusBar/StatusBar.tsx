import React from 'react';
import { useDockerStatus } from '../../hooks/useDockerStatus';

export interface StatusBarProps {
  /**
   * Number of active loops (RUNNING or STARTING status)
   */
  activeLoopCount?: number;

  /**
   * Application version to display (optional)
   */
  appVersion?: string;
}

/**
 * StatusBar component displays real-time system status at the bottom of the application.
 * Shows Docker connection state, active loop count, and optional version information.
 */
export function StatusBar({ activeLoopCount = 0, appVersion }: StatusBarProps) {
  const { isConnected, dockerInfo } = useDockerStatus();

  return (
    <div className="fixed bottom-0 left-0 right-0 h-7 bg-gray-800 border-t border-gray-700 flex items-center justify-between px-4 text-sm text-gray-300 z-50">
      {/* Left section: Docker status */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              isConnected ? 'bg-green-500' : 'bg-red-500'
            }`}
            title={isConnected ? 'Docker connected' : 'Docker disconnected'}
          />
          <span className="text-xs">
            Docker {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {isConnected && dockerInfo && (
          <span className="text-xs text-gray-400">
            v{dockerInfo.version}
          </span>
        )}
      </div>

      {/* Center section: Active loops */}
      <div className="flex items-center space-x-2">
        {activeLoopCount > 0 && (
          <div className="flex items-center space-x-1.5">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-xs">
              {activeLoopCount} {activeLoopCount === 1 ? 'loop' : 'loops'} running
            </span>
          </div>
        )}
      </div>

      {/* Right section: App version */}
      {appVersion && (
        <div className="text-xs text-gray-500">
          Zephyr v{appVersion}
        </div>
      )}
    </div>
  );
}
