import type { Pipeline } from '../../shared/pipeline-types';

/**
 * Convert a stage display name to a URL-safe slug suitable for use as a
 * {@link PipelineStage} id within a pipeline.
 *
 * @param name     - Human-readable stage name (e.g. "Rust Specialist").
 * @param existing - Current stage ids in the same pipeline; used to avoid
 *   collisions by appending a numeric suffix when needed.
 */
export function slugifyStageId(name: string, existing: string[] = []): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'stage';
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/**
 * Derive the existing stage ids for a pipeline, excluding the stage at a
 * given index (so renaming a stage doesn't collide with itself).
 */
export function existingStageIds(pipeline: Pipeline, excludeIndex?: number): string[] {
  return pipeline.stages
    .filter((_, i) => i !== excludeIndex)
    .map((s) => s.id);
}
