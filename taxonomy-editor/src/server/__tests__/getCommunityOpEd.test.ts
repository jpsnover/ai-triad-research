// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3430 — getCommunityOpEd must discriminate WHY a lookup failed: 'absent' (the blob doesn't
// exist — ordinary, expected) vs 'empty' (the blob exists but has no voices — the ADR-001
// silent-empty/corruption guard). Callers (routes/community.ts, t/3429) use this to warn only
// on the corruption case, not on ordinary 404s.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}));

vi.mock('../storage/fileIO.js', () => ({
  getUserContentBackend: () => ({ readFile: mockReadFile }),
  assertSafeId: (id: string, label: string) => {
    if (!id || id.includes('..') || id.includes('/')) {
      throw new Error(`Unsafe ${label}: ${id}`);
    }
  },
}));

vi.mock('../config.js', () => ({
  resolveDataPath: (p: string) => `/data/${p}`,
}));

import { getCommunityOpEd } from '../community/community.js';

describe('getCommunityOpEd (t/3430)', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
  });

  it("returns { found: false, reason: 'absent' } when the blob doesn't exist", async () => {
    mockReadFile.mockResolvedValue(null);
    const result = await getCommunityOpEd('missing-id');
    expect(result).toEqual({ found: false, reason: 'absent' });
  });

  it("returns { found: false, reason: 'empty' } when opeds is an empty array (ADR-001 silent-empty)", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ topic: 'x', opeds: [] }));
    const result = await getCommunityOpEd('empty-id');
    expect(result).toEqual({ found: false, reason: 'empty' });
  });

  it("returns { found: false, reason: 'empty' } when opeds is missing entirely", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ topic: 'x' }));
    const result = await getCommunityOpEd('no-opeds-id');
    expect(result).toEqual({ found: false, reason: 'empty' });
  });

  it("returns { found: false, reason: 'empty' } when opeds is not an array", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ topic: 'x', opeds: 'not-an-array' }));
    const result = await getCommunityOpEd('malformed-id');
    expect(result).toEqual({ found: false, reason: 'empty' });
  });

  it('returns { found: true, item } with the full parsed item when voices are present', async () => {
    const item = { topic: 'AI Safety', opeds: [{ pov: 'acc', headline: 'h' }], community_metadata: { submitted_by_display: 'Jane' } };
    mockReadFile.mockResolvedValue(JSON.stringify(item));
    const result = await getCommunityOpEd('good-id');
    expect(result).toEqual({ found: true, item });
  });

  it('rejects a path-traversal id via assertSafeId', async () => {
    await expect(getCommunityOpEd('../evil')).rejects.toThrow();
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
