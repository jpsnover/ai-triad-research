// Pure unit tests for buildDebateDelta's turn_embeddings append/upsert-by-key
// surface (t/1640). The load-bearing property (AC-3): per-save upload scales with
// turns ADDED, not total turns — so we assert the emitted `newTurnEmbeddings` key
// count equals the number of added/changed keys regardless of the base map size.

import { describe, it, expect } from 'vitest';
import { buildDebateDelta } from '../slices/buildDebateDelta';
import type { DebateSession } from '@lib/debate/types';

/** Minimal session with an N-entry turn_embeddings map (keys t0..t{N-1}, 3-dim vectors). */
function makeSession(embeddingCount: number, version = 2): DebateSession {
  const turn_embeddings: Record<string, number[]> = {};
  for (let i = 0; i < embeddingCount; i++) {
    turn_embeddings[`t${i}`] = [i, i + 0.5, i + 0.25];
  }
  return {
    id: 'd1',
    title: 'Test',
    phase: 'rounds',
    updated_at: '2026-07-21T00:00:00Z',
    transcript: [],
    argument_network: { nodes: [], edges: [], mutations: [] },
    turn_embeddings,
    _saveVersion: version,
  } as unknown as DebateSession;
}

describe('buildDebateDelta — turn_embeddings append-by-key (t/1640)', () => {
  it('emits only the newly-added keys (upload scales with turns added, not total)', () => {
    const base = makeSession(100);
    const current = makeSession(102); // two turns added: t100, t101

    const result = buildDebateDelta(base, current, 2);

    expect(result.kind).toBe('delta');
    if (result.kind !== 'delta') return;
    expect(result.delta.newTurnEmbeddings).toBeDefined();
    expect(Object.keys(result.delta.newTurnEmbeddings!).sort()).toEqual(['t100', 't101']);
  });

  it('key count is invariant to base size — 2 added off a base of 2 is the same as off 100', () => {
    const smallDelta = buildDebateDelta(makeSession(2), makeSession(4), 2);
    const largeDelta = buildDebateDelta(makeSession(100), makeSession(102), 2);

    for (const r of [smallDelta, largeDelta]) {
      expect(r.kind).toBe('delta');
      if (r.kind !== 'delta') return;
      // Both added exactly 2 turns — payload size tracks turns-added, not total turns.
      expect(Object.keys(r.delta.newTurnEmbeddings!)).toHaveLength(2);
    }
  });

  it('does NOT duplicate turn_embeddings into changedFields (structured surface only)', () => {
    const result = buildDebateDelta(makeSession(3), makeSession(5), 2);

    expect(result.kind).toBe('delta');
    if (result.kind !== 'delta') return;
    // changedFields is the generic overlay; turn_embeddings is a STRUCTURED_KEY and
    // must never leak into it (that would re-send the whole map, defeating t/1640).
    expect(result.delta.changedFields?.turn_embeddings).toBeUndefined();
  });

  it('re-sends a single key when its vector changes in place (idempotent upsert)', () => {
    const base = makeSession(3);
    const current = makeSession(3);
    current.turn_embeddings!.t1 = [9, 9, 9]; // in-place edit of one existing key

    const result = buildDebateDelta(base, current, 2);

    expect(result.kind).toBe('delta');
    if (result.kind !== 'delta') return;
    expect(Object.keys(result.delta.newTurnEmbeddings!)).toEqual(['t1']);
    expect(result.delta.newTurnEmbeddings!.t1).toEqual([9, 9, 9]);
  });

  it('falls back to a full PUT when a key is removed (unrepresentable by append/upsert)', () => {
    const base = makeSession(3); // t0, t1, t2
    const current = makeSession(3);
    delete current.turn_embeddings!.t2; // removal — the append surface cannot express it

    const result = buildDebateDelta(base, current, 2);

    expect(result.kind).toBe('full');
  });

  it('omits newTurnEmbeddings entirely when the map is unchanged', () => {
    // Change something else so the delta isn't empty, and confirm no embeddings ride along.
    const base = makeSession(3);
    const current = makeSession(3);
    current.title = 'Renamed';

    const result = buildDebateDelta(base, current, 2);

    expect(result.kind).toBe('delta');
    if (result.kind !== 'delta') return;
    expect(result.delta.newTurnEmbeddings).toBeUndefined();
    expect(result.delta.meta?.title).toBe('Renamed');
  });

  it('treats a first-ever embeddings map (base empty) as all-new keys', () => {
    const base = makeSession(0); // {}
    const current = makeSession(2); // t0, t1

    const result = buildDebateDelta(base, current, 2);

    expect(result.kind).toBe('delta');
    if (result.kind !== 'delta') return;
    expect(Object.keys(result.delta.newTurnEmbeddings!).sort()).toEqual(['t0', 't1']);
  });
});
