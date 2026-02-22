/**
 * Convenience hook for accessing images from the global store.
 *
 * Provides the images list and operations (build, rebuild, delete, refresh),
 * automatically keeping UI in sync with build progress via IPC listeners.
 */

import { useAppStore } from '../stores/app-store';
import type { ZephyrImage, ImageBuildConfig } from '../../shared/models';

export interface UseImagesResult {
  images: ZephyrImage[];
  loading: boolean;
  error: string | null;
  buildProgress: string | null;
  buildActive: boolean;
  build: (config: ImageBuildConfig) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rebuild: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Hook that provides image library state and operations.
 * Delegates to the app store for all mutations so that build progress
 * state (imageBuildActive, imageBuildProgress) is managed centrally.
 */
export function useImages(): UseImagesResult {
  const images = useAppStore((state) => state.images);
  const loading = useAppStore((state) => state.imagesLoading);
  const error = useAppStore((state) => state.imagesError);
  const buildProgress = useAppStore((state) => state.imageBuildProgress);
  const buildActive = useAppStore((state) => state.imageBuildActive);
  const buildImageAction = useAppStore((state) => state.buildImage);
  const deleteImageAction = useAppStore((state) => state.deleteImage);
  const rebuildImageAction = useAppStore((state) => state.rebuildImage);
  const refreshImagesAction = useAppStore((state) => state.refreshImages);

  const build = async (config: ImageBuildConfig): Promise<void> => {
    await buildImageAction(config);
  };

  const remove = async (id: string): Promise<void> => {
    await deleteImageAction(id);
  };

  const rebuild = async (id: string): Promise<void> => {
    await rebuildImageAction(id);
  };

  const refresh = async (): Promise<void> => {
    await refreshImagesAction();
  };

  return {
    images,
    loading,
    error,
    buildProgress,
    buildActive,
    build,
    remove,
    rebuild,
    refresh,
  };
}
