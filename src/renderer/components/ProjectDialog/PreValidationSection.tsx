/**
 * PreValidationSection — checkbox list of pre-validation scripts for the
 * ProjectDialog.
 *
 * Displays all scripts from ~/.zephyr/pre_validation_scripts/ with checkboxes.
 * Selected script filenames are stored in ProjectConfig.pre_validation_scripts.
 * Also provides an "Add Custom Script" inline editor for user-authored scripts,
 * and Edit/Delete actions for custom (non-built-in) scripts.
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

  // Edit state
  const [editingFilename, setEditingFilename] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

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

  const handleEdit = async (filename: string) => {
    setShowAddEditor(false);
    setEditError('');
    try {
      const content = await window.api.preValidation.get(filename);
      setEditingFilename(filename);
      setEditingContent(content ?? '');
    } catch {
      setEditError('Failed to load script content');
    }
  };

  const handleSaveEdit = async () => {
    if (!editingFilename) return;
    setEditError('');
    setEditSaving(true);
    try {
      await window.api.preValidation.add(editingFilename, editingContent);
      setEditingFilename(null);
      setEditingContent('');
      await loadScripts();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save script');
    } finally {
      setEditSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingFilename(null);
    setEditingContent('');
    setEditError('');
  };

  const handleDelete = async (filename: string) => {
    if (!confirm(`Delete script "${filename}"?`)) return;
    try {
      await window.api.preValidation.remove(filename);
      if (selected.includes(filename)) {
        onChange(selected.filter((f) => f !== filename));
      }
      if (editingFilename === filename) {
        setEditingFilename(null);
        setEditingContent('');
      }
      await loadScripts();
    } catch {
      // Non-fatal
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
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pre-Validation Scripts</div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Select scripts to place at the root of the project local path (
        <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">/workspace</code> in the container).
        These run before git commits for validation.
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
            <div key={script.filename} className="group">
              {editingFilename === script.filename ? (
                // Inline edit mode
                <div className="p-3 bg-gray-100 dark:bg-gray-800 border border-blue-400 dark:border-blue-500 rounded space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {script.filename}
                      </span>
                      {script.isBuiltIn && (
                        <span className="text-xs text-blue-400">(built-in)</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={editSaving}
                        className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
                      >
                        {editSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    rows={8}
                    className="w-full px-2 py-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  {editError && <p className="text-xs text-red-400">{editError}</p>}
                </div>
              ) : (
                // View mode
                <div className="flex items-start gap-2">
                  <label className="flex items-start gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={selected.includes(script.filename)}
                      onChange={() => handleToggle(script.filename)}
                      className="mt-0.5 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <span className="text-sm text-gray-800 dark:text-gray-200">
                        {script.filename}
                      </span>
                      {script.description && (
                        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                          — {script.description}
                        </span>
                      )}
                      {script.isBuiltIn && (
                        <span className="ml-1 text-xs text-blue-400">(built-in)</span>
                      )}
                    </div>
                  </label>
                  <div className="flex gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handleEdit(script.filename)}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Edit
                    </button>
                    {!script.isBuiltIn && (
                      <button
                        type="button"
                        onClick={() => handleDelete(script.filename)}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Custom Script */}
      {showAddEditor ? (
        <div className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded space-y-2">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Filename (.sh)</label>
            <input
              type="text"
              value={newFilename}
              onChange={(e) => setNewFilename(e.target.value)}
              placeholder="my-check.sh"
              className="w-full px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              className="w-full px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              className="px-3 py-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditingFilename(null);
            setEditingContent('');
            setShowAddEditor(true);
          }}
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          + Add Custom Script
        </button>
      )}
    </div>
  );
};
