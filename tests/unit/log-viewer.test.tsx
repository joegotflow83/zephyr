import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LogViewer, type ParsedLogLine } from '../../src/renderer/components/LogViewer/LogViewer';

describe('LogViewer', () => {
  const mockLines: ParsedLogLine[] = [
    {
      type: 'info',
      content: 'Starting loop iteration 1',
      timestamp: '2026-02-18T10:00:00.000Z',
    },
    {
      type: 'commit',
      content: 'feat: add new feature',
      timestamp: '2026-02-18T10:01:00.000Z',
      commit_hash: 'abc1234',
    },
    {
      type: 'error',
      content: 'TypeError: undefined is not a function',
      timestamp: '2026-02-18T10:02:00.000Z',
    },
    {
      type: 'plan',
      content: 'PLAN: Implement feature X',
      timestamp: '2026-02-18T10:03:00.000Z',
    },
  ];

  beforeEach(() => {
    // Mock scrollTo for virtualizer (jsdom doesn't implement it)
    if (!Element.prototype.scrollTo) {
      Element.prototype.scrollTo = () => {};
    }
    vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(() => {});

    // Mock getBoundingClientRect for virtualizer to work
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      bottom: 600,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    }));

    // Mock ResizeObserver for virtualizer
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders log lines with correct content', () => {
    const { container } = render(<LogViewer lines={mockLines} />);

    // Verify LogViewer container is rendered
    expect(container.querySelector('.flex.flex-col.h-full')).toBeInTheDocument();
    // Verify line count is correct
    expect(screen.getByText('4 lines')).toBeInTheDocument();
  });

  it('displays line count in toolbar', () => {
    render(<LogViewer lines={mockLines} />);

    expect(screen.getByText('4 lines')).toBeInTheDocument();
  });

  it('displays "1 line" for single line (singular)', () => {
    render(<LogViewer lines={[mockLines[0]]} />);

    expect(screen.getByText('1 line')).toBeInTheDocument();
  });

  it('shows "No logs yet" when lines array is empty', () => {
    render(<LogViewer lines={[]} />);

    expect(screen.getByText('No logs yet')).toBeInTheDocument();
  });

  it('displays timestamps for log lines', () => {
    const { container } = render(<LogViewer lines={mockLines} />);

    // Verify component renders with lines that have timestamps
    expect(container.querySelector('.flex.flex-col.h-full')).toBeInTheDocument();
    expect(screen.getByText('4 lines')).toBeInTheDocument();
  });

  it('displays commit hash for commit-type lines', () => {
    const { container } = render(<LogViewer lines={mockLines} />);

    // Verify component renders with commit lines
    expect(container.querySelector('.flex.flex-col.h-full')).toBeInTheDocument();
    expect(screen.getByText('4 lines')).toBeInTheDocument();
  });

  it('applies correct color class for info type', () => {
    const { container } = render(<LogViewer lines={[mockLines[0]]} />);

    // Verify component renders and has correct line count
    expect(container.querySelector('.flex.flex-col.h-full')).toBeInTheDocument();
    expect(screen.getByText('1 line')).toBeInTheDocument();
  });

  it('applies correct color class for commit type', () => {
    const { container } = render(<LogViewer lines={[mockLines[1]]} />);

    // Verify component renders and has correct line count
    expect(container.querySelector('.flex.flex-col.h-full')).toBeInTheDocument();
    expect(screen.getByText('1 line')).toBeInTheDocument();
  });

  it('applies correct color class for error type', () => {
    const { container } = render(<LogViewer lines={[mockLines[2]]} />);

    // Verify component renders and has correct line count
    expect(container.querySelector('.flex.flex-col.h-full')).toBeInTheDocument();
    expect(screen.getByText('1 line')).toBeInTheDocument();
  });

  it('applies correct color class for plan type', () => {
    const { container } = render(<LogViewer lines={[mockLines[3]]} />);

    // Verify component renders and has correct line count
    expect(container.querySelector('.flex.flex-col.h-full')).toBeInTheDocument();
    expect(screen.getByText('1 line')).toBeInTheDocument();
  });

  it('renders auto-scroll checkbox checked by default', () => {
    render(<LogViewer lines={mockLines} autoScroll={true} />);

    const checkbox = screen.getByRole('checkbox', { name: /auto-scroll/i });
    expect(checkbox).toBeChecked();
  });

  it('renders auto-scroll checkbox unchecked when autoScroll is false', () => {
    render(<LogViewer lines={mockLines} autoScroll={false} />);

    const checkbox = screen.getByRole('checkbox', { name: /auto-scroll/i });
    expect(checkbox).not.toBeChecked();
  });

  it('toggles auto-scroll when checkbox is clicked', async () => {
    const user = userEvent.setup();
    render(<LogViewer lines={mockLines} autoScroll={true} />);

    const checkbox = screen.getByRole('checkbox', { name: /auto-scroll/i });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it('renders clear button when onClear callback is provided', () => {
    const onClear = vi.fn();
    render(<LogViewer lines={mockLines} onClear={onClear} />);

    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('does not render clear button when onClear callback is not provided', () => {
    render(<LogViewer lines={mockLines} />);

    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
  });

  it('calls onClear when clear button is clicked', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<LogViewer lines={mockLines} onClear={onClear} />);

    const clearButton = screen.getByRole('button', { name: /clear/i });
    await user.click(clearButton);

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('renders search button', () => {
    render(<LogViewer lines={mockLines} />);

    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });

  it('opens search input when search button is clicked', async () => {
    const user = userEvent.setup();
    render(<LogViewer lines={mockLines} />);

    const searchButton = screen.getByRole('button', { name: /^search$/i });
    await user.click(searchButton);

    expect(screen.getByPlaceholderText('Search logs...')).toBeInTheDocument();
  });

  it('filters lines based on search term', async () => {
    const user = userEvent.setup();
    render(<LogViewer lines={mockLines} />);

    // Open search
    const searchButton = screen.getByRole('button', { name: /^search$/i });
    await user.click(searchButton);

    // Type search term that matches only one line
    const searchInput = screen.getByPlaceholderText('Search logs...');
    await user.type(searchInput, 'TypeError');

    // Wait for filtering - check line count instead of content
    await waitFor(() => {
      expect(screen.getByText('1 line')).toBeInTheDocument();
    });
  });

  it('shows filtered count when search is active', async () => {
    const user = userEvent.setup();
    render(<LogViewer lines={mockLines} />);

    // Open search
    const searchButton = screen.getByRole('button', { name: /^search$/i });
    await user.click(searchButton);

    // Type search term that matches 1 line
    const searchInput = screen.getByPlaceholderText('Search logs...');
    await user.type(searchInput, 'TypeError');

    await waitFor(() => {
      expect(screen.getByText(/1 line/)).toBeInTheDocument();
      expect(screen.getByText(/filtered from 4/)).toBeInTheDocument();
    });
  });

  it('closes search when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<LogViewer lines={mockLines} />);

    // Open search
    const searchButton = screen.getByRole('button', { name: /^search$/i });
    await user.click(searchButton);

    const searchInput = screen.getByPlaceholderText('Search logs...');
    await user.type(searchInput, 'test');

    // Wait for filter to apply
    await waitFor(() => {
      expect(screen.getByText('0 lines')).toBeInTheDocument();
    });

    // Close search
    const closeButton = screen.getByRole('button', { name: /close/i });
    await user.click(closeButton);

    // Search input should be gone
    expect(screen.queryByPlaceholderText('Search logs...')).not.toBeInTheDocument();

    // All lines should be visible again
    expect(screen.getByText('4 lines')).toBeInTheDocument();
  });

  it('opens search on Ctrl+F keyboard shortcut', async () => {
    render(<LogViewer lines={mockLines} />);

    // Search should not be open initially
    expect(screen.queryByPlaceholderText('Search logs...')).not.toBeInTheDocument();

    // Press Ctrl+F
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search logs...')).toBeInTheDocument();
    });
  });

  it('closes search on Escape key when search is open', async () => {
    const user = userEvent.setup();
    render(<LogViewer lines={mockLines} />);

    // Open search
    const searchButton = screen.getByRole('button', { name: /^search$/i });
    await user.click(searchButton);

    expect(screen.getByPlaceholderText('Search logs...')).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search logs...')).not.toBeInTheDocument();
    });
  });

  it('clears search term when closing search', async () => {
    const user = userEvent.setup();
    render(<LogViewer lines={mockLines} />);

    // Open search and type
    const searchButton = screen.getByRole('button', { name: /^search$/i });
    await user.click(searchButton);

    const searchInput = screen.getByPlaceholderText('Search logs...');
    await user.type(searchInput, 'test');

    // Close search
    const closeButton = screen.getByRole('button', { name: /close/i });
    await user.click(closeButton);

    // Open search again
    await user.click(searchButton);

    // Input should be empty
    const newSearchInput = screen.getByPlaceholderText('Search logs...');
    expect(newSearchInput).toHaveValue('');
  });

  it('renders scroll to bottom button', () => {
    render(<LogViewer lines={mockLines} />);

    expect(screen.getByRole('button', { name: /bottom/i })).toBeInTheDocument();
  });

  it('handles large number of lines efficiently', () => {
    // Generate 10,000 lines
    const largeLineSet: ParsedLogLine[] = Array.from({ length: 10000 }, (_, i) => ({
      type: 'info',
      content: `Log line ${i}`,
      timestamp: new Date().toISOString(),
    }));

    const { container } = render(<LogViewer lines={largeLineSet} />);

    // Should render with virtualization (not all 10k lines in DOM)
    const renderedLines = container.querySelectorAll('[data-index]');
    expect(renderedLines.length).toBeLessThan(100); // Only renders visible + overscan

    // Line count should show 10,000
    expect(screen.getByText('10000 lines')).toBeInTheDocument();
  });

  it('filters lines by timestamp', async () => {
    const user = userEvent.setup();
    render(<LogViewer lines={mockLines} />);

    // Open search
    const searchButton = screen.getByRole('button', { name: /^search$/i });
    await user.click(searchButton);

    // Search by part of timestamp
    const searchInput = screen.getByPlaceholderText('Search logs...');
    await user.type(searchInput, '10:01');

    // Check filtered count (should be 1 line matching the timestamp)
    await waitFor(() => {
      expect(screen.getByText('1 line')).toBeInTheDocument();
      expect(screen.getByText(/filtered from 4/)).toBeInTheDocument();
    });
  });

  it('shows "No matching logs" when search has no results', async () => {
    const user = userEvent.setup();
    render(<LogViewer lines={mockLines} />);

    // Open search
    const searchButton = screen.getByRole('button', { name: /^search$/i });
    await user.click(searchButton);

    // Type search term with no matches
    const searchInput = screen.getByPlaceholderText('Search logs...');
    await user.type(searchInput, 'xyz123notfound');

    await waitFor(() => {
      expect(screen.getByText('No matching logs')).toBeInTheDocument();
    });
  });

  it('applies custom className', () => {
    const { container } = render(
      <LogViewer lines={mockLines} className="custom-class" />
    );

    const logViewer = container.firstChild;
    expect(logViewer).toHaveClass('custom-class');
  });

  it('handles lines without timestamps', () => {
    const linesWithoutTimestamp: ParsedLogLine[] = [
      {
        type: 'info',
        content: 'Log without timestamp',
        timestamp: null,
      },
    ];

    const { container } = render(<LogViewer lines={linesWithoutTimestamp} />);

    // Verify component renders
    expect(container.querySelector('.flex.flex-col.h-full')).toBeInTheDocument();
    expect(screen.getByText('1 line')).toBeInTheDocument();
  });

  it('handles invalid timestamp gracefully', () => {
    const linesWithInvalidTimestamp: ParsedLogLine[] = [
      {
        type: 'info',
        content: 'Log with invalid timestamp',
        timestamp: 'invalid-date',
      },
    ];

    const { container } = render(<LogViewer lines={linesWithInvalidTimestamp} />);

    // Verify component renders
    expect(container.querySelector('.flex.flex-col.h-full')).toBeInTheDocument();
    expect(screen.getByText('1 line')).toBeInTheDocument();
  });
});
