import React from 'react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  loading?: boolean;
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
  loading = false,
  onConfirm,
  onCancel,
}) => {
  // Handle backdrop click to close (cancel) — disabled while loading
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (loading) return;
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  // Determine confirm button styles based on variant and loading state
  const confirmButtonClass = loading
    ? 'px-4 py-2 rounded font-medium flex items-center gap-2 opacity-60 cursor-not-allowed ' +
      (variant === 'danger' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white')
    : variant === 'danger'
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
            disabled={loading}
            className="text-gray-400 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
            disabled={loading}
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={confirmButtonClass}
          >
            {loading && (
              <svg
                className="w-4 h-4 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
