import React, { useState } from 'react';

interface SpecFilesSectionProps {
  specFiles: Record<string, string>;
  onChange: (specFiles: Record<string, string>) => void;
}

/**
 * Sub-component for managing project-specific spec files.
 * Spec files are written to a specs/ directory inside the container at /workspace/specs/.
 * They are optional and unique to each project.
 */
export const SpecFilesSection: React.FC<SpecFilesSectionProps> = ({ specFiles, onChange }) => {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [newFilename, setNewFilename] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAdd = () => {
    const filename = newFilename.trim();
    if (!filename) return;

    if (specFiles[filename]) {
      alert(`Spec file "${filename}" already exists`);
      return;
    }

    onChange({ ...specFiles, [filename]: '' });
    setEditingKey(filename);
    setEditingContent('');
    setNewFilename('');
    setShowAddForm(false);
  };

  const handleEdit = (filename: string) => {
    setEditingKey(filename);
    setEditingContent(specFiles[filename]);
  };

  const handleSave = () => {
    if (editingKey === null) return;
    onChange({ ...specFiles, [editingKey]: editingContent });
    setEditingKey(null);
    setEditingContent('');
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditingContent('');
  };

  const handleDelete = (filename: string) => {
    if (!confirm(`Delete spec file "${filename}"?`)) return;
    const updated = { ...specFiles };
    delete updated[filename];
    onChange(updated);
    if (editingKey === filename) {
      setEditingKey(null);
      setEditingContent('');
    }
  };

  return (
    <div className="border border-gray-200 dark:border-gray-600 rounded p-4 bg-gray-100 dark:bg-gray-800">
      {Object.keys(specFiles).length > 0 ? (
        <div className="space-y-2 mb-4">
          {Object.entries(specFiles).map(([filename, content]) => (
            <div key={filename} className="border border-gray-200 dark:border-gray-600 rounded p-3">
              {editingKey === filename ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white font-mono">
                      specs/{filename}
                    </span>
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
                        className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-700"
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
                    placeholder="Enter spec file content..."
                  />
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white font-mono">
                      specs/{filename}
                    </span>
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
                  <div className="text-xs text-gray-500 dark:text-gray-400 font-mono bg-gray-50 dark:bg-gray-900 p-2 rounded max-h-24 overflow-y-auto">
                    {content || <span className="italic">Empty spec file</span>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-gray-500 dark:text-gray-400 mb-4 text-center py-2">
          No spec files yet
        </div>
      )}

      {showAddForm ? (
        <div className="border border-gray-200 dark:border-gray-600 rounded p-3 bg-gray-50 dark:bg-gray-800">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            New Spec Filename
          </label>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center border border-gray-200 dark:border-gray-600 rounded bg-gray-100 dark:bg-gray-700 px-2 overflow-hidden">
              <span className="text-sm text-gray-400 dark:text-gray-500 shrink-0 select-none">specs/</span>
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
                className="flex-1 py-1 bg-transparent text-gray-900 dark:text-white text-sm focus:outline-none"
                placeholder="requirements.md"
                autoFocus
              />
            </div>
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
              className="px-3 py-1 bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-white text-sm rounded hover:bg-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            File will be available at <span className="font-mono">/workspace/specs/&lt;filename&gt;</span> in the container
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="w-full px-3 py-2 border border-dashed border-gray-200 dark:border-gray-600 rounded text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
        >
          + Add Spec File
        </button>
      )}
    </div>
  );
};
