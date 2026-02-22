/**
 * Unit tests for src/services/image-store.ts
 *
 * ImageStore owns all CRUD logic for images.json. Tests use a mock
 * ConfigManager so no real disk I/O occurs. This keeps tests fast and
 * deterministic — the atomic write safety is covered by config-manager.test.ts.
 *
 * Why these tests matter: ID uniqueness and not-found handling prevent silent
 * data corruption (e.g. two images sharing an ID would make getImage
 * non-deterministic). Mirrors the ProjectStore test patterns for consistency.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImageStore } from '../../src/services/image-store';
import { ConfigManager } from '../../src/services/config-manager';
import { ZephyrImage, ImageBuildConfig } from '../../src/shared/models';

// ---------------------------------------------------------------------------
// Mock ConfigManager
// ---------------------------------------------------------------------------

function makeMockConfigManager(initial: ZephyrImage[] | null = null): ConfigManager {
  let store: ZephyrImage[] | null = initial;

  const mockSaveJson = vi.fn((filename: string, data: unknown) => {
    if (filename === 'images.json') {
      store = data as ZephyrImage[];
    }
  });

  const mockLoadJson = vi.fn(<T>(filename: string): T | null => {
    if (filename === 'images.json') {
      return store as unknown as T;
    }
    return null;
  });

  const cm = {
    loadJson: mockLoadJson,
    saveJson: mockSaveJson,
    getConfigDir: vi.fn(() => '/tmp/zephyr-test'),
    ensureConfigDir: vi.fn(),
  } as unknown as ConfigManager;

  return cm;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeImageBuildConfig(overrides: Partial<ImageBuildConfig> = {}): ImageBuildConfig {
  return {
    name: 'Test Image',
    languages: [{ languageId: 'python', version: '3.12' }],
    ...overrides,
  };
}

function makeImage(overrides: Partial<ZephyrImage> = {}): ZephyrImage {
  return {
    id: 'test-img-1',
    name: 'Test Image',
    dockerTag: 'zephyr-test-image:latest',
    languages: [{ languageId: 'python', version: '3.12' }],
    buildConfig: makeImageBuildConfig(),
    builtAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeImageInput(
  overrides: Partial<Omit<ZephyrImage, 'id' | 'builtAt'>> = {}
): Omit<ZephyrImage, 'id' | 'builtAt'> {
  return {
    name: 'My Image',
    dockerTag: 'zephyr-my-image:latest',
    languages: [{ languageId: 'nodejs', version: '20' }],
    buildConfig: makeImageBuildConfig({ name: 'My Image' }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImageStore', () => {
  // -------------------------------------------------------------------------
  // listImages
  // -------------------------------------------------------------------------

  describe('listImages', () => {
    it('returns an empty array when no file exists', () => {
      const cm = makeMockConfigManager(null);
      const store = new ImageStore(cm);
      expect(store.listImages()).toEqual([]);
    });

    it('returns all images from file', () => {
      const images = [makeImage({ id: 'a' }), makeImage({ id: 'b' })];
      const cm = makeMockConfigManager(images);
      const store = new ImageStore(cm);
      expect(store.listImages()).toHaveLength(2);
      expect(store.listImages().map((i) => i.id)).toEqual(['a', 'b']);
    });

    it('calls loadJson with images.json filename', () => {
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);
      store.listImages();
      expect(cm.loadJson).toHaveBeenCalledWith('images.json');
    });

    it('returns an empty array when file has empty array', () => {
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);
      expect(store.listImages()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getImage
  // -------------------------------------------------------------------------

  describe('getImage', () => {
    it('returns the matching image by id', () => {
      const image = makeImage({ id: 'find-me' });
      const cm = makeMockConfigManager([image]);
      const store = new ImageStore(cm);
      expect(store.getImage('find-me')).toEqual(image);
    });

    it('returns null when id is not found', () => {
      const cm = makeMockConfigManager([makeImage({ id: 'exists' })]);
      const store = new ImageStore(cm);
      expect(store.getImage('nope')).toBeNull();
    });

    it('returns null when the store is empty', () => {
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);
      expect(store.getImage('any-id')).toBeNull();
    });

    it('returns null when no file exists yet', () => {
      const cm = makeMockConfigManager(null);
      const store = new ImageStore(cm);
      expect(store.getImage('any-id')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // addImage
  // -------------------------------------------------------------------------

  describe('addImage', () => {
    it('returns a complete ZephyrImage with generated id and builtAt', () => {
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);
      const result = store.addImage(makeImageInput());

      expect(result.id).toBeTruthy();
      expect(result.builtAt).toBeTruthy();
      expect(result.name).toBe('My Image');
    });

    it('persists the new image via saveJson', () => {
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);
      store.addImage(makeImageInput());
      expect(cm.saveJson).toHaveBeenCalledWith('images.json', expect.any(Array));
    });

    it('the saved array includes the new image', () => {
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);
      const result = store.addImage(makeImageInput());

      const saved = (cm.saveJson as ReturnType<typeof vi.fn>).mock.calls[0][1] as ZephyrImage[];
      expect(saved.find((img) => img.id === result.id)).toBeDefined();
    });

    it('appends to existing images without removing them', () => {
      const existing = makeImage({ id: 'existing-1' });
      const cm = makeMockConfigManager([existing]);
      const store = new ImageStore(cm);
      store.addImage(makeImageInput());

      const saved = (cm.saveJson as ReturnType<typeof vi.fn>).mock.calls[0][1] as ZephyrImage[];
      expect(saved).toHaveLength(2);
      expect(saved[0].id).toBe('existing-1');
    });

    it('preserves all input fields in the returned image', () => {
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);
      const input = makeImageInput({
        name: 'Custom Image',
        dockerTag: 'zephyr-custom:v1',
        languages: [
          { languageId: 'python', version: '3.11' },
          { languageId: 'nodejs', version: '18' },
        ],
      });
      const result = store.addImage(input);

      expect(result.name).toBe('Custom Image');
      expect(result.dockerTag).toBe('zephyr-custom:v1');
      expect(result.languages).toHaveLength(2);
    });

    it('generates a unique UUID for id', () => {
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);
      const result = store.addImage(makeImageInput());

      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('sets builtAt to a valid ISO timestamp', () => {
      const before = new Date().toISOString();
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);
      const result = store.addImage(makeImageInput());
      const after = new Date().toISOString();

      expect(result.builtAt >= before).toBe(true);
      expect(result.builtAt <= after).toBe(true);
    });

    it('generates unique ids for sequential adds', () => {
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);
      const a = store.addImage(makeImageInput({ name: 'A' }));

      // Update mock to reflect saved state
      const savedAfterFirst = (cm.saveJson as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as ZephyrImage[];
      (cm.loadJson as ReturnType<typeof vi.fn>).mockReturnValue(savedAfterFirst);

      const b = store.addImage(makeImageInput({ name: 'B' }));
      expect(a.id).not.toBe(b.id);
    });

    it('preserves optional size field when provided', () => {
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);
      const result = store.addImage({ ...makeImageInput(), size: 512_000_000 });
      expect(result.size).toBe(512_000_000);
    });
  });

  // -------------------------------------------------------------------------
  // updateImage
  // -------------------------------------------------------------------------

  describe('updateImage', () => {
    it('returns the updated image with merged fields', () => {
      const original = makeImage({ id: 'upd-1', name: 'Old Name' });
      const cm = makeMockConfigManager([original]);
      const store = new ImageStore(cm);

      const result = store.updateImage('upd-1', { name: 'New Name' });
      expect(result.name).toBe('New Name');
    });

    it('preserves fields that were not changed', () => {
      const original = makeImage({ id: 'upd-2', dockerTag: 'zephyr-img:v1' });
      const cm = makeMockConfigManager([original]);
      const store = new ImageStore(cm);

      const result = store.updateImage('upd-2', { name: 'Changed' });
      expect(result.dockerTag).toBe('zephyr-img:v1');
    });

    it('can update builtAt (used by rebuildImage)', () => {
      const original = makeImage({ id: 'upd-3', builtAt: '2020-01-01T00:00:00.000Z' });
      const cm = makeMockConfigManager([original]);
      const store = new ImageStore(cm);

      const newTime = new Date().toISOString();
      const result = store.updateImage('upd-3', { builtAt: newTime });
      expect(result.builtAt).toBe(newTime);
    });

    it('preserves the id even if partial contains a different id', () => {
      const original = makeImage({ id: 'real-id' });
      const cm = makeMockConfigManager([original]);
      const store = new ImageStore(cm);

      const result = store.updateImage('real-id', { id: 'injected-id', name: 'X' });
      expect(result.id).toBe('real-id');
    });

    it('saves the updated list via saveJson', () => {
      const original = makeImage({ id: 'save-check' });
      const cm = makeMockConfigManager([original]);
      const store = new ImageStore(cm);

      store.updateImage('save-check', { name: 'Updated' });
      expect(cm.saveJson).toHaveBeenCalledWith('images.json', expect.any(Array));
    });

    it('throws when the image id is not found', () => {
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);
      expect(() => store.updateImage('ghost', { name: 'X' })).toThrow(
        'Image with id "ghost" not found'
      );
    });

    it('does not save when image is not found', () => {
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);

      try {
        store.updateImage('ghost', { name: 'X' });
      } catch {
        // expected
      }

      expect(cm.saveJson).not.toHaveBeenCalled();
    });

    it('replaces only the updated image in the list', () => {
      const img1 = makeImage({ id: 'img1', name: 'One' });
      const img2 = makeImage({ id: 'img2', name: 'Two' });
      const cm = makeMockConfigManager([img1, img2]);
      const store = new ImageStore(cm);

      store.updateImage('img1', { name: 'One Updated' });

      const saved = (cm.saveJson as ReturnType<typeof vi.fn>).mock.calls[0][1] as ZephyrImage[];
      expect(saved.find((img) => img.id === 'img1')?.name).toBe('One Updated');
      expect(saved.find((img) => img.id === 'img2')?.name).toBe('Two');
    });
  });

  // -------------------------------------------------------------------------
  // removeImage
  // -------------------------------------------------------------------------

  describe('removeImage', () => {
    it('returns true when the image is found and removed', () => {
      const image = makeImage({ id: 'rm-1' });
      const cm = makeMockConfigManager([image]);
      const store = new ImageStore(cm);
      expect(store.removeImage('rm-1')).toBe(true);
    });

    it('returns false when the image id is not found', () => {
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);
      expect(store.removeImage('ghost')).toBe(false);
    });

    it('saves the updated list after removal', () => {
      const image = makeImage({ id: 'rm-2' });
      const cm = makeMockConfigManager([image]);
      const store = new ImageStore(cm);

      store.removeImage('rm-2');
      expect(cm.saveJson).toHaveBeenCalledWith('images.json', expect.any(Array));
    });

    it('the saved list no longer contains the removed image', () => {
      const image = makeImage({ id: 'rm-3' });
      const cm = makeMockConfigManager([image]);
      const store = new ImageStore(cm);

      store.removeImage('rm-3');
      const saved = (cm.saveJson as ReturnType<typeof vi.fn>).mock.calls[0][1] as ZephyrImage[];
      expect(saved.find((img) => img.id === 'rm-3')).toBeUndefined();
    });

    it('does not remove other images', () => {
      const img1 = makeImage({ id: 'keep' });
      const img2 = makeImage({ id: 'remove' });
      const cm = makeMockConfigManager([img1, img2]);
      const store = new ImageStore(cm);

      store.removeImage('remove');
      const saved = (cm.saveJson as ReturnType<typeof vi.fn>).mock.calls[0][1] as ZephyrImage[];
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe('keep');
    });

    it('does not call saveJson when image is not found', () => {
      const cm = makeMockConfigManager([]);
      const store = new ImageStore(cm);
      store.removeImage('ghost');
      expect(cm.saveJson).not.toHaveBeenCalled();
    });

    it('returns false when store has no file', () => {
      const cm = makeMockConfigManager(null);
      const store = new ImageStore(cm);
      expect(store.removeImage('any-id')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // round-trip
  // -------------------------------------------------------------------------

  describe('round-trip', () => {
    it('add then list returns the image', () => {
      const cm = makeMockConfigManager(null);
      // Update load to return what was saved
      let savedImages: ZephyrImage[] | null = null;
      (cm.saveJson as ReturnType<typeof vi.fn>).mockImplementation(
        (filename: string, data: unknown) => {
          if (filename === 'images.json') savedImages = data as ZephyrImage[];
        }
      );
      (cm.loadJson as ReturnType<typeof vi.fn>).mockImplementation(
        <T>(filename: string): T | null => {
          if (filename === 'images.json') return savedImages as unknown as T;
          return null;
        }
      );

      const store = new ImageStore(cm);
      const added = store.addImage(makeImageInput({ name: 'Round Trip' }));
      const listed = store.listImages();

      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe(added.id);
      expect(listed[0].name).toBe('Round Trip');
    });

    it('add then getImage returns the image', () => {
      const cm = makeMockConfigManager(null);
      let savedImages: ZephyrImage[] | null = null;
      (cm.saveJson as ReturnType<typeof vi.fn>).mockImplementation(
        (filename: string, data: unknown) => {
          if (filename === 'images.json') savedImages = data as ZephyrImage[];
        }
      );
      (cm.loadJson as ReturnType<typeof vi.fn>).mockImplementation(
        <T>(filename: string): T | null => {
          if (filename === 'images.json') return savedImages as unknown as T;
          return null;
        }
      );

      const store = new ImageStore(cm);
      const added = store.addImage(makeImageInput({ name: 'Get Me' }));
      const found = store.getImage(added.id);

      expect(found).not.toBeNull();
      expect(found?.name).toBe('Get Me');
    });

    it('add then remove leaves empty list', () => {
      const cm = makeMockConfigManager(null);
      let savedImages: ZephyrImage[] | null = null;
      (cm.saveJson as ReturnType<typeof vi.fn>).mockImplementation(
        (filename: string, data: unknown) => {
          if (filename === 'images.json') savedImages = data as ZephyrImage[];
        }
      );
      (cm.loadJson as ReturnType<typeof vi.fn>).mockImplementation(
        <T>(filename: string): T | null => {
          if (filename === 'images.json') return savedImages as unknown as T;
          return null;
        }
      );

      const store = new ImageStore(cm);
      const added = store.addImage(makeImageInput());
      store.removeImage(added.id);

      expect(store.listImages()).toHaveLength(0);
    });
  });
});
