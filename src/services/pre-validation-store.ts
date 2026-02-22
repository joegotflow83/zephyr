/**
 * PreValidationStore — manages pre-validation scripts stored in
 * ~/.zephyr/pre_validation_scripts/.
 *
 * Scripts are shell scripts (*.sh) injected into containers before each loop
 * commit, providing validation (lint, test, format-check) as a quality gate.
 *
 * Built-in scripts are seeded by Phase 19 (Task 19.3). This store marks them
 * as built-in based on a known filename list so the UI can distinguish them.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConfigManager } from './config-manager';

export interface PreValidationScript {
  /** Shell script filename, e.g. "python-lint.sh" */
  filename: string;
  /** Human-readable display name, e.g. "Python Lint" */
  name: string;
  /** Description parsed from the script's "# Description: ..." header comment */
  description: string;
  /** Full script content */
  content: string;
  /** true if this is one of the seeded built-in scripts (see Phase 19.3) */
  isBuiltIn: boolean;
}

/** Filenames of scripts seeded as built-ins by Phase 19.3 */
const BUILTIN_FILENAMES = new Set([
  'python-lint.sh',
  'node-test.sh',
  'rust-check.sh',
  'go-vet.sh',
  'format-check.sh',
]);

export class PreValidationStore {
  private readonly scriptsDir: string;

  constructor(configManager: ConfigManager) {
    this.scriptsDir = path.join(configManager.getConfigDir(), 'pre_validation_scripts');
  }

  private ensureScriptsDir(): void {
    if (!fs.existsSync(this.scriptsDir)) {
      fs.mkdirSync(this.scriptsDir, { recursive: true });
    }
  }

  /**
   * Derive a display name from a script filename.
   * "python-lint.sh" → "Python Lint"
   */
  private toDisplayName(filename: string): string {
    return filename
      .replace(/\.sh$/, '')
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Extract description from the first "# Description: ..." line in the script.
   * Returns empty string if no such line exists.
   */
  private parseDescription(content: string): string {
    const match = content.match(/^#\s*Description:\s*(.+)/m);
    return match ? match[1].trim() : '';
  }

  /**
   * Lists all .sh scripts in the pre_validation_scripts directory.
   * Returns an empty array if the directory doesn't exist yet.
   */
  async listScripts(): Promise<PreValidationScript[]> {
    this.ensureScriptsDir();

    let files: string[];
    try {
      files = fs.readdirSync(this.scriptsDir).filter((f) => f.endsWith('.sh'));
    } catch {
      return [];
    }

    const scripts: PreValidationScript[] = [];
    for (const filename of files.sort()) {
      const filePath = path.join(this.scriptsDir, filename);
      const content = fs.readFileSync(filePath, 'utf-8');
      scripts.push({
        filename,
        name: this.toDisplayName(filename),
        description: this.parseDescription(content),
        content,
        isBuiltIn: BUILTIN_FILENAMES.has(filename),
      });
    }
    return scripts;
  }

  /**
   * Returns the content of a specific script, or null if not found.
   * Prevents path traversal by using path.basename.
   */
  async getScript(filename: string): Promise<string | null> {
    const safe = path.basename(filename);
    const filePath = path.join(this.scriptsDir, safe);
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Writes a script to the scripts directory.
   * Filename must end with ".sh" to avoid storing non-script files.
   * Prevents path traversal by using path.basename.
   */
  async addScript(filename: string, content: string): Promise<void> {
    const safe = path.basename(filename);
    if (!safe.endsWith('.sh')) {
      throw new Error(`Script filename must end with .sh (got: ${filename})`);
    }
    this.ensureScriptsDir();
    const filePath = path.join(this.scriptsDir, safe);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Removes a script from the directory.
   * Returns true if deleted, false if not found.
   */
  async removeScript(filename: string): Promise<boolean> {
    const safe = path.basename(filename);
    const filePath = path.join(this.scriptsDir, safe);
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
