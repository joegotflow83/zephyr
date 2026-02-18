/**
 * Unit tests for AssetInjector service.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AssetInjector, CONTAINER_MOUNT_TARGET } from '../../src/services/asset-injector';
import { createProjectConfig } from '../../src/shared/models';
import type { ProjectConfig } from '../../src/shared/models';

describe('AssetInjector', () => {
  let injector: AssetInjector;
  let tempDirs: string[] = [];

  beforeEach(() => {
    injector = new AssetInjector();
    tempDirs = [];
  });

  afterEach(async () => {
    // Clean up all temp directories created during tests
    for (const dir of tempDirs) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore errors
      }
    }
    tempDirs = [];
  });

  describe('prepareInjectionDir', () => {
    it('should create a temporary directory', async () => {
      const project = createProjectConfig({ name: 'test-project' });
      const injectionDir = await injector.prepareInjectionDir(project);
      tempDirs.push(injectionDir);

      // Directory should exist
      const stat = await fs.stat(injectionDir);
      expect(stat.isDirectory()).toBe(true);

      // Directory name should include project ID prefix
      expect(path.basename(injectionDir)).toMatch(/^zephyr-inject-[a-f0-9]{8}-/);
    });

    it('should include PROMPT_build.md with default content', async () => {
      const project = createProjectConfig({ name: 'test-project' });
      const injectionDir = await injector.prepareInjectionDir(project);
      tempDirs.push(injectionDir);

      const promptBuildPath = path.join(injectionDir, 'PROMPT_build.md');
      const content = await fs.readFile(promptBuildPath, 'utf8');

      expect(content).toContain('# Build Prompt');
      expect(content).toContain('Follow the instructions in AGENTS.md');
    });

    it('should write custom prompts from project config', async () => {
      const project = createProjectConfig({
        name: 'test-project',
        custom_prompts: {
          'PROMPT_custom.md': '# Custom Prompt\nDo custom things.',
          'PROMPT_feature.md': '# Feature Prompt\nImplement the feature.',
        },
      });
      const injectionDir = await injector.prepareInjectionDir(project);
      tempDirs.push(injectionDir);

      const customPath = path.join(injectionDir, 'PROMPT_custom.md');
      const featurePath = path.join(injectionDir, 'PROMPT_feature.md');

      const customContent = await fs.readFile(customPath, 'utf8');
      const featureContent = await fs.readFile(featurePath, 'utf8');

      expect(customContent).toBe('# Custom Prompt\nDo custom things.');
      expect(featureContent).toBe('# Feature Prompt\nImplement the feature.');
    });

    it('should handle nested custom prompt filenames', async () => {
      const project = createProjectConfig({
        name: 'test-project',
        custom_prompts: {
          'prompts/nested/PROMPT_deep.md': '# Deep Prompt',
        },
      });
      const injectionDir = await injector.prepareInjectionDir(project);
      tempDirs.push(injectionDir);

      const nestedPath = path.join(injectionDir, 'prompts', 'nested', 'PROMPT_deep.md');
      const content = await fs.readFile(nestedPath, 'utf8');

      expect(content).toBe('# Deep Prompt');
    });

    it('should use project override for AGENTS.md', async () => {
      const project = createProjectConfig({
        name: 'test-project',
        custom_prompts: {
          'AGENTS.md': '# Project-specific AGENTS\nCustom agent instructions.',
        },
      });
      const injectionDir = await injector.prepareInjectionDir(project);
      tempDirs.push(injectionDir);

      const agentsPath = path.join(injectionDir, 'AGENTS.md');
      const content = await fs.readFile(agentsPath, 'utf8');

      expect(content).toBe('# Project-specific AGENTS\nCustom agent instructions.');
    });

    it('should copy app AGENTS.md when no project override exists', async () => {
      // Create a temporary AGENTS.md file to use as app default
      const tempAppRoot = await fs.mkdtemp(path.join(require('os').tmpdir(), 'app-'));
      tempDirs.push(tempAppRoot);
      const appAgentsPath = path.join(tempAppRoot, 'AGENTS.md');
      await fs.writeFile(appAgentsPath, '# App-level AGENTS\nDefault instructions.', 'utf8');

      // Create injector with custom app AGENTS.md path
      const customInjector = new AssetInjector(appAgentsPath);

      const project = createProjectConfig({ name: 'test-project' });
      const injectionDir = await customInjector.prepareInjectionDir(project);
      tempDirs.push(injectionDir);

      const agentsPath = path.join(injectionDir, 'AGENTS.md');
      const content = await fs.readFile(agentsPath, 'utf8');

      expect(content).toBe('# App-level AGENTS\nDefault instructions.');
    });

    it('should not fail if app AGENTS.md does not exist', async () => {
      // Create injector with non-existent AGENTS.md path
      const customInjector = new AssetInjector('/nonexistent/AGENTS.md');

      const project = createProjectConfig({ name: 'test-project' });
      const injectionDir = await customInjector.prepareInjectionDir(project);
      tempDirs.push(injectionDir);

      // Should not throw error
      const stat = await fs.stat(injectionDir);
      expect(stat.isDirectory()).toBe(true);

      // AGENTS.md should not exist
      const agentsPath = path.join(injectionDir, 'AGENTS.md');
      await expect(fs.access(agentsPath)).rejects.toThrow();
    });

    it('should use project override for PROMPT_build.md', async () => {
      const project = createProjectConfig({
        name: 'test-project',
        custom_prompts: {
          'PROMPT_build.md': '# Custom Build\nProject-specific build instructions.',
        },
      });
      const injectionDir = await injector.prepareInjectionDir(project);
      tempDirs.push(injectionDir);

      const promptBuildPath = path.join(injectionDir, 'PROMPT_build.md');
      const content = await fs.readFile(promptBuildPath, 'utf8');

      expect(content).toBe('# Custom Build\nProject-specific build instructions.');
    });

    it('should not duplicate AGENTS.md in custom_prompts', async () => {
      const project = createProjectConfig({
        name: 'test-project',
        custom_prompts: {
          'AGENTS.md': '# Project AGENTS\nCustom.',
          'PROMPT_other.md': '# Other',
        },
      });
      const injectionDir = await injector.prepareInjectionDir(project);
      tempDirs.push(injectionDir);

      // AGENTS.md should exist with project content
      const agentsPath = path.join(injectionDir, 'AGENTS.md');
      const content = await fs.readFile(agentsPath, 'utf8');
      expect(content).toBe('# Project AGENTS\nCustom.');

      // Should only be written once (no duplicates)
      const files = await fs.readdir(injectionDir);
      const agentsFiles = files.filter((f) => f === 'AGENTS.md');
      expect(agentsFiles).toHaveLength(1);
    });

    it('should handle multiple custom prompts with priority', async () => {
      const project = createProjectConfig({
        name: 'test-project',
        custom_prompts: {
          'AGENTS.md': '# Project AGENTS',
          'PROMPT_build.md': '# Project Build',
          'PROMPT_test.md': '# Project Test',
          'PROMPT_deploy.md': '# Project Deploy',
        },
      });
      const injectionDir = await injector.prepareInjectionDir(project);
      tempDirs.push(injectionDir);

      // All files should exist with correct content
      const files = await fs.readdir(injectionDir);
      expect(files).toContain('AGENTS.md');
      expect(files).toContain('PROMPT_build.md');
      expect(files).toContain('PROMPT_test.md');
      expect(files).toContain('PROMPT_deploy.md');

      // Verify content priority (project overrides)
      const agentsContent = await fs.readFile(path.join(injectionDir, 'AGENTS.md'), 'utf8');
      expect(agentsContent).toBe('# Project AGENTS');

      const buildContent = await fs.readFile(path.join(injectionDir, 'PROMPT_build.md'), 'utf8');
      expect(buildContent).toBe('# Project Build');
    });
  });

  describe('getMountConfig', () => {
    it('should return Docker volume mount configuration', () => {
      const injectionDir = '/tmp/test-injection';
      const mountConfig = injector.getMountConfig(injectionDir);

      expect(mountConfig).toEqual({
        [injectionDir]: {
          bind: CONTAINER_MOUNT_TARGET,
          mode: 'ro',
        },
      });
    });

    it('should use correct container mount target', () => {
      const injectionDir = '/tmp/test-injection';
      const mountConfig = injector.getMountConfig(injectionDir);

      expect(mountConfig[injectionDir].bind).toBe('/home/ralph/app');
      expect(mountConfig[injectionDir].mode).toBe('ro');
    });
  });

  describe('cleanup', () => {
    it('should remove injection directory', async () => {
      const project = createProjectConfig({ name: 'test-project' });
      const injectionDir = await injector.prepareInjectionDir(project);

      // Directory should exist
      const statBefore = await fs.stat(injectionDir);
      expect(statBefore.isDirectory()).toBe(true);

      // Clean up
      await injector.cleanup(injectionDir);

      // Directory should not exist
      await expect(fs.access(injectionDir)).rejects.toThrow();
    });

    it('should silently ignore non-existent directories', async () => {
      const nonExistentDir = '/tmp/nonexistent-dir-12345';

      // Should not throw
      await expect(injector.cleanup(nonExistentDir)).resolves.toBeUndefined();
    });

    it('should remove directory with nested files', async () => {
      const project = createProjectConfig({
        name: 'test-project',
        custom_prompts: {
          'prompts/nested/PROMPT_deep.md': '# Deep',
          'PROMPT_shallow.md': '# Shallow',
        },
      });
      const injectionDir = await injector.prepareInjectionDir(project);

      // Clean up
      await injector.cleanup(injectionDir);

      // Directory should not exist
      await expect(fs.access(injectionDir)).rejects.toThrow();
    });
  });

  describe('integration scenarios', () => {
    it('should handle full lifecycle: prepare -> use -> cleanup', async () => {
      const project = createProjectConfig({
        name: 'lifecycle-test',
        custom_prompts: {
          'AGENTS.md': '# Custom AGENTS',
          'PROMPT_feature.md': '# Feature',
        },
      });

      // Prepare
      const injectionDir = await injector.prepareInjectionDir(project);
      expect(await fs.stat(injectionDir)).toBeTruthy();

      // Use (get mount config)
      const mountConfig = injector.getMountConfig(injectionDir);
      expect(mountConfig[injectionDir].bind).toBe(CONTAINER_MOUNT_TARGET);

      // Cleanup
      await injector.cleanup(injectionDir);
      await expect(fs.access(injectionDir)).rejects.toThrow();
    });

    it('should handle concurrent injection directories for different projects', async () => {
      const project1 = createProjectConfig({
        name: 'project-1',
        custom_prompts: { 'PROMPT_p1.md': '# P1' },
      });
      const project2 = createProjectConfig({
        name: 'project-2',
        custom_prompts: { 'PROMPT_p2.md': '# P2' },
      });

      const dir1 = await injector.prepareInjectionDir(project1);
      const dir2 = await injector.prepareInjectionDir(project2);
      tempDirs.push(dir1, dir2);

      // Both should exist and be different
      expect(dir1).not.toBe(dir2);
      expect(await fs.stat(dir1)).toBeTruthy();
      expect(await fs.stat(dir2)).toBeTruthy();

      // Each should have its own files
      const files1 = await fs.readdir(dir1);
      const files2 = await fs.readdir(dir2);
      expect(files1).toContain('PROMPT_p1.md');
      expect(files2).toContain('PROMPT_p2.md');
    });

    it('should prioritize project > app > default for all assets', async () => {
      // Create temp app AGENTS.md
      const tempAppRoot = await fs.mkdtemp(path.join(require('os').tmpdir(), 'app-'));
      tempDirs.push(tempAppRoot);
      const appAgentsPath = path.join(tempAppRoot, 'AGENTS.md');
      await fs.writeFile(appAgentsPath, '# App Default AGENTS', 'utf8');

      const customInjector = new AssetInjector(appAgentsPath);

      // Test 1: Project override wins
      const projectWithOverride = createProjectConfig({
        name: 'override-project',
        custom_prompts: {
          'AGENTS.md': '# Project AGENTS',
          'PROMPT_build.md': '# Project Build',
        },
      });
      const dir1 = await customInjector.prepareInjectionDir(projectWithOverride);
      tempDirs.push(dir1);

      const agents1 = await fs.readFile(path.join(dir1, 'AGENTS.md'), 'utf8');
      const build1 = await fs.readFile(path.join(dir1, 'PROMPT_build.md'), 'utf8');
      expect(agents1).toBe('# Project AGENTS');
      expect(build1).toBe('# Project Build');

      // Test 2: App default for AGENTS.md, built-in default for PROMPT_build.md
      const projectWithoutOverride = createProjectConfig({
        name: 'default-project',
      });
      const dir2 = await customInjector.prepareInjectionDir(projectWithoutOverride);
      tempDirs.push(dir2);

      const agents2 = await fs.readFile(path.join(dir2, 'AGENTS.md'), 'utf8');
      const build2 = await fs.readFile(path.join(dir2, 'PROMPT_build.md'), 'utf8');
      expect(agents2).toBe('# App Default AGENTS');
      expect(build2).toContain('# Build Prompt');
    });
  });
});
