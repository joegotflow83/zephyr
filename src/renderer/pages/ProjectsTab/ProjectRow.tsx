import React from 'react';
import type { ProjectConfig } from '../../../shared/models';
import type { LoopState } from '../../../shared/loop-types';
import { LoopStatus } from '../../../shared/loop-types';
import type { VMInfo } from '../../../services/vm-manager';

interface ProjectRowProps {
  project: ProjectConfig;
  loop?: LoopState;
  vmInfo?: VMInfo | null;
  isDeleting?: boolean;
  isStartingVM?: boolean;
  isStoppingVM?: boolean;
  onEdit: (project: ProjectConfig) => void;
  onDelete: (project: ProjectConfig) => void;
  onRun: (project: ProjectConfig) => void;
  onStartVM?: (project: ProjectConfig) => void;
  onStopVM?: (project: ProjectConfig) => void;
}

/**
 * Single row component for displaying a project in the projects table.
 * Shows project details, current status, and action buttons.
 * For persistent VM projects, also shows VM status badge and Start/Stop VM buttons.
 */
export const ProjectRow: React.FC<ProjectRowProps> = ({
  project,
  loop,
  vmInfo,
  isDeleting = false,
  isStartingVM = false,
  isStoppingVM = false,
  onEdit,
  onDelete,
  onRun,
  onStartVM,
  onStopVM,
}) => {
  const isPersistentVM =
    project.sandbox_type === 'vm' && project.vm_config?.vm_mode === 'persistent';

  // Determine if the project is currently in an active loop state
  const isRunning = loop &&
    (loop.status === LoopStatus.STARTING ||
     loop.status === LoopStatus.RUNNING ||
     loop.status === LoopStatus.PAUSED ||
     loop.status === LoopStatus.STOPPING);

  // For persistent VMs: Run Loop requires VM to be running
  const vmStopped = isPersistentVM && vmInfo?.state !== 'Running';
  const runDisabled = !!isRunning || vmStopped;

  // Stop VM is disabled when a loop is actively running in the VM
  const stopVMDisabled = !!isRunning || isStoppingVM;

  // Status badge styling
  const getStatusBadge = () => {
    // If no loop or loop is in terminal state, show Idle
    if (!loop ||
        loop.status === LoopStatus.IDLE ||
        loop.status === LoopStatus.STOPPED ||
        loop.status === LoopStatus.COMPLETED ||
        loop.status === LoopStatus.FAILED) {
      return (
        <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
          Idle
        </span>
      );
    }

    // Active states
    let bgColor = 'bg-gray-100 dark:bg-gray-700';
    let textColor = 'text-gray-700 dark:text-gray-300';
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
        bgColor = 'bg-orange-900';
        textColor = 'text-orange-300';
        label = 'Stopping';
        break;
    }

    return (
      <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded ${bgColor} ${textColor}`}>
        {label}
      </span>
    );
  };

  const getVMStatusBadge = () => {
    if (!isPersistentVM) return null;

    const isVMRunning = vmInfo?.state === 'Running';
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded ${
          isVMRunning ? 'bg-green-900 text-green-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
        }`}
        title={`VM: ${vmInfo?.state ?? 'Unknown'}`}
      >
        <span>{isVMRunning ? '●' : '○'}</span>
        <span>{isVMRunning ? 'Running' : 'Stopped'}</span>
      </span>
    );
  };

  const getRunButtonTitle = () => {
    if (isRunning) return 'Already running';
    if (vmStopped) return 'Start the VM first';
    return 'Run this project';
  };

  return (
    <tr className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
        {project.name}
      </td>
      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 max-w-xs truncate" title={project.repo_url}>
        {project.repo_url}
      </td>
      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 max-w-xs truncate" title={project.docker_image}>
        {project.docker_image}
      </td>
      <td className="px-4 py-3 text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          {getStatusBadge()}
          {getVMStatusBadge()}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-right space-x-2">
        {isPersistentVM && (
          <>
            <button
              onClick={() => onStartVM?.(project)}
              disabled={isStartingVM || vmInfo?.state === 'Running'}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                isStartingVM || vmInfo?.state === 'Running'
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-green-700 text-white hover:bg-green-600'
              }`}
              title={isStartingVM ? 'Starting VM...' : vmInfo?.state === 'Running' ? 'VM is already running' : 'Start the VM'}
            >
              {isStartingVM ? 'Starting...' : 'Start VM'}
            </button>
            <button
              onClick={() => onStopVM?.(project)}
              disabled={stopVMDisabled}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                stopVMDisabled
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-yellow-700 text-white hover:bg-yellow-600'
              }`}
              title={
                isRunning
                  ? 'Stop the loop before stopping the VM'
                  : isStoppingVM
                  ? 'Stopping VM...'
                  : 'Stop the VM'
              }
            >
              {isStoppingVM ? 'Stopping...' : 'Stop VM'}
            </button>
          </>
        )}
        <button
          onClick={() => onRun(project)}
          disabled={runDisabled}
          className={`px-3 py-1 rounded font-medium transition-colors ${
            runDisabled
              ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
          title={getRunButtonTitle()}
        >
          Run
        </button>
        <button
          onClick={() => onEdit(project)}
          className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          title="Edit project"
        >
          Edit
        </button>
        <button
          onClick={() => onDelete(project)}
          disabled={isDeleting}
          className={`px-3 py-1 rounded font-medium transition-colors inline-flex items-center gap-1 ${
            isDeleting
              ? 'bg-red-900 text-red-400 cursor-not-allowed'
              : 'bg-red-700 text-white hover:bg-red-600'
          }`}
          title={isDeleting ? 'Deleting...' : 'Delete project'}
        >
          {isDeleting && (
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {isDeleting ? 'Deleting...' : 'Delete'}
        </button>
      </td>
    </tr>
  );
};
