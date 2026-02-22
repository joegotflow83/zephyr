/**
 * Tests for ImagesTab component.
 *
 * Validates:
 * - Empty state shown when no images exist
 * - Image table rendered with all images
 * - "Build New Image" button opens ImageBuilderDialog
 * - Delete action opens ConfirmDialog, confirmed delete calls remove
 * - Rebuild action calls rebuild with image id
 * - Build progress banner visible when imageBuildActive
 * - Loading state shows spinner
 * - Error state shows error message
 * - refresh called on mount
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImagesTab } from '../../src/renderer/pages/ImagesTab/ImagesTab';
import type { ZephyrImage } from '../../src/shared/models';

// ---------------------------------------------------------------------------
// Mock useImages hook
// ---------------------------------------------------------------------------

const mockImages = vi.hoisted(() => ({
  images: [] as ZephyrImage[],
  loading: false,
  error: null as string | null,
  buildProgress: null as string | null,
  buildActive: false,
  build: vi.fn(),
  remove: vi.fn(),
  rebuild: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('../../src/renderer/hooks/useImages', () => ({
  useImages: () => mockImages,
}));

// Mock ImageBuilderDialog to avoid full implementation complexity in tab tests
vi.mock('../../src/renderer/components/ImageBuilderDialog/ImageBuilderDialog', () => ({
  ImageBuilderDialog: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="image-builder-dialog">
        <button onClick={onClose}>Close Builder</button>
      </div>
    ) : null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeImage(overrides: Partial<ZephyrImage> = {}): ZephyrImage {
  return {
    id: 'img-1',
    name: 'zephyr-python-3.12',
    dockerTag: 'zephyr/python-3.12:latest',
    languages: [{ languageId: 'python', version: '3.12' }],
    buildConfig: {
      name: 'zephyr-python-3.12',
      languages: [{ languageId: 'python', version: '3.12' }],
    },
    builtAt: '2026-02-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('ImagesTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset to defaults
    mockImages.images = [];
    mockImages.loading = false;
    mockImages.error = null;
    mockImages.buildProgress = null;
    mockImages.buildActive = false;
    mockImages.build = vi.fn();
    mockImages.remove = vi.fn().mockResolvedValue(undefined);
    mockImages.rebuild = vi.fn();
    mockImages.refresh = vi.fn();
  });

  describe('Empty State', () => {
    it('shows empty state when no images exist', () => {
      render(<ImagesTab />);
      expect(screen.getByText('No Images Built Yet')).toBeInTheDocument();
      expect(screen.getByText(/No images built yet/)).toBeInTheDocument();
    });

    it('shows Build New Image button in empty state', () => {
      render(<ImagesTab />);
      expect(screen.getByRole('button', { name: /Build New Image/i })).toBeInTheDocument();
    });

    it('opens ImageBuilderDialog when empty-state Build button is clicked', async () => {
      const user = userEvent.setup();
      render(<ImagesTab />);

      await user.click(screen.getByRole('button', { name: /Build New Image/i }));

      expect(screen.getByTestId('image-builder-dialog')).toBeInTheDocument();
    });
  });

  describe('Image Table', () => {
    it('renders image table when images exist', () => {
      mockImages.images = [
        makeImage({ id: 'img-1', name: 'python-image' }),
        makeImage({ id: 'img-2', name: 'rust-image' }),
      ];

      render(<ImagesTab />);

      expect(screen.getByText('python-image')).toBeInTheDocument();
      expect(screen.getByText('rust-image')).toBeInTheDocument();
    });

    it('shows table headers', () => {
      mockImages.images = [makeImage()];

      render(<ImagesTab />);

      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Languages')).toBeInTheDocument();
      expect(screen.getByText('Built')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('shows Build New Image button in header when images exist', () => {
      mockImages.images = [makeImage()];

      render(<ImagesTab />);

      expect(screen.getByRole('button', { name: /Build New Image/i })).toBeInTheDocument();
    });
  });

  describe('Build New Image Dialog', () => {
    it('opens ImageBuilderDialog when header button is clicked', async () => {
      const user = userEvent.setup();
      mockImages.images = [makeImage()];

      render(<ImagesTab />);

      await user.click(screen.getByRole('button', { name: /Build New Image/i }));

      expect(screen.getByTestId('image-builder-dialog')).toBeInTheDocument();
    });

    it('closes ImageBuilderDialog when close is triggered', async () => {
      const user = userEvent.setup();
      mockImages.images = [makeImage()];

      render(<ImagesTab />);

      await user.click(screen.getByRole('button', { name: /Build New Image/i }));
      expect(screen.getByTestId('image-builder-dialog')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Close Builder/i }));
      expect(screen.queryByTestId('image-builder-dialog')).not.toBeInTheDocument();
    });
  });

  describe('Delete Action', () => {
    it('shows ConfirmDialog when Delete is clicked', async () => {
      const user = userEvent.setup();
      mockImages.images = [makeImage({ name: 'my-image' })];

      render(<ImagesTab />);

      await user.click(screen.getByRole('button', { name: /Delete/i }));

      expect(screen.getByText('Delete Image')).toBeInTheDocument();
      expect(screen.getByText(/Are you sure you want to delete "my-image"/)).toBeInTheDocument();
    });

    it('calls remove with image id when delete is confirmed', async () => {
      const user = userEvent.setup();
      mockImages.images = [makeImage({ id: 'img-to-delete' })];

      render(<ImagesTab />);

      // Click the row's Delete button (table row has title "Delete image")
      await user.click(screen.getByTitle('Delete image'));

      // ConfirmDialog is now open — its confirm button has confirmLabel="Delete"
      // There are now two Delete buttons; pick the last one (the dialog's confirm)
      const deleteButtons = screen.getAllByRole('button', { name: /^Delete$/i });
      await user.click(deleteButtons[deleteButtons.length - 1]);

      await waitFor(() => {
        expect(mockImages.remove).toHaveBeenCalledWith('img-to-delete');
      });
    });

    it('does not call remove when delete is cancelled', async () => {
      const user = userEvent.setup();
      mockImages.images = [makeImage()];

      render(<ImagesTab />);

      await user.click(screen.getByRole('button', { name: /Delete/i }));
      await user.click(screen.getByRole('button', { name: /Cancel/i }));

      expect(mockImages.remove).not.toHaveBeenCalled();
    });

    it('closes ConfirmDialog after cancelling delete', async () => {
      const user = userEvent.setup();
      mockImages.images = [makeImage()];

      render(<ImagesTab />);

      await user.click(screen.getByRole('button', { name: /Delete/i }));
      expect(screen.getByText('Delete Image')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Cancel/i }));
      expect(screen.queryByText('Delete Image')).not.toBeInTheDocument();
    });
  });

  describe('Rebuild Action', () => {
    it('calls rebuild with image id when Rebuild is clicked', async () => {
      const user = userEvent.setup();
      mockImages.images = [makeImage({ id: 'img-to-rebuild' })];

      render(<ImagesTab />);

      await user.click(screen.getByRole('button', { name: /Rebuild/i }));

      expect(mockImages.rebuild).toHaveBeenCalledWith('img-to-rebuild');
    });
  });

  describe('Build Progress Banner', () => {
    it('shows build progress banner when build is active', () => {
      mockImages.images = [makeImage()];
      mockImages.buildActive = true;
      mockImages.buildProgress = 'Step 3/7: Installing Python...';

      render(<ImagesTab />);

      expect(screen.getByText('Build Progress')).toBeInTheDocument();
      expect(screen.getByText('Step 3/7: Installing Python...')).toBeInTheDocument();
    });

    it('does not show build progress banner when build is not active', () => {
      mockImages.images = [makeImage()];
      mockImages.buildActive = false;
      mockImages.buildProgress = null;

      render(<ImagesTab />);

      expect(screen.queryByText('Build Progress')).not.toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('shows loading indicator when loading', () => {
      mockImages.loading = true;

      render(<ImagesTab />);

      expect(screen.getByText('Loading images...')).toBeInTheDocument();
    });

    it('does not show empty state while loading', () => {
      mockImages.loading = true;

      render(<ImagesTab />);

      expect(screen.queryByText('No Images Built Yet')).not.toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('shows error message when error occurs', () => {
      mockImages.images = [makeImage()];
      mockImages.error = 'Failed to load images';

      render(<ImagesTab />);

      expect(screen.getByText(/Failed to load images/)).toBeInTheDocument();
    });
  });

  describe('Lifecycle', () => {
    it('calls refresh on mount', async () => {
      render(<ImagesTab />);

      await waitFor(() => {
        expect(mockImages.refresh).toHaveBeenCalledTimes(1);
      });
    });
  });
});
