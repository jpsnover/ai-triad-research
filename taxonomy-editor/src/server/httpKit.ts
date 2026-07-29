// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1295 (route extraction seam, repo-review B-209): the request/response helpers
// that every route handler shares. Extracted verbatim from server.ts so route
// clusters can move to routes/*.ts and still call the same json/error/param/query
// contract. No module state lives here — these are pure over (req, res). The
// route registrar (Router) and per-request context (ServerCtx) build on this.

import type { IncomingMessage, ServerResponse } from 'http';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';
import { log, getRequestId } from './logger.js';
import { clientSafeMessage } from './security/accessControl.js';

export type Handler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void> | void;

export function json(res: ServerResponse, data: unknown, status = 200): void {
  // t/1515: idempotent write. A second response (a handler replying after a client
  // abort, or after the endpoint timeout guard already answered) would throw
  // ERR_STREAM_WRITE_AFTER_END and crash the request. No-op with a trace instead.
  if (res.writableEnded || res.headersSent) {
    log.server.warn({ component: 'httpKit', status }, 'json(): response already sent — skipping duplicate write');
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// t/1379: record 4xx client errors to the flight recorder (warn — expected
// client errors, not server faults) so a client-side 4xx can be correlated with
// server state by requestId. Server-side dump only; never leaked to the client.
function recordClientError(res: ServerResponse, route: string, status: number, message: string): void {
  getGlobalRecorder()?.record({
    type: 'lifecycle', component: 'server', level: 'warn',
    message: `${route}: ${status} client error`,
    data: {
      method: (res as unknown as { req?: { method?: string } }).req?.method,
      path: route, status, requestId: getRequestId(), errorMessage: message,
    },
  });
}

// Prod 5xx: record the real detail server-side (withheld from the client body).
function recordServerError(route: string, status: number, message: string, cause: unknown): void {
  getGlobalRecorder()?.record({
    type: 'system.error',
    component: route,
    level: 'error',
    message: `${route}: server error (detail withheld from client)`,
    error: { name: (cause as Error)?.name ?? 'Error', message, stack: (cause as Error)?.stack },
  });
}

export function error(res: ServerResponse, message: string, status = 500, cause?: unknown): void {
  // M4: don't leak internal detail (file paths, stack) to clients on server
  // errors in production — record the real message server-side, return generic.
  const route: string = (res as unknown as { __routePath?: string }).__routePath ?? 'server';
  // t/1515: if the response already went out (client abort, or the endpoint timeout
  // guard answered first), skip — avoids a duplicate log/FR record and a crash.
  if (res.writableEnded || res.headersSent) {
    log.server.warn({ component: route, status }, `${route}: response already sent — skipping duplicate error(${status})`);
    return;
  }
  // t/1362: every 500 logs at error level to Pino — the always-on safety net so
  // server errors are visible in container logs (az containerapp logs show)
  // without a browser-triggered FR dump. The FR record below is prod+dump-gated;
  // this is not. Full message stays server-side (never leaked to the client body).
  if (status >= 500) {
    log.server.error({ component: route, status, err: cause }, `${route}: server error (${status}) — ${message}`);
  }
  if (status >= 400 && status < 500) {
    recordClientError(res, route, status, message);
  }
  if (status >= 500 && process.env.NODE_ENV === 'production') {
    recordServerError(route, status, message, cause);
    json(res, { error: 'Internal server error', requestId: getRequestId() }, status);
    return;
  }
  // t/853: strip ActionableError internals (location, resolve steps) from <500
  // responses in production; keep the user-actionable summary.
  json(res, { error: clientSafeMessage(message, cause), requestId: getRequestId() }, status);
}

/** t/1515/t/1516 — defense-in-depth wall-clock cap for handlers that call out to
 * slow subsystems (AI compute, subprocesses). The inner calls should self-bound;
 * set `ms` deliberately ABOVE the inner timeout so in normal operation the inner
 * answers first and this never fires. It only trips if the inner timeout fails to
 * bound the request, guaranteeing the HTTP layer still returns a structured 504 and
 * frees the socket instead of hanging until the client aborts. Relies on the
 * idempotent json()/error() above so a late inner response after the guard is a
 * no-op, not a write-after-end crash. */
export function withEndpointTimeout(
  res: ServerResponse, ms: number, label: string, fn: () => Promise<void>,
): Promise<void> {
  const timer = setTimeout(() => {
    if (res.writableEnded || res.headersSent) return;
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'server', level: 'error',
      message: `${label}: endpoint timeout guard fired after ${ms / 1000}s — inner timeout did not bound the request`,
    });
    error(res, `${label} timed out after ${ms / 1000}s`, 504);
  }, ms);
  return fn().finally(() => clearTimeout(timer));
}

export function param(req: IncomingMessage, name: string, routePath: string): string {
  // Simple :param extraction from URL
  const urlParts = new URL(req.url!, `http://localhost`).pathname.split('/');
  const routeParts = routePath.split('/');
  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i] === `:${name}`) return decodeURIComponent(urlParts[i]);
  }
  return '';
}

export function query(req: IncomingMessage, name: string): string | null {
  const url = new URL(req.url!, `http://localhost`);
  return url.searchParams.get(name);
}

/** Best-effort client IP: first X-Forwarded-For hop (behind the Azure ingress
 *  proxy), else the raw socket address. Used for per-IP rate-limit keys. */
export function getClientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// ── Route registrar (t/1295) ──
// The surface extracted cluster modules (routes/*.ts) use to register routes into
// the server's shared table, so server.ts only wires the registrar.

type RouteRecord = { method: string; path: string; handler: Handler };

export interface Router {
  get(path: string, h: Handler): void;
  post(path: string, h: Handler): void;
  put(path: string, h: Handler): void;
  patch(path: string, h: Handler): void;
  del(path: string, h: Handler): void;
}

/** A Router that appends to the caller's existing `routes` array — same shape and
 *  order semantics as server.ts's local get/post/put/del helpers. */
export function createRouter(routes: RouteRecord[]): Router {
  return {
    get: (p, h) => { routes.push({ method: 'GET', path: p, handler: h }); },
    post: (p, h) => { routes.push({ method: 'POST', path: p, handler: h }); },
    put: (p, h) => { routes.push({ method: 'PUT', path: p, handler: h }); },
    patch: (p, h) => { routes.push({ method: 'PATCH', path: p, handler: h }); },
    del: (p, h) => { routes.push({ method: 'DELETE', path: p, handler: h }); },
  };
}
