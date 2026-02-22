/**
 * Tests for ImageRow component.
 *
 * Validates:
 * - Renders image name, language badges, and formatted built date
 * - Rebuild button triggers onRebuild callback with image id
 * - Delete button triggers onDelete callback with image id
 * - No language badges shown when image has no languages
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageRow } from '../../src/renderer/pages/ImagesTab/ImageRow';
import type { ZephyrImage } from '../../src/shared/models';

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

// ImageRow renders a <tr>, so wrap in table/tbody for valid DOM
function renderRow(
  image: ZephyrImage,
  onRebuild = vi.fn(),
  onDelete = vi.fn(),
) {
  return render(
    <table>
      <tbody>
        <ImageRow image={image} onRebuild={onRebuild} onDelete={onDelete} />
      </tbody>
    </table>,
  );
}

describe('ImageRow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('Rendering', () => {
    it('renders image name', () => {
      renderRow(makeImage({ name: 'my-custom-image' }));
      expect(screen.getByText('my-custom-image')).toBeInTheDocument();
    });

    it('renders language badges for each language', () => {
      const image = makeImage({
        languages: [
          { languageId: 'python', version: '3.12' },
          { languageId: 'nodejs', version: '20' },
        ],
      });
      renderRow(image);
      expect(screen.getByText('python 3.12')).toBeInTheDocument();
      expect(screen.getByText('nodejs 20')).toBeInTheDocument();
    });

    it('shows "None" when image has no languages', () => {
      renderRow(makeImage({ languages: [] }));
      expect(screen.getByText('None')).toBeInTheDocument();
    });

    it('renders the formatted build date', () => {
      // 2026-02-22 formatted as short date
      renderRow(makeImage({ builtAt: '2026-02-22T00:00:00.000Z' }));
      // The format is "Feb 22, 2026" (en-US locale)
      expect(screen.getByText(/Feb 22, 2026/)).toBeInTheDocument();
    });

    it('renders Rebuild and Delete action buttons', () => {
      renderRow(makeImage());
      expect(screen.getByRole('button', { name: /Rebuild/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Delete/i })).toBeInTheDocument();
    });
  });

  describe('Actions', () => {
    it('calls onRebuild with image id when Rebuild is clicked', async () => {
      const user = userEvent.setup();
      const onRebuild = vi.fn();
      renderRow(makeImage({ id: 'img-abc' }), onRebuild);

      await user.click(screen.getByRole('button', { name: /Rebuild/i }));

      expect(onRebuild).toHaveBeenCalledOnce();
      expect(onRebuild).toHaveBeenCalledWith('img-abc');
    });

    it('calls onDelete with image id when Delete is clicked', async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn();
      renderRow(makeImage({ id: 'img-xyz' }), vi.fn(), onDelete);

      await user.click(screen.getByRole('button', { name: /Delete/i }));

      expect(onDelete).toHaveBeenCalledOnce();
      expect(onDelete).toHaveBeenCalledWith('img-xyz');
    });

    it('calls onRebuild only once per click', async () => {
      const user = userEvent.setup();
      const onRebuild = vi.fn();
      renderRow(makeImage(), onRebuild);

      await user.click(screen.getByRole('button', { name: /Rebuild/i }));
      await user.click(screen.getByRole('button', { name: /Rebuild/i }));

      expect(onRebuild).toHaveBeenCalledTimes(2);
    });
  });

  describe('Multiple languages', () => {
    it('renders a badge for each selected language', () => {
      const image = makeImage({
        languages: [
          { languageId: 'python', version: '3.11' },
          { languageId: 'rust', version: 'stable' },
          { languageId: 'go', version: '1.23' },
        ],
      });
      renderRow(image);
      expect(screen.getByText('python 3.11')).toBeInTheDocument();
      expect(screen.getByText('rust stable')).toBeInTheDocument();
      expect(screen.getByText('go 1.23')).toBeInTheDocument();
    });
  });
});
