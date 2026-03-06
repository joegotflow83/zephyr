/**
 * ClaudeSettingsSection — radio list of Claude settings.json files for the ProjectDialog.
 *
 * Displays all settings files from ~/.zephyr/claude_settings/ with radio buttons.
 * Only one file can be selected per project (stored in ProjectConfig.claude_settings_file).
 * Also provides an "Add Settings File" inline editor for user-authored files,
 * and Edit/Delete actions for existing files.
 *
 * The selected file's content is injected into containers at ~/.claude/settings.json
 * so the Claude agent uses the configured settings during execution.
 */

import React, { useState, useEffect } from 'react';

interface SettingsFile {
  filename: string;
  name: string;
  description: string;
}

interface ClaudeSettingsSectionProps {
  /** Currently selected settings filename (or undefined for none) */
  selected: string | undefined;
  /** Callback when selection changes */
  onChange: (selected: string | undefined) => void;
}

/**
 * Renders a radio list of Claude settings files with single-selection enforcement.
 * Loads available files from the main process via IPC on mount.
 */
export const ClaudeSettingsSection: React.FC<ClaudeSettingsSectionProps> = ({ selected, onChange }) => {
  const [files, setFiles] = useState<SettingsFile[]>([]);
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

  const loadFiles = async () => {
    try {
      const list = await window.api.claudeSettings.list();
      setFiles(list);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);

  const handleSelect = (filename: string) => {
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
      const content = await window.api.claudeSettings.get(filename);
      setEditingFilename(filename);
      setEditingContent(content ?? '');
    } catch {
      setEditError('Failed to load settings file content');
    }
  };

  const handleSaveEdit = async () => {
    if (!editingFilename) return;
    setEditError('');
    setEditSaving(true);
    try {
      await window.api.claudeSettings.add(editingFilename, editingContent);
      setEditingFilename(null);
      setEditingContent('');
      await loadFiles();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save settings file');
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
    if (!confirm(`Delete settings file "${filename}"?`)) return;
    try {
      await window.api.claudeSettings.remove(filename);
      if (selected === filename) {
        onChange(undefined);
      }
      if (editingFilename === filename) {
        setEditingFilename(null);
        setEditingContent('');
      }
      await loadFiles();
    } catch {
      // Non-fatal
    }
  };

  const handleAddFile = async () => {
    setAddError('');
    const trimmedFilename = newFilename.trim();
    if (!trimmedFilename) {
      setAddError('Filename is required');
      return;
    }
    if (!trimmedFilename.includes('.')) {
      setAddError('Filename must include an extension (e.g. permissive.json)');
      return;
    }
    if (!newContent.trim()) {
      setAddError('File content is required');
      return;
    }

    setSaving(true);
    try {
      await window.api.claudeSettings.add(trimmedFilename, newContent);
      setNewFilename('');
      setNewContent('');
      setShowAddEditor(false);
      await loadFiles();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to save settings file');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Claude Settings</div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Select a settings file to inject into the container at{' '}
        <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">~/.claude/settings.json</code>.
        Only one file can be active per project.
      </p>

      {loading ? (
        <p className="text-xs text-gray-500">Loading settings files…</p>
      ) : files.length === 0 && !showAddEditor ? (
        <p className="text-xs text-gray-500">
          No settings files available. Use &quot;+ Add Settings File&quot; to create one.
        </p>
      ) : (
        <div className="space-y-2 mb-3">
          {files.map((file) => (
            <div key={file.filename} className="group">
              {editingFilename === file.filename ? (
                // Inline edit mode
                <div className="p-3 bg-gray-100 dark:bg-gray-800 border border-blue-400 dark:border-blue-500 rounded space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {file.filename}
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
                      name="claude-settings-file"
                      checked={selected === file.filename}
                      onChange={() => handleSelect(file.filename)}
                      onClick={() => {
                        // Allow deselection by clicking the already-selected radio
                        if (selected === file.filename) {
                          onChange(undefined);
                        }
                      }}
                      className="mt-0.5 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <span className="text-sm text-gray-800 dark:text-gray-200">
                        {file.filename}
                      </span>
                      {file.description && (
                        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                          — {file.description}
                        </span>
                      )}
                    </div>
                  </label>
                  <div className="flex gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handleEdit(file.filename)}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(file.filename)}
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

      {/* Add Settings File */}
      {showAddEditor ? (
        <div className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded space-y-2">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Filename (with extension)</label>
            <input
              type="text"
              value={newFilename}
              onChange={(e) => setNewFilename(e.target.value)}
              placeholder="permissive.json"
              className="w-full px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="claude-settings-content" className="block text-xs text-gray-400 mb-1">
              File Content (JSON)
            </label>
            <textarea
              id="claude-settings-content"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder={'{\n  "permissions": {\n    "allow": ["Bash", "Read", "Write"]\n  }\n}'}
              rows={6}
              className="w-full px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {addError && <p className="text-xs text-red-400">{addError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAddFile}
              disabled={saving}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Settings File'}
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
          + Add Settings File
        </button>
      )}
    </div>
  );
};
