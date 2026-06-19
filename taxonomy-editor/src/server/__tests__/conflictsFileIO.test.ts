// @vitest-environment node

/**
 * t/689 — conflict CRUD reads/writes a single conflicts.json wrapper instead of
 * ~1,244 individual {claimId}.json files.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { StorageBackend } from '../storageBackend.js';
import * as fileIO from '../fileIO.js';

class MemoryBackend implements StorageBackend {
  files = new Map<string, string>();
  private norm(p: string) { return p.replace(/\\/g, '/'); }
  async readFile(filePath: string): Promise<string | null> { return this.files.get(this.norm(filePath)) ?? null; }
  async writeFile(filePath: string, content: string): Promise<void> { this.files.set(this.norm(filePath), content); }
  async listDirectory(dirPath: string): Promise<string[]> {
    const prefix = this.norm(dirPath) + '/';
    const out = new Set<string>();
    for (const k of this.files.keys()) if (k.startsWith(prefix)) out.add(k.slice(prefix.length).split('/')[0]);
    return [...out];
  }
  async deleteFile(filePath: string): Promise<void> { this.files.delete(this.norm(filePath)); }
  async fileExists(filePath: string): Promise<boolean> { return this.files.has(this.norm(filePath)); }
  async readBinaryFile(): Promise<Buffer | null> { return null; }
}

let mem: MemoryBackend;
let dataRoot: string;

/** Read the raw wrapper the way it was persisted. */
function wrapperFile(): string {
  return [...mem.files.keys()].find(k => k.endsWith('conflicts/conflicts.json'))!;
}

describe('conflict CRUD on single conflicts.json (t/689)', () => {
  beforeAll(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'conflicts-'));
    dataRoot = process.env.AI_TRIAD_DATA_ROOT;
  });
  afterAll(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.AI_TRIAD_DATA_ROOT;
  });
  beforeEach(() => {
    mem = new MemoryBackend();
    fileIO.setBackend(mem);
  });

  it('readAllConflictFiles returns [] when no file exists', async () => {
    expect(await fileIO.readAllConflictFiles()).toEqual([]);
  });

  it('createConflictFile appends and readAll returns the array', async () => {
    await fileIO.createConflictFile('clm-1', { claim_id: 'clm-1', label: 'A' });
    await fileIO.createConflictFile('clm-2', { claim_id: 'clm-2', label: 'B' });
    const all = await fileIO.readAllConflictFiles();
    expect(all).toHaveLength(2);
    expect(all.map(c => (c as { claim_id: string }).claim_id).sort()).toEqual(['clm-1', 'clm-2']);
  });

  it('createConflictFile rejects a duplicate claim_id', async () => {
    await fileIO.createConflictFile('clm-1', { claim_id: 'clm-1' });
    await expect(fileIO.createConflictFile('clm-1', { claim_id: 'clm-1' })).rejects.toThrow(/already exists/i);
  });

  it('writeConflictFile replaces the matching entry in place', async () => {
    await fileIO.createConflictFile('clm-1', { claim_id: 'clm-1', label: 'old' });
    await fileIO.createConflictFile('clm-2', { claim_id: 'clm-2', label: 'keep' });
    await fileIO.writeConflictFile('clm-1', { claim_id: 'clm-1', label: 'new' });

    const all = await fileIO.readAllConflictFiles() as { claim_id: string; label: string }[];
    expect(all.find(c => c.claim_id === 'clm-1')!.label).toBe('new');
    expect(all.find(c => c.claim_id === 'clm-2')!.label).toBe('keep');
    expect(all).toHaveLength(2); // replaced, not appended
  });

  it('writeConflictFile throws when the claim_id is absent', async () => {
    await expect(fileIO.writeConflictFile('missing', { claim_id: 'missing' })).rejects.toThrow(/not found/i);
  });

  it('deleteConflictFile removes the entry', async () => {
    await fileIO.createConflictFile('clm-1', { claim_id: 'clm-1' });
    await fileIO.createConflictFile('clm-2', { claim_id: 'clm-2' });
    await fileIO.deleteConflictFile('clm-1');
    const all = await fileIO.readAllConflictFiles() as { claim_id: string }[];
    expect(all.map(c => c.claim_id)).toEqual(['clm-2']);
  });

  it('deleteConflictFile is a no-op for an absent claim_id (no rewrite)', async () => {
    await fileIO.createConflictFile('clm-1', { claim_id: 'clm-1' });
    const before = mem.files.get(wrapperFile());
    await fileIO.deleteConflictFile('nope');
    expect(mem.files.get(wrapperFile())).toBe(before); // unchanged
  });

  it('persists the wrapper schema with version, count, and last_modified', async () => {
    await fileIO.createConflictFile('clm-1', { claim_id: 'clm-1' });
    const wrapper = JSON.parse(mem.files.get(wrapperFile())!);
    expect(wrapper._schema_version).toBe('2.0');
    expect(wrapper.conflict_count).toBe(1);
    expect(typeof wrapper.last_modified).toBe('string');
    expect(Array.isArray(wrapper.conflicts)).toBe(true);
  });

  it('keeps conflict_count in sync across mutations', async () => {
    await fileIO.createConflictFile('clm-1', { claim_id: 'clm-1' });
    await fileIO.createConflictFile('clm-2', { claim_id: 'clm-2' });
    await fileIO.deleteConflictFile('clm-1');
    const wrapper = JSON.parse(mem.files.get(wrapperFile())!);
    expect(wrapper.conflict_count).toBe(1);
    expect(wrapper.conflicts).toHaveLength(1);
  });
});
