// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * PURE secret-strip + sanitize TRAVERSAL for the community-promote path (t/2037,
 * extracted from the byte-identical copies in server/community/community.ts (t/2032)
 * and main/communityReviewIO.ts (t/2033) per the owner-extract / consumers-adopt rule).
 *
 * The KEY SET (`SENSITIVE_KEYS`) and the secret-prefix screen (`SECRET_PREFIX_RE`) were
 * verified byte-identical across both copies before sharing (t/2037 parity check); the
 * only per-transport difference was the sanitize call, so the traversal takes the
 * `sanitize` fn as a parameter — the server passes its pino+ALS-budget `sanitizeUserText`
 * (keeping `withSanitizeBudget` OUTSIDE this helper — the ALS budget is a server-HTTP-only
 * concern, t/2033#6), the desktop passes the pure `sanitizeText` bound to its
 * flight-recorder `onWarn`. No logger, no ALS, no transport coupling.
 */

/** Keys whose VALUES are dropped wholesale from the public community blob. */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set<string>([
  'api_key', 'apiKey', 'api_keys', 'apiKeys',
  'secret', 'token', 'password', 'credential', 'credentials',
  'authorization', 'auth_token', 'access_token', 'refresh_token',
  'private_key', 'privateKey',
  'flight_recorder', 'debug', '_internal', 'diagnostics_state',
]);

/**
 * Single source of truth for the secret-prefix screen — used by BOTH the object and
 * array branches so the array branch can never ship without a secret screen (the
 * two-branches-one-updated drift the t/2032 fix closed). Kept byte-identical to the
 * original community.ts copy.
 */
export const SECRET_PREFIX_RE = /^(sk-|AIza|gsk_|key-|xai-|Bearer\s)/;

/**
 * Recursively strip sensitive keys + secret-prefixed strings and sanitize the rest,
 * before a community record is served publicly.
 *
 * @param obj      the value to screen (object / array / scalar).
 * @param sanitize per-transport text sanitizer applied to surviving string values
 *   (server: pino+ALS `sanitizeUserText`; desktop: pure `sanitizeText` + FR `onWarn`).
 *
 * Array string elements have no key to omit, so each is screened in place —
 * secret-prefix FIRST (redacted to '' so a `sk-…` value can't leak while the array
 * shape is preserved), else sanitized; non-strings recurse. Object entries drop any
 * SENSITIVE_KEYS key, skip secret-prefixed string values entirely, sanitize surviving
 * strings, and recurse into nested objects/arrays.
 */
export function stripSensitiveKeys(obj: unknown, sanitize: (s: string) => string): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((v) => {
      if (typeof v !== 'string') return stripSensitiveKeys(v, sanitize);
      if (SECRET_PREFIX_RE.test(v)) return '';
      return sanitize(v);
    });
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (typeof value === 'string') {
      if (SECRET_PREFIX_RE.test(value)) continue;
      result[key] = sanitize(value);
      continue;
    }
    result[key] = stripSensitiveKeys(value, sanitize);
  }
  return result;
}
