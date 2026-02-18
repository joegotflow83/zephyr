import React from 'react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Reusable confirmation dialog modal.
 * Shows a title, message, and confirm/cancel buttons.
 * Danger variant uses red styling for the confirm button.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}) => {
  // Handle backdrop click to close (cancel)
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  // Determine confirm button styles based on variant
  const confirmButtonClass = variant === 'danger'
    ? 'px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors font-medium'
    : 'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium';

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 id="confirm-dialog-title" className="text-xl font-bold text-white">
            {title}
          </h2>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close dialog"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-gray-300 whitespace-pre-wrap">{message}</p>
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-3 px-6 pb-6">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={confirmButtonClass}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
