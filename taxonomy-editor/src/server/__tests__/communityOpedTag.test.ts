// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

/**
 * t/3991 (TL t/3960#3 cond 2; SO e/252#2 cond 1) — the community op-ed index entry carries the tagged
 * member's scope `{ pov, tag, mode, label }`, so a list row never labels a one-wing essay as the whole
 * camp's. `label` is the wing name from the tag registry. Absent for untagged sets.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { StorageBackend } from '../storage/storageBackend.js';
import * as fileIO from '../storage/fileIO.js';
import * as community from '../community/community.js';
import * as userContext from '../security/userContext.js';
import { resolveDataPath } from '../config.js';
import { loadPovTagRegistry } from '../../../../lib/schema/povTags.js';

/** In-memory backend that persists writes (mirrors communityListingIndex.test.ts). */
class MemBackend implements StorageBackend {
  files = new Map<string, string>();
  private norm(p: string) { return p.replace(/\\/g, '/'); }
  async readFile(filePath: string): Promise<string | null> {
    const k = this.norm(filePath);
    return this.files.has(k) ? this.files.get(k)! : null;
  }
  async writeFile(filePath: string, content: string): Promise<void> { this.files.set(this.norm(filePath), content); }
  async listDirectory(dirPath: string): Promise<string[]> {
    const d = this.norm(dirPath).replace(/\/$/, '') + '/';
    const names = new Set<string>();
    for (const k of this.files.keys()) if (k.startsWith(d)) names.add(k.slice(d.length).split('/')[0]);
    return [...names];
  }
  async deleteFile(filePath: string): Promise<void> { this.files.delete(this.norm(filePath)); }
  async fileExists(filePath: string): Promise<boolean> { return this.files.has(this.norm(filePath)); }
  async readBinaryFile(): Promise<Buffer | null> { return null; }
  async writeBinaryFile(): Promise<void> { /* stub */ }
  put(absPath: string, content: string) { this.files.set(this.norm(absPath), content); }
}

const ctx = { principalName: 'alice', idp: 'github', storageUserId: 'alice', isAnonymous: false };
const opedsDir = () => resolveDataPath('community/opeds');

let dataRoot: string;
let mem: MemBackend;

type Entry = { id: string; tag?: { pov: string; tag: string; mode: string; label: string } };

/** A stored community op-ed set; `tagged` is the applied tag on the skeptic member, if any. */
function opedSet(id: string, tagged?: unknown): string {
  return JSON.stringify({
    id,
    topic: `Topic ${id}`,
    created_at: '2026-10-01',
    updated_at: '2026-10-01',
    opeds: [
      { pov: 'accelerationist', text: 'a' },
      { pov: 'skeptic', text: 's', ...(tagged !== undefined ? { tag: tagged } : {}) },
    ],
  });
}

async function list(): Promise<Entry[]> {
  return await userContext.runWithUser(ctx, () => community.listCommunityOpEds()) as Entry[];
}

describe('community op-ed index entry carries the tag (t/3991)', () => {
  beforeAll(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'commoptag-'));
    dataRoot = process.env.AI_TRIAD_DATA_ROOT;
  });
  afterAll(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.AI_TRIAD_DATA_ROOT;
  });
  beforeEach(() => {
    mem = new MemBackend();
    fileIO.setBackend(mem);
  });

  it('a tagged set carries { pov, tag, mode } from the member and the wing label from the registry', async () => {
    const registryLabel = loadPovTagRegistry().povs.skeptic?.find((e) => e.id === 'critical')?.label;
    expect(registryLabel).toBeDefined(); // fixture guard: the committed registry lists skeptic.critical
    mem.put(path.join(opedsDir(), 'oped-t1.json'),
      opedSet('t1', { pov: 'skeptic', tag: 'critical', mode: 'scope', included: 7, excludedUntagged: 12 }));

    const [entry] = await list();
    expect(entry.tag).toEqual({ pov: 'skeptic', tag: 'critical', mode: 'scope', label: registryLabel });
  });

  it('an untagged set has no tag key at all', async () => {
    mem.put(path.join(opedsDir(), 'oped-u1.json'), opedSet('u1'));

    const [entry] = await list();
    expect(entry).not.toHaveProperty('tag');
  });

  it('a tag retired from the registry is kept, labelled by its id — never dropped into a whole-camp row', async () => {
    mem.put(path.join(opedsDir(), 'oped-r1.json'),
      opedSet('r1', { pov: 'skeptic', tag: 'retired-wing', mode: 'prioritize', included: 3, excludedUntagged: 0 }));

    const [entry] = await list();
    expect(entry.tag).toEqual({ pov: 'skeptic', tag: 'retired-wing', mode: 'prioritize', label: 'retired-wing' });
  });

  it('a malformed applied tag is omitted rather than shown with fabricated values', async () => {
    mem.put(path.join(opedsDir(), 'oped-m1.json'),
      opedSet('m1', { pov: 'skeptic', tag: 'critical', mode: 'everything' }));

    const [entry] = await list();
    expect(entry.id).toBe('m1'); // the set is still listed
    expect(entry).not.toHaveProperty('tag');
  });

  it('a pre-existing v2 index (built before tags) is rebuilt, so cached rows gain the tag', async () => {
    // A stale index from before this change: same file count, so only the version check can bust it.
    mem.put(path.join(opedsDir(), '_index.json'), JSON.stringify({
      version: 'oped-v2',
      entries: [{ id: 's1', topic: 'Topic s1', created_at: '2026-10-01', updated_at: '2026-10-01', community_metadata: null, camps: ['accelerationist', 'skeptic'], voice_count: 2 }],
    }));
    mem.put(path.join(opedsDir(), 'oped-s1.json'),
      opedSet('s1', { pov: 'skeptic', tag: 'critical', mode: 'scope', included: 7, excludedUntagged: 12 }));

    const [entry] = await list();
    expect(entry.tag?.tag).toBe('critical');
  });
});
