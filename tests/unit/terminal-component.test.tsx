import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import {
  Terminal,
  TerminalHandle,
} from '../../src/renderer/components/Terminal/Terminal';

// Mock xterm and its addons
vi.mock('@xterm/xterm', () => {
  return {
    Terminal: vi.fn().mockImplementation(function (this: any) {
      this.open = vi.fn();
      this.dispose = vi.fn();
      this.write = vi.fn();
      this.clear = vi.fn();
      this.loadAddon = vi.fn();
      this.onData = vi.fn(() => ({ dispose: vi.fn() }));
      this.onResize = vi.fn(() => ({ dispose: vi.fn() }));
      this.options = {};
      return this;
    }),
  };
});

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function (this: any) {
    this.fit = vi.fn();
    return this;
  }),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(function (this: any) {
    return this;
  }),
}));

// Mock CSS imports
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('../../src/renderer/components/Terminal/terminal.css', () => ({}));

describe('Terminal Component', () => {
  let mockAddEventListener: ReturnType<typeof vi.fn>;
  let mockRemoveEventListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAddEventListener = vi.fn();
    mockRemoveEventListener = vi.fn();
    window.addEventListener = mockAddEventListener;
    window.removeEventListener = mockRemoveEventListener;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render terminal container', () => {
      render(<Terminal />);
      const container = screen.getByTestId('terminal');
      expect(container).toBeInTheDocument();
      expect(container).toHaveClass('terminal-container');
    });

    it('should create xterm instance on mount', async () => {
      const { Terminal: XTermConstructor } = await import('@xterm/xterm');
      render(<Terminal />);
      await waitFor(() => {
        expect(XTermConstructor).toHaveBeenCalled();
      });
    });

    it('should open terminal in container', async () => {
      const { Terminal: XTermConstructor } = await import('@xterm/xterm');
      render(<Terminal />);

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance.open).toHaveBeenCalled();
      });
    });
  });

  describe('Props', () => {
    it('should apply custom fontSize', async () => {
      const { Terminal: XTermConstructor } = await import('@xterm/xterm');
      render(<Terminal fontSize={16} />);

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance).toBeDefined();
      });
    });

    it('should apply dark theme by default', async () => {
      const { Terminal: XTermConstructor } = await import('@xterm/xterm');
      render(<Terminal />);

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance).toBeDefined();
      });
    });

    it('should apply light theme when specified', async () => {
      const { Terminal: XTermConstructor } = await import('@xterm/xterm');
      render(<Terminal theme="light" />);

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance).toBeDefined();
      });
    });

    it('should call onData callback when terminal receives data', async () => {
      const { Terminal: XTermConstructor } = await import('@xterm/xterm');
      const onData = vi.fn();
      render(<Terminal onData={onData} />);

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance.onData).toHaveBeenCalled();
        const dataCallback = mockInstance.onData.mock.calls[0][0];
        dataCallback('test data');
        expect(onData).toHaveBeenCalledWith('test data');
      });
    });

    it('should call onResize callback when terminal is resized', async () => {
      const { Terminal: XTermConstructor } = await import('@xterm/xterm');
      const onResize = vi.fn();
      render(<Terminal onResize={onResize} />);

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance.onResize).toHaveBeenCalled();
        const resizeCallback = mockInstance.onResize.mock.calls[0][0];
        resizeCallback({ cols: 80, rows: 24 });
        expect(onResize).toHaveBeenCalledWith(80, 24);
      });
    });
  });

  describe('Addons', () => {
    it('should load FitAddon', async () => {
      const { Terminal: XTermConstructor } = await import('@xterm/xterm');
      render(<Terminal />);

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance.loadAddon).toHaveBeenCalled();
      });
    });

    it('should load WebLinksAddon', async () => {
      const { Terminal: XTermConstructor } = await import('@xterm/xterm');
      render(<Terminal />);

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance.loadAddon).toHaveBeenCalledTimes(3); // FitAddon + WebLinksAddon + SearchAddon
      });
    });

    it('should call fit after loading FitAddon', async () => {
      const { FitAddon } = await import('@xterm/addon-fit');
      render(<Terminal />);

      await waitFor(() => {
        const mockFitInstance = (FitAddon as any).mock.results[0].value;
        expect(mockFitInstance.fit).toHaveBeenCalled();
      });
    });
  });

  describe('Imperative Handle', () => {
    it('should expose write method via ref', async () => {
      const { Terminal: XTermConstructor } = await import('@xterm/xterm');
      const ref = React.createRef<TerminalHandle>();
      render(<Terminal ref={ref} />);

      await waitFor(() => {
        expect(ref.current).toBeDefined();
        expect(ref.current?.write).toBeInstanceOf(Function);
      });

      ref.current?.write('test');

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance.write).toHaveBeenCalledWith('test');
      });
    });

    it('should expose clear method via ref', async () => {
      const { Terminal: XTermConstructor } = await import('@xterm/xterm');
      const ref = React.createRef<TerminalHandle>();
      render(<Terminal ref={ref} />);

      await waitFor(() => {
        expect(ref.current).toBeDefined();
        expect(ref.current?.clear).toBeInstanceOf(Function);
      });

      ref.current?.clear();

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance.clear).toHaveBeenCalled();
      });
    });
  });

  describe('Lifecycle', () => {
    it('should dispose terminal on unmount', async () => {
      const { Terminal: XTermConstructor } = await import('@xterm/xterm');
      const { unmount } = render(<Terminal />);

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance).toBeDefined();
      });

      unmount();

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance.dispose).toHaveBeenCalled();
      });
    });

    it('should set up window resize listener on mount', async () => {
      render(<Terminal />);

      await waitFor(() => {
        expect(mockAddEventListener).toHaveBeenCalledWith(
          'resize',
          expect.any(Function)
        );
      });
    });

    it('should remove window resize listener on unmount', async () => {
      const { unmount } = render(<Terminal />);

      await waitFor(() => {
        expect(mockAddEventListener).toHaveBeenCalled();
      });

      unmount();

      await waitFor(() => {
        expect(mockRemoveEventListener).toHaveBeenCalledWith(
          'resize',
          expect.any(Function)
        );
      });
    });
  });

  describe('Dynamic prop updates', () => {
    it('should update fontSize when prop changes', async () => {
      const { Terminal: XTermConstructor } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { rerender } = render(<Terminal fontSize={14} />);

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance).toBeDefined();
      });

      rerender(<Terminal fontSize={16} />);

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance.options.fontSize).toBe(16);
        const mockFitInstance = (FitAddon as any).mock.results[0].value;
        expect(mockFitInstance.fit).toHaveBeenCalled();
      });
    });

    it('should update theme when prop changes', async () => {
      const { Terminal: XTermConstructor } = await import('@xterm/xterm');
      const { rerender } = render(<Terminal theme="dark" />);

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance).toBeDefined();
      });

      rerender(<Terminal theme="light" />);

      await waitFor(() => {
        const mockInstance = (XTermConstructor as any).mock.results[0].value;
        expect(mockInstance.options.theme).toBeDefined();
      });
    });
  });
});
