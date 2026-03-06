/**
 * LoopScriptsSection — radio list of loop scripts for the ProjectDialog.
 *
 * Displays all loop scripts from ~/.zephyr/loop_scripts/ with radio buttons.
 * Only one script can be selected per project (stored in ProjectConfig.loop_script).
 * Also provides an "Add Loop Script" inline editor for user-authored scripts,
 * and Edit/Delete actions for existing scripts.
 *
 * The selected loop script filename is used as the container command when the
 * loop runs.
 */

import React, { useState, useEffect } from 'react';

interface LoopScript {
  filename: string;
  name: string;
  description: string;
}

interface LoopScriptsSectionProps {
  /** Currently selected loop script filename (or undefined for none) */
  selected: string | undefined;
  /** Callback when selection changes */
  onChange: (selected: string | undefined) => void;
}

/**
 * Renders a radio list of loop scripts with single-selection enforcement.
 * Loads available scripts from the main process via IPC on mount.
 */
export const LoopScriptsSection: React.FC<LoopScriptsSectionProps> = ({ selected, onChange }) => {
  const [scripts, setScripts] = useState<LoopScript[]>([]);
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
      const list = await window.api.loopScripts.list();
      setScripts(list);
    } catch {
      setScripts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadScripts();
  }, []);

  const handleSelect = (filename: string) => {
    // Clicking the already-selected script deselects it
    if (selected === filename) {
      onChange(undefined);
    } else {
      onChange(filename);
    }
  };

  const handleEdit = async (filename: string) => {
    setShowAddEditor(false);
    setEditError('');
    try {
      const content = await window.api.loopScripts.get(filename);
      setEditingFilename(filename);
      setEditingContent(content ?? '');
    } catch {
      setEditError('Failed to load loop script content');
    }
  };

  const handleSaveEdit = async () => {
    if (!editingFilename) return;
    setEditError('');
    setEditSaving(true);
    try {
      await window.api.loopScripts.add(editingFilename, editingContent);
      setEditingFilename(null);
      setEditingContent('');
      await loadScripts();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save loop script');
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
    if (!confirm(`Delete loop script "${filename}"?`)) return;
    try {
      await window.api.loopScripts.remove(filename);
      if (selected === filename) {
        onChange(undefined);
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

  const handleAddScript = async () => {
    setAddError('');
    const trimmedFilename = newFilename.trim();
    if (!trimmedFilename) {
      setAddError('Filename is required');
      return;
    }
    if (!trimmedFilename.includes('.')) {
      setAddError('Filename must include an extension (e.g. my-loop.sh)');
      return;
    }
    if (!newContent.trim()) {
      setAddError('File content is required');
      return;
    }

    setSaving(true);
    try {
      await window.api.loopScripts.add(trimmedFilename, newContent);
      setNewFilename('');
      setNewContent('');
      setShowAddEditor(false);
      await loadScripts();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to save loop script');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Loop Script</div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Select the script to run as the main command inside the container. Only one script can be
        active per project.
      </p>

      {loading ? (
        <p className="text-xs text-gray-500">Loading loop scripts…</p>
      ) : scripts.length === 0 && !showAddEditor ? (
        <p className="text-xs text-gray-500">
          No loop scripts available. Use &quot;+ Add Loop Script&quot; to create one.
        </p>
      ) : (
        <div className="space-y-2 mb-3">
          {scripts.map((script) => (
            <div key={script.filename} className="group">
              {editingFilename === script.filename ? (
                // Inline edit mode
                <div className="p-3 bg-gray-100 dark:bg-gray-800 border border-blue-400 dark:border-blue-500 rounded space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {script.filename}
                    </span>
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
                // View mode with radio button
                <div className="flex items-start gap-2">
                  <label className="flex items-start gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="radio"
                      name="loop-script"
                      checked={selected === script.filename}
                      onChange={() => handleSelect(script.filename)}
                      onClick={() => {
                        // Allow deselection by clicking the already-selected radio
                        if (selected === script.filename) {
                          onChange(undefined);
                        }
                      }}
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
                    <button
                      type="button"
                      onClick={() => handleDelete(script.filename)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Loop Script */}
      {showAddEditor ? (
        <div className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded space-y-2">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Filename (with extension)</label>
            <input
              type="text"
              value={newFilename}
              onChange={(e) => setNewFilename(e.target.value)}
              placeholder="my-loop.sh"
              className="w-full px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="loop-script-content" className="block text-xs text-gray-400 mb-1">
              File Content
            </label>
            <textarea
              id="loop-script-content"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder={'#!/bin/bash\n# Description: My custom loop\necho "Running loop..."'}
              rows={6}
              className="w-full px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {addError && <p className="text-xs text-red-400">{addError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAddScript}
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
          + Add Loop Script
        </button>
      )}
    </div>
  );
};
