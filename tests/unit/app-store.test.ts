/**
 * Tests for the global Zustand app store.
 *
 * Tests state management for projects, loops, settings, and Docker status.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useAppStore, initializeStoreListeners } from '../../src/renderer/stores/app-store';
import type { ProjectConfig, AppSettings } from '../../src/shared/models';
import type { LoopState } from '../../src/shared/loop-types';
import { LoopStatus, LoopMode } from '../../src/shared/loop-types';
import type { DockerInfo } from '../../src/services/docker-manager';

// Mock window.api
const mockApi = {
  projects: {
    list: vi.fn(),
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  loops: {
    list: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    remove: vi.fn(),
    schedule: vi.fn(),
    cancelSchedule: vi.fn(),
    listScheduled: vi.fn(),
    onStateChanged: vi.fn(() => vi.fn()),
    onLogLine: vi.fn(() => vi.fn()),
  },
  settings: {
    load: vi.fn(),
    save: vi.fn(),
  },
  docker: {
    status: vi.fn(),
    onStatusChanged: vi.fn(() => vi.fn()),
    onPullProgress: vi.fn(() => vi.fn()),
  },
};

(global as any).window = { api: mockApi };

describe('useAppStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useAppStore.setState({
      projects: [],
      projectsLoading: false,
      projectsError: null,
      loops: [],
      loopsLoading: false,
      loopsError: null,
      settings: null,
      settingsLoading: false,
      settingsError: null,
      dockerConnected: false,
      dockerInfo: undefined,
    });
    vi.clearAllMocks();
  });

  describe('projects', () => {
    it('should initialize with empty projects list', () => {
      const state = useAppStore.getState();
      expect(state.projects).toEqual([]);
      expect(state.projectsLoading).toBe(false);
      expect(state.projectsError).toBe(null);
    });

    it('should set projects', () => {
      const projects: ProjectConfig[] = [
        {
          id: '1',
          name: 'Test Project',
          repo_url: 'https://github.com/test/repo',
          jtbd: 'Test JTBD',
          docker_image: 'ubuntu:24.04',
          custom_prompts: {},
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];
      useAppStore.getState().setProjects(projects);
      expect(useAppStore.getState().projects).toEqual(projects);
      expect(useAppStore.getState().projectsError).toBe(null);
    });

    it('should add a project', () => {
      const project: ProjectConfig = {
        id: '1',
        name: 'New Project',
        repo_url: 'https://github.com/test/new',
        jtbd: 'New JTBD',
        docker_image: 'ubuntu:24.04',
        custom_prompts: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      useAppStore.getState().addProject(project);
      expect(useAppStore.getState().projects).toHaveLength(1);
      expect(useAppStore.getState().projects[0]).toEqual(project);
    });

    it('should update a project', () => {
      const project: ProjectConfig = {
        id: '1',
        name: 'Original Name',
        repo_url: 'https://github.com/test/repo',
        jtbd: 'Original JTBD',
        docker_image: 'ubuntu:24.04',
        custom_prompts: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      useAppStore.getState().addProject(project);
      useAppStore.getState().updateProject('1', { name: 'Updated Name' });
      expect(useAppStore.getState().projects[0].name).toBe('Updated Name');
    });

    it('should remove a project', () => {
      const project: ProjectConfig = {
        id: '1',
        name: 'Test Project',
        repo_url: 'https://github.com/test/repo',
        jtbd: 'Test JTBD',
        docker_image: 'ubuntu:24.04',
        custom_prompts: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      useAppStore.getState().addProject(project);
      useAppStore.getState().removeProject('1');
      expect(useAppStore.getState().projects).toHaveLength(0);
    });

    it('should refresh projects from API', async () => {
      const projects: ProjectConfig[] = [
        {
          id: '1',
          name: 'Test Project',
          repo_url: 'https://github.com/test/repo',
          jtbd: 'Test JTBD',
          docker_image: 'ubuntu:24.04',
          custom_prompts: {},
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];
      mockApi.projects.list.mockResolvedValue(projects);

      await useAppStore.getState().refreshProjects();

      expect(mockApi.projects.list).toHaveBeenCalled();
      expect(useAppStore.getState().projects).toEqual(projects);
      expect(useAppStore.getState().projectsLoading).toBe(false);
    });

    it('should handle refresh error', async () => {
      mockApi.projects.list.mockRejectedValue(new Error('API error'));

      await useAppStore.getState().refreshProjects();

      expect(useAppStore.getState().projectsError).toBe('API error');
      expect(useAppStore.getState().projectsLoading).toBe(false);
    });
  });

  describe('loops', () => {
    it('should initialize with empty loops list', () => {
      const state = useAppStore.getState();
      expect(state.loops).toEqual([]);
      expect(state.loopsLoading).toBe(false);
      expect(state.loopsError).toBe(null);
    });

    it('should set loops', () => {
      const loops: LoopState[] = [
        {
          projectId: '1',
          containerId: 'container-1',
          mode: LoopMode.SINGLE,
          status: LoopStatus.RUNNING,
          iteration: 1,
          startedAt: '2024-01-01T00:00:00Z',
          stoppedAt: null,
          logs: [],
          commits: [],
          errors: 0,
          error: null,
        },
      ];
      useAppStore.getState().setLoops(loops);
      expect(useAppStore.getState().loops).toEqual(loops);
      expect(useAppStore.getState().loopsError).toBe(null);
    });

    it('should update an existing loop', () => {
      const loop: LoopState = {
        projectId: '1',
        containerId: 'container-1',
        mode: LoopMode.SINGLE,
        status: LoopStatus.STARTING,
        iteration: 0,
        startedAt: '2024-01-01T00:00:00Z',
        stoppedAt: null,
        logs: [],
        commits: [],
        errors: 0,
        error: null,
      };
      useAppStore.getState().setLoops([loop]);

      const updatedLoop: LoopState = {
        ...loop,
        status: LoopStatus.RUNNING,
        iteration: 1,
      };
      useAppStore.getState().updateLoop(updatedLoop);

      expect(useAppStore.getState().loops[0].status).toBe(LoopStatus.RUNNING);
      expect(useAppStore.getState().loops[0].iteration).toBe(1);
    });

    it('should add a new loop if not exists', () => {
      const loop: LoopState = {
        projectId: '1',
        containerId: 'container-1',
        mode: LoopMode.SINGLE,
        status: LoopStatus.RUNNING,
        iteration: 1,
        startedAt: '2024-01-01T00:00:00Z',
        stoppedAt: null,
        logs: [],
        commits: [],
        errors: 0,
        error: null,
      };
      useAppStore.getState().updateLoop(loop);
      expect(useAppStore.getState().loops).toHaveLength(1);
      expect(useAppStore.getState().loops[0]).toEqual(loop);
    });

    it('should remove a loop', () => {
      const loop: LoopState = {
        projectId: '1',
        containerId: 'container-1',
        mode: LoopMode.SINGLE,
        status: LoopStatus.RUNNING,
        iteration: 1,
        startedAt: '2024-01-01T00:00:00Z',
        stoppedAt: null,
        logs: [],
        commits: [],
        errors: 0,
        error: null,
      };
      useAppStore.getState().setLoops([loop]);
      useAppStore.getState().removeLoop('1');
      expect(useAppStore.getState().loops).toHaveLength(0);
    });

    it('should refresh loops from API', async () => {
      const loops: LoopState[] = [
        {
          projectId: '1',
          containerId: 'container-1',
          mode: LoopMode.SINGLE,
          status: LoopStatus.RUNNING,
          iteration: 1,
          startedAt: '2024-01-01T00:00:00Z',
          stoppedAt: null,
          logs: [],
          commits: [],
          errors: 0,
          error: null,
        },
      ];
      mockApi.loops.list.mockResolvedValue(loops);

      await useAppStore.getState().refreshLoops();

      expect(mockApi.loops.list).toHaveBeenCalled();
      expect(useAppStore.getState().loops).toEqual(loops);
      expect(useAppStore.getState().loopsLoading).toBe(false);
    });

    it('should handle refresh error', async () => {
      mockApi.loops.list.mockRejectedValue(new Error('API error'));

      await useAppStore.getState().refreshLoops();

      expect(useAppStore.getState().loopsError).toBe('API error');
      expect(useAppStore.getState().loopsLoading).toBe(false);
    });
  });

  describe('settings', () => {
    it('should initialize with null settings', () => {
      const state = useAppStore.getState();
      expect(state.settings).toBe(null);
      expect(state.settingsLoading).toBe(false);
      expect(state.settingsError).toBe(null);
    });

    it('should set settings', () => {
      const settings: AppSettings = {
        max_concurrent_containers: 5,
        notification_enabled: true,
        theme: 'dark',
        log_level: 'INFO',
      };
      useAppStore.getState().setSettings(settings);
      expect(useAppStore.getState().settings).toEqual(settings);
      expect(useAppStore.getState().settingsError).toBe(null);
    });

    it('should refresh settings from API', async () => {
      const settings: AppSettings = {
        max_concurrent_containers: 5,
        notification_enabled: true,
        theme: 'dark',
        log_level: 'INFO',
      };
      mockApi.settings.load.mockResolvedValue(settings);

      await useAppStore.getState().refreshSettings();

      expect(mockApi.settings.load).toHaveBeenCalled();
      expect(useAppStore.getState().settings).toEqual(settings);
      expect(useAppStore.getState().settingsLoading).toBe(false);
    });

    it('should update settings via API', async () => {
      const settings: AppSettings = {
        max_concurrent_containers: 5,
        notification_enabled: true,
        theme: 'dark',
        log_level: 'INFO',
      };
      useAppStore.getState().setSettings(settings);
      mockApi.settings.save.mockResolvedValue(undefined);

      await useAppStore.getState().updateSettings({ theme: 'light' });

      expect(mockApi.settings.save).toHaveBeenCalledWith({
        ...settings,
        theme: 'light',
      });
      expect(useAppStore.getState().settings?.theme).toBe('light');
    });

    it('should throw if settings not loaded', async () => {
      await expect(
        useAppStore.getState().updateSettings({ theme: 'light' })
      ).rejects.toThrow('Settings not loaded');
    });

    it('should handle update error', async () => {
      const settings: AppSettings = {
        max_concurrent_containers: 5,
        notification_enabled: true,
        theme: 'dark',
        log_level: 'INFO',
      };
      useAppStore.getState().setSettings(settings);
      mockApi.settings.save.mockRejectedValue(new Error('Save failed'));

      await expect(
        useAppStore.getState().updateSettings({ theme: 'light' })
      ).rejects.toThrow('Save failed');

      expect(useAppStore.getState().settingsError).toBe('Save failed');
    });

    it('should handle refresh error', async () => {
      mockApi.settings.load.mockRejectedValue(new Error('Load failed'));

      await useAppStore.getState().refreshSettings();

      expect(useAppStore.getState().settingsError).toBe('Load failed');
      expect(useAppStore.getState().settingsLoading).toBe(false);
    });
  });

  describe('docker status', () => {
    it('should initialize with disconnected status', () => {
      const state = useAppStore.getState();
      expect(state.dockerConnected).toBe(false);
      expect(state.dockerInfo).toBeUndefined();
    });

    it('should set docker status', () => {
      const dockerInfo: DockerInfo = {
        version: '24.0.0',
        os: 'linux',
        arch: 'x86_64',
        memTotal: 16000000000,
      };
      useAppStore.getState().setDockerStatus(true, dockerInfo);
      expect(useAppStore.getState().dockerConnected).toBe(true);
      expect(useAppStore.getState().dockerInfo).toEqual(dockerInfo);
    });

    it('should set disconnected status', () => {
      const dockerInfo: DockerInfo = {
        version: '24.0.0',
        os: 'linux',
        arch: 'x86_64',
        memTotal: 16000000000,
      };
      useAppStore.getState().setDockerStatus(true, dockerInfo);
      useAppStore.getState().setDockerStatus(false, undefined);
      expect(useAppStore.getState().dockerConnected).toBe(false);
      expect(useAppStore.getState().dockerInfo).toBeUndefined();
    });
  });

  describe('initializeStoreListeners', () => {
    let dockerStatusCallback: (available: boolean) => void;
    let loopStateCallback: (state: LoopState) => void;

    beforeEach(() => {
      mockApi.docker.onStatusChanged.mockImplementation((callback) => {
        dockerStatusCallback = callback;
        return vi.fn();
      });
      mockApi.loops.onStateChanged.mockImplementation((callback) => {
        loopStateCallback = callback;
        return vi.fn();
      });
      mockApi.docker.status.mockResolvedValue({ available: false });
      mockApi.projects.list.mockResolvedValue([]);
      mockApi.loops.list.mockResolvedValue([]);
      mockApi.settings.load.mockResolvedValue({
        max_concurrent_containers: 5,
        notification_enabled: true,
        theme: 'system',
        log_level: 'INFO',
      });
    });

    it('should register Docker status listener', async () => {
      initializeStoreListeners();
      expect(mockApi.docker.onStatusChanged).toHaveBeenCalled();

      const dockerInfo: DockerInfo = {
        version: '24.0.0',
        os: 'linux',
        arch: 'x86_64',
        memTotal: 16000000000,
      };
      mockApi.docker.status.mockResolvedValue({ available: true, info: dockerInfo });

      dockerStatusCallback(true);
      // Wait for async status query
      await new Promise((resolve) => setTimeout(resolve, 10));

      const state = useAppStore.getState();
      expect(state.dockerConnected).toBe(true);
    });

    it('should register loop state listener', () => {
      initializeStoreListeners();
      expect(mockApi.loops.onStateChanged).toHaveBeenCalled();

      const loopState: LoopState = {
        projectId: '1',
        containerId: 'container-1',
        mode: LoopMode.SINGLE,
        status: LoopStatus.RUNNING,
        iteration: 1,
        startedAt: '2024-01-01T00:00:00Z',
        stoppedAt: null,
        logs: [],
        commits: [],
        errors: 0,
        error: null,
      };

      loopStateCallback(loopState);

      const state = useAppStore.getState();
      expect(state.loops).toHaveLength(1);
      expect(state.loops[0]).toEqual(loopState);
    });

    it('should load initial data', async () => {
      initializeStoreListeners();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockApi.projects.list).toHaveBeenCalled();
      expect(mockApi.loops.list).toHaveBeenCalled();
      expect(mockApi.settings.load).toHaveBeenCalled();
      expect(mockApi.docker.status).toHaveBeenCalled();
    });
  });
});
