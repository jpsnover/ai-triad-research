// @vitest-environment node
//
// t/1807 — Server Storage read path for the entity store (entities.json). Feeds
// ServerAPI's public getEntity (t/1786); the merged_into walk lives THERE, this
// layer only reads. Covers: typed Entity[] read, the id→Entity registry map, the
// t/1793 caching discipline (repeated reads don't re-parse), absent-store null,
// and cache reset on backend swap.

import { describe, it, expect, beforeEach } from 'vitest';
import type { StorageBackend } from '../storage/storageBackend.js';
import type { Entity } from '../../../../lib/entities/types.js';
import * as fileIO from '../storage/fileIO.js';

class MemoryBackend implements StorageBackend {
  entitiesJson: string | null = null;
  readCount = 0;
  async readFile(filePath: string): Promise<string | null> {
    if (filePath.replace(/\\/g, '/').endsWith('entities.json')) {
      this.readCount++;
      return this.entitiesJson;
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

const ENTITIES: Entity[] = [
  {
    id: 'ent-001', name: 'Ada Lovelace', aliases: ['Ada'], entity_type: 'person',
    dolce_category: 'agentive-physical-object',
    description: 'A person who authored the first algorithm.', status: 'approved',
    created_at: '2026-07-27', last_modified: '2026-07-27',
  },
  {
    id: 'ent-002', name: 'Old Name', aliases: [], entity_type: 'person',
    dolce_category: 'agentive-physical-object',
    description: 'Superseded record.', status: 'deprecated', merged_into: 'ent-001',
    created_at: '2026-07-27', last_modified: '2026-07-27',
  },
];

function envelope(entities: Entity[]): string {
  return JSON.stringify({
    _schema_version: '1.0.0',
    _doc: 'test',
    entity_count: entities.length,
    last_modified: '2026-07-27',
    entities,
  });
}

let mem: MemoryBackend;

describe('entity store read path (t/1807)', () => {
  beforeEach(() => {
    mem = new MemoryBackend();
    mem.entitiesJson = envelope(ENTITIES);
    fileIO.setTaxonomyBackend(mem); // also resets the parsed-entities cache
  });

  it('readEntities returns typed Entity records from the envelope', async () => {
    const entities = await fileIO.readEntities();
    expect(entities?.map(e => e.id)).toEqual(['ent-001', 'ent-002']);
    expect(entities?.[0].name).toBe('Ada Lovelace');
    expect(entities?.[1].merged_into).toBe('ent-001'); // tombstone preserved for the getEntity walk
  });

  it('readEntityRegistry returns an id→Entity lookup map', async () => {
    const registry = await fileIO.readEntityRegistry();
    expect(registry?.get('ent-001')?.name).toBe('Ada Lovelace');
    expect(registry?.get('ent-002')?.merged_into).toBe('ent-001');
    expect(registry?.get('ent-404')).toBeUndefined();
  });

  it('caches the parsed store — N rapid reads do NOT re-read+re-parse (t/1793)', async () => {
    for (let i = 0; i < 5; i++) await fileIO.readEntities();
    await fileIO.readEntityRegistry(); // also goes through the cache
    expect(mem.readCount).toBe(1);
  });

  it('returns null when the store is absent', async () => {
    mem.entitiesJson = null;
    expect(await fileIO.readEntities()).toBeNull();
    expect(await fileIO.readEntityRegistry()).toBeNull();
  });

  it('swapping the taxonomy backend clears the cache (no stale read)', async () => {
    expect((await fileIO.readEntities())?.length).toBe(2);

    const mem2 = new MemoryBackend();
    mem2.entitiesJson = envelope([ENTITIES[0]]); // only ent-001
    fileIO.setTaxonomyBackend(mem2);

    const after = await fileIO.readEntities();
    expect(after?.map(e => e.id)).toEqual(['ent-001']);
    expect(mem2.readCount).toBe(1);
  });
});
