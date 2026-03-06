/**
 * Unit tests for src/services/config-manager.ts
 *
 * ConfigManager is a main-process service that manages ~/.zephyr/ config
 * directory and provides atomic JSON persistence. Tests inject a mock
 * filesystem via vi.mock so no real disk I/O occurs.
 *
 * Why atomic writes matter: if the process crashes during a write, a
 * partial file would corrupt the user's project data. The .tmp + rename
 * pattern ensures readers always see a complete file.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';

// vi.hoisted ensures these variables are available when vi.mock factory runs
const {
  mockMkdirSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockRenameSync,
  mockUnlinkSync,
} = vi.hoisted(() => ({
  mockMkdirSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockRenameSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    mkdirSync: mockMkdirSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    renameSync: mockRenameSync,
    unlinkSync: mockUnlinkSync,
  },
}));

vi.mock('os', () => ({
  default: {
    homedir: () => '/home/testuser',
  },
}));

import { ConfigManager } from '../../src/services/config-manager';

const TEST_DIR = '/tmp/zephyr-test';

describe('ConfigManager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Constructor and getConfigDir
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('uses the provided config directory', () => {
      const cm = new ConfigManager(TEST_DIR);
      expect(cm.getConfigDir()).toBe(TEST_DIR);
    });

    it('falls back to ~/.zephyr when no dir is provided', () => {
      const cm = new ConfigManager();
      expect(cm.getConfigDir()).toBe(path.join('/home/testuser', '.zephyr'));
    });
  });

  // ---------------------------------------------------------------------------
  // ensureConfigDir
  // ---------------------------------------------------------------------------

  describe('ensureConfigDir', () => {
    it('calls fs.mkdirSync with recursive: true', () => {
      const cm = new ConfigManager(TEST_DIR);
      cm.ensureConfigDir();
      expect(mockMkdirSync).toHaveBeenCalledWith(TEST_DIR, { recursive: true });
    });

    it('calls mkdirSync exactly once per call', () => {
      const cm = new ConfigManager(TEST_DIR);
      cm.ensureConfigDir();
      expect(mockMkdirSync).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // loadJson
  // ---------------------------------------------------------------------------

  describe('loadJson', () => {
    it('reads the correct file path', () => {
      mockReadFileSync.mockReturnValue('{"key":"value"}');
      const cm = new ConfigManager(TEST_DIR);
      cm.loadJson('projects.json');
      expect(mockReadFileSync).toHaveBeenCalledWith(
        path.join(TEST_DIR, 'projects.json'),
        'utf-8'
      );
    });

    it('returns parsed JSON data', () => {
      const data = { projects: [{ id: '1', name: 'Test' }] };
      mockReadFileSync.mockReturnValue(JSON.stringify(data));
      const cm = new ConfigManager(TEST_DIR);
      const result = cm.loadJson<typeof data>('projects.json');
      expect(result).toEqual(data);
    });

    it('returns null when file does not exist (ENOENT)', () => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockReadFileSync.mockImplementation(() => { throw err; });
      const cm = new ConfigManager(TEST_DIR);
      const result = cm.loadJson('missing.json');
      expect(result).toBeNull();
    });

    it('returns null when JSON is malformed', () => {
      mockReadFileSync.mockReturnValue('{ invalid json }');
      const cm = new ConfigManager(TEST_DIR);
      const result = cm.loadJson('corrupt.json');
      expect(result).toBeNull();
    });

    it('returns null for any read error', () => {
      const err = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
      mockReadFileSync.mockImplementation(() => { throw err; });
      const cm = new ConfigManager(TEST_DIR);
      const result = cm.loadJson('protected.json');
      expect(result).toBeNull();
    });

    it('preserves type parameter — returns typed object', () => {
      interface Settings { theme: string }
      mockReadFileSync.mockReturnValue('{"theme":"dark"}');
      const cm = new ConfigManager(TEST_DIR);
      const result = cm.loadJson<Settings>('settings.json');
      expect(result?.theme).toBe('dark');
    });

    it('returns null for an empty file', () => {
      mockReadFileSync.mockReturnValue('');
      const cm = new ConfigManager(TEST_DIR);
      const result = cm.loadJson('empty.json');
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // saveJson
  // ---------------------------------------------------------------------------

  describe('saveJson', () => {
    it('calls ensureConfigDir before writing', () => {
      const cm = new ConfigManager(TEST_DIR);
      cm.saveJson('projects.json', []);
      expect(mockMkdirSync).toHaveBeenCalledWith(TEST_DIR, { recursive: true });
    });

    it('writes to a .tmp file first (atomic pattern)', () => {
      const cm = new ConfigManager(TEST_DIR);
      cm.saveJson('projects.json', { data: 1 });
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        path.join(TEST_DIR, 'projects.json.tmp'),
        expect.any(String),
        'utf-8'
      );
    });

    it('renames .tmp to the final filename', () => {
      const cm = new ConfigManager(TEST_DIR);
      cm.saveJson('projects.json', {});
      expect(mockRenameSync).toHaveBeenCalledWith(
        path.join(TEST_DIR, 'projects.json.tmp'),
        path.join(TEST_DIR, 'projects.json')
      );
    });

    it('writes valid JSON content', () => {
      const data = { id: '1', name: 'My Project' };
      const cm = new ConfigManager(TEST_DIR);
      cm.saveJson('projects.json', data);
      const written = mockWriteFileSync.mock.calls[0][1] as string;
      expect(() => JSON.parse(written)).not.toThrow();
      expect(JSON.parse(written)).toEqual(data);
    });

    it('writes pretty-printed JSON (indent 2)', () => {
      const cm = new ConfigManager(TEST_DIR);
      cm.saveJson('test.json', { a: 1 });
      const written = mockWriteFileSync.mock.calls[0][1] as string;
      expect(written).toBe(JSON.stringify({ a: 1 }, null, 2));
    });

    it('cleans up .tmp file if writeFileSync throws', () => {
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('Disk full');
      });
      const cm = new ConfigManager(TEST_DIR);
      expect(() => cm.saveJson('projects.json', {})).toThrow('Disk full');
      expect(mockUnlinkSync).toHaveBeenCalledWith(path.join(TEST_DIR, 'projects.json.tmp'));
    });

    it('cleans up .tmp file if renameSync throws', () => {
      mockRenameSync.mockImplementation(() => {
        throw new Error('Rename failed');
      });
      const cm = new ConfigManager(TEST_DIR);
      expect(() => cm.saveJson('projects.json', {})).toThrow('Rename failed');
      expect(mockUnlinkSync).toHaveBeenCalledWith(path.join(TEST_DIR, 'projects.json.tmp'));
    });

    it('rethrows errors after cleanup', () => {
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('IO error');
      });
      const cm = new ConfigManager(TEST_DIR);
      expect(() => cm.saveJson('projects.json', {})).toThrow('IO error');
    });

    it('handles arrays as data', () => {
      const data = [{ id: '1' }, { id: '2' }];
      const cm = new ConfigManager(TEST_DIR);
      cm.saveJson('list.json', data);
      const written = mockWriteFileSync.mock.calls[0][1] as string;
      expect(JSON.parse(written)).toEqual(data);
    });

    it('rename is called after write (ordering)', () => {
      const callOrder: string[] = [];
      mockWriteFileSync.mockImplementation(() => callOrder.push('write'));
      mockRenameSync.mockImplementation(() => callOrder.push('rename'));
      const cm = new ConfigManager(TEST_DIR);
      cm.saveJson('projects.json', {});
      expect(callOrder).toEqual(['write', 'rename']);
    });
  });

  // ---------------------------------------------------------------------------
  // Round-trip: save then load
  // ---------------------------------------------------------------------------

  describe('round-trip save → load', () => {
    it('data survives a save/load cycle (mocked)', () => {
      const original = { name: 'Test Project', id: 'abc-123' };

      // Capture what was written so loadJson can return it
      let stored = '';
      mockWriteFileSync.mockImplementation((_path: string, content: string) => {
        stored = content;
      });
      mockReadFileSync.mockImplementation(() => stored);

      const cm = new ConfigManager(TEST_DIR);
      cm.saveJson('projects.json', original);
      const loaded = cm.loadJson<typeof original>('projects.json');

      expect(loaded).toEqual(original);
    });
  });
});
