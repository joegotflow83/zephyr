/**
 * Convenience hook for accessing projects from the global store.
 *
 * Provides the projects list and CRUD operations, automatically
 * keeping UI in sync with the main process via IPC.
 */

import { useAppStore } from '../stores/app-store';
import type { ProjectConfig } from '../../shared/models';

export interface UseProjectsResult {
  projects: ProjectConfig[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  add: (
    config: Omit<ProjectConfig, 'id' | 'created_at' | 'updated_at'>
  ) => Promise<ProjectConfig>;
  update: (
    id: string,
    updates: Partial<Omit<ProjectConfig, 'id' | 'created_at'>>
  ) => Promise<ProjectConfig>;
  remove: (id: string) => Promise<boolean>;
  get: (id: string) => ProjectConfig | undefined;
}

/**
 * Hook that provides projects state and operations.
 * All mutations automatically update the global store.
 */
export function useProjects(): UseProjectsResult {
  const projects = useAppStore((state) => state.projects);
  const loading = useAppStore((state) => state.projectsLoading);
  const error = useAppStore((state) => state.projectsError);
  const refresh = useAppStore((state) => state.refreshProjects);
  const addToStore = useAppStore((state) => state.addProject);
  const updateInStore = useAppStore((state) => state.updateProject);
  const removeFromStore = useAppStore((state) => state.removeProject);

  const add = async (
    config: Omit<ProjectConfig, 'id' | 'created_at' | 'updated_at'>
  ): Promise<ProjectConfig> => {
    const project = await window.api.projects.add(config);
    addToStore(project);
    return project;
  };

  const update = async (
    id: string,
    updates: Partial<Omit<ProjectConfig, 'id' | 'created_at'>>
  ): Promise<ProjectConfig> => {
    const project = await window.api.projects.update(id, updates);
    updateInStore(id, project);
    return project;
  };

  const remove = async (id: string): Promise<boolean> => {
    const success = await window.api.projects.remove(id);
    if (success) {
      removeFromStore(id);
    }
    return success;
  };

  const get = (id: string): ProjectConfig | undefined => {
    return projects.find((p) => p.id === id);
  };

  return {
    projects,
    loading,
    error,
    refresh,
    add,
    update,
    remove,
    get,
  };
}
