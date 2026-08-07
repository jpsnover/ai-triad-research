// @vitest-environment node

/**
 * t/1635 — version-aware read-merge-write for incremental debate save.
 *
 * `applyDebateDeltaToStorage(delta)` reads the stored session, compares its
 * `_saveVersion` (absent ⇒ 0) against `delta.baseVersion`, and:
 *   - on an exact match: applies the shared pure merge (`applyDebateDelta`,
 *     t/1634), writes the full merged blob, and returns the bumped `{ newVersion }`;
 *   - on a mismatch — or when no stored session exists — throws a typed 409
 *     ActionableError carrying `currentVersion` (null when the blob is absent) so
 *     the client falls back to a full PUT and self-heals.
 *
 * Anonymous sessions merge-and-mirror through the anon store (same uplink saving,
 * the whole point of the delta). These tests exercise both the authenticated
 * backend path and the anonymous store path.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { StorageBackend } from '../storage/storageBackend.js';
import * as fileIO from '../storage/fileIO.js';
import * as userContext from '../security/userContext.js';
import { initAnonymousSessionStore } from '../storage/anonymousSessionStore.js';
import type { DebateDelta } from '../../../../lib/debate/types.js';

class MemoryBackend implements StorageBackend {
  files = new Map<string, string>();
  private norm(p: string) { return p.replace(/\\/g, '/'); }
  async readFile(p: string): Promise<string | null> { return this.files.get(this.norm(p)) ?? null; }
  async writeFile(p: string, c: string): Promise<void> { this.files.set(this.norm(p), c); }
  async listDirectory(d: string): Promise<string[]> {
    const prefix = this.norm(d) + '/';
    const out = new Set<string>();
    for (const k of this.files.keys()) if (k.startsWith(prefix)) out.add(k.slice(prefix.length).split('/')[0]);
    return [...out];
  }
  async deleteFile(p: string): Promise<void> { this.files.delete(this.norm(p)); }
  async fileExists(p: string): Promise<boolean> { return this.files.has(this.norm(p)); }
  async readBinaryFile(): Promise<Buffer | null> { return null; }
  async writeBinaryFile(): Promise<void> { /* stub */ }
  has(substr: string): boolean { return [...this.files.keys()].some(k => k.includes(substr)); }
  find(substr: string): string | undefined {
    const key = [...this.files.keys()].find(k => k.includes(substr));
    return key ? this.files.get(key) : undefined;
  }
}

const ctx = { principalName: 'alice', idp: 'github', storageUserId: 'alice', isAnonymous: false };
const anonCtx = { principalName: '_local', idp: 'anon', storageUserId: '_local', isAnonymous: true, anonymousSessionId: 'sess-1' };

// Build a minimal valid delta; override any field per case.
function makeDelta(over: Partial<DebateDelta> = {}): DebateDelta {
  return {
    debateId: 'd1',
    baseVersion: 0,
    newTranscriptEntries: [],
    changedNodes: [],
    changedEdges: [],
    newMutations: [],
    ...over,
  };
}

let dataRoot: string;
let tax: MemoryBackend;
let uc: MemoryBackend;

describe('applyDebateDeltaToStorage (t/1635)', () => {
  beforeAll(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-'));
    dataRoot = process.env.AI_TRIAD_DATA_ROOT;
    process.env.ANON_SESSION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anon-'));
    initAnonymousSessionStore({ baseDir: process.env.ANON_SESSION_DIR });
  });
  afterAll(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    if (process.env.ANON_SESSION_DIR) fs.rmSync(process.env.ANON_SESSION_DIR, { recursive: true, force: true });
    delete process.env.AI_TRIAD_DATA_ROOT;
    delete process.env.ANON_SESSION_DIR;
  });
  beforeEach(() => {
    tax = new MemoryBackend();
    uc = new MemoryBackend();
    fileIO.setTaxonomyBackend(tax);
    fileIO.setUserContentBackend(uc);
  });

  // Seed a stored debate via the normal save path so the on-disk shape matches prod.
  async function seed(session: Record<string, unknown>): Promise<void> {
    await userContext.runWithUser(ctx, () => fileIO.saveDebateSession(session));
  }

  it('exact version match: merges, bumps _saveVersion, writes, returns { newVersion }', async () => {
    await seed({ id: 'd1', title: 'D', phase: 'rounds', _saveVersion: 3 });
    const delta = makeDelta({ debateId: 'd1', baseVersion: 3, changedFields: { phase: 'synthesis' } });

    const result = await userContext.runWithUser(ctx, () => fileIO.applyDebateDeltaToStorage(delta));
    expect(result).toEqual({ newVersion: 4 });

    const stored = JSON.parse(uc.find('debate-d1.json') as string);
    expect(stored._saveVersion).toBe(4);
    expect(stored.phase).toBe('synthesis');
  });

  it('absent _saveVersion is treated as 0', async () => {
    await seed({ id: 'd1', title: 'D' }); // no _saveVersion
    const delta = makeDelta({ debateId: 'd1', baseVersion: 0 });

    const result = await userContext.runWithUser(ctx, () => fileIO.applyDebateDeltaToStorage(delta));
    expect(result).toEqual({ newVersion: 1 });

    const stored = JSON.parse(uc.find('debate-d1.json') as string);
    expect(stored._saveVersion).toBe(1);
  });

  it('stale baseVersion: throws 409 carrying currentVersion, does not write', async () => {
    await seed({ id: 'd1', title: 'D', _saveVersion: 5 });
    const before = uc.find('debate-d1.json');
    const delta = makeDelta({ debateId: 'd1', baseVersion: 2 });

    await expect(
      userContext.runWithUser(ctx, () => fileIO.applyDebateDeltaToStorage(delta)),
    ).rejects.toMatchObject({ statusCode: 409, code: 'version_conflict', currentVersion: 5 });

    // Unchanged on disk — no partial write on a rejected delta.
    expect(uc.find('debate-d1.json')).toBe(before);
  });

  it('missing blob: throws 409 with currentVersion null (client full-PUT self-heals)', async () => {
    const delta = makeDelta({ debateId: 'nope', baseVersion: 0 });
    await expect(
      userContext.runWithUser(ctx, () => fileIO.applyDebateDeltaToStorage(delta)),
    ).rejects.toMatchObject({ statusCode: 409, code: 'version_conflict', currentVersion: null });
  });

  it('anonymous path: merges and mirrors back into the anon store', async () => {
    // Seed through the anon store via the normal save path.
    await userContext.runWithUser(anonCtx, () =>
      fileIO.saveDebateSession({ id: 'ad1', title: 'A', phase: 'rounds', _saveVersion: 1 }));

    const delta = makeDelta({ debateId: 'ad1', baseVersion: 1, changedFields: { phase: 'synthesis' } });
    const result = await userContext.runWithUser(anonCtx, () => fileIO.applyDebateDeltaToStorage(delta));
    expect(result).toEqual({ newVersion: 2 });

    const reloaded = await userContext.runWithUser(anonCtx, () => fileIO.loadDebateSession('ad1')) as {
      _saveVersion: number; phase: string;
    };
    expect(reloaded._saveVersion).toBe(2);
    expect(reloaded.phase).toBe('synthesis');
    // The delta must never leak into the authenticated backend.
    expect(uc.has('debate-ad1.json')).toBe(false);
  });

  it('anonymous stale baseVersion: throws 409 carrying currentVersion', async () => {
    await userContext.runWithUser(anonCtx, () =>
      fileIO.saveDebateSession({ id: 'ad2', title: 'A2', _saveVersion: 4 }));
    const delta = makeDelta({ debateId: 'ad2', baseVersion: 1 });

    await expect(
      userContext.runWithUser(anonCtx, () => fileIO.applyDebateDeltaToStorage(delta)),
    ).rejects.toMatchObject({ statusCode: 409, code: 'version_conflict', currentVersion: 4 });
  });

  it('IDOR guard: session B cannot PATCH a debate created by session A (t/2230)', async () => {
    const sessA = { ...anonCtx, anonymousSessionId: 'sess-idor-a' };
    const sessB = { ...anonCtx, anonymousSessionId: 'sess-idor-b' };

    // Session A seeds a debate at version 2.
    await userContext.runWithUser(sessA, () =>
      fileIO.saveDebateSession({ id: 'idor-debate', title: 'Owned by A', _saveVersion: 2 }));

    // Session B attempts to PATCH the same debate ID — must not find it.
    const delta = makeDelta({ debateId: 'idor-debate', baseVersion: 2 });
    await expect(
      userContext.runWithUser(sessB, () => fileIO.applyDebateDeltaToStorage(delta)),
    ).rejects.toMatchObject({ statusCode: 409, code: 'version_conflict', currentVersion: null });

    // Session A's debate is untouched.
    const reloaded = await userContext.runWithUser(sessA, () =>
      fileIO.loadDebateSession('idor-debate')) as { _saveVersion: number };
    expect(reloaded._saveVersion).toBe(2);
  });
});
