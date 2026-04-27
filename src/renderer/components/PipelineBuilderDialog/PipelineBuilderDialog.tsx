import React, { useState, useEffect, useCallback } from 'react';
import type { Pipeline, PipelineStage } from '../../../shared/pipeline-types';
import { columnsFor } from '../../../shared/pipeline-types';
import { slugifyStageId } from '../../../lib/pipeline/slugify';
import { PIPELINE_BUILDER_STARTER_PROMPTS } from '../../../shared/pipeline-builtins';

export interface PipelineBuilderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Existing pipeline to edit; `null`/`undefined` opens the builder for creating a new pipeline. */
  pipeline?: Pipeline | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStage(name: string, existingIds: string[]): PipelineStage {
  return {
    id: slugifyStageId(name, existingIds),
    name,
    agentPrompt: '',
    instances: 1,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StageCardProps {
  stage: PipelineStage;
  index: number;
  isSelected: boolean;
  isFirst: boolean;
  isLast: boolean;
  isReadOnly: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<PipelineStage>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const StageCard: React.FC<StageCardProps> = ({
  stage,
  isSelected,
  isFirst,
  isLast,
  isReadOnly,
  onSelect,
  onChange,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
}) => {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Stage: ${stage.name}`}
      className={`mx-2 mb-2 rounded-lg border transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-purple-500 ${
        isSelected
          ? 'border-purple-500 bg-purple-500/10'
          : 'border-white/10 bg-white/5 hover:bg-white/10'
      }`}
      style={stage.color ? { borderTopColor: stage.color, borderTopWidth: 3 } : undefined}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
    >
      <div className="px-3 py-2">
        {/* Name row */}
        <div className="flex items-center gap-1.5 mb-2">
          {stage.icon && (
            <span aria-hidden="true" className="text-base leading-none">
              {stage.icon}
            </span>
          )}
          <input
            type="text"
            value={stage.name}
            onChange={(e) => onChange({ name: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            disabled={isReadOnly}
            placeholder="Stage name"
            aria-label="Stage name"
            className="flex-1 min-w-0 bg-transparent text-white text-sm focus:outline-none border-b border-transparent focus:border-white/30 placeholder:text-white/30 disabled:opacity-50"
          />
        </div>

        {/* Controls row: icon, color, instances */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={stage.icon ?? ''}
            onChange={(e) => onChange({ icon: e.target.value || undefined })}
            onClick={(e) => e.stopPropagation()}
            disabled={isReadOnly}
            placeholder="🔧"
            aria-label="Stage icon (emoji)"
            title="Icon (emoji)"
            className="w-10 bg-white/5 border border-white/10 rounded px-1 py-0.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
          />
          <input
            type="color"
            value={stage.color ?? '#6b7280'}
            onChange={(e) => onChange({ color: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            disabled={isReadOnly}
            aria-label="Stage color"
            title="Stage accent color"
            className="w-7 h-7 rounded cursor-pointer border border-white/10 bg-transparent p-0.5 disabled:opacity-50"
          />
          <select
            value={stage.instances}
            onChange={(e) => onChange({ instances: Number(e.target.value) })}
            onClick={(e) => e.stopPropagation()}
            disabled={isReadOnly}
            aria-label="Parallel instances"
            title="Parallel worker instances"
            className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded px-1 py-0.5 text-white text-xs focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </div>

        {/* Reorder / CRUD actions */}
        {!isReadOnly && (
          <div className="flex items-center gap-0.5 mt-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp();
              }}
              disabled={isFirst}
              aria-label="Move stage up"
              title="Move up"
              className="text-white/40 hover:text-white disabled:opacity-20 text-xs px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
            >
              ↑
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown();
              }}
              disabled={isLast}
              aria-label="Move stage down"
              title="Move down"
              className="text-white/40 hover:text-white disabled:opacity-20 text-xs px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
            >
              ↓
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              aria-label="Duplicate stage"
              title="Duplicate stage"
              className="text-white/40 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
            >
              ⧉
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Delete stage"
              title="Delete stage"
              className="text-red-400/60 hover:text-red-400 text-xs px-1.5 py-0.5 rounded hover:bg-red-900/20 transition-colors ml-auto"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Column preview
// ---------------------------------------------------------------------------

interface ColumnPreviewProps {
  stages: PipelineStage[];
}

const ColumnPreview: React.FC<ColumnPreviewProps> = ({ stages }) => {
  const dummyPipeline: Pipeline = {
    id: '',
    name: '',
    stages,
    bounceLimit: 3,
    createdAt: '',
    updatedAt: '',
  };
  const columns = columnsFor(dummyPipeline);

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      <span className="text-white/40 text-xs mr-1 whitespace-nowrap shrink-0">Preview:</span>
      {columns.map((col, i) => {
        const stage = stages.find((s) => s.id === col);
        const isBlocked = col === 'blocked';
        const isImplicit = ['backlog', 'done', 'blocked'].includes(col);
        const label = stage?.name ?? col.charAt(0).toUpperCase() + col.slice(1);
        return (
          <React.Fragment key={col}>
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap shrink-0 border ${
                isBlocked
                  ? 'bg-red-900/30 text-red-400 border-red-500/30'
                  : isImplicit
                    ? 'bg-white/5 text-white/50 border-white/10'
                    : 'bg-purple-900/30 text-purple-300 border-purple-500/30'
              }`}
              style={
                stage?.color
                  ? { borderTopColor: stage.color, borderTopWidth: 2 }
                  : undefined
              }
            >
              {stage?.icon && <span aria-hidden="true">{stage.icon}</span>}
              <span>{label}</span>
            </div>
            {i < columns.length - 1 && (
              <span className="text-white/20 text-xs shrink-0">→</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Delete confirm modal
// ---------------------------------------------------------------------------

interface DeleteConfirmProps {
  stageName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteConfirm: React.FC<DeleteConfirmProps> = ({ stageName, onConfirm, onCancel }) => (
  <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10 rounded-xl">
    <div className="bg-[#1a1a2e] border border-white/10 rounded-xl p-6 shadow-2xl max-w-sm mx-4">
      <p className="text-white mb-1 font-medium">Delete stage?</p>
      <p className="text-white/60 text-sm mb-5">
        &ldquo;{stageName}&rdquo; has a prompt that will be permanently lost.
      </p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          aria-label="Cancel delete"
          className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          aria-label="Confirm delete"
          className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

const PipelineBuilderDialog: React.FC<PipelineBuilderDialogProps> = ({
  isOpen,
  onClose,
  pipeline,
}) => {
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftBounceLimit, setDraftBounceLimit] = useState(3);
  const [draftStages, setDraftStages] = useState<PipelineStage[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmIndex, setDeleteConfirmIndex] = useState<number | null>(null);

  // Reset draft when dialog opens or pipeline changes
  useEffect(() => {
    if (!isOpen) return;
    if (pipeline) {
      setDraftName(pipeline.name);
      setDraftDescription(pipeline.description ?? '');
      setDraftBounceLimit(pipeline.bounceLimit);
      setDraftStages(pipeline.stages.map((s) => ({ ...s })));
    } else {
      setDraftName('');
      setDraftDescription('');
      setDraftBounceLimit(3);
      setDraftStages([makeStage('Stage 1', [])]);
    }
    setSelectedIndex(0);
    setError(null);
    setDeleteConfirmIndex(null);
    setIsSaving(false);
  }, [isOpen, pipeline]);

  const selectedStage = draftStages[selectedIndex] ?? draftStages[0] ?? null;
  const isBuiltIn = pipeline?.builtIn ?? false;
  const isNew = !pipeline;
  const isReadOnly = isBuiltIn;

  // ------------------------------------------------------------------
  // Stage mutations
  // ------------------------------------------------------------------

  const updateStage = useCallback((index: number, patch: Partial<PipelineStage>) => {
    setDraftStages((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        const updated = { ...s, ...patch };
        // Re-slug when name changes, avoiding id collisions with other stages
        if ('name' in patch) {
          const otherIds = prev.filter((_, j) => j !== index).map((x) => x.id);
          updated.id = slugifyStageId(patch.name ?? '', otherIds);
        }
        return updated;
      }),
    );
  }, []);

  const addStage = useCallback(() => {
    setDraftStages((prev) => {
      const name = `Stage ${prev.length + 1}`;
      const existingIds = prev.map((s) => s.id);
      const stage = makeStage(name, existingIds);
      setSelectedIndex(prev.length);
      return [...prev, stage];
    });
  }, []);

  const duplicateStage = useCallback(
    (index: number) => {
      setDraftStages((prev) => {
        const source = prev[index];
        const existingIds = prev.map((s) => s.id);
        const stage: PipelineStage = {
          ...source,
          id: slugifyStageId(source.name, existingIds),
          name: `${source.name} (copy)`,
        };
        const next = [
          ...prev.slice(0, index + 1),
          stage,
          ...prev.slice(index + 1),
        ];
        setSelectedIndex(index + 1);
        return next;
      });
    },
    [],
  );

  const requestDelete = useCallback(
    (index: number) => {
      if (draftStages.length <= 1) return; // must have at least one stage
      if (draftStages[index].agentPrompt.trim()) {
        setDeleteConfirmIndex(index);
      } else {
        doDelete(index);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftStages],
  );

  const doDelete = useCallback((index: number) => {
    setDraftStages((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setSelectedIndex((si) => Math.min(Math.max(0, si >= index ? si - 1 : si), next.length - 1));
      return next;
    });
    setDeleteConfirmIndex(null);
  }, []);

  const moveUp = useCallback((index: number) => {
    if (index === 0) return;
    setDraftStages((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
    setSelectedIndex(index - 1);
  }, []);

  const moveDown = useCallback((index: number) => {
    setDraftStages((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
    setSelectedIndex((si) => si + 1);
  }, []);

  // ------------------------------------------------------------------
  // Save
  // ------------------------------------------------------------------

  const validate = (): string | null => {
    if (!draftName.trim()) return 'Pipeline name is required.';
    if (draftStages.length === 0) return 'At least one stage is required.';
    for (const stage of draftStages) {
      if (!stage.name.trim()) return 'All stages must have a name.';
    }
    const ids = draftStages.map((s) => s.id);
    if (new Set(ids).size !== ids.length)
      return 'Duplicate stage names detected — rename conflicting stages.';
    if (draftBounceLimit < 1 || draftBounceLimit > 10)
      return 'Bounce limit must be between 1 and 10.';
    return null;
  };

  const buildInput = () => ({
    id: '',
    name: draftName.trim(),
    description: draftDescription.trim() || undefined,
    stages: draftStages.map((s) => ({ ...s })),
    bounceLimit: draftBounceLimit,
    builtIn: false as const,
  });

  const handleSave = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      if (pipeline && !pipeline.builtIn) {
        await window.api.pipelines.update(pipeline.id, {
          name: draftName.trim(),
          description: draftDescription.trim() || undefined,
          stages: draftStages.map((s) => ({ ...s })),
          bounceLimit: draftBounceLimit,
        });
      } else {
        await window.api.pipelines.add(buildInput());
      }
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAsNew = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await window.api.pipelines.add(buildInput());
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setIsSaving(false);
    }
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label="Pipeline Builder"
    >
      <div className="relative bg-[#1a1a2e] border border-white/10 rounded-xl shadow-2xl w-[960px] max-w-[95vw] h-[680px] max-h-[92vh] flex flex-col">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <h2 className="text-white font-semibold text-lg">
            {isNew
              ? 'New Pipeline'
              : isBuiltIn
                ? `${pipeline!.name} (read-only)`
                : `Edit Pipeline`}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-white/50 hover:text-white transition-colors text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* ── Metadata row ── */}
        <div className="flex items-center gap-4 px-6 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <label className="text-white/60 text-sm whitespace-nowrap shrink-0">Name</label>
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              disabled={isReadOnly}
              placeholder="My Pipeline"
              aria-label="Pipeline name"
              className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label className="text-white/60 text-sm whitespace-nowrap">Bounce limit</label>
            <select
              value={draftBounceLimit}
              onChange={(e) => setDraftBounceLimit(Number(e.target.value))}
              disabled={isReadOnly}
              aria-label="Bounce limit"
              className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Main body: stage list + prompt editor ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: stage list */}
          <div className="w-64 shrink-0 border-r border-white/10 flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 shrink-0">
              <span className="text-white/60 text-xs font-semibold uppercase tracking-wide">
                Stages
              </span>
              {!isReadOnly && (
                <button
                  onClick={addStage}
                  aria-label="Add stage"
                  className="text-xs bg-purple-600 hover:bg-purple-500 text-white rounded px-2 py-0.5 transition-colors"
                >
                  + Add
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {draftStages.map((stage, i) => (
                <StageCard
                  key={`${stage.id}-${i}`}
                  stage={stage}
                  index={i}
                  isSelected={i === selectedIndex}
                  isFirst={i === 0}
                  isLast={i === draftStages.length - 1}
                  isReadOnly={isReadOnly}
                  onSelect={() => setSelectedIndex(i)}
                  onChange={(patch) => updateStage(i, patch)}
                  onMoveUp={() => moveUp(i)}
                  onMoveDown={() => moveDown(i)}
                  onDuplicate={() => duplicateStage(i)}
                  onDelete={() => requestDelete(i)}
                />
              ))}
            </div>
          </div>

          {/* Right: prompt editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-2 border-b border-white/10 shrink-0 flex items-center justify-between gap-3">
              <span className="text-white/60 text-xs font-semibold uppercase tracking-wide shrink-0">
                {selectedStage ? `Prompt — ${selectedStage.name}` : 'Prompt Editor'}
              </span>
              {!isReadOnly && selectedStage && (
                <select
                  value=""
                  onChange={(e) => {
                    const idx = parseInt(e.target.value, 10);
                    if (!isNaN(idx)) {
                      updateStage(selectedIndex, {
                        agentPrompt: PIPELINE_BUILDER_STARTER_PROMPTS[idx].prompt,
                      });
                    }
                  }}
                  aria-label="Insert starter prompt"
                  className="text-xs bg-white/10 hover:bg-white/20 text-white/80 rounded px-2 py-1 border border-white/20 cursor-pointer"
                >
                  <option value="" disabled>
                    Insert starter…
                  </option>
                  {PIPELINE_BUILDER_STARTER_PROMPTS.map(({ label }, idx) => (
                    <option key={label} value={String(idx)} className="bg-gray-800 text-white">
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <textarea
              value={selectedStage?.agentPrompt ?? ''}
              onChange={(e) =>
                selectedStage &&
                updateStage(selectedIndex, { agentPrompt: e.target.value })
              }
              disabled={isReadOnly || !selectedStage}
              placeholder={
                isReadOnly
                  ? 'Built-in pipelines are read-only. Clone to edit.'
                  : 'Enter the agent system prompt for this stage…'
              }
              aria-label="Agent prompt editor"
              className="flex-1 bg-transparent text-white/90 text-sm font-mono p-4 resize-none focus:outline-none placeholder:text-white/20 disabled:opacity-40"
            />
          </div>
        </div>

        {/* ── Column preview ── */}
        <div className="border-t border-white/10 px-6 py-3 shrink-0">
          <ColumnPreview stages={draftStages} />
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 shrink-0">
          <div className="text-red-400 text-sm min-h-[1.25rem]">{error ?? ''}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
            >
              Cancel
            </button>
            {!isBuiltIn && !isNew && (
              <button
                onClick={handleSaveAsNew}
                disabled={isSaving}
                aria-label="Save as new pipeline"
                className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                Save as New
              </button>
            )}
            {!isBuiltIn && (
              <button
                onClick={isNew ? handleSaveAsNew : handleSave}
                disabled={isSaving}
                aria-label={isNew ? 'Create pipeline' : 'Save changes'}
                className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isSaving ? 'Saving…' : isNew ? 'Create Pipeline' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>

        {/* ── Delete confirm overlay ── */}
        {deleteConfirmIndex !== null && (
          <DeleteConfirm
            stageName={draftStages[deleteConfirmIndex]?.name ?? ''}
            onConfirm={() => doDelete(deleteConfirmIndex)}
            onCancel={() => setDeleteConfirmIndex(null)}
          />
        )}
      </div>
    </div>
  );
};

export default PipelineBuilderDialog;
