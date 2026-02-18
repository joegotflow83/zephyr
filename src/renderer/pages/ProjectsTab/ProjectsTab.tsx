import React, { useEffect, useState } from 'react';
import { ProjectRow } from './ProjectRow';
import { useProjects } from '../../hooks/useProjects';
import { useLoops } from '../../hooks/useLoops';
import { ProjectDialog } from '../../components/ProjectDialog/ProjectDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog';
import type { ProjectConfig } from '../../../shared/models';
import { LoopMode } from '../../../shared/loop-types';

interface ToastMethods {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

interface ProjectsTabProps {
  onRunProject?: () => void;
  toast: ToastMethods;
}

/**
 * Projects tab page component.
 * Displays a table of all configured projects with CRUD actions.
 */
export const ProjectsTab: React.FC<ProjectsTabProps> = ({ onRunProject, toast }) => {
  const { projects, loading, error, refresh } = useProjects();
  const { get: getLoop } = useLoops();

  // Dialog state
  const [dialogMode, setDialogMode] = useState<'add' | 'edit' | null>(null);
  const [editingProject, setEditingProject] = useState<ProjectConfig | undefined>(undefined);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    project: ProjectConfig;
    show: boolean;
  } | null>(null);

  // Action loading states
  const [actionLoading, setActionLoading] = useState<{
    [key: string]: boolean;
  }>({});

  // Load projects on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = () => {
    setDialogMode('add');
    setEditingProject(undefined);
  };

  const handleEdit = (project: ProjectConfig) => {
    setDialogMode('edit');
    setEditingProject(project);
  };

  const handleDelete = (project: ProjectConfig) => {
    setConfirmDialog({ project, show: true });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDialog) return;

    const { project } = confirmDialog;
    setActionLoading({ ...actionLoading, [`delete-${project.id}`]: true });

    try {
      await window.api.projects.remove(project.id);
      toast.success(`Project "${project.name}" deleted successfully`);
      setConfirmDialog(null);
      refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to delete project: ${message}`);
    } finally {
      setActionLoading({ ...actionLoading, [`delete-${project.id}`]: false });
    }
  };

  const handleCancelDelete = () => {
    setConfirmDialog(null);
  };

  const handleRun = async (project: ProjectConfig) => {
    setActionLoading({ ...actionLoading, [`run-${project.id}`]: true });

    try {
      await window.api.loops.start({
        projectId: project.id,
        dockerImage: project.docker_image,
        mode: LoopMode.SINGLE,
      });
      toast.success(`Loop started for "${project.name}"`);
      if (onRunProject) {
        onRunProject();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to start loop: ${message}`);
    } finally {
      setActionLoading({ ...actionLoading, [`run-${project.id}`]: false });
    }
  };

  const handleDialogSave = async (config: ProjectConfig) => {
    const isEdit = dialogMode === 'edit';
    const actionKey = isEdit ? `edit-${config.id}` : 'add';
    setActionLoading({ ...actionLoading, [actionKey]: true });

    try {
      if (isEdit) {
        await window.api.projects.update(config.id, config);
        toast.success(`Project "${config.name}" updated successfully`);
      } else {
        await window.api.projects.add(config);
        toast.success(`Project "${config.name}" added successfully`);
      }

      setDialogMode(null);
      setEditingProject(undefined);
      refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to ${isEdit ? 'update' : 'add'} project: ${message}`);
    } finally {
      setActionLoading({ ...actionLoading, [actionKey]: false });
    }
  };

  const handleDialogClose = () => {
    setDialogMode(null);
    setEditingProject(undefined);
  };

  // Empty state
  if (!loading && projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">📁</div>
          <h2 className="text-2xl font-bold text-white mb-2">No Projects Yet</h2>
          <p className="text-gray-400 mb-6">
            Get started by adding your first AI loop project. Each project runs in its own Docker container.
          </p>
          <button
            onClick={handleAdd}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Add Your First Project
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-700">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-sm text-gray-400 mt-1">
            Manage your AI loop projects and Docker configurations
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          <span>+</span>
          Add Project
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="mx-6 mt-4 p-4 bg-red-900 bg-opacity-50 border border-red-700 rounded text-red-200">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center p-12">
          <div className="text-gray-400">Loading projects...</div>
        </div>
      )}

      {/* Projects table */}
      {!loading && projects.length > 0 && (
        <div className="flex-1 overflow-auto p-6">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Repository
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Docker Image
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  loop={getLoop(project.id)}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onRun={handleRun}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Project Dialog */}
      {dialogMode && (
        <ProjectDialog
          mode={dialogMode}
          project={editingProject}
          onSave={handleDialogSave}
          onClose={handleDialogClose}
        />
      )}

      {/* Confirm Delete Dialog */}
      {confirmDialog?.show && (
        <ConfirmDialog
          title="Delete Project"
          message={`Are you sure you want to delete "${confirmDialog.project.name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}
    </div>
  );
};
