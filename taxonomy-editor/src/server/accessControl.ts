// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Pure access-control decisions extracted from server.ts so they can be unit
// tested (server.ts calls server.listen() at import time and isn't import-safe).
// See t/720 (L1, L3, L6).

import path from 'path';

/**
 * L1: whether an AUTH_DISABLED=1 setting should be honored. AUTH_DISABLED makes
 * every request an anonymous user with full access — acceptable for local/dev
 * single-operator use, never in production. Honored only outside production.
 */
export function isAuthDisabledAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTH_DISABLED === '1' && env.NODE_ENV !== 'production';
}

/**
 * L3: whether `target` resolves to `base` itself or a path nested under it.
 * Used to confine the /api/data/clone target to the configured data directory
 * (an arbitrary path there is an admin-only arbitrary-write primitive).
 */
export function isPathWithinDir(target: string, base: string): boolean {
  const resolvedTarget = path.resolve(target);
  const resolvedBase = path.resolve(base);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}

/**
 * L6: whether a caller may open the terminal WebSocket (which spawns a
 * server-side shell). AUTH_DISABLED is single-operator local/dev mode (L1
 * forbids it in production), so the local operator keeps access; every
 * authenticated deployment requires an admin user with a resolved principal.
 */
export function isTerminalAccessAllowed(opts: {
  authDisabled: boolean;
  principalName: string;
  isAdmin: boolean;
}): boolean {
  if (opts.authDisabled) return true;
  if (!opts.principalName) return false;
  return opts.isAdmin;
}

// AI/inference routes anonymous users can never reach (keys, AI, embeddings, NLI).
const AI_ROUTE_PREFIXES = ['/api/keys', '/api/ai/', '/api/embeddings/', '/api/nli/'];

/**
 * Whether an anonymous (signed-out) user may call `method urlPath` in
 * AUTH_OPTIONAL mode. Anonymous users get read-only, non-AI access plus
 * save/delete of their own ephemeral chats/debates. Returning false drives the
 * `anon_route_blocked` 403 in the auth gate (t/763).
 */
export function isAnonAllowedRoute(method: string, urlPath: string): boolean {
  // Block all AI-related routes regardless of method
  if (AI_ROUTE_PREFIXES.some(p => urlPath.startsWith(p))) return false;
  if (urlPath === '/api/evidence-qbaf') return false;
  if (urlPath === '/api/models/refresh') return false;
  if (urlPath.startsWith('/api/harvest/')) return false;
  if (/^\/api\/debates\/[^/]+\/news-report$/.test(urlPath)) return false;

  if (method === 'GET') return true;

  // Anonymous users can save/delete their own ephemeral chats and debates.
  // Matches both '/api/debates' (create/save) and '/api/debates/{id}' (update/delete).
  const isUserContent = urlPath === '/api/chats' || urlPath.startsWith('/api/chats/')
    || urlPath === '/api/debates' || urlPath.startsWith('/api/debates/');
  if (method === 'PUT' && isUserContent) return true;
  if (method === 'DELETE' && isUserContent) return true;

  if (method === 'PUT' || method === 'DELETE') return false;

  // POST: allowlist read-like operations, block everything else
  const safePostPaths = [
    '/api/flight-recorder/dump',
    '/api/flight-recorder/server-dump',
    '/api/debates/export',
    '/api/source-evidence',
    '/api/analytics/event',
    '/api/admin/telemetry',
    '/api/data/check-updates',
    '/api/community/submit',
    '/focus-node',
    '/debug/events',
  ];
  return safePostPaths.some(p => urlPath === p);
}
