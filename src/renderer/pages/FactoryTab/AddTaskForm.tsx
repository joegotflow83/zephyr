/**
 * AddTaskForm — inline form for adding new tasks to the backlog.
 *
 * Renders a title input (required) and description textarea (optional)
 * with an "Add to Backlog" submit button. Clears fields on successful submit.
 */

import React, { useState } from 'react';

export interface AddTaskFormProps {
  onAdd: (title: string, description: string) => void;
}

export function AddTaskForm({ onAdd }: AddTaskFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    onAdd(trimmedTitle, description.trim());
    setTitle('');
    setDescription('');
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700">
      <div className="flex flex-col gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title (required)"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={2}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
        />
        <button
          type="submit"
          disabled={!title.trim()}
          className="self-start px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add to Backlog
        </button>
      </div>
    </form>
  );
}
