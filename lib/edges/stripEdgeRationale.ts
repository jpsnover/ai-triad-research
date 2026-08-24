// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// The ONE shared edge-rationale strip projection (t/2949). The edges.json file carries large
// per-edge `rationale` strings (~7 MB); list and mutation responses strip them so clients get a
// ~37% smaller payload — the on-disk file and in-memory cache keep full data, and full rationale
// is served per-edge via GET /api/edges/:index.
//
// This lives in lib/edges as the single home so BOTH TS writers import it — the Electron main
// process (which cannot import server code) and the server route helper. The t/2949 defect was
// exactly a DUPLICATED strip: the server `edgesApi.ts` helper plus an inline COPY in the main
// process (taxonomyHandlers.ts:260-266). Two implementations drift; collapsing to one call is the
// fix. (Byte-identical to the prior edgesApi.ts implementation — a pure projection.)

import type { EdgesData } from './mergeEdgesPreservingRationale.js';

export type { EdgesData };

/**
 * Return a shallow copy of the edges file with `rationale` removed from every edge. Non-object /
 * missing-edges input is returned unchanged (defensive — the caller may pass a null cache or an
 * unexpected shape). Removes ONLY `rationale`; all other fields (incl. `rationale_source`,
 * `discovered_at`, `model`) are preserved so the write-side re-merge can tie-break twins.
 */
export function stripEdgeRationale(data: unknown): unknown {
  const d = data as EdgesData | null;
  if (!d || !Array.isArray(d.edges)) return data;
  return { ...d, edges: d.edges.map(({ rationale: _rationale, ...rest }) => rest) };
}
