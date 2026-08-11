// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Pure access-control decisions extracted from server.ts so they can be unit
// tested (server.ts calls server.listen() at import time and isn't import-safe).
// See t/720 (L1, L3, L6).

import path from 'path';
import crypto from 'crypto';
import type { IncomingHttpHeaders } from 'http';
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

// UUID v4: version bit = 4, variant bits = [89ab]. Matches exactly
// crypto.randomUUID() output — length and charset are checked simultaneously.
const ANON_SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** t/2464: true iff `id` has the exact shape produced by crypto.randomUUID(). */
export function isValidAnonSessionId(id: string): boolean {
  return ANON_SESSION_UUID_RE.test(id);
}

/**
 * t/2464: reuse-not-rotate. Returns `existing` when it is a well-formed UUID v4
 * (the only shape this server ever mints), otherwise mints a fresh one.
 *
 * INVARIANT: `existing` MUST come from parseCookies(req) — never from a query
 * parameter, request body, or header. The HttpOnly flag prevents JS from forging
 * the cookie; query/body/header inputs are untrusted and must never reach here.
 */
export function resolveAnonSessionId(existing: string | undefined): string {
  return (existing !== undefined && isValidAnonSessionId(existing))
    ? existing
    : crypto.randomUUID();
}

/**
 * Mint the two anonymous-session cookies: the `auth_anonymous=1` flag the auth
 * gate reads and the `anon_session_id` pseudonymous identifier. Shared by
 * GET /.auth/anonymous (302) and POST /api/auth/anonymous (JSON, t/1483) so
 * the Secure-flag gating can't drift between the two mint sites.
 * HttpOnly (never read by JS) and SameSite=Lax. Secure is added in production
 * or whenever cross-origin is configured. Max-Age=1yr on anon_session_id makes
 * it persistent across browser sessions (t/2464); auth_anonymous stays session-
 * scoped so it acts as a "logged in anonymously" signal only while the tab is open.
 */
export function anonymousSessionCookies(sessionId: string): string[] {
  const secureSuffix = process.env.NODE_ENV === 'production' || process.env.ALLOWED_ORIGINS ? '; Secure' : '';
  return [
    `auth_anonymous=1; Path=/; HttpOnly; SameSite=Lax${secureSuffix}`,
    `anon_session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secureSuffix}`,
  ];
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

export type TestPersona = 'anonymous' | 'authenticated' | 'admin';
/** Fixed non-admin principal for the `authenticated` persona (must not be an ADMIN_USERS entry). */
const TEST_PERSONA_AUTH_USER = 'test-persona-user';

/** Constant-time string compare (equal-length only; length mismatch → false). */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * t/1125: dev/staging-only short-circuit of Azure Easy Auth for the persona test
 * matrix (Test-PersonaEndpoints, t/1103). Lets a CLI regression net exercise the
 * `authenticated`/`admin` rows without a real browser OAuth round-trip.
 *
 * PRODUCTION-INERT by construction: the whole path is unreachable unless the
 * deployment sets `ENABLE_TEST_PERSONA_HEADER=1` AND a matching `TEST_PERSONA_SECRET`.
 * With the env var unset (the prod default) this returns null immediately, so the
 * `X-Test-Persona` header is completely ignored — Easy Auth handling is untouched.
 *
 * Returns:
 *  - `null` — feature disabled, or no `X-Test-Persona` header (normal Easy Auth path).
 *  - `{ error }` — enabled + persona header present but the shared secret is
 *    missing/wrong, or the persona value is invalid (caller responds 401).
 *  - `{ principalName, idp, persona }` — the override identity to use for the
 *    rest of the request. Admin/tier resolution then flows normally from there.
 *
 * The `admin` persona uses idp `github`, for which deriveStorageUserId is just a
 * lowercase identity — so `adminUsers[0]` (already in its derived form) resolves
 * back to itself and lands in ADMIN_USERS for whatever the deployment configures.
 */
export function resolveTestPersonaOverride(
  headers: IncomingHttpHeaders,
  adminUsers: string[],
): { principalName: string; idp: string; persona: TestPersona } | { error: 'test_persona_bad_secret' | 'test_persona_invalid' } | null {
  if (process.env.ENABLE_TEST_PERSONA_HEADER !== '1') return null; // disabled (prod default)

  const persona = headers['x-test-persona'];
  if (typeof persona !== 'string' || persona === '') return null; // no override requested

  // Shared-secret gate: a non-empty TEST_PERSONA_SECRET must be configured AND match.
  const expected = process.env.TEST_PERSONA_SECRET ?? '';
  const provided = typeof headers['x-test-persona-secret'] === 'string' ? headers['x-test-persona-secret'] as string : '';
  if (!expected || !timingSafeEqualStr(provided, expected)) {
    return { error: 'test_persona_bad_secret' };
  }

  switch (persona) {
    case 'anonymous':
      return { principalName: '', idp: '', persona };
    case 'authenticated':
      return { principalName: TEST_PERSONA_AUTH_USER, idp: 'github', persona };
    case 'admin':
      return { principalName: adminUsers[0] ?? '', idp: 'github', persona };
    default:
      return { error: 'test_persona_invalid' };
  }
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

// Routes blocked for anonymous callers regardless of HTTP method: the blanket AI
// block plus specific non-AI routes with cost/abuse potential. The ANON_SAFE_AI_ROUTES
// exemption is checked by the caller BEFORE this, so a temperature-style local-config
// route escapes the AI-prefix block. Fail-closed: any listed match blocks the request.
function isAnonBlockedRoute(urlPath: string): boolean {
  // Block all AI-related routes regardless of method
  if (AI_ROUTE_PREFIXES.some(p => urlPath.startsWith(p))) return true;
  if (urlPath === '/api/evidence-qbaf') return true;
  if (urlPath === '/api/models/refresh') return true;
  if (urlPath.startsWith('/api/harvest/')) return true;
  return /^\/api\/debates\/[^/]+\/news-report$/.test(urlPath);
}

// Anonymous users can save/delete their own ephemeral chats and debates.
// Matches both '/api/debates' (create/save) and '/api/debates/{id}' (update/delete).
// NOTE: this is used only for POST/PUT/DELETE — PATCH has its own narrow check below
// (t/2230) to prevent future sub-paths from silently inheriting anon write access.
function isAnonUserContentRoute(urlPath: string): boolean {
  return urlPath === '/api/chats' || urlPath.startsWith('/api/chats/')
    || urlPath === '/api/debates' || urlPath.startsWith('/api/debates/');
}

// POST routes anonymous callers may reach: read-like operations only, everything
// else blocked. Exact-match allowlist (no prefixes).
const ANON_SAFE_POST_PATHS = [
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
  if (isAnonBlockedRoute(urlPath)) return false;

  if (method === 'GET') return true;

  const isMutation = method === 'POST' || method === 'PUT' || method === 'DELETE';
  if (isMutation && isAnonUserContentRoute(urlPath)) return true;

  // PATCH is allowed only for debate delta saves on a specific debate id (t/2230).
  // Deliberately not routed through isAnonUserContentRoute — that prefix match would
  // silently grant anon PATCH to /api/chats/:id and future debate sub-paths.
  if (method === 'PATCH') return /^\/api\/debates\/[^/]+$/.test(urlPath);

  if (method === 'PUT' || method === 'DELETE') return false;

  // POST: allowlist read-like operations, block everything else
  return ANON_SAFE_POST_PATHS.some(p => urlPath === p);
}
