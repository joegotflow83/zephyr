import React, { useState, useEffect, useMemo } from 'react';
import { useLoops } from '../../hooks/useLoops';
import { useProjects } from '../../hooks/useProjects';
import { LoopRow } from './LoopRow';
import { FactoryFlowView } from './FactoryFlowView';
import { LogViewer, type ParsedLogLine } from '../../components/LogViewer/LogViewer';
import { RunModeDialog } from '../../components/RunModeDialog/RunModeDialog';
import type { RunModeSelection } from '../../components/RunModeDialog/RunModeDialog';
import type { LoopState, LoopStartOpts } from '../../../shared/loop-types';
import { LoopMode, LoopStatus, getLoopKey } from '../../../shared/loop-types';
import type { ProjectConfig } from '../../../shared/models';

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
  const { loops, loading, error, stop, start, factoryStart, schedule } = useLoops();
  const { projects } = useProjects();
  const [selectedLoopId, setSelectedLoopId] = useState<string | null>(null);
  const [splitterPosition, setSplitterPosition] = useState(60); // Percentage for upper panel
  const [isDragging, setIsDragging] = useState(false);
  const [runModeProject, setRunModeProject] = useState<ProjectConfig | null>(null);

  // Auto-select first running loop on tab switch or when loops update
  useEffect(() => {
    if (loops.length === 0) {
      setSelectedLoopId(null);
      return;
    }

    // If no selection, or selected loop no longer exists, auto-select first running loop
    const stillExists = loops.some((l) => getLoopKey(l) === selectedLoopId);
    if (!selectedLoopId || !stillExists) {
      const runningLoop = loops.find(
        (l) => l.status === LoopStatus.RUNNING || l.status === LoopStatus.STARTING
      );
      setSelectedLoopId(runningLoop ? getLoopKey(runningLoop) : getLoopKey(loops[0]));
    }
  }, [loops, selectedLoopId]);

  const selectedLoop = loops.find((l) => getLoopKey(l) === selectedLoopId);

  // Parse raw logs into ParsedLogLine format for LogViewer.
  // Depend on the logs array reference, not the entire loop object,
  // so status/iteration/error changes don't re-trigger parsing.
  const selectedLoopLogs = selectedLoop?.logs;
  const parsedLogs = useMemo(() => {
    if (!selectedLoopLogs) {
      return [];
    }
    return selectedLoopLogs.map((rawLine) => parseLogLine(rawLine));
  }, [selectedLoopLogs]);

  // Group factory loops by project with visual headers; regular loops appear first in original order
  type LoopDisplayRow =
    | { kind: 'loop'; loop: LoopState }
    | { kind: 'header'; projectId: string; projectName: string; roleLoops: LoopState[] };

  const displayRows = useMemo((): LoopDisplayRow[] => {
    const factoryByProject = new Map<string, LoopState[]>();
    const projectOrder: string[] = [];
    const nonFactoryLoops: LoopState[] = [];

    for (const loop of loops) {
      const project = projects.find((p) => p.id === loop.projectId);
      if (loop.role && project?.factory_config?.enabled) {
        if (!factoryByProject.has(loop.projectId)) {
          projectOrder.push(loop.projectId);
          factoryByProject.set(loop.projectId, []);
        }
        factoryByProject.get(loop.projectId)!.push(loop);
      } else {
        nonFactoryLoops.push(loop);
      }
    }

    const result: LoopDisplayRow[] = [];

    for (const loop of nonFactoryLoops) {
      result.push({ kind: 'loop', loop });
    }

    for (const projectId of projectOrder) {
      const roleLoops = factoryByProject.get(projectId)!;
      const project = projects.find((p) => p.id === projectId);
      result.push({
        kind: 'header',
        projectId,
        projectName: project?.name ?? roleLoops[0].projectName,
        roleLoops,
      });
      for (const loop of roleLoops) {
        result.push({ kind: 'loop', loop });
      }
    }

    return result;
  }, [loops, projects]);

  // Collect factory project groups for the pipeline flow view
  const factoryGroups = useMemo(() => {
    const groups = new Map<string, LoopState[]>();
    for (const loop of loops) {
      const project = projects.find((p) => p.id === loop.projectId);
      if (loop.role && project?.factory_config?.enabled) {
        if (!groups.has(loop.projectId)) {
          groups.set(loop.projectId, []);
        }
        groups.get(loop.projectId)!.push(loop);
      }
    }
    return groups;
  }, [loops]);

  const handleStop = async (projectId: string, role?: string) => {
    try {
      await stop(projectId, role);
    } catch (err) {
      console.error('Failed to stop loop:', err);
    }
  };

  const handleStart = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      setRunModeProject(project);
    }
  };

  const handleRunModeConfirm = async (selection: RunModeSelection) => {
    const project = runModeProject;
    setRunModeProject(null);
    if (!project) return;

    try {
      const extraMounts = (project.additional_mounts ?? []).map((hostPath) => {
        const basename = hostPath.split('/').filter(Boolean).pop() ?? hostPath;
        return `${hostPath}:/mnt/${basename}`;
      });
      const baseOpts = {
        projectId: project.id,
        projectName: project.name,
        dockerImage: project.docker_image || '',
        ...(project.local_path || extraMounts.length > 0
          ? {
              volumeMounts: [
                ...(project.local_path ? [`${project.local_path}:/workspace`] : []),
                ...extraMounts,
              ],
              ...(project.local_path ? { workDir: '/workspace' } : {}),
            }
          : {}),
        ...(project.sandbox_type === 'vm'
          ? { sandboxType: 'vm' as const, vmConfig: project.vm_config }
          : {}),
      };
      if (selection.mode === LoopMode.SCHEDULED && selection.scheduleExpression) {
        await schedule(project.id, selection.scheduleExpression, baseOpts);
      } else if (selection.factory) {
        await factoryStart(project.id, { ...baseOpts, mode: selection.mode });
      } else {
        const opts: LoopStartOpts = {
          ...baseOpts,
          mode: selection.mode,
          ...(selection.cmd ? { cmd: selection.cmd } : {}),
        };
        await start(opts);
      }
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

        {/* Factory pipeline flow views */}
        {factoryGroups.size > 0 && (
          <div className="border-b border-gray-200 dark:border-gray-700">
            {Array.from(factoryGroups.entries()).map(([projectId, factoryLoops]) => {
              const project = projects.find((p) => p.id === projectId);
              return (
                <div key={projectId}>
                  <div className="px-6 pt-3 pb-1 flex items-center gap-2">
                    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-purple-900 text-purple-300">
                      Factory
                    </span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {project?.name ?? factoryLoops[0].projectName}
                    </span>
                  </div>
                  <FactoryFlowView
                    loops={factoryLoops}
                    selectedLoopKey={selectedLoopId}
                    onSelectLoop={(l) => setSelectedLoopId(getLoopKey(l))}
                  />
                </div>
              );
            })}
          </div>
        )}

        {loading && (
          <div className="px-6 py-4 text-gray-500 dark:text-gray-400">Loading loops...</div>
        )}

        {error && (
          <div className="px-6 py-4 text-red-400">Error: {error}</div>
        )}

        {!loading && !error && loops.length === 0 && (
          <div className="px-6 py-4 text-gray-500 dark:text-gray-400">
            No active or recent loops. Start a project from the Projects tab.
          </div>
        )}

        {!loading && !error && loops.length > 0 && (
          <div className="px-6 flex-1 overflow-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    Project Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    Mode
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    Iteration
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    Started
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-900">
                {displayRows.map((row) => {
                  if (row.kind === 'header') {
                    const activeRoleLoops = row.roleLoops.filter(
                      (l) => l.status === LoopStatus.RUNNING || l.status === LoopStatus.STARTING
                    );
                    return (
                      <tr
                        key={`factory-header-${row.projectId}`}
                        className="bg-purple-950/30 border-b border-purple-800/40"
                      >
                        <td colSpan={6} className="px-4 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-purple-900 text-purple-300">
                                Factory
                              </span>
                              {row.projectName}
                            </span>
                            {activeRoleLoops.length > 0 && (
                              <button
                                onClick={async () => {
                                  for (const loop of activeRoleLoops) {
                                    await handleStop(loop.projectId, loop.role);
                                  }
                                }}
                                className="px-2 py-1 text-xs bg-red-700 text-white rounded hover:bg-red-600 transition-colors"
                              >
                                Stop All
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  const loop = row.loop;
                  const project = projects.find((p) => p.id === loop.projectId);
                  return (
                    <LoopRow
                      key={getLoopKey(loop)}
                      loop={loop}
                      project={project}
                      isSelected={getLoopKey(loop) === selectedLoopId}
                      onSelect={(l) => setSelectedLoopId(getLoopKey(l))}
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
        className="h-1 bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-600 cursor-row-resize transition-colors"
        onMouseDown={handleMouseDown}
      />

      {/* Lower panel: Log viewer with LogViewer component */}
      <div
        style={{ height: `${100 - splitterPosition}%` }}
        className="flex flex-col bg-white dark:bg-gray-900 overflow-hidden"
      >
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {selectedLoop
              ? `Logs: ${projects.find((p) => p.id === selectedLoop.projectId)?.name || selectedLoop.projectId}`
              : 'Logs'}
          </h2>
        </div>
        <div className="flex-1 overflow-hidden">
          {selectedLoop ? (
            parsedLogs.length === 0 && selectedLoop.status === LoopStatus.FAILED && selectedLoop.error ? (
              <div className="p-4 text-red-400 font-mono text-sm whitespace-pre-wrap">
                {selectedLoop.error}
              </div>
            ) : (
              <LogViewer lines={parsedLogs} autoScroll={true} onExport={handleExport} />
            )
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-500">
              Select a loop to view logs
            </div>
          )}
        </div>
      </div>

      {/* Run Mode Dialog */}
      {runModeProject && (
        <RunModeDialog
          projectName={runModeProject.name}
          promptFiles={Object.keys(runModeProject.custom_prompts)}
          factoryEnabled={!!runModeProject.factory_config?.enabled}
          onConfirm={handleRunModeConfirm}
          onCancel={() => setRunModeProject(null)}
        />
      )}
    </div>
  );
};
