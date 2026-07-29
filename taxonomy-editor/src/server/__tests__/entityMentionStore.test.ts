// @vitest-environment node
//
// t/1895 — Server Storage read path for the entity-mention store
// (entity_mentions.json). Mirrors the t/1807 entityStore pattern with one
// deviation: absent file → empty EntityMentionsFile (not null), because the
// mention index is a derived artifact ("no links yet" ≠ error).
//
// Covers: typed read, per-container lookup, caching (N reads = 1 backend read),
// absent-store returns empty shape + is NOT cached, cache reset on backend swap.

import { describe, it, expect, beforeEach } from 'vitest';
import type { StorageBackend } from '../storage/storageBackend.js';
import type { EntityMentionsFile } from '../../../../lib/entities/mentionTypes.js';
import * as fileIO from '../storage/fileIO.js';

class MemoryBackend implements StorageBackend {
  mentionsJson: string | null = null;
  readCount = 0;
  async readFile(filePath: string): Promise<string | null> {
    if (filePath.replace(/\\/g, '/').endsWith('entity_mentions.json')) {
      this.readCount++;
      return this.mentionsJson;
    }
    return null;
  }
  async writeFile(): Promise<void> { /* stub */ }
  async listDirectory(): Promise<string[]> { return []; }
  async deleteFile(): Promise<void> { /* stub */ }
  async fileExists(): Promise<boolean> { return false; }
  async readBinaryFile(): Promise<Buffer | null> { return null; }
  async writeBinaryFile(): Promise<void> { /* stub */ }
}

const FIXTURE: EntityMentionsFile = {
  _schema_version: '1.0.0',
  _doc: 'test fixture',
  last_modified: '2026-07-28',
  containers: {
    'debate-001#turn-1': {
      text_sha256: 'abc123',
      extracted_at: '2026-07-28T00:00:00Z',
      mentions: [
        { entity_ref: 'ent-001', quote: 'Ada Lovelace', offset: 0, discovered_by: 'alias' },
      ],
    },
    'debate-001#turn-2': {
      text_sha256: 'def456',
      extracted_at: '2026-07-28T00:00:00Z',
      mentions: [
        { entity_ref: 'ent-002', quote: 'Old Name', offset: 10, discovered_by: 'extraction' },
      ],
    },
  },
};

let mem: MemoryBackend;

describe('entity mention store read path (t/1895)', () => {
  beforeEach(() => {
    mem = new MemoryBackend();
    mem.mentionsJson = JSON.stringify(FIXTURE);
    fileIO.setTaxonomyBackend(mem); // clears the parsed-mentions cache
  });

  it('readEntityMentions returns a typed EntityMentionsFile', async () => {
    const file = await fileIO.readEntityMentions();
    expect(file._schema_version).toBe('1.0.0');
    expect(Object.keys(file.containers)).toEqual(['debate-001#turn-1', 'debate-001#turn-2']);
  });

  it('readContainerMentions returns the mentions for a known container', async () => {
    const cm = await fileIO.readContainerMentions('debate-001#turn-1');
    expect(cm?.mentions).toHaveLength(1);
    expect(cm?.mentions[0].entity_ref).toBe('ent-001');
    expect(cm?.mentions[0].discovered_by).toBe('alias');
  });

  it('readContainerMentions returns null for an unknown container', async () => {
    expect(await fileIO.readContainerMentions('debate-999#turn-0')).toBeNull();
  });

  it('caches the parsed store — N rapid reads do NOT re-read+re-parse (t/1793)', async () => {
    for (let i = 0; i < 5; i++) await fileIO.readEntityMentions();
    await fileIO.readContainerMentions('debate-001#turn-1');
    expect(mem.readCount).toBe(1);
  });

  it('absent store returns empty containers (not null) — derived artifact semantics', async () => {
    mem.mentionsJson = null;
    const file = await fileIO.readEntityMentions();
    expect(file).not.toBeNull();
    expect(file.containers).toEqual({});
    expect(await fileIO.readContainerMentions('any-id')).toBeNull();
  });

  it('absent store is NOT cached — newly-built index is picked up on next read', async () => {
    mem.mentionsJson = null;
    await fileIO.readEntityMentions(); // absent → empty, not cached
    mem.mentionsJson = JSON.stringify(FIXTURE); // index now built
    const file = await fileIO.readEntityMentions();
    expect(Object.keys(file.containers)).toHaveLength(2);
    expect(mem.readCount).toBe(2); // both reads hit the backend
  });

  it('swapping the taxonomy backend clears the cache (no stale read)', async () => {
    expect(Object.keys((await fileIO.readEntityMentions()).containers)).toHaveLength(2);

    const mem2 = new MemoryBackend();
    const single: EntityMentionsFile = {
      ...FIXTURE,
      containers: { 'debate-001#turn-1': FIXTURE.containers['debate-001#turn-1'] },
    };
    mem2.mentionsJson = JSON.stringify(single);
    fileIO.setTaxonomyBackend(mem2);

    const after = await fileIO.readEntityMentions();
    expect(Object.keys(after.containers)).toHaveLength(1);
    expect(mem2.readCount).toBe(1);
  });
});
