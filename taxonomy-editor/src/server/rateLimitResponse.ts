/**
 * Shared shape for a GitHub-API rate-limit (429) response body (t/685).
 *
 * When the API is exhausted, write endpoints (e.g. community submit) return this
 * instead of an opaque 500, so clients can back off until the limit resets.
 * Pure + side-effect-free so it can be unit-tested without the HTTP layer.
 */

export interface RateLimitBody {
  error: 'rate_limited';
  message: string;
  /** Seconds until the rate limit resets (>= 1). */
  retryAfter: number;
}

const FALLBACK_RETRY_SECONDS = 60;

/**
 * Build the 429 body from the rate-limit reset time. Falls back to 60s when the
 * reset time is unknown, non-finite, or already in the past.
 */
export function rateLimitResponseBody(resetsAtMs: number, nowMs: number): RateLimitBody {
  let retryAfter = FALLBACK_RETRY_SECONDS;
  if (Number.isFinite(resetsAtMs) && resetsAtMs > nowMs) {
    retryAfter = Math.ceil((resetsAtMs - nowMs) / 1000);
  }
  const mins = Math.max(1, Math.ceil(retryAfter / 60));
  return {
    error: 'rate_limited',
    message: `GitHub API rate limited. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
    retryAfter,
  };
}
