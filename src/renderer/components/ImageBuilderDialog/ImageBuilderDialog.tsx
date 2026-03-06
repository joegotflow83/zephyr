/**
 * ImageBuilderDialog — modal dialog for building new Zephyr Docker images.
 *
 * Allows users to select languages + versions, auto-generates a name, then
 * streams build output in real time. Surfaces success/error states and calls
 * onBuilt with the new ZephyrImage when the build succeeds.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useImages } from '../../hooks/useImages';
import { AVAILABLE_LANGUAGES } from '../../../shared/models';
import type { ZephyrImage, ImageBuildConfig } from '../../../shared/models';

export interface ImageBuilderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onBuilt?: (image: ZephyrImage) => void;
}

const BASE_TOOLS = ['git', 'curl', 'vim', 'jq', 'ssh', 'build-essential', 'playwright-deps', 'claude-code', 'semgrep', 'trivy', 'bandit'];

/**
 * Derives a deterministic image name from the selected languages/versions.
 * E.g. Python 3.12 + Node.js 20 → "zephyr-python-3.12-nodejs-20"
 */
function generateAutoName(selections: Record<string, string>): string {
  const parts = Object.entries(selections)
    .filter(([, v]) => v)
    .map(([id, v]) => `${id}-${v}`);
  return parts.length > 0 ? `zephyr-${parts.join('-')}` : '';
}

export function ImageBuilderDialog({ isOpen, onClose, onBuilt }: ImageBuilderDialogProps) {
  const { images, buildProgress, buildActive, build } = useImages();

  // Language selection: langId → chosen version (presence = checked)
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [nameOverridden, setNameOverridden] = useState(false);
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [buildSucceeded, setBuildSucceeded] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  // Refs to avoid stale-closure issues in async callbacks
  const submittedNameRef = useRef('');
  const calledOnBuiltRef = useRef(false);
  const progressContainerRef = useRef<HTMLPreElement>(null);

  // Auto-generate name whenever language selections change (unless user overrode it)
  useEffect(() => {
    if (!nameOverridden) {
      setName(generateAutoName(selectedVersions));
    }
  }, [selectedVersions, nameOverridden]);

  // Accumulate streamed progress lines
  useEffect(() => {
    if (buildProgress !== null) {
      setProgressLines((prev) => [...prev, buildProgress]);
    }
  }, [buildProgress]);

  // Auto-scroll build output to bottom
  useEffect(() => {
    if (progressContainerRef.current) {
      progressContainerRef.current.scrollTop = progressContainerRef.current.scrollHeight;
    }
  }, [progressLines]);

  // Call onBuilt once the build succeeds and the images list is updated
  useEffect(() => {
    if (buildSucceeded && !calledOnBuiltRef.current) {
      const builtImage = images.find((img) => img.name === submittedNameRef.current);
      if (builtImage) {
        calledOnBuiltRef.current = true;
        onBuilt?.(builtImage);
      }
    }
  }, [buildSucceeded, images, onBuilt]);

  // Reset all dialog state when it opens (so a second open starts fresh)
  useEffect(() => {
    if (isOpen) {
      setSelectedVersions({});
      setName('');
      setNameOverridden(false);
      setProgressLines([]);
      setBuildSucceeded(false);
      setLocalError(null);
      setShowConfirmClose(false);
      submittedNameRef.current = '';
      calledOnBuiltRef.current = false;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // --- Event handlers ---

  const handleLanguageToggle = (langId: string, checked: boolean) => {
    setSelectedVersions((prev) => {
      const next = { ...prev };
      if (checked) {
        const lang = AVAILABLE_LANGUAGES.find((l) => l.id === langId);
        next[langId] = lang?.defaultVersion ?? '';
      } else {
        delete next[langId];
      }
      return next;
    });
  };

  const handleVersionChange = (langId: string, version: string) => {
    setSelectedVersions((prev) => ({ ...prev, [langId]: version }));
  };

  const handleNameChange = (value: string) => {
    setName(value);
    setNameOverridden(true);
  };

  const handleBuild = async () => {
    const languages = Object.entries(selectedVersions)
      .filter(([, v]) => v)
      .map(([languageId, version]) => ({ languageId, version }));

    const trimmedName = name.trim();
    const config: ImageBuildConfig = { name: trimmedName, languages };

    submittedNameRef.current = trimmedName;
    calledOnBuiltRef.current = false;
    setProgressLines([]);
    setBuildSucceeded(false);
    setLocalError(null);

    try {
      await build(config);
      setBuildSucceeded(true);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Build failed');
    }
  };

  const handleClose = () => {
    if (buildActive) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  };

  const canBuild =
    name.trim().length > 0 && Object.keys(selectedVersions).length > 0 && !buildActive;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Build New Image</h2>
            {buildActive && (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-400 border-t-transparent" />
            )}
          </div>
          <button
            onClick={handleClose}
            aria-label="Close dialog"
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {/* Image name */}
          <div>
            <label htmlFor="image-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Image Name
            </label>
            <input
              id="image-name"
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Auto-generated from language selections"
              disabled={buildActive}
              className="w-full bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded px-3 py-2 border border-gray-200 dark:border-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
          </div>

          {/* Language selection */}
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Languages</div>
            {AVAILABLE_LANGUAGES.map((lang) => (
              <div key={lang.id} className="mb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lang.id in selectedVersions}
                    onChange={(e) => handleLanguageToggle(lang.id, e.target.checked)}
                    disabled={buildActive}
                    aria-label={lang.name}
                  />
                  <span className="text-gray-800 dark:text-gray-200">{lang.name}</span>
                </label>
                {lang.id in selectedVersions && (
                  <div className="ml-6 mt-1 flex items-center gap-2">
                    <label htmlFor={`version-${lang.id}`} className="text-xs text-gray-500 dark:text-gray-400">
                      Version:
                    </label>
                    <select
                      id={`version-${lang.id}`}
                      value={selectedVersions[lang.id]}
                      onChange={(e) => handleVersionChange(lang.id, e.target.value)}
                      disabled={buildActive}
                      className="bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded px-2 py-1 text-sm border border-gray-200 dark:border-gray-600"
                    >
                      {lang.versions.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Base tools (read-only) */}
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Base Tools (always included)
            </div>
            <div className="flex flex-wrap gap-2">
              {BASE_TOOLS.map((tool) => (
                <span key={tool} className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-2 py-1 rounded">
                  {tool}
                </span>
              ))}
            </div>
          </div>

          {/* Streaming build output */}
          {progressLines.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Build Output</span>
                {buildActive && (
                  <div className="animate-spin rounded-full h-3 w-3 border-2 border-gray-400 border-t-transparent" />
                )}
              </div>
              <pre
                ref={progressContainerRef}
                data-testid="build-output"
                className="bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 text-xs p-3 rounded overflow-y-auto max-h-48"
              >
                {progressLines.join('\n')}
              </pre>
            </div>
          )}

          {/* Success banner */}
          {buildSucceeded && !localError && (
            <div className="p-3 bg-green-900 border border-green-700 rounded text-green-200 text-sm">
              Image built successfully!
            </div>
          )}

          {/* Error banner with retry */}
          {localError && (
            <div className="p-3 bg-red-900 border border-red-700 rounded text-red-200 text-sm">
              <div>Build failed: {localError}</div>
              <button
                onClick={() => setLocalError(null)}
                className="mt-2 text-xs underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}

          {/* Confirm close during active build */}
          {showConfirmClose && (
            <div className="p-3 bg-yellow-900 border border-yellow-700 rounded text-yellow-200 text-sm">
              <div>A build is in progress. Close anyway?</div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => onClose()}
                  className="text-xs bg-red-700 hover:bg-red-600 px-2 py-1 rounded text-white"
                >
                  Close anyway
                </button>
                <button
                  onClick={() => setShowConfirmClose(false)}
                  className="text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 px-2 py-1 rounded text-gray-900 dark:text-white"
                >
                  Stay
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          <button onClick={handleClose} className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">
            Cancel
          </button>
          <button
            onClick={handleBuild}
            disabled={!canBuild}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {buildActive ? 'Building...' : 'Build'}
          </button>
        </div>
      </div>
    </div>
  );
}
