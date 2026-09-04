// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3325 — concurrent-convergence proof for mintCommunityOpedShare (write-first-then-verify).
// TL GV residual: TL accepted the cond-2 deviation (optimistic write-then-verify instead of
// t/2644 hash-check+atomic-rename) on condition this test proves the adopt-winner loop
// actually converges — two concurrent mints of the same id → exactly ONE shareId, no TOCTOU.
//
// Why Promise.all covers TOCTOU: with synchronous-body async mocks, both reads fire before
// either write settles. One write overwrites the other; the loser's verify-read returns the
// winner's shareId via the adopt-winner branch (communityOpedShares.ts:88-89).
//
// Tests:
//   (1) getCommunityOpedShareEntry — null for unknown, entry for known
//   (2) Idempotent re-mint — second call returns same shareId
//   (3) Concurrent convergence — Promise.all(2 mints of sameId) → both same shareId, 1 registry entry
//   (4) N=5 concurrent mints — all converge on one shareId
//   (5) revokeCommunityOpedShare — removes entry, returns it; null if not shared
//   (6) assertSafeId — rejects path-traversal id

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory store (last-write-wins, mirrors fs tmp+rename atomicity) ──────

const store = new Map<string, string>();

const { mockReadFile, mockWriteFile } = vi.hoisted(() => {
  const mockReadFile = vi.fn(async (path: string): Promise<string | null> => store.get(path) ?? null);
  const mockWriteFile = vi.fn(async (path: string, content: string): Promise<void> => { store.set(path, content); });
  return { mockReadFile, mockWriteFile };
});

vi.mock('../storage/fileIO.js', () => ({
  getUserContentBackend: () => ({ readFile: mockReadFile, writeFile: mockWriteFile }),
  assertSafeId: (id: string, label: string) => {
    if (!id || id.includes('..') || id.includes('/')) {
      throw new Error(`Unsafe ${label}: ${id}`);
    }
  },
}));

vi.mock('../config.js', () => ({
  resolveDataPath: (p: string) => `/data/${p}`,
}));

vi.mock('../logger.js', () => ({
  log: { server: { warn: vi.fn() } },
}));

vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: vi.fn().mockReturnValue(null),
}));

import {
  mintCommunityOpedShare,
  getCommunityOpedShareEntry,
  revokeCommunityOpedShare,
} from '../community/communityOpedShares.js';

const REGISTRY_PATH = '/data/community/oped-shares.json';

function registrySnapshot(): Record<string, { shareId: string; submittedBy: string }> {
  const raw = store.get(REGISTRY_PATH);
  return raw ? JSON.parse(raw) as Record<string, { shareId: string; submittedBy: string }> : {};
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('communityOpedShares (t/3325)', () => {
  beforeEach(() => {
    store.clear();
    mockReadFile.mockClear();
    mockWriteFile.mockClear();
  });

  // ── (1) getCommunityOpedShareEntry ─────────────────────────────────────────

  describe('getCommunityOpedShareEntry', () => {
    it('returns null for an id with no share', async () => {
      const entry = await getCommunityOpedShareEntry('no-such-item');
      expect(entry).toBeNull();
    });

    it('returns the entry after a mint', async () => {
      const shareId = await mintCommunityOpedShare('item-a', 'user-1');
      const entry = await getCommunityOpedShareEntry('item-a');
      expect(entry).toEqual({ shareId, submittedBy: 'user-1' });
    });
  });

  // ── (2) Idempotent re-mint ─────────────────────────────────────────────────

  it('(2) idempotent: second mint of same id returns same shareId', async () => {
    const first = await mintCommunityOpedShare('item-idem', 'user-x');
    const second = await mintCommunityOpedShare('item-idem', 'user-y');
    expect(second).toBe(first);

    const reg = registrySnapshot();
    expect(Object.keys(reg)).toHaveLength(1);
    expect(reg['item-idem'].shareId).toBe(first);
  });

  // ── (3) Concurrent convergence — LOAD-BEARING TOCTOU proof ────────────────

  it('(3) two concurrent mints of same id converge on exactly ONE shareId (no TOCTOU double-win)', async () => {
    const [shareId1, shareId2] = await Promise.all([
      mintCommunityOpedShare('item-concurrent', 'user-a'),
      mintCommunityOpedShare('item-concurrent', 'user-b'),
    ]);

    // Both callers must agree on a single shareId.
    expect(shareId1).toBe(shareId2);

    // Registry has exactly one entry — no orphan second entry.
    const reg = registrySnapshot();
    expect(Object.keys(reg)).toHaveLength(1);
    const entry = reg['item-concurrent'];
    expect(entry).toBeDefined();
    expect(entry.shareId).toBe(shareId1);
  });

  // ── (4) N=5 concurrent mints ───────────────────────────────────────────────

  it('(4) five concurrent mints of same id all return the same shareId', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => mintCommunityOpedShare('item-n5', `user-${i}`)),
    );

    const unique = new Set(results);
    expect(unique.size).toBe(1);

    const reg = registrySnapshot();
    expect(Object.keys(reg)).toHaveLength(1);
    expect(reg['item-n5'].shareId).toBe(results[0]);
  });

  // ── (5) revokeCommunityOpedShare ───────────────────────────────────────────

  describe('revokeCommunityOpedShare', () => {
    it('removes the registry entry and returns the removed entry', async () => {
      const shareId = await mintCommunityOpedShare('item-revoke', 'user-rev');
      const removed = await revokeCommunityOpedShare('item-revoke');
      expect(removed).toEqual({ shareId, submittedBy: 'user-rev' });

      const reg = registrySnapshot();
      expect(reg['item-revoke']).toBeUndefined();
    });

    it('returns null when the item was never shared', async () => {
      const removed = await revokeCommunityOpedShare('item-not-shared');
      expect(removed).toBeNull();
    });
  });

  // ── (6) assertSafeId ──────────────────────────────────────────────────────

  it('(6) rejects path-traversal id in mint', async () => {
    await expect(mintCommunityOpedShare('../evil', 'user-bad')).rejects.toThrow();
  });

  it('(6) rejects path-traversal id in getCommunityOpedShareEntry', async () => {
    await expect(getCommunityOpedShareEntry('../evil')).rejects.toThrow();
  });

  it('(6) rejects path-traversal id in revoke', async () => {
    await expect(revokeCommunityOpedShare('../evil')).rejects.toThrow();
  });
});
