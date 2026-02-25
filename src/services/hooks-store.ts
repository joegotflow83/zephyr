/**
 * HooksStore — manages Claude hook files stored in ~/.zephyr/hooks/.
 *
 * Hook files are injected into containers at ~/.claude/hooks/ so that
 * Claude's hook system can invoke them during agent execution.
 *
 * Unlike pre-validation scripts, hooks are not restricted to .sh files —
 * they can be any executable (shell, Python, Node, etc.).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConfigManager } from './config-manager';

export interface HookFile {
  /** Hook filename, e.g. "pre-tool-use.sh" */
  filename: string;
  /** Human-readable display name, e.g. "Pre Tool Use" */
  name: string;
  /** Description parsed from the file's "# Description: ..." header comment */
  description: string;
  /** Full file content */
  content: string;
}

export class HooksStore {
  private readonly hooksDir: string;

  constructor(configManager: ConfigManager) {
    this.hooksDir = path.join(configManager.getConfigDir(), 'hooks');
  }

  private ensureHooksDir(): void {
    if (!fs.existsSync(this.hooksDir)) {
      fs.mkdirSync(this.hooksDir, { recursive: true });
    }
  }

  /**
   * Derive a display name from a hook filename.
   * "pre-tool-use.sh" → "Pre Tool Use"
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
   * Lists all hook files in the hooks directory.
   * Returns an empty array if the directory doesn't exist yet.
   */
  async listHooks(): Promise<HookFile[]> {
    this.ensureHooksDir();

    let files: string[];
    try {
      files = fs.readdirSync(this.hooksDir).filter((f) => !f.startsWith('.'));
    } catch {
      return [];
    }

    const hooks: HookFile[] = [];
    for (const filename of files.sort()) {
      const filePath = path.join(this.hooksDir, filename);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      hooks.push({
        filename,
        name: this.toDisplayName(filename),
        description: this.parseDescription(content),
        content,
      });
    }
    return hooks;
  }

  /**
   * Returns the content of a specific hook file, or null if not found.
   * Prevents path traversal by using path.basename.
   */
  async getHook(filename: string): Promise<string | null> {
    const safe = path.basename(filename);
    const filePath = path.join(this.hooksDir, safe);
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Writes a hook file to the hooks directory.
   * Filename must contain an extension.
   * Prevents path traversal by using path.basename.
   */
  async addHook(filename: string, content: string): Promise<void> {
    const safe = path.basename(filename);
    if (!safe || !safe.includes('.')) {
      throw new Error(`Hook filename must include an extension (got: ${filename})`);
    }
    this.ensureHooksDir();
    const filePath = path.join(this.hooksDir, safe);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Removes a hook file from the directory.
   * Returns true if deleted, false if not found.
   */
  async removeHook(filename: string): Promise<boolean> {
    const safe = path.basename(filename);
    const filePath = path.join(this.hooksDir, safe);
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
