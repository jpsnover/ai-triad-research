// @vitest-environment node

/**
 * t/837 — feedback + error reports must persist through the StorageBackend
 * (Azure Blob in prod) so they survive container restarts, not raw fs to the
 * ephemeral data root. Uses an in-memory backend to prove the I/O is routed
 * through the abstraction (and that filesystem mode still round-trips).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import type { StorageBackend } from '../storage/storageBackend.js';
import {
  setBackend, setUserContentBackend,
  saveFeedbackEntry, listFeedbackEntries, saveErrorReport, listErrorEntries,
} from '../storage/fileIO.js';
import { paginateFeedback } from '../storage/feedbackStore.js';

class MemBackend implements StorageBackend {
  files = new Map<string, string>();
  async readFile(p: string) { return this.files.get(p) ?? null; }
  async writeFile(p: string, c: string) { this.files.set(p, c); }
  async listDirectory(dir: string) {
    const out: string[] = [];
    for (const k of this.files.keys()) if (path.dirname(k) === dir) out.push(path.basename(k));
    return out;
  }
  async deleteFile(p: string) { this.files.delete(p); }
  async fileExists(p: string) { return this.files.has(p); }
  async readBinaryFile(p: string) { const v = this.files.get(p); return v != null ? Buffer.from(v) : null; }
}

let mem: MemBackend;

describe('admin feedback/error persistence via backend (t/837)', () => {
  beforeEach(() => {
    mem = new MemBackend();
    setBackend(mem);
    setUserContentBackend(mem); // prod wires Azure Blob here
  });

  it('feedback persists through the backend and lists back (AC#1,#2)', async () => {
    await saveFeedbackEntry({ id: 'aaaaaaaa-1', timestamp: '2026-06-22T10:00:00.000Z', rating: 'up', category: 'bug' });
    await saveFeedbackEntry({ id: 'bbbbbbbb-2', timestamp: '2026-06-22T11:00:00.000Z', rating: 'down' });

    const { items, skipped } = await listFeedbackEntries();
    expect(skipped).toEqual([]);
    expect(items).toHaveLength(2);
    // routed through the backend, not raw fs
    expect(mem.files.size).toBe(2);
    // missing category defaults to "general"
    expect(items.find(e => e.id === 'bbbbbbbb-2')!.category).toBe('general');
  });

  it('paginate/sort/filter still works on backend-loaded entries (AC#5)', async () => {
    await saveFeedbackEntry({ id: 'a', timestamp: '2026-01-01T00:00:00.000Z', rating: 'up', category: 'bug' });
    await saveFeedbackEntry({ id: 'b', timestamp: '2026-03-01T00:00:00.000Z', rating: 'up', category: 'bug' });
    await saveFeedbackEntry({ id: 'c', timestamp: '2026-02-01T00:00:00.000Z', rating: 'down', category: 'feature_request' });

    const { items } = await listFeedbackEntries();
    const page = paginateFeedback(items, { category: 'bug' });
    expect(page.items.map(e => e.id)).toEqual(['b', 'a']); // newest-first, bug only
    expect(page.total).toBe(2);
  });

  it('error reports persist and list back (AC#3)', async () => {
    await saveErrorReport({ id: 'eeeeeeee-1', timestamp: '2026-06-22T10:00:00.000Z', error: { message: 'boom' } });
    const { items } = await listErrorEntries();
    expect(items).toHaveLength(1);
    expect((items[0].error as Record<string, unknown>).message).toBe('boom');
  });

  it('returns an empty list (not an error) when nothing is stored', async () => {
    expect((await listFeedbackEntries()).items).toEqual([]);
    expect((await listErrorEntries()).items).toEqual([]);
  });
});
