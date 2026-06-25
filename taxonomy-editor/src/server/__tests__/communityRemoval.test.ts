// @vitest-environment node

/**
 * t/748 — admin hard-delete of a published community item: removes the file,
 * writes an audit record to community/_removals/, invalidates the listing index,
 * and 404s on a missing item / 400s on an unsafe id.
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

class MemBackend implements StorageBackend {
  files = new Map<string, string>();
  private norm(p: string) { return p.replace(/\\/g, '/'); }
  async readFile(p: string): Promise<string | null> { return this.files.get(this.norm(p)) ?? null; }
  async writeFile(p: string, c: string): Promise<void> { this.files.set(this.norm(p), c); }
  async listDirectory(dirPath: string): Promise<string[]> {
    const pre = this.norm(dirPath).replace(/\/$/, '') + '/';
    const s = new Set<string>();
    for (const k of this.files.keys()) if (k.startsWith(pre)) s.add(k.slice(pre.length).split('/')[0]);
    return [...s];
  }
  async deleteFile(p: string): Promise<void> { this.files.delete(this.norm(p)); }
  async fileExists(p: string): Promise<boolean> { return this.files.has(this.norm(p)); }
  async readBinaryFile(): Promise<Buffer | null> { return null; }
  // helpers
  normAbs(p: string) { return this.norm(p); }
  removalRecords() { return [...this.files.keys()].filter(k => k.includes('/community/_removals/rem-')); }
}

const adminCtx = { principalName: 'jpsnover', idp: 'github', storageUserId: 'jpsnover', isAnonymous: false };
let dataRoot: string;
let mem: MemBackend;

const chatsDir = () => resolveDataPath('community/chats');
const remove = (type: 'chats' | 'debates', id: string, reason?: string) =>
  userContext.runWithUser(adminCtx, () => community.removeCommunityItem(type, id, reason));

describe('community item removal (t/748)', () => {
  beforeAll(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'commrm-'));
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

  it('deletes the file, writes an audit record, and clears the index', async () => {
    const filePath = mem.normAbs(path.join(chatsDir(), 'chat-abc.json'));
    const indexPath = mem.normAbs(path.join(chatsDir(), '_index.json'));
    mem.files.set(filePath, JSON.stringify({ id: 'abc', title: 'Spam Chat', community_metadata: { submitted_by_display: 'alice' } }));
    mem.files.set(indexPath, '[{"id":"abc"}]');

    await remove('chats', 'abc', 'spam');

    expect(mem.files.has(filePath)).toBe(false);       // hard-deleted
    expect(mem.files.has(indexPath)).toBe(false);       // index invalidated
    const recs = mem.removalRecords();
    expect(recs).toHaveLength(1);
    const audit = JSON.parse(mem.files.get(recs[0])!);
    expect(audit).toMatchObject({
      id: 'abc', type: 'chat', title: 'Spam Chat',
      submitted_by: 'alice', removed_by: 'jpsnover', reason: 'spam',
    });
    expect(audit.removed_at).toBeTruthy();
  });

  it('records type "debate" and null reason/submitted_by when absent', async () => {
    const filePath = mem.normAbs(path.join(resolveDataPath('community/debates'), 'debate-d1.json'));
    mem.files.set(filePath, JSON.stringify({ id: 'd1', topic: { final: 'Should AI pause?' } }));

    await remove('debates', 'd1');

    const audit = JSON.parse(mem.files.get(mem.removalRecords()[0])!);
    expect(audit).toMatchObject({ id: 'd1', type: 'debate', title: 'Should AI pause?', submitted_by: null, reason: null });
  });

  it('404s when the item does not exist', async () => {
    await expect(remove('chats', 'missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('400s on an unsafe id (path traversal) before touching the filesystem', async () => {
    await expect(remove('chats', '../evil')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('removed item drops out of the indexed listing', async () => {
    mem.files.set(mem.normAbs(path.join(chatsDir(), 'chat-a.json')), JSON.stringify({ id: 'a', title: 'A', updated_at: '2026-01-01' }));
    mem.files.set(mem.normAbs(path.join(chatsDir(), 'chat-b.json')), JSON.stringify({ id: 'b', title: 'B', updated_at: '2026-02-01' }));
    // Build the index.
    expect((await userContext.runWithUser(adminCtx, () => community.listCommunityChats())).length).toBe(2);

    await remove('chats', 'a', 'dupe');

    const after = await userContext.runWithUser(adminCtx, () => community.listCommunityChats());
    expect(after.map(c => (c as { id: string }).id)).toEqual(['b']);
  });
});
