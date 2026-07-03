// @vitest-environment node
//
// t/1295 — the acceptance evidence for the server.ts route extraction (B-209):
// the ORDERED (method, path) route table must be byte-identical before and
// after clusters move to routes/*.ts. The snapshot below is the golden baseline
// captured pre-extraction (177 routes); any add/drop/reorder fails this test.
// The overlap snapshot pins the set of order-sensitive route pairs so extraction
// can't silently introduce (or reorder across) an ambiguous static-vs-:param
// pair. See extractRoutes.ts for how the table is reconstructed statically.

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractRoutes, findOrderSensitiveOverlaps } from './extractRoutes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, '..', 'server.ts');

describe('server.ts route table (t/1295 — zero-behaviour-change guard)', () => {
  const routes = extractRoutes(serverEntry);

  it('registers exactly 177 routes', () => {
    expect(routes.length).toBe(177);
  });

  it('ordered route table is unchanged (golden snapshot)', () => {
    expect(routes.map(r => `${r.method} ${r.path}`)).toMatchSnapshot();
  });

  it('the set of order-sensitive static-vs-:param overlaps is unchanged', () => {
    // Not asserting zero — some overlaps are legitimate (e.g. a literal route
    // registered before its :param sibling). We pin the SET so extraction must
    // preserve each such pair's relative registration order.
    expect(findOrderSensitiveOverlaps(routes)).toMatchSnapshot();
  });
});
