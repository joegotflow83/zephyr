/**
 * PipelineStore — persistent storage for pipeline templates.
 *
 * All pipelines live in a single JSON file at `~/.zephyr/pipelines.json`.
 * Built-in templates from `pipeline-builtins.ts` are seeded on first load
 * and upserted on every subsequent load so shipping a new app version with
 * updated built-ins (e.g. Phase 6 prompt replacements) automatically refreshes
 * them for existing users. User pipelines are never touched by the upsert.
 *
 * Atomic writes mirror the FactoryTaskStore / ConfigManager pattern: serialise
 * to a `.tmp` file first, then atomically rename over the destination to avoid
 * partial-write corruption if the app is killed mid-write.
 *
 * The store is deliberately stateless (no in-memory cache): every read hits
 * disk. The file is tiny (a handful of pipelines) and the handful of IPC
 * callers per second the UI generates makes caching premature. IPC handlers
 * (Phase 1.9) broadcast `PIPELINE_CHANGED` after every mutation so renderers
 * invalidate their own caches.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import { BUILTIN_PIPELINES } from '../shared/pipeline-builtins';
import type { Pipeline } from '../shared/pipeline-types';

const DEFAULT_BASE_PATH = path.join(os.homedir(), '.zephyr');
const FILE_NAME = 'pipelines.json';

/** On-disk envelope. Versioned so future migrations have a bump point. */
interface PipelinesFile {
  version: 1;
  pipelines: Pipeline[];
}

const CURRENT_VERSION = 1 as const;

export class PipelineStore {
  private readonly basePath: string;

  /**
   * @param basePath - Directory that holds `pipelines.json`. Defaults to
   *   `~/.zephyr/`. Tests pass a temp dir for isolation.
   */
  constructor(basePath?: string) {
    this.basePath = basePath ?? DEFAULT_BASE_PATH;
    fs.mkdirSync(this.basePath, { recursive: true });
  }

  private filePath(): string {
    return path.join(this.basePath, FILE_NAME);
  }

  /**
   * Return every pipeline (built-in + user) in stable order: built-ins first
   * (in {@link BUILTIN_PIPELINES} order), then user pipelines in insertion
   * order. Read the file, upsert built-ins, persist only if the on-disk set
   * actually changed so read-only callers don't rewrite the file needlessly.
   */
  listPipelines(): Pipeline[] {
    const { pipelines, mutated } = this.loadAndReconcile();
    if (mutated) {
      this.writeFile(pipelines);
    }
    return pipelines.map(clonePipeline);
  }

  /** Return a pipeline by id, or `null` if not found. */
  getPipeline(id: string): Pipeline | null {
    const match = this.listPipelines().find((p) => p.id === id);
    return match ?? null;
  }

  /**
   * Add a new user pipeline.
   *
   * - `builtIn` on input is ignored; the persisted pipeline is always
   *   `builtIn: false`. (Users cannot inject shadow built-ins.)
   * - If `id` is omitted or empty, a UUID is generated.
   * - Throws if the id collides with an existing pipeline (including a
   *   built-in — their reserved ids belong to the templates).
   * - `createdAt` / `updatedAt` are stamped with the current ISO timestamp;
   *   any values on the input are overwritten.
   *
   * @returns The stored pipeline (with generated id/timestamps applied).
   */
  addPipeline(input: Omit<Pipeline, 'createdAt' | 'updatedAt'> & Partial<Pick<Pipeline, 'createdAt' | 'updatedAt'>>): Pipeline {
    const { pipelines } = this.loadAndReconcile();
    const id = input.id && input.id.trim().length > 0 ? input.id : randomUUID();
    if (pipelines.some((p) => p.id === id)) {
      throw new Error(`[PipelineStore] Pipeline id already exists: ${id}`);
    }
    const now = new Date().toISOString();
    const pipeline: Pipeline = {
      id,
      name: input.name,
      description: input.description,
      stages: input.stages.map(cloneStage),
      bounceLimit: input.bounceLimit,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };
    pipelines.push(pipeline);
    this.writeFile(pipelines);
    return clonePipeline(pipeline);
  }

  /**
   * Patch a user pipeline in place.
   *
   * - Throws if the id is unknown.
   * - Throws if the pipeline is built-in (templates are read-only; clone them
   *   first).
   * - `id`, `builtIn`, and `createdAt` are protected from the patch; they are
   *   only settable via {@link addPipeline}.
   * - `updatedAt` is always refreshed to now.
   *
   * @returns The updated pipeline.
   */
  updatePipeline(id: string, patch: Partial<Pipeline>): Pipeline {
    const { pipelines } = this.loadAndReconcile();
    const idx = pipelines.findIndex((p) => p.id === id);
    if (idx === -1) {
      throw new Error(`[PipelineStore] Pipeline not found: ${id}`);
    }
    const existing = pipelines[idx];
    if (existing.builtIn) {
      throw new Error(
        `[PipelineStore] Cannot edit built-in pipeline '${id}'. Clone it first.`,
      );
    }
    const merged: Pipeline = {
      ...existing,
      ...patch,
      // Protected fields — never taken from the patch.
      id: existing.id,
      builtIn: false,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      // Deep-copy stages if they were patched so callers can't mutate the
      // persisted array after the call.
      stages: (patch.stages ?? existing.stages).map(cloneStage),
    };
    pipelines[idx] = merged;
    this.writeFile(pipelines);
    return clonePipeline(merged);
  }

  /**
   * Delete a user pipeline.
   *
   * - Throws if the id is unknown (surface-friendly for UI error toasts).
   * - Throws if the pipeline is built-in. Built-ins can only be removed by
   *   shipping a new app version without them.
   *
   * Projects referencing the deleted pipeline are NOT rewritten here; the
   * renderer handles dangling `pipelineId` values (Phase 5.5).
   */
  removePipeline(id: string): void {
    const { pipelines } = this.loadAndReconcile();
    const idx = pipelines.findIndex((p) => p.id === id);
    if (idx === -1) {
      throw new Error(`[PipelineStore] Pipeline not found: ${id}`);
    }
    if (pipelines[idx].builtIn) {
      throw new Error(
        `[PipelineStore] Cannot delete built-in pipeline '${id}'.`,
      );
    }
    pipelines.splice(idx, 1);
    this.writeFile(pipelines);
  }

  /**
   * Read the file, upsert shipped built-ins, and return the reconciled list
   * along with a `mutated` flag indicating whether a write is needed.
   *
   * Reconciliation rules:
   * - Built-ins are always present and always match the shipped definition
   *   (ids reserved — user pipelines cannot collide).
   * - User pipelines are preserved untouched in their insertion order.
   * - Built-ins come first so the Pipeline Library renders them as a header
   *   group above user pipelines.
   */
  private loadAndReconcile(): { pipelines: Pipeline[]; mutated: boolean } {
    const raw = this.readRaw();
    const existingUserPipelines: Pipeline[] = [];
    let mutated = raw.mutated;

    for (const p of raw.pipelines) {
      if (BUILTIN_PIPELINES.some((b) => b.id === p.id)) {
        // On-disk copy of a built-in is ignored — we always replace it with
        // the shipped version below. Flag mutation only if the on-disk copy
        // deviates, so fresh installs (where it's identical) don't rewrite.
        const shipped = BUILTIN_PIPELINES.find((b) => b.id === p.id)!;
        if (!pipelinesEqual(p, shipped)) {
          mutated = true;
        }
      } else {
        existingUserPipelines.push(p);
      }
    }

    // Ensure every shipped built-in is present.
    for (const b of BUILTIN_PIPELINES) {
      if (!raw.pipelines.some((p) => p.id === b.id)) {
        mutated = true;
      }
    }

    const reconciled: Pipeline[] = [
      ...BUILTIN_PIPELINES.map(clonePipeline),
      ...existingUserPipelines,
    ];
    return { pipelines: reconciled, mutated };
  }

  /**
   * Read and parse the on-disk file. Returns an empty list (with
   * `mutated: true` so the caller re-seeds) when the file is missing or
   * corrupt. Version mismatch also triggers a rewrite under the current
   * version.
   */
  private readRaw(): { pipelines: Pipeline[]; mutated: boolean } {
    try {
      const text = fs.readFileSync(this.filePath(), 'utf-8');
      const parsed = JSON.parse(text) as PipelinesFile;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !Array.isArray(parsed.pipelines)
      ) {
        return { pipelines: [], mutated: true };
      }
      return {
        pipelines: parsed.pipelines,
        mutated: parsed.version !== CURRENT_VERSION,
      };
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return { pipelines: [], mutated: true };
      }
      // eslint-disable-next-line no-console
      console.warn('[PipelineStore] Failed to load pipelines.json, reseeding:', err);
      return { pipelines: [], mutated: true };
    }
  }

  /** Atomically write the envelope to disk (`.tmp` → rename). */
  private writeFile(pipelines: Pipeline[]): void {
    fs.mkdirSync(this.basePath, { recursive: true });
    const dest = this.filePath();
    const tmp = `${dest}.tmp`;
    const envelope: PipelinesFile = {
      version: CURRENT_VERSION,
      pipelines,
    };
    try {
      fs.writeFileSync(tmp, JSON.stringify(envelope, null, 2), 'utf-8');
      fs.renameSync(tmp, dest);
    } catch (err) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // Ignore cleanup errors.
      }
      throw err;
    }
  }
}

function clonePipeline(p: Pipeline): Pipeline {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    stages: p.stages.map(cloneStage),
    bounceLimit: p.bounceLimit,
    builtIn: p.builtIn,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function cloneStage(s: Pipeline['stages'][number]): Pipeline['stages'][number] {
  return {
    id: s.id,
    name: s.name,
    agentPrompt: s.agentPrompt,
    instances: s.instances,
    color: s.color,
    icon: s.icon,
  };
}

/**
 * Structural equality check for pipelines — used by the built-in upsert to
 * decide whether the on-disk copy needs rewriting. `JSON.stringify` is
 * sufficient because both sides are built from the same ordered interface and
 * we control field ordering via {@link clonePipeline}.
 */
function pipelinesEqual(a: Pipeline, b: Pipeline): boolean {
  return JSON.stringify(clonePipeline(a)) === JSON.stringify(clonePipeline(b));
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
