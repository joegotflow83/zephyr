import React, { useState } from 'react';

interface PromptEditorProps {
  prompts: Record<string, string>;
  onChange: (prompts: Record<string, string>) => void;
}

/**
 * Sub-component for managing custom prompt files.
 * Allows adding, editing, and deleting custom prompt files for a project.
 */
export const PromptEditor: React.FC<PromptEditorProps> = ({ prompts, onChange }) => {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [newFilename, setNewFilename] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Handle adding a new prompt file
  const handleAdd = () => {
    if (!newFilename.trim()) return;

    const filename = newFilename.trim();
    // Ensure .md extension
    const finalFilename = filename.endsWith('.md') ? filename : `${filename}.md`;

    if (prompts[finalFilename]) {
      alert(`Prompt file "${finalFilename}" already exists`);
      return;
    }

    onChange({
      ...prompts,
      [finalFilename]: '',
    });

    // Start editing the new file
    setEditingKey(finalFilename);
    setEditingContent('');
    setNewFilename('');
    setShowAddForm(false);
  };

  // Handle editing an existing prompt
  const handleEdit = (filename: string) => {
    setEditingKey(filename);
    setEditingContent(prompts[filename]);
  };

  // Handle saving edited prompt
  const handleSave = () => {
    if (editingKey === null) return;

    onChange({
      ...prompts,
      [editingKey]: editingContent,
    });

    setEditingKey(null);
    setEditingContent('');
  };

  // Handle canceling edit
  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditingContent('');
  };

  // Handle deleting a prompt
  const handleDelete = (filename: string) => {
    if (!confirm(`Delete prompt file "${filename}"?`)) return;

    const newPrompts = { ...prompts };
    delete newPrompts[filename];
    onChange(newPrompts);

    // Cancel edit if deleting the currently edited file
    if (editingKey === filename) {
      setEditingKey(null);
      setEditingContent('');
    }
  };

  return (
    <div className="border border-gray-600 rounded p-4 bg-gray-750">
      {/* List of existing prompts */}
      {Object.keys(prompts).length > 0 ? (
        <div className="space-y-2 mb-4">
          {Object.entries(prompts).map(([filename, content]) => (
            <div key={filename} className="border border-gray-600 rounded p-3">
              {editingKey === filename ? (
                // Edit mode
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-white">{filename}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSave}
                        className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="text-xs px-2 py-1 bg-gray-600 text-white rounded hover:bg-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    rows={8}
                    className="w-full px-2 py-1 bg-gray-900 border border-gray-600 rounded text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="Enter prompt content..."
                  />
                </div>
              ) : (
                // View mode
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-white">{filename}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(filename)}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(filename)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 font-mono bg-gray-900 p-2 rounded max-h-24 overflow-y-auto">
                    {content || <span className="italic">Empty prompt</span>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-gray-400 mb-4 text-center py-2">
          No custom prompts yet
        </div>
      )}

      {/* Add new prompt form */}
      {showAddForm ? (
        <div className="border border-gray-600 rounded p-3 bg-gray-800">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            New Prompt Filename
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newFilename}
              onChange={(e) => setNewFilename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                } else if (e.key === 'Escape') {
                  setShowAddForm(false);
                  setNewFilename('');
                }
              }}
              className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="custom-prompt.md"
              autoFocus
            />
            <button
              type="button"
              onClick={handleAdd}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setNewFilename('');
              }}
              className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Enter a filename (will add .md extension if missing)
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="w-full px-3 py-2 border border-dashed border-gray-600 rounded text-sm text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
        >
          + Add New Prompt File
        </button>
      )}
    </div>
  );
};
