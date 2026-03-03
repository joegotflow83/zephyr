import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

export interface TerminalProps {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  fontSize?: number;
  theme?: 'dark' | 'light';
  onCopy?: (text: string) => void;
}

export interface TerminalHandle {
  write: (data: string) => void;
  clear: () => void;
  focus: () => void;
  search: () => void;
  copy: () => void;
  paste: (text: string) => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
  resetFontSize: () => void;
  getCurrentFontSize: () => number;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  ({ onData, onResize, fontSize = 14, theme = 'dark', onCopy }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);
    const currentFontSizeRef = useRef<number>(fontSize);
    const defaultFontSizeRef = useRef<number>(fontSize);
    // Always-current refs so xterm callbacks never close over stale props.
    const onDataRef = useRef(onData);
    onDataRef.current = onData;
    const onResizeRef = useRef(onResize);
    onResizeRef.current = onResize;

    useImperativeHandle(ref, () => ({
      write: (data: string) => {
        xtermRef.current?.write(data);
      },
      clear: () => {
        xtermRef.current?.clear();
      },
      focus: () => {
        xtermRef.current?.focus();
      },
      search: () => {
        if (searchAddonRef.current && xtermRef.current) {
          const searchTerm = prompt('Search terminal:');
          if (searchTerm) {
            searchAddonRef.current.findNext(searchTerm, { incremental: false });
          }
        }
      },
      copy: () => {
        const selection = xtermRef.current?.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(console.error);
          if (onCopy) {
            onCopy(selection);
          }
        }
      },
      paste: (text: string) => {
        if (onData) {
          onData(text);
        }
      },
      increaseFontSize: () => {
        if (xtermRef.current) {
          currentFontSizeRef.current = Math.min(currentFontSizeRef.current + 2, 32);
          xtermRef.current.options.fontSize = currentFontSizeRef.current;
          fitAddonRef.current?.fit();
        }
      },
      decreaseFontSize: () => {
        if (xtermRef.current) {
          currentFontSizeRef.current = Math.max(currentFontSizeRef.current - 2, 8);
          xtermRef.current.options.fontSize = currentFontSizeRef.current;
          fitAddonRef.current?.fit();
        }
      },
      resetFontSize: () => {
        if (xtermRef.current) {
          currentFontSizeRef.current = defaultFontSizeRef.current;
          xtermRef.current.options.fontSize = currentFontSizeRef.current;
          fitAddonRef.current?.fit();
        }
      },
      getCurrentFontSize: () => currentFontSizeRef.current,
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      // Create terminal instance
      const terminal = new XTerm({
        fontSize,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        cursorBlink: true,
        cursorStyle: 'block',
        theme:
          theme === 'dark'
            ? {
                background: '#1e1e1e',
                foreground: '#d4d4d4',
                cursor: '#d4d4d4',
                black: '#000000',
                red: '#cd3131',
                green: '#0dbc79',
                yellow: '#e5e510',
                blue: '#2472c8',
                magenta: '#bc3fbc',
                cyan: '#11a8cd',
                white: '#e5e5e5',
                brightBlack: '#666666',
                brightRed: '#f14c4c',
                brightGreen: '#23d18b',
                brightYellow: '#f5f543',
                brightBlue: '#3b8eea',
                brightMagenta: '#d670d6',
                brightCyan: '#29b8db',
                brightWhite: '#e5e5e5',
              }
            : {
                background: '#ffffff',
                foreground: '#333333',
                cursor: '#333333',
                black: '#000000',
                red: '#cd3131',
                green: '#00bc00',
                yellow: '#949800',
                blue: '#0451a5',
                magenta: '#bc05bc',
                cyan: '#0598bc',
                white: '#555555',
                brightBlack: '#666666',
                brightRed: '#cd3131',
                brightGreen: '#14ce14',
                brightYellow: '#b5ba00',
                brightBlue: '#0451a5',
                brightMagenta: '#bc05bc',
                brightCyan: '#0598bc',
                brightWhite: '#a5a5a5',
              },
        allowProposedApi: true,
      });

      xtermRef.current = terminal;

      // Create and load addons
      const fitAddon = new FitAddon();
      fitAddonRef.current = fitAddon;
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());

      const searchAddon = new SearchAddon();
      searchAddonRef.current = searchAddon;
      terminal.loadAddon(searchAddon);

      // Attach to DOM
      terminal.open(containerRef.current);

      // Fit to container size
      fitAddon.fit();

      // Focus the terminal so keyboard input works immediately
      terminal.focus();

      // Handle data events — use ref so we always call the current prop even
      // if the parent re-renders with a new callback (e.g. after reconnect).
      const dataDisposable = terminal.onData((data) => {
        onDataRef.current?.(data);
      });
      (terminal as any)._dataDisposable = dataDisposable;

      // Handle resize events — same ref pattern.
      const resizeDisposable = terminal.onResize(({ cols, rows }) => {
        onResizeRef.current?.(cols, rows);
      });
      (terminal as any)._resizeDisposable = resizeDisposable;

      // Cleanup on unmount
      return () => {
        (terminal as any)._dataDisposable?.dispose();
        (terminal as any)._resizeDisposable?.dispose();
        searchAddon.dispose();
        terminal.dispose();
        xtermRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
      };
    }, []); // Only run on mount

    // Handle fontSize changes
    useEffect(() => {
      if (xtermRef.current) {
        currentFontSizeRef.current = fontSize;
        defaultFontSizeRef.current = fontSize;
        xtermRef.current.options.fontSize = fontSize;
        fitAddonRef.current?.fit();
      }
    }, [fontSize]);

    // Handle theme changes
    useEffect(() => {
      if (xtermRef.current) {
        xtermRef.current.options.theme =
          theme === 'dark'
            ? {
                background: '#1e1e1e',
                foreground: '#d4d4d4',
                cursor: '#d4d4d4',
                black: '#000000',
                red: '#cd3131',
                green: '#0dbc79',
                yellow: '#e5e510',
                blue: '#2472c8',
                magenta: '#bc3fbc',
                cyan: '#11a8cd',
                white: '#e5e5e5',
                brightBlack: '#666666',
                brightRed: '#f14c4c',
                brightGreen: '#23d18b',
                brightYellow: '#f5f543',
                brightBlue: '#3b8eea',
                brightMagenta: '#d670d6',
                brightCyan: '#29b8db',
                brightWhite: '#e5e5e5',
              }
            : {
                background: '#ffffff',
                foreground: '#333333',
                cursor: '#333333',
                black: '#000000',
                red: '#cd3131',
                green: '#00bc00',
                yellow: '#949800',
                blue: '#0451a5',
                magenta: '#bc05bc',
                cyan: '#0598bc',
                white: '#555555',
                brightBlack: '#666666',
                brightRed: '#cd3131',
                brightGreen: '#14ce14',
                brightYellow: '#b5ba00',
                brightBlue: '#0451a5',
                brightMagenta: '#bc05bc',
                brightCyan: '#0598bc',
                brightWhite: '#a5a5a5',
              };
      }
    }, [theme]);

    // Handle window resize
    useEffect(() => {
      const handleResize = () => {
        fitAddonRef.current?.fit();
      };

      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, []);

    return (
      <div
        ref={containerRef}
        className="terminal-container"
        data-testid="terminal"
      />
    );
  }
);

Terminal.displayName = 'Terminal';
