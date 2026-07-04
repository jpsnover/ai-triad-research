// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1295 (route extraction seam, repo-review B-209): the request/response helpers
// that every route handler shares. Extracted verbatim from server.ts so route
// clusters can move to routes/*.ts and still call the same json/error/param/query
// contract. No module state lives here — these are pure over (req, res). The
// route registrar (Router) and per-request context (ServerCtx) build on this.

import type { IncomingMessage, ServerResponse } from 'http';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';
import { getRequestId } from './logger.js';
import { clientSafeMessage } from './security/accessControl.js';

export type Handler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void> | void;

export function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function error(res: ServerResponse, message: string, status = 500, cause?: unknown): void {
  // M4: don't leak internal detail (file paths, stack) to clients on server
  // errors in production — record the real message server-side, return generic.
  const route: string = (res as unknown as { __routePath?: string }).__routePath ?? 'server';
  if (status >= 500 && process.env.NODE_ENV === 'production') {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: route,
      level: 'error',
      message: `${route}: server error (detail withheld from client)`,
      error: { name: (cause as Error)?.name ?? 'Error', message, stack: (cause as Error)?.stack },
    });
    json(res, { error: 'Internal server error', requestId: getRequestId() }, status);
    return;
  }
  // t/853: strip ActionableError internals (location, resolve steps) from <500
  // responses in production; keep the user-actionable summary.
  json(res, { error: clientSafeMessage(message, cause), requestId: getRequestId() }, status);
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
