import React, { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

export interface ToastProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

/**
 * Toast component displays stacked notifications in the bottom-right corner.
 * Each toast auto-dismisses after the specified duration.
 */
export function Toast({ toasts, onDismiss }: ToastProps) {
  return (
    <div className="fixed bottom-10 right-4 z-[100] flex flex-col-reverse gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const duration = toast.duration ?? 5000;

    // Start exit animation slightly before dismissal
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, duration - 300);

    // Dismiss toast
    const dismissTimer = setTimeout(() => {
      onDismiss(toast.id);
    }, duration);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(dismissTimer);
    };
  }, [toast.id, toast.duration, onDismiss]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      onDismiss(toast.id);
    }, 300);
  };

  const typeStyles = {
    success: 'bg-green-600 border-green-500',
    error: 'bg-red-600 border-red-500',
    warning: 'bg-yellow-600 border-yellow-500',
    info: 'bg-blue-600 border-blue-500',
  };

  const typeIcons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ⓘ',
  };

  return (
    <div
      className={`
        ${typeStyles[toast.type]}
        border-l-4 rounded shadow-lg px-4 py-3 min-w-[300px] max-w-md
        flex items-start gap-3 text-white pointer-events-auto
        transition-all duration-300 ease-in-out
        ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}
      `}
      role="alert"
      aria-live="polite"
    >
      <div className="flex-shrink-0 text-xl font-bold leading-none">
        {typeIcons[toast.type]}
      </div>
      <div className="flex-1 text-sm leading-snug break-words">
        {toast.message}
      </div>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 text-white/80 hover:text-white transition-colors text-lg leading-none"
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}
