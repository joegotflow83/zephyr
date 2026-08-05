import React, { useEffect, useMemo, useState } from 'react';
import { ProjectRow } from './ProjectRow';
import { useProjects } from '../../hooks/useProjects';
import { useAppStore } from '../../stores/app-store';
import { ProjectDialog } from '../../components/ProjectDialog/ProjectDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog';
import { AgentSessionDialog } from '../../components/AgentSessionDialog/AgentSessionDialog';
import type { ProjectConfig } from '../../../shared/models';
import { isLoopTerminal } from '../../../shared/loop-types';

interface ToastMethods {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

interface ProjectsTabProps {
  toast: ToastMethods;
}

/**
 * Projects tab page component.
 * Displays a table of all configured projects with CRUD actions.
 */
export const ProjectsTab: React.FC<ProjectsTabProps> = ({ toast }) => {
  const { projects, loading, error, refresh } = useProjects();
  const removeLoop = useAppStore((state) => state.removeLoop);
  const vmInfos = useAppStore((state) => state.vmInfos);
  const multipassAvailable = useAppStore((state) => state.multipassAvailable);
  const loops = useAppStore((state) => state.loops);

  // Search filter — matches against the columns shown in the table
  const [search, setSearch] = useState('');

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

  // Agent session state — the project whose session dialog is open, and its mode
  const [agentSession, setAgentSession] = useState<{
    project: ProjectConfig;
    mode: 'plan' | 'work';
  } | null>(null);

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

  const handlePlan = (project: ProjectConfig) => {
    setAgentSession({ project, mode: 'plan' });
  };

  const handleWork = (project: ProjectConfig) => {
    setAgentSession({ project, mode: 'work' });
  };

  // In plan mode the main process has already written the specs back to the
  // project store; refresh so the table and any open dialog reflect them.
  // Work mode writes through the bind mount, so there is nothing to read back.
  const handleSessionClose = (specFiles?: Record<string, string>) => {
    setAgentSession(null);
    if (specFiles) {
      const count = Object.keys(specFiles).length;
      toast.success(
        count === 1
          ? 'Saved 1 spec file to the project'
          : `Saved ${count} spec files to the project`
      );
      refresh();
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDialog) return;

    const { project } = confirmDialog;
    setActionLoading({ ...actionLoading, [`delete-${project.id}`]: true });

    try {
      await window.api.projects.remove(project.id);
      removeLoop(project.id);
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

  const handleStartVM = async (project: ProjectConfig) => {
    if (project.sandbox_type === 'vm' && !multipassAvailable) {
      toast.error('Multipass is not installed. Visit multipass.run to install.');
      return;
    }
    setActionLoading({ ...actionLoading, [`startvm-${project.id}`]: true });

    try {
      await window.api.vm.start(project.id, project.vm_config);
      toast.success(`VM started for "${project.name}"`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to start VM: ${message}`);
    } finally {
      setActionLoading({ ...actionLoading, [`startvm-${project.id}`]: false });
    }
  };

  const handleStopVM = async (project: ProjectConfig) => {
    setActionLoading({ ...actionLoading, [`stopvm-${project.id}`]: true });

    try {
      await window.api.vm.stop(project.id);
      toast.success(`VM stopped for "${project.name}"`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to stop VM: ${message}`);
    } finally {
      setActionLoading({ ...actionLoading, [`stopvm-${project.id}`]: false });
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

  // Projects with a live loop can't host a work session — two writers, one tree.
  const projectsWithRunningLoop = useMemo(
    () => new Set(loops.filter((l) => !isLoopTerminal(l.status)).map((l) => l.projectId)),
    [loops]
  );

  const query = search.trim().toLowerCase();

  const filteredProjects = useMemo(() => {
    if (!query) return projects;
    return projects.filter((p) =>
      [p.name, p.repo_url, p.docker_image].some((field) => field?.toLowerCase().includes(query))
    );
  }, [projects, query]);

  // Distinguishes "no projects configured" (show onboarding) from
  // "no projects match the search" (show a clearable no-results message).
  const isEmpty = !loading && projects.length === 0;
  const noMatches = !loading && projects.length > 0 && filteredProjects.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center h-full p-6">
          <div className="text-center max-w-md">
            <div className="text-6xl mb-4">📁</div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              No Projects Yet
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              Get started by adding your first AI loop project. Each project runs in its own Docker
              container.
            </p>
            <button
              onClick={handleAdd}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Add Your First Project
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      {!isEmpty && (
        <>
          <div className="flex items-center justify-between gap-4 p-6 border-b border-gray-200 dark:border-gray-700">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Projects</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Manage your AI loop projects and Docker configurations
              </p>
            </div>
            <div className="relative flex-1 max-w-xs ml-auto">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearch('');
                }}
                placeholder="Search projects..."
                aria-label="Search projects"
                className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                🔍
              </span>
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
              <div className="text-gray-500 dark:text-gray-400">Loading projects...</div>
            </div>
          )}

          {/* No search results */}
          {noMatches && (
            <div className="flex flex-col items-center justify-center flex-1 p-12 text-center">
              <div className="text-4xl mb-3">🔍</div>
              <p className="text-gray-500 dark:text-gray-400 mb-4">
                No projects match &ldquo;{search.trim()}&rdquo;
              </p>
              <button
                onClick={() => setSearch('')}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Clear search
              </button>
            </div>
          )}

          {/* Projects table */}
          {!loading && filteredProjects.length > 0 && (
            <div className="flex-1 overflow-auto p-6">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Repository
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Docker Image
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.map((project) => {
                    // Find VM info for persistent VM projects by matching the project's VM name
                    // stored in the vmInfos array. The VM name is keyed by name in the store.
                    const projectVMInfo =
                      project.sandbox_type === 'vm' && project.vm_config?.vm_mode === 'persistent'
                        ? (vmInfos.find((v) =>
                            v.name.startsWith(`zephyr-${project.id.slice(0, 8)}`)
                          ) ?? null)
                        : null;

                    return (
                      <ProjectRow
                        key={project.id}
                        project={project}
                        vmInfo={projectVMInfo}
                        isDeleting={!!actionLoading[`delete-${project.id}`]}
                        isStartingVM={!!actionLoading[`startvm-${project.id}`]}
                        isStoppingVM={!!actionLoading[`stopvm-${project.id}`]}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onPlan={handlePlan}
                        onWork={handleWork}
                        hasRunningLoop={projectsWithRunningLoop.has(project.id)}
                        onStartVM={handleStartVM}
                        onStopVM={handleStopVM}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
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
          loading={!!actionLoading[`delete-${confirmDialog.project.id}`]}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}

      {/* Agent Session Dialog (plan or work) */}
      {agentSession && (
        <AgentSessionDialog
          project={agentSession.project}
          mode={agentSession.mode}
          onClose={handleSessionClose}
        />
      )}
    </div>
  );
};
