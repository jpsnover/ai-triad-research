// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2727 (design t/2723#3, SO-approved e/106#2): the public, no-login read-only
// op-ed share endpoint — the SECOND tenant of the reserved auth-exempt /api/public/*
// namespace (isPublicPath prefix, publicPaths.ts). It copies the publicShare.ts
// security template verbatim; every control is a binding security condition:
//
//   1. Rate-limit FIRST (per-IP, 30/min) — before any work or file read.
//   2. Path-param validation via invalidRouteParam (:shareId → isSafeId) — the
//      path-traversal guard for a public endpoint feeding a file read.
//   3. The served file at rest is ALREADY a positive projection (opedShareStore
//      projectPublicOpEd) — no private field can be present, and the read reaches
//      ONLY public/opeds/, never users/**.
//
// GET-only, read-only. No session required or minted (no Set-Cookie). Uniform 404
// for never-shared and revoked (indistinguishable). JSON always — never the
// AUTH_OPTIONAL Sign-In interstitial (this route is auth-exempt by prefix).

import type { IncomingMessage, ServerResponse } from 'http';
import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, param, getClientIp } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { checkRate } from '../security/rateLimiter.js';
import { invalidRouteParam } from '../security/accessControl.js';
import { loadPublicOpedShare, type PublicOpEd } from '../storage/opedShareStore.js';

const ROUTE = '/api/public/oped/:shareId';

// ── Short-TTL parse cache (t/1793 pattern) — DoS-amplification bound ──
// The per-IP rate key is forged-XFF-rotatable (accepted for public-by-design data),
// so request volume is effectively unbounded and each miss does a read + JSON.parse.
// Keying the cache by shareId decouples request volume from parse work; the cap +
// TTL purge guarantee the map can never grow without bound.
const CACHE_TTL_MS = 5_000;
const CACHE_MAX_ENTRIES = 64;
interface CacheEntry { promise: Promise<PublicOpEd | null>; expires: number }
const cache = new Map<string, CacheEntry>();

function readCached(shareId: string): Promise<PublicOpEd | null> {
  const now = Date.now();
  const hit = cache.get(shareId);
  if (hit && hit.expires > now) return hit.promise;

  const promise = loadPublicOpedShare(shareId);
  // Never cache a rejection — drop the entry so the next request retries.
  promise.catch(() => { if (cache.get(shareId)?.promise === promise) cache.delete(shareId); });

  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  cache.set(shareId, { promise, expires: now + CACHE_TTL_MS });
  return promise;
}

/** Test-only: clear the module-level cache so cases don't leak state. */
export function _resetPublicOpedCache(): void { cache.clear(); }

export function registerOpedShareRoutes(r: Router, _ctx: ServerCtx): void {
  const { get } = r;

  // GET /api/public/oped/:shareId — public, no-login, read-only. String literal
  // (not the ROUTE const) so the static route-table extractor can see it.
  get('/api/public/oped/:shareId', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // 1. Rate-limit FIRST.
      const rate = checkRate(`public-oped:${getClientIp(req)}`, 30, 60_000);
      if (!rate.allowed) {
        const retryAfter = Math.ceil((rate.retryAfterMs ?? 60_000) / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        json(res, { error: 'rate_limited', retryAfter }, 429);
        return;
      }

      // 2. Validate the path param (traversal guard) — :shareId → isSafeId.
      const pathname = req.url?.split('?')[0] ?? '';
      const bad = invalidRouteParam(ROUTE, pathname);
      if (bad) { error(res, bad, 400); return; }
      const shareId = param(req, 'shareId', ROUTE);

      // 3. Read the already-projected public copy (never users/**). Uniform 404.
      const record = await readCached(shareId);
      if (!record) { error(res, 'not_found', 404); return; }
      json(res, record);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error',
        message: 'Failed to resolve public op-ed share',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });
}
