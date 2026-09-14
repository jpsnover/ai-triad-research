// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3483 — mintAndProjectCommunityOpEd (the shared idempotent mint-and-project sequence,
// extracted from routes/community.ts's manual-mint handler) and backfillCommunityOpedShares
// (Part C: one-time, safe-to-re-run pass minting + projecting every existing community op-ed
// so the public index is complete immediately, per TL ruling t/3481#2).
//
// Uses a realistic in-memory backend (readFile/writeFile/listDirectory) so listCommunityOpEds'
// index-rebuild path, the share registry's read/write, and the public projection write all
// exercise their REAL implementations end to end — not mocked away.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const files = new Map<string, string>();

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

vi.mock('../storage/fileIO.js', () => ({
  getUserContentBackend: () => ({
    readFile: vi.fn(async (p: string) => files.get(normalize(p)) ?? null),
    writeFile: vi.fn(async (p: string, content: string) => { files.set(normalize(p), content); }),
    listDirectory: vi.fn(async (dir: string) => {
      const prefix = `${normalize(dir)}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) names.add(key.slice(prefix.length));
      }
      return [...names];
    }),
  }),
  assertSafeId: (id: string, label: string) => {
    if (!id || id.includes('..') || id.includes('/')) {
      throw new Error(`Unsafe ${label}: ${id}`);
    }
  },
}));

vi.mock('../config.js', () => ({
  resolveDataPath: (p: string) => `/data/${p}`,
}));

import { mintAndProjectCommunityOpEd, backfillCommunityOpedShares } from '../community/community.js';
import { getCommunityOpedShareEntry } from '../community/communityOpedShares.js';

function seedOped(id: string, opts: { topic?: string; opeds?: unknown[]; submittedBy?: string } = {}) {
  const body = {
    id,
    topic: opts.topic ?? 'A topic',
    opeds: opts.opeds ?? [{ pov: 'acc', headline: 'h', status: 'complete', body: 'text' }],
    community_metadata: { submitted_by_display: opts.submittedBy ?? '' },
  };
  files.set(normalize(`/data/community/opeds/oped-${id}.json`), JSON.stringify(body));
}

describe('mintAndProjectCommunityOpEd (t/3483)', () => {
  beforeEach(() => { files.clear(); });

  it("skips with reason 'absent' when the item doesn't exist", async () => {
    const result = await mintAndProjectCommunityOpEd('nope', 'alice');
    expect(result).toEqual({ outcome: 'skipped', reason: 'absent' });
  });

  it("skips with reason 'empty' when opeds is empty (ADR-001)", async () => {
    seedOped('empty-1', { opeds: [] });
    const result = await mintAndProjectCommunityOpEd('empty-1', 'alice');
    expect(result).toEqual({ outcome: 'skipped', reason: 'empty' });
  });

  it("skips with reason 'malformed' when topic is missing", async () => {
    seedOped('no-topic', { topic: '' });
    const result = await mintAndProjectCommunityOpEd('no-topic', 'alice');
    expect(result).toEqual({ outcome: 'skipped', reason: 'malformed' });
  });

  it('mints a new share and writes the public projection', async () => {
    seedOped('good-1', { submittedBy: 'alice' });
    const result = await mintAndProjectCommunityOpEd('good-1', 'alice');
    expect(result.outcome).toBe('minted');
    if (result.outcome !== 'minted' && result.outcome !== 'already-shared') throw new Error('unreachable');
    expect(files.has(normalize(`/data/public/opeds/${result.shareId}.json`))).toBe(true);
    const entry = await getCommunityOpedShareEntry('good-1');
    expect(entry?.shareId).toBe(result.shareId);
  });

  it('is idempotent — a second call returns already-shared with the same shareId', async () => {
    seedOped('good-2', { submittedBy: 'alice' });
    const first = await mintAndProjectCommunityOpEd('good-2', 'alice');
    const second = await mintAndProjectCommunityOpEd('good-2', 'alice');
    expect(first.outcome).toBe('minted');
    expect(second.outcome).toBe('already-shared');
    if (first.outcome === 'skipped' || second.outcome === 'skipped') throw new Error('unreachable');
    expect(second.shareId).toBe(first.shareId);
  });
});

describe('backfillCommunityOpedShares (t/3483 Part C)', () => {
  beforeEach(() => { files.clear(); });

  it('mints unshared items, counts already-shared, skips malformed — mixed set', async () => {
    seedOped('good-a', { submittedBy: 'alice' });
    seedOped('good-b', { submittedBy: 'bob' });
    seedOped('malformed-a', { opeds: [] });

    // Pre-share good-b so the backfill sees it as already-shared.
    await mintAndProjectCommunityOpEd('good-b', 'bob');

    const result = await backfillCommunityOpedShares();

    expect(result.minted).toBe(1); // good-a
    expect(result.alreadyShared).toBe(1); // good-b
    expect(result.skipped).toBe(1);
    expect(result.skippedIds).toEqual(['malformed-a']);
  });

  it('is safe to re-run — a second full pass reports everything already-shared, nothing minted', async () => {
    seedOped('good-x');
    seedOped('good-y');
    await backfillCommunityOpedShares();

    const second = await backfillCommunityOpedShares();
    expect(second.minted).toBe(0);
    expect(second.alreadyShared).toBe(2);
    expect(second.skipped).toBe(0);
  });

  it('returns zero counts for an empty community', async () => {
    const result = await backfillCommunityOpedShares();
    expect(result).toEqual({ minted: 0, alreadyShared: 0, skipped: 0, skippedIds: [] });
  });
});
