/**
 * Unit tests for src/shared/models.ts
 *
 * Verifies that data model interfaces and helper functions produce valid,
 * correctly-defaulted objects. These models are the single source of truth
 * for all persisted data in Zephyr Desktop.
 */

import { describe, it, expect } from 'vitest';
import {
  createDefaultSettings,
  createProjectConfig,
  type AppSettings,
  type ProjectConfig,
} from '../../src/shared/models';

// UUID v4 regex: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ISO 8601 datetime regex (e.g. "2024-01-15T10:30:00.000Z")
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

describe('createDefaultSettings', () => {
  it('returns an AppSettings object with all required fields', () => {
    const settings = createDefaultSettings();
    expect(settings).toBeDefined();
    expect(typeof settings).toBe('object');
  });

  it('sets max_concurrent_containers to 5', () => {
    const settings = createDefaultSettings();
    expect(settings.max_concurrent_containers).toBe(5);
  });

  it('enables notifications by default', () => {
    const settings = createDefaultSettings();
    expect(settings.notification_enabled).toBe(true);
  });

  it('sets theme to "system" by default', () => {
    const settings = createDefaultSettings();
    expect(settings.theme).toBe('system');
  });

  it('sets log_level to "INFO" by default', () => {
    const settings = createDefaultSettings();
    expect(settings.log_level).toBe('INFO');
  });

  it('returns independent objects on each call (no shared reference)', () => {
    const a = createDefaultSettings();
    const b = createDefaultSettings();
    a.max_concurrent_containers = 99;
    expect(b.max_concurrent_containers).toBe(5);
  });

  it('satisfies the AppSettings type shape', () => {
    const settings: AppSettings = createDefaultSettings();
    // TypeScript compile-time check; runtime check for completeness
    expect(Object.keys(settings)).toEqual(
      expect.arrayContaining([
        'max_concurrent_containers',
        'notification_enabled',
        'theme',
        'log_level',
      ])
    );
  });
});

describe('createProjectConfig', () => {
  describe('UUID generation', () => {
    it('generates a valid UUID v4 when no id is provided', () => {
      const project = createProjectConfig();
      expect(project.id).toMatch(UUID_V4_RE);
    });

    it('generates unique UUIDs on each call', () => {
      const ids = Array.from({ length: 10 }, () => createProjectConfig().id);
      const unique = new Set(ids);
      expect(unique.size).toBe(10);
    });

    it('preserves a provided id', () => {
      const customId = '11111111-1111-4111-8111-111111111111';
      const project = createProjectConfig({ id: customId });
      expect(project.id).toBe(customId);
    });
  });

  describe('timestamps', () => {
    it('sets created_at to a valid ISO 8601 timestamp', () => {
      const project = createProjectConfig();
      expect(project.created_at).toMatch(ISO_8601_RE);
    });

    it('sets updated_at to a valid ISO 8601 timestamp', () => {
      const project = createProjectConfig();
      expect(project.updated_at).toMatch(ISO_8601_RE);
    });

    it('created_at and updated_at are equal on creation (no partial timestamps)', () => {
      const project = createProjectConfig();
      // Both should be set from the same `now` value
      expect(project.created_at).toBe(project.updated_at);
    });

    it('preserves a provided created_at', () => {
      const ts = '2020-01-01T00:00:00.000Z';
      const project = createProjectConfig({ created_at: ts });
      expect(project.created_at).toBe(ts);
    });

    it('preserves a provided updated_at', () => {
      const ts = '2021-06-15T12:00:00.000Z';
      const project = createProjectConfig({ updated_at: ts });
      expect(project.updated_at).toBe(ts);
    });
  });

  describe('default field values', () => {
    it('defaults name to empty string', () => {
      const project = createProjectConfig();
      expect(project.name).toBe('');
    });

    it('defaults repo_url to empty string', () => {
      const project = createProjectConfig();
      expect(project.repo_url).toBe('');
    });

    it('defaults pre_validation_scripts to an empty array', () => {
      const project = createProjectConfig();
      expect(project.pre_validation_scripts).toEqual([]);
    });

    it('defaults image_id to undefined', () => {
      const project = createProjectConfig();
      expect(project.image_id).toBeUndefined();
    });

    it('defaults docker_image to "ubuntu:24.04"', () => {
      const project = createProjectConfig();
      expect(project.docker_image).toBe('ubuntu:24.04');
    });

    it('defaults custom_prompts to an empty object', () => {
      const project = createProjectConfig();
      expect(project.custom_prompts).toEqual({});
    });
  });

  describe('partial input handling', () => {
    it('applies provided name', () => {
      const project = createProjectConfig({ name: 'My Project' });
      expect(project.name).toBe('My Project');
    });

    it('applies provided repo_url', () => {
      const project = createProjectConfig({ repo_url: 'https://github.com/user/repo' });
      expect(project.repo_url).toBe('https://github.com/user/repo');
    });

    it('applies provided docker_image', () => {
      const project = createProjectConfig({ docker_image: 'node:20' });
      expect(project.docker_image).toBe('node:20');
    });

    it('applies provided custom_prompts', () => {
      const prompts = { 'AGENTS.md': '# My Agent\nDo something useful.' };
      const project = createProjectConfig({ custom_prompts: prompts });
      expect(project.custom_prompts).toEqual(prompts);
    });

    it('applies a complete partial, preserving all values', () => {
      const full: ProjectConfig = {
        id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        name: 'Full Project',
        repo_url: 'git@github.com:org/full.git',
        docker_image: 'python:3.12',
        pre_validation_scripts: ['lint.sh'],
        hooks: ['pre-tool-use.sh'],
        custom_prompts: { 'task.md': 'Refactor everything' },
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-06-01T00:00:00.000Z',
      };
      const project = createProjectConfig(full);
      expect(project).toEqual(full);
    });

    it('preserves github_pat when provided', () => {
      const project = createProjectConfig({ github_pat: 'configured' });
      expect(project.github_pat).toBe('configured');
    });

    it('defaults github_pat to undefined when not provided', () => {
      const project = createProjectConfig();
      expect(project.github_pat).toBeUndefined();
    });

    it('works with no arguments (empty call)', () => {
      const project = createProjectConfig();
      expect(project).toBeDefined();
      expect(project.id).toMatch(UUID_V4_RE);
    });
  });

  describe('type safety', () => {
    it('satisfies the ProjectConfig type shape', () => {
      const project: ProjectConfig = createProjectConfig({ name: 'Test' });
      expect(Object.keys(project)).toEqual(
        expect.arrayContaining([
          'id',
          'name',
          'repo_url',
          'docker_image',
          'pre_validation_scripts',
          'custom_prompts',
          'created_at',
          'updated_at',
        ])
      );
    });
  });
});
