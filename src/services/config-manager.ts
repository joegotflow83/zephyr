/**
 * ConfigManager — manages ~/.zephyr/ config directory and JSON file I/O.
 *
 * Runs in the Electron main process. The config directory is injectable
 * for testability — tests pass a temp dir instead of the real ~/.zephyr/.
 *
 * Atomic writes prevent data corruption: data is written to a .tmp file
 * first, then renamed over the destination atomically.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.zephyr');

export class ConfigManager {
  private readonly configDir: string;

  constructor(configDir?: string) {
    this.configDir = configDir ?? DEFAULT_CONFIG_DIR;
  }

  /** Returns the config directory path. */
  getConfigDir(): string {
    return this.configDir;
  }

  /** Creates the config directory if it doesn't exist. */
  ensureConfigDir(): void {
    fs.mkdirSync(this.configDir, { recursive: true });
  }

  /**
   * Reads and parses a JSON file from the config directory.
   * Returns null if the file does not exist or cannot be parsed.
   */
  loadJson<T>(filename: string): T | null {
    const filepath = path.join(this.configDir, filename);
    try {
      const raw = fs.readFileSync(filepath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      // File missing (ENOENT) or unreadable → return null (expected case)
      // Corrupt JSON → return null (safe degradation)
      if (isNodeError(err) && err.code !== 'ENOENT') {
        // Log unexpected errors but still degrade gracefully
        // eslint-disable-next-line no-console
        console.warn(`[ConfigManager] Failed to load ${filepath}:`, err);
      }
      return null;
    }
  }

  /**
   * Atomically writes data as JSON to the config directory.
   *
   * The write goes to a .tmp file first, then fs.renameSync replaces the
   * target file. This guarantees the reader always sees a complete file,
   * even if the process is killed mid-write.
   */
  saveJson(filename: string, data: unknown): void {
    this.ensureConfigDir();

    const filepath = path.join(this.configDir, filename);
    const tmpPath = filepath + '.tmp';

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, filepath);
    } catch (err) {
      // Clean up temp file on failure
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
