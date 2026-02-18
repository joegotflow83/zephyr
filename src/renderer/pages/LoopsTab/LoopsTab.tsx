import React, { useState, useEffect } from 'react';
import { useLoops } from '../../hooks/useLoops';
import { useProjects } from '../../hooks/useProjects';
import { LoopRow } from './LoopRow';
import type { LoopStartOpts } from '../../../shared/loop-types';
import { LoopStatus, LoopMode } from '../../../shared/loop-types';

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

  const handleStop = async (projectId: string) => {
    try {
      await stop(projectId);
    } catch (err) {
      console.error('Failed to stop loop:', err);
    }
  };

  const handleStart = async (projectId: string) => {
    try {
      const opts: LoopStartOpts = {
        projectId,
        mode: LoopMode.CONTINUOUS,
      };
      await start(opts);
    } catch (err) {
      console.error('Failed to start loop:', err);
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
        <div className="p-6 pb-2">
          <h1 className="text-2xl font-bold mb-4">Running Loops</h1>
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

      {/* Lower panel: Log viewer placeholder */}
      <div
        style={{ height: `${100 - splitterPosition}%` }}
        className="flex flex-col bg-gray-900 overflow-hidden"
      >
        <div className="p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">
            {selectedLoop
              ? `Logs: ${projects.find((p) => p.id === selectedLoop.projectId)?.name || selectedLoop.projectId}`
              : 'Logs'}
          </h2>
        </div>
        <div className="flex-1 p-4 overflow-auto font-mono text-sm text-gray-300">
          {selectedLoop ? (
            selectedLoop.logs.length > 0 ? (
              <div>
                {selectedLoop.logs.map((line, idx) => (
                  <div key={idx}>{line}</div>
                ))}
              </div>
            ) : (
              <div className="text-gray-500">No logs yet...</div>
            )
          ) : (
            <div className="text-gray-500">Select a loop to view logs</div>
          )}
        </div>
      </div>
    </div>
  );
};
