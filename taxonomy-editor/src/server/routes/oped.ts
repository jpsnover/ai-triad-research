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
import { listOpedSets, loadOpedSet, deleteOpedSet, getOpedSetsQuotaStatus, finalizeOpedSet } from '../storage/opedStore.js';
import type { OpEdSet } from '../../../../lib/oped/types.js';

const ROUTE_ID = '/api/oped-sets/:id';

// Rename guard: a set-level topic is a short title, not an essay. Cap it to reject
// pathological payloads without rejecting legitimately long topic lines.
const MAX_TOPIC_LEN = 2000;

/** set_id validation at the route boundary (the audit class — t/2526 shared
 *  validator): reject a traversal/unsafe id with 400 before the store read. The
 *  store funcs also assertSafeId (defense-in-depth), but pre-validating here maps
 *  a bad id to 400 rather than the store's thrown 400-tagged ActionableError. */
function rejectUnsafeId(res: import('http').ServerResponse, id: string): boolean {
  if (!isSafeId(id)) { error(res, 'Invalid oped-set id', 400); return true; }
  return false;
}

export function registerOpedRoutes(r: Router, _ctx: ServerCtx): void {
  const { get, put, del } = r;

  // Row summaries only (topic/camps/voice_count/dates) — never full docs.
  // .inprogress blobs are invisible (store contract). Anonymous → [].
  get('/api/oped-sets', async (_req, res) => {
    try { json(res, await listOpedSets()); }
    catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'oped', level: 'error', message: 'Failed to list oped-sets', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 500, err);
    }
  });

  // t/2573: read-only quota pre-check (mirrors GET /api/debates/quota-status).
  // MUST be registered before /api/oped-sets/:id — the :id wildcard would otherwise
  // match "quota-status" (both GET, 3 segments; literal wins by first-match).
  // Delegates to getOpedSetsQuotaStatus() so the pre-check never diverges from the
  // cap the finalizeOpedSet path enforces (Shared Utility Rule).
  get('/api/oped-sets/quota-status', async (_req, res) => {
    try { json(res, await getOpedSetsQuotaStatus()); }
    catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'oped', level: 'error', message: 'Failed to check oped quota', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
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

  // t/2594 (parent t/2592, TL-approved t/2576#14): rename an existing set — the
  // ONLY mutation on the web build. UPDATE-ONLY: it must never CREATE a set
  // (creation stays Electron-only, TL ruling). Design (p/256#6) fixed the editable
  // field to the set-level `topic`; member headlines/bodies are generated content
  // and are NEVER touched here, so we whitelist `topic` and overlay it onto the
  // STORED set rather than trusting the client's (possibly full-OpEdSet) body.
  put('/api/oped-sets/:id', async (req, res, body) => {
    const id = param(req, 'id', ROUTE_ID);
    if (rejectUnsafeId(res, id)) return;
    const topic = (body as { topic?: unknown } | null)?.topic;
    if (typeof topic !== 'string' || topic.trim() === '' || topic.length > MAX_TOPIC_LEN) {
      error(res, `topic is required and must be a non-empty string (≤${MAX_TOPIC_LEN} chars)`, 400);
      return;
    }
    try {
      // load-then-404 — the load-bearing guard: a PUT to an absent id is NOT a
      // create, it's a 404. Keeps op-ed creation Electron-only.
      const stored = await loadOpedSet(id) as OpEdSet | null;
      if (stored === null) { error(res, 'Op-ed set not found', 404); return; }
      // Existing set → finalizeOpedSet does NOT quota-check (verified: it gates
      // NEW sets only). Only `topic` changes; every member passes through intact.
      await finalizeOpedSet({ ...stored, topic });
      json(res, { ok: true });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'oped', level: 'error', message: 'Failed to rename oped-set', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), (err as { statusCode?: number }).statusCode ?? 500, err);
    }
  });
}
