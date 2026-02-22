/**
 * Tests for ImageBuilderDialog component.
 *
 * Validates:
 * - Name input field rendering and auto-generation from language selections
 * - Language checkboxes and version dropdowns
 * - Base tools section (read-only)
 * - Build button triggers API with correct ImageBuildConfig
 * - Progress lines accumulated from streamed buildProgress updates
 * - Success message and onBuilt callback after successful build
 * - Error message with retry after failed build
 * - Close button behavior when idle vs during active build
 * - Confirmation dialog when closing during an active build
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageBuilderDialog } from '../../src/renderer/components/ImageBuilderDialog/ImageBuilderDialog';
import { AVAILABLE_LANGUAGES } from '../../src/shared/models';
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
    builtAt: '2026-02-22T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImageBuilderDialog', () => {
  const mockOnClose = vi.fn();
  const mockOnBuilt = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock state to defaults before each test
    mockImages.images = [];
    mockImages.loading = false;
    mockImages.error = null;
    mockImages.buildProgress = null;
    mockImages.buildActive = false;
    mockImages.build = vi.fn().mockResolvedValue(undefined);
  });

  // --- Structural rendering ---

  it('renders name input field', () => {
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByLabelText(/Image Name/i)).toBeInTheDocument();
  });

  it('renders checkboxes for all AVAILABLE_LANGUAGES', () => {
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);
    for (const lang of AVAILABLE_LANGUAGES) {
      expect(screen.getByLabelText(lang.name)).toBeInTheDocument();
    }
  });

  it('renders base tools section', () => {
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Base Tools (always included)')).toBeInTheDocument();
    // Spot-check a few tools
    expect(screen.getByText('git')).toBeInTheDocument();
    expect(screen.getByText('curl')).toBeInTheDocument();
    expect(screen.getByText('build-essential')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<ImageBuilderDialog isOpen={false} onClose={mockOnClose} />);
    expect(screen.queryByText('Build New Image')).not.toBeInTheDocument();
  });

  // --- Language checkboxes and version dropdowns ---

  it('checking a language shows its version dropdown', async () => {
    const user = userEvent.setup();
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    // No dropdowns initially
    expect(screen.queryByLabelText(/^Version:/i)).not.toBeInTheDocument();

    // Check Python
    await user.click(screen.getByLabelText('Python'));

    expect(screen.getByLabelText(/version/i)).toBeInTheDocument();
  });

  it('version dropdown contains the correct options for the language', async () => {
    const user = userEvent.setup();
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    await user.click(screen.getByLabelText('Python'));

    const pythonLang = AVAILABLE_LANGUAGES.find((l) => l.id === 'python')!;
    for (const version of pythonLang.versions) {
      expect(screen.getByRole('option', { name: version })).toBeInTheDocument();
    }
  });

  it('unchecking a language hides its version dropdown', async () => {
    const user = userEvent.setup();
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    await user.click(screen.getByLabelText('Python'));
    expect(screen.getByLabelText(/version/i)).toBeInTheDocument();

    await user.click(screen.getByLabelText('Python'));
    expect(screen.queryByLabelText(/version/i)).not.toBeInTheDocument();
  });

  // --- Name auto-generation ---

  it('auto-generates name from language selection', async () => {
    const user = userEvent.setup();
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    const nameInput = screen.getByLabelText(/Image Name/i);
    expect(nameInput).toHaveValue('');

    await user.click(screen.getByLabelText('Python'));

    // Should auto-generate: zephyr-python-{defaultVersion}
    const pythonLang = AVAILABLE_LANGUAGES.find((l) => l.id === 'python')!;
    const expectedName = `zephyr-python-${pythonLang.defaultVersion}`;
    expect(nameInput).toHaveValue(expectedName);
  });

  it('name is user-editable and overrides auto-generation', async () => {
    const user = userEvent.setup();
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    const nameInput = screen.getByLabelText(/Image Name/i);

    // Type a custom name
    await user.type(nameInput, 'my-custom-image');
    expect(nameInput).toHaveValue('my-custom-image');

    // Checking a language should NOT overwrite the custom name
    await user.click(screen.getByLabelText('Python'));
    expect(nameInput).toHaveValue('my-custom-image');
  });

  // --- Build action ---

  it('Build button calls build with correct ImageBuildConfig', async () => {
    const user = userEvent.setup();
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    // Select Python (default version 3.12) and accept auto-generated name
    await user.click(screen.getByLabelText('Python'));

    await user.click(screen.getByRole('button', { name: /^Build$/i }));

    const pythonLang = AVAILABLE_LANGUAGES.find((l) => l.id === 'python')!;
    await waitFor(() => {
      expect(mockImages.build).toHaveBeenCalledWith({
        name: `zephyr-python-${pythonLang.defaultVersion}`,
        languages: [{ languageId: 'python', version: pythonLang.defaultVersion }],
      });
    });
  });

  it('Build button is disabled until a language is selected', async () => {
    const user = userEvent.setup();
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    const buildBtn = screen.getByRole('button', { name: /^Build$/i });
    expect(buildBtn).toBeDisabled();

    await user.click(screen.getByLabelText('Python'));
    expect(buildBtn).not.toBeDisabled();
  });

  // --- Progress display ---

  it('shows progress lines during build', () => {
    const { rerender } = render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    // Set progress after initial mount so the reset-on-open effect doesn't clear it
    mockImages.buildProgress = 'Step 1: Pulling base image';
    rerender(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByTestId('build-output')).toHaveTextContent('Step 1: Pulling base image');
  });

  it('accumulates multiple progress lines', () => {
    const { rerender } = render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    mockImages.buildProgress = 'Line 1';
    rerender(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    mockImages.buildProgress = 'Line 2';
    rerender(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    const output = screen.getByTestId('build-output');
    expect(output).toHaveTextContent('Line 1');
    expect(output).toHaveTextContent('Line 2');
  });

  // --- Success state ---

  it('shows success message after successful build', async () => {
    const user = userEvent.setup();
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    await user.click(screen.getByLabelText('Python'));
    await user.click(screen.getByRole('button', { name: /^Build$/i }));

    await waitFor(() => {
      expect(screen.getByText('Image built successfully!')).toBeInTheDocument();
    });
  });

  it('calls onBuilt with the resulting image after success', async () => {
    const user = userEvent.setup();
    const pythonLang = AVAILABLE_LANGUAGES.find((l) => l.id === 'python')!;
    const builtImage = makeImage({
      name: `zephyr-python-${pythonLang.defaultVersion}`,
    });

    // The mock build function adds the image to the images list before resolving
    mockImages.build = vi.fn().mockImplementation(async () => {
      mockImages.images = [builtImage];
    });

    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} onBuilt={mockOnBuilt} />);

    await user.click(screen.getByLabelText('Python'));
    await user.click(screen.getByRole('button', { name: /^Build$/i }));

    await waitFor(() => {
      expect(mockOnBuilt).toHaveBeenCalledWith(builtImage);
    });
  });

  // --- Error state ---

  it('shows error message when build fails', async () => {
    mockImages.build = vi.fn().mockRejectedValue(new Error('Docker daemon not running'));

    const user = userEvent.setup();
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    await user.click(screen.getByLabelText('Python'));
    await user.click(screen.getByRole('button', { name: /^Build$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Build failed: Docker daemon not running/i)
      ).toBeInTheDocument();
    });
  });

  it('shows Retry button after build failure', async () => {
    mockImages.build = vi.fn().mockRejectedValue(new Error('failed'));

    const user = userEvent.setup();
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    await user.click(screen.getByLabelText('Python'));
    await user.click(screen.getByRole('button', { name: /^Build$/i }));

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  it('retry clears error so user can try again', async () => {
    mockImages.build = vi.fn().mockRejectedValue(new Error('failed'));

    const user = userEvent.setup();
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    await user.click(screen.getByLabelText('Python'));
    await user.click(screen.getByRole('button', { name: /^Build$/i }));

    await waitFor(() => expect(screen.getByText('Retry')).toBeInTheDocument());

    await user.click(screen.getByText('Retry'));

    expect(screen.queryByText(/Build failed/i)).not.toBeInTheDocument();
  });

  // --- Close button ---

  it('close button calls onClose when build is not active', async () => {
    const user = userEvent.setup();
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    await user.click(screen.getByLabelText('Close dialog'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('Cancel button calls onClose when build is not active', async () => {
    const user = userEvent.setup();
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  // --- Confirmation during active build ---

  it('shows confirmation when closing during an active build', async () => {
    const user = userEvent.setup();
    mockImages.buildActive = true;

    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    await user.click(screen.getByLabelText('Close dialog'));

    expect(screen.getByText(/A build is in progress/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close anyway/i })).toBeInTheDocument();
  });

  it('"Close anyway" calls onClose during active build', async () => {
    const user = userEvent.setup();
    mockImages.buildActive = true;

    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    await user.click(screen.getByLabelText('Close dialog'));
    await user.click(screen.getByRole('button', { name: /Close anyway/i }));

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('"Stay" dismisses the confirmation without closing', async () => {
    const user = userEvent.setup();
    mockImages.buildActive = true;

    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    await user.click(screen.getByLabelText('Close dialog'));
    expect(screen.getByText(/A build is in progress/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Stay' }));

    expect(screen.queryByText(/A build is in progress/i)).not.toBeInTheDocument();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('Build button shows "Building..." when buildActive is true', () => {
    mockImages.buildActive = true;
    render(<ImageBuilderDialog isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByText('Building...')).toBeInTheDocument();
  });
});
