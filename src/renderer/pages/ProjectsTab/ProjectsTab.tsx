import React, { useEffect } from 'react';
import { ProjectRow } from './ProjectRow';
import { useProjects } from '../../hooks/useProjects';
import { useLoops } from '../../hooks/useLoops';
import type { ProjectConfig } from '../../../shared/models';

interface ProjectsTabProps {
  onRunProject?: (projectId: string) => void;
}

/**
 * Projects tab page component.
 * Displays a table of all configured projects with CRUD actions.
 */
export const ProjectsTab: React.FC<ProjectsTabProps> = ({ onRunProject }) => {
  const { projects, loading, error, refresh } = useProjects();
  const { loops, get: getLoop } = useLoops();

  // Load projects on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = () => {
    // TODO: Open ProjectDialog in add mode (Task 7.2)
    console.log('Add project clicked');
  };

  const handleEdit = (project: ProjectConfig) => {
    // TODO: Open ProjectDialog in edit mode (Task 7.2)
    console.log('Edit project clicked:', project.id);
  };

  const handleDelete = (project: ProjectConfig) => {
    // TODO: Show ConfirmDialog then delete (Task 7.3)
    console.log('Delete project clicked:', project.id);
  };

  const handleRun = (project: ProjectConfig) => {
    // TODO: Start loop and switch to Loops tab (Task 7.4)
    console.log('Run project clicked:', project.id);
    if (onRunProject) {
      onRunProject(project.id);
    }
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
    </div>
  );
};
