/**
 * ClaudeSettingsStore — manages Claude settings.json files stored in ~/.zephyr/claude_settings/.
 *
 * Settings files are injected into containers at ~/.claude/settings.json so that
 * Claude's configuration (permissions, env, etc.) is applied during agent execution.
 *
 * Each project may select at most one settings file. The selected file's content
 * is placed verbatim at ~/.claude/settings.json inside the container.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConfigManager } from './config-manager';

export interface ClaudeSettingsFile {
  /** Settings filename, e.g. "permissive.json" */
  filename: string;
  /** Human-readable display name, e.g. "Permissive" */
  name: string;
  /** Description parsed from a top-level "description" key in the JSON, if present */
  description: string;
  /** Full file content */
  content: string;
}

export class ClaudeSettingsStore {
  private readonly settingsDir: string;

  constructor(configManager: ConfigManager) {
    this.settingsDir = path.join(configManager.getConfigDir(), 'claude_settings');
  }

  private ensureSettingsDir(): void {
    if (!fs.existsSync(this.settingsDir)) {
      fs.mkdirSync(this.settingsDir, { recursive: true });
    }
  }

  /**
   * Derive a display name from a settings filename.
   * "permissive.json" → "Permissive"
   */
  private toDisplayName(filename: string): string {
    return filename
      .replace(/\.[^.]+$/, '') // remove extension
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Extract description from a top-level "description" key in the JSON content.
   * Returns empty string if not present or if the file is not valid JSON.
   */
  private parseDescription(content: string): string {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed?.description === 'string') {
        return parsed.description;
      }
    } catch {
      // Not valid JSON or no description key
    }
    return '';
  }

  /**
   * Lists all settings files in the claude_settings directory.
   * Returns an empty array if the directory doesn't exist yet.
   */
  async listFiles(): Promise<ClaudeSettingsFile[]> {
    this.ensureSettingsDir();

    let files: string[];
    try {
      files = fs.readdirSync(this.settingsDir).filter((f) => !f.startsWith('.'));
    } catch {
      return [];
    }

    const result: ClaudeSettingsFile[] = [];
    for (const filename of files.sort()) {
      const filePath = path.join(this.settingsDir, filename);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      result.push({
        filename,
        name: this.toDisplayName(filename),
        description: this.parseDescription(content),
        content,
      });
    }
    return result;
  }

  /**
   * Returns the content of a specific settings file, or null if not found.
   * Prevents path traversal by using path.basename.
   */
  async getFile(filename: string): Promise<string | null> {
    const safe = path.basename(filename);
    const filePath = path.join(this.settingsDir, safe);
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Writes a settings file to the claude_settings directory.
   * Filename must contain an extension.
   * Prevents path traversal by using path.basename.
   */
  async addFile(filename: string, content: string): Promise<void> {
    const safe = path.basename(filename);
    if (!safe || !safe.includes('.')) {
      throw new Error(`Settings filename must include an extension (got: ${filename})`);
    }
    this.ensureSettingsDir();
    const filePath = path.join(this.settingsDir, safe);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Removes a settings file from the directory.
   * Returns true if deleted, false if not found.
   */
  async removeFile(filename: string): Promise<boolean> {
    const safe = path.basename(filename);
    const filePath = path.join(this.settingsDir, safe);
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
