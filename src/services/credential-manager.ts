/**
 * CredentialManager — secure API key storage using Electron's safeStorage.
 *
 * Runs in the Electron main process. Uses safeStorage to encrypt credentials
 * before storing them in a JSON file. Maintains an index of which services
 * have stored credentials for enumeration.
 *
 * Storage format:
 * - credentials.json: { service: encryptedBase64String, ... }
 * - All values are encrypted with safeStorage.encryptString()
 *
 * Supported services: 'anthropic', 'github'
 */

import { safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';

export type CredentialService = 'anthropic' | 'github' | 'gitlab' | 'anthropic_bedrock' | 'anthropic_session';

interface CredentialStorage {
  [service: string]: string; // encrypted base64
}

export class CredentialManager {
  private readonly credentialsFile: string;

  /**
   * @param configDir - Directory to store credentials.json (default: ~/.zephyr)
   */
  constructor(configDir: string) {
    this.credentialsFile = path.join(configDir, 'credentials.json');
  }

  /**
   * Store an API key for a service (encrypted with safeStorage).
   */
  async storeApiKey(service: CredentialService, key: string): Promise<void> {
    if (!key || key.trim().length === 0) {
      throw new Error('API key cannot be empty');
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption not available on this system');
    }

    // Encrypt the key
    const encrypted = safeStorage.encryptString(key);
    const base64 = encrypted.toString('base64');

    // Load existing credentials
    const credentials = this.loadCredentials();

    // Store encrypted key
    credentials[service] = base64;

    // Save atomically
    this.saveCredentials(credentials);
  }

  /**
   * Retrieve an API key for a service (decrypted).
   * Returns null if no key is stored for the service.
   */
  async getApiKey(service: CredentialService): Promise<string | null> {
    const credentials = this.loadCredentials();
    const encrypted = credentials[service];

    if (!encrypted) {
      return null;
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption not available on this system');
    }

    try {
      const buffer = Buffer.from(encrypted, 'base64');
      const decrypted = safeStorage.decryptString(buffer);
      return decrypted;
    } catch (err) {
      // Decryption failed (corrupted data or wrong key)
      // eslint-disable-next-line no-console
      console.error(`[CredentialManager] Failed to decrypt key for ${service}:`, err);
      return null;
    }
  }

  /**
   * Delete an API key for a service.
   */
  async deleteApiKey(service: CredentialService): Promise<void> {
    const credentials = this.loadCredentials();

    if (credentials[service]) {
      delete credentials[service];
      this.saveCredentials(credentials);
    }
  }

  /**
   * List all services that have stored credentials.
   */
  async listStoredServices(): Promise<string[]> {
    const credentials = this.loadCredentials();
    return Object.keys(credentials);
  }

  /**
   * Store a GitHub PAT for a specific project (encrypted with safeStorage).
   * The PAT is keyed as `github_pat_<projectId>` so each project has its own entry.
   * Used for ephemeral deploy key management — the PAT is used to register/delete
   * ED25519 deploy keys on GitHub at loop start/stop.
   */
  async setGithubPat(projectId: string, pat: string): Promise<void> {
    if (!pat || pat.trim().length === 0) {
      throw new Error('GitHub PAT cannot be empty');
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption not available on this system');
    }

    const encrypted = safeStorage.encryptString(pat);
    const base64 = encrypted.toString('base64');

    const credentials = this.loadCredentials();
    credentials[`github_pat_${projectId}`] = base64;
    this.saveCredentials(credentials);
  }

  /**
   * Retrieve the GitHub PAT for a specific project (decrypted).
   * Returns null if no PAT is stored for this project.
   */
  async getGithubPat(projectId: string): Promise<string | null> {
    const credentials = this.loadCredentials();
    const encrypted = credentials[`github_pat_${projectId}`];

    if (!encrypted) {
      return null;
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption not available on this system');
    }

    try {
      const buffer = Buffer.from(encrypted, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[CredentialManager] Failed to decrypt GitHub PAT for project ${projectId}:`, err);
      return null;
    }
  }

  /**
   * Delete the GitHub PAT for a specific project.
   * Called when a project is deleted to prevent credential accumulation.
   */
  async deleteGithubPat(projectId: string): Promise<void> {
    const credentials = this.loadCredentials();
    const key = `github_pat_${projectId}`;

    if (credentials[key]) {
      delete credentials[key];
      this.saveCredentials(credentials);
    }
  }

  /**
   * Store a GitLab PAT for a specific project (encrypted with safeStorage).
   * The PAT is keyed as `gitlab_pat_<projectId>` so each project has its own entry.
   * Used for ephemeral deploy key management — the PAT is used to register/delete
   * ED25519 deploy keys on GitLab at loop start/stop.
   */
  async setGitlabPat(projectId: string, pat: string): Promise<void> {
    if (!pat || pat.trim().length === 0) {
      throw new Error('GitLab PAT cannot be empty');
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption not available on this system');
    }

    const encrypted = safeStorage.encryptString(pat);
    const base64 = encrypted.toString('base64');

    const credentials = this.loadCredentials();
    credentials[`gitlab_pat_${projectId}`] = base64;
    this.saveCredentials(credentials);
  }

  /**
   * Retrieve the GitLab PAT for a specific project (decrypted).
   * Returns null if no PAT is stored for this project.
   */
  async getGitlabPat(projectId: string): Promise<string | null> {
    const credentials = this.loadCredentials();
    const encrypted = credentials[`gitlab_pat_${projectId}`];

    if (!encrypted) {
      return null;
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption not available on this system');
    }

    try {
      const buffer = Buffer.from(encrypted, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[CredentialManager] Failed to decrypt GitLab PAT for project ${projectId}:`, err);
      return null;
    }
  }

  /**
   * Delete the GitLab PAT for a specific project.
   * Called when a project is deleted to prevent credential accumulation.
   */
  async deleteGitlabPat(projectId: string): Promise<void> {
    const credentials = this.loadCredentials();
    const key = `gitlab_pat_${projectId}`;

    if (credentials[key]) {
      delete credentials[key];
      this.saveCredentials(credentials);
    }
  }

  /**
   * Load credentials from disk (or return empty object if file doesn't exist).
   */
  private loadCredentials(): CredentialStorage {
    try {
      const raw = fs.readFileSync(this.credentialsFile, 'utf-8');
      return JSON.parse(raw) as CredentialStorage;
    } catch (err: unknown) {
      // File doesn't exist or is corrupt — return empty
      if (isNodeError(err) && err.code === 'ENOENT') {
        return {};
      }
      // eslint-disable-next-line no-console
      console.warn('[CredentialManager] Failed to load credentials:', err);
      return {};
    }
  }

  /**
   * Save credentials to disk atomically.
   */
  private saveCredentials(credentials: CredentialStorage): void {
    const dir = path.dirname(this.credentialsFile);

    // Ensure directory exists
    fs.mkdirSync(dir, { recursive: true });

    const tmpFile = this.credentialsFile + '.tmp';
    const json = JSON.stringify(credentials, null, 2);

    // Write to temp file, then rename atomically
    fs.writeFileSync(tmpFile, json, 'utf-8');
    fs.renameSync(tmpFile, this.credentialsFile);
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
