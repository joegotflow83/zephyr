/**
 * Unit tests for src/services/project-store.ts
 *
 * ProjectStore owns all CRUD logic for projects.json. Tests use a mock
 * ConfigManager so no real disk I/O occurs. This keeps tests fast and
 * deterministic — the atomic write safety is already covered by
 * config-manager.test.ts.
 *
 * Why these tests matter: duplicate detection and not-found handling are
 * guard rails that prevent silent data corruption (e.g. two projects sharing
 * an ID would make getProject non-deterministic).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectStore } from '../../src/services/project-store';
import { ConfigManager } from '../../src/services/config-manager';
import { ProjectConfig } from '../../src/shared/models';

// ---------------------------------------------------------------------------
// Mock ConfigManager
// ---------------------------------------------------------------------------

function makeMockConfigManager(initial: ProjectConfig[] | null = null): ConfigManager {
  let store: ProjectConfig[] | null = initial;

  const mockSaveJson = vi.fn((filename: string, data: unknown) => {
    if (filename === 'projects.json') {
      store = data as ProjectConfig[];
    }
  });

  const mockLoadJson = vi.fn(<T>(filename: string): T | null => {
    if (filename === 'projects.json') {
      return store as unknown as T;
    }
    return null;
  });

  const cm = {
    loadJson: mockLoadJson,
    saveJson: mockSaveJson,
    getConfigDir: vi.fn(() => '/tmp/zephyr-test'),
    ensureConfigDir: vi.fn(),
  } as unknown as ConfigManager;

  return cm;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: 'test-id-1',
    name: 'Test Project',
    repo_url: 'https://github.com/example/repo',
    docker_image: 'ubuntu:24.04',
    pre_validation_scripts: [],
    custom_prompts: {},
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectStore', () => {
  // -------------------------------------------------------------------------
  // listProjects
  // -------------------------------------------------------------------------

  describe('listProjects', () => {
    it('returns an empty array when no file exists', () => {
      const cm = makeMockConfigManager(null);
      const store = new ProjectStore(cm);
      expect(store.listProjects()).toEqual([]);
    });

    it('returns all projects from file', () => {
      const projects = [makeProject({ id: 'a' }), makeProject({ id: 'b' })];
      const cm = makeMockConfigManager(projects);
      const store = new ProjectStore(cm);
      expect(store.listProjects()).toHaveLength(2);
      expect(store.listProjects().map((p) => p.id)).toEqual(['a', 'b']);
    });

    it('calls loadJson with projects.json filename', () => {
      const cm = makeMockConfigManager([]);
      const store = new ProjectStore(cm);
      store.listProjects();
      expect(cm.loadJson).toHaveBeenCalledWith('projects.json');
    });
  });

  // -------------------------------------------------------------------------
  // getProject
  // -------------------------------------------------------------------------

  describe('getProject', () => {
    it('returns the matching project by id', () => {
      const project = makeProject({ id: 'find-me' });
      const cm = makeMockConfigManager([project]);
      const store = new ProjectStore(cm);
      expect(store.getProject('find-me')).toEqual(project);
    });

    it('returns null when id is not found', () => {
      const cm = makeMockConfigManager([makeProject({ id: 'exists' })]);
      const store = new ProjectStore(cm);
      expect(store.getProject('nope')).toBeNull();
    });

    it('returns null when the store is empty', () => {
      const cm = makeMockConfigManager([]);
      const store = new ProjectStore(cm);
      expect(store.getProject('any-id')).toBeNull();
    });

    it('returns null when no file exists yet', () => {
      const cm = makeMockConfigManager(null);
      const store = new ProjectStore(cm);
      expect(store.getProject('any-id')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // addProject
  // -------------------------------------------------------------------------

  describe('addProject', () => {
    it('returns a complete ProjectConfig with id and timestamps', () => {
      const cm = makeMockConfigManager([]);
      const store = new ProjectStore(cm);
      const result = store.addProject({ name: 'My Project' });

      expect(result.id).toBeTruthy();
      expect(result.name).toBe('My Project');
      expect(result.created_at).toBeTruthy();
      expect(result.updated_at).toBeTruthy();
    });

    it('persists the new project via saveJson', () => {
      const cm = makeMockConfigManager([]);
      const store = new ProjectStore(cm);
      store.addProject({ name: 'Saved Project' });
      expect(cm.saveJson).toHaveBeenCalledWith('projects.json', expect.any(Array));
    });

    it('the saved array includes the new project', () => {
      const cm = makeMockConfigManager([]);
      const store = new ProjectStore(cm);
      const result = store.addProject({ name: 'New Project' });

      const saved = (cm.saveJson as ReturnType<typeof vi.fn>).mock.calls[0][1] as ProjectConfig[];
      expect(saved.find((p) => p.id === result.id)).toBeDefined();
    });

    it('appends to existing projects without removing them', () => {
      const existing = makeProject({ id: 'existing-1' });
      const cm = makeMockConfigManager([existing]);
      const store = new ProjectStore(cm);
      store.addProject({ name: 'New' });

      const saved = (cm.saveJson as ReturnType<typeof vi.fn>).mock.calls[0][1] as ProjectConfig[];
      expect(saved).toHaveLength(2);
      expect(saved[0].id).toBe('existing-1');
    });

    it('uses a provided id when given', () => {
      const cm = makeMockConfigManager([]);
      const store = new ProjectStore(cm);
      const result = store.addProject({ id: 'my-custom-id', name: 'X' });
      expect(result.id).toBe('my-custom-id');
    });

    it('throws when a project with the same id already exists', () => {
      const existing = makeProject({ id: 'dupe-id' });
      const cm = makeMockConfigManager([existing]);
      const store = new ProjectStore(cm);

      expect(() => store.addProject({ id: 'dupe-id', name: 'Dupe' })).toThrow(
        'Project with id "dupe-id" already exists'
      );
    });

    it('does not save when duplicate is detected', () => {
      const existing = makeProject({ id: 'dupe-id' });
      const cm = makeMockConfigManager([existing]);
      const store = new ProjectStore(cm);

      try {
        store.addProject({ id: 'dupe-id', name: 'Dupe' });
      } catch {
        // expected
      }

      expect(cm.saveJson).not.toHaveBeenCalled();
    });

    it('generates unique ids for sequential adds', () => {
      const cm = makeMockConfigManager([]);
      const store = new ProjectStore(cm);
      const a = store.addProject({ name: 'A' });

      // Update the mock to reflect what was saved after first add
      const savedAfterFirst = (cm.saveJson as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as ProjectConfig[];
      (cm.loadJson as ReturnType<typeof vi.fn>).mockReturnValue(savedAfterFirst);

      const b = store.addProject({ name: 'B' });
      expect(a.id).not.toBe(b.id);
    });

    it('sets created_at and updated_at to the same value on creation', () => {
      const cm = makeMockConfigManager([]);
      const store = new ProjectStore(cm);
      const result = store.addProject({ name: 'Timestamps' });
      expect(result.created_at).toBe(result.updated_at);
    });
  });

  // -------------------------------------------------------------------------
  // updateProject
  // -------------------------------------------------------------------------

  describe('updateProject', () => {
    it('returns the updated project with merged fields', () => {
      const original = makeProject({ id: 'upd-1', name: 'Old Name' });
      const cm = makeMockConfigManager([original]);
      const store = new ProjectStore(cm);

      const result = store.updateProject('upd-1', { name: 'New Name' });
      expect(result.name).toBe('New Name');
    });

    it('preserves fields that were not changed', () => {
      const original = makeProject({ id: 'upd-2', repo_url: 'https://example.com' });
      const cm = makeMockConfigManager([original]);
      const store = new ProjectStore(cm);

      const result = store.updateProject('upd-2', { name: 'Changed' });
      expect(result.repo_url).toBe('https://example.com');
    });

    it('updates updated_at to a new timestamp', () => {
      const original = makeProject({ id: 'upd-3', updated_at: '2020-01-01T00:00:00.000Z' });
      const cm = makeMockConfigManager([original]);
      const store = new ProjectStore(cm);

      const result = store.updateProject('upd-3', { name: 'Changed' });
      expect(result.updated_at).not.toBe('2020-01-01T00:00:00.000Z');
    });

    it('does not change created_at', () => {
      const original = makeProject({ id: 'upd-4', created_at: '2020-01-01T00:00:00.000Z' });
      const cm = makeMockConfigManager([original]);
      const store = new ProjectStore(cm);

      const result = store.updateProject('upd-4', { name: 'Changed' });
      expect(result.created_at).toBe('2020-01-01T00:00:00.000Z');
    });

    it('preserves the id even if partial contains a different id', () => {
      const original = makeProject({ id: 'real-id' });
      const cm = makeMockConfigManager([original]);
      const store = new ProjectStore(cm);

      const result = store.updateProject('real-id', { id: 'injected-id', name: 'X' });
      expect(result.id).toBe('real-id');
    });

    it('saves the updated list via saveJson', () => {
      const original = makeProject({ id: 'save-check' });
      const cm = makeMockConfigManager([original]);
      const store = new ProjectStore(cm);

      store.updateProject('save-check', { name: 'Updated' });
      expect(cm.saveJson).toHaveBeenCalledWith('projects.json', expect.any(Array));
    });

    it('throws when the project id is not found', () => {
      const cm = makeMockConfigManager([]);
      const store = new ProjectStore(cm);
      expect(() => store.updateProject('ghost', { name: 'X' })).toThrow(
        'Project with id "ghost" not found'
      );
    });

    it('does not save when project is not found', () => {
      const cm = makeMockConfigManager([]);
      const store = new ProjectStore(cm);

      try {
        store.updateProject('ghost', { name: 'X' });
      } catch {
        // expected
      }

      expect(cm.saveJson).not.toHaveBeenCalled();
    });

    it('replaces only the updated project in the list', () => {
      const p1 = makeProject({ id: 'p1', name: 'One' });
      const p2 = makeProject({ id: 'p2', name: 'Two' });
      const cm = makeMockConfigManager([p1, p2]);
      const store = new ProjectStore(cm);

      store.updateProject('p1', { name: 'One Updated' });

      const saved = (cm.saveJson as ReturnType<typeof vi.fn>).mock.calls[0][1] as ProjectConfig[];
      expect(saved.find((p) => p.id === 'p1')?.name).toBe('One Updated');
      expect(saved.find((p) => p.id === 'p2')?.name).toBe('Two');
    });
  });

  // -------------------------------------------------------------------------
  // removeProject
  // -------------------------------------------------------------------------

  describe('removeProject', () => {
    it('returns true when the project is found and removed', () => {
      const project = makeProject({ id: 'rm-1' });
      const cm = makeMockConfigManager([project]);
      const store = new ProjectStore(cm);
      expect(store.removeProject('rm-1')).toBe(true);
    });

    it('returns false when the project id is not found', () => {
      const cm = makeMockConfigManager([]);
      const store = new ProjectStore(cm);
      expect(store.removeProject('ghost')).toBe(false);
    });

    it('saves the updated list after removal', () => {
      const project = makeProject({ id: 'rm-2' });
      const cm = makeMockConfigManager([project]);
      const store = new ProjectStore(cm);

      store.removeProject('rm-2');
      expect(cm.saveJson).toHaveBeenCalledWith('projects.json', expect.any(Array));
    });

    it('the saved list no longer contains the removed project', () => {
      const project = makeProject({ id: 'rm-3' });
      const cm = makeMockConfigManager([project]);
      const store = new ProjectStore(cm);

      store.removeProject('rm-3');
      const saved = (cm.saveJson as ReturnType<typeof vi.fn>).mock.calls[0][1] as ProjectConfig[];
      expect(saved.find((p) => p.id === 'rm-3')).toBeUndefined();
    });

    it('does not remove other projects', () => {
      const p1 = makeProject({ id: 'keep' });
      const p2 = makeProject({ id: 'remove' });
      const cm = makeMockConfigManager([p1, p2]);
      const store = new ProjectStore(cm);

      store.removeProject('remove');
      const saved = (cm.saveJson as ReturnType<typeof vi.fn>).mock.calls[0][1] as ProjectConfig[];
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe('keep');
    });

    it('does not call saveJson when project is not found', () => {
      const cm = makeMockConfigManager([]);
      const store = new ProjectStore(cm);
      store.removeProject('ghost');
      expect(cm.saveJson).not.toHaveBeenCalled();
    });

    it('returns false when store has no file', () => {
      const cm = makeMockConfigManager(null);
      const store = new ProjectStore(cm);
      expect(store.removeProject('any-id')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // clearDanglingPipelineId
  //
  // Why these tests matter: when a pipeline is deleted, projects referencing it
  // must have their pipelineId cleared so projects.json stays consistent and the
  // renderer can correctly gate the Factory button using the live pipeline list.
  // -------------------------------------------------------------------------

  describe('clearDanglingPipelineId', () => {
    it('returns 0 when no project references the given pipeline id', () => {
      const projects = [
        makeProject({ id: 'a', pipelineId: 'other-pipeline' }),
        makeProject({ id: 'b' }),
      ];
      const cm = makeMockConfigManager(projects);
      const store = new ProjectStore(cm);
      expect(store.clearDanglingPipelineId('deleted-pipeline')).toBe(0);
    });

    it('does not write when no project is affected', () => {
      const cm = makeMockConfigManager([makeProject({ id: 'a' })]);
      const store = new ProjectStore(cm);
      store.clearDanglingPipelineId('gone');
      expect(cm.saveJson).not.toHaveBeenCalled();
    });

    it('returns the count of affected projects', () => {
      const projects = [
        makeProject({ id: 'a', pipelineId: 'target' }),
        makeProject({ id: 'b', pipelineId: 'target' }),
        makeProject({ id: 'c', pipelineId: 'keep' }),
      ];
      const cm = makeMockConfigManager(projects);
      const store = new ProjectStore(cm);
      expect(store.clearDanglingPipelineId('target')).toBe(2);
    });

    it('clears pipelineId from affected projects in the saved list', () => {
      const projects = [
        makeProject({ id: 'a', pipelineId: 'del' }),
        makeProject({ id: 'b', pipelineId: 'keep' }),
      ];
      const cm = makeMockConfigManager(projects);
      const store = new ProjectStore(cm);

      store.clearDanglingPipelineId('del');

      const saved = (cm.saveJson as ReturnType<typeof vi.fn>).mock.calls[0][1] as ProjectConfig[];
      expect(saved.find((p) => p.id === 'a')?.pipelineId).toBeUndefined();
      expect(saved.find((p) => p.id === 'b')?.pipelineId).toBe('keep');
    });

    it('preserves all other fields on cleared projects', () => {
      const project = makeProject({
        id: 'a',
        name: 'My Project',
        pipelineId: 'del',
        factory_config: { enabled: true, roles: [] },
      });
      const cm = makeMockConfigManager([project]);
      const store = new ProjectStore(cm);

      store.clearDanglingPipelineId('del');

      const saved = (cm.saveJson as ReturnType<typeof vi.fn>).mock.calls[0][1] as ProjectConfig[];
      const result = saved[0];
      expect(result.name).toBe('My Project');
      expect(result.factory_config?.enabled).toBe(true);
      expect(result.pipelineId).toBeUndefined();
    });

    it('updates updated_at on cleared projects', () => {
      const project = makeProject({
        id: 'a',
        pipelineId: 'del',
        updated_at: '2020-01-01T00:00:00.000Z',
      });
      const cm = makeMockConfigManager([project]);
      const store = new ProjectStore(cm);

      store.clearDanglingPipelineId('del');

      const saved = (cm.saveJson as ReturnType<typeof vi.fn>).mock.calls[0][1] as ProjectConfig[];
      expect(saved[0].updated_at).not.toBe('2020-01-01T00:00:00.000Z');
    });

    it('is a no-op when the store has no file', () => {
      const cm = makeMockConfigManager(null);
      const store = new ProjectStore(cm);
      expect(store.clearDanglingPipelineId('any')).toBe(0);
      expect(cm.saveJson).not.toHaveBeenCalled();
    });

    it('performs a single batched write even when multiple projects are affected', () => {
      const projects = [
        makeProject({ id: 'a', pipelineId: 'del' }),
        makeProject({ id: 'b', pipelineId: 'del' }),
        makeProject({ id: 'c', pipelineId: 'del' }),
      ];
      const cm = makeMockConfigManager(projects);
      const store = new ProjectStore(cm);

      store.clearDanglingPipelineId('del');

      expect(cm.saveJson).toHaveBeenCalledTimes(1);
    });
  });
});
