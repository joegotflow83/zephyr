import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface ParsedLogLine {
  type: 'commit' | 'plan' | 'error' | 'info';
  content: string;
  timestamp: string | null;
  commit_hash?: string;
}

export interface LogViewerProps {
  lines: ParsedLogLine[];
  autoScroll?: boolean;
  onClear?: () => void;
  onExport?: () => void;
  className?: string;
}

/**
 * LogViewer Component
 *
 * High-performance virtualized log viewer with syntax highlighting,
 * search, auto-scroll, and filtering capabilities.
 *
 * Features:
 * - Virtualized scrolling for 10k+ lines without lag
 * - Syntax highlighting by log type (commit=green, error=red, plan=blue, info=gray)
 * - Auto-scroll to bottom with scroll-lock toggle
 * - Search/filter functionality (Ctrl+F)
 * - Line timestamps
 * - Clear logs button
 */
export const LogViewer: React.FC<LogViewerProps> = ({
  lines,
  autoScroll: autoScrollProp = true,
  onClear,
  onExport,
  className = '',
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(autoScrollProp);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastLineCountRef = useRef(lines.length);

  // Filter lines based on search term
  const filteredLines = useMemo(() => {
    if (!searchTerm.trim()) {
      return lines;
    }
    const lowerSearch = searchTerm.toLowerCase();
    return lines.filter(
      (line) =>
        line.content.toLowerCase().includes(lowerSearch) ||
        line.timestamp?.toLowerCase().includes(lowerSearch)
    );
  }, [lines, searchTerm]);

  // Virtualizer setup
  const rowVirtualizer = useVirtualizer({
    count: filteredLines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24, // Estimate line height in pixels
    overscan: 10, // Render 10 extra items outside viewport
  });

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoScroll && filteredLines.length > lastLineCountRef.current) {
      const lastIndex = filteredLines.length - 1;
      if (lastIndex >= 0) {
        rowVirtualizer.scrollToIndex(lastIndex, {
          align: 'end',
          behavior: 'smooth',
        });
      }
    }
    lastLineCountRef.current = filteredLines.length;
  }, [filteredLines.length, autoScroll, rowVirtualizer]);

  // Sync autoScroll prop changes
  useEffect(() => {
    setAutoScroll(autoScrollProp);
  }, [autoScrollProp]);

  // Keyboard shortcut for search (Ctrl+F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (e.key === 'Escape' && isSearchOpen) {
        setIsSearchOpen(false);
        setSearchTerm('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen]);

  // Get color class based on log type
  const getLineColorClass = (type: ParsedLogLine['type']): string => {
    switch (type) {
      case 'commit':
        return 'text-green-600 dark:text-green-400';
      case 'error':
        return 'text-red-600 dark:text-red-400';
      case 'plan':
        return 'text-blue-600 dark:text-blue-400';
      case 'info':
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp: string | null): string => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', { hour12: false });
    } catch {
      return timestamp;
    }
  };

  // Scroll to bottom manually
  const scrollToBottom = () => {
    const lastIndex = filteredLines.length - 1;
    if (lastIndex >= 0) {
      rowVirtualizer.scrollToIndex(lastIndex, { align: 'end' });
    }
  };

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700">
        {/* Search toggle */}
        <button
          onClick={() => {
            setIsSearchOpen(!isSearchOpen);
            if (!isSearchOpen) {
              setTimeout(() => searchInputRef.current?.focus(), 0);
            }
          }}
          className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600"
          title="Search logs (Ctrl+F)"
        >
          Search
        </button>

        {/* Auto-scroll toggle */}
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="cursor-pointer"
          />
          <span className="text-gray-700 dark:text-gray-300">Auto-scroll</span>
        </label>

        {/* Scroll to bottom button */}
        <button
          onClick={scrollToBottom}
          className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600"
          title="Scroll to bottom"
        >
          ↓ Bottom
        </button>

        {/* Export button */}
        {onExport && (
          <button
            onClick={onExport}
            className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600"
            title="Export logs"
          >
            Export
          </button>
        )}

        {/* Clear button */}
        {onClear && (
          <button
            onClick={onClear}
            className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600"
            title="Clear logs"
          >
            Clear
          </button>
        )}

        {/* Line count */}
        <span className="ml-auto text-xs text-gray-600 dark:text-gray-400">
          {filteredLines.length} {filteredLines.length === 1 ? 'line' : 'lines'}
          {searchTerm && filteredLines.length !== lines.length && (
            <span className="text-blue-600 dark:text-blue-400">
              {' '}
              (filtered from {lines.length})
            </span>
          )}
        </span>
      </div>

      {/* Search bar */}
      {isSearchOpen && (
        <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search logs..."
              className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => {
                setSearchTerm('');
                setIsSearchOpen(false);
              }}
              className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Log content */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono text-xs"
        style={{ contain: 'strict' }}
      >
        {filteredLines.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            {lines.length === 0 ? 'No logs yet' : 'No matching logs'}
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualItems.map((virtualRow) => {
              const line = filteredLines[virtualRow.index];
              const colorClass = getLineColorClass(line.type);
              const timestamp = formatTimestamp(line.timestamp);

              return (
                <div
                  key={virtualRow.index}
                  data-index={virtualRow.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="px-2 py-0.5 whitespace-pre-wrap break-all"
                >
                  {timestamp && (
                    <span className="text-gray-500 mr-2">[{timestamp}]</span>
                  )}
                  <span className={colorClass}>{line.content}</span>
                  {line.commit_hash && (
                    <span className="text-green-400 ml-2">({line.commit_hash})</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
