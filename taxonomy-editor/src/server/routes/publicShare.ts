// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1788 (TL-approved t/1787#2, Server-Auth co-signed t/1788#2): the public,
// no-login read-only POV-node share endpoint. This is the FIRST route under the
// reserved auth-exempt /api/public/* namespace (see the isPublicPath clause in
// server.ts) — a public, unauthenticated surface, so every control here is a
// binding security condition, not a nicety:
//
//   1. Rate-limit FIRST (per-IP, 30/min) — the DoS/abuse guard runs before any
//      work, before param validation, before the file read.
//   2. Path-param validation via invalidRouteParam (isSafePov / isSafeId) — the
//      path-traversal guard for a public endpoint that feeds a file read.
//   3. A POSITIVE, field-by-field projection (a 6-field allowlist) — never a
//      spread or denylist. Nothing outside PublicPovNode can ever leak, no matter
//      what enrichment/scoring/authorship/_edit_meta a node carries.
//
// GET-only, read-only. No session is required or minted (no Set-Cookie).

import type { IncomingMessage, ServerResponse } from 'http';
import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, param, getClientIp } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { checkRate } from '../security/rateLimiter.js';
import { invalidRouteParam } from '../security/accessControl.js';
import * as fileIO from '../storage/fileIO.js';

const ROUTE = '/api/public/pov/:pov/node/:nodeId';

/**
 * The exact public wire shape for a shared POV node — a POSITIVE allowlist and
 * the load-bearing info-leak control. Only these six fields ever ship; the
 * projection below builds this by explicit field, never by spread/denylist.
 */
export interface PublicPovNode {
  nodeId: string;
  pov: string;
  category: string;
  label: string;
  description: string;
  aphorism: string | null;
}

export function registerPublicShareRoutes(r: Router, _ctx: ServerCtx): void {
  const { get } = r;

  // GET /api/public/pov/:pov/node/:nodeId — public, no-login, read-only.
  // NB: the path is a string literal (not the ROUTE const) so the static
  // route-table extractor (__tests__/extractRoutes.ts) can see it.
  get('/api/public/pov/:pov/node/:nodeId', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // 1. Rate-limit FIRST (Server-Auth spec) — per-IP 30/min. Mirrors the
      //    write-rate 429 idiom in server.ts (~L961): setHeader('Retry-After')
      //    then json(..., 429) so writeHead preserves the header and it ships.
      const rate = checkRate(`public-pov:${getClientIp(req)}`, 30, 60_000);
      if (!rate.allowed) {
        const retryAfter = Math.ceil((rate.retryAfterMs ?? 60_000) / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        json(res, { error: 'rate_limited', retryAfter }, 429);
        return;
      }

      // 2. Validate path params (path-traversal guard). invalidRouteParam
      //    validates :pov via isSafePov and :nodeId via isSafeId against the
      //    decoded value — critical for a public endpoint feeding a file read.
      const pathname = req.url?.split('?')[0] ?? '';
      const bad = invalidRouteParam(ROUTE, pathname);
      if (bad) { error(res, bad, 400); return; }
      const pov = param(req, 'pov', ROUTE);
      const nodeId = param(req, 'nodeId', ROUTE);

      // 3. Read + find.
      const data = await fileIO.readTaxonomyFile(pov) as { nodes?: Array<Record<string, unknown>> };
      const node = (data.nodes ?? []).find(n => n.id === nodeId);
      if (!node) { error(res, 'not_found', 404); return; }

      // 4. POSITIVE, field-by-field projection — the info-leak control. NEVER a
      //    spread ({...node}) or a delete-keys denylist. t/1787#2 §2 excludes
      //    graph_attributes WHOLESALE but lists `aphorism` in the 6-field
      //    allowlist, so we pick ONLY graph_attributes.aphorism — never any other
      //    part of graph_attributes (no embeddings / scores / enrichment) and
      //    never _edit_meta / authorship / timestamps / status.
      const record: PublicPovNode = {
        nodeId,
        pov,
        category: String(node.category ?? ''),
        label: String(node.label ?? ''),
        description: String(node.description ?? ''),
        aphorism: (node.graph_attributes as { aphorism?: string } | undefined)?.aphorism ?? null,
      };
      json(res, record);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error',
        message: 'Failed to resolve public POV node share',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });
}
