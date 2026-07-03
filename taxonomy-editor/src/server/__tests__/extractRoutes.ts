// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1295 — permanent route-table invariant checker for the server.ts route
// extraction (repo-review B-209). Statically reconstructs the ORDERED route
// table by scanning server.ts top-to-bottom for get/post/put/del registrations,
// and — once clusters are extracted — following `register<Cluster>Routes(...)`
// calls into `routes/<cluster>.ts` at the exact position they're invoked. This
// yields the identical ordered table pre- and post-extraction, so the snapshot
// test (routeTable.test.ts) proves zero behaviour change by construction.
//
// Static (no execution): server.ts boots an HTTP server at import, so we must
// not import it to introspect. Route registrations are single-line and the path
// is the first string literal — see the matcher in server.ts (matchRoute).

import fs from 'fs';
import path from 'path';

export interface RouteEntry { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string }

const METHOD: Record<string, RouteEntry['method']> = { get: 'GET', post: 'POST', put: 'PUT', del: 'DELETE' };

// e.g.  get('/api/foo', ...)   put('/api/bar/:id', ...)
const REG_RE = /^\s*(get|post|put|del)\(\s*['"]([^'"]+)['"]/;
// e.g.  registerDebatesRoutes(r, ctx)  → recurse into routes/debates.ts
const INCLUDE_RE = /^\s*register([A-Z]\w*?)Routes\(/;

/**
 * Extract the ordered route table starting from `entryFile`, following cluster
 * `register<Cluster>Routes(...)` calls into `routes/<cluster>.ts` in place.
 * `seen` guards against accidental include cycles.
 */
export function extractRoutes(entryFile: string, seen = new Set<string>()): RouteEntry[] {
  const abs = path.resolve(entryFile);
  if (seen.has(abs)) return [];
  seen.add(abs);

  const dir = path.dirname(abs);
  const out: RouteEntry[] = [];
  for (const line of fs.readFileSync(abs, 'utf-8').split(/\r?\n/)) {
    const reg = REG_RE.exec(line);
    if (reg) { out.push({ method: METHOD[reg[1]], path: reg[2] }); continue; }

    const inc = INCLUDE_RE.exec(line);
    if (inc) {
      const cluster = inc[1].toLowerCase();
      const clusterFile = path.join(dir, 'routes', `${cluster}.ts`);
      if (fs.existsSync(clusterFile)) out.push(...extractRoutes(clusterFile, seen));
    }
  }
  return out;
}

/**
 * Pairs of same-method routes where registration order changes which handler
 * wins: equal segment count and a static-vs-:param overlap at some position
 * such that a concrete request path matches both. These are the only routes
 * whose relative order must be preserved during extraction.
 */
export function findOrderSensitiveOverlaps(routes: RouteEntry[]): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i], b = routes[j];
      if (a.method !== b.method) continue;
      const ap = a.path.split('/'), bp = b.path.split('/');
      if (ap.length !== bp.length) continue;
      let compatible = true, differsByStaticVsParam = false;
      for (let k = 0; k < ap.length; k++) {
        const aParam = ap[k].startsWith(':'), bParam = bp[k].startsWith(':');
        if (aParam || bParam) {
          if (aParam !== bParam) differsByStaticVsParam = true; // one literal, one :param here
          continue; // a param matches any literal → still compatible
        }
        if (ap[k] !== bp[k]) { compatible = false; break; } // two different literals → disjoint
      }
      if (compatible && differsByStaticVsParam) {
        pairs.push(`${a.method} ${a.path}  ⟷  ${b.path}  (order matters: registration order wins)`);
      }
    }
  }
  return pairs.sort();
}
