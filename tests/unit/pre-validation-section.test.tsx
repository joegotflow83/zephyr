/**
 * Unit tests for src/renderer/components/ProjectDialog/PreValidationSection.tsx
 *
 * PreValidationSection displays a checkbox list of pre-validation scripts loaded
 * from the main process via IPC, and provides an inline "Add Custom Script"
 * editor. All window.api.preValidation calls are mocked so no real IPC or
 * disk I/O occurs.
 *
 * Why these tests matter: the pre-validation section is the UI surface through
 * which users select quality-gate scripts for their projects. Bugs here would
 * silently skip validation in containers, leading to undetected regressions.
 * Tests verify checkbox state, IPC call contracts, and the add-script flow.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PreValidationSection } from '../../src/renderer/components/ProjectDialog/PreValidationSection';

// ---------------------------------------------------------------------------
// Mock window.api.preValidation
// ---------------------------------------------------------------------------

const mockList = vi.fn();
const mockAdd = vi.fn();
const mockRemove = vi.fn();

const mockPreValidationApi = {
  list: mockList,
  get: vi.fn(),
  add: mockAdd,
  remove: mockRemove,
};

// Set window.api.preValidation without replacing the whole window object.
// Replacing window breaks React's internal fiber/scheduler, causing
// "Should not already be working" errors during render.
Object.defineProperty(window, 'api', {
  value: { preValidation: mockPreValidationApi },
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCRIPTS = [
  {
    filename: 'python-lint.sh',
    name: 'Python Lint',
    description: 'Runs ruff + mypy',
    content: '#!/bin/bash',
    isBuiltIn: true,
  },
  {
    filename: 'node-test.sh',
    name: 'Node Test',
    description: 'Runs npm test',
    content: '#!/bin/bash',
    isBuiltIn: true,
  },
  {
    filename: 'custom-check.sh',
    name: 'Custom Check',
    description: 'My custom check',
    content: '#!/bin/bash\necho check',
    isBuiltIn: false,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PreValidationSection', () => {
  const onChangeMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue(SCRIPTS);
    mockAdd.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(true);
  });

  // ── Loading and display ────────────────────────────────────────────────────

  it('shows "Loading scripts…" while fetching', () => {
    mockList.mockReturnValue(new Promise(() => {})); // never resolves
    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    expect(screen.getByText(/loading scripts/i)).toBeInTheDocument();
  });

  it('renders a checkbox for each available script', async () => {
    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    expect(screen.getByText('python-lint.sh')).toBeInTheDocument();
    expect(screen.getByText('node-test.sh')).toBeInTheDocument();
    expect(screen.getByText('custom-check.sh')).toBeInTheDocument();
  });

  it('shows description text next to each script', async () => {
    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    expect(screen.getByText(/Runs ruff \+ mypy/)).toBeInTheDocument();
    expect(screen.getByText(/Runs npm test/)).toBeInTheDocument();
  });

  it('shows "(built-in)" badge for built-in scripts', async () => {
    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    const builtInBadges = screen.getAllByText('(built-in)');
    expect(builtInBadges).toHaveLength(2); // python-lint + node-test
  });

  it('shows empty-state message when no scripts are available', async () => {
    mockList.mockResolvedValue([]);
    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    expect(screen.getByText(/no scripts available/i)).toBeInTheDocument();
  });

  it('shows empty-state gracefully when IPC fails', async () => {
    mockList.mockRejectedValue(new Error('IPC error'));
    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    // Should not throw; just show no scripts or empty state
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });
  });

  // ── Checkbox selection ─────────────────────────────────────────────────────

  it('renders checkboxes unchecked when selected is empty', async () => {
    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    const checkboxes = screen.getAllByRole('checkbox');
    for (const cb of checkboxes) {
      expect((cb as HTMLInputElement).checked).toBe(false);
    }
  });

  it('renders checkbox checked for pre-selected scripts', async () => {
    render(
      <PreValidationSection selected={['python-lint.sh']} onChange={onChangeMock} />,
    );
    // findByText waits for the async script list to load and render
    await screen.findByText('python-lint.sh');

    const label = screen.getByText('python-lint.sh').closest('label');
    const checkbox = label?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('calls onChange with filename added when unchecked box is clicked', async () => {
    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    const label = screen.getByText('python-lint.sh').closest('label');
    const checkbox = label!.querySelector('input[type="checkbox"]')!;
    fireEvent.click(checkbox);

    expect(onChangeMock).toHaveBeenCalledWith(['python-lint.sh']);
  });

  it('calls onChange with filename removed when checked box is clicked', async () => {
    render(
      <PreValidationSection
        selected={['python-lint.sh', 'node-test.sh']}
        onChange={onChangeMock}
      />,
    );
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    const label = screen.getByText('python-lint.sh').closest('label');
    const checkbox = label!.querySelector('input[type="checkbox"]')!;
    fireEvent.click(checkbox);

    expect(onChangeMock).toHaveBeenCalledWith(['node-test.sh']);
  });

  // ── Add Custom Script ──────────────────────────────────────────────────────

  it('shows "Add Custom Script" button', async () => {
    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    expect(screen.getByText(/\+ Add Custom Script/i)).toBeInTheDocument();
  });

  it('opens the add editor when "Add Custom Script" is clicked', async () => {
    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    fireEvent.click(screen.getByText(/\+ Add Custom Script/i));

    expect(screen.getByPlaceholderText(/my-check\.sh/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save script/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('shows error when filename is empty on save', async () => {
    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    fireEvent.click(screen.getByText(/\+ Add Custom Script/i));
    fireEvent.click(screen.getByRole('button', { name: /save script/i }));

    expect(screen.getByText(/filename is required/i)).toBeInTheDocument();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('shows error when content is empty on save', async () => {
    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    fireEvent.click(screen.getByText(/\+ Add Custom Script/i));

    fireEvent.change(screen.getByPlaceholderText(/my-check\.sh/i), {
      target: { value: 'my-script' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save script/i }));

    expect(screen.getByText(/script content is required/i)).toBeInTheDocument();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('calls preValidation.add with .sh extension appended if missing', async () => {
    mockList.mockResolvedValueOnce(SCRIPTS).mockResolvedValueOnce([
      ...SCRIPTS,
      {
        filename: 'my-script.sh',
        name: 'My Script',
        description: '',
        content: '#!/bin/bash',
        isBuiltIn: false,
      },
    ]);

    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    fireEvent.click(screen.getByText(/\+ Add Custom Script/i));

    fireEvent.change(screen.getByPlaceholderText(/my-check\.sh/i), {
      target: { value: 'my-script' }, // no .sh
    });
    const textarea = screen.getByRole('textbox', { name: /script content/i });
    fireEvent.change(textarea, { target: { value: '#!/bin/bash\necho hi' } });

    fireEvent.click(screen.getByRole('button', { name: /save script/i }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith('my-script.sh', '#!/bin/bash\necho hi'));
  });

  it('closes add editor and reloads scripts after successful save', async () => {
    const updatedScripts = [
      ...SCRIPTS,
      {
        filename: 'new.sh',
        name: 'New',
        description: '',
        content: '#!/bin/bash',
        isBuiltIn: false,
      },
    ];
    mockList.mockResolvedValueOnce(SCRIPTS).mockResolvedValueOnce(updatedScripts);

    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText(/\+ Add Custom Script/i));
    fireEvent.change(screen.getByPlaceholderText(/my-check\.sh/i), {
      target: { value: 'new.sh' },
    });
    const textarea = screen.getByRole('textbox', { name: /script content/i });
    fireEvent.change(textarea, { target: { value: '#!/bin/bash' } });

    fireEvent.click(screen.getByRole('button', { name: /save script/i }));

    // Wait for the reload
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    // Editor should be closed
    expect(screen.queryByPlaceholderText(/my-check\.sh/i)).not.toBeInTheDocument();
    // New script should appear
    expect(screen.getByText('new.sh')).toBeInTheDocument();
  });

  it('cancels add editor and hides it', async () => {
    render(<PreValidationSection selected={[]} onChange={onChangeMock} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    fireEvent.click(screen.getByText(/\+ Add Custom Script/i));
    expect(screen.getByPlaceholderText(/my-check\.sh/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByPlaceholderText(/my-check\.sh/i)).not.toBeInTheDocument();
  });
});
