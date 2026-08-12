// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2489: the explicit allowlist of AI POST routes that keyless (anonymous)
// callers may reach in AUTH_OPTIONAL mode via the FREE tier, extracted from the
// inline isFreeTierRoute in server.ts so it is unit-testable without booting the
// HTTP server (server.ts calls server.listen() at import).
//
// This is an EXEMPTION, not a removal of the anon block (TL t/2489#1): a listed
// route escapes the `anon_route_blocked` 403 ONLY when the free tier is enabled;
// every other AI route stays blocked. Reaching the free tier is load-bearing for
// safety — resolveTier('') pins the model to free-tier Gemini (paid model ids are
// downgraded, never billed), enforces free-tier RPM + daily-token limits, and
// isBackendAllowed rejects non-Gemini. Routing anon chat through here (not the
// generic anon-allowlist) is what carries all of guardrail #2.
//
// Exact-match (===) is load-bearing (Server-Auth p/135#8) — never widen to a
// prefix: a prefix would expose sibling AI routes (e.g. /api/ai/generate/x) to
// keyless callers. Add a route here only with an auth-surface (TL) review.

/** POST paths keyless callers may reach via the free tier (exact-match only). */
export const FREE_TIER_AI_POST_PATHS: readonly string[] = [
  '/api/ai/generate',
  '/api/embeddings/compute',
  '/api/embeddings/query',
  '/api/ai/chat-stream', // t/2489: anonymous users may use AI chat (free-tier Gemini)
];

/**
 * Whether `method urlPath` is a free-tier-exempt AI route. Callers additionally
 * gate on `freeTierEnabled()` (a matched route is only exempt when the server has
 * a free-tier key) — kept separate so the path membership is a pure function.
 */
export function isFreeTierAiPath(method: string, urlPath: string): boolean {
  return method === 'POST' && FREE_TIER_AI_POST_PATHS.includes(urlPath);
}
