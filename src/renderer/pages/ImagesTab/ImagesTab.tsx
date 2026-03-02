import React, { useEffect, useState } from 'react';
import { ImageRow } from './ImageRow';
import { useImages } from '../../hooks/useImages';
import { ImageBuilderDialog } from '../../components/ImageBuilderDialog/ImageBuilderDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog';
import type { ZephyrImage } from '../../../shared/models';

/**
 * Images tab page component.
 * Displays the local Zephyr image library with build, rebuild, and delete actions.
 * Shows a build progress banner at the bottom during active builds.
 */
export const ImagesTab: React.FC = () => {
  const { images, loading, error, buildProgress, buildActive, rebuild, remove, refresh } = useImages();

  const [showBuilder, setShowBuilder] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ZephyrImage | null>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDeleteRequest = (id: string) => {
    const image = images.find((img) => img.id === id);
    if (image) {
      setConfirmDelete(image);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    try {
      await remove(confirmDelete.id);
    } finally {
      setConfirmDelete(null);
    }
  };

  const handleRebuild = (id: string) => {
    rebuild(id);
  };

  const handleBuilt = (_image: ZephyrImage) => {
    setShowBuilder(false);
    refresh();
  };

  const isEmpty = !loading && images.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center flex-1 p-6">
          <div className="text-center max-w-md">
            <div className="text-6xl mb-4">🖼️</div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">No Images Built Yet</h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              No images built yet. Click &apos;Build New Image&apos; to get started.
            </p>
            <button
              onClick={() => setShowBuilder(true)}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Build New Image
            </button>
          </div>
        </div>
      )}

      {/* Full state */}
      {!isEmpty && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Image Library</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Manage your locally built Docker images
              </p>
            </div>
            <button
              onClick={() => setShowBuilder(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <span>+</span>
              Build New Image
            </button>
          </div>

          {/* Error state */}
          {error && (
            <div className="mx-6 mt-4 p-4 bg-red-900 bg-opacity-50 border border-red-700 rounded text-red-200">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center p-12">
              <div className="text-gray-500 dark:text-gray-400">Loading images...</div>
            </div>
          )}

          {/* Images table */}
          {!loading && images.length > 0 && (
            <div className="flex-1 overflow-auto p-6">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Languages
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Built
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {images.map((image) => (
                    <ImageRow
                      key={image.id}
                      image={image}
                      buildActive={buildActive}
                      onRebuild={handleRebuild}
                      onDelete={handleDeleteRequest}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Build progress banner */}
          {buildActive && buildProgress && (
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              <div className="flex items-center gap-2 mb-1">
                <div className="animate-spin rounded-full h-3 w-3 border-2 border-green-400 border-t-transparent" />
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Build Progress</div>
              </div>
              <div className="text-sm text-green-300 font-mono">{buildProgress}</div>
            </div>
          )}
        </>
      )}

      {/* Single ImageBuilderDialog instance — must never remount during a build */}
      <ImageBuilderDialog
        isOpen={showBuilder}
        onClose={() => setShowBuilder(false)}
        onBuilt={handleBuilt}
      />

      {/* Confirm Delete Dialog */}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete Image"
          message={`Are you sure you want to delete "${confirmDelete.name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
};
