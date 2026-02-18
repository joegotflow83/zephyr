import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../../src/renderer/components/ConfirmDialog/ConfirmDialog';

describe('ConfirmDialog Component', () => {
  describe('Rendering', () => {
    it('renders with title and message', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Delete Project"
          message="Are you sure you want to delete this project?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText('Delete Project')).toBeInTheDocument();
      expect(screen.getByText('Are you sure you want to delete this project?')).toBeInTheDocument();
    });

    it('renders default button labels', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Confirm Action"
          message="Please confirm"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText('Confirm')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('renders custom button labels', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Delete"
          message="Delete?"
          confirmLabel="Delete Now"
          cancelLabel="Go Back"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText('Delete Now')).toBeInTheDocument();
      expect(screen.getByText('Go Back')).toBeInTheDocument();
    });

    it('renders multi-line messages with whitespace-pre-wrap class', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      const { container } = render(
        <ConfirmDialog
          title="Warning"
          message="Line 1\nLine 2\nLine 3"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      // Find the message paragraph by class
      const messageElement = container.querySelector('.whitespace-pre-wrap');
      expect(messageElement).toBeInTheDocument();
      // Verify the content includes all lines (textContent preserves newlines)
      expect(messageElement?.textContent).toContain('Line 1');
      expect(messageElement?.textContent).toContain('Line 2');
      expect(messageElement?.textContent).toContain('Line 3');
    });

    it('has correct accessibility attributes', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Test"
          message="Message"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-dialog-title');
    });
  });

  describe('Default Variant', () => {
    it('renders with blue confirm button by default', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Test Action"
          message="Proceed?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      const confirmButton = screen.getByText('Confirm');
      expect(confirmButton.className).toContain('bg-blue-600');
      expect(confirmButton.className).not.toContain('bg-red-600');
    });

    it('renders with blue confirm button when variant is default', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Test Action"
          message="Proceed?"
          variant="default"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      const confirmButton = screen.getByText('Confirm');
      expect(confirmButton.className).toContain('bg-blue-600');
    });
  });

  describe('Danger Variant', () => {
    it('renders with red confirm button for danger variant', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Delete Project"
          message="Delete?"
          variant="danger"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      const confirmButton = screen.getByText('Confirm');
      expect(confirmButton.className).toContain('bg-red-600');
      expect(confirmButton.className).not.toContain('bg-blue-600');
    });

    it('applies red hover styles for danger variant', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Delete Project"
          message="Delete?"
          variant="danger"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      const confirmButton = screen.getByText('Confirm');
      expect(confirmButton.className).toContain('hover:bg-red-700');
    });
  });

  describe('User Interactions', () => {
    it('calls onConfirm when confirm button is clicked', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Test Action"
          message="Proceed?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      fireEvent.click(screen.getByText('Confirm'));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('calls onCancel when cancel button is clicked', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Test Action"
          message="Proceed?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      fireEvent.click(screen.getByText('Cancel'));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('calls onCancel when close button is clicked', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Test Action"
          message="Proceed?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      const closeButton = screen.getByLabelText('Close dialog');
      fireEvent.click(closeButton);
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('calls onCancel when backdrop is clicked', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Test Action"
          message="Proceed?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      const backdrop = screen.getByRole('dialog');
      fireEvent.click(backdrop);
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('does not call onCancel when dialog content is clicked', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Test Action"
          message="Proceed?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      const title = screen.getByText('Test Action');
      fireEvent.click(title);
      expect(onCancel).not.toHaveBeenCalled();
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('handles empty message', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Test Title"
          message=""
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText('Test Title')).toBeInTheDocument();
      expect(screen.getByText('Confirm')).toBeInTheDocument();
    });

    it('handles long messages', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      const longMessage = 'A'.repeat(500);

      render(
        <ConfirmDialog
          title="Long Message Test"
          message={longMessage}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText(longMessage)).toBeInTheDocument();
    });

    it('handles special characters in title and message', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="<Delete> & 'Remove'"
          message='Are you "sure"? <Yes/No>'
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText("<Delete> & 'Remove'")).toBeInTheDocument();
      expect(screen.getByText('Are you "sure"? <Yes/No>')).toBeInTheDocument();
    });

    it('handles rapid clicks on confirm button', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmDialog
          title="Rapid Click Test"
          message="Proceed?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      const confirmButton = screen.getByText('Confirm');
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);

      expect(onConfirm).toHaveBeenCalledTimes(3);
    });
  });
});
