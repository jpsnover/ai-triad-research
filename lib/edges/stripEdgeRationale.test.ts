// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2949 — the ONE shared strip projection now lives in lib/edges. These lock the projection
// contract both TS writers (server edgesApi.ts + main taxonomyHandlers.ts) will call into.

import { describe, it, expect } from 'vitest';
import { stripEdgeRationale } from './stripEdgeRationale.js';

describe('stripEdgeRationale (shared lib/edges home, t/2949)', () => {
  it('removes ONLY rationale — preserves rationale_source, discovered_at, model, and all other fields', () => {
    const input = { _schema_version: '1.0.0', edges: [{ source: 'a', type: 'SUPPORTS', target: 'b', rationale: 'R', rationale_source: 'backfill', discovered_at: 't1', model: 'm', confidence: 0.9 }] };
    const out = stripEdgeRationale(input) as { edges: Record<string, unknown>[] };
    expect('rationale' in out.edges[0]).toBe(false);
    expect(out.edges[0]).toEqual({ source: 'a', type: 'SUPPORTS', target: 'b', rationale_source: 'backfill', discovered_at: 't1', model: 'm', confidence: 0.9 });
  });

  it('returns non-object / missing-edges input unchanged (defensive)', () => {
    expect(stripEdgeRationale(null)).toBeNull();
    expect(stripEdgeRationale({ foo: 1 })).toEqual({ foo: 1 });
  });

  it('preserves top-level keys and does not mutate the input', () => {
    const input = { _schema_version: '1.0.0', last_modified: 'x', edges: [{ source: 'a', type: 'T', target: 'b', rationale: 'R' }] };
    const out = stripEdgeRationale(input) as { _schema_version: string; last_modified: string; edges: Record<string, unknown>[] };
    expect(out._schema_version).toBe('1.0.0');
    expect(out.last_modified).toBe('x');
    expect(input.edges[0].rationale).toBe('R'); // input not mutated
  });
});
