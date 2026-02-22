/**
 * Global application state store using Zustand.
 *
 * This store manages:
 * - Projects list (from ProjectStore)
 * - Loop states (from LoopRunner)
 * - App settings (from ConfigManager)
 * - Docker connection status (from DockerHealthMonitor)
 *
 * The store is automatically updated by IPC event listeners set up
 * during app initialization.
 */

import { create } from 'zustand';
import type { ProjectConfig, AppSettings, ZephyrImage, ImageBuildConfig } from '../../shared/models';
import type { LoopState } from '../../shared/loop-types';
import type { DockerInfo } from '../../services/docker-manager';

/**
 * Complete application state shape
 */
export interface AppState {
  // Projects
  projects: ProjectConfig[];
  projectsLoading: boolean;
  projectsError: string | null;

  // Loops
  loops: LoopState[];
  loopsLoading: boolean;
  loopsError: string | null;

  // Settings
  settings: AppSettings | null;
  settingsLoading: boolean;
  settingsError: string | null;

  // Images
  images: ZephyrImage[];
  imagesLoading: boolean;
  imagesError: string | null;
  imageBuildProgress: string | null;
  imageBuildActive: boolean;

  // Docker status
  dockerConnected: boolean;
  dockerInfo: DockerInfo | undefined;

  // Actions
  setProjects: (projects: ProjectConfig[]) => void;
  setProjectsLoading: (loading: boolean) => void;
  setProjectsError: (error: string | null) => void;
  addProject: (project: ProjectConfig) => void;
  updateProject: (id: string, updates: Partial<ProjectConfig>) => void;
  removeProject: (id: string) => void;
  refreshProjects: () => Promise<void>;

  setLoops: (loops: LoopState[]) => void;
  setLoopsLoading: (loading: boolean) => void;
  setLoopsError: (error: string | null) => void;
  updateLoop: (state: LoopState) => void;
  removeLoop: (projectId: string) => void;
  refreshLoops: () => Promise<void>;

  setSettings: (settings: AppSettings) => void;
  setSettingsLoading: (loading: boolean) => void;
  setSettingsError: (error: string | null) => void;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  refreshSettings: () => Promise<void>;

  setImages: (images: ZephyrImage[]) => void;
  setImagesLoading: (loading: boolean) => void;
  setImagesError: (error: string | null) => void;
  setImageBuildProgress: (progress: string | null) => void;
  setImageBuildActive: (active: boolean) => void;
  refreshImages: () => Promise<void>;
  buildImage: (config: ImageBuildConfig) => Promise<void>;
  deleteImage: (id: string) => Promise<void>;
  rebuildImage: (id: string) => Promise<void>;

  setDockerStatus: (connected: boolean, info?: DockerInfo) => void;
}

/**
 * Zustand store with actions and state.
 * All IPC calls are wrapped with error handling.
 */
export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  projects: [],
  projectsLoading: false,
  projectsError: null,

  loops: [],
  loopsLoading: false,
  loopsError: null,

  settings: null,
  settingsLoading: false,
  settingsError: null,

  images: [],
  imagesLoading: false,
  imagesError: null,
  imageBuildProgress: null,
  imageBuildActive: false,

  dockerConnected: false,
  dockerInfo: undefined,

  // Project actions
  setProjects: (projects) => set({ projects, projectsError: null }),
  setProjectsLoading: (loading) => set({ projectsLoading: loading }),
  setProjectsError: (error) => set({ projectsError: error }),

  addProject: (project) =>
    set((state) => ({
      projects: [...state.projects, project],
    })),

  updateProject: (id, updates) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    })),

  removeProject: (id) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
    })),

  refreshProjects: async () => {
    set({ projectsLoading: true, projectsError: null });
    try {
      const projects = await window.api.projects.list();
      set({ projects, projectsLoading: false });
    } catch (error) {
      set({
        projectsError: error instanceof Error ? error.message : 'Unknown error',
        projectsLoading: false,
      });
    }
  },

  // Loop actions
  setLoops: (loops) => set({ loops, loopsError: null }),
  setLoopsLoading: (loading) => set({ loopsLoading: loading }),
  setLoopsError: (error) => set({ loopsError: error }),

  updateLoop: (state) =>
    set((prevState) => {
      const existing = prevState.loops.find((l) => l.projectId === state.projectId);
      if (existing) {
        // Update existing loop
        return {
          loops: prevState.loops.map((l) =>
            l.projectId === state.projectId ? state : l
          ),
        };
      } else {
        // Add new loop
        return {
          loops: [...prevState.loops, state],
        };
      }
    }),

  removeLoop: (projectId) =>
    set((state) => ({
      loops: state.loops.filter((l) => l.projectId !== projectId),
    })),

  refreshLoops: async () => {
    set({ loopsLoading: true, loopsError: null });
    try {
      const loops = await window.api.loops.list();
      set({ loops, loopsLoading: false });
    } catch (error) {
      set({
        loopsError: error instanceof Error ? error.message : 'Unknown error',
        loopsLoading: false,
      });
    }
  },

  // Settings actions
  setSettings: (settings) => set({ settings, settingsError: null }),
  setSettingsLoading: (loading) => set({ settingsLoading: loading }),
  setSettingsError: (error) => set({ settingsError: error }),

  updateSettings: async (updates) => {
    const currentSettings = get().settings;
    if (!currentSettings) {
      throw new Error('Settings not loaded');
    }
    const newSettings = { ...currentSettings, ...updates };
    set({ settingsLoading: true, settingsError: null });
    try {
      await window.api.settings.save(newSettings);
      set({ settings: newSettings, settingsLoading: false });
    } catch (error) {
      set({
        settingsError: error instanceof Error ? error.message : 'Unknown error',
        settingsLoading: false,
      });
      throw error;
    }
  },

  refreshSettings: async () => {
    set({ settingsLoading: true, settingsError: null });
    try {
      const settings = await window.api.settings.load();
      set({ settings, settingsLoading: false });
    } catch (error) {
      set({
        settingsError: error instanceof Error ? error.message : 'Unknown error',
        settingsLoading: false,
      });
    }
  },

  // Image actions
  setImages: (images) => set({ images, imagesError: null }),
  setImagesLoading: (loading) => set({ imagesLoading: loading }),
  setImagesError: (error) => set({ imagesError: error }),
  setImageBuildProgress: (progress) => set({ imageBuildProgress: progress }),
  setImageBuildActive: (active) => set({ imageBuildActive: active }),

  refreshImages: async () => {
    set({ imagesLoading: true, imagesError: null });
    try {
      const images = await window.api.images.list();
      set({ images, imagesLoading: false });
    } catch (error) {
      set({
        imagesError: error instanceof Error ? error.message : 'Unknown error',
        imagesLoading: false,
      });
    }
  },

  buildImage: async (config) => {
    set({ imageBuildActive: true, imageBuildProgress: null });
    try {
      await window.api.images.build(config);
      await get().refreshImages();
    } finally {
      set({ imageBuildActive: false });
    }
  },

  deleteImage: async (id) => {
    await window.api.images.delete(id);
    await get().refreshImages();
  },

  rebuildImage: async (id) => {
    set({ imageBuildActive: true, imageBuildProgress: null });
    try {
      await window.api.images.rebuild(id);
      await get().refreshImages();
    } finally {
      set({ imageBuildActive: false });
    }
  },

  // Docker actions
  setDockerStatus: (connected, info) =>
    set({ dockerConnected: connected, dockerInfo: info }),
}));

/**
 * Initialize IPC event listeners to keep store in sync with main process.
 * Call this once on app mount.
 */
export function initializeStoreListeners() {
  // Docker status changes
  window.api.docker.onStatusChanged((isAvailable) => {
    useAppStore.getState().setDockerStatus(isAvailable);
    // Re-query status to get full info
    window.api.docker
      .status()
      .then((result) => {
        if (result.available) {
          useAppStore.getState().setDockerStatus(true, result.info);
        } else {
          useAppStore.getState().setDockerStatus(false, undefined);
        }
      })
      .catch(() => {
        useAppStore.getState().setDockerStatus(false, undefined);
      });
  });

  // Loop state changes
  window.api.loops.onStateChanged((state) => {
    useAppStore.getState().updateLoop(state);
  });

  // Image build progress
  window.api.images.onBuildProgress((line) => {
    useAppStore.getState().setImageBuildProgress(line);
  });

  // Initial data load
  useAppStore.getState().refreshProjects();
  useAppStore.getState().refreshLoops();
  useAppStore.getState().refreshSettings();
  useAppStore.getState().refreshImages();

  // Initial Docker status
  window.api.docker
    .status()
    .then((result) => {
      if (result.available) {
        useAppStore.getState().setDockerStatus(true, result.info);
      } else {
        useAppStore.getState().setDockerStatus(false, undefined);
      }
    })
    .catch(() => {
      useAppStore.getState().setDockerStatus(false, undefined);
    });
}
