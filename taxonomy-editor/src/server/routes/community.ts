// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1347 (route extraction, t/1295 follow-up): the /api/community route cluster,
// moved verbatim out of server.ts behind the registration seam. Handlers are
// byte-identical except the submit pre-check, which now reads the live GitHub
// backend through ctx.getGithubBackend() instead of the server.ts module-local
// `githubBackend` (same live value). The server-local respondRateLimited() helper
// (only callers were these two submit paths) moves in with the cluster as a
// closure over ctx. No new collision pairs — community route literals are all
// distinct (see routeTable.test.ts).

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, param } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { rateLimitResponseBody } from '../security/rateLimitResponse.js';
import * as rateLimiter from '../security/rateLimiter.js';
import { getStorageUserId } from '../security/userContext.js';
import * as community from '../community/community.js';

export function registerCommunityRoutes(r: Router, ctx: ServerCtx): void {
  const { get, post, del } = r;
  const { getGithubBackend } = ctx;

  // Structured 429 for GitHub-API rate-limit exhaustion (t/685). Surfaces seconds
  // until the limit resets via a `retryAfter` field and a Retry-After header, so
  // clients can back off instead of seeing an opaque 500.
  function respondRateLimited(res: import('http').ServerResponse): void {
    const gh = getGithubBackend();
    const resetsAt = gh ? new Date(gh.getRateLimitResetsAt()).getTime() : 0;
    const bodyResp = rateLimitResponseBody(resetsAt, Date.now());
    res.setHeader('Retry-After', String(bodyResp.retryAfter));
    json(res, bodyResp, 429);
  }

  // Admin hard-delete of a published community item, with an audit trail (t/748).
  // Renderer sends DELETE with an optional JSON body { reason }.
  del('/api/community/:type/:id', async (req, res, body) => {
    if (!community.isAdmin()) { json(res, { error: 'Forbidden' }, 403); return; }
    try {
      const type = param(req, 'type', '/api/community/:type/:id');
      if (type !== 'chats' && type !== 'debates') { error(res, 'type must be "chats" or "debates"', 400); return; }
      const id = param(req, 'id', '/api/community/:type/:id');
      const reason = (body as { reason?: string } | undefined)?.reason;
      await community.removeCommunityItem(type, id, typeof reason === 'string' ? reason : undefined);
      json(res, { ok: true });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'server',
        level: 'error',
        message: 'Failed to remove community item',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, (err as Error).message ?? String(err), (err as { statusCode?: number }).statusCode ?? 500, err);
    }
  });

  get('/api/community/chats', async (_req, res) => {
    try { json(res, await community.listCommunityChats()); }
    catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'server',
        level: 'error',
        message: 'Failed to list community chats',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err));
    }
  });

  get('/api/community/chats/:id', async (req, res) => {
    try {
      const id = param(req, 'id', '/api/community/chats/:id');
      const item = await community.loadCommunityItem('chats', id);
      if (!item) { json(res, { found: false }, 200); return; }
      json(res, item);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'server',
        level: 'error',
        message: 'Failed to load community chat item',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 404);
    }
  });

  get('/api/community/debates', async (_req, res) => {
    try { json(res, await community.listCommunityDebates()); }
    catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'server',
        level: 'error',
        message: 'Failed to list community debates',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err));
    }
  });

  get('/api/community/debates/:id', async (req, res) => {
    try {
      const id = param(req, 'id', '/api/community/debates/:id');
      const item = await community.loadCommunityItem('debates', id);
      if (!item) { json(res, { found: false }, 200); return; }
      json(res, item);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'server',
        level: 'error',
        message: 'Failed to load community debate item',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 404);
    }
  });

  post('/api/community/submit', async (_req, res, body) => {
    try {
      const { type, data, note } = body as { type: 'chat' | 'debate'; data: unknown; note?: string };
      if (!type || !data) { json(res, { error: 'type and data required' }, 400); return; }

      // Pre-flight: a community submission must reach GitHub (it's shared data on
      // main). If the API is exhausted, fail fast with a structured 429 instead of
      // attempting a write that 403s mid-flight and surfaces as a 500 — and never
      // leaves a half-written/uncommittable submission behind (t/685).
      const gh = getGithubBackend();
      if (gh && gh.getRateLimitRemaining() <= 0) {
        respondRateLimited(res);
        return;
      }

      // M6: per-user submission rate limit (5/hour) — throttles burst abuse of the
      // shared community queue (distinct from the 20-pending cap in community.ts).
      const submitRate = rateLimiter.checkRate(`community-submit:${getStorageUserId()}`, 5, 3_600_000);
      if (!submitRate.allowed) {
        const retryAfter = Math.max(1, Math.ceil((submitRate.retryAfterMs ?? 3_600_000) / 1000));
        res.setHeader('Retry-After', String(retryAfter));
        json(res, { error: 'rate_limited', message: 'Too many community submissions; please try again later.', retryAfter }, 429);
        return;
      }

      json(res, await community.submitToCommunity(type, data, note));
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'server',
        level: 'error',
        message: 'Community submission failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      // Map a rate-limit failure that slipped past the pre-check to 429, not 500.
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 429 || status === 403 || /rate.?limit/i.test(String(err))) {
        respondRateLimited(res);
        return;
      }
      json(res, { error: String(err) }, status ?? 500);
    }
  });

  post('/api/community/copy', async (_req, res, body) => {
    try {
      const { type, communityId } = body as { type: 'chats' | 'debates'; communityId: string };
      if (!type || !communityId) { json(res, { error: 'type and communityId required' }, 400); return; }
      json(res, await community.copyFromCommunity(type, communityId));
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'server',
        level: 'error',
        message: 'Failed to copy from community',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      json(res, { error: String(err) }, status);
    }
  });
}
