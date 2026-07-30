// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Auth-exempt (public) request paths — extracted verbatim from handleRequestInner's
 * `isPublicPath` OR-chain (t/1910) so the allowlist is testable in isolation (server.ts
 * boots the HTTP server on import) and the match-kind split is explicit.
 *
 * MATCH-KIND IS LOAD-BEARING (Server Auth review, p/135#8): each term keeps EXACTLY the
 * kind it had in the original chain — the 15 `urlPath === X` terms are exact matches
 * (PUBLIC_EXACT_PATHS), the 7 `urlPath.startsWith(X)` terms are prefixes
 * (PUBLIC_PATH_PREFIXES). Promoting an exact path to a prefix WIDENS the allowlist =
 * auth bypass (the severe direction), so never move a term between the two lists.
 * Watch the flip pair: `/sw.js` is EXACT, `/workbox-` is a PREFIX.
 */

/** Exact-match public paths (were `urlPath === X`). */
export const PUBLIC_EXACT_PATHS: ReadonlySet<string> = new Set<string>([
  '/health',
  '/healthz',
  '/status',
  '/api/models',            // pre-auth model catalog from ai-models.json (labels/ids, no secrets)
  '/api/data/available',
  '/api/auth/me',
  '/api/auth/logout',       // t/897: logout must work even for authed-but-unauthorized users
  '/api/diagnostics/sw-state', // t/1128: pre-auth SW-state beacon from the login page
  '/llms.txt',              // t/1143: public llms.txt discovery file
  '/api/config/client',     // t/927: public client config subset (no secrets)
  '/api/user/profile',
  '/api/sync/webhook/github', // GitHub POSTs unauthenticated; handler does its own HMAC verify
  '/api/community/submit',
  '/manifest.webmanifest',
  '/sw.js',                 // EXACT — contrast the '/workbox-' PREFIX below
]);

/** Prefix public paths (were `urlPath.startsWith(X)`). */
export const PUBLIC_PATH_PREFIXES: readonly string[] = [
  '/api/auth/fresh-login/', // t/1032: pre-auth fresh sign-in (clears stale cookies, then OAuth)
  '/api/public/',           // t/1788: reserved auth-exempt namespace — Server Auth sign-off to extend
  '/share/',                // t/1789: public POV-share SPA shell — Server Auth sign-off to extend
  '/.auth/',
  '/assets/',
  '/workbox-',              // PREFIX — Workbox precache asset filenames
  '/icons/',
];

/**
 * True when `urlPath` is auth-exempt: an exact match in PUBLIC_EXACT_PATHS, or a prefix
 * match against PUBLIC_PATH_PREFIXES. Order-independent (OR / any-match), so this is
 * equivalent to the original `===`/`startsWith` OR-chain regardless of term order.
 */
export function computeIsPublicPath(urlPath: string): boolean {
  return PUBLIC_EXACT_PATHS.has(urlPath) || PUBLIC_PATH_PREFIXES.some(p => urlPath.startsWith(p));
}
