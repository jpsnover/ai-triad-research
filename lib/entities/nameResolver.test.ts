// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  resolveEntityName,
  normalizeName,
  ENTITY_RESOLUTION_MIN_COSINE,
  ENTITY_RESOLUTION_MARGIN,
  type ApprovedEntityView,
} from './nameResolver.js';

// Two entities sharing the exact alias "Chris" — the canonical alias-collision fixture.
const CHRIS_OLAH: ApprovedEntityView = { id: 'ent-010', name: 'Chris Olah', aliases: ['Chris', 'Olah'] };
const CHRIS_MANNING: ApprovedEntityView = { id: 'ent-011', name: 'Chris Manning', aliases: ['Chris', 'Manning'] };
const BENGIO: ApprovedEntityView = { id: 'ent-001', name: 'Yoshua Bengio', aliases: ['Bengio'] };
const ANTHROPIC: ApprovedEntityView = { id: 'org-001', name: 'Anthropic', aliases: ['Anthropic PBC'] };

// A trivial vector store keyed by entity id.
function vectorStore(map: Record<string, number[]>): (id: string) => number[] | undefined {
  return (id) => map[id];
}
const noVectors = (): number[] | undefined => undefined;

describe('normalizeName', () => {
  it('case-folds, trims, and collapses interior whitespace runs', () => {
    expect(normalizeName('  Yoshua   BENGIO ')).toBe('yoshua bengio');
  });

  it('collapses tabs / newlines / NBSP as whitespace', () => {
    expect(normalizeName('Frontier\tModel Forum')).toBe('frontier model forum');
  });

  it('is idempotent', () => {
    const once = normalizeName('  EU  AI   Act ');
    expect(normalizeName(once)).toBe(once);
  });

  it('does NOT fold diacritics (refusal discipline — no over-matching)', () => {
    expect(normalizeName('Kwaśniewski')).not.toBe('kwasniewski');
  });

  it('returns empty for whitespace-only input', () => {
    expect(normalizeName('   \t \n ')).toBe('');
  });
});

describe('resolveEntityName — alias-first', () => {
  it('resolves a unique alias hit via alias', () => {
    const r = resolveEntityName({ name: 'Bengio' }, [BENGIO, ANTHROPIC], noVectors);
    expect(r).toEqual({ status: 'resolved', ref: { kind: 'entity', id: 'ent-001' }, via: 'alias' });
  });

  it('resolves a unique canonical-name hit via alias', () => {
    const r = resolveEntityName({ name: 'Yoshua Bengio' }, [BENGIO], noVectors);
    expect(r.status).toBe('resolved');
    expect(r.via).toBe('alias');
    expect(r.ref).toEqual({ kind: 'entity', id: 'ent-001' });
  });

  it('matches case- and whitespace-variant aliases (normalized both sides)', () => {
    const r = resolveEntityName({ name: '  yoshua   bengio ' }, [BENGIO], noVectors);
    expect(r.status).toBe('resolved');
    expect(r.ref).toEqual({ kind: 'entity', id: 'ent-001' });
  });

  it('produces an organization ref for an org-* id', () => {
    const r = resolveEntityName({ name: 'Anthropic' }, [ANTHROPIC], noVectors);
    expect(r).toEqual({ status: 'resolved', ref: { kind: 'organization', id: 'org-001' }, via: 'alias' });
  });

  it('does not match entities absent from the approved array (caller filters status)', () => {
    // Resolver only ever considers what it is handed — a proposed/deprecated record the
    // caller withheld is simply not present, so this is unresolved.
    const r = resolveEntityName({ name: 'Bengio' }, [ANTHROPIC], noVectors);
    expect(r.status).toBe('unresolved');
  });
});

describe('resolveEntityName — refusal', () => {
  it('returns unresolved on no alias hit (curation gap, no open-NN)', () => {
    const r = resolveEntityName(
      { name: 'Some Unknown Person', contextVector: [1, 0, 0] },
      [BENGIO, ANTHROPIC],
      vectorStore({ 'ent-001': [1, 0, 0], 'org-001': [1, 0, 0] }),
    );
    expect(r.status).toBe('unresolved');
  });

  it('returns unresolved on an empty/whitespace query', () => {
    expect(resolveEntityName({ name: '   ' }, [BENGIO], noVectors).status).toBe('unresolved');
  });
});

describe('resolveEntityName — embedding tie-break among alias collisions', () => {
  const collided = [CHRIS_OLAH, CHRIS_MANNING];

  it('breaks a collision when the top candidate clears floor and margin', () => {
    const r = resolveEntityName(
      { name: 'Chris', contextVector: [1, 0, 0] },
      collided,
      vectorStore({ 'ent-010': [1, 0, 0], 'ent-011': [0, 1, 0] }), // 1.0 vs 0.0
    );
    expect(r.status).toBe('resolved');
    expect(r.via).toBe('embedding');
    expect(r.ref).toEqual({ kind: 'entity', id: 'ent-010' });
    expect(r.score).toBeCloseTo(1, 5);
  });

  it('refuses (ambiguous) when separation is below the margin', () => {
    const r = resolveEntityName(
      { name: 'Chris', contextVector: [1, 1, 0] },
      collided,
      vectorStore({ 'ent-010': [1, 1, 0], 'ent-011': [1, 0.9, 0] }), // ~1.0 vs ~0.999
    );
    expect(r.status).toBe('ambiguous');
    expect(r.candidates).toEqual([
      { kind: 'entity', id: 'ent-010' },
      { kind: 'entity', id: 'ent-011' },
    ]);
  });

  it('refuses when the top candidate is below the cosine floor', () => {
    const r = resolveEntityName(
      { name: 'Chris', contextVector: [1, 0, 0] },
      collided,
      vectorStore({ 'ent-010': [0.5, 1, 0], 'ent-011': [0, 1, 0] }), // ~0.447 vs 0.0
    );
    expect(r.status).toBe('ambiguous');
  });

  it('refuses when no context vector is supplied to break the collision', () => {
    const r = resolveEntityName({ name: 'Chris' }, collided, noVectors);
    expect(r.status).toBe('ambiguous');
    expect(r.candidates).toHaveLength(2);
  });

  it('refuses when a colliding candidate has no vector (cannot assert separation)', () => {
    const r = resolveEntityName(
      { name: 'Chris', contextVector: [1, 0, 0] },
      collided,
      vectorStore({ 'ent-010': [1, 0, 0] }), // ent-011 missing → not all scoreable
    );
    expect(r.status).toBe('ambiguous');
  });

  it('honors caller-supplied threshold overrides', () => {
    // With a very low floor and zero margin, a weak-but-separated top resolves.
    const r = resolveEntityName(
      { name: 'Chris', contextVector: [1, 0, 0] },
      collided,
      vectorStore({ 'ent-010': [0.5, 1, 0], 'ent-011': [0, 1, 0] }),
      { minCosine: 0.1, margin: 0 },
    );
    expect(r.status).toBe('resolved');
    expect(r.ref).toEqual({ kind: 'entity', id: 'ent-010' });
  });
});

describe('exported thresholds', () => {
  it('pins the documented defaults', () => {
    expect(ENTITY_RESOLUTION_MIN_COSINE).toBe(0.6);
    expect(ENTITY_RESOLUTION_MARGIN).toBe(0.05);
  });
});
