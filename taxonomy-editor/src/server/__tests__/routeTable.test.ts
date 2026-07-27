// @vitest-environment node
//
// t/1295 — acceptance evidence for the server.ts route extraction (B-209).
// TL-approved invariant (t/1295#7): the extraction is zero-behaviour-change iff
//   1. the route SET is unchanged (no add/drop), and
//   2. every pair of routes that can match a common request (unifiable patterns)
//      keeps its relative registration order.
// matchRoute is first-match, so those are the only order-relevant facts — this is
// necessary AND sufficient. The ordered table is kept as an informational diff
// (expected to change as clusters consolidate) — see extractRoutes.ts.

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractRoutes, findCollisionPairs } from './extractRoutes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, '..', 'server.ts');

describe('server.ts route table (t/1295 — zero-behaviour-change guard)', () => {
  const routes = extractRoutes(serverEntry);

  it('registers exactly 185 routes', () => {
    expect(routes.length).toBe(185); // +GET /api/admin/usages (t/1265); +GET /api/organizations/:id/edges (t/1530); +POST/DELETE /api/cruxes/:id/evidence (t/1541); +PATCH /api/debates/:id (t/1636); +GET /api/entity/:ref (t/1786)
  });

  // GATE 1 — set identity: sorted (method, path) multiset. Fails on any add/drop.
  it('route set is unchanged', () => {
    expect(routes.map(r => `${r.method} ${r.path}`).sort()).toMatchSnapshot();
  });

  // GATE 2 — collision-pair order: each entry encodes earlier-registered on the
  // left, so this fails if a colliding pair is added, dropped, or reordered.
  it('unifiable route pairs preserve registration order', () => {
    expect(findCollisionPairs(routes)).toMatchSnapshot();
  });

  // INFORMATIONAL — the ordered table WILL change as clusters consolidate; update
  // with `vitest -u` per extraction commit and review the diff. Not a correctness
  // gate (gates 1 & 2 are), just a human-readable record of the move.
  it('ordered route table (informational — expected to change as clusters move)', () => {
    expect(routes.map(r => `${r.method} ${r.path}`)).toMatchSnapshot();
  });
});
