// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1383 (route extraction, t/1347 follow-up): the /api/taxonomy read/write +
// synthetic-corpus + node-edit-history routes, moved verbatim out of server.ts
// behind the registration seam. The only non-verbatim change is the PUT, whose
// session-branch ensure now comes through ctx.ensureSessionBranch. The
// synthetic-embeddings ⟷ :pov collision pair is internal and registered in
// source order (synthetic-embeddings first), so first-match routing is preserved
// (see routeTable.test.ts).

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, param, jsonStringifyChunked, sendJsonBuffer } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import * as fileIO from '../storage/fileIO.js';
import { stampNodeAuthorship, diffNodes } from '../storage/editMeta.js';
import { isAnonymousUser } from '../security/userContext.js';
import { getFlag } from '../featureFlags.js';
import { enqueueGroundingReconcile } from '../groundingReconcileHook.js';
import { log } from '../logger.js';

// ── t/3165: serialize-once cache for /api/taxonomy/synthetic-embeddings ───────────────────────────
// The synthetic corpus (~4144 vectors, ~400MB) is STATIC, but loadSyntheticEmbeddings() rebuilds it on
// EVERY call (per-POV .npy network read + parseNpy + build) and the route re-JSON.stringify'd it — an
// un-yielded ~3s main-thread block + ~400MB GC churn, once PER DEBATE (taxonomyContext fetches the full
// corpus). Cache the SERIALIZED Buffer: the cold path builds+serializes once (chunk-yielded so even that
// doesn't block), every later GET serves the Buffer near-free. Promise-dedupe (cache the in-flight
// promise) so a cold-start BURST launches ONE build, not N (= DevOps's single-flight guard, subsumed).
//
// CACHE-INVALIDATION CONTRACT (Gate Co-Location): this process-lifetime cache is correct ONLY while the
// synthetic corpus is WRITE-FROZEN. No server route mutates it today (the client updateSyntheticEmbeddings
// POST is not wired server-side). IF a synth-mutation route is ever added it MUST call
// __invalidateSyntheticEmbeddingsCache() after the write, or GETs will serve a stale corpus.
let _synthEmbeddingsBuffer: Buffer | null = null;
let _synthEmbeddingsInFlight: Promise<Buffer> | null = null;

async function getSyntheticEmbeddingsBuffer(): Promise<Buffer> {
  if (_synthEmbeddingsBuffer) return _synthEmbeddingsBuffer;
  if (_synthEmbeddingsInFlight) return _synthEmbeddingsInFlight; // promise-dedupe: one cold build for a burst
  _synthEmbeddingsInFlight = (async () => {
    const t0 = Date.now();
    const heapBefore = process.memoryUsage().heapUsed;
    const data = await fileIO.loadSyntheticEmbeddings();
    const loadMs = Date.now() - t0;
    const t1 = Date.now();
    const buffer = await jsonStringifyChunked(data); // yields the loop during the cold serialize
    const serializeMs = Date.now() - t1;
    _synthEmbeddingsBuffer = buffer;
    // t/3165 phase-timing (cold path only) → the next real synth GET proves load_ms vs serialize_ms +
    // heap; on a warm hit this line never runs (serve is near-zero) = the fix's self-proof.
    log.api.info({
      component: 'synthetic-embeddings', load_ms: loadMs, serialize_ms: serializeMs, bytes: buffer.length,
      node_count: data ? Object.keys(data).length : 0,
      heap_before: heapBefore, heap_after: process.memoryUsage().heapUsed,
    }, 'synthetic-embeddings built + serialized + cached (cold path)');
    return buffer;
  })();
  try {
    return await _synthEmbeddingsInFlight;
  } finally {
    // Clear the in-flight handle: on success _synthEmbeddingsBuffer now holds the result; on failure the
    // handle is dropped so the next request retries the build rather than re-throwing a stale rejection.
    _synthEmbeddingsInFlight = null;
  }
}

/** t/3165: drop the cached serialized synthetic-embeddings. MUST be called by any future
 *  synth-mutation route after it writes (see the write-frozen contract above). Exported for that + tests. */
export function __invalidateSyntheticEmbeddingsCache(): void { _synthEmbeddingsBuffer = null; }

/** @internal t/3165 test hook — exercise the cache/dedupe path without the full Router harness. */
export const __getSyntheticEmbeddingsBufferForTest = getSyntheticEmbeddingsBuffer;

export function registerTaxonomyRoutes(r: Router, ctx: ServerCtx): void {
  const { get, put } = r;
  const { ensureSessionBranch } = ctx;

  // ── Synthetic corpus (must precede the :pov wildcard) ──

  get('/api/taxonomy/synthetic-embeddings', async (_req, res) => {
    try {
      // t/3165: serve the serialize-once cached Buffer (near-free on a hit). The cold path builds +
      // chunk-yield-serializes once, promise-deduped for concurrent cold callers. See the cache-
      // invalidation (write-frozen) contract at the cache site above.
      const buffer = await getSyntheticEmbeddingsBuffer();
      sendJsonBuffer(res, buffer);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'server',
        level: 'error',
        message: 'Failed to load synthetic embeddings',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), (err as { statusCode?: number }).statusCode ?? 500);
    }
  });

  get('/api/taxonomy/synthetic/:pov', async (req, res) => {
    try {
      const pov = param(req, 'pov', '/api/taxonomy/synthetic/:pov');
      const data = await fileIO.loadSyntheticCorpus(pov);
      if (data === null) { json(res, null); return; }
      json(res, data);
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to load synthetic corpus', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });

  // ── Taxonomy CRUD ──

  get('/api/taxonomy/:pov', async (req, res) => {
    try {
      const pov = param(req, 'pov', '/api/taxonomy/:pov');
      json(res, await fileIO.readTaxonomyFile(pov));
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to read taxonomy file', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });

  put('/api/taxonomy/:pov', async (req, res, body) => {
    if (isAnonymousUser()) { error(res, 'Anonymous users cannot save taxonomy edits. Sign in to save.', 403); return; }
    try {
      await ensureSessionBranch();
      const pov = param(req, 'pov', '/api/taxonomy/:pov');
      const incoming = body as { nodes?: unknown[] };
      // t/3171 (G8a): changed-node ids for the inline grounding reconcile, captured before stamping
      // (nodeContentHash excludes the stamp fields, so pre/post-stamp content diffs identically) and
      // while oldNodes is in scope. Only computed when the flag is on → flag-OFF adds one getFlag().
      let changedNodeIds: string[] = [];
      if (incoming.nodes && Array.isArray(incoming.nodes)) {
        let oldNodes: unknown[] = [];
        try {
          const existing = await fileIO.readTaxonomyFile(pov) as { nodes?: unknown[] };
          oldNodes = existing?.nodes ?? [];
        } catch { /* telemetry — silent by design: first write or missing file — treat as empty */ }
        if (getFlag('grounding_reconcile_inline')) {
          const { added, modified, deleted } = diffNodes(
            oldNodes as Parameters<typeof diffNodes>[0],
            incoming.nodes as Parameters<typeof diffNodes>[1],
          );
          changedNodeIds = [...added, ...modified, ...deleted]; // deleted → the reconciler purges their grounding
        }
        incoming.nodes = stampNodeAuthorship(
          oldNodes as Parameters<typeof stampNodeAuthorship>[0],
          incoming.nodes as Parameters<typeof stampNodeAuthorship>[1],
        );
      }
      await fileIO.writeTaxonomyFile(pov, body);
      json(res, { ok: true });
      // Fire-and-forget AFTER the 200 (never blocks/fails the write): debounced scoped grounding
      // reconcile for the changed nodes. Gated OFF above until the tool-lock + PS lock (t/3203) land.
      if (changedNodeIds.length > 0) enqueueGroundingReconcile(changedNodeIds);
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to write taxonomy file', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });

  // ── Node Edit History ──

  get('/api/taxonomy/:pov/node/:nodeId/history', async (req, res) => {
    try {
      const pov = param(req, 'pov', '/api/taxonomy/:pov/node/:nodeId/history');
      const nodeId = param(req, 'nodeId', '/api/taxonomy/:pov/node/:nodeId/history');
      const data = await fileIO.readTaxonomyFile(pov) as { nodes?: Array<{ id: string; _edit_history?: unknown[]; _edit_meta?: unknown }> };
      const node = data?.nodes?.find(n => n.id === nodeId);
      if (!node) { error(res, `Node ${nodeId} not found in ${pov}`, 404); return; }
      json(res, { nodeId, history: node._edit_history ?? [], edit_meta: node._edit_meta ?? null });
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to load node edit history', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });
}
