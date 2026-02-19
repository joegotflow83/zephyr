import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from '../../src/renderer/App';

describe('App Navigation', () => {
  beforeEach(() => {
    // Mock window.api for StatusBar, useActiveLoops, and TerminalTab
    global.window.api = {
      docker: {
        status: vi.fn().mockResolvedValue({
          available: true,
          info: { version: '24.0.7', containers: 0, images: 0 },
        }),
        onStatusChanged: vi.fn(() => vi.fn()),
        listContainers: vi.fn().mockResolvedValue([]),
      },
      loops: {
        list: vi.fn().mockResolvedValue([]),
        onStateChanged: vi.fn(() => vi.fn()),
      },
      terminal: {
        open: vi.fn(),
        close: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        onData: vi.fn(() => vi.fn()),
        onClosed: vi.fn(() => vi.fn()),
        onError: vi.fn(() => vi.fn()),
      },
    } as any;
  });

  it('renders with Projects tab active by default', () => {
    render(<App />);

    // Check that Projects page content is visible
    expect(screen.getByRole('heading', { name: /projects/i })).toBeInTheDocument();
    const projectsButton = screen.getByRole('button', { name: /projects/i });
    expect(projectsButton).toHaveClass('text-blue-400');
  });

  it('renders all four tabs', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: /projects/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /running loops/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /terminal/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument();
  });

  it('switches to Loops tab when clicked', () => {
    render(<App />);

    const loopsButton = screen.getByRole('button', { name: /running loops/i });
    fireEvent.click(loopsButton);

    expect(screen.getByText(/no active or recent loops/i)).toBeInTheDocument();
    expect(loopsButton).toHaveClass('text-blue-400');
  });

  it('switches to Terminal tab when clicked', () => {
    render(<App />);

    const terminalButton = screen.getByRole('button', { name: /terminal/i });
    fireEvent.click(terminalButton);

    // TerminalTab is now implemented, so check for actual content
    expect(screen.getByText('Container')).toBeInTheDocument();
    expect(screen.getByText('Open Terminal')).toBeInTheDocument();
    expect(terminalButton).toHaveClass('text-blue-400');
  });

  it('switches to Settings tab when clicked', () => {
    render(<App />);

    const settingsButton = screen.getByRole('button', { name: /settings/i });
    fireEvent.click(settingsButton);

    expect(screen.getByText('Settings interface coming soon...')).toBeInTheDocument();
    expect(settingsButton).toHaveClass('text-blue-400');
  });

  it('switches tabs with Ctrl+1 keyboard shortcut', () => {
    render(<App />);

    // Dispatch event directly to window wrapped in act
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true }));
    });

    const projectsButton = screen.getByRole('button', { name: /projects/i });
    expect(projectsButton).toHaveClass('text-blue-400');
  });

  it('switches tabs with Ctrl+2 keyboard shortcut', () => {
    render(<App />);

    // Dispatch event directly to window wrapped in act
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true }));
    });

    expect(screen.getByText(/no active or recent loops/i)).toBeInTheDocument();
    const loopsButton = screen.getByRole('button', { name: /running loops/i });
    expect(loopsButton).toHaveClass('text-blue-400');
  });

  it('switches tabs with Ctrl+3 keyboard shortcut', () => {
    render(<App />);

    // Dispatch event directly to window wrapped in act
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true }));
    });

    // TerminalTab is now implemented, so check for actual content
    expect(screen.getByText('Container')).toBeInTheDocument();
    expect(screen.getByText('Open Terminal')).toBeInTheDocument();
    // Get the tab button specifically (the one with emoji 💻)
    const terminalButtons = screen.getAllByRole('button', { name: /terminal/i });
    const terminalTabButton = terminalButtons.find(btn => btn.getAttribute('aria-current') === 'page');
    expect(terminalTabButton).toHaveClass('text-blue-400');
  });

  it('switches tabs with Ctrl+4 keyboard shortcut', () => {
    render(<App />);

    // Dispatch event directly to window wrapped in act
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', ctrlKey: true }));
    });

    expect(screen.getByText('Settings interface coming soon...')).toBeInTheDocument();
    const settingsButton = screen.getByRole('button', { name: /settings/i });
    expect(settingsButton).toHaveClass('text-blue-400');
  });

  it('ignores keyboard shortcuts without Ctrl key', () => {
    render(<App />);

    // Dispatch event directly to window wrapped in act
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
    });

    // Should still be on Projects tab
    const projectsButton = screen.getByRole('button', { name: /projects/i });
    expect(projectsButton).toHaveClass('text-blue-400');
  });

  it('ignores invalid keyboard shortcuts', () => {
    render(<App />);

    // Dispatch event directly to window wrapped in act
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true }));
    });

    // Should still be on Projects tab
    const projectsButton = screen.getByRole('button', { name: /projects/i });
    expect(projectsButton).toHaveClass('text-blue-400');
  });

  it('cleans up keyboard event listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<App />);

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});
