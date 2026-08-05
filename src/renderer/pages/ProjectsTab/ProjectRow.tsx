import React from 'react';
import type { ProjectConfig } from '../../../shared/models';
import type { VMInfo } from '../../../services/vm-manager';

interface ProjectRowProps {
  project: ProjectConfig;
  vmInfo?: VMInfo | null;
  isDeleting?: boolean;
  isStartingVM?: boolean;
  isStoppingVM?: boolean;
  onEdit: (project: ProjectConfig) => void;
  onDelete: (project: ProjectConfig) => void;
  onPlan?: (project: ProjectConfig) => void;
  onWork?: (project: ProjectConfig) => void;
  /** True when a loop is running for this project — blocks work sessions. */
  hasRunningLoop?: boolean;
  onStartVM?: (project: ProjectConfig) => void;
  onStopVM?: (project: ProjectConfig) => void;
}

/**
 * Single row component for displaying a project in the projects table.
 * Shows project details and action buttons.
 * For persistent VM projects, also shows Start/Stop VM buttons.
 */
export const ProjectRow: React.FC<ProjectRowProps> = ({
  project,
  vmInfo,
  isDeleting = false,
  isStartingVM = false,
  isStoppingVM = false,
  onEdit,
  onDelete,
  onPlan,
  onWork,
  hasRunningLoop = false,
  onStartVM,
  onStopVM,
}) => {
  const isPersistentVM =
    project.sandbox_type === 'vm' && project.vm_config?.vm_mode === 'persistent';

  const stopVMDisabled = isStoppingVM;

  // Agent sessions mount local_path into a container built from docker_image, so
  // both are required before the buttons do anything useful.
  const planEnabled = Boolean(project.local_path && project.docker_image);
  // A work session edits the working tree, so it must not overlap with a loop.
  // The main process enforces this too; this is just the visible half.
  const workEnabled = planEnabled && !hasRunningLoop;

  return (
    <tr className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
        {project.name}
      </td>
      <td
        className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 max-w-xs truncate"
        title={project.repo_url}
      >
        {project.repo_url}
      </td>
      <td
        className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 max-w-xs truncate"
        title={project.docker_image}
      >
        {project.docker_image}
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
              title={
                isStartingVM
                  ? 'Starting VM...'
                  : vmInfo?.state === 'Running'
                    ? 'VM is already running'
                    : 'Start the VM'
              }
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
              title={isStoppingVM ? 'Stopping VM...' : 'Stop the VM'}
            >
              {isStoppingVM ? 'Stopping...' : 'Stop VM'}
            </button>
          </>
        )}
        {onPlan && (
          <button
            onClick={() => onPlan(project)}
            disabled={!planEnabled}
            className={`px-3 py-1 rounded font-medium transition-colors ${
              planEnabled
                ? 'bg-blue-700 text-white hover:bg-blue-600'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
            title={
              planEnabled
                ? 'Draft spec files with the configured LLM engine — the project is mounted read-only'
                : 'Requires a local path and a container image on this project'
            }
          >
            Plan
          </button>
        )}
        {onWork && (
          <button
            onClick={() => onWork(project)}
            disabled={!workEnabled}
            className={`px-3 py-1 rounded font-medium transition-colors ${
              workEnabled
                ? 'bg-purple-700 text-white hover:bg-purple-600'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
            title={
              workEnabled
                ? 'Chat with the configured LLM engine to change files in this project'
                : hasRunningLoop
                  ? 'A loop is running for this project — stop it before starting a work session'
                  : 'Requires a local path and a container image on this project'
            }
          >
            Work
          </button>
        )}
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
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          {isDeleting ? 'Deleting...' : 'Delete'}
        </button>
      </td>
    </tr>
  );
};
