/**
 * HooksSection — checkbox list of Claude hook files for the ProjectDialog.
 *
 * Displays all hook files from ~/.zephyr/hooks/ with checkboxes.
 * Selected hook filenames are stored in ProjectConfig.hooks.
 * Also provides an "Add Hook File" inline editor for user-authored hooks.
 *
 * Hook files are injected into containers at ~/.claude/hooks/ so the
 * Claude agent can invoke them during execution.
 */

import React, { useState, useEffect } from 'react';

interface HookFile {
  filename: string;
  name: string;
  description: string;
}

interface HooksSectionProps {
  /** Currently selected hook filenames */
  selected: string[];
  /** Callback when selection changes */
  onChange: (selected: string[]) => void;
}

/**
 * Renders a checkbox list of Claude hook files.
 * Loads available hooks from the main process via IPC on mount.
 */
export const HooksSection: React.FC<HooksSectionProps> = ({ selected, onChange }) => {
  const [hooks, setHooks] = useState<HookFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddEditor, setShowAddEditor] = useState(false);
  const [newFilename, setNewFilename] = useState('');
  const [newContent, setNewContent] = useState('');
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadHooks = async () => {
    try {
      const list = await window.api.hooks.list();
      setHooks(list);
    } catch {
      setHooks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHooks();
  }, []);

  const handleToggle = (filename: string) => {
    if (selected.includes(filename)) {
      onChange(selected.filter((f) => f !== filename));
    } else {
      onChange([...selected, filename]);
    }
  };

  const handleAddHook = async () => {
    setAddError('');
    const trimmedFilename = newFilename.trim();
    if (!trimmedFilename) {
      setAddError('Filename is required');
      return;
    }
    if (!trimmedFilename.includes('.')) {
      setAddError('Filename must include an extension (e.g. pre-tool-use.sh)');
      return;
    }
    if (!newContent.trim()) {
      setAddError('File content is required');
      return;
    }

    setSaving(true);
    try {
      await window.api.hooks.add(trimmedFilename, newContent);
      setNewFilename('');
      setNewContent('');
      setShowAddEditor(false);
      await loadHooks();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to save hook file');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Claude Hooks</div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Select hook files to inject into the container at{' '}
        <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">~/.claude/hooks</code>.
      </p>

      {loading ? (
        <p className="text-xs text-gray-500">Loading hooks…</p>
      ) : hooks.length === 0 && !showAddEditor ? (
        <p className="text-xs text-gray-500">
          No hook files available. Use &quot;+ Add Hook File&quot; to create one.
        </p>
      ) : (
        <div className="space-y-2 mb-3">
          {hooks.map((hook) => (
            <label key={hook.filename} className="flex items-start gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={selected.includes(hook.filename)}
                onChange={() => handleToggle(hook.filename)}
                className="mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="text-sm text-gray-800 dark:text-gray-200">{hook.filename}</span>
                {hook.description && (
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">— {hook.description}</span>
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      {/* Add Hook File */}
      {showAddEditor ? (
        <div className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded space-y-2">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Filename (with extension)</label>
            <input
              type="text"
              value={newFilename}
              onChange={(e) => setNewFilename(e.target.value)}
              placeholder="pre-tool-use.sh"
              className="w-full px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="hook-file-content" className="block text-xs text-gray-400 mb-1">
              File Content
            </label>
            <textarea
              id="hook-file-content"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder={'#!/bin/bash\n# Description: My custom hook\necho "Hook triggered"'}
              rows={6}
              className="w-full px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {addError && <p className="text-xs text-red-400">{addError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAddHook}
              disabled={saving}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Hook'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddEditor(false);
                setNewFilename('');
                setNewContent('');
                setAddError('');
              }}
              className="px-3 py-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
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
          + Add Hook File
        </button>
      )}
    </div>
  );
};
