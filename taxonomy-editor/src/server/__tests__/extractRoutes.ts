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

export interface RouteEntry { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string }

const METHOD: Record<string, RouteEntry['method']> = { get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', del: 'DELETE' };

/**
 * Resolve `register<Cluster>Routes(...)` to its `routes/<cluster>.ts` file. The
 * cluster capture is PascalCase (e.g. `PublicShare`); the file is conventionally
 * its lowercased form. A single-word cluster (`Organizations`) already IS its
 * filename lowercased, but a multi-word one (`PublicShare` → `publicShare.ts`)
 * keeps interior capitals — so the naive `<cluster>.ts` lookup misses on a
 * case-sensitive filesystem (Linux CI) while passing on case-insensitive Windows.
 * Fall back to a case-insensitive scan of routes/ so the extractor resolves such
 * files identically on every platform (else the routeTable snapshot would diverge
 * dev↔CI). Returns the absolute path, or null if no matching module exists.
 */
function resolveClusterFile(dir: string, cluster: string): string | null {
  const routesDir = path.join(dir, 'routes');
  const target = `${cluster.toLowerCase()}.ts`;
  const exact = path.join(routesDir, target);
  if (fs.existsSync(exact)) return exact;
  if (!fs.existsSync(routesDir)) return null;
  const match = fs.readdirSync(routesDir).find(f => f.toLowerCase() === target);
  return match ? path.join(routesDir, match) : null;
}

// e.g.  get('/api/foo', ...)   put('/api/bar/:id', ...)   patch('/api/baz/:id', ...)
const REG_RE = /^\s*(get|post|put|patch|del)\(\s*['"]([^'"]+)['"]/;
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
      const clusterFile = resolveClusterFile(dir, inc[1]);
      if (clusterFile) out.push(...extractRoutes(clusterFile, seen));
    }
  }
  return out;
}

/**
 * Pairs of same-method routes whose patterns are **unifiable** — i.e. some
 * concrete request path matches both — so `matchRoute` (first-match) resolves
 * them by registration order. Predicate (per TL t/1295#7, necessary+sufficient):
 * same method, same segment count, and at every position either the literals
 * are equal or at least one side is a `:param`. This subsumes static-vs-param
 * and also catches param-vs-param collisions (`/x/:a/y` ⟷ `/x/:b/y`). These are
 * the only routes whose relative registration order must be preserved.
 *
 * Each entry encodes the earlier-registered route on the LEFT, so a snapshot of
 * this list gates BOTH membership (which pairs collide) AND order (a flip swaps
 * the sides and changes the string).
 */
export function findCollisionPairs(routes: RouteEntry[]): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i], b = routes[j];
      if (a.method !== b.method) continue;
      const ap = a.path.split('/'), bp = b.path.split('/');
      if (ap.length !== bp.length) continue;
      let unifiable = true;
      for (let k = 0; k < ap.length; k++) {
        const aParam = ap[k].startsWith(':'), bParam = bp[k].startsWith(':');
        if (aParam || bParam) continue;              // a param matches any segment
        if (ap[k] !== bp[k]) { unifiable = false; break; } // two differing literals → disjoint
      }
      if (unifiable) pairs.push(`${a.method} ${a.path}  ⟷  ${b.path}  (first-registered wins)`);
    }
  }
  return pairs.sort();
}
