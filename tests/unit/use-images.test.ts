/**
 * Tests for the useImages hook.
 *
 * Verifies that the hook correctly exposes image state from the Zustand store
 * and delegates mutations to store actions which call window.api.images.*.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImages } from '../../src/renderer/hooks/useImages';
import { useAppStore } from '../../src/renderer/stores/app-store';
import type { ZephyrImage, ImageBuildConfig } from '../../src/shared/models';

const mockImages: ZephyrImage[] = [
  {
    id: 'img-1',
    name: 'python-3.12',
    dockerTag: 'zephyr-python-3.12:latest',
    languages: [{ languageId: 'python', version: '3.12' }],
    buildConfig: {
      name: 'python-3.12',
      languages: [{ languageId: 'python', version: '3.12' }],
    },
    builtAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'img-2',
    name: 'node-20',
    dockerTag: 'zephyr-node-20:latest',
    languages: [{ languageId: 'nodejs', version: '20' }],
    buildConfig: {
      name: 'node-20',
      languages: [{ languageId: 'nodejs', version: '20' }],
    },
    builtAt: '2024-01-02T00:00:00.000Z',
  },
];

describe('useImages Hook', () => {
  beforeEach(() => {
    // Mock window.api.images for store actions
    global.window.api = {
      images: {
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue(null),
        build: vi.fn().mockResolvedValue(undefined),
        rebuild: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(true),
        onBuildProgress: vi.fn(() => vi.fn()),
      },
    } as any;

    // Reset image-related store state
    useAppStore.setState({
      images: [],
      imagesLoading: false,
      imagesError: null,
      imageBuildProgress: null,
      imageBuildActive: false,
    });
  });

  describe('state selectors', () => {
    it('returns images from store', () => {
      useAppStore.setState({ images: mockImages });
      const { result } = renderHook(() => useImages());
      expect(result.current.images).toEqual(mockImages);
    });

    it('returns empty images array when store has no images', () => {
      const { result } = renderHook(() => useImages());
      expect(result.current.images).toEqual([]);
    });

    it('returns loading state from store', () => {
      useAppStore.setState({ imagesLoading: true });
      const { result } = renderHook(() => useImages());
      expect(result.current.loading).toBe(true);
    });

    it('returns false for loading when not loading', () => {
      useAppStore.setState({ imagesLoading: false });
      const { result } = renderHook(() => useImages());
      expect(result.current.loading).toBe(false);
    });

    it('returns error state from store', () => {
      useAppStore.setState({ imagesError: 'Failed to load images' });
      const { result } = renderHook(() => useImages());
      expect(result.current.error).toBe('Failed to load images');
    });

    it('returns null error when no error', () => {
      const { result } = renderHook(() => useImages());
      expect(result.current.error).toBeNull();
    });

    it('returns buildProgress from store', () => {
      useAppStore.setState({ imageBuildProgress: 'Step 1/5: FROM ubuntu:24.04' });
      const { result } = renderHook(() => useImages());
      expect(result.current.buildProgress).toBe('Step 1/5: FROM ubuntu:24.04');
    });

    it('returns null buildProgress when no build in progress', () => {
      const { result } = renderHook(() => useImages());
      expect(result.current.buildProgress).toBeNull();
    });

    it('returns buildActive from store', () => {
      useAppStore.setState({ imageBuildActive: true });
      const { result } = renderHook(() => useImages());
      expect(result.current.buildActive).toBe(true);
    });

    it('returns false for buildActive when no build running', () => {
      const { result } = renderHook(() => useImages());
      expect(result.current.buildActive).toBe(false);
    });
  });

  describe('build()', () => {
    it('calls window.api.images.build with the provided config', async () => {
      const config: ImageBuildConfig = {
        name: 'my-python-image',
        languages: [{ languageId: 'python', version: '3.12' }],
      };
      const { result } = renderHook(() => useImages());

      await act(async () => {
        await result.current.build(config);
      });

      expect(global.window.api.images.build).toHaveBeenCalledWith(config);
    });

    it('calls window.api.images.build with multi-language config', async () => {
      const config: ImageBuildConfig = {
        name: 'python-node-image',
        languages: [
          { languageId: 'python', version: '3.12' },
          { languageId: 'nodejs', version: '20' },
        ],
      };
      const { result } = renderHook(() => useImages());

      await act(async () => {
        await result.current.build(config);
      });

      expect(global.window.api.images.build).toHaveBeenCalledWith(config);
    });

    it('refreshes images after successful build', async () => {
      const updatedImages = [mockImages[0]];
      (global.window.api.images.list as ReturnType<typeof vi.fn>).mockResolvedValue(updatedImages);

      const config: ImageBuildConfig = {
        name: 'new-image',
        languages: [{ languageId: 'python', version: '3.12' }],
      };
      const { result } = renderHook(() => useImages());

      await act(async () => {
        await result.current.build(config);
      });

      expect(global.window.api.images.list).toHaveBeenCalled();
    });
  });

  describe('remove()', () => {
    it('calls window.api.images.delete with the image id', async () => {
      const { result } = renderHook(() => useImages());

      await act(async () => {
        await result.current.remove('img-1');
      });

      expect(global.window.api.images.delete).toHaveBeenCalledWith('img-1');
    });

    it('calls window.api.images.delete with any provided id', async () => {
      const { result } = renderHook(() => useImages());

      await act(async () => {
        await result.current.remove('some-other-id');
      });

      expect(global.window.api.images.delete).toHaveBeenCalledWith('some-other-id');
    });
  });

  describe('rebuild()', () => {
    it('calls window.api.images.rebuild with the image id', async () => {
      const { result } = renderHook(() => useImages());

      await act(async () => {
        await result.current.rebuild('img-1');
      });

      expect(global.window.api.images.rebuild).toHaveBeenCalledWith('img-1');
    });

    it('calls window.api.images.rebuild with any provided id', async () => {
      const { result } = renderHook(() => useImages());

      await act(async () => {
        await result.current.rebuild('img-2');
      });

      expect(global.window.api.images.rebuild).toHaveBeenCalledWith('img-2');
    });
  });

  describe('refresh()', () => {
    it('triggers refreshImages by calling window.api.images.list', async () => {
      const { result } = renderHook(() => useImages());

      await act(async () => {
        await result.current.refresh();
      });

      expect(global.window.api.images.list).toHaveBeenCalled();
    });

    it('updates images in store after refresh', async () => {
      (global.window.api.images.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockImages);
      const { result } = renderHook(() => useImages());

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.images).toEqual(mockImages);
    });
  });

  describe('hook interface', () => {
    it('exposes all required properties and methods', () => {
      const { result } = renderHook(() => useImages());

      expect(result.current).toHaveProperty('images');
      expect(result.current).toHaveProperty('loading');
      expect(result.current).toHaveProperty('error');
      expect(result.current).toHaveProperty('buildProgress');
      expect(result.current).toHaveProperty('buildActive');
      expect(typeof result.current.build).toBe('function');
      expect(typeof result.current.remove).toBe('function');
      expect(typeof result.current.rebuild).toBe('function');
      expect(typeof result.current.refresh).toBe('function');
    });
  });
});
