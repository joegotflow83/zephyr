import React from 'react';
import type { LoopState } from '../../../shared/loop-types';
import { LoopStatus, LoopMode } from '../../../shared/loop-types';
import type { ProjectConfig } from '../../../shared/models';

interface LoopRowProps {
  loop: LoopState;
  project?: ProjectConfig;
  isSelected: boolean;
  onSelect: (loop: LoopState) => void;
  onStop: (projectId: string) => void;
  onStart: (projectId: string) => void;
}

/**
 * Single row component for displaying a loop in the loops table.
 * Shows loop state, status badge, and action buttons.
 */
export const LoopRow: React.FC<LoopRowProps> = ({
  loop,
  project,
  isSelected,
  onSelect,
  onStop,
  onStart,
}) => {
  // Determine if the loop can be stopped or started
  const canStop = loop.status === LoopStatus.RUNNING ||
                  loop.status === LoopStatus.STARTING ||
                  loop.status === LoopStatus.PAUSED;

  const canStart = loop.status === LoopStatus.STOPPED ||
                   loop.status === LoopStatus.FAILED ||
                   loop.status === LoopStatus.COMPLETED ||
                   loop.status === LoopStatus.IDLE;

  // Status badge styling per spec: running=green, starting=blue, failed=red, completed=gray, stopping=yellow
  const getStatusBadge = () => {
    let bgColor = 'bg-gray-700';
    let textColor = 'text-gray-300';
    let label: string = loop.status;

    switch (loop.status) {
      case LoopStatus.STARTING:
        bgColor = 'bg-blue-900';
        textColor = 'text-blue-300';
        label = 'Starting';
        break;
      case LoopStatus.RUNNING:
        bgColor = 'bg-green-900';
        textColor = 'text-green-300';
        label = 'Running';
        break;
      case LoopStatus.PAUSED:
        bgColor = 'bg-yellow-900';
        textColor = 'text-yellow-300';
        label = 'Paused';
        break;
      case LoopStatus.STOPPING:
        bgColor = 'bg-yellow-900';
        textColor = 'text-yellow-300';
        label = 'Stopping';
        break;
      case LoopStatus.FAILED:
        bgColor = 'bg-red-900';
        textColor = 'text-red-300';
        label = 'Failed';
        break;
      case LoopStatus.COMPLETED:
        bgColor = 'bg-gray-700';
        textColor = 'text-gray-300';
        label = 'Completed';
        break;
      case LoopStatus.STOPPED:
        bgColor = 'bg-gray-700';
        textColor = 'text-gray-300';
        label = 'Stopped';
        break;
      case LoopStatus.IDLE:
        bgColor = 'bg-gray-700';
        textColor = 'text-gray-300';
        label = 'Idle';
        break;
    }

    return (
      <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded ${bgColor} ${textColor}`}>
        {label}
      </span>
    );
  };

  // Format mode for display
  const getModeLabel = () => {
    switch (loop.mode) {
      case LoopMode.SINGLE:
        return 'Single';
      case LoopMode.CONTINUOUS:
        return 'Continuous';
      case LoopMode.SCHEDULED:
        return 'Scheduled';
      default:
        return loop.mode;
    }
  };

  // Format started time
  const getStartedLabel = () => {
    if (!loop.startedAt) return '-';
    const date = new Date(loop.startedAt);
    return date.toLocaleString();
  };

  return (
    <tr
      className={`border-b border-gray-700 hover:bg-gray-800 cursor-pointer ${
        isSelected ? 'bg-gray-800' : ''
      }`}
      onClick={() => onSelect(loop)}
    >
      <td className="px-4 py-3 text-sm font-medium text-white">
        {project?.name || loop.projectId}
      </td>
      <td className="px-4 py-3 text-sm">
        {getStatusBadge()}
      </td>
      <td className="px-4 py-3 text-sm text-gray-300">
        {getModeLabel()}
      </td>
      <td className="px-4 py-3 text-sm text-gray-300">
        {loop.iteration}
      </td>
      <td className="px-4 py-3 text-sm text-gray-300">
        {getStartedLabel()}
      </td>
      <td className="px-4 py-3 text-sm text-right space-x-2">
        {canStop && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStop(loop.projectId);
            }}
            className="px-3 py-1 bg-red-700 text-white rounded font-medium hover:bg-red-600 transition-colors"
            title="Stop loop"
          >
            Stop
          </button>
        )}
        {canStart && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStart(loop.projectId);
            }}
            className="px-3 py-1 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 transition-colors"
            title="Start loop"
          >
            Start
          </button>
        )}
      </td>
    </tr>
  );
};
