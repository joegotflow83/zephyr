import React, { useState } from 'react';
import { LoopMode } from '../../../shared/loop-types';

export interface RunModeSelection {
  mode: LoopMode;
  /** CMD override for single-mode runs; undefined for continuous */
  cmd?: string[];
  /** When true, start as a factory (multiple role containers) */
  factory?: boolean;
}

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

  const buildSelection = (): RunModeSelection => {
    if (selected === 'factory') {
      return { mode: LoopMode.CONTINUOUS, factory: true };
    }
    if (selected === 'continuous') {
      return { mode: LoopMode.CONTINUOUS };
    }
    // selected is a prompt filename
    const cmd = [
      'bash',
      '-c',
      `claude --print "$(cat /root/.claude/${selected})"`,
    ];
    return { mode: LoopMode.SINGLE, cmd };
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
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  Coding Factory
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Start all configured roles in parallel
                </div>
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
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-white capitalize">
                  {getLabelForPromptFile(filename)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Single run using {filename}
                </div>
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
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Run
          </button>
        </div>
      </div>
    </div>
  );
};
