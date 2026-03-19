import React, { useState } from 'react';
import { LoopMode } from '../../../shared/loop-types';

export interface RunModeSelection {
  mode: LoopMode;
  /** CMD override for single-mode runs; undefined for continuous */
  cmd?: string[];
  /** When true, start as a factory (multiple role containers) */
  factory?: boolean;
  /** Schedule expression for SCHEDULED mode (e.g. "every 30 minutes", "every 2 hours", "daily 09:00", "once <ISO>") */
  scheduleExpression?: string;
  /** Max iterations for factory single-run mode */
  maxIterations?: number;
}

const SCHEDULE_PRESETS = [
  { label: 'Every 15 minutes', value: '*/15 minutes' },
  { label: 'Every 30 minutes', value: '*/30 minutes' },
  { label: 'Every hour', value: 'every 1 hour' },
  { label: 'Every 2 hours', value: 'every 2 hours' },
  { label: 'Every 6 hours', value: 'every 6 hours' },
  { label: 'Every 12 hours', value: 'every 12 hours' },
  { label: 'Daily at...', value: 'daily' },
  { label: 'Custom...', value: 'custom' },
];

interface RunModeDialogProps {
  projectName: string;
  /** Filenames present in custom_prompts (e.g. ["PROMPT_plan.md", "PROMPT_build.md"]) */
  promptFiles: string[];
  /** Whether factory mode is available for this project */
  factoryEnabled?: boolean;
  onConfirm: (selection: RunModeSelection) => void;
  onCancel: () => void;
}

/**
 * Modal for selecting how to run a loop.
 *
 * Presents:
 *  - Continuous mode (existing behaviour)
 *  - One Single-run option per custom_prompt file in the project
 *
 * For single runs the dialog constructs a CMD that invokes claude with the
 * content of the selected prompt file, which must be mounted at /root/.claude
 * before the container starts (handled in loop-handlers.ts).
 */
export const RunModeDialog: React.FC<RunModeDialogProps> = ({
  projectName,
  promptFiles,
  factoryEnabled = false,
  onConfirm,
  onCancel,
}) => {
  const [selected, setSelected] = useState<string>(factoryEnabled ? 'factory' : 'continuous');
  const [maxIterations, setMaxIterations] = useState<number>(10);
  const [schedulePreset, setSchedulePreset] = useState<string>('*/30 minutes');
  const [dailyTime, setDailyTime] = useState<string>('09:00');
  const [customSchedule, setCustomSchedule] = useState<string>('');
  const [runOnceAt, setRunOnceAt] = useState<string>(() => {
    // Default to 1 hour from now in local time, formatted for datetime-local input
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  const getScheduleExpression = (): string => {
    if (schedulePreset === 'daily') return `daily ${dailyTime}`;
    if (schedulePreset === 'custom') return customSchedule;
    return schedulePreset;
  };

  const buildSelection = (): RunModeSelection => {
    if (selected === 'factory') {
      return { mode: LoopMode.SINGLE, factory: true, maxIterations };
    }
    if (selected === 'continuous') {
      return { mode: LoopMode.CONTINUOUS };
    }
    if (selected === 'scheduled') {
      return { mode: LoopMode.SCHEDULED, scheduleExpression: getScheduleExpression() };
    }
    if (selected === 'run-once') {
      return { mode: LoopMode.SCHEDULED, scheduleExpression: `once ${new Date(runOnceAt).toISOString()}` };
    }
    // selected is a prompt filename
    const cmd = [
      'bash',
      '-c',
      `claude --max-turns ${maxIterations} --print "$(cat /workspace/${selected})"`,
    ];
    return { mode: LoopMode.SINGLE, cmd, maxIterations };
  };

  const handleConfirm = () => {
    onConfirm(buildSelection());
  };

  const getLabelForPromptFile = (filename: string): string => {
    // Strip extension and "PROMPT_" prefix for a friendlier label
    return filename
      .replace(/^PROMPT_/i, '')
      .replace(/\.[^.]+$/, '');
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-60"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Run Loop
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {projectName}
        </p>

        <div className="space-y-2 mb-6">
          {/* Factory option - only when factory is configured */}
          {factoryEnabled && (
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/20">
              <input
                type="radio"
                name="run-mode"
                value="factory"
                checked={selected === 'factory'}
                onChange={() => setSelected('factory')}
                className="mt-0.5 accent-blue-600"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  Coding Factory
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Run all configured roles in parallel as a single task
                </div>
                {selected === 'factory' && (
                  <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <label className="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      Max iterations
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={maxIterations}
                      onChange={(e) => setMaxIterations(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 text-xs rounded border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
            </label>
          )}

          {/* Continuous option */}
          <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/20">
            <input
              type="radio"
              name="run-mode"
              value="continuous"
              checked={selected === 'continuous'}
              onChange={() => setSelected('continuous')}
              className="mt-0.5 accent-blue-600"
            />
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Continuous
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Run indefinitely until manually stopped
              </div>
            </div>
          </label>

          {/* Scheduled option */}
          <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/20">
            <input
              type="radio"
              name="run-mode"
              value="scheduled"
              checked={selected === 'scheduled'}
              onChange={() => setSelected('scheduled')}
              className="mt-0.5 accent-blue-600"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Scheduled
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Run automatically on a repeating schedule
              </div>
              {selected === 'scheduled' && (
                <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={schedulePreset}
                    onChange={(e) => setSchedulePreset(e.target.value)}
                    className="w-full text-xs rounded border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {SCHEDULE_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  {schedulePreset === 'daily' && (
                    <input
                      type="time"
                      value={dailyTime}
                      onChange={(e) => setDailyTime(e.target.value)}
                      className="w-full text-xs rounded border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  )}
                  {schedulePreset === 'custom' && (
                    <input
                      type="text"
                      value={customSchedule}
                      onChange={(e) => setCustomSchedule(e.target.value)}
                      placeholder='e.g. "*/10 minutes" or "every 3 hours"'
                      className="w-full text-xs rounded border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-400"
                    />
                  )}
                </div>
              )}
            </div>
          </label>

          {/* Run once at a specific datetime */}
          <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/20">
            <input
              type="radio"
              name="run-mode"
              value="run-once"
              checked={selected === 'run-once'}
              onChange={() => setSelected('run-once')}
              className="mt-0.5 accent-blue-600"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Run once at...
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Schedule a single run at a specific date and time
              </div>
              {selected === 'run-once' && (
                <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="datetime-local"
                    value={runOnceAt}
                    min={(() => {
                      const now = new Date(Date.now() + 60 * 1000);
                      const pad = (n: number) => String(n).padStart(2, '0');
                      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
                    })()}
                    onChange={(e) => setRunOnceAt(e.target.value)}
                    className="w-full text-xs rounded border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>
          </label>

          {/* Single-run option per prompt file */}
          {promptFiles.map((filename) => (
            <label
              key={filename}
              className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/20"
            >
              <input
                type="radio"
                name="run-mode"
                value={filename}
                checked={selected === filename}
                onChange={() => setSelected(filename)}
                className="mt-0.5 accent-blue-600"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-white capitalize">
                  {getLabelForPromptFile(filename)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Single run using {filename}
                </div>
                {selected === filename && (
                  <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <label className="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      Max iterations
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={maxIterations}
                      onChange={(e) => setMaxIterations(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 text-xs rounded border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
            </label>
          ))}

          {/* If no prompt files, single mode is unavailable */}
          {promptFiles.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 px-1">
              Add custom prompt files to the project to enable single-run modes.
            </p>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={selected === 'run-once' && (!runOnceAt || new Date(runOnceAt).getTime() <= Date.now())}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {selected === 'run-once' ? 'Schedule' : 'Run'}
          </button>
        </div>
      </div>
    </div>
  );
};
