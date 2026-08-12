// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Renderer-side transient-failure classifier for AI-call auto-retry (t/2492).
 *
 * The bug this fixes: debate opening-statement retry engaged ONLY on HTTP 429, so a ~3-minute
 * timeout / 5xx / network failure was classified non-retryable → 1 attempt → manual Retry banner.
 * This broadens "retryable" to all transient failures while still refusing terminal ones.
 *
 * NOT shared with `lib/ai-client/retry.ts` by design (TL, t/2492#2): that is the low-level
 * per-call AI-client retry layer (server-side 5× + model fallback); this is the renderer's
 * user-facing debate/chat orchestration retry. Keep the two policies independent; if you change
 * the transient-status set here, consider whether lib/ai-client/retry.ts wants the same.
 */

import { isDailyLimitError } from '../hooks/useDebateStore/shared/guards';

/** Why a failure was (not) retried — stamped onto FR retry/exhaustion events + banner text. */
export type RetryReason = 'rate_limit' | 'server' | 'timeout' | 'network' | 'non_retryable';

export interface RetryClassification {
  retryable: boolean;
  reason: RetryReason;
}

/** HTTP statuses treated as transient server failures (in addition to 429 rate-limiting). */
const TRANSIENT_SERVER_STATUSES = new Set([502, 503, 504, 529]);

/**
 * Classify an AI-call failure for auto-retry.
 *
 * Retryable: 429 rate-limit (unless daily-limit), transient 5xx (502/503/504/529),
 * request timeouts (AbortError / "timed out"), and network failures (failed to fetch).
 * Not retryable: daily-limit, other 4xx (auth/validation), and content/schema errors
 * (JSON-parse failures carry no httpStatus and match no transient signature → non_retryable).
 */
export function classifyAiRetry(err: unknown): RetryClassification {
  // Daily-limit is a hard stop even though it surfaces as 429.
  if (isDailyLimitError(err)) return { retryable: false, reason: 'non_retryable' };

  const httpStatus = (err as { httpStatus?: number } | null | undefined)?.httpStatus;

  if (httpStatus === 429) return { retryable: true, reason: 'rate_limit' };
  if (typeof httpStatus === 'number' && TRANSIENT_SERVER_STATUSES.has(httpStatus)) {
    return { retryable: true, reason: 'server' };
  }
  // Any other explicit HTTP status is a terminal client/server response (401/403/422/400/500…).
  if (typeof httpStatus === 'number') return { retryable: false, reason: 'non_retryable' };

  // No httpStatus — inspect name/message for timeout and network signatures.
  const name = (err as { name?: string } | null | undefined)?.name ?? '';
  const message = String((err as { message?: unknown } | null | undefined)?.message ?? err ?? '');
  if (name === 'AbortError' || /timed?\s*out|timeout|ETIMEDOUT|deadline exceeded/i.test(message)) {
    return { retryable: true, reason: 'timeout' };
  }
  if (/failed to fetch|network|fetch failed|ECONNRESET|ENOTFOUND|socket hang up/i.test(message)) {
    return { retryable: true, reason: 'network' };
  }

  return { retryable: false, reason: 'non_retryable' };
}

/** User-facing banner fragment for a retry-in-progress, by reason. */
export function retryReasonLabel(reason: RetryReason): string {
  switch (reason) {
    case 'rate_limit': return 'was rate limited';
    case 'server': return 'hit a temporary server error';
    case 'timeout': return 'timed out';
    case 'network': return 'hit a network error';
    default: return 'failed';
  }
}
