// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1687 (Phase 2 server.ts split, ADR-007): the public client-config +
// support-cases route run, moved verbatim out of server.ts behind the
// registration seam. This run sits between registerCommunityRoutes and
// registerHarvestRoutes, so registration order — and the routeTable snapshot —
// is preserved by placing registerSupportRoutes() at its former position.
//
// callerIdentity is a PURE mirror of the server.ts helper (it depends only on
// imports and holds no state) — duplicated here so this run needs no ServerCtx
// surface, exactly like routes/ai.ts. All other helpers (getClientConfig,
// supportStore, the userContext accessors) are pure module imports.

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, param } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { getClientConfig } from '../runtimeConfig.js';
import { getCurrentUser, getStorageUserId, isAnonymousUser } from '../security/userContext.js';
import { callerTierIdentity } from '../security/accessControl.js';
import * as supportStore from '../support/supportStore.js';

/**
 * t/848: resolve the caller's identity from the verified ALS user context (set
 * once by the S9 middleware from AZURE_AUTH_ENABLED-guarded headers) — NEVER by
 * re-reading raw x-ms-client-principal-* headers, which are spoofable when the
 * container is reachable without Easy Auth (direct ingress / misconfig). An
 * anonymous caller maps to '' so resolveTier yields the free/anonymous tier
 * (the free tier keys on an empty principal), never platform.
 */
function callerIdentity(): { principalName: string; idp: string } {
  return callerTierIdentity(getCurrentUser());
}

type ParsedSupportCase =
  | { ok: true; subject: string; description: string; systemInfo: { appVersion: string; browser: string; os: string; deploymentMode: 'web' | 'electron' }; priority: 'low' | 'medium' | 'high' }
  | { ok: false; error: string; status: number };

/** Clamp the client-supplied systemInfo to known, length-bounded fields. */
function boundSystemInfo(raw: unknown): { appVersion: string; browser: string; os: string; deploymentMode: 'web' | 'electron' } {
  const si = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  return {
    appVersion: String(si.appVersion ?? 'unknown').slice(0, 100),
    browser: String(si.browser ?? 'unknown').slice(0, 200),
    os: String(si.os ?? 'unknown').slice(0, 100),
    deploymentMode: (si.deploymentMode === 'electron' ? 'electron' : 'web') as 'web' | 'electron',
  };
}

/** Validate + normalize the create-case body: trims/length-caps subject & description,
 *  clamps priority, and bounds the systemInfo fields. Returns a typed error on invalid input. */
function parseSupportCaseBody(body: unknown): ParsedSupportCase {
  const b = (body ?? {}) as { subject?: unknown; description?: unknown; systemInfo?: unknown; priority?: unknown };
  const subject = typeof b.subject === 'string' ? b.subject.trim() : '';
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (!subject || subject.length > 200) return { ok: false, error: 'subject is required (≤200 chars)', status: 400 };
  if (!description || description.length > 10_000) return { ok: false, error: 'description is required (≤10000 chars)', status: 400 };
  const priority = (b.priority === 'low' || b.priority === 'high') ? b.priority : 'medium';
  const systemInfo = boundSystemInfo(b.systemInfo);
  return { ok: true, subject, description, systemInfo, priority };
}

export function registerSupportRoutes(r: Router, _ctx: ServerCtx): void {
  const { get, post } = r;

  // Public (spec §8.2): client-relevant subset, no secrets, cached 60s.
  get('/api/config/client', (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'max-age=60');
      json(res, getClientConfig());
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'runtime-config', level: 'error',
        message: 'GET /api/config/client failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });


  // ── Support cases (t/1189) ──
  // User endpoints require a signed-in (non-anonymous) caller and are scoped to the
  // caller's own cases (a case owned by another user simply 404s). Admin endpoints
  // are requireAdmin-gated. The client renders the "Sign in to file a case" prompt.
  post('/api/support/cases', async (_req, res, body) => {
    if (isAnonymousUser()) { error(res, 'Sign in to file a support case', 401); return; }
    try {
      const parsed = parseSupportCaseBody(body);
      if (!parsed.ok) { error(res, parsed.error, parsed.status); return; }
      const userId = getStorageUserId();
      const { principalName } = callerIdentity();
      const c = await supportStore.createCase(userId, principalName || userId, {
        subject: parsed.subject, description: parsed.description, systemInfo: parsed.systemInfo, priority: parsed.priority,
      });
      json(res, { id: c.id, case: c });
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'support', level: 'error', message: 'support: create case failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });

  get('/api/support/cases', async (_req, res) => {
    if (isAnonymousUser()) { error(res, 'Sign in to view support cases', 401); return; }
    try { json(res, { items: await supportStore.listCasesForUser(getStorageUserId()) }); }
    catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'support', level: 'error', message: 'support: list cases failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });

  get('/api/support/cases/:id', async (req, res) => {
    if (isAnonymousUser()) { error(res, 'Sign in to view support cases', 401); return; }
    try {
      const c = await supportStore.getCase(getStorageUserId(), param(req, 'id', '/api/support/cases/:id'));
      if (!c) { error(res, 'Case not found', 404); return; }
      json(res, c);
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'support', level: 'error', message: 'support: get case failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });

  post('/api/support/cases/:id/attachments', async (req, res, body) => {
    if (isAnonymousUser()) { error(res, 'Sign in to file a support case', 401); return; }
    try {
      const id = param(req, 'id', '/api/support/cases/:id/attachments');
      const b = (body ?? {}) as { filename?: unknown; mimeType?: unknown; dataBase64?: unknown };
      if (typeof b.mimeType !== 'string' || typeof b.dataBase64 !== 'string') { error(res, 'mimeType and dataBase64 are required', 400); return; }
      const bytes = Buffer.from(b.dataBase64, 'base64'); // size/MIME validated on the decoded bytes in saveAttachment
      const result = await supportStore.saveAttachment(getStorageUserId(), id, {
        filename: typeof b.filename === 'string' ? b.filename : 'attachment',
        mimeType: b.mimeType,
        bytes,
      });
      if (!result.ok) { error(res, result.error, result.status); return; }
      json(res, { attachment: result.attachment });
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'support', level: 'error', message: 'support: upload attachment failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });

  get('/api/support/cases/:id/attachments/:aid', async (req, res) => {
    if (isAnonymousUser()) { error(res, 'Sign in to view support cases', 401); return; }
    try {
      const found = await supportStore.getAttachment(
        getStorageUserId(),
        param(req, 'id', '/api/support/cases/:id/attachments/:aid'),
        param(req, 'aid', '/api/support/cases/:id/attachments/:aid'),
      );
      if (!found) { error(res, 'Attachment not found', 404); return; }
      res.writeHead(200, {
        'Content-Type': found.meta.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${found.meta.filename.replace(/[^\w.\- ]/g, '_')}"`,
        'Content-Length': String(found.bytes.length),
      });
      res.end(found.bytes);
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'support', level: 'error', message: 'support: download attachment failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });
}
