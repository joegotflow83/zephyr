import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useToast } from '../../src/renderer/hooks/useToast';

describe('useToast Hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('starts with empty toasts array', () => {
      const { result } = renderHook(() => useToast());

      expect(result.current.toasts).toEqual([]);
    });

    it('exposes all required methods', () => {
      const { result } = renderHook(() => useToast());

      expect(result.current.showToast).toBeInstanceOf(Function);
      expect(result.current.dismissToast).toBeInstanceOf(Function);
      expect(result.current.dismissAll).toBeInstanceOf(Function);
      expect(result.current.success).toBeInstanceOf(Function);
      expect(result.current.error).toBeInstanceOf(Function);
      expect(result.current.warning).toBeInstanceOf(Function);
      expect(result.current.info).toBeInstanceOf(Function);
    });
  });

  describe('showToast', () => {
    it('adds a toast to the array', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Test message', 'info');
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].message).toBe('Test message');
      expect(result.current.toasts[0].type).toBe('info');
    });

    it('generates unique IDs for each toast', () => {
      const { result } = renderHook(() => useToast());

      let id1: string;
      let id2: string;

      act(() => {
        id1 = result.current.showToast('First', 'info');
        id2 = result.current.showToast('Second', 'info');
      });

      expect(id1).not.toBe(id2);
      expect(result.current.toasts).toHaveLength(2);
    });

    it('returns the ID of the created toast', () => {
      const { result } = renderHook(() => useToast());

      let toastId: string;

      act(() => {
        toastId = result.current.showToast('Test', 'info');
      });

      expect(result.current.toasts[0].id).toBe(toastId);
    });

    it('sets default duration to 5000ms when not specified', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Test', 'info');
      });

      expect(result.current.toasts[0].duration).toBe(5000);
    });

    it('accepts custom duration', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Test', 'info', 3000);
      });

      expect(result.current.toasts[0].duration).toBe(3000);
    });

    it('defaults to info type when type not specified', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Test');
      });

      expect(result.current.toasts[0].type).toBe('info');
    });

    it('adds multiple toasts to the array', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('First', 'info');
        result.current.showToast('Second', 'success');
        result.current.showToast('Third', 'error');
      });

      expect(result.current.toasts).toHaveLength(3);
      expect(result.current.toasts[0].message).toBe('First');
      expect(result.current.toasts[1].message).toBe('Second');
      expect(result.current.toasts[2].message).toBe('Third');
    });
  });

  describe('dismissToast', () => {
    it('removes a toast by ID', () => {
      const { result } = renderHook(() => useToast());

      let toastId: string;

      act(() => {
        toastId = result.current.showToast('Test', 'info');
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        result.current.dismissToast(toastId);
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('only removes the specified toast', () => {
      const { result } = renderHook(() => useToast());

      let id1: string;
      let id2: string;
      let id3: string;

      act(() => {
        id1 = result.current.showToast('First', 'info');
        id2 = result.current.showToast('Second', 'info');
        id3 = result.current.showToast('Third', 'info');
      });

      act(() => {
        result.current.dismissToast(id2);
      });

      expect(result.current.toasts).toHaveLength(2);
      expect(result.current.toasts.find((t) => t.id === id1)).toBeDefined();
      expect(result.current.toasts.find((t) => t.id === id2)).toBeUndefined();
      expect(result.current.toasts.find((t) => t.id === id3)).toBeDefined();
    });

    it('does nothing if ID does not exist', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Test', 'info');
      });

      const initialLength = result.current.toasts.length;

      act(() => {
        result.current.dismissToast('non-existent-id');
      });

      expect(result.current.toasts).toHaveLength(initialLength);
    });

    it('handles dismissing from empty array', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.dismissToast('any-id');
      });

      expect(result.current.toasts).toHaveLength(0);
    });
  });

  describe('dismissAll', () => {
    it('removes all toasts', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('First', 'info');
        result.current.showToast('Second', 'success');
        result.current.showToast('Third', 'error');
      });

      expect(result.current.toasts).toHaveLength(3);

      act(() => {
        result.current.dismissAll();
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('works when no toasts exist', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.dismissAll();
      });

      expect(result.current.toasts).toHaveLength(0);
    });
  });

  describe('Convenience Methods', () => {
    it('success() creates a success toast', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.success('Success message');
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].message).toBe('Success message');
      expect(result.current.toasts[0].type).toBe('success');
    });

    it('error() creates an error toast', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.error('Error message');
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].message).toBe('Error message');
      expect(result.current.toasts[0].type).toBe('error');
    });

    it('warning() creates a warning toast', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.warning('Warning message');
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].message).toBe('Warning message');
      expect(result.current.toasts[0].type).toBe('warning');
    });

    it('info() creates an info toast', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.info('Info message');
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].message).toBe('Info message');
      expect(result.current.toasts[0].type).toBe('info');
    });

    it('convenience methods accept custom duration', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.success('Success', 2000);
      });

      expect(result.current.toasts[0].duration).toBe(2000);
    });

    it('convenience methods return toast ID', () => {
      const { result } = renderHook(() => useToast());

      let id: string;

      act(() => {
        id = result.current.success('Test');
      });

      expect(result.current.toasts[0].id).toBe(id);
    });
  });

  describe('Multiple Toast Scenarios', () => {
    it('handles mixed toast types', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.success('Success');
        result.current.error('Error');
        result.current.warning('Warning');
        result.current.info('Info');
      });

      expect(result.current.toasts).toHaveLength(4);
      expect(result.current.toasts[0].type).toBe('success');
      expect(result.current.toasts[1].type).toBe('error');
      expect(result.current.toasts[2].type).toBe('warning');
      expect(result.current.toasts[3].type).toBe('info');
    });

    it('maintains order of toasts', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('First', 'info');
        result.current.showToast('Second', 'info');
        result.current.showToast('Third', 'info');
      });

      expect(result.current.toasts[0].message).toBe('First');
      expect(result.current.toasts[1].message).toBe('Second');
      expect(result.current.toasts[2].message).toBe('Third');
    });

    it('handles rapid toast creation', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        for (let i = 0; i < 10; i++) {
          result.current.showToast(`Toast ${i}`, 'info');
        }
      });

      expect(result.current.toasts).toHaveLength(10);
      // All IDs should be unique
      const ids = result.current.toasts.map((t) => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);
    });
  });

  describe('Callback Stability', () => {
    it('showToast callback remains stable across renders', () => {
      const { result, rerender } = renderHook(() => useToast());

      const firstCallback = result.current.showToast;

      act(() => {
        result.current.showToast('Test', 'info');
      });

      rerender();

      expect(result.current.showToast).toBe(firstCallback);
    });

    it('dismissToast callback remains stable across renders', () => {
      const { result, rerender } = renderHook(() => useToast());

      const firstCallback = result.current.dismissToast;

      act(() => {
        result.current.showToast('Test', 'info');
      });

      rerender();

      expect(result.current.dismissToast).toBe(firstCallback);
    });

    it('convenience method callbacks remain stable', () => {
      const { result, rerender } = renderHook(() => useToast());

      const callbacks = {
        success: result.current.success,
        error: result.current.error,
        warning: result.current.warning,
        info: result.current.info,
      };

      act(() => {
        result.current.success('Test');
      });

      rerender();

      expect(result.current.success).toBe(callbacks.success);
      expect(result.current.error).toBe(callbacks.error);
      expect(result.current.warning).toBe(callbacks.warning);
      expect(result.current.info).toBe(callbacks.info);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty message strings', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('', 'info');
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].message).toBe('');
    });

    it('handles very long messages', () => {
      const { result } = renderHook(() => useToast());

      const longMessage = 'A'.repeat(1000);

      act(() => {
        result.current.showToast(longMessage, 'info');
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].message).toBe(longMessage);
    });

    it('handles special characters in messages', () => {
      const { result } = renderHook(() => useToast());

      const specialMessage = '<script>alert("XSS")</script>';

      act(() => {
        result.current.showToast(specialMessage, 'info');
      });

      expect(result.current.toasts[0].message).toBe(specialMessage);
    });

    it('handles zero duration', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Test', 'info', 0);
      });

      expect(result.current.toasts[0].duration).toBe(0);
    });

    it('handles negative duration', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Test', 'info', -1000);
      });

      expect(result.current.toasts[0].duration).toBe(-1000);
    });
  });

  describe('Integration Patterns', () => {
    it('supports chaining multiple operations', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        const id1 = result.current.success('First');
        const id2 = result.current.error('Second');
        result.current.dismissToast(id1);
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].type).toBe('error');
    });

    it('can show, dismiss, and show again', () => {
      const { result } = renderHook(() => useToast());

      let id: string;

      act(() => {
        id = result.current.showToast('First', 'info');
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        result.current.dismissToast(id);
      });

      expect(result.current.toasts).toHaveLength(0);

      act(() => {
        result.current.showToast('Second', 'info');
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].message).toBe('Second');
    });
  });
});
