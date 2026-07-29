// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1902 (Phase 2-T2): the container-mentions transport route — the web-build
// backend for the mention read path (C landed fileIO.readContainerMentions,
// storage-only, t/1895). Mirrors routes/entity.ts. Read-through only; the TTL cache
// lives in the read path. Session-gated (NOT public).

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, param } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import * as fileIO from '../storage/fileIO.js';

const ROUTE = '/api/container-mentions/:containerId';

export function registerMentionsRoutes(r: Router, _ctx: ServerCtx): void {
  const { get } = r;

  // GET /api/container-mentions/:containerId — the extracted entity mentions for one
  // container (chat/debate/sei/node). The id contains ':' (`sei:…` / `node:…`); param()
  // already decodeURIComponent's it (httpKit) — no explicit decode, or it'd double-decode.
  // An ABSENT container (no mentions yet, or before the index is built) is a DESIGNED 200
  // with a null body — NOT a 404. 404 stays for bad routes (gate-integrity, same as
  // getEntity's typed not-found). readContainerMentions returns ContainerMentions | null,
  // passed through verbatim.
  // NB: the path is a string literal (not the ROUTE const) so the static route-table
  // extractor (__tests__/extractRoutes.ts) can see it; ROUTE is used for param() below.
  get('/api/container-mentions/:containerId', async (req, res) => {
    try {
      const containerId = param(req, 'containerId', ROUTE);
      json(res, await fileIO.readContainerMentions(containerId));
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error',
        message: 'Failed to read container mentions',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });
}
