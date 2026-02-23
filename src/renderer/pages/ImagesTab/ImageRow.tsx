import React from 'react';
import type { ZephyrImage } from '../../../shared/models';

interface ImageRowProps {
  image: ZephyrImage;
  onRebuild: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Single row component for displaying a built Zephyr image in the images table.
 * Shows image name, language badges, build date, and action buttons.
 */
export const ImageRow: React.FC<ImageRowProps> = ({ image, onRebuild, onDelete }) => {
  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  };

  return (
    <tr className="border-b border-gray-700 hover:bg-gray-800">
      <td className="px-4 py-3 text-sm font-medium text-white">
        {image.name}
      </td>
      <td className="px-4 py-3 text-sm text-gray-300">
        {image.languages.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {image.languages.map((lang) => (
              <span
                key={`${lang.languageId}-${lang.version}`}
                className="px-2 py-0.5 text-xs bg-blue-900 text-blue-300 rounded"
              >
                {lang.languageId} {lang.version}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-gray-500">None</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-gray-300">
        {formatDate(image.builtAt)}
      </td>
      <td className="px-4 py-3 text-sm text-right space-x-2">
        <button
          onClick={() => onRebuild(image.id)}
          className="px-3 py-1 bg-gray-700 text-white rounded font-medium hover:bg-gray-600 transition-colors"
          title="Rebuild image"
        >
          Rebuild
        </button>
        <button
          onClick={() => onDelete(image.id)}
          className="px-3 py-1 bg-red-700 text-white rounded font-medium hover:bg-red-600 transition-colors"
          title="Delete image"
        >
          Delete
        </button>
      </td>
    </tr>
  );
};
