/**
 * Unit tests for PipelineStore service (Phase 1.13).
 *
 * Why these tests matter:
 * - The store is the single source of truth for every pipeline that drives
 *   the kanban (Phase 3) and agent execution (Phase 2). A bug here cascades
 *   into wrong columns, missing stages, or lost user pipelines on upgrade.
 * - Built-in upsert semantics are an extension of the spec (lets Phase 6
 *   prompt rewrites land automatically). Tests pin the contract so a future
 *   refactor doesn't silently regress to "first-load only" seeding.
 * - Atomic writes prevent corruption when the app is killed mid-write —
 *   exercising the `.tmp → rename` path catches future drift to a non-atomic
 *   replacement.
 *
 * Strategy: real temp directory + real file IO (no fs mocks), mirroring
 * `factory-task-store.test.ts` and `deploy-key-store.test.ts`. The on-disk
 * envelope is small enough that this is fast and gives much higher
 * confidence than a mocked-fs run.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { PipelineStore } from '../../src/services/pipeline-store';
import {
  BUILTIN_PIPELINES,
  BUILTIN_PIPELINE_IDS,
  BUILTIN_TIMESTAMP,
} from '../../src/shared/pipeline-builtins';
import type { Pipeline, PipelineStage } from '../../src/shared/pipeline-types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-store-test-'));
}

function pipelinesFilePath(dir: string): string {
  return path.join(dir, 'pipelines.json');
}

function readEnvelope(dir: string): { version: number; pipelines: Pipeline[] } {
  return JSON.parse(fs.readFileSync(pipelinesFilePath(dir), 'utf-8'));
}

function makeUserPipeline(overrides: Partial<Pipeline> = {}): Omit<Pipeline, 'createdAt' | 'updatedAt'> {
  const stage: PipelineStage = {
    id: 'coder',
    name: 'Coder',
    agentPrompt: 'write code',
    instances: 1,
    color: '#0ea5e9',
    icon: '💻',
  };
  return {
    id: 'user-pipe-1',
    name: 'My Pipeline',
    description: 'A user-created pipeline',
    stages: [stage],
    bounceLimit: 3,
    builtIn: false,
    ...overrides,
  };
}

// ─── Built-in seeding ────────────────────────────────────────────────────────

describe('PipelineStore — built-in seeding', () => {
  let tmpDir: string;
  let store: PipelineStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new PipelineStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns every shipped built-in on first list call', () => {
    const all = store.listPipelines();

    expect(all.length).toBeGreaterThanOrEqual(BUILTIN_PIPELINES.length);
    for (const builtinId of BUILTIN_PIPELINE_IDS) {
      expect(all.some((p) => p.id === builtinId)).toBe(true);
    }
  });

  it('persists built-ins to disk on first list call (file did not exist)', () => {
    expect(fs.existsSync(pipelinesFilePath(tmpDir))).toBe(false);

    store.listPipelines();

    expect(fs.existsSync(pipelinesFilePath(tmpDir))).toBe(true);
    const envelope = readEnvelope(tmpDir);
    expect(envelope.version).toBe(1);
    expect(envelope.pipelines.length).toBe(BUILTIN_PIPELINES.length);
  });

  it('orders built-ins before user pipelines', () => {
    store.addPipeline(makeUserPipeline({ id: 'zzz-user', name: 'Z User Pipe' }));

    const all = store.listPipelines();
    const builtInPositions = BUILTIN_PIPELINE_IDS.map((id) => all.findIndex((p) => p.id === id));
    const userPos = all.findIndex((p) => p.id === 'zzz-user');

    for (const pos of builtInPositions) {
      expect(pos).toBeLessThan(userPos);
    }
  });

  it('does not rewrite the file when nothing changed (read-only refresh)', () => {
    // First list seeds the file.
    store.listPipelines();
    const firstMtime = fs.statSync(pipelinesFilePath(tmpDir)).mtimeMs;

    // Wait a tick to make any rewrite measurable.
    const before = Date.now();
    while (Date.now() - before < 5) {
      // busy-wait briefly so a rewrite would produce a different mtime
    }

    // Second list should be a pure read.
    store.listPipelines();
    const secondMtime = fs.statSync(pipelinesFilePath(tmpDir)).mtimeMs;
    expect(secondMtime).toBe(firstMtime);
  });

  it('refreshes drifted on-disk built-in copies (Phase 6 prompt upgrade path)', () => {
    // Seed first so the file exists.
    store.listPipelines();

    // Simulate an older app version that shipped a stale built-in: tamper
    // with the on-disk copy of `classic-factory` so it differs from what
    // BUILTIN_PIPELINES exports today.
    const envelope = readEnvelope(tmpDir);
    const idx = envelope.pipelines.findIndex((p) => p.id === 'classic-factory');
    expect(idx).toBeGreaterThanOrEqual(0);
    envelope.pipelines[idx] = {
      ...envelope.pipelines[idx],
      stages: [
        {
          id: 'pm',
          name: 'STALE NAME',
          agentPrompt: 'STALE PROMPT FROM OLD VERSION',
          instances: 1,
        },
      ],
    };
    fs.writeFileSync(pipelinesFilePath(tmpDir), JSON.stringify(envelope), 'utf-8');

    // Listing should restore the shipped definition.
    const refreshed = store.listPipelines();
    const classic = refreshed.find((p) => p.id === 'classic-factory')!;
    expect(classic.stages[0].name).not.toBe('STALE NAME');
    // The refreshed prompt must match the current shipped definition (not the stale disk copy).
    expect(classic.stages[0].agentPrompt).toBe(BUILTIN_PIPELINES[0].stages[0].agentPrompt);
    expect(classic.stages[0].agentPrompt).not.toBe('STALE PROMPT FROM OLD VERSION');

    // And the upgrade landed on disk too.
    const onDisk = readEnvelope(tmpDir);
    const onDiskClassic = onDisk.pipelines.find((p) => p.id === 'classic-factory')!;
    expect(onDiskClassic.stages[0].name).not.toBe('STALE NAME');
  });

  it('preserves user pipelines through built-in upsert', () => {
    const added = store.addPipeline(makeUserPipeline({ id: 'keep-me' }));

    // Tamper with a built-in to force reconciliation rewrite.
    const envelope = readEnvelope(tmpDir);
    const idx = envelope.pipelines.findIndex((p) => p.id === 'classic-factory');
    envelope.pipelines[idx].name = 'STALE';
    fs.writeFileSync(pipelinesFilePath(tmpDir), JSON.stringify(envelope), 'utf-8');

    const refreshed = store.listPipelines();
    const userPipe = refreshed.find((p) => p.id === 'keep-me');
    expect(userPipe).toBeDefined();
    expect(userPipe!.name).toBe(added.name);
    expect(userPipe!.stages).toEqual(added.stages);
  });

  it('seeds built-ins with the stable BUILTIN_TIMESTAMP', () => {
    const all = store.listPipelines();
    for (const id of BUILTIN_PIPELINE_IDS) {
      const p = all.find((q) => q.id === id)!;
      expect(p.createdAt).toBe(BUILTIN_TIMESTAMP);
      expect(p.updatedAt).toBe(BUILTIN_TIMESTAMP);
    }
  });

  it('returns deep-cloned pipelines so callers cannot mutate the store', () => {
    const a = store.listPipelines();
    a[0].name = 'mutated by caller';
    a[0].stages[0].name = 'mutated stage';

    const b = store.listPipelines();
    expect(b[0].name).not.toBe('mutated by caller');
    expect(b[0].stages[0].name).not.toBe('mutated stage');
  });

  it('returns shipped built-ins even when the file is missing entirely', () => {
    const fresh = new PipelineStore(makeTmpDir());
    const all = fresh.listPipelines();
    for (const id of BUILTIN_PIPELINE_IDS) {
      expect(all.some((p) => p.id === id)).toBe(true);
    }
  });
});

// ─── Read robustness ─────────────────────────────────────────────────────────

describe('PipelineStore — file robustness', () => {
  let tmpDir: string;
  let store: PipelineStore;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new PipelineStore(tmpDir);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reseeds built-ins when the file contains corrupt JSON', () => {
    fs.writeFileSync(pipelinesFilePath(tmpDir), '{ not valid json ]', 'utf-8');

    const all = store.listPipelines();
    for (const id of BUILTIN_PIPELINE_IDS) {
      expect(all.some((p) => p.id === id)).toBe(true);
    }
    expect(warnSpy).toHaveBeenCalled();
  });

  it('reseeds when the file has the wrong shape (missing pipelines array)', () => {
    fs.writeFileSync(pipelinesFilePath(tmpDir), JSON.stringify({ version: 1 }), 'utf-8');

    const all = store.listPipelines();
    for (const id of BUILTIN_PIPELINE_IDS) {
      expect(all.some((p) => p.id === id)).toBe(true);
    }

    // And the file is rewritten with the correct envelope.
    const envelope = readEnvelope(tmpDir);
    expect(Array.isArray(envelope.pipelines)).toBe(true);
    expect(envelope.version).toBe(1);
  });

  it('rewrites the file with current version when on-disk version is mismatched', () => {
    fs.writeFileSync(
      pipelinesFilePath(tmpDir),
      JSON.stringify({ version: 0, pipelines: [] }),
      'utf-8',
    );

    store.listPipelines();

    const envelope = readEnvelope(tmpDir);
    expect(envelope.version).toBe(1);
  });

  it('creates the base directory if it does not exist', () => {
    const nestedDir = path.join(makeTmpDir(), 'nested', 'pipelines-cfg');
    expect(fs.existsSync(nestedDir)).toBe(false);

    new PipelineStore(nestedDir);

    expect(fs.existsSync(nestedDir)).toBe(true);
    fs.rmSync(path.dirname(nestedDir), { recursive: true, force: true });
  });
});

// ─── Atomic writes ───────────────────────────────────────────────────────────

describe('PipelineStore — atomic writes', () => {
  let tmpDir: string;
  let store: PipelineStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new PipelineStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not leave a .tmp file behind after a successful write', () => {
    store.addPipeline(makeUserPipeline());

    const tmpFile = `${pipelinesFilePath(tmpDir)}.tmp`;
    expect(fs.existsSync(tmpFile)).toBe(false);
    expect(fs.existsSync(pipelinesFilePath(tmpDir))).toBe(true);
  });

  it('ignores a stale .tmp file from a prior crash (only the destination is read)', () => {
    // Seed real data first.
    store.listPipelines();

    // Simulate a crash mid-write: write a corrupt .tmp alongside good data.
    const tmpFile = `${pipelinesFilePath(tmpDir)}.tmp`;
    fs.writeFileSync(tmpFile, 'CORRUPT-PARTIAL-WRITE', 'utf-8');

    const all = store.listPipelines();
    for (const id of BUILTIN_PIPELINE_IDS) {
      expect(all.some((p) => p.id === id)).toBe(true);
    }
  });

  it('cleans up the .tmp file when rename fails', () => {
    store.listPipelines();
    const tmpFile = `${pipelinesFilePath(tmpDir)}.tmp`;

    // Force renameSync to throw to simulate a write failure after the .tmp
    // is on disk. The store should bubble the error and clean up the .tmp.
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('rename failed');
    });

    expect(() => store.addPipeline(makeUserPipeline())).toThrow('rename failed');

    expect(fs.existsSync(tmpFile)).toBe(false);
    renameSpy.mockRestore();
  });

  it('writes a JSON envelope with version 1 and pipelines array', () => {
    store.addPipeline(makeUserPipeline());

    const envelope = readEnvelope(tmpDir);
    expect(envelope).toEqual({
      version: 1,
      pipelines: expect.any(Array),
    });
  });
});

// ─── CRUD round-trip ─────────────────────────────────────────────────────────

describe('PipelineStore — addPipeline', () => {
  let tmpDir: string;
  let store: PipelineStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new PipelineStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists a user pipeline retrievable via getPipeline', () => {
    const added = store.addPipeline(makeUserPipeline({ id: 'cf-1', name: 'CF1' }));

    expect(added.id).toBe('cf-1');
    expect(added.name).toBe('CF1');
    expect(store.getPipeline('cf-1')).toEqual(added);
  });

  it('generates a UUID when id is omitted', () => {
    const input = makeUserPipeline();
    delete (input as Partial<Pipeline>).id;

    const added = store.addPipeline(input as Omit<Pipeline, 'createdAt' | 'updatedAt'>);
    expect(added.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates a UUID when id is empty/whitespace', () => {
    const added = store.addPipeline(makeUserPipeline({ id: '   ' }));
    expect(added.id.trim().length).toBeGreaterThan(10);
    expect(added.id).not.toBe('   ');
  });

  it('forces builtIn=false even if input claims true (no shadow built-ins)', () => {
    const added = store.addPipeline(makeUserPipeline({ id: 'shadow', builtIn: true }));
    expect(added.builtIn).toBe(false);

    const onDisk = store.getPipeline('shadow');
    expect(onDisk!.builtIn).toBe(false);
  });

  it('stamps createdAt and updatedAt with the current ISO timestamp', () => {
    const before = Date.now();
    const added = store.addPipeline(makeUserPipeline());
    const after = Date.now();

    const created = Date.parse(added.createdAt);
    expect(created).toBeGreaterThanOrEqual(before);
    expect(created).toBeLessThanOrEqual(after);
    expect(added.updatedAt).toBe(added.createdAt);
  });

  it('throws when the id collides with an existing user pipeline', () => {
    store.addPipeline(makeUserPipeline({ id: 'dup' }));
    expect(() => store.addPipeline(makeUserPipeline({ id: 'dup' }))).toThrow(/already exists/);
  });

  it('throws when the id collides with a built-in (reserved ids)', () => {
    expect(() =>
      store.addPipeline(makeUserPipeline({ id: 'classic-factory' })),
    ).toThrow(/already exists/);
  });

  it('deep-copies the input stages so caller mutation does not affect storage', () => {
    const input = makeUserPipeline({ id: 'isolated' });
    store.addPipeline(input);

    // Mutate the caller-side stages array.
    input.stages[0].name = 'caller-mutated';

    const fetched = store.getPipeline('isolated')!;
    expect(fetched.stages[0].name).not.toBe('caller-mutated');
  });
});

describe('PipelineStore — getPipeline', () => {
  let tmpDir: string;
  let store: PipelineStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new PipelineStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for an unknown id', () => {
    expect(store.getPipeline('nonexistent')).toBeNull();
  });

  it('returns a built-in pipeline by id', () => {
    const classic = store.getPipeline('classic-factory');
    expect(classic).not.toBeNull();
    expect(classic!.builtIn).toBe(true);
  });
});

describe('PipelineStore — updatePipeline', () => {
  let tmpDir: string;
  let store: PipelineStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new PipelineStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('patches name and refreshes updatedAt', async () => {
    const added = store.addPipeline(makeUserPipeline({ id: 'up-1', name: 'Original' }));

    // Yield to ensure updatedAt timestamp can advance.
    await new Promise((r) => setTimeout(r, 5));

    const updated = store.updatePipeline('up-1', { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    expect(updated.createdAt).toBe(added.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(added.updatedAt));
  });

  it('protects id, builtIn, and createdAt from the patch', () => {
    const added = store.addPipeline(makeUserPipeline({ id: 'protected' }));

    const updated = store.updatePipeline('protected', {
      // @ts-expect-error — deliberately attempting to overwrite protected fields
      id: 'attacker-id',
      builtIn: true,
      createdAt: '1970-01-01T00:00:00.000Z',
      name: 'Renamed',
    });

    expect(updated.id).toBe('protected');
    expect(updated.builtIn).toBe(false);
    expect(updated.createdAt).toBe(added.createdAt);
    expect(updated.name).toBe('Renamed');
  });

  it('replaces stages when patched, deep-copied', () => {
    store.addPipeline(makeUserPipeline({ id: 'stages' }));

    const newStages: PipelineStage[] = [
      { id: 'qa', name: 'QA', agentPrompt: 'verify', instances: 2 },
    ];
    const updated = store.updatePipeline('stages', { stages: newStages });
    expect(updated.stages).toEqual(newStages);

    // Caller mutation must not leak into storage.
    newStages[0].name = 'caller-mutated';
    expect(store.getPipeline('stages')!.stages[0].name).toBe('QA');
  });

  it('throws on unknown id', () => {
    expect(() => store.updatePipeline('nope', { name: 'x' })).toThrow(/not found/);
  });

  it('throws when patching a built-in pipeline', () => {
    expect(() =>
      store.updatePipeline('classic-factory', { name: 'Hijacked' }),
    ).toThrow(/built-in/);
  });
});

describe('PipelineStore — removePipeline', () => {
  let tmpDir: string;
  let store: PipelineStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new PipelineStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes a user pipeline; subsequent get returns null', () => {
    store.addPipeline(makeUserPipeline({ id: 'rm-1' }));
    expect(store.getPipeline('rm-1')).not.toBeNull();

    store.removePipeline('rm-1');
    expect(store.getPipeline('rm-1')).toBeNull();
  });

  it('throws on unknown id', () => {
    expect(() => store.removePipeline('does-not-exist')).toThrow(/not found/);
  });

  it('throws when removing a built-in pipeline', () => {
    expect(() => store.removePipeline('classic-factory')).toThrow(/built-in/);
  });

  it('does not affect sibling user pipelines', () => {
    store.addPipeline(makeUserPipeline({ id: 'a' }));
    store.addPipeline(makeUserPipeline({ id: 'b', name: 'Pipe B' }));

    store.removePipeline('a');

    expect(store.getPipeline('a')).toBeNull();
    expect(store.getPipeline('b')).not.toBeNull();
  });
});

// ─── Cross-instance persistence ──────────────────────────────────────────────

describe('PipelineStore — cross-instance persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('a second store instance sees pipelines added by the first', () => {
    const a = new PipelineStore(tmpDir);
    a.addPipeline(makeUserPipeline({ id: 'shared', name: 'Shared Pipe' }));

    const b = new PipelineStore(tmpDir);
    const fetched = b.getPipeline('shared');
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Shared Pipe');
  });

  it('a second instance sees pipelines removed by the first', () => {
    const a = new PipelineStore(tmpDir);
    a.addPipeline(makeUserPipeline({ id: 'gone' }));
    a.removePipeline('gone');

    const b = new PipelineStore(tmpDir);
    expect(b.getPipeline('gone')).toBeNull();
  });

  it('a second instance sees updates from the first', async () => {
    const a = new PipelineStore(tmpDir);
    a.addPipeline(makeUserPipeline({ id: 'edit', name: 'Before' }));
    await new Promise((r) => setTimeout(r, 5));
    a.updatePipeline('edit', { name: 'After' });

    const b = new PipelineStore(tmpDir);
    expect(b.getPipeline('edit')!.name).toBe('After');
  });
});
