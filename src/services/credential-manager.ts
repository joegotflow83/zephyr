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

export type CredentialService = 'anthropic' | 'github' | 'anthropic_bedrock' | 'anthropic_session';

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
