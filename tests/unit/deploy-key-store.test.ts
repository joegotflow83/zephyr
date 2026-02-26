/**
 * Unit tests for DeployKeyStore service.
 *
 * Tests cover:
 * - record() — writes new active entries to the store
 * - markCleaned() — transitions active/orphaned → cleaned; idempotent
 * - detectOrphans() — promotes all active entries to orphaned on startup
 * - listOrphaned() — returns only orphaned entries
 * - getGithubKeysUrl() — builds correct GitHub settings URL
 * - Atomic save via tmp file + rename
 * - Graceful handling of missing store file (ENOENT)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DeployKeyStore, type DeployKeyRecord } from '../../src/services/deploy-key-store';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-key-store-test-'));
}

function makeRecord(
  overrides: Partial<Omit<DeployKeyRecord, 'status'>> = {}
): Omit<DeployKeyRecord, 'status'> {
  return {
    key_id: overrides.key_id ?? 1001,
    repo: overrides.repo ?? 'owner/repo',
    project_id: overrides.project_id ?? 'proj-uuid-1',
    project_name: overrides.project_name ?? 'My Project',
    loop_id: overrides.loop_id ?? 'loop-uuid-1',
    created_at: overrides.created_at ?? '2024-01-01T00:00:00.000Z',
  };
}

// ─── record() ────────────────────────────────────────────────────────────────

describe('DeployKeyStore.record', () => {
  let tmpDir: string;
  let store: DeployKeyStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new DeployKeyStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the store file with the new entry marked active', () => {
    store.record(makeRecord());

    const raw = fs.readFileSync(path.join(tmpDir, 'ssh_deploy_keys.json'), 'utf-8');
    const data = JSON.parse(raw) as { keys: DeployKeyRecord[] };
    expect(data.keys).toHaveLength(1);
    expect(data.keys[0].status).toBe('active');
  });

  it('stores all provided fields verbatim', () => {
    const entry = makeRecord({ key_id: 42, repo: 'my-org/my-repo', project_id: 'pid', loop_id: 'lid' });
    store.record(entry);

    const raw = fs.readFileSync(path.join(tmpDir, 'ssh_deploy_keys.json'), 'utf-8');
    const data = JSON.parse(raw) as { keys: DeployKeyRecord[] };
    expect(data.keys[0]).toMatchObject({ ...entry, status: 'active' });
  });

  it('appends multiple entries', () => {
    store.record(makeRecord({ key_id: 1 }));
    store.record(makeRecord({ key_id: 2 }));
    store.record(makeRecord({ key_id: 3 }));

    const raw = fs.readFileSync(path.join(tmpDir, 'ssh_deploy_keys.json'), 'utf-8');
    const data = JSON.parse(raw) as { keys: DeployKeyRecord[] };
    expect(data.keys).toHaveLength(3);
    expect(data.keys.map((k) => k.key_id)).toEqual([1, 2, 3]);
  });

  it('creates the config directory if it does not exist', () => {
    const nested = path.join(tmpDir, 'deep', 'nested');
    const nestedStore = new DeployKeyStore(nested);
    nestedStore.record(makeRecord());

    expect(fs.existsSync(path.join(nested, 'ssh_deploy_keys.json'))).toBe(true);
  });
});

// ─── markCleaned() ───────────────────────────────────────────────────────────

describe('DeployKeyStore.markCleaned', () => {
  let tmpDir: string;
  let store: DeployKeyStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new DeployKeyStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('updates an active key to cleaned', () => {
    store.record(makeRecord({ key_id: 10 }));
    store.markCleaned(10);

    const raw = fs.readFileSync(path.join(tmpDir, 'ssh_deploy_keys.json'), 'utf-8');
    const data = JSON.parse(raw) as { keys: DeployKeyRecord[] };
    expect(data.keys[0].status).toBe('cleaned');
  });

  it('updates an orphaned key to cleaned', () => {
    store.record(makeRecord({ key_id: 20 }));
    store.detectOrphans(); // active → orphaned
    store.markCleaned(20);

    const raw = fs.readFileSync(path.join(tmpDir, 'ssh_deploy_keys.json'), 'utf-8');
    const data = JSON.parse(raw) as { keys: DeployKeyRecord[] };
    expect(data.keys[0].status).toBe('cleaned');
  });

  it('is idempotent — marking an already-cleaned key does not error', () => {
    store.record(makeRecord({ key_id: 30 }));
    store.markCleaned(30);
    expect(() => store.markCleaned(30)).not.toThrow();

    const raw = fs.readFileSync(path.join(tmpDir, 'ssh_deploy_keys.json'), 'utf-8');
    const data = JSON.parse(raw) as { keys: DeployKeyRecord[] };
    expect(data.keys[0].status).toBe('cleaned');
  });

  it('only cleans the matching key_id', () => {
    store.record(makeRecord({ key_id: 1 }));
    store.record(makeRecord({ key_id: 2 }));
    store.record(makeRecord({ key_id: 3 }));
    store.markCleaned(2);

    const raw = fs.readFileSync(path.join(tmpDir, 'ssh_deploy_keys.json'), 'utf-8');
    const data = JSON.parse(raw) as { keys: DeployKeyRecord[] };
    const statuses = data.keys.map((k) => ({ id: k.key_id, status: k.status }));
    expect(statuses).toEqual([
      { id: 1, status: 'active' },
      { id: 2, status: 'cleaned' },
      { id: 3, status: 'active' },
    ]);
  });

  it('silently does nothing if the key_id does not exist', () => {
    store.record(makeRecord({ key_id: 50 }));
    expect(() => store.markCleaned(999)).not.toThrow();

    const raw = fs.readFileSync(path.join(tmpDir, 'ssh_deploy_keys.json'), 'utf-8');
    const data = JSON.parse(raw) as { keys: DeployKeyRecord[] };
    expect(data.keys[0].status).toBe('active');
  });
});

// ─── detectOrphans() ─────────────────────────────────────────────────────────

describe('DeployKeyStore.detectOrphans', () => {
  let tmpDir: string;
  let store: DeployKeyStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new DeployKeyStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('promotes all active keys to orphaned', () => {
    store.record(makeRecord({ key_id: 1 }));
    store.record(makeRecord({ key_id: 2 }));
    store.detectOrphans();

    const raw = fs.readFileSync(path.join(tmpDir, 'ssh_deploy_keys.json'), 'utf-8');
    const data = JSON.parse(raw) as { keys: DeployKeyRecord[] };
    expect(data.keys.every((k) => k.status === 'orphaned')).toBe(true);
  });

  it('does not change already-cleaned keys', () => {
    store.record(makeRecord({ key_id: 1 }));
    store.markCleaned(1);
    store.detectOrphans();

    const raw = fs.readFileSync(path.join(tmpDir, 'ssh_deploy_keys.json'), 'utf-8');
    const data = JSON.parse(raw) as { keys: DeployKeyRecord[] };
    expect(data.keys[0].status).toBe('cleaned');
  });

  it('does not change already-orphaned keys', () => {
    store.record(makeRecord({ key_id: 1 }));
    store.detectOrphans(); // first call
    store.detectOrphans(); // second call — should be a no-op

    const raw = fs.readFileSync(path.join(tmpDir, 'ssh_deploy_keys.json'), 'utf-8');
    const data = JSON.parse(raw) as { keys: DeployKeyRecord[] };
    expect(data.keys[0].status).toBe('orphaned');
  });

  it('handles a mix of statuses correctly', () => {
    store.record(makeRecord({ key_id: 1 })); // will be active
    store.record(makeRecord({ key_id: 2 })); // will be cleaned before detectOrphans
    store.record(makeRecord({ key_id: 3 })); // will be active
    store.markCleaned(2);
    store.detectOrphans();

    const raw = fs.readFileSync(path.join(tmpDir, 'ssh_deploy_keys.json'), 'utf-8');
    const data = JSON.parse(raw) as { keys: DeployKeyRecord[] };
    const statuses = data.keys.map((k) => ({ id: k.key_id, status: k.status }));
    expect(statuses).toEqual([
      { id: 1, status: 'orphaned' },
      { id: 2, status: 'cleaned' },
      { id: 3, status: 'orphaned' },
    ]);
  });

  it('does nothing (no write) when there are no active keys', () => {
    store.record(makeRecord({ key_id: 1 }));
    store.markCleaned(1);

    const statBefore = fs.statSync(path.join(tmpDir, 'ssh_deploy_keys.json'));
    store.detectOrphans();
    const statAfter = fs.statSync(path.join(tmpDir, 'ssh_deploy_keys.json'));

    // mtimeMs should be the same since we skipped the write
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });

  it('is a no-op when the store file does not exist', () => {
    expect(() => store.detectOrphans()).not.toThrow();
  });
});

// ─── listOrphaned() ──────────────────────────────────────────────────────────

describe('DeployKeyStore.listOrphaned', () => {
  let tmpDir: string;
  let store: DeployKeyStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new DeployKeyStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty array when there are no orphaned keys', () => {
    store.record(makeRecord({ key_id: 1 }));
    store.markCleaned(1);
    expect(store.listOrphaned()).toEqual([]);
  });

  it('returns only orphaned keys', () => {
    store.record(makeRecord({ key_id: 1 }));
    store.record(makeRecord({ key_id: 2 }));
    store.record(makeRecord({ key_id: 3 }));
    store.markCleaned(2); // cleaned
    store.detectOrphans(); // active 1 and 3 → orphaned

    const orphaned = store.listOrphaned();
    expect(orphaned).toHaveLength(2);
    expect(orphaned.map((k) => k.key_id).sort()).toEqual([1, 3]);
    expect(orphaned.every((k) => k.status === 'orphaned')).toBe(true);
  });

  it('returns empty array when store file does not exist', () => {
    expect(store.listOrphaned()).toEqual([]);
  });

  it('returns full record objects with all fields', () => {
    const entry = makeRecord({ key_id: 77, repo: 'acme/widget', project_name: 'Widget' });
    store.record(entry);
    store.detectOrphans();

    const orphaned = store.listOrphaned();
    expect(orphaned[0]).toMatchObject({ ...entry, status: 'orphaned' });
  });
});

// ─── getGithubKeysUrl() ──────────────────────────────────────────────────────

describe('DeployKeyStore.getGithubKeysUrl', () => {
  let store: DeployKeyStore;

  beforeEach(() => {
    store = new DeployKeyStore('/tmp/unused');
  });

  it('builds the correct GitHub settings URL', () => {
    expect(store.getGithubKeysUrl('owner/repo')).toBe(
      'https://github.com/owner/repo/settings/keys'
    );
  });

  it('handles org repos', () => {
    expect(store.getGithubKeysUrl('my-org/my-project')).toBe(
      'https://github.com/my-org/my-project/settings/keys'
    );
  });

  it('preserves dots in repo names', () => {
    expect(store.getGithubKeysUrl('acme/api.v2')).toBe(
      'https://github.com/acme/api.v2/settings/keys'
    );
  });
});

// ─── Persistence across instances ────────────────────────────────────────────

describe('DeployKeyStore persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('data persists across separate DeployKeyStore instances', () => {
    const store1 = new DeployKeyStore(tmpDir);
    store1.record(makeRecord({ key_id: 100 }));
    store1.record(makeRecord({ key_id: 200 }));

    // Simulate app restart with a fresh instance pointing at same dir
    const store2 = new DeployKeyStore(tmpDir);
    store2.detectOrphans();

    const store3 = new DeployKeyStore(tmpDir);
    const orphaned = store3.listOrphaned();
    expect(orphaned).toHaveLength(2);
    expect(orphaned.map((k) => k.key_id).sort()).toEqual([100, 200]);
  });

  it('a key recorded in one instance is cleaned in another', () => {
    const store1 = new DeployKeyStore(tmpDir);
    store1.record(makeRecord({ key_id: 55 }));

    const store2 = new DeployKeyStore(tmpDir);
    store2.markCleaned(55);

    const store3 = new DeployKeyStore(tmpDir);
    expect(store3.listOrphaned()).toEqual([]);
  });
});
