import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

export interface TerminalProps {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  fontSize?: number;
  theme?: 'dark' | 'light';
}

export interface TerminalHandle {
  write: (data: string) => void;
  clear: () => void;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  ({ onData, onResize, fontSize = 14, theme = 'dark' }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    useImperativeHandle(ref, () => ({
      write: (data: string) => {
        xtermRef.current?.write(data);
      },
      clear: () => {
        xtermRef.current?.clear();
      },
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

      // Attach to DOM
      terminal.open(containerRef.current);

      // Fit to container size
      fitAddon.fit();

      // Handle data events
      if (onData) {
        const dataDisposable = terminal.onData((data) => {
          onData(data);
        });

        // Store disposable for cleanup
        (terminal as any)._dataDisposable = dataDisposable;
      }

      // Handle resize events
      if (onResize) {
        const resizeDisposable = terminal.onResize(({ cols, rows }) => {
          onResize(cols, rows);
        });

        // Store disposable for cleanup
        (terminal as any)._resizeDisposable = resizeDisposable;
      }

      // Cleanup on unmount
      return () => {
        (terminal as any)._dataDisposable?.dispose();
        (terminal as any)._resizeDisposable?.dispose();
        terminal.dispose();
        xtermRef.current = null;
        fitAddonRef.current = null;
      };
    }, []); // Only run on mount

    // Handle fontSize changes
    useEffect(() => {
      if (xtermRef.current) {
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
