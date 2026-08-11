// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1687 (Phase 2 server.ts split, ADR-007): the auth-identity / analytics /
// diagnostics-beacon / focus-node / trace-channel route run, moved verbatim out
// of server.ts behind the registration seam. This run is the last route run,
// registered right after registerSyncRoutes (before the static-file pipeline),
// so registration order — and the routeTable snapshot — is preserved by placing
// registerSessionRoutes() at its former position.
//
// /focus-node broadcasts to connected WebSocket clients via broadcastEvent, which
// closes over the server's WebSocket client set and stays in server.ts; it is
// threaded in through the new ctx.broadcastEvent field. The trace-channel batch
// cap (TRACE_MAX_EVENTS_PER_BATCH) is used only by /debug/events, so it moves in
// as module-local state. All other helpers are pure module imports.

import type { IncomingMessage } from 'http';
import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, getClientIp } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { log } from '../logger.js';
import { deriveStorageUserId } from '../security/userContext.js';
import { getQuotaLimits } from '../security/quotas.js';
import { requireAdmin } from '../community/admin/reviewRegistry.js';
import { isAdmin } from '../community/community.js';
import * as analytics from '../community/analytics.js';
import { parseCookies } from '../httpCookies.js';

/** Resolve analytics user key for anonymous requests (t/2465).
 *  Returns 'anon:' + first 12 chars of anon_session_id (HttpOnly — server-reads only),
 *  or '_anonymous' when the cookie is absent (cookie-less fallback). */
export function resolveAnonSessionKey(req: IncomingMessage): string {
  const id = parseCookies(req).get('anon_session_id');
  return id ? `anon:${id.slice(0, 12)}` : '_anonymous';
}

const TRACE_MAX_EVENTS_PER_BATCH = 100;

export function registerSessionRoutes(r: Router, ctx: ServerCtx): void {
  const { get, post } = r;
  const { broadcastEvent } = ctx;

  // ── Analytics ──

  get('/api/auth/me', (req, res) => {
    const azureAuth = process.env.WEBSITE_AUTH_ENABLED === 'True'
      || process.env.WEBSITE_AUTH_ENABLED === 'true';
    const principalName = azureAuth
      ? (req.headers['x-ms-client-principal-name'] as string) || ''
      : '';
    const idp = azureAuth
      ? (req.headers['x-ms-client-principal-idp'] as string) || ''
      : '';
    const isAnon = !principalName;
    const authOpt = process.env.AUTH_OPTIONAL === '1';
    json(res, {
      user: principalName || resolveAnonSessionKey(req),
      idp: idp || '',
      anonymous: isAnon,
      capabilities: {
        ai: !isAnon || !authOpt,
        write: !isAnon || !authOpt,
      },
    });
  });

  get('/api/user/profile', (req, res) => {
    const azureAuth = process.env.WEBSITE_AUTH_ENABLED === 'True'
      || process.env.WEBSITE_AUTH_ENABLED === 'true';
    const principalName = azureAuth
      ? (req.headers['x-ms-client-principal-name'] as string) || ''
      : '';
    const idp = azureAuth
      ? (req.headers['x-ms-client-principal-idp'] as string) || ''
      : '';
    const isAnon = !principalName;
    const userId = deriveStorageUserId(principalName || '_local', idp || '_local');
    const adminUsers = (process.env.ADMIN_USERS || 'jpsnover,jsnover13-at-gmail-com').split(',').map(s => s.trim());
    const quotaLimits = isAnon ? null : getQuotaLimits(userId);
    json(res, {
      userId,
      displayName: principalName || 'Anonymous',
      idp: idp || null,
      isAnonymous: isAnon,
      isAdmin: !isAnon && adminUsers.includes(userId),
      quotas: quotaLimits,
    });
  });

  post('/api/analytics/event', (_req, res, body) => {
    const raw = (body as { events?: unknown[] }).events;
    if (!Array.isArray(raw)) { json(res, { error: 'events array required' }, 400); return; }
    // Sanitize: only keep events that have the required string fields
    const events: analytics.AnalyticsEvent[] = [];
    for (const e of raw) {
      if (typeof e !== 'object' || e === null) continue;
      const o = e as Record<string, unknown>;
      if (typeof o.user !== 'string' || typeof o.session_id !== 'string' ||
          typeof o.timestamp !== 'string' || typeof o.event_type !== 'string' ||
          typeof o.category !== 'string') continue;
      events.push({
        user: o.user.slice(0, 200),
        session_id: o.session_id.slice(0, 100),
        timestamp: o.timestamp.slice(0, 30),
        event_type: o.event_type.slice(0, 100),
        category: o.category.slice(0, 50),
        detail: (typeof o.detail === 'object' && o.detail !== null ? o.detail : {}) as Record<string, unknown>,
        duration_ms: typeof o.duration_ms === 'number' ? o.duration_ms : undefined,
      });
    }
    analytics.appendEvents(events).catch((e) => {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'analytics', level: 'error',
        message: 'Analytics append failed',
        error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack },
      });
    });
    json(res, { ok: true, count: events.length });
  });

  // t/1128: receives the login page's service-worker state beacon (stuck-SW
  // diagnosis, t/1126). Public — the login page is pre-auth. Best-effort: log the
  // reported SW registrations/controller (captured in server-log dumps), then 204
  // (sendBeacon ignores the response body).
  post('/api/diagnostics/sw-state', (req, res, body) => {
    try {
      const info = (body && typeof body === 'object') ? body as Record<string, unknown> : { raw: String(body).slice(0, 500) };
      log.server.info(
        { component: 'sw-diagnostics', sw: info, ip: getClientIp(req), ua: (req.headers['user-agent'] || '').slice(0, 200) },
        'Login-page service-worker state beacon (t/1128)',
      );
    } catch { /* telemetry — silent by design: never fail a diagnostics beacon */ }
    res.writeHead(204);
    res.end();
  });

  get('/api/analytics/query', async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const from = url.searchParams.get('from') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
    const user = url.searchParams.get('user') || undefined;
    const sessionId = url.searchParams.get('session_id') || undefined;

    if (user || sessionId) {
      // t/850: raw per-user/session events expose other users' telemetry — admin only.
      if (!requireAdmin(res)) return;
      json(res, { events: await analytics.queryRawEvents(from, to, user, sessionId) });
    } else {
      json(res, await analytics.queryAggregated(from, to));
    }
  });

  // t/2467: engagement tree (view.dwell roll-up — tool→camp→category→node).
  // Aggregate + daily open to any authenticated caller.
  // Per-user subtree (other-user) and users table are admin-gated.
  get('/api/analytics/engagement', async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const from = url.searchParams.get('from') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
    const user = url.searchParams.get('user') || undefined;

    const azureAuth = process.env.WEBSITE_AUTH_ENABLED === 'True' || process.env.WEBSITE_AUTH_ENABLED === 'true';
    const principalName = azureAuth ? (req.headers['x-ms-client-principal-name'] as string) || '' : '';
    const idp = azureAuth ? (req.headers['x-ms-client-principal-idp'] as string) || '' : '';
    const currentUserId = deriveStorageUserId(principalName || '_local', idp || '_local');

    if (user && user !== currentUserId && !requireAdmin(res)) return;

    const { users, ...rest } = await analytics.queryEngagement(from, to, user);
    json(res, isAdmin(currentUserId) ? { ...rest, users } : rest);
  });

  // ── Focus node (inter-app communication) ──

  post('/focus-node', (_req, res, body) => {
    const { nodeId } = body as { nodeId: string };
    // Broadcast to connected WebSocket clients
    broadcastEvent('focus-node', { nodeId });
    json(res, { ok: true });
  });

  // ── Trace channel (observability) ──
  //
  // Accepts batched trace events from the renderer and emits each as a single
  // line of JSON on stdout. In the Azure Container Apps deployment, stdout is
  // ingested by Log Analytics via appLogsConfiguration (see deploy/azure/main.bicep)
  // which makes the events queryable with KQL:
  //
  //   ContainerAppConsoleLogs_CL
  //   | where Log_s startswith "[trace]"
  //   | extend ev = parse_json(substring(Log_s, 8))
  //   | where ev.debate_id == "<debate-id>"
  //
  // See docs/debate-observability-proposal.md for the full rationale.
  //
  // Events are intentionally not validated beyond basic shape — the renderer
  // owns the schema and we want to preserve unexpected fields for future use.
  // The per-batch cap prevents accidental payload bombs.

  post('/debug/events', (_req, res, body) => {
    try {
      const { events } = (body || {}) as { events?: unknown };
      if (!Array.isArray(events)) {
        error(res, 'events must be an array', 400);
        return;
      }
      const accepted = events.slice(0, TRACE_MAX_EVENTS_PER_BATCH);
      for (const ev of accepted) {
        // Single-line JSON so the log ingestion splits on newlines cleanly.
        log.trace.debug({ event: ev }, 'Client trace event');
      }
      json(res, { received: accepted.length, dropped: Math.max(0, events.length - accepted.length) });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'server',
        level: 'error',
        message: 'Operation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err));
    }
  });
}
