// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2573 (parent epic t/2570, Op-Ed Studio spec §9): the /api/oped-sets route
// cluster — the REST *library* surface for the web build (list/load/delete),
// parallel to the debate-session set (routes/debates.ts). Backed by the
// personal oped-set store (storage/opedStore.ts, t/2572).
//
// v1 has NO create/generation route — New-OpEd is PowerShell and the web
// container can't run it (TL feasibility ruling, t/2573). The web UI surfaces a
// "create in the desktop app" affordance; generation stays Electron-only until a
// TS port is decided (separate epic-level call).
//
// Anonymous contract: opedStore returns []/null and no-ops for anonymous users
// (there is no anonymous oped tier). So GET is safe for anon (empty result) and
// DELETE is deliberately left anon-blocked by the default auth gate
// (isAnonAllowedRoute) — an anon caller has no oped-sets to delete.

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, param } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { isSafeId } from '../storage/fileIO.js';
import { listOpedSets, loadOpedSet, deleteOpedSet } from '../storage/opedStore.js';

const ROUTE_ID = '/api/oped-sets/:id';

/** set_id validation at the route boundary (the audit class — t/2526 shared
 *  validator): reject a traversal/unsafe id with 400 before the store read. The
 *  store funcs also assertSafeId (defense-in-depth), but pre-validating here maps
 *  a bad id to 400 rather than the store's thrown 400-tagged ActionableError. */
function rejectUnsafeId(res: import('http').ServerResponse, id: string): boolean {
  if (!isSafeId(id)) { error(res, 'Invalid oped-set id', 400); return true; }
  return false;
}

export function registerOpedRoutes(r: Router, _ctx: ServerCtx): void {
  const { get, del } = r;

  // Row summaries only (topic/camps/voice_count/dates) — never full docs.
  // .inprogress blobs are invisible (store contract). Anonymous → [].
  get('/api/oped-sets', async (_req, res) => {
    try { json(res, await listOpedSets()); }
    catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'oped', level: 'error', message: 'Failed to list oped-sets', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 500, err);
    }
  });

  // Load a finalized OpEdSet. Partial sets pass through UNTOUCHED — a member's
  // status ('failed'|'cancelled') is data the reader renders, not an error here.
  get('/api/oped-sets/:id', async (req, res) => {
    const id = param(req, 'id', ROUTE_ID);
    if (rejectUnsafeId(res, id)) return;
    try {
      const set = await loadOpedSet(id);
      if (set === null) { error(res, 'Op-ed set not found', 404); return; }
      json(res, set);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'oped', level: 'warn', message: 'Failed to load oped-set', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 404, err);
    }
  });

  del('/api/oped-sets/:id', async (req, res) => {
    const id = param(req, 'id', ROUTE_ID);
    if (rejectUnsafeId(res, id)) return;
    try {
      await deleteOpedSet(id);
      json(res, { ok: true });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'oped', level: 'error', message: 'Failed to delete oped-set', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 500, err);
    }
  });
}
