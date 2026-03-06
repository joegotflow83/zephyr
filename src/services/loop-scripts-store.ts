/**
 * LoopScriptsStore — manages loop scripts stored in ~/.zephyr/loop_scripts/.
 *
 * Loop scripts are the executable scripts used as the main command inside a
 * container when a loop runs. Each project can select exactly one loop script.
 *
 * Scripts can be any executable file (shell, Python, Node, etc.).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConfigManager } from './config-manager';

export interface LoopScript {
  /** Script filename, e.g. "my-loop.sh" */
  filename: string;
  /** Human-readable display name, e.g. "My Loop" */
  name: string;
  /** Description parsed from the file's "# Description: ..." header comment */
  description: string;
  /** Full file content */
  content: string;
}

export class LoopScriptsStore {
  private readonly scriptsDir: string;

  constructor(configManager: ConfigManager) {
    this.scriptsDir = path.join(configManager.getConfigDir(), 'loop_scripts');
  }

  private ensureScriptsDir(): void {
    if (!fs.existsSync(this.scriptsDir)) {
      fs.mkdirSync(this.scriptsDir, { recursive: true });
    }
  }

  /**
   * Derive a display name from a script filename.
   * "my-loop.sh" → "My Loop"
   */
  private toDisplayName(filename: string): string {
    return filename
      .replace(/\.[^.]+$/, '') // remove extension
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Extract description from the first "# Description: ..." line in the file.
   * Returns empty string if no such line exists.
   */
  private parseDescription(content: string): string {
    const match = content.match(/^#\s*Description:\s*(.+)/m);
    return match ? match[1].trim() : '';
  }

  /**
   * Lists all loop scripts in the loop_scripts directory.
   * Returns an empty array if the directory doesn't exist yet.
   */
  async listScripts(): Promise<LoopScript[]> {
    this.ensureScriptsDir();

    let files: string[];
    try {
      files = fs.readdirSync(this.scriptsDir).filter((f) => !f.startsWith('.'));
    } catch {
      return [];
    }

    const scripts: LoopScript[] = [];
    for (const filename of files.sort()) {
      const filePath = path.join(this.scriptsDir, filename);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      scripts.push({
        filename,
        name: this.toDisplayName(filename),
        description: this.parseDescription(content),
        content,
      });
    }
    return scripts;
  }

  /**
   * Returns the content of a specific loop script, or null if not found.
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
   * Writes a loop script to the loop_scripts directory.
   * Filename must contain an extension.
   * Prevents path traversal by using path.basename.
   */
  async addScript(filename: string, content: string): Promise<void> {
    const safe = path.basename(filename);
    if (!safe || !safe.includes('.')) {
      throw new Error(`Loop script filename must include an extension (got: ${filename})`);
    }
    this.ensureScriptsDir();
    const filePath = path.join(this.scriptsDir, safe);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Removes a loop script from the directory.
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
