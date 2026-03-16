/**
 * KiroHooksStore — manages Kiro hook files stored in ~/.zephyr/kiro_hooks/.
 *
 * Hook files are injected into containers at ~/.kiro/hooks/ so that
 * Kiro's hook system can invoke them during agent execution.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConfigManager } from './config-manager';

export interface KiroHookFile {
  /** Hook filename, e.g. "pre-tool-use.sh" */
  filename: string;
  /** Human-readable display name, e.g. "Pre Tool Use" */
  name: string;
  /** Description parsed from the file's "# Description: ..." header comment */
  description: string;
  /** Full file content */
  content: string;
}

export class KiroHooksStore {
  private readonly hooksDir: string;

  constructor(configManager: ConfigManager) {
    this.hooksDir = path.join(configManager.getConfigDir(), 'kiro_hooks');
  }

  private ensureHooksDir(): void {
    if (!fs.existsSync(this.hooksDir)) {
      fs.mkdirSync(this.hooksDir, { recursive: true });
    }
  }

  private toDisplayName(filename: string): string {
    return filename
      .replace(/\.[^.]+$/, '')
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private parseDescription(content: string): string {
    const match = content.match(/^#\s*Description:\s*(.+)/m);
    return match ? match[1].trim() : '';
  }

  async listHooks(): Promise<KiroHookFile[]> {
    this.ensureHooksDir();

    let files: string[];
    try {
      files = fs.readdirSync(this.hooksDir).filter((f) => !f.startsWith('.'));
    } catch {
      return [];
    }

    const hooks: KiroHookFile[] = [];
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

  async getHook(filename: string): Promise<string | null> {
    const safe = path.basename(filename);
    const filePath = path.join(this.hooksDir, safe);
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  async addHook(filename: string, content: string): Promise<void> {
    const safe = path.basename(filename);
    if (!safe || !safe.includes('.')) {
      throw new Error(`Hook filename must include an extension (got: ${filename})`);
    }
    this.ensureHooksDir();
    const filePath = path.join(this.hooksDir, safe);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

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
