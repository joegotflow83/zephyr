/**
 * Unit tests for CredentialManager service.
 *
 * Uses mocked electron.safeStorage for deterministic testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock electron module before importing CredentialManager
// Use vi.hoisted to ensure mock is available before module import
const { mockIsEncryptionAvailable, mockEncryptString, mockDecryptString } = vi.hoisted(() => ({
  mockIsEncryptionAvailable: vi.fn(() => true),
  mockEncryptString: vi.fn((plaintext: string) => {
    // Simple mock encryption: prefix with "ENCRYPTED:"
    return Buffer.from(`ENCRYPTED:${plaintext}`);
  }),
  mockDecryptString: vi.fn((encrypted: Buffer) => {
    // Simple mock decryption: remove "ENCRYPTED:" prefix
    const text = encrypted.toString();
    if (text.startsWith('ENCRYPTED:')) {
      return text.slice('ENCRYPTED:'.length);
    }
    throw new Error('Invalid encrypted data');
  }),
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: mockIsEncryptionAvailable,
    encryptString: mockEncryptString,
    decryptString: mockDecryptString,
  },
}));

import { CredentialManager, type CredentialService } from '../../src/services/credential-manager';

describe('CredentialManager', () => {
  let tmpDir: string;
  let credentialManager: CredentialManager;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-test-'));
    credentialManager = new CredentialManager(tmpDir);

    // Reset mocks and restore default implementations
    vi.clearAllMocks();
    mockIsEncryptionAvailable.mockReturnValue(true);
    mockEncryptString.mockImplementation((plaintext: string) => {
      return Buffer.from(`ENCRYPTED:${plaintext}`);
    });
    mockDecryptString.mockImplementation((encrypted: Buffer) => {
      const text = encrypted.toString();
      if (text.startsWith('ENCRYPTED:')) {
        return text.slice('ENCRYPTED:'.length);
      }
      throw new Error('Invalid encrypted data');
    });
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('storeApiKey', () => {
    it('should store an API key successfully', async () => {
      await credentialManager.storeApiKey('anthropic', 'sk-ant-test-123');

      // Verify safeStorage was called
      expect(mockIsEncryptionAvailable).toHaveBeenCalled();
      expect(mockEncryptString).toHaveBeenCalledWith('sk-ant-test-123');

      // Verify file was created
      const credentialsFile = path.join(tmpDir, 'credentials.json');
      expect(fs.existsSync(credentialsFile)).toBe(true);

      // Verify content is encrypted (base64 encoded)
      const content = fs.readFileSync(credentialsFile, 'utf-8');
      const json = JSON.parse(content);
      expect(json.anthropic).toBeTruthy();
      expect(typeof json.anthropic).toBe('string');
      // Should be base64 encoded
      expect(() => Buffer.from(json.anthropic, 'base64')).not.toThrow();
    });

    it('should store multiple API keys for different services', async () => {
      await credentialManager.storeApiKey('anthropic', 'sk-ant-test-123');
      await credentialManager.storeApiKey('openai', 'sk-openai-test-456');
      await credentialManager.storeApiKey('github', 'ghp_test789');

      const credentialsFile = path.join(tmpDir, 'credentials.json');
      const content = fs.readFileSync(credentialsFile, 'utf-8');
      const json = JSON.parse(content);

      expect(Object.keys(json)).toHaveLength(3);
      expect(json.anthropic).toBeTruthy();
      expect(json.openai).toBeTruthy();
      expect(json.github).toBeTruthy();
    });

    it('should overwrite existing key for the same service', async () => {
      await credentialManager.storeApiKey('anthropic', 'old-key');
      await credentialManager.storeApiKey('anthropic', 'new-key');

      const retrieved = await credentialManager.getApiKey('anthropic');
      expect(retrieved).toBe('new-key');
    });

    it('should throw error if key is empty', async () => {
      await expect(credentialManager.storeApiKey('anthropic', '')).rejects.toThrow(
        'API key cannot be empty'
      );
      await expect(credentialManager.storeApiKey('anthropic', '   ')).rejects.toThrow(
        'API key cannot be empty'
      );
    });

    it('should throw error if encryption is not available', async () => {
      mockIsEncryptionAvailable.mockReturnValue(false);

      await expect(credentialManager.storeApiKey('anthropic', 'test-key')).rejects.toThrow(
        'Encryption not available on this system'
      );
    });

    it('should create credentials.json atomically', async () => {
      await credentialManager.storeApiKey('anthropic', 'test-key');

      // Verify temp file is not left behind
      const tmpFile = path.join(tmpDir, 'credentials.json.tmp');
      expect(fs.existsSync(tmpFile)).toBe(false);

      // Verify final file exists
      const credentialsFile = path.join(tmpDir, 'credentials.json');
      expect(fs.existsSync(credentialsFile)).toBe(true);
    });
  });

  describe('getApiKey', () => {
    it('should retrieve a stored API key', async () => {
      await credentialManager.storeApiKey('anthropic', 'sk-ant-test-123');

      const retrieved = await credentialManager.getApiKey('anthropic');
      expect(retrieved).toBe('sk-ant-test-123');

      // Verify decryption was called
      expect(mockDecryptString).toHaveBeenCalled();
    });

    it('should return null for non-existent service', async () => {
      const retrieved = await credentialManager.getApiKey('anthropic');
      expect(retrieved).toBeNull();
    });

    it('should return null if credentials.json does not exist', async () => {
      const retrieved = await credentialManager.getApiKey('anthropic');
      expect(retrieved).toBeNull();
    });

    it('should throw error if encryption is not available', async () => {
      await credentialManager.storeApiKey('anthropic', 'test-key');

      // Make encryption unavailable
      mockIsEncryptionAvailable.mockReturnValue(false);

      await expect(credentialManager.getApiKey('anthropic')).rejects.toThrow(
        'Encryption not available on this system'
      );
    });

    it('should return null if decryption fails', async () => {
      await credentialManager.storeApiKey('anthropic', 'test-key');

      // Make decryption fail
      mockDecryptString.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const retrieved = await credentialManager.getApiKey('anthropic');
      expect(retrieved).toBeNull();
    });

    it('should retrieve different keys for different services', async () => {
      await credentialManager.storeApiKey('anthropic', 'key-1');
      await credentialManager.storeApiKey('openai', 'key-2');
      await credentialManager.storeApiKey('github', 'key-3');

      expect(await credentialManager.getApiKey('anthropic')).toBe('key-1');
      expect(await credentialManager.getApiKey('openai')).toBe('key-2');
      expect(await credentialManager.getApiKey('github')).toBe('key-3');
    });
  });

  describe('deleteApiKey', () => {
    it('should delete a stored API key', async () => {
      await credentialManager.storeApiKey('anthropic', 'test-key');
      await credentialManager.deleteApiKey('anthropic');

      const retrieved = await credentialManager.getApiKey('anthropic');
      expect(retrieved).toBeNull();
    });

    it('should not throw if service does not exist', async () => {
      await expect(credentialManager.deleteApiKey('anthropic')).resolves.toBeUndefined();
    });

    it('should only delete the specified service', async () => {
      await credentialManager.storeApiKey('anthropic', 'key-1');
      await credentialManager.storeApiKey('openai', 'key-2');

      await credentialManager.deleteApiKey('anthropic');

      expect(await credentialManager.getApiKey('anthropic')).toBeNull();
      expect(await credentialManager.getApiKey('openai')).toBe('key-2');
    });

    it('should handle deleting from empty credentials file', async () => {
      await expect(credentialManager.deleteApiKey('anthropic')).resolves.toBeUndefined();
    });
  });

  describe('listStoredServices', () => {
    it('should return empty array if no credentials are stored', async () => {
      const services = await credentialManager.listStoredServices();
      expect(services).toEqual([]);
    });

    it('should list all stored services', async () => {
      await credentialManager.storeApiKey('anthropic', 'key-1');
      await credentialManager.storeApiKey('openai', 'key-2');

      const services = await credentialManager.listStoredServices();
      expect(services).toHaveLength(2);
      expect(services).toContain('anthropic');
      expect(services).toContain('openai');
    });

    it('should not include deleted services', async () => {
      await credentialManager.storeApiKey('anthropic', 'key-1');
      await credentialManager.storeApiKey('openai', 'key-2');
      await credentialManager.deleteApiKey('anthropic');

      const services = await credentialManager.listStoredServices();
      expect(services).toEqual(['openai']);
    });

    it('should return empty array if credentials.json does not exist', async () => {
      const services = await credentialManager.listStoredServices();
      expect(services).toEqual([]);
    });
  });

  describe('persistence', () => {
    it('should persist credentials across manager instances', async () => {
      const manager1 = new CredentialManager(tmpDir);
      await manager1.storeApiKey('anthropic', 'persistent-key');

      // Create new instance
      const manager2 = new CredentialManager(tmpDir);
      const retrieved = await manager2.getApiKey('anthropic');

      expect(retrieved).toBe('persistent-key');
    });

    it('should handle concurrent operations gracefully', async () => {
      // Store multiple keys concurrently
      await Promise.all([
        credentialManager.storeApiKey('anthropic', 'key-1'),
        credentialManager.storeApiKey('openai', 'key-2'),
        credentialManager.storeApiKey('github', 'key-3'),
      ]);

      const services = await credentialManager.listStoredServices();
      expect(services).toHaveLength(3);

      // Verify all keys can be retrieved
      expect(await credentialManager.getApiKey('anthropic')).toBe('key-1');
      expect(await credentialManager.getApiKey('openai')).toBe('key-2');
      expect(await credentialManager.getApiKey('github')).toBe('key-3');
    });
  });

  describe('error handling', () => {
    it('should handle corrupt credentials.json gracefully', async () => {
      // Write invalid JSON
      const credentialsFile = path.join(tmpDir, 'credentials.json');
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(credentialsFile, 'invalid json {{{', 'utf-8');

      // Should return empty list instead of throwing
      const services = await credentialManager.listStoredServices();
      expect(services).toEqual([]);

      // Should return null instead of throwing
      const key = await credentialManager.getApiKey('anthropic');
      expect(key).toBeNull();

      // Should be able to store new key (overwrites corrupt file)
      await credentialManager.storeApiKey('anthropic', 'new-key');
      const retrieved = await credentialManager.getApiKey('anthropic');
      expect(retrieved).toBe('new-key');
    });

    it('should create directory if it does not exist', async () => {
      const nestedDir = path.join(tmpDir, 'nested', 'dir');
      const manager = new CredentialManager(nestedDir);

      await manager.storeApiKey('anthropic', 'test-key');

      expect(fs.existsSync(nestedDir)).toBe(true);
      const retrieved = await manager.getApiKey('anthropic');
      expect(retrieved).toBe('test-key');
    });
  });

  describe('encryption verification', () => {
    it('should store encrypted data on disk', async () => {
      await credentialManager.storeApiKey('anthropic', 'plaintext-secret');

      const credentialsFile = path.join(tmpDir, 'credentials.json');
      const content = fs.readFileSync(credentialsFile, 'utf-8');

      // Verify plaintext is not in file
      expect(content).not.toContain('plaintext-secret');

      // Verify encrypted data is present
      const json = JSON.parse(content);
      expect(json.anthropic).toBeTruthy();

      // Decode base64 and verify it contains encrypted prefix
      const decoded = Buffer.from(json.anthropic, 'base64').toString();
      expect(decoded).toContain('ENCRYPTED:');
    });

    it('should call safeStorage encryption methods', async () => {
      await credentialManager.storeApiKey('anthropic', 'test-key');

      expect(mockIsEncryptionAvailable).toHaveBeenCalled();
      expect(mockEncryptString).toHaveBeenCalledWith('test-key');

      await credentialManager.getApiKey('anthropic');

      expect(mockDecryptString).toHaveBeenCalled();
    });
  });
});
