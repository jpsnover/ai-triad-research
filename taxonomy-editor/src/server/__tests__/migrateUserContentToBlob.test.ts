// @vitest-environment node

/**
 * t/699 — user-content migration core. Exercises collectUserContentPaths +
 * migrateUserContent over in-memory StorageBackends (the real CLI swaps in
 * GitHubAPIBackend as source and AzureBlobBackend as dest).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { StorageBackend } from '../storageBackend.js';
import { collectUserContentPaths, migrateUserContent } from '../scripts/migrateUserContentToBlob.js';

class MemoryBackend implements StorageBackend {
  files = new Map<string, string>();
  failReadOn: string | null = null;
  private norm(p: string) { return p.replace(/\\/g, '/'); }
  async readFile(p: string): Promise<string | null> {
    if (this.failReadOn && this.norm(p).includes(this.failReadOn)) throw new Error('simulated read failure');
    return this.files.get(this.norm(p)) ?? null;
  }
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
}

let source: MemoryBackend;
let dest: MemoryBackend;

function seed(b: MemoryBackend) {
  b.files.set('users/alice/chats/chat-1.json', '{"id":"1"}');
  b.files.set('users/alice/debates/debate-1.json', '{"id":"d1"}');
  b.files.set('users/bob/chats/chat-2.json', '{"id":"2"}');
  b.files.set('community/chats/chat-x.json', '{"id":"x"}');
  b.files.set('community/debates/debate-y.json', '{"id":"y"}');
  b.files.set('community/_submissions/sub-1.json', '{"id":"s1"}');
  // Noise that must NOT be migrated:
  b.files.set('users/alice/chats/notes.txt', 'ignore me');
  b.files.set('taxonomy/Origin/nodes.json', '{"taxonomy":true}');
  b.files.set('conflicts/conflicts.json', '{"conflicts":[]}');
}

describe('migrateUserContent (t/699)', () => {
  beforeEach(() => {
    source = new MemoryBackend();
    dest = new MemoryBackend();
    seed(source);
  });

  it('collects only user-content json paths (chats/debates/community), not taxonomy', async () => {
    const paths = (await collectUserContentPaths(source)).sort();
    expect(paths).toEqual([
      'community/_submissions/sub-1.json',
      'community/chats/chat-x.json',
      'community/debates/debate-y.json',
      'users/alice/chats/chat-1.json',
      'users/alice/debates/debate-1.json',
      'users/bob/chats/chat-2.json',
    ]);
  });

  it('migrates all user content preserving paths, and reports counts/bytes/verified', async () => {
    const summary = await migrateUserContent(source, dest);
    expect(summary.filesMigrated).toBe(6);
    expect(summary.verified).toBe(6);
    expect(summary.failures).toEqual([]);
    expect(summary.verifyFailures).toEqual([]);
    expect(summary.bytesTransferred).toBeGreaterThan(0);

    // Same relative paths land in dest; taxonomy/conflicts are untouched.
    expect(dest.files.get('users/alice/chats/chat-1.json')).toBe('{"id":"1"}');
    expect(dest.files.get('community/_submissions/sub-1.json')).toBe('{"id":"s1"}');
    expect(dest.files.has('taxonomy/Origin/nodes.json')).toBe(false);
    expect(dest.files.has('users/alice/chats/notes.txt')).toBe(false);
  });

  it('is idempotent — re-running produces the same result with no failures', async () => {
    await migrateUserContent(source, dest);
    const second = await migrateUserContent(source, dest);
    expect(second.filesMigrated).toBe(6);
    expect(second.failures).toEqual([]);
    expect(dest.files.size).toBe(6); // no duplicates
  });

  it('records per-file failures and continues the rest', async () => {
    source.failReadOn = 'debate-1.json';
    const summary = await migrateUserContent(source, dest);
    expect(summary.filesMigrated).toBe(5); // the other 5 still migrate
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].path).toBe('users/alice/debates/debate-1.json');
  });

  it('records a verify failure when the destination content diverges', async () => {
    // A dest that silently drops one write → read-back mismatch.
    const flaky = new MemoryBackend();
    const realWrite = flaky.writeFile.bind(flaky);
    flaky.writeFile = async (p: string, c: string) => {
      if (p.replace(/\\/g, '/').includes('chat-x.json')) return; // swallow this write
      return realWrite(p, c);
    };
    const summary = await migrateUserContent(source, flaky);
    expect(summary.verifyFailures.some(f => f.path === 'community/chats/chat-x.json')).toBe(true);
  });

  it('verify can be disabled', async () => {
    const summary = await migrateUserContent(source, dest, { verify: false });
    expect(summary.verified).toBe(0);
    expect(summary.filesMigrated).toBe(6);
  });

  it('dry run reports would-migrate counts without writing to the destination', async () => {
    const summary = await migrateUserContent(source, dest, { dryRun: true });
    expect(summary.filesMigrated).toBe(6);        // would-migrate count
    expect(summary.bytesTransferred).toBeGreaterThan(0);
    expect(summary.verified).toBe(0);             // nothing written → nothing verified
    expect(summary.failures).toEqual([]);
    expect(dest.files.size).toBe(0);              // destination untouched
  });
});
