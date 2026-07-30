// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { coerceStringArray, normalizeEntity, resolveMergedInto } from './entityResolve.js';
import { ActionableError } from '../debate/errors.js';
import type { Entity } from './types.js';

// Minimal valid Entity; override any field per-test. The polymorphic-shape tests
// deliberately cast malformed real-world values (null / bare string) into the
// string[]-typed fields — that is exactly the on-disk drift coerceStringArray guards.
function mkEntity(id: string, over: Partial<Entity> = {}): Entity {
  return {
    id,
    name: id,
    aliases: [],
    entity_type: 'artifact',
    dolce_category: 'non-agentive-functional-artifact',
    description: `A thing named ${id}.`,
    status: 'approved',
    created_at: '2026-01-01T00:00:00Z',
    last_modified: '2026-01-01T00:00:00Z',
    ...over,
  };
}

/** Build a sync lookup over a set of entities, mirroring the registry.get seam. */
function lookupFrom(...entities: Entity[]): (id: string) => Entity | null {
  const map = new Map(entities.map((e) => [e.id, e]));
  return (id: string) => map.get(id) ?? null;
}

describe('coerceStringArray', () => {
  it('returns arrays unchanged (same reference)', () => {
    const arr = ['a', 'b'];
    expect(coerceStringArray(arr)).toBe(arr);
    expect(coerceStringArray([])).toEqual([]);
  });

  it('maps null / undefined to an empty array', () => {
    expect(coerceStringArray(null)).toEqual([]);
    expect(coerceStringArray(undefined)).toEqual([]);
  });

  it('wraps a bare string as a single element (not an array of characters)', () => {
    expect(coerceStringArray('GDPR')).toEqual(['GDPR']);
    // guards the concrete bug: field[0] on a bare string is its first CHARACTER
    expect(coerceStringArray('GDPR')[0]).toBe('GDPR');
  });
});

describe('normalizeEntity', () => {
  it('coerces both polymorphic fields and preserves every other field', () => {
    const e = mkEntity('ent-1', {
      name: 'OpenAI',
      aliases: null as unknown as string[], // real data: 32 entities have null aliases
      source_refs: 'doc-7' as unknown as string[], // real data: bare-string source_refs
      confidence: 0.9,
    });
    const n = normalizeEntity(e);
    expect(n.aliases).toEqual([]);
    expect(n.source_refs).toEqual(['doc-7']);
    // untouched fields survive
    expect(n.name).toBe('OpenAI');
    expect(n.confidence).toBe(0.9);
    expect(n.id).toBe('ent-1');
    expect(n.entity_type).toBe('artifact');
  });

  it('leaves already-valid arrays intact', () => {
    const e = mkEntity('ent-2', { aliases: ['OAI', 'OpenAI Inc'], source_refs: ['doc-1'] });
    const n = normalizeEntity(e);
    expect(n.aliases).toEqual(['OAI', 'OpenAI Inc']);
    expect(n.source_refs).toEqual(['doc-1']);
  });

  it('does not mutate the input record', () => {
    const e = mkEntity('ent-3', { aliases: null as unknown as string[] });
    normalizeEntity(e);
    expect(e.aliases).toBeNull();
  });
});

describe('resolveMergedInto', () => {
  it('returns the record with no redirectedFrom when there is no tombstone', () => {
    const a = mkEntity('ent-a');
    const res = resolveMergedInto('ent-a', lookupFrom(a), { maxDepth: 5 });
    expect(res).toEqual({ record: a, redirectedFrom: undefined });
  });

  it('follows a single hop and reports the original id as redirectedFrom', () => {
    const a = mkEntity('ent-a', { merged_into: 'ent-b' });
    const b = mkEntity('ent-b');
    const res = resolveMergedInto('ent-a', lookupFrom(a, b), { maxDepth: 5 });
    expect(res).toEqual({ record: b, redirectedFrom: 'ent-a' });
  });

  it('follows a multi-hop chain to the terminal record', () => {
    const a = mkEntity('ent-a', { merged_into: 'ent-b' });
    const b = mkEntity('ent-b', { merged_into: 'ent-c' });
    const c = mkEntity('ent-c');
    const res = resolveMergedInto('ent-a', lookupFrom(a, b, c), { maxDepth: 5 });
    expect(res?.record.id).toBe('ent-c');
    expect(res?.redirectedFrom).toBe('ent-a'); // the ORIGINAL id, not the last hop
  });

  it('returns null when the start id is absent', () => {
    expect(resolveMergedInto('ent-missing', lookupFrom(), { maxDepth: 5 })).toBeNull();
  });

  it('returns null when a hop points at a missing id', () => {
    const a = mkEntity('ent-a', { merged_into: 'ent-gone' });
    expect(resolveMergedInto('ent-a', lookupFrom(a), { maxDepth: 5 })).toBeNull();
  });

  it('throws ActionableError on a two-node cycle (A→B→A)', () => {
    const a = mkEntity('ent-a', { merged_into: 'ent-b' });
    const b = mkEntity('ent-b', { merged_into: 'ent-a' });
    expect(() => resolveMergedInto('ent-a', lookupFrom(a, b), { maxDepth: 10 }))
      .toThrow(ActionableError);
    expect(() => resolveMergedInto('ent-a', lookupFrom(a, b), { maxDepth: 10 }))
      .toThrow(/cycle/i);
  });

  it('throws ActionableError on a self-cycle (A→A)', () => {
    const a = mkEntity('ent-a', { merged_into: 'ent-a' });
    expect(() => resolveMergedInto('ent-a', lookupFrom(a), { maxDepth: 10 }))
      .toThrow(/cycle/i);
  });

  it('throws ActionableError when the chain exceeds maxDepth', () => {
    const a = mkEntity('ent-a', { merged_into: 'ent-b' });
    const b = mkEntity('ent-b', { merged_into: 'ent-c' });
    const c = mkEntity('ent-c'); // terminal, but too far for maxDepth:1
    expect(() => resolveMergedInto('ent-a', lookupFrom(a, b, c), { maxDepth: 1 }))
      .toThrow(/depth cap/i);
  });

  it('resolves a chain that ends exactly at the depth cap', () => {
    // maxDepth:2 permits processing A, B, C (3 nodes) — the 2-hop chain terminates in time.
    const a = mkEntity('ent-a', { merged_into: 'ent-b' });
    const b = mkEntity('ent-b', { merged_into: 'ent-c' });
    const c = mkEntity('ent-c');
    const res = resolveMergedInto('ent-a', lookupFrom(a, b, c), { maxDepth: 2 });
    expect(res?.record.id).toBe('ent-c');
  });
});
