// @vitest-environment node
/**
 * Unit tests for src/services/import-export.ts
 *
 * ImportExportService creates and reads zip archives. Because archiver and
 * adm-zip are binary I/O libraries that are not easily mocked, these tests
 * use real temp directories. This is intentional: the key correctness
 * guarantee is the round-trip property — export then import must produce
 * an identical config directory — and that can only be verified with real
 * file I/O.
 *
 * This file uses `@vitest-environment node` (not jsdom) because adm-zip's
 * Buffer decompression is incompatible with jsdom's Buffer polyfill. The
 * import-export service is a main-process service — never rendered in a
 * browser — so the node environment is semantically correct.
 *
 * Each test gets an isolated temp directory and cleans up after itself
 * so tests remain deterministic and leave no artifacts.
 *
 * Why round-trip tests matter: users rely on export/import for backups and
 * for migrating between machines. Silent data loss or corruption would be
 * catastrophic. Verifying JSON round-trips at the file level catches both
 * serialization and path-handling bugs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConfigManager } from '../../src/services/config-manager';
import { ImportExportService } from '../../src/services/import-export';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-ie-test-'));
}

function makeService(dir: string): { service: ImportExportService; config: ConfigManager } {
  const config = new ConfigManager(dir);
  config.ensureConfigDir();
  const service = new ImportExportService(config);
  return { service, config };
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const PROJECTS = [
  {
    id: 'proj-1',
    name: 'Alpha',
    repo_url: 'https://github.com/org/alpha',
    docker_image: 'alpine:latest',
    pre_validation_scripts: [],
    custom_prompts: {},
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-02T00:00:00.000Z',
  },
];

const SETTINGS = {
  max_concurrent_containers: 3,
  notification_enabled: true,
  theme: 'dark',
  log_level: 'info',
};

const CUSTOM_PROMPT = { system: 'You are a helpful assistant.' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImportExportService', () => {
  let srcDir: string;
  let destDir: string;
  let zipPath: string;

  beforeEach(() => {
    srcDir = makeTempDir();
    destDir = makeTempDir();
    zipPath = path.join(makeTempDir(), 'backup.zip');
  });

  afterEach(() => {
    // Clean up all temp dirs
    for (const dir of [srcDir, destDir, path.dirname(zipPath)]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  // -------------------------------------------------------------------------
  // exportConfig
  // -------------------------------------------------------------------------

  describe('exportConfig', () => {
    it('creates a zip file at the given output path', async () => {
      const { service, config } = makeService(srcDir);
      config.saveJson('projects.json', PROJECTS);

      await service.exportConfig(zipPath);

      expect(fs.existsSync(zipPath)).toBe(true);
      const stat = fs.statSync(zipPath);
      expect(stat.size).toBeGreaterThan(0);
    });

    it('includes projects.json in the export', async () => {
      const { service, config } = makeService(srcDir);
      config.saveJson('projects.json', PROJECTS);

      await service.exportConfig(zipPath);

      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(zipPath);
      const entry = zip.getEntry('projects.json');
      expect(entry).not.toBeNull();
      const content = JSON.parse(entry!.getData().toString('utf-8'));
      expect(content).toEqual(PROJECTS);
    });

    it('includes settings.json in the export', async () => {
      const { service, config } = makeService(srcDir);
      config.saveJson('settings.json', SETTINGS);

      await service.exportConfig(zipPath);

      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(zipPath);
      const entry = zip.getEntry('settings.json');
      expect(entry).not.toBeNull();
      const content = JSON.parse(entry!.getData().toString('utf-8'));
      expect(content).toEqual(SETTINGS);
    });

    it('includes custom prompts from custom-prompts/ subdirectory', async () => {
      const { service, config } = makeService(srcDir);
      const promptsDir = path.join(srcDir, 'custom-prompts');
      fs.mkdirSync(promptsDir, { recursive: true });
      fs.writeFileSync(
        path.join(promptsDir, 'alpha.json'),
        JSON.stringify(CUSTOM_PROMPT, null, 2),
      );

      await service.exportConfig(zipPath);

      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(zipPath);
      const entry = zip.getEntry('custom-prompts/alpha.json');
      expect(entry).not.toBeNull();
      const content = JSON.parse(entry!.getData().toString('utf-8'));
      expect(content).toEqual(CUSTOM_PROMPT);
    });

    it('succeeds when projects.json does not exist (skips missing files)', async () => {
      const { service } = makeService(srcDir);
      // Only settings.json present
      const config = new ConfigManager(srcDir);
      config.saveJson('settings.json', SETTINGS);

      await expect(service.exportConfig(zipPath)).resolves.toBeUndefined();
      expect(fs.existsSync(zipPath)).toBe(true);
    });

    it('produces a non-empty zip even when no files exist', async () => {
      const { service } = makeService(srcDir);

      await service.exportConfig(zipPath);

      // Zip should exist (valid but empty-ish archive)
      expect(fs.existsSync(zipPath)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // importConfig
  // -------------------------------------------------------------------------

  describe('importConfig', () => {
    it('restores projects.json from the zip', async () => {
      const { service: srcService, config: srcConfig } = makeService(srcDir);
      srcConfig.saveJson('projects.json', PROJECTS);
      await srcService.exportConfig(zipPath);

      const { service: destService, config: destConfig } = makeService(destDir);
      destService.importConfig(zipPath);

      const restored = destConfig.loadJson<typeof PROJECTS>('projects.json');
      expect(restored).toEqual(PROJECTS);
    });

    it('restores settings.json from the zip', async () => {
      const { service: srcService, config: srcConfig } = makeService(srcDir);
      srcConfig.saveJson('settings.json', SETTINGS);
      await srcService.exportConfig(zipPath);

      const { service: destService, config: destConfig } = makeService(destDir);
      destService.importConfig(zipPath);

      const restored = destConfig.loadJson<typeof SETTINGS>('settings.json');
      expect(restored).toEqual(SETTINGS);
    });

    it('restores custom prompts into custom-prompts/ subdirectory', async () => {
      const { service: srcService } = makeService(srcDir);
      const promptsDir = path.join(srcDir, 'custom-prompts');
      fs.mkdirSync(promptsDir, { recursive: true });
      fs.writeFileSync(
        path.join(promptsDir, 'alpha.json'),
        JSON.stringify(CUSTOM_PROMPT, null, 2),
      );
      await srcService.exportConfig(zipPath);

      const { service: destService } = makeService(destDir);
      destService.importConfig(zipPath);

      const destPromptPath = path.join(destDir, 'custom-prompts', 'alpha.json');
      expect(fs.existsSync(destPromptPath)).toBe(true);
      const content = readJson(destPromptPath);
      expect(content).toEqual(CUSTOM_PROMPT);
    });

    it('creates the config directory if it does not exist', async () => {
      const { service: srcService, config: srcConfig } = makeService(srcDir);
      srcConfig.saveJson('projects.json', PROJECTS);
      await srcService.exportConfig(zipPath);

      // Destination dir doesn't exist yet
      const newDestDir = path.join(os.tmpdir(), `zephyr-new-${Date.now()}`);
      try {
        const newConfig = new ConfigManager(newDestDir);
        const newService = new ImportExportService(newConfig);
        newService.importConfig(zipPath);

        expect(fs.existsSync(newDestDir)).toBe(true);
        const restored = newConfig.loadJson<typeof PROJECTS>('projects.json');
        expect(restored).toEqual(PROJECTS);
      } finally {
        fs.rmSync(newDestDir, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Round-trip (export then import)
  // -------------------------------------------------------------------------

  describe('round-trip: export then import', () => {
    it('preserves projects.json and settings.json exactly', async () => {
      const { service: srcService, config: srcConfig } = makeService(srcDir);
      srcConfig.saveJson('projects.json', PROJECTS);
      srcConfig.saveJson('settings.json', SETTINGS);

      await srcService.exportConfig(zipPath);

      const { service: destService, config: destConfig } = makeService(destDir);
      destService.importConfig(zipPath);

      expect(destConfig.loadJson('projects.json')).toEqual(PROJECTS);
      expect(destConfig.loadJson('settings.json')).toEqual(SETTINGS);
    });

    it('preserves custom prompts exactly', async () => {
      const { service: srcService } = makeService(srcDir);
      const promptsDir = path.join(srcDir, 'custom-prompts');
      fs.mkdirSync(promptsDir, { recursive: true });
      fs.writeFileSync(
        path.join(promptsDir, 'mybot.json'),
        JSON.stringify(CUSTOM_PROMPT, null, 2),
      );

      await srcService.exportConfig(zipPath);

      const { service: destService } = makeService(destDir);
      destService.importConfig(zipPath);

      const destPath = path.join(destDir, 'custom-prompts', 'mybot.json');
      expect(fs.existsSync(destPath)).toBe(true);
      expect(readJson(destPath)).toEqual(CUSTOM_PROMPT);
    });

    it('preserves multiple projects in projects.json', async () => {
      const multiProjects = [
        ...PROJECTS,
        {
          id: 'proj-2',
          name: 'Beta',
          repo_url: 'https://github.com/org/beta',
          docker_image: 'node:18',
          pre_validation_scripts: [],
          custom_prompts: { system: 'Be concise.' },
          created_at: '2024-02-01T00:00:00.000Z',
          updated_at: '2024-02-02T00:00:00.000Z',
        },
      ];

      const { service: srcService, config: srcConfig } = makeService(srcDir);
      srcConfig.saveJson('projects.json', multiProjects);

      await srcService.exportConfig(zipPath);

      const { service: destService, config: destConfig } = makeService(destDir);
      destService.importConfig(zipPath);

      expect(destConfig.loadJson('projects.json')).toEqual(multiProjects);
    });

    it('overwrites existing files in the destination on import', async () => {
      const { service: srcService, config: srcConfig } = makeService(srcDir);
      srcConfig.saveJson('projects.json', PROJECTS);
      await srcService.exportConfig(zipPath);

      // Pre-populate destination with different data
      const { service: destService, config: destConfig } = makeService(destDir);
      const oldProjects = [{ id: 'old', name: 'Old Project' }];
      destConfig.saveJson('projects.json', oldProjects);

      destService.importConfig(zipPath);

      expect(destConfig.loadJson('projects.json')).toEqual(PROJECTS);
    });
  });

  // -------------------------------------------------------------------------
  // Security: path traversal prevention
  // -------------------------------------------------------------------------

  describe('importConfig security', () => {
    it('rejects zip entries with path traversal sequences', async () => {
      // Craft a zip with a traversal entry manually
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip();
      // This entry would escape configDir if not blocked
      zip.addFile('../../../etc/evil.json', Buffer.from('{"pwned":true}'));
      const evilZipPath = path.join(os.tmpdir(), `evil-${Date.now()}.zip`);
      zip.writeZip(evilZipPath);

      try {
        const { service: destService } = makeService(destDir);
        // Should not throw, but should silently skip the traversal entry
        expect(() => destService.importConfig(evilZipPath)).not.toThrow();

        // The evil file must NOT be written outside destDir
        const evilTarget = path.resolve(destDir, '../../../etc/evil.json');
        expect(fs.existsSync(evilTarget)).toBe(false);
      } finally {
        fs.unlinkSync(evilZipPath);
      }
    });
  });
});
