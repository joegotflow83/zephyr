/**
 * @vitest-environment node
 *
 * Integration test for project workflow with real filesystem I/O.
 * Tests complete project lifecycle: create, list, update, delete, persistence, import/export.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigManager } from '../../src/services/config-manager';
import { ProjectStore } from '../../src/services/project-store';
import { ImportExportService } from '../../src/services/import-export';
import type { ProjectConfig } from '../../src/shared/models';

describe('Project Workflow Integration', () => {
  let testDir: string;
  let configManager: ConfigManager;
  let projectStore: ProjectStore;
  let importExport: ImportExportService;

  beforeEach(() => {
    // Create a temporary directory for this test
    testDir = mkdtempSync(join(tmpdir(), 'zephyr-integration-'));

    // Create real instances (no mocking)
    configManager = new ConfigManager(testDir);
    projectStore = new ProjectStore(configManager);
    importExport = new ImportExportService(configManager);
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should create and list projects with real filesystem', async () => {
    // Initially empty
    const emptyList = projectStore.listProjects();
    expect(emptyList).toEqual([]);

    // Add a project
    const project = await projectStore.addProject({
      name: 'Test Project',
      repo_url: 'https://github.com/test/repo',
      jtbd: 'Test JTBD',
      docker_image: 'node:20',
    });

    expect(project.id).toBeDefined();
    expect(project.name).toBe('Test Project');
    expect(project.repo_url).toBe('https://github.com/test/repo');

    // List projects - should now have 1
    const projects = projectStore.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe(project.id);

    // Verify actual JSON file exists on disk
    const projectsFile = join(testDir, 'projects.json');
    const fileContent = readFileSync(projectsFile, 'utf-8');
    const parsed = JSON.parse(fileContent) as ProjectConfig[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Test Project');

    // Verify no .tmp files left behind (atomic write cleanup)
    const files = readdirSync(testDir);
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('should update existing projects', async () => {
    // Create a project
    const project = await projectStore.addProject({
      name: 'Original Name',
      repo_url: 'https://github.com/original/repo',
      jtbd: 'Original JTBD',
      docker_image: 'node:18',
    });

    const originalUpdatedAt = project.updated_at;

    // Wait a tiny bit to ensure timestamp changes
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Update the project
    const updated = projectStore.updateProject(project.id, {
      name: 'Updated Name',
      jtbd: 'Updated JTBD',
    });

    expect(updated.name).toBe('Updated Name');
    expect(updated.jtbd).toBe('Updated JTBD');
    expect(updated.repo_url).toBe('https://github.com/original/repo'); // unchanged
    expect(updated.updated_at).not.toBe(originalUpdatedAt); // timestamp changed

    // Verify on disk
    const projectsFile = join(testDir, 'projects.json');
    const fileContent = readFileSync(projectsFile, 'utf-8');
    const parsed = JSON.parse(fileContent) as ProjectConfig[];
    expect(parsed[0].name).toBe('Updated Name');
    expect(parsed[0].jtbd).toBe('Updated JTBD');
  });

  it('should delete projects', async () => {
    // Add 3 projects
    const p1 = await projectStore.addProject({ name: 'Project 1' });
    const p2 = await projectStore.addProject({ name: 'Project 2' });
    const p3 = await projectStore.addProject({ name: 'Project 3' });

    expect(projectStore.listProjects()).toHaveLength(3);

    // Delete the middle one
    projectStore.removeProject(p2.id);

    const remaining = projectStore.listProjects();
    expect(remaining).toHaveLength(2);
    expect(remaining.map((p) => p.id)).toEqual([p1.id, p3.id]);

    // Verify on disk
    const projectsFile = join(testDir, 'projects.json');
    const fileContent = readFileSync(projectsFile, 'utf-8');
    const parsed = JSON.parse(fileContent) as ProjectConfig[];
    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.name)).toEqual(['Project 1', 'Project 3']);
  });

  it('should persist projects across service restarts', async () => {
    // Create projects with first instance
    await projectStore.addProject({ name: 'Project A', repo_url: 'https://github.com/a/a' });
    await projectStore.addProject({ name: 'Project B', repo_url: 'https://github.com/b/b' });

    const firstList = projectStore.listProjects();
    expect(firstList).toHaveLength(2);

    // Simulate app restart by creating new instances pointing to same directory
    const newConfigManager = new ConfigManager(testDir);
    const newProjectStore = new ProjectStore(newConfigManager);

    const secondList = newProjectStore.listProjects();
    expect(secondList).toHaveLength(2);
    expect(secondList[0].name).toBe('Project A');
    expect(secondList[1].name).toBe('Project B');
    expect(secondList[0].id).toBe(firstList[0].id); // IDs preserved
  });

  it('should handle export and import round-trip', async () => {
    // Create some projects
    await projectStore.addProject({
      name: 'Export Test 1',
      repo_url: 'https://github.com/export/test1',
      jtbd: 'Test export functionality',
      docker_image: 'python:3.12',
      custom_prompts: { test: 'prompt content' },
    });
    await projectStore.addProject({
      name: 'Export Test 2',
      repo_url: 'https://github.com/export/test2',
      jtbd: 'Another export test',
      docker_image: 'node:20',
    });

    const originalProjects = projectStore.listProjects();
    expect(originalProjects).toHaveLength(2);

    // Export to zip file
    const exportPath = join(testDir, 'export.zip');
    await importExport.exportConfig(exportPath);

    // Verify export file exists
    expect(readFileSync(exportPath)).toBeDefined();

    // Create a new test directory for import
    const importTestDir = mkdtempSync(join(tmpdir(), 'zephyr-import-'));
    const importConfigManager = new ConfigManager(importTestDir);
    const importService = new ImportExportService(importConfigManager);

    try {
      // Import the zip
      await importService.importConfig(exportPath);

      // Verify projects were imported
      const importProjectStore = new ProjectStore(importConfigManager);
      const importedProjects = importProjectStore.listProjects();

      expect(importedProjects).toHaveLength(2);
      expect(importedProjects[0].name).toBe('Export Test 1');
      expect(importedProjects[0].repo_url).toBe('https://github.com/export/test1');
      expect(importedProjects[0].custom_prompts).toEqual({ test: 'prompt content' });
      expect(importedProjects[1].name).toBe('Export Test 2');

      // IDs should be preserved
      expect(importedProjects[0].id).toBe(originalProjects[0].id);
      expect(importedProjects[1].id).toBe(originalProjects[1].id);
    } finally {
      // Clean up import test directory
      rmSync(importTestDir, { recursive: true, force: true });
    }
  });

  it('should allow projects with same name (only IDs must be unique)', async () => {
    const p1 = await projectStore.addProject({ name: 'Same Name' });
    const p2 = await projectStore.addProject({ name: 'Same Name' });

    // Both projects exist with different IDs
    const projects = projectStore.listProjects();
    expect(projects).toHaveLength(2);
    expect(projects[0].id).toBe(p1.id);
    expect(projects[1].id).toBe(p2.id);
    expect(projects[0].name).toBe('Same Name');
    expect(projects[1].name).toBe('Same Name');
  });

  it('should return null when getting non-existent project', () => {
    const result = projectStore.getProject('non-existent-id');
    expect(result).toBeNull();
  });

  it('should throw error when updating non-existent project', () => {
    expect(() => {
      projectStore.updateProject('non-existent-id', { name: 'New Name' });
    }).toThrow('Project with id "non-existent-id" not found');
  });

  it('should return false when deleting non-existent project', () => {
    const result = projectStore.removeProject('non-existent-id');
    expect(result).toBe(false);
  });

  it('should handle concurrent writes safely', async () => {
    // Create multiple projects in parallel
    const promises = [
      projectStore.addProject({ name: 'Concurrent 1' }),
      projectStore.addProject({ name: 'Concurrent 2' }),
      projectStore.addProject({ name: 'Concurrent 3' }),
    ];

    const results = await Promise.all(promises);

    // All projects should be created with unique IDs
    expect(results).toHaveLength(3);
    const ids = results.map((p) => p.id);
    expect(new Set(ids).size).toBe(3); // All unique IDs

    // Verify on disk - all 3 should be saved
    const projects = projectStore.listProjects();
    expect(projects).toHaveLength(3);
    expect(projects.map((p) => p.name).sort()).toEqual([
      'Concurrent 1',
      'Concurrent 2',
      'Concurrent 3',
    ]);
  });

  it('should preserve all project fields in round-trip', async () => {
    const fullProject = await projectStore.addProject({
      name: 'Full Project',
      repo_url: 'https://github.com/full/project',
      jtbd: 'Complex JTBD description',
      docker_image: 'custom:image:v1.2.3',
      custom_prompts: {
        planning: 'Custom planning prompt',
        review: 'Custom review prompt',
      },
    });

    // Retrieve it
    const retrieved = projectStore.getProject(fullProject.id);

    // All fields should match
    expect(retrieved.name).toBe('Full Project');
    expect(retrieved.repo_url).toBe('https://github.com/full/project');
    expect(retrieved.jtbd).toBe('Complex JTBD description');
    expect(retrieved.docker_image).toBe('custom:image:v1.2.3');
    expect(retrieved.custom_prompts).toEqual({
      planning: 'Custom planning prompt',
      review: 'Custom review prompt',
    });
    expect(retrieved.created_at).toBeDefined();
    expect(retrieved.updated_at).toBeDefined();
  });
});
