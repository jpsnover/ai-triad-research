// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2957 — write-side rationale re-merge. Both-arms test evidence required by TL #6 Q1:
// FIRE = indistinguishable twins throw ActionableError; CLEAN = ordinary save is byte-identical.
// Twin coverage is driven by CL's canonical twin-fixture.json (the authoritative specimen — case_a
// is the REAL observed twin pair, case_b constructed-indistinguishable); the inline constructed
// cases below additionally isolate the per-branch tie-break / onWarn paths.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { mergeEdgesPreservingRationale, ABSENT_BASELINE, type EdgesData } from './mergeEdgesPreservingRationale.js';
import { serializeEdgesJson } from './serializeEdges.js';
import { ActionableError } from '../debate/errors.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '../..');

const edge = (o: Record<string, unknown>) => o;

describe('mergeEdgesPreservingRationale — restore + slot (t/2957)', () => {
  it('restores a stripped edge\'s rationale from the on-disk baseline by composite key', () => {
    const onDisk: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', confidence: 0.9, rationale: 'R1 established the support', status: 'approved', model: 'm', discovered_at: 't1' })] };
    const incoming: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', confidence: 0.9, status: 'approved', model: 'm', discovered_at: 't1' })] };
    const merged = mergeEdgesPreservingRationale(incoming, onDisk);
    expect(merged.edges[0].rationale).toBe('R1 established the support');
    // t/2949 slot fix: rationale restored to its ORIGINAL position (after confidence), not appended.
    expect(Object.keys(merged.edges[0])).toEqual(['source', 'type', 'target', 'confidence', 'rationale', 'status', 'model', 'discovered_at']);
  });

  it('keeps a genuinely new edge (no baseline key) as-is; honours an editor edit to a non-rationale field', () => {
    const onDisk: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', rationale: 'R1', status: 'approved', model: 'm', discovered_at: 't1' })] };
    const incoming: EdgesData = {
      edges: [
        edge({ source: 'a', type: 'SUPPORTS', target: 'b', status: 'rejected', model: 'm', discovered_at: 't1' }), // status edited
        edge({ source: 'c', type: 'SUPPORTS', target: 'd', rationale: 'brand new', status: 'proposed', model: 'm', discovered_at: 't2' }), // new
      ],
    };
    const merged = mergeEdgesPreservingRationale(incoming, onDisk);
    expect(merged.edges[0].rationale).toBe('R1');        // restored
    expect(merged.edges[0].status).toBe('rejected');     // editor edit preserved
    expect(merged.edges[1].rationale).toBe('brand new'); // new edge untouched
  });

  it('never clobbers an incoming edge that already carries a non-empty rationale', () => {
    const onDisk: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', rationale: 'OLD', model: 'm', discovered_at: 't1' })] };
    const incoming: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', rationale: 'NEW edit', model: 'm', discovered_at: 't1' })] };
    expect(mergeEdgesPreservingRationale(incoming, onDisk).edges[0].rationale).toBe('NEW edit');
  });
});

describe('mergeEdgesPreservingRationale — absence predicate is non-empty (t/2957 #6.3 / CL Issue 3)', () => {
  const onDisk: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', rationale: 'HEAD text', model: 'm', discovered_at: 't1' })] };
  for (const empty of ['', '   ', '\n\t'] as const) {
    it(`treats rationale=${JSON.stringify(empty)} as absent → restores`, () => {
      const incoming: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', rationale: empty, model: 'm', discovered_at: 't1' })] };
      expect(mergeEdgesPreservingRationale(incoming, onDisk).edges[0].rationale).toBe('HEAD text');
    });
  }
  it('treats a missing rationale key as absent → restores', () => {
    const incoming: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', model: 'm', discovered_at: 't1' })] };
    expect(mergeEdgesPreservingRationale(incoming, onDisk).edges[0].rationale).toBe('HEAD text');
  });
});

describe('mergeEdgesPreservingRationale — rationale_source co-restore, verbatim + absent-stays-absent (t/2943 / CL Q2)', () => {
  it('carries rationale_source verbatim from the baseline', () => {
    const onDisk: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', rationale: 'R', rationale_source: 'backfill', model: 'm', discovered_at: 't1' })] };
    const incoming: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', model: 'm', discovered_at: 't1' })] };
    expect(mergeEdgesPreservingRationale(incoming, onDisk).edges[0].rationale_source).toBe('backfill');
  });
  it('leaves rationale_source ABSENT when the baseline had none — never coerces to null', () => {
    const onDisk: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', rationale: 'R', model: 'm', discovered_at: 't1' })] };
    const incoming: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', model: 'm', discovered_at: 't1' })] };
    const out = mergeEdgesPreservingRationale(incoming, onDisk).edges[0];
    expect(out.rationale).toBe('R');
    expect('rationale_source' in out).toBe(false);
  });
});

describe('mergeEdgesPreservingRationale — twin-aware identity (constructed)', () => {
  // Two genuinely distinct edges sharing source|type|target, distinguishable by discovered_at+model.
  const distinguishableOnDisk: EdgesData = {
    edges: [
      edge({ source: 'a', type: 'SUPPORTS', target: 'b', rationale: 'twin-1 rationale', model: 'm1', discovered_at: 't1' }),
      edge({ source: 'a', type: 'SUPPORTS', target: 'b', rationale: 'twin-2 rationale', model: 'm2', discovered_at: 't2' }),
    ],
  };

  it('re-merges EACH distinguishable twin its OWN rationale via discovered_at+model tie-break', () => {
    const incoming: EdgesData = {
      edges: [
        edge({ source: 'a', type: 'SUPPORTS', target: 'b', model: 'm2', discovered_at: 't2' }),
        edge({ source: 'a', type: 'SUPPORTS', target: 'b', model: 'm1', discovered_at: 't1' }),
      ],
    };
    const merged = mergeEdgesPreservingRationale(incoming, distinguishableOnDisk);
    expect(merged.edges[0].rationale).toBe('twin-2 rationale'); // m2/t2
    expect(merged.edges[1].rationale).toBe('twin-1 rationale'); // m1/t1
  });

  it('FIRE: indistinguishable twins (same key AND discovered_at AND model) throw ActionableError — never guesses', () => {
    const indistinguishableOnDisk: EdgesData = {
      edges: [
        edge({ source: 'a', type: 'SUPPORTS', target: 'b', rationale: 'twin-A', model: 'm', discovered_at: 't' }),
        edge({ source: 'a', type: 'SUPPORTS', target: 'b', rationale: 'twin-B', model: 'm', discovered_at: 't' }),
      ],
    };
    const incoming: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', model: 'm', discovered_at: 't' })] };
    expect(() => mergeEdgesPreservingRationale(incoming, indistinguishableOnDisk)).toThrow(ActionableError);
    expect(() => mergeEdgesPreservingRationale(incoming, indistinguishableOnDisk)).toThrow(/Ambiguous rationale attribution/);
  });

  it('no twin matched (baseline twins, incoming discovered_at/model matches neither) → onWarn, no guess, no throw', () => {
    const incoming: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', model: 'm3', discovered_at: 't3' })] };
    const onWarn = vi.fn();
    const merged = mergeEdgesPreservingRationale(incoming, distinguishableOnDisk, onWarn);
    expect('rationale' in merged.edges[0]).toBe(false);   // not guessed
    expect(onWarn).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ candidateCount: 2 }) }));
  });
});

// Canonical twin fixture — CL's authoritative specimen (twin-fixture.json, PR #1443). Single source
// of truth shared across restore (t/2946), this re-merge util (t/2957), and the TS write-guard, so the
// three cannot drift. case_a = the REAL acc-beliefs-051|SUPPORTS|acc-desires-001 twin pair from
// ba3128f5 (distinguishable on discovered_at+model → per-twin restore); case_b = constructed
// indistinguishable twins → refuse-and-log. Loading from the file (not re-inlining) is what keeps the
// util's behaviour locked to CL's identity model verbatim.
describe('mergeEdgesPreservingRationale — canonical twin fixture (CL twin-fixture.json, t/2957)', () => {
  const fixture = JSON.parse(
    readFileSync(path.join(repoRoot, 'research/comp-linguist/analyses/t2444-rationale-restore/twin-fixture.json'), 'utf8'),
  ) as {
    case_a_distinguishable: { on_disk: EdgesData; save_payload: EdgesData; expected_merged: EdgesData };
    case_b_indistinguishable: { on_disk: EdgesData; save_payload: EdgesData };
  };

  it('case_a distinguishable twins → each twin restored ITS OWN rationale at the original slot (deep-equals expected_merged)', () => {
    const { on_disk, save_payload, expected_merged } = fixture.case_a_distinguishable;
    const merged = mergeEdgesPreservingRationale(save_payload, on_disk);
    expect(merged.edges).toEqual(expected_merged.edges);
    // Explicit no-cross-attribution assertion (the failure mode this case guards): each twin keeps its own.
    expect(merged.edges[0].discovered_at).toBe('2026-04-06');
    expect(merged.edges[0].rationale).toBe(expected_merged.edges[0].rationale);
    expect(merged.edges[1].discovered_at).toBe('2026-06-11');
    expect(merged.edges[1].rationale).toBe(expected_merged.edges[1].rationale);
  });

  it('case_b indistinguishable twins (same key AND discovered_at AND model) → refuse-and-log ActionableError, never guesses', () => {
    const { on_disk, save_payload } = fixture.case_b_indistinguishable;
    expect(() => mergeEdgesPreservingRationale(save_payload, on_disk)).toThrow(ActionableError);
    expect(() => mergeEdgesPreservingRationale(save_payload, on_disk)).toThrow(/Ambiguous rationale attribution/);
  });
});

describe('mergeEdgesPreservingRationale — baseline discrimination (t/2957 #6.1 BLOCKER / CL Issue 1)', () => {
  const incoming: EdgesData = { edges: [edge({ source: 'a', type: 'SUPPORTS', target: 'b', model: 'm', discovered_at: 't1' })] };

  it('ABSENT_BASELINE (genuine first write) → writes incoming as-is, no error', () => {
    expect(mergeEdgesPreservingRationale(incoming, ABSENT_BASELINE)).toEqual(incoming);
  });

  it('a malformed/unreadable baseline (read failure) THROWS — refuses to write a stripped payload', () => {
    // read-failure shapes the two fileIO twins can produce vs a genuine absence.
    for (const bad of [null, undefined, {}, { edges: 'not-an-array' }, 'garbage'] as unknown[]) {
      expect(() => mergeEdgesPreservingRationale(incoming, bad as never)).toThrow(/could not be read as a valid/);
    }
  });
});

describe('mergeEdgesPreservingRationale — CLEAN case is byte-identical (t/2957 #6 Q1)', () => {
  it('an ordinary save with no rationale-bearing baseline delta serializes byte-identically', () => {
    // Neither incoming nor baseline carries rationale for these keys → nothing to restore.
    const incoming: EdgesData = {
      _schema_version: '1.0.0',
      edges: [
        edge({ source: 'a', type: 'SUPPORTS', target: 'b', confidence: 0.9, status: 'approved', model: 'm', discovered_at: 't1' }),
        edge({ source: 'c', type: 'TENSION_WITH', target: 'd', confidence: 0.8, status: 'proposed', model: 'm', discovered_at: 't2' }),
      ],
    };
    const onDisk: EdgesData = { _schema_version: '1.0.0', edges: incoming.edges.map(e => ({ ...e })) };
    const merged = mergeEdgesPreservingRationale(incoming, onDisk);
    expect(serializeEdgesJson(merged)).toBe(serializeEdgesJson(incoming)); // byte-identical
  });
});
