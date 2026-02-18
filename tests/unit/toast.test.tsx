import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { Toast, ToastItem } from '../../src/renderer/components/Toast/Toast';

describe('Toast Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders no toasts when array is empty', () => {
      const { container } = render(<Toast toasts={[]} onDismiss={vi.fn()} />);

      const toastContainer = container.firstChild as HTMLElement;
      expect(toastContainer.children).toHaveLength(0);
    });

    it('renders a single toast', () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'Test message', type: 'info' },
      ];

      render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      expect(screen.getByText('Test message')).toBeInTheDocument();
    });

    it('renders multiple toasts stacked', () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'First toast', type: 'info' },
        { id: '2', message: 'Second toast', type: 'success' },
        { id: '3', message: 'Third toast', type: 'error' },
      ];

      render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      expect(screen.getByText('First toast')).toBeInTheDocument();
      expect(screen.getByText('Second toast')).toBeInTheDocument();
      expect(screen.getByText('Third toast')).toBeInTheDocument();
    });

    it('renders toast with correct role and aria-live attributes', () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'Test message', type: 'info' },
      ];

      render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      const toast = screen.getByRole('alert');
      expect(toast).toHaveAttribute('aria-live', 'polite');
    });
  });

  describe('Toast Types', () => {
    it('renders success toast with correct styling and icon', () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'Success', type: 'success' },
      ];

      render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      const toast = screen.getByRole('alert');
      expect(toast).toHaveClass('bg-green-600', 'border-green-500');
      expect(screen.getByText('✓')).toBeInTheDocument();
    });

    it('renders error toast with correct styling and icon', () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'Error', type: 'error' },
      ];

      render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      const toast = screen.getByRole('alert');
      expect(toast).toHaveClass('bg-red-600', 'border-red-500');
      expect(screen.getByText('✕')).toBeInTheDocument();
    });

    it('renders warning toast with correct styling and icon', () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'Warning', type: 'warning' },
      ];

      render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      const toast = screen.getByRole('alert');
      expect(toast).toHaveClass('bg-yellow-600', 'border-yellow-500');
      expect(screen.getByText('⚠')).toBeInTheDocument();
    });

    it('renders info toast with correct styling and icon', () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'Info', type: 'info' },
      ];

      render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      const toast = screen.getByRole('alert');
      expect(toast).toHaveClass('bg-blue-600', 'border-blue-500');
      expect(screen.getByText('ⓘ')).toBeInTheDocument();
    });
  });

  describe('Auto-dismiss', () => {
    it('calls onDismiss after default duration (5000ms)', () => {
      const onDismiss = vi.fn();
      const toasts: ToastItem[] = [
        { id: '1', message: 'Test', type: 'info' },
      ];

      render(<Toast toasts={toasts} onDismiss={onDismiss} />);

      expect(onDismiss).not.toHaveBeenCalled();

      vi.advanceTimersByTime(5000);

      expect(onDismiss).toHaveBeenCalledWith('1');
    });

    it('calls onDismiss after custom duration', () => {
      const onDismiss = vi.fn();
      const toasts: ToastItem[] = [
        { id: '1', message: 'Test', type: 'info', duration: 3000 },
      ];

      render(<Toast toasts={toasts} onDismiss={onDismiss} />);

      vi.advanceTimersByTime(2999);
      expect(onDismiss).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onDismiss).toHaveBeenCalledWith('1');
    });

    it('does not dismiss before duration expires', () => {
      const onDismiss = vi.fn();
      const toasts: ToastItem[] = [
        { id: '1', message: 'Test', type: 'info', duration: 5000 },
      ];

      render(<Toast toasts={toasts} onDismiss={onDismiss} />);

      vi.advanceTimersByTime(4999);
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('dismisses multiple toasts independently', () => {
      const onDismiss = vi.fn();
      const toasts: ToastItem[] = [
        { id: '1', message: 'First', type: 'info', duration: 2000 },
        { id: '2', message: 'Second', type: 'info', duration: 4000 },
      ];

      render(<Toast toasts={toasts} onDismiss={onDismiss} />);

      vi.advanceTimersByTime(2000);
      expect(onDismiss).toHaveBeenCalledWith('1');
      expect(onDismiss).not.toHaveBeenCalledWith('2');

      vi.advanceTimersByTime(2000);
      expect(onDismiss).toHaveBeenCalledWith('2');
    });
  });

  describe('Manual Dismiss', () => {
    it('calls onDismiss when close button is clicked', async () => {
      vi.useRealTimers(); // Use real timers for user events
      const onDismiss = vi.fn();
      const toasts: ToastItem[] = [
        { id: '1', message: 'Test', type: 'info' },
      ];

      render(<Toast toasts={toasts} onDismiss={onDismiss} />);

      const closeButton = screen.getByLabelText('Dismiss notification');
      await userEvent.click(closeButton);

      // Wait for exit animation (300ms)
      await waitFor(() => {
        expect(onDismiss).toHaveBeenCalledWith('1');
      }, { timeout: 500 });
    });

    it('close button has correct aria-label', () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'Test', type: 'info' },
      ];

      render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      const closeButton = screen.getByLabelText('Dismiss notification');
      expect(closeButton).toBeInTheDocument();
    });

    it('clicking close button on one toast does not affect others', async () => {
      vi.useRealTimers(); // Use real timers for user events
      const onDismiss = vi.fn();
      const toasts: ToastItem[] = [
        { id: '1', message: 'First', type: 'info' },
        { id: '2', message: 'Second', type: 'info' },
      ];

      render(<Toast toasts={toasts} onDismiss={onDismiss} />);

      const closeButtons = screen.getAllByLabelText('Dismiss notification');
      await userEvent.click(closeButtons[0]);

      await waitFor(() => {
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onDismiss).toHaveBeenCalledWith('1');
      }, { timeout: 500 });
    });
  });

  describe('Layout and Styling', () => {
    it('renders container with fixed positioning in bottom-right', () => {
      const { container } = render(<Toast toasts={[]} onDismiss={vi.fn()} />);

      const toastContainer = container.firstChild as HTMLElement;
      expect(toastContainer).toHaveClass('fixed', 'bottom-10', 'right-4');
    });

    it('has high z-index to stay above other content', () => {
      const { container } = render(<Toast toasts={[]} onDismiss={vi.fn()} />);

      const toastContainer = container.firstChild as HTMLElement;
      expect(toastContainer).toHaveClass('z-[100]');
    });

    it('stacks toasts in reverse flex column layout', () => {
      const { container } = render(<Toast toasts={[]} onDismiss={vi.fn()} />);

      const toastContainer = container.firstChild as HTMLElement;
      expect(toastContainer).toHaveClass('flex', 'flex-col-reverse');
    });

    it('toasts have minimum and maximum width constraints', () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'Test', type: 'info' },
      ];

      render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      const toast = screen.getByRole('alert');
      expect(toast).toHaveClass('min-w-[300px]', 'max-w-md');
    });

    it('toasts have proper spacing and shadow', () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'Test', type: 'info' },
      ];

      render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      const toast = screen.getByRole('alert');
      expect(toast).toHaveClass('shadow-lg', 'px-4', 'py-3');
    });
  });

  describe('Exit Animation', () => {
    it('applies exit animation classes before dismissal', () => {
      const onDismiss = vi.fn();
      const toasts: ToastItem[] = [
        { id: '1', message: 'Test', type: 'info', duration: 1000 },
      ];

      render(<Toast toasts={toasts} onDismiss={onDismiss} />);

      const toast = screen.getByRole('alert');

      // Initially visible
      expect(toast).toHaveClass('opacity-100', 'translate-x-0');

      // Exit animation starts 300ms before dismissal (at 700ms for 1000ms duration)
      act(() => {
        vi.advanceTimersByTime(700);
      });

      // Check if exit animation is applied
      expect(toast).toHaveClass('opacity-0', 'translate-x-full');
    });

    it('applies exit animation when manually closed', async () => {
      vi.useRealTimers(); // Use real timers for user events
      const toasts: ToastItem[] = [
        { id: '1', message: 'Test', type: 'info' },
      ];

      render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      const toast = screen.getByRole('alert');
      const closeButton = screen.getByLabelText('Dismiss notification');

      expect(toast).toHaveClass('opacity-100', 'translate-x-0');

      await userEvent.click(closeButton);

      await waitFor(() => {
        expect(toast).toHaveClass('opacity-0', 'translate-x-full');
      }, { timeout: 100 });
    });
  });

  describe('Message Display', () => {
    it('displays short messages correctly', () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'Short', type: 'info' },
      ];

      render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      expect(screen.getByText('Short')).toBeInTheDocument();
    });

    it('displays long messages with word wrapping', () => {
      const longMessage = 'This is a very long message that should wrap properly within the toast container without breaking the layout or causing overflow issues.';
      const toasts: ToastItem[] = [
        { id: '1', message: longMessage, type: 'info' },
      ];

      render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      const messageElement = screen.getByText(longMessage);
      expect(messageElement).toHaveClass('break-words');
    });

    it('handles special characters in messages', () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'Error: <>&"\'', type: 'error' },
      ];

      render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      expect(screen.getByText('Error: <>&"\'')).toBeInTheDocument();
    });
  });

  describe('Timer Cleanup', () => {
    it('clears timers on unmount', () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'Test', type: 'info' },
      ];

      const { unmount } = render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

      const timerCount = vi.getTimerCount();

      unmount();

      expect(vi.getTimerCount()).toBeLessThan(timerCount);
    });
  });
});
