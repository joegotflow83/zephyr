import React, { useState } from 'react';
import type { Pipeline } from '../../../shared/pipeline-types';
import { useAppStore } from '../../stores/app-store';
import PipelineBuilderDialog from '../../components/PipelineBuilderDialog/PipelineBuilderDialog';

export const PipelineLibrarySection: React.FC = () => {
  const pipelines = useAppStore((s) => s.pipelines);
  const projects = useAppStore((s) => s.projects);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderPipeline, setBuilderPipeline] = useState<Pipeline | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Pipeline | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [cloningId, setCloningId] = useState<string | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);

  const builtIns = pipelines.filter((p) => p.builtIn);
  const userPipelines = pipelines.filter((p) => !p.builtIn);

  const openCreate = () => {
    setBuilderPipeline(null);
    setBuilderOpen(true);
  };

  const openEdit = (p: Pipeline) => {
    setBuilderPipeline(p);
    setBuilderOpen(true);
  };

  const handleClone = async (p: Pipeline) => {
    setCloningId(p.id);
    setCloneError(null);
    try {
      await window.api.pipelines.add({
        id: '',
        name: `${p.name} (copy)`,
        description: p.description,
        stages: p.stages,
        bounceLimit: p.bounceLimit,
        builtIn: false,
      });
    } catch (err: unknown) {
      setCloneError(err instanceof Error ? err.message : String(err));
    } finally {
      setCloningId(null);
    }
  };

  const openDeleteConfirm = (p: Pipeline) => {
    setDeleteTarget(p);
    setDeleteError(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await window.api.pipelines.remove(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  };

  const referenceCount = (p: Pipeline) =>
    projects.filter((proj) => proj.pipelineId === p.id).length;

  return (
    <div className="space-y-6">
      {cloneError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300">
          Clone failed: {cloneError}
        </div>
      )}

      {/* Built-in Templates */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
          Built-in Templates
        </h3>
        {builtIns.length === 0 ? (
          <p className="text-sm text-gray-400">No built-in templates available.</p>
        ) : (
          <div className="space-y-2">
            {builtIns.map((p) => (
              <PipelineRow
                key={p.id}
                pipeline={p}
                isCloning={cloningId === p.id}
                onClone={() => void handleClone(p)}
              />
            ))}
          </div>
        )}
      </div>

      {/* User Pipelines */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Your Pipelines
          </h3>
          <button
            onClick={openCreate}
            className="text-sm px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors font-medium"
          >
            + New Pipeline
          </button>
        </div>
        {userPipelines.length === 0 ? (
          <p className="text-sm text-gray-400">
            No custom pipelines yet — create one or clone a built-in template above.
          </p>
        ) : (
          <div className="space-y-2">
            {userPipelines.map((p) => (
              <PipelineRow
                key={p.id}
                pipeline={p}
                isCloning={cloningId === p.id}
                onClone={() => void handleClone(p)}
                onEdit={() => openEdit(p)}
                onDelete={() => openDeleteConfirm(p)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pipeline Builder Dialog */}
      <PipelineBuilderDialog
        isOpen={builderOpen}
        onClose={() => setBuilderOpen(false)}
        pipeline={builderPipeline}
      />

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-pipeline-title"
        >
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
            <h3
              id="delete-pipeline-title"
              className="text-lg font-semibold text-gray-900 dark:text-white mb-2"
            >
              Delete Pipeline
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Delete{' '}
              <span className="font-medium text-gray-900 dark:text-white">
                &ldquo;{deleteTarget.name}&rdquo;
              </span>
              ? This cannot be undone.
            </p>
            {referenceCount(deleteTarget) > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-sm text-yellow-800 dark:text-yellow-300">
                ⚠{' '}
                {referenceCount(deleteTarget)} project
                {referenceCount(deleteTarget) !== 1 ? 's' : ''} will have their factory
                disabled.
              </div>
            )}
            {deleteError && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300">
                {deleteError}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={isDeleting}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface PipelineRowProps {
  pipeline: Pipeline;
  isCloning: boolean;
  onClone: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

const PipelineRow: React.FC<PipelineRowProps> = ({
  pipeline,
  isCloning,
  onClone,
  onEdit,
  onDelete,
}) => {
  const stageCount = pipeline.stages.length;
  const previewStages = pipeline.stages.slice(0, 5);
  const extraCount = pipeline.stages.length - 5;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-white dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {pipeline.name}
          </span>
          {pipeline.builtIn && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-300 flex-shrink-0">
              built-in
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
          {stageCount} stage{stageCount !== 1 ? 's' : ''}
          {pipeline.description ? ` · ${pipeline.description}` : ''}
        </p>
      </div>

      {/* Stage icon preview */}
      <div className="flex items-center gap-0.5 flex-shrink-0" aria-label="Stage icons">
        {previewStages.map((s) => (
          <span key={s.id} title={s.name} className="text-sm leading-none" aria-hidden="true">
            {s.icon ?? '▪'}
          </span>
        ))}
        {extraCount > 0 && (
          <span className="text-xs text-gray-400 ml-0.5">+{extraCount}</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {onEdit && (
          <button
            onClick={onEdit}
            className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Edit
          </button>
        )}
        <button
          onClick={onClone}
          disabled={isCloning}
          className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          {isCloning ? 'Cloning…' : 'Clone'}
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            className="text-xs px-2.5 py-1.5 rounded-md border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
};
