/**
 * ImportExportService — zip-based backup and restore of Zephyr config.
 *
 * Runs in the Electron main process. Exports projects.json, settings.json,
 * and any custom prompt files to a zip archive, and can restore from one.
 *
 * Uses `archiver` for creating zips and `adm-zip` for reading/extracting them.
 *
 * The service depends on ConfigManager to resolve file paths and perform
 * the atomic writes needed after import. This keeps the I/O strategy
 * consistent with the rest of the data layer.
 */

import archiver from 'archiver';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import { ConfigManager } from './config-manager';

/** Files that are always included in an export (when they exist). */
const ALWAYS_EXPORT = ['projects.json', 'settings.json'];

export class ImportExportService {
  constructor(private readonly config: ConfigManager) {}

  /**
   * Exports the current config to a zip file at `outputPath`.
   *
   * Includes projects.json, settings.json, and any *.json files in a
   * custom-prompts/ subdirectory (if present). Files that don't exist
   * are silently skipped — exporting an empty config is valid.
   *
   * The zip preserves relative paths so that importConfig() can place
   * files back in the right locations.
   */
  exportConfig(outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const configDir = this.config.getConfigDir();
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      // Always-exported root-level JSON files
      for (const filename of ALWAYS_EXPORT) {
        const filepath = path.join(configDir, filename);
        if (fs.existsSync(filepath)) {
          archive.file(filepath, { name: filename });
        }
      }

      // Custom prompts directory (*.json files)
      const promptsDir = path.join(configDir, 'custom-prompts');
      if (fs.existsSync(promptsDir) && fs.statSync(promptsDir).isDirectory()) {
        const entries = fs.readdirSync(promptsDir);
        for (const entry of entries) {
          if (entry.endsWith('.json')) {
            archive.file(path.join(promptsDir, entry), {
              name: path.join('custom-prompts', entry),
            });
          }
        }
      }

      archive.finalize();
    });
  }

  /**
   * Imports config from a zip file at `zipPath`, overwriting the current config.
   *
   * All files from the zip are extracted to the config directory. Subdirectories
   * (e.g., custom-prompts/) are created as needed. JSON files are written
   * atomically via ConfigManager.saveJson() to avoid partial-write corruption.
   *
   * Non-JSON entries and path traversal attempts (entries that would escape
   * the config directory) are silently skipped for safety.
   *
   * Throws if the zip cannot be opened.
   */
  importConfig(zipPath: string): void {
    const configDir = this.config.getConfigDir();
    this.config.ensureConfigDir();

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    for (const entry of entries) {
      // Skip directories
      if (entry.isDirectory) continue;

      const entryName = entry.entryName;

      // Safety: reject path traversal
      const resolvedDest = path.resolve(configDir, entryName);
      if (!resolvedDest.startsWith(path.resolve(configDir) + path.sep) &&
          resolvedDest !== path.resolve(configDir)) {
        continue;
      }

      // Only import JSON files
      if (!entryName.endsWith('.json')) continue;

      // Ensure the parent directory exists
      const parentDir = path.dirname(resolvedDest);
      fs.mkdirSync(parentDir, { recursive: true });

      // Parse and re-save atomically via ConfigManager for root-level files,
      // or write directly for files in subdirectories.
      const content = entry.getData().toString('utf-8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        // Skip corrupt JSON entries
        continue;
      }

      // Use relative path from configDir for the write
      const relativePath = path.relative(configDir, resolvedDest);
      const relativeDir = path.dirname(relativePath);

      if (relativeDir === '.') {
        // Root-level file — use ConfigManager atomic write
        const filename = path.basename(relativePath);
        this.config.saveJson(filename, parsed);
      } else {
        // Subdirectory file — write directly (atomic rename within same dir)
        const tmpPath = resolvedDest + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(parsed, null, 2), 'utf-8');
        fs.renameSync(tmpPath, resolvedDest);
      }
    }
  }
}
