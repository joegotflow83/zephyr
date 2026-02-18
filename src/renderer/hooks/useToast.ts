import { useState, useCallback } from 'react';
import { ToastItem, ToastType } from '../components/Toast/Toast';

/**
 * Custom hook for managing toast notifications.
 * Provides functions to show and dismiss toasts.
 */
export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  /**
   * Show a new toast notification.
   * @param message - The message to display
   * @param type - The type of toast (success, error, warning, info)
   * @param duration - Optional duration in milliseconds (default: 5000)
   * @returns The ID of the created toast
   */
  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration?: number): string => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const newToast: ToastItem = {
        id,
        message,
        type,
        duration: duration ?? 5000,
      };

      setToasts((prev) => [...prev, newToast]);
      return id;
    },
    []
  );

  /**
   * Dismiss a toast notification by ID.
   * @param id - The ID of the toast to dismiss
   */
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  /**
   * Dismiss all toast notifications.
   */
  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  // Convenience methods for common toast types
  const success = useCallback(
    (message: string, duration?: number) => showToast(message, 'success', duration),
    [showToast]
  );

  const error = useCallback(
    (message: string, duration?: number) => showToast(message, 'error', duration),
    [showToast]
  );

  const warning = useCallback(
    (message: string, duration?: number) => showToast(message, 'warning', duration),
    [showToast]
  );

  const info = useCallback(
    (message: string, duration?: number) => showToast(message, 'info', duration),
    [showToast]
  );

  return {
    toasts,
    showToast,
    dismissToast,
    dismissAll,
    success,
    error,
    warning,
    info,
  };
}
