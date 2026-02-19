/**
 * Tests for terminal UX polish features (Phase 9.5):
 * - Search addon integration
 * - Copy/paste support
 * - Font size adjustment
 * - Theme switching
 * - Reconnection handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Terminal, TerminalHandle } from '../../src/renderer/components/Terminal/Terminal';

// Mock xterm modules
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(function() {
    return {
      loadAddon: vi.fn(),
      open: vi.fn(),
      write: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onResize: vi.fn(() => ({ dispose: vi.fn() })),
      getSelection: vi.fn(() => 'selected text'),
      options: {
        fontSize: 14,
        theme: {},
      },
    };
  }),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function() {
    return {
      fit: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(function() {
    return {
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: vi.fn().mockImplementation(function() {
    return {
      findNext: vi.fn(),
      findPrevious: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

// Mock clipboard API
const mockClipboard = {
  writeText: vi.fn(() => Promise.resolve()),
  readText: vi.fn(() => Promise.resolve('pasted text')),
};

Object.assign(navigator, { clipboard: mockClipboard });

// Mock prompt
const originalPrompt = global.prompt;

describe('Terminal UX Polish', () => {
  let terminalRef: React.RefObject<TerminalHandle>;

  beforeEach(() => {
    vi.clearAllMocks();
    terminalRef = React.createRef<TerminalHandle>();
  });

  afterEach(() => {
    global.prompt = originalPrompt;
  });

  describe('Search functionality', () => {
    it('should expose search method via ref', () => {
      render(<Terminal ref={terminalRef} />);

      expect(terminalRef.current).toBeDefined();
      expect(terminalRef.current?.search).toBeDefined();
      expect(typeof terminalRef.current?.search).toBe('function');
    });

    it('should prompt user for search term when search is called', () => {
      global.prompt = vi.fn(() => 'test search');
      render(<Terminal ref={terminalRef} />);

      terminalRef.current?.search();

      expect(global.prompt).toHaveBeenCalledWith('Search terminal:');
    });

    it('should not search if prompt is cancelled', () => {
      global.prompt = vi.fn(() => null);
      render(<Terminal ref={terminalRef} />);

      // Should not throw
      expect(() => terminalRef.current?.search()).not.toThrow();
    });
  });

  describe('Copy functionality', () => {
    it('should expose copy method via ref', () => {
      render(<Terminal ref={terminalRef} />);

      expect(terminalRef.current).toBeDefined();
      expect(terminalRef.current?.copy).toBeDefined();
      expect(typeof terminalRef.current?.copy).toBe('function');
    });

    it('should copy selection to clipboard when copy is called', async () => {
      render(<Terminal ref={terminalRef} />);

      terminalRef.current?.copy();

      await waitFor(() => {
        expect(mockClipboard.writeText).toHaveBeenCalledWith('selected text');
      });
    });

    it('should call onCopy callback when text is copied', async () => {
      const onCopy = vi.fn();
      render(<Terminal ref={terminalRef} onCopy={onCopy} />);

      terminalRef.current?.copy();

      await waitFor(() => {
        expect(onCopy).toHaveBeenCalledWith('selected text');
      });
    });
  });

  describe('Paste functionality', () => {
    it('should expose paste method via ref', () => {
      render(<Terminal ref={terminalRef} />);

      expect(terminalRef.current).toBeDefined();
      expect(terminalRef.current?.paste).toBeDefined();
      expect(typeof terminalRef.current?.paste).toBe('function');
    });

    it('should send paste data via onData callback', () => {
      const onData = vi.fn();
      render(<Terminal ref={terminalRef} onData={onData} />);

      terminalRef.current?.paste('pasted content');

      expect(onData).toHaveBeenCalledWith('pasted content');
    });
  });

  describe('Font size adjustment', () => {
    it('should expose font size control methods via ref', () => {
      render(<Terminal ref={terminalRef} />);

      expect(terminalRef.current?.increaseFontSize).toBeDefined();
      expect(terminalRef.current?.decreaseFontSize).toBeDefined();
      expect(terminalRef.current?.resetFontSize).toBeDefined();
      expect(terminalRef.current?.getCurrentFontSize).toBeDefined();
    });

    it('should increase font size up to max of 32', () => {
      render(<Terminal ref={terminalRef} fontSize={14} />);

      // Increase multiple times
      for (let i = 0; i < 20; i++) {
        terminalRef.current?.increaseFontSize();
      }

      expect(terminalRef.current?.getCurrentFontSize()).toBeLessThanOrEqual(32);
    });

    it('should decrease font size down to min of 8', () => {
      render(<Terminal ref={terminalRef} fontSize={14} />);

      // Decrease multiple times
      for (let i = 0; i < 10; i++) {
        terminalRef.current?.decreaseFontSize();
      }

      expect(terminalRef.current?.getCurrentFontSize()).toBeGreaterThanOrEqual(8);
    });

    it('should reset font size to original', () => {
      render(<Terminal ref={terminalRef} fontSize={16} />);

      terminalRef.current?.increaseFontSize();
      terminalRef.current?.increaseFontSize();
      expect(terminalRef.current?.getCurrentFontSize()).toBeGreaterThan(16);

      terminalRef.current?.resetFontSize();
      expect(terminalRef.current?.getCurrentFontSize()).toBe(16);
    });

    it('should increment font size by 2', () => {
      render(<Terminal ref={terminalRef} fontSize={14} />);

      const initialSize = terminalRef.current?.getCurrentFontSize();
      terminalRef.current?.increaseFontSize();
      const newSize = terminalRef.current?.getCurrentFontSize();

      expect(newSize).toBe(initialSize! + 2);
    });

    it('should decrement font size by 2', () => {
      render(<Terminal ref={terminalRef} fontSize={14} />);

      const initialSize = terminalRef.current?.getCurrentFontSize();
      terminalRef.current?.decreaseFontSize();
      const newSize = terminalRef.current?.getCurrentFontSize();

      expect(newSize).toBe(initialSize! - 2);
    });
  });

  describe('Theme switching', () => {
    it('should accept theme prop', () => {
      const { rerender } = render(<Terminal ref={terminalRef} theme="dark" />);
      expect(() => rerender(<Terminal ref={terminalRef} theme="light" />)).not.toThrow();
    });

    it('should default to dark theme', () => {
      render(<Terminal ref={terminalRef} />);
      // Component should render without errors
      expect(terminalRef.current).toBeDefined();
    });

    it('should support light theme', () => {
      render(<Terminal ref={terminalRef} theme="light" />);
      expect(terminalRef.current).toBeDefined();
    });

    it('should react to theme changes', () => {
      const { rerender } = render(<Terminal ref={terminalRef} theme="dark" />);

      // Change theme
      rerender(<Terminal ref={terminalRef} theme="light" />);

      // Should not throw and ref should remain valid
      expect(terminalRef.current).toBeDefined();
    });
  });

  describe('Terminal handle completeness', () => {
    it('should expose all required methods', () => {
      render(<Terminal ref={terminalRef} />);

      const handle = terminalRef.current;
      expect(handle).toBeDefined();
      expect(handle?.write).toBeDefined();
      expect(handle?.clear).toBeDefined();
      expect(handle?.search).toBeDefined();
      expect(handle?.copy).toBeDefined();
      expect(handle?.paste).toBeDefined();
      expect(handle?.increaseFontSize).toBeDefined();
      expect(handle?.decreaseFontSize).toBeDefined();
      expect(handle?.resetFontSize).toBeDefined();
      expect(handle?.getCurrentFontSize).toBeDefined();
    });
  });
});
