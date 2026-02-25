import React, { useState, useEffect, useMemo } from 'react';
import { useLoops } from '../../hooks/useLoops';
import { useProjects } from '../../hooks/useProjects';
import { LoopRow } from './LoopRow';
import { LogViewer, type ParsedLogLine } from '../../components/LogViewer/LogViewer';
import type { LoopStartOpts } from '../../../shared/loop-types';
import { LoopStatus, LoopMode } from '../../../shared/loop-types';

/**
 * Simple log parser to convert raw log strings to ParsedLogLine format.
 * Matches logic from LogParser service.
 */
function parseLogLine(rawLine: string): ParsedLogLine {
  const line = rawLine.trim();

  // Extract ISO timestamp if present
  const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)/);
  const timestamp = timestampMatch ? timestampMatch[1] : null;

  // Detect commit lines
  const commitShortMatch = line.match(/\[[\w/.-]+\s+([0-9a-f]{7,40})\]/);
  const commitLongMatch = line.match(/(?:^|\s)commit\s+([0-9a-f]{7,40})\b/i);
  const commitCreatingMatch = line.match(/creating\s+commit\s+([0-9a-f]{7,40})/i);

  if (commitShortMatch || commitLongMatch || commitCreatingMatch) {
    const commit_hash =
      commitShortMatch?.[1] || commitLongMatch?.[1] || commitCreatingMatch?.[1];
    return {
      type: 'commit',
      content: line,
      timestamp,
      commit_hash,
    };
  }

  // Detect plan lines
  if (/^\s*(?:PLAN|Plan)\s*:\s*/s.test(line)) {
    return {
      type: 'plan',
      content: line,
      timestamp,
    };
  }

  // Detect error lines
  if (
    /^\s*Traceback\s+\(most recent call last\)/i.test(line) ||
    /^\s*(?:\w+\.)*\w*(?:Error|Exception|Failure|Fatal|Interrupt|Warning|NotFound|Refused|Timeout)\b.*:\s*/i.test(
      line
    )
  ) {
    return {
      type: 'error',
      content: line,
      timestamp,
    };
  }

  // Default to info
  return {
    type: 'info',
    content: line,
    timestamp,
  };
}

/**
 * LoopsTab page component.
 *
 * Displays a table of active/recent loops with status, actions, and log viewer.
 * Split layout: upper table + lower log viewer (resizable).
 */
export const LoopsTab: React.FC = () => {
  const { loops, loading, error, stop, start } = useLoops();
  const { projects } = useProjects();
  const [selectedLoopId, setSelectedLoopId] = useState<string | null>(null);
  const [splitterPosition, setSplitterPosition] = useState(60); // Percentage for upper panel
  const [isDragging, setIsDragging] = useState(false);

  // Auto-select first running loop on tab switch or when loops update
  useEffect(() => {
    if (loops.length === 0) {
      setSelectedLoopId(null);
      return;
    }

    // If no selection, or selected loop no longer exists, auto-select first running loop
    const stillExists = loops.some((l) => l.projectId === selectedLoopId);
    if (!selectedLoopId || !stillExists) {
      const runningLoop = loops.find(
        (l) => l.status === LoopStatus.RUNNING || l.status === LoopStatus.STARTING
      );
      setSelectedLoopId(runningLoop?.projectId || loops[0].projectId);
    }
  }, [loops, selectedLoopId]);

  const selectedLoop = loops.find((l) => l.projectId === selectedLoopId);

  // Parse raw logs into ParsedLogLine format for LogViewer
  const parsedLogs = useMemo(() => {
    if (!selectedLoop || !selectedLoop.logs) {
      return [];
    }
    return selectedLoop.logs.map((rawLine) => parseLogLine(rawLine));
  }, [selectedLoop]);

  const handleStop = async (projectId: string) => {
    try {
      await stop(projectId);
    } catch (err) {
      console.error('Failed to stop loop:', err);
    }
  };

  const handleStart = async (projectId: string) => {
    try {
      const project = projects.find((p) => p.id === projectId);
      const opts: LoopStartOpts = {
        projectId,
        projectName: project?.name || projectId,
        mode: LoopMode.CONTINUOUS,
        dockerImage: project?.docker_image || '',
        ...(project?.local_path
          ? { volumeMounts: [`${project.local_path}:/workspace`], workDir: '/workspace' }
          : {}),
      };
      await start(opts);
    } catch (err) {
      console.error('Failed to start loop:', err);
    }
  };

  const handleExport = async () => {
    if (!selectedLoop) return;

    try {
      const result = await window.api.logs.export(selectedLoop.projectId, 'text');
      if (result.success) {
        console.log('Log exported successfully to:', result.path);
      } else {
        console.error('Export failed:', result.error);
      }
    } catch (err) {
      console.error('Failed to export log:', err);
    }
  };

  const handleExportAll = async () => {
    try {
      const result = await window.api.logs.exportAll('text');
      if (result.success) {
        console.log('All logs exported successfully to:', result.path);
      } else {
        console.error('Export all failed:', result.error);
      }
    } catch (err) {
      console.error('Failed to export all logs:', err);
    }
  };

  // Splitter drag handling
  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const container = e.currentTarget as HTMLElement;
    const rect = container.getBoundingClientRect();
    const percentage = ((e.clientY - rect.top) / rect.height) * 100;
    // Constrain between 30% and 80%
    setSplitterPosition(Math.min(80, Math.max(30, percentage)));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      const handleGlobalMouseUp = () => setIsDragging(false);
      document.addEventListener('mouseup', handleGlobalMouseUp);
      return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [isDragging]);

  return (
    <div
      className="flex flex-col h-full"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Upper panel: Loops table */}
      <div style={{ height: `${splitterPosition}%` }} className="flex flex-col overflow-hidden">
        <div className="p-6 pb-2 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Running Loops</h1>
          <button
            onClick={handleExportAll}
            disabled={loops.length === 0}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
            title="Export all loop logs"
          >
            Export All
          </button>
        </div>

        {loading && (
          <div className="px-6 py-4 text-gray-400">Loading loops...</div>
        )}

        {error && (
          <div className="px-6 py-4 text-red-400">Error: {error}</div>
        )}

        {!loading && !error && loops.length === 0 && (
          <div className="px-6 py-4 text-gray-400">
            No active or recent loops. Start a project from the Projects tab.
          </div>
        )}

        {!loading && !error && loops.length > 0 && (
          <div className="px-6 flex-1 overflow-auto">
            <table className="min-w-full">
              <thead className="bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Project Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Mode
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Iteration
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Started
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-gray-900">
                {loops.map((loop) => {
                  const project = projects.find((p) => p.id === loop.projectId);
                  return (
                    <LoopRow
                      key={loop.projectId}
                      loop={loop}
                      project={project}
                      isSelected={loop.projectId === selectedLoopId}
                      onSelect={(l) => setSelectedLoopId(l.projectId)}
                      onStop={handleStop}
                      onStart={handleStart}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Resizable splitter */}
      <div
        className="h-1 bg-gray-700 hover:bg-blue-600 cursor-row-resize transition-colors"
        onMouseDown={handleMouseDown}
      />

      {/* Lower panel: Log viewer with LogViewer component */}
      <div
        style={{ height: `${100 - splitterPosition}%` }}
        className="flex flex-col bg-gray-900 overflow-hidden"
      >
        <div className="px-4 py-2 border-b border-gray-700 bg-gray-800">
          <h2 className="text-sm font-semibold text-white">
            {selectedLoop
              ? `Logs: ${projects.find((p) => p.id === selectedLoop.projectId)?.name || selectedLoop.projectId}`
              : 'Logs'}
          </h2>
        </div>
        <div className="flex-1 overflow-hidden">
          {selectedLoop ? (
            <LogViewer lines={parsedLogs} autoScroll={true} onExport={handleExport} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              Select a loop to view logs
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
