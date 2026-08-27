// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/3067: Filter a server FR dump NDJSON to only events from `sessionBranch`.
 *
 * Filtering rules:
 * - _type: header / dictionary / trigger — structural; always kept.
 * - _type: context — always excluded; contains process-global state
 *   (active_branches, shared GitHub quota, aggregate cache rates).
 * - All other lines (events): kept only when _sessionBranch === sessionBranch.
 *   Exclude-by-default: null or absent _sessionBranch means startup/background
 *   (no request context) → excluded from any user-scoped dump.
 * - Pino tee lines (type: log.line, no _sessionBranch) are excluded by the
 *   same rule, keeping key_hash/key_slot and other log-level fields out of
 *   non-admin dumps.
 *
 * This is a pure function with no I/O — safe to unit-test and call from any
 * request handler without side effects.
 */
export function filterSessionEvents(ndjson: string, sessionBranch: string): string {
  // Fail-CLOSED: empty/null caller → return nothing rather than leaking everything.
  if (!sessionBranch) return '\n';

  const kept: string[] = [];
  for (const line of ndjson.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(trimmed); } catch { continue; }
    const lineType = parsed._type as string | undefined;
    if (lineType === 'header' || lineType === 'trigger') {
      kept.push(trimmed);
    } else if (lineType === 'dictionary') {
      // The intern table is process-GLOBAL — it crosses session boundaries (latent
      // leak once paths/userIds are interned). The serializer already expands handles
      // into each event, so the table is redundant in a session-scoped dump. Emit an
      // empty placeholder so the NDJSON format remains structurally valid.
      kept.push(JSON.stringify({ _type: 'dictionary', entries: [] }));
    } else if (lineType === 'context') {
      // Always global — exclude from session-scoped dump
    } else if (parsed._sessionBranch === sessionBranch) {
      kept.push(trimmed);
    }
  }
  return kept.length > 0 ? kept.join('\n') + '\n' : '\n';
}
