/**
 * Tests for ProjectDialog component.
 *
 * Validates:
 * - Dialog renders in add and edit modes
 * - Form fields populate correctly from project data in edit mode
 * - Form validation (name required, repo URL format)
 * - Save callback with correct data
 * - Close callback on backdrop click and close button
 * - Custom prompts integration with PromptEditor
 * - Docker image picker: library vs custom mode, Build New Image flow
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectDialog } from '../../src/renderer/components/ProjectDialog/ProjectDialog';
import { createProjectConfig } from '../../src/shared/models';
import type { ZephyrImage } from '../../src/shared/models';

// --- Mock useImages hook ---
vi.mock('../../src/renderer/hooks/useImages', () => ({
  useImages: vi.fn(),
}));

// --- Mock ImageBuilderDialog to avoid its own Zustand/IPC dependencies ---
vi.mock(
  '../../src/renderer/components/ImageBuilderDialog/ImageBuilderDialog',
  () => ({
    ImageBuilderDialog: ({
      isOpen,
      onBuilt,
      onClose,
    }: {
      isOpen: boolean;
      onBuilt?: (img: ZephyrImage) => void;
      onClose: () => void;
    }) => {
      if (!isOpen) return null;
      const mockBuiltImage: ZephyrImage = {
        id: 'new-img-id',
        name: 'new-image',
        dockerTag: 'zephyr-new-image:latest',
        languages: [],
        buildConfig: { name: 'new-image', languages: [] },
        builtAt: '2026-02-22T00:00:00Z',
      };
      return (
        <div data-testid="image-builder-dialog">
          <button
            data-testid="mock-build-complete"
            onClick={() => onBuilt?.(mockBuiltImage)}
          >
            Complete Build
          </button>
          <button data-testid="mock-close-builder" onClick={onClose}>
            Close Builder
          </button>
        </div>
      );
    },
  })
);

import { useImages } from '../../src/renderer/hooks/useImages';

// Reusable test image
const testImage: ZephyrImage = {
  id: 'img-1',
  name: 'python-node',
  dockerTag: 'zephyr-python-node:latest',
  languages: [{ languageId: 'python', version: '3.12' }],
  buildConfig: { name: 'python-node', languages: [{ languageId: 'python', version: '3.12' }] },
  builtAt: '2026-02-20T00:00:00Z',
};

/** Returns a fresh mock for useImages with the given images list. */
function makeImagesMock(images: ZephyrImage[] = []) {
  return {
    images,
    loading: false,
    error: null,
    buildProgress: null,
    buildActive: false,
    build: vi.fn(),
    remove: vi.fn(),
    rebuild: vi.fn(),
    refresh: vi.fn(),
  };
}

describe('ProjectDialog', () => {
  const mockOnSave = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no images in library → custom mode
    vi.mocked(useImages).mockReturnValue(makeImagesMock([]));
  });

  describe('Add Mode', () => {
    it('renders with "Add New Project" title', () => {
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      expect(screen.getByText('Add New Project')).toBeInTheDocument();
      expect(screen.getByText('Create Project')).toBeInTheDocument();
    });

    it('initializes with empty name/url and default docker image in custom mode', () => {
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      expect(screen.getByLabelText(/Project Name/i)).toHaveValue('');
      expect(screen.getByLabelText(/Repository URL/i)).toHaveValue('');
      // With no images, defaults to custom mode — input has aria-label="Docker Image"
      expect(screen.getByLabelText(/Docker Image/i)).toHaveValue('ubuntu:24.04');
    });

    it('shows validation error when name is empty', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Try to submit with empty name
      await user.click(screen.getByText('Create Project'));

      expect(await screen.findByText('Project name is required')).toBeInTheDocument();
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('shows validation error for invalid repo URL', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Fill in name
      await user.type(screen.getByLabelText(/Project Name/i), 'Test Project');

      // Enter invalid URL
      await user.type(screen.getByLabelText(/Repository URL/i), 'not-a-valid-url');

      // Submit
      await user.click(screen.getByText('Create Project'));

      expect(await screen.findByText('Invalid repository URL format')).toBeInTheDocument();
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('accepts valid repo URLs', async () => {
      const user = userEvent.setup();
      const validUrls = [
        'https://github.com/user/repo',
        'http://example.com/repo.git',
        'git@github.com:user/repo.git',
        'file:///path/to/repo',
        '/absolute/path',
        './relative/path',
        '../parent/path',
      ];

      for (const url of validUrls) {
        vi.clearAllMocks();
        vi.mocked(useImages).mockReturnValue(makeImagesMock([]));
        const { unmount } = render(
          <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
        );

        await user.type(screen.getByLabelText(/Project Name/i), 'Test Project');
        await user.type(screen.getByLabelText(/Repository URL/i), url);
        await user.click(screen.getByText('Create Project'));

        await waitFor(() => {
          expect(mockOnSave).toHaveBeenCalled();
        });

        unmount();
      }
    }, 10000); // Increase timeout for multiple renders

    it('creates project with correct data on submit (custom image mode)', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Fill in form
      await user.type(screen.getByLabelText(/Project Name/i), 'My Project');
      await user.type(screen.getByLabelText(/Repository URL/i), 'https://github.com/user/repo');
      await user.clear(screen.getByLabelText(/Docker Image/i));
      await user.type(screen.getByLabelText(/Docker Image/i), 'python:3.11');

      // Submit
      await user.click(screen.getByText('Create Project'));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'My Project',
            repo_url: 'https://github.com/user/repo',
            docker_image: 'python:3.11',
            image_id: undefined,
            custom_prompts: {},
          })
        );
      });
    });

    it('trims whitespace from form fields', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      await user.type(screen.getByLabelText(/Project Name/i), '  Trimmed  ');
      await user.type(screen.getByLabelText(/Repository URL/i), '  https://github.com/user/repo  ');
      await user.click(screen.getByText('Create Project'));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Trimmed',
            repo_url: 'https://github.com/user/repo',
          })
        );
      });
    });
  });

  describe('Edit Mode', () => {
    const existingProject = createProjectConfig({
      id: 'test-id',
      name: 'Existing Project',
      repo_url: 'https://github.com/existing/repo',
      docker_image: 'node:20',
      custom_prompts: { 'test.md': 'Test content' },
    });

    it('renders with "Edit Project" title', () => {
      render(
        <ProjectDialog
          mode="edit"
          project={existingProject}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Edit Project')).toBeInTheDocument();
      expect(screen.getByText('Save Changes')).toBeInTheDocument();
    });

    it('populates form fields from project data', () => {
      render(
        <ProjectDialog
          mode="edit"
          project={existingProject}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByLabelText(/Project Name/i)).toHaveValue('Existing Project');
      expect(screen.getByLabelText(/Repository URL/i)).toHaveValue('https://github.com/existing/repo');
      // No image_id + no images → custom mode, input has docker_image value
      expect(screen.getByLabelText(/Docker Image/i)).toHaveValue('node:20');
    });

    it('preserves project ID and timestamps on update', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog
          mode="edit"
          project={existingProject}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      );

      // Change name
      await user.clear(screen.getByLabelText(/Project Name/i));
      await user.type(screen.getByLabelText(/Project Name/i), 'Updated Project');

      // Submit
      await user.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'test-id',
            name: 'Updated Project',
            created_at: existingProject.created_at,
          })
        );
      });
    });

    it('updates updated_at timestamp on save', async () => {
      const user = userEvent.setup();
      const beforeUpdate = new Date().toISOString();

      render(
        <ProjectDialog
          mode="edit"
          project={existingProject}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      );

      await user.clear(screen.getByLabelText(/Project Name/i));
      await user.type(screen.getByLabelText(/Project Name/i), 'Updated Project');
      await user.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalled();
        const savedProject = mockOnSave.mock.calls[0][0];
        expect(savedProject.updated_at).toBeDefined();
        expect(new Date(savedProject.updated_at).getTime()).toBeGreaterThanOrEqual(
          new Date(beforeUpdate).getTime()
        );
      });
    });

    it('shows custom prompts count', () => {
      render(
        <ProjectDialog
          mode="edit"
          project={existingProject}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('1 custom prompt(s) configured')).toBeInTheDocument();
    });

    it('pre-selects library mode when project has image_id', () => {
      vi.mocked(useImages).mockReturnValue(makeImagesMock([testImage]));

      const projectWithImage = createProjectConfig({
        name: 'Image Project',
        docker_image: testImage.dockerTag,
        image_id: testImage.id,
      });

      render(
        <ProjectDialog
          mode="edit"
          project={projectWithImage}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      );

      // Should be in library mode — the library radio is checked
      const libraryRadio = screen.getByDisplayValue('library') as HTMLInputElement;
      expect(libraryRadio.checked).toBe(true);

      // The dropdown should be present, not the text input
      expect(screen.getByLabelText(/Docker Image/i).tagName).toBe('SELECT');
    });

    it('saves image_id and dockerTag when library image is selected', async () => {
      const user = userEvent.setup();
      vi.mocked(useImages).mockReturnValue(makeImagesMock([testImage]));

      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // With images present, default to library mode
      const libraryRadio = screen.getByDisplayValue('library') as HTMLInputElement;
      expect(libraryRadio.checked).toBe(true);

      // Select an image from the dropdown
      await user.selectOptions(screen.getByLabelText(/Docker Image/i), testImage.id);

      // Fill in required name
      await user.type(screen.getByLabelText(/Project Name/i), 'Library Project');
      await user.click(screen.getByText('Create Project'));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            docker_image: testImage.dockerTag,
            image_id: testImage.id,
          })
        );
      });
    });

    it('clears image_id when switching to custom mode', async () => {
      const user = userEvent.setup();
      vi.mocked(useImages).mockReturnValue(makeImagesMock([testImage]));

      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Switch to custom mode
      await user.click(screen.getByDisplayValue('custom'));

      // Fill in required fields and custom image
      await user.type(screen.getByLabelText(/Project Name/i), 'Custom Project');
      await user.clear(screen.getByLabelText(/Docker Image/i));
      await user.type(screen.getByLabelText(/Docker Image/i), 'custom:1.0');
      await user.click(screen.getByText('Create Project'));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            docker_image: 'custom:1.0',
            image_id: undefined,
          })
        );
      });
    });
  });

  describe('Dialog Interactions', () => {
    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      await user.click(screen.getByLabelText('Close dialog'));
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when Cancel button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      await user.click(screen.getByText('Cancel'));
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when backdrop is clicked', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Click the backdrop (the outermost div with the background)
      const backdrop = container.firstChild as HTMLElement;
      await user.click(backdrop);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('does not close when modal content is clicked', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Click inside the modal content
      await user.click(screen.getByText('Add New Project'));

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Image Picker', () => {
    it('shows "Select from Library" and "Custom Image" radio buttons', () => {
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      expect(screen.getByDisplayValue('library')).toBeInTheDocument();
      expect(screen.getByDisplayValue('custom')).toBeInTheDocument();
    });

    it('defaults to custom mode when no images in library', () => {
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      const customRadio = screen.getByDisplayValue('custom') as HTMLInputElement;
      expect(customRadio.checked).toBe(true);
      // Text input should be visible
      expect(screen.getByLabelText(/Docker Image/i).tagName).toBe('INPUT');
    });

    it('defaults to library mode when images exist', () => {
      vi.mocked(useImages).mockReturnValue(makeImagesMock([testImage]));

      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      const libraryRadio = screen.getByDisplayValue('library') as HTMLInputElement;
      expect(libraryRadio.checked).toBe(true);
      // Dropdown should be visible
      expect(screen.getByLabelText(/Docker Image/i).tagName).toBe('SELECT');
    });

    it('library dropdown shows available images', () => {
      vi.mocked(useImages).mockReturnValue(makeImagesMock([testImage]));

      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      expect(screen.getByText('python-node')).toBeInTheDocument();
    });

    it('shows empty-library message when no images in library mode', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Switch to library mode manually
      await user.click(screen.getByDisplayValue('library'));

      expect(screen.getByText(/No images in library/i)).toBeInTheDocument();
    });

    it('can toggle between library and custom modes', async () => {
      const user = userEvent.setup();
      vi.mocked(useImages).mockReturnValue(makeImagesMock([testImage]));

      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Starts in library mode
      expect(screen.getByLabelText(/Docker Image/i).tagName).toBe('SELECT');

      // Switch to custom
      await user.click(screen.getByDisplayValue('custom'));
      expect(screen.getByLabelText(/Docker Image/i).tagName).toBe('INPUT');

      // Switch back to library
      await user.click(screen.getByDisplayValue('library'));
      expect(screen.getByLabelText(/Docker Image/i).tagName).toBe('SELECT');
    });

    it('shows "+ Build New Image" button', () => {
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      expect(screen.getByText('+ Build New Image')).toBeInTheDocument();
    });

    it('opens ImageBuilderDialog when "+ Build New Image" is clicked', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Initially no builder dialog
      expect(screen.queryByTestId('image-builder-dialog')).not.toBeInTheDocument();

      await user.click(screen.getByText('+ Build New Image'));

      expect(screen.getByTestId('image-builder-dialog')).toBeInTheDocument();
    });

    it('auto-selects newly built image and switches to library mode', async () => {
      const user = userEvent.setup();

      // Initially no images
      const imagesMock = makeImagesMock([]);
      vi.mocked(useImages).mockReturnValue(imagesMock);

      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Open builder
      await user.click(screen.getByText('+ Build New Image'));

      // Now simulate a successful build by updating mock and triggering onBuilt
      const newImage: ZephyrImage = {
        id: 'new-img-id',
        name: 'new-image',
        dockerTag: 'zephyr-new-image:latest',
        languages: [],
        buildConfig: { name: 'new-image', languages: [] },
        builtAt: '2026-02-22T00:00:00Z',
      };
      imagesMock.images = [newImage];
      vi.mocked(useImages).mockReturnValue(makeImagesMock([newImage]));

      // Click the mock "Complete Build" button
      await user.click(screen.getByTestId('mock-build-complete'));

      // Builder dialog should close
      expect(screen.queryByTestId('image-builder-dialog')).not.toBeInTheDocument();

      // Should now be in library mode
      await waitFor(() => {
        const libraryRadio = screen.getByDisplayValue('library') as HTMLInputElement;
        expect(libraryRadio.checked).toBe(true);
      });
    });
  });

  describe('Custom Prompts', () => {
    it('shows "Manage Prompts" button', () => {
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      expect(screen.getByText('Manage Prompts')).toBeInTheDocument();
    });

    it('toggles PromptEditor visibility', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Initially hidden
      expect(screen.queryByText('No custom prompts yet')).not.toBeInTheDocument();

      // Click to show
      await user.click(screen.getByText('Manage Prompts'));
      expect(screen.getByText('No custom prompts yet')).toBeInTheDocument();
      expect(screen.getByText('Hide')).toBeInTheDocument();

      // Click to hide
      await user.click(screen.getByText('Hide'));
      expect(screen.queryByText('No custom prompts yet')).not.toBeInTheDocument();
      expect(screen.getByText('Manage Prompts')).toBeInTheDocument();
    });

    it('includes custom prompts in saved project', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Fill in name
      await user.type(screen.getByLabelText(/Project Name/i), 'Test Project');

      // Open prompt editor
      await user.click(screen.getByText('Manage Prompts'));

      // Add a custom prompt
      await user.click(screen.getByText('+ Add New Prompt File'));
      await user.type(screen.getByPlaceholderText('custom-prompt.md'), 'my-prompt');

      // Click the "Add" button in the prompt editor
      const addButtons = screen.getAllByText('Add');
      await user.click(addButtons[addButtons.length - 1]); // Click the last "Add" button (in the prompt editor)

      // Wait for the prompt to be added and enter edit mode
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Enter prompt content...')).toBeInTheDocument();
      });

      // Now we're in edit mode, type content and save
      await user.type(screen.getByPlaceholderText('Enter prompt content...'), 'My custom prompt content');

      // Click the "Save" button in the prompt editor (not the form submit button)
      const saveButtons = screen.getAllByText('Save');
      await user.click(saveButtons[0]); // The prompt editor Save button

      // Wait for edit mode to exit
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('Enter prompt content...')).not.toBeInTheDocument();
      });

      // Submit the form
      await user.click(screen.getByText('Create Project'));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            custom_prompts: {
              'my-prompt.md': 'My custom prompt content',
            },
          })
        );
      });
    });
  });

  describe('Docker Image Field (Custom Mode)', () => {
    it('provides datalist suggestions in custom mode', () => {
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Default is custom mode (no images)
      const input = screen.getByLabelText(/Docker Image/i);
      expect(input).toHaveAttribute('list', 'docker-images');

      const datalist = document.getElementById('docker-images');
      expect(datalist).toBeInTheDocument();
      expect(datalist?.children.length).toBeGreaterThan(0);
    });

    it('allows custom docker image input', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      await user.type(screen.getByLabelText(/Project Name/i), 'Test');
      await user.clear(screen.getByLabelText(/Docker Image/i));
      await user.type(screen.getByLabelText(/Docker Image/i), 'custom:latest');
      await user.click(screen.getByText('Create Project'));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            docker_image: 'custom:latest',
            image_id: undefined,
          })
        );
      });
    });
  });

  describe('Form Validation Clearing', () => {
    it('clears name error when user starts typing', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Trigger validation error
      await user.click(screen.getByText('Create Project'));
      expect(await screen.findByText('Project name is required')).toBeInTheDocument();

      // Start typing - error should clear
      await user.type(screen.getByLabelText(/Project Name/i), 'T');
      expect(screen.queryByText('Project name is required')).not.toBeInTheDocument();
    });

    it('clears repo URL error when user starts typing', async () => {
      const user = userEvent.setup();
      render(
        <ProjectDialog mode="add" onSave={mockOnSave} onClose={mockOnClose} />
      );

      await user.type(screen.getByLabelText(/Project Name/i), 'Test');
      await user.type(screen.getByLabelText(/Repository URL/i), 'invalid');
      await user.click(screen.getByText('Create Project'));

      expect(await screen.findByText('Invalid repository URL format')).toBeInTheDocument();

      // Clear and retype - error should clear
      await user.clear(screen.getByLabelText(/Repository URL/i));
      await user.type(screen.getByLabelText(/Repository URL/i), 'https://');
      expect(screen.queryByText('Invalid repository URL format')).not.toBeInTheDocument();
    });
  });
});
