// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3483 Part B — approveSubmission mints + projects a public share for approved op-ed
// submissions (not chat/debate) so the item appears on the public index without anyone
// clicking Share. Hooked at APPROVE, not submit, since the item is unreviewed until then.
// A mint/project failure must WARN but never fail the approve (silent-degradation rule) —
// the next backfill run catches it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock('../logger.js', () => ({ log: { server: { warn: warnSpy, info: vi.fn() } } }));

import { approveSubmission } from '../community/community.js';
import { getCommunityOpedShareEntry } from '../community/communityOpedShares.js';

function seedSubmission(id: string, data: Record<string, unknown>) {
  files.set(normalize(`/data/community/_submissions/sub-${id}.json`), JSON.stringify({
    id, type: 'oped', status: 'pending', submittedBy: 'alice', data,
  }));
}

describe('approveSubmission auto-share hook (t/3483 Part B)', () => {
  beforeEach(() => { files.clear(); warnSpy.mockClear(); });

  it('approving a valid oped submission mints + projects a public share', async () => {
    seedSubmission('sub-1', { topic: 'AI Safety', opeds: [{ pov: 'acc', headline: 'h', status: 'complete', body: 'text' }] });
    const { communityId } = await approveSubmission('sub-1');
    const entry = await getCommunityOpedShareEntry(communityId);
    expect(entry).not.toBeNull();
    expect(files.has(normalize(`/data/public/opeds/${entry!.shareId}.json`))).toBe(true);
  });

  it('a mint failure WARNs but does not throw / fail the approve', async () => {
    vi.resetModules();
    vi.doMock('../community/communityOpedShares.js', () => ({
      mintCommunityOpedShare: vi.fn().mockRejectedValue(new Error('registry write failed')),
      getCommunityOpedShareEntry: vi.fn().mockResolvedValue(null),
    }));
    const { approveSubmission: approveWithBrokenMint } = await import('../community/community.js');

    seedSubmission('sub-2', { topic: 'AI Safety', opeds: [{ pov: 'acc', headline: 'h', status: 'complete', body: 'text' }] });
    await expect(approveWithBrokenMint('sub-2')).resolves.toMatchObject({ communityId: expect.any(String) });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('auto-share on approve failed'),
    );

    vi.doUnmock('../community/communityOpedShares.js');
    vi.resetModules();
  });

  it('a skipped outcome (e.g. empty opeds surviving sanitize) WARNs with the reason, not silently ignored', async () => {
    seedSubmission('sub-4', { topic: 'AI Safety', opeds: [] });
    const { communityId } = await approveSubmission('sub-4');

    const entry = await getCommunityOpedShareEntry(communityId);
    expect(entry).toBeNull(); // never minted — skipped, not shared

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ communityId, reason: 'empty' }),
      expect.stringContaining('auto-share on approve skipped'),
    );
  });

  it('does not attempt to mint for chat/debate submission types', async () => {
    files.set(normalize('/data/community/_submissions/sub-3.json'), JSON.stringify({
      id: '3', type: 'chat', status: 'pending', submittedBy: 'alice', data: { id: 'c1', title: 'A chat', messages: [] },
    }));
    const { communityId } = await approveSubmission('3');
    // No oped file was ever written for this id, so a share lookup must find nothing —
    // proves the hook didn't fire for a non-oped submission.
    const entry = await getCommunityOpedShareEntry(communityId);
    expect(entry).toBeNull();
  });
});
