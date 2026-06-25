// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Pure access-control decisions extracted from server.ts so they can be unit
// tested (server.ts calls server.listen() at import time and isn't import-safe).
// See t/720 (L1, L3, L6).

import path from 'path';
import { isSafeId, isSafePov, isSafeFilename } from '../storage/fileIO.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';

// Review group ids are "domain:id" (e.g. "calibration:jpsnover") — allow the
// colon, still block path separators / dots / encoded sequences.
const GROUP_ID_RE = /^[a-zA-Z0-9_:-]+$/;

/**
 * t/810: routing-layer path-param validation. Given a matched route pattern and
 * the request pathname, return the name of the first user-provided `:param`
 * whose (decoded) value fails its whitelist, or null if all pass. Validating the
 * decoded value mirrors param() (which decodes) and catches encoded traversal
 * (%2e%2e → ".."), while allowing legit encoded chars (e.g. ":" in group ids).
 * Per-param classes mirror the handlers' own assert* checks (defense-in-depth).
 */
export function invalidRouteParam(routePath: string, pathname: string): string | null {
  const patternParts = routePath.split('/');
  const pathParts = pathname.split('/');
  for (let i = 0; i < patternParts.length; i++) {
    const seg = patternParts[i];
    if (!seg.startsWith(':')) continue;
    const name = seg.slice(1);
    let value: string;
    try { value = decodeURIComponent(pathParts[i] ?? ''); }
    catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'warn',
        message: `Malformed percent-encoding in path param '${name}'`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return name; // malformed percent-encoding — reject
    }
    const ok =
      name === 'pov' ? isSafePov(value)
        : (name === 'filename' || name === 'name') ? isSafeFilename(value)
          : name === 'groupId' ? GROUP_ID_RE.test(value)
            : isSafeId(value);
    if (!ok) return name;
  }
  return null;
}

/**
 * t/897: Set-Cookie values that expire the Easy Auth session cookies. Azure's
 * /.auth/logout doesn't reliably clear AppServiceAuthSession (it can be chunked
 * into AppServiceAuthSession, AppServiceAuthSession1, …), leaving the session
 * valid after "Sign Out". The logout endpoint expires every such cookie present
 * on the request (plus the canonical name) before handing off to /.auth/logout.
 * Deletion only requires matching name + Path, so the fixed attributes are safe.
 */
export function expiredAuthCookies(presentCookieNames: string[]): string[] {
  const names = new Set(presentCookieNames.filter(n => /^AppServiceAuthSession/i.test(n)));
  names.add('AppServiceAuthSession');
  return [...names].map(n =>
    `${n}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`);
}

/**
 * t/940: true when the request carries an Easy Auth session cookie
 * (AppServiceAuthSession, possibly chunked). When this is present but the request
 * is unauthenticated (no principal), the session is stale and loops the OAuth
 * redirect — the login gate expires the cookie before serving the page.
 */
export function hasEasyAuthSessionCookie(cookieNames: string[]): boolean {
  return cookieNames.some(n => /^AppServiceAuthSession/i.test(n));
}

/**
 * t/896: structured fast-fail when the caller has no usable API key for the
 * target backend — returned as a 422 before the request reaches the AI adapter
 * (which would otherwise surface an opaque upstream 401/403). Returns null (=
 * proceed) when the free tier provides the key, the caller supplied one, or a
 * stored/env key resolves.
 */
export function missingApiKeyError(opts: {
  backend: string;
  displayName: string;
  serverProvidedKey: boolean;
  haveExplicitKey: boolean;
  hasResolvedKey: boolean;
}): { error: 'missing_api_key'; backend: string; message: string } | null {
  if (opts.serverProvidedKey || opts.haveExplicitKey || opts.hasResolvedKey) return null;
  return {
    error: 'missing_api_key',
    backend: opts.backend,
    message: `No API key configured for ${opts.displayName}. Add one in Settings → API Keys.`,
  };
}

/** Duck-typed ActionableError (avoids importing across the lib boundary). */
function isActionableErrorLike(e: unknown): e is { goal: string; problem: string } {
  return !!e && typeof e === 'object' && 'goal' in e && 'problem' in e && 'nextSteps' in e;
}

/**
 * t/853: produce a client-safe error string for production. ActionableError
 * carries `location`, `Resolve:` steps, and stacks that reveal server internals
 * (source paths, function names) — in production keep only the user-actionable
 * `goal: problem`. Handles an ActionableError `cause` and a message that is
 * already a serialized ActionableError dump. Outside production the full message
 * is returned unchanged (dev/debug ergonomics).
 */
export function clientSafeMessage(message: string, cause?: unknown, isProduction = process.env.NODE_ENV === 'production'): string {
  if (!isProduction) return message;
  if (isActionableErrorLike(cause)) return `${cause.goal}: ${cause.problem}`;
  if (/\n\s*Location:/.test(message)) {
    const goal = message.match(/Goal:\s*(.+)/)?.[1]?.trim();
    const prob = message.match(/Error:\s*(.+)/)?.[1]?.trim();
    return goal && prob ? `${goal}: ${prob}` : 'Request failed';
  }
  return message;
}

/**
 * t/848: the identity to feed proxyTiers.resolveTier, sourced from the verified
 * ALS user context (populated once by the S9 middleware from
 * AZURE_AUTH_ENABLED-guarded headers) — never from raw request headers. An
 * anonymous caller (or no context) maps to an empty principal so resolveTier
 * yields the free/anonymous tier, never platform — even if a spoofed
 * x-ms-client-principal-* header is present when Easy Auth isn't in front.
 */
export function callerTierIdentity(
  user: { principalName: string; idp: string; isAnonymous: boolean } | null,
): { principalName: string; idp: string } {
  if (!user || user.isAnonymous) return { principalName: '', idp: '' };
  return { principalName: user.principalName, idp: user.idp };
}

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

// AI-prefixed routes that are nonetheless safe for anonymous callers: local
// server-side config with no key, no cost, and no abuse vector (t/811). Checked
// before the blanket AI block so chat/debates can set temperature pre-generation.
const ANON_SAFE_AI_ROUTES = ['/api/ai/temperature'];

/**
 * Whether an anonymous (signed-out) user may call `method urlPath` in
 * AUTH_OPTIONAL mode. Anonymous users get read-only, non-AI access plus
 * save/delete of their own ephemeral chats/debates. Returning false drives the
 * `anon_route_blocked` 403 in the auth gate (t/763).
 */
export function isAnonAllowedRoute(method: string, urlPath: string): boolean {
  // Local-config AI routes (e.g. temperature) are exempt from the blanket AI
  // block — no key, no cost, no abuse vector (t/811). Must precede the block.
  if (ANON_SAFE_AI_ROUTES.includes(urlPath)) return true;
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
    '/api/admin/errors',
    '/api/data/check-updates',
    '/api/community/submit',
    '/focus-node',
    '/debug/events',
  ];
  return safePostPaths.some(p => urlPath === p);
}
