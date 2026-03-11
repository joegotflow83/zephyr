/**
 * DeployKeyStore — persistent lifecycle tracking for ephemeral GitHub deploy keys.
 *
 * Writes deploy key records to `~/.zephyr/ssh_deploy_keys.json` so that keys
 * can be accounted for across sessions. On startup, any key still marked
 * 'active' from the previous session is promoted to 'orphaned' — indicating
 * it was never cleaned up (crash, network failure, force-quit) and should be
 * manually removed from GitHub.
 *
 * Status lifecycle:
 *   active → cleaned   (normal path: loop stopped, key deleted from GitHub)
 *   active → orphaned  (app startup detects keys never cleaned up)
 */

import fs from 'fs';
import path from 'path';

export interface DeployKeyRecord {
  key_id: number;
  repo: string;         // "owner/repo"
  project_id: string;
  project_name: string;
  loop_id: string;
  created_at: string;   // ISO8601
  status: 'active' | 'cleaned' | 'orphaned';
  service?: 'github' | 'gitlab';
}

interface DeployKeyStorage {
  keys: DeployKeyRecord[];
}

export class DeployKeyStore {
  private readonly storeFile: string;

  /**
   * @param configDir - Directory to store ssh_deploy_keys.json (default: ~/.zephyr)
   */
  constructor(configDir: string) {
    this.storeFile = path.join(configDir, 'ssh_deploy_keys.json');
  }

  /**
   * Record a new active deploy key entry.
   * Called immediately after the key is registered with GitHub and before
   * container injection, so even a mid-loop crash leaves a traceable record.
   */
  record(entry: Omit<DeployKeyRecord, 'status'>): void {
    const store = this.loadStore();
    store.keys.push({ ...entry, status: 'active' });
    this.saveStore(store);
  }

  /**
   * Mark a deploy key as cleaned after it has been successfully deleted
   * from GitHub. Idempotent — marking an already-cleaned key is a no-op.
   */
  markCleaned(keyId: number): void {
    const store = this.loadStore();
    let changed = false;

    for (const key of store.keys) {
      if (key.key_id === keyId && key.status !== 'cleaned') {
        key.status = 'cleaned';
        changed = true;
      }
    }

    if (changed) {
      this.saveStore(store);
    }
  }

  /**
   * Detect orphaned keys from a previous session.
   *
   * Called once at app startup. Any key still in 'active' status at this
   * point was never cleaned up — the app must have crashed or been force-quit
   * before the cleanup path ran. These are promoted to 'orphaned' so the user
   * can see them in the Settings UI and delete them from GitHub manually.
   */
  detectOrphans(): void {
    const store = this.loadStore();
    let changed = false;

    for (const key of store.keys) {
      if (key.status === 'active') {
        key.status = 'orphaned';
        changed = true;
      }
    }

    if (changed) {
      this.saveStore(store);
    }
  }

  /**
   * Return all orphaned deploy key records for display in the Settings UI.
   * Orphaned keys may still be registered on GitHub and should be deleted
   * manually by the user.
   */
  listOrphaned(): DeployKeyRecord[] {
    const store = this.loadStore();
    return store.keys.filter((k) => k.status === 'orphaned');
  }

  /**
   * Return all active or orphaned deploy key records for a given project.
   * Cleaned keys are excluded since they have already been removed from the service.
   * Used during project deletion to find keys that still need to be removed.
   */
  listActiveByProject(projectId: string): DeployKeyRecord[] {
    const store = this.loadStore();
    return store.keys.filter((k) => k.project_id === projectId && k.status !== 'cleaned');
  }

  /**
   * Build the GitHub URL to the deploy keys management page for a repository.
   *
   * @param repo - Repository in "owner/repo" format
   * @returns URL to https://github.com/{owner}/{repo}/settings/keys
   */
  getGithubKeysUrl(repo: string): string {
    return `https://github.com/${repo}/settings/keys`;
  }

  /**
   * Build the GitLab URL to the deploy keys management page for a repository.
   *
   * @param repo - Repository in "owner/repo" format
   * @returns URL to https://gitlab.com/{owner}/{repo}/-/settings/repository (deploy keys section)
   */
  getGitlabKeysUrl(repo: string): string {
    return `https://gitlab.com/${repo}/-/settings/repository#js-deploy-keys-settings`;
  }

  /**
   * Build the appropriate deploy keys URL based on the service.
   *
   * @param repo - Repository in "owner/repo" format
   * @param service - 'github' or 'gitlab' (defaults to 'github')
   * @returns URL to the deploy keys management page
   */
  getDeployKeysUrl(repo: string, service?: 'github' | 'gitlab'): string {
    return service === 'gitlab' ? this.getGitlabKeysUrl(repo) : this.getGithubKeysUrl(repo);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private loadStore(): DeployKeyStorage {
    try {
      const raw = fs.readFileSync(this.storeFile, 'utf-8');
      return JSON.parse(raw) as DeployKeyStorage;
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return { keys: [] };
      }
      // eslint-disable-next-line no-console
      console.warn('[DeployKeyStore] Failed to load store:', err);
      return { keys: [] };
    }
  }

  private saveStore(store: DeployKeyStorage): void {
    const dir = path.dirname(this.storeFile);
    fs.mkdirSync(dir, { recursive: true });

    const tmpFile = this.storeFile + '.tmp';
    const json = JSON.stringify(store, null, 2);

    // Write to temp file then rename atomically to prevent partial writes
    fs.writeFileSync(tmpFile, json, 'utf-8');
    fs.renameSync(tmpFile, this.storeFile);
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
