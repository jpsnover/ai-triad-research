// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1687 (Phase 2 server.ts split, ADR-007): the lineage / edges / source-index /
// data-availability / feature-flags read run, moved verbatim out of server.ts
// behind the registration seam. This run sits between registerOrganizationsRoutes
// and registerAdminRoutes, so registration order — and the routeTable snapshot —
// is preserved by placing registerEdgesRoutes() at its former position. The
// module-local `edgesCache` (read/written only by these edges handlers) moves in
// with them; ServerCtx is threaded but unused (handlers depend only on imports).

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, param, query } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import * as fileIO from '../storage/fileIO.js';
import { stripEdgeRationale, type EdgesData } from '../community/edgesApi.js';
import { getAllFlags } from '../featureFlags.js';

export function registerEdgesRoutes(r: Router, _ctx: ServerCtx): void {
  const { get, put } = r;

  // ── Lineage categories ──

  get('/api/lineage-categories', async (_req, res) => {
    json(res, await fileIO.readLineageCategories());
  });

  get('/api/lineage-info', async (_req, res) => {
    json(res, await fileIO.readLineageEnrichments());
  });

  // ── Edges ──

  let edgesCache: unknown = null;

  get('/api/edges', async (req, res) => {
    edgesCache = await fileIO.readEdgesFile();
    if (!edgesCache) { json(res, null); return; }
    // ?include=rationale returns the full payload (backwards-compat for scripts).
    if (query(req, 'include') === 'rationale') { json(res, edgesCache); return; }
    json(res, stripEdgeRationale(edgesCache));
  });

  get('/api/edges/:index', async (req, res) => {
    if (!edgesCache) edgesCache = await fileIO.readEdgesFile();
    const data = edgesCache as EdgesData | null;
    const index = parseInt(param(req, 'index', '/api/edges/:index'), 10);
    if (!data?.edges || isNaN(index) || index < 0 || index >= data.edges.length) {
      error(res, 'Edge not found', 404);
      return;
    }
    json(res, data.edges[index]);
  });

  put('/api/edges/status', async (_req, res, body) => {
    const { index, status: s } = body as { index: number; status: string };
    if (!edgesCache) edgesCache = await fileIO.readEdgesFile();
    edgesCache = await fileIO.updateEdgeStatus(edgesCache, index, s);
    json(res, stripEdgeRationale(edgesCache));
  });

  put('/api/edges/swap', async (_req, res, body) => {
    const { index } = body as { index: number };
    if (!edgesCache) edgesCache = await fileIO.readEdgesFile();
    edgesCache = await fileIO.swapEdgeDirection(edgesCache, index);
    json(res, stripEdgeRationale(edgesCache));
  });

  put('/api/edges/bulk-status', async (_req, res, body) => {
    const { indices, status: s } = body as { indices: number[]; status: string };
    if (!edgesCache) edgesCache = await fileIO.readEdgesFile();
    edgesCache = await fileIO.bulkUpdateEdges(edgesCache, indices, s);
    json(res, stripEdgeRationale(edgesCache));
  });

  // ── Source indexes ──

  get('/api/node-source-index', async (_req, res) => {
    json(res, await fileIO.buildNodeSourceIndex());
  });

  get('/api/policy-source-index', async (_req, res) => {
    json(res, await fileIO.buildPolicySourceIndex());
  });

  // ── Data management ──

  get('/api/data/available', async (_req, res) => {
    json(res, await fileIO.isDataAvailable());
  });

  // ── Feature flags (t/899) ──

  // Resolved flags for the current user (any caller). The UI gates features on these.
  get('/api/flags', (_req, res) => {
    try { json(res, getAllFlags()); }
    catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error', message: 'Failed to resolve feature flags',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });
}
