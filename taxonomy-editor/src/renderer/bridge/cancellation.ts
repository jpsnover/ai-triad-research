// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Deliberate-cancellation error tagging (t/2508, HLD t/2506#1).
 *
 * When a user aborts an in-flight AI request (Switch model mid-brief, Cancel debate),
 * the bridge rejects with an error carrying `cancelled: true`. Downstream pipeline
 * catches use {@link isCancellationError} to bail quietly — no error toast, no
 * auto-retry — instead of treating it as a failure.
 *
 * The tag travels with the error rather than being inferred from a live abort
 * controller: `cancelAndResetAbort()` nulls the debate controller and a replacement
 * run may install a fresh one, so by the time an abandoned request's rejection
 * reaches its catch the live controller no longer reflects that request. The tag
 * makes detection race-free.
 *
 * Zero-dependency by design so both bridges (`web-bridge`, `electron-bridge`) and the
 * debate-store `guards` module can import it without an import cycle.
 */

export function isCancellationError(err: unknown): boolean {
  return (err as { cancelled?: boolean } | null)?.cancelled === true;
}

/** Build the tagged cancellation error the bridge rejects with on a caller abort. */
export function makeCancellationError(message = 'AI request cancelled by caller'): Error {
  const e = new Error(message);
  e.name = 'AbortError';
  (e as Error & { cancelled: boolean }).cancelled = true;
  return e;
}
