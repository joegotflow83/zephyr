/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Notarize Script', () => {
  const notarizeScriptPath = path.join(__dirname, '../../scripts/notarize.js');

  it('should exist', () => {
    expect(fs.existsSync(notarizeScriptPath)).toBe(true);
  });

  it('should export a function', () => {
    const notarizeModule = require(notarizeScriptPath);
    expect(typeof notarizeModule).toBe('function');
  });

  it('should contain @electron/notarize import', () => {
    const content = fs.readFileSync(notarizeScriptPath, 'utf-8');
    expect(content).toContain('@electron/notarize');
  });

  it('should skip notarization for non-macOS platforms', async () => {
    // Mock context for Windows
    const mockContext = {
      electronPlatformName: 'win32',
      appOutDir: '/fake/path',
      packager: {
        appPaths: {
          appPath: 'TestApp',
        },
      },
    };

    // Mock environment variables
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      APPLE_ID: 'test@example.com',
      APPLE_ID_PASSWORD: 'test-password',
      APPLE_TEAM_ID: 'TEST123',
    };

    const notarizeFunction = require(notarizeScriptPath);

    // Should not throw and should skip
    await expect(notarizeFunction(mockContext)).resolves.toBeUndefined();

    // Restore environment
    process.env = originalEnv;
  });

  it('should skip notarization if credentials are missing', async () => {
    // Mock context for macOS
    const mockContext = {
      electronPlatformName: 'darwin',
      appOutDir: '/fake/path',
      packager: {
        appPaths: {
          appPath: 'TestApp',
        },
      },
    };

    // Clear environment variables
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      APPLE_ID: undefined,
      APPLE_ID_PASSWORD: undefined,
      APPLE_TEAM_ID: undefined,
    };

    const notarizeFunction = require(notarizeScriptPath);

    // Should not throw and should skip
    await expect(notarizeFunction(mockContext)).resolves.toBeUndefined();

    // Restore environment
    process.env = originalEnv;
  });

  it('should require all three Apple credentials', () => {
    const content = fs.readFileSync(notarizeScriptPath, 'utf-8');
    expect(content).toContain('APPLE_ID');
    expect(content).toContain('APPLE_ID_PASSWORD');
    expect(content).toContain('APPLE_TEAM_ID');
  });

  it('should use notarytool', () => {
    const content = fs.readFileSync(notarizeScriptPath, 'utf-8');
    expect(content).toContain('notarytool');
  });
});
