// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared provider-error decoding (t/1620 origin, promoted to a shared module in
// t/1624 once a 2nd call site — aiBackends.refreshAIModels — needed the same
// mapping; Shared Utility Rule). Two adopters:
//   - routes/keys.ts        (Test Keys probe verdict)
//   - ai/aiBackends.ts      (Gemini model-discovery refresh)
// Keep this pure and dependency-free so both server layers can import it without
// pulling in HTTP/route wiring.

// Google details[].reason is the most specific code (e.g. SERVICE_DISABLED).
// Returns the first non-empty string reason in the array, or undefined.
function firstDetailReason(details: unknown): string | undefined {
  if (!Array.isArray(details)) return undefined;
  for (const d of details) {
    const reason = (d as { reason?: unknown })?.reason;
    if (typeof reason === 'string' && reason) return reason;
  }
  return undefined;
}

// First non-empty string-valued field among `keys`, in order — the Google
// top-level status / OpenAI-compatible code/type fallback.
function firstStringField(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

// t/1620: pull the most specific machine-readable reason out of a provider error
// body so a non-200 can be mapped to a real cause instead of a blanket "Invalid
// API key". Handles both dialects the probed providers speak:
//   Google   → { error: { status, message, details: [{ reason }] } }
//   OpenAI-  → { error: { message, type, code } }   (claude/groq/openai/deepseek/zai)
// The body never carries key material (the key rides in the URL/headers), so the
// extracted reason is safe to record. Returns undefined when no reason is present.
export function extractProviderReason(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { status?: unknown; code?: unknown; type?: unknown; details?: unknown };
  // Google: details[].reason is the most specific code (e.g. SERVICE_DISABLED).
  const detailReason = firstDetailReason(e.details);
  if (detailReason) return detailReason;
  // Google top-level status (PERMISSION_DENIED, RESOURCE_EXHAUSTED…) or the
  // OpenAI-compatible code/type field, whichever is present.
  return firstStringField(e as Record<string, unknown>, ['status', 'code', 'type']);
}

// Reason/status predicates for deriveKeyErrorMessage — one per distinguished
// case, conditions moved verbatim. `r` is the upper-cased reason string.
// Quota / rate limit — the key itself is fine, just throttled.
function isQuotaError(status: number, r: string): boolean {
  return status === 429 || r.includes('RESOURCE_EXHAUSTED') || r.includes('RATE_LIMIT') || r.includes('QUOTA');
}
// Required API not enabled on the key's project (Google Generative Language API).
function isApiDisabled(r: string): boolean {
  return r.includes('SERVICE_DISABLED') || r.includes('API_NOT_ENABLED');
}
// Key restricted by referrer / IP / app restrictions — real key, wrong context.
function isRestrictedKey(r: string): boolean {
  return r.includes('HTTP_REFERRER') || r.includes('IP_ADDRESS') || r.includes('API_KEY_ANDROID') || r.includes('API_KEY_IOS');
}
// Permission denied — the key is real but lacks access to this API surface.
function isPermissionDenied(status: number, r: string): boolean {
  return status === 403 || r.includes('PERMISSION_DENIED') || r.includes('FORBIDDEN');
}
// Genuinely malformed / wrong key.
function isInvalidKey(status: number, r: string): boolean {
  return status === 400 || status === 401 || r.includes('API_KEY_INVALID') || r.includes('UNAUTHENTICATED') || r.includes('INVALID_API_KEY');
}

// t/1620: map (HTTP status, provider reason) to a specific, user-safe message.
// Reason checks come first (more specific than the status alone); status is the
// fallback. Distinguishes the four cases the ticket calls out — genuinely-invalid
// vs restricted vs API-not-enabled vs quota — all of which the old code collapsed
// into "Invalid API key" and misled users holding a known-good-but-restricted key.
export function deriveKeyErrorMessage(status: number, reason: string | undefined): string {
  const r = (reason ?? '').toUpperCase();
  if (isQuotaError(status, r)) return 'Key is valid but the provider is rate-limiting or out of quota — retry shortly';
  if (isApiDisabled(r)) return 'Key is valid but the required API is not enabled for its project';
  if (isRestrictedKey(r)) return 'Key is restricted (HTTP referrer / IP / app restrictions) and cannot be used here';
  if (isPermissionDenied(status, r)) return 'Key is valid but not permitted to use this API (permission denied)';
  if (isInvalidKey(status, r)) return 'Invalid API key';
  // Unknown non-200 — status-aware fallback still beats a bald verdict.
  return `Provider rejected the key (HTTP ${status})`;
}
