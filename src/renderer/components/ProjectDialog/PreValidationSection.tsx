/**
 * PreValidationSection — checkbox list of pre-validation scripts for the
 * ProjectDialog.
 *
 * Displays all scripts from ~/.zephyr/pre_validation_scripts/ with checkboxes.
 * Selected script filenames are stored in ProjectConfig.pre_validation_scripts.
 * Also provides an "Add Custom Script" inline editor for user-authored scripts.
 */

import React, { useState, useEffect } from 'react';

interface PreValidationScript {
  filename: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
}

interface PreValidationSectionProps {
  /** Currently selected script filenames */
  selected: string[];
  /** Callback when selection changes */
  onChange: (selected: string[]) => void;
}

/**
 * Renders a checkbox list of pre-validation scripts.
 * Loads available scripts from the main process via IPC on mount.
 */
export const PreValidationSection: React.FC<PreValidationSectionProps> = ({
  selected,
  onChange,
}) => {
  const [scripts, setScripts] = useState<PreValidationScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddEditor, setShowAddEditor] = useState(false);
  const [newFilename, setNewFilename] = useState('');
  const [newContent, setNewContent] = useState('');
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadScripts = async () => {
    try {
      const list = await window.api.preValidation.list();
      setScripts(list);
    } catch {
      // Non-fatal: show empty list
      setScripts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadScripts();
  }, []);

  const handleToggle = (filename: string) => {
    if (selected.includes(filename)) {
      onChange(selected.filter((f) => f !== filename));
    } else {
      onChange([...selected, filename]);
    }
  };

  const handleAddCustomScript = async () => {
    setAddError('');
    const trimmedFilename = newFilename.trim();
    if (!trimmedFilename) {
      setAddError('Filename is required');
      return;
    }
    const filename = trimmedFilename.endsWith('.sh') ? trimmedFilename : `${trimmedFilename}.sh`;
    if (!newContent.trim()) {
      setAddError('Script content is required');
      return;
    }

    setSaving(true);
    try {
      await window.api.preValidation.add(filename, newContent);
      setNewFilename('');
      setNewContent('');
      setShowAddEditor(false);
      await loadScripts();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to save script');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4">
      <div className="text-sm font-medium text-gray-300 mb-1">Pre-Validation Scripts</div>
      <p className="text-xs text-gray-400 mb-3">
        Select scripts to inject into the container. These run before git commits for validation.
      </p>

      {loading ? (
        <p className="text-xs text-gray-500">Loading scripts…</p>
      ) : scripts.length === 0 && !showAddEditor ? (
        <p className="text-xs text-gray-500">
          No scripts available. Use &quot;+ Add Custom Script&quot; to create one.
        </p>
      ) : (
        <div className="space-y-2 mb-3">
          {scripts.map((script) => (
            <label
              key={script.filename}
              className="flex items-start gap-2 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={selected.includes(script.filename)}
                onChange={() => handleToggle(script.filename)}
                className="mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="text-sm text-gray-200">{script.filename}</span>
                {script.description && (
                  <span className="ml-2 text-xs text-gray-400">— {script.description}</span>
                )}
                {script.isBuiltIn && (
                  <span className="ml-1 text-xs text-blue-400">(built-in)</span>
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      {/* Add Custom Script */}
      {showAddEditor ? (
        <div className="mt-2 p-3 bg-gray-750 border border-gray-600 rounded space-y-2">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Filename (.sh)</label>
            <input
              type="text"
              value={newFilename}
              onChange={(e) => setNewFilename(e.target.value)}
              placeholder="my-check.sh"
              className="w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="pv-script-content" className="block text-xs text-gray-400 mb-1">
              Script Content
            </label>
            <textarea
              id="pv-script-content"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder={'#!/bin/bash\n# Description: My custom check\necho "Running check..."'}
              rows={6}
              className="w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {addError && <p className="text-xs text-red-400">{addError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAddCustomScript}
              disabled={saving}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Script'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddEditor(false);
                setNewFilename('');
                setNewContent('');
                setAddError('');
              }}
              className="px-3 py-1 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddEditor(true)}
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          + Add Custom Script
        </button>
      )}
    </div>
  );
};
