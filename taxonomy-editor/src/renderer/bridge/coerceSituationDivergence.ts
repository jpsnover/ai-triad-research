// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { getGlobalRecorder } from '@lib/flight-recorder/index';

/**
 * Defense-in-depth at the situations load boundary (t/3002).
 *
 * `interpretation_divergence` MUST be a number for the UI — SituationDetail (and others)
 * call `.toFixed()` on it. A producer mismatch once shipped it as a string, which crashed
 * the Situations tab silently (t/2994; the 5 bad nodes are corrected by the sibling data
 * fix, but the load boundary had no validation, so a future mismatch would crash again).
 *
 * This coerces at ingest: a numeric string ("0.52") becomes a number; a non-numeric string
 * ("moderate") is stripped to `undefined`; and any string arrival is recorded so the
 * mismatch is observable in the flight recorder instead of fatal.
 *
 * Mutates the freshly-loaded nodes in place and returns the same reference. Non-situation
 * inputs (no `nodes` array) pass through untouched, so it is safe to wrap any load result.
 *
 * NOTE: the flight-recorder EventType union has no `system.warning` (see
 * lib/oped/generate.ts and taxonomyDataSlice.ts) — the ticket's "system.warning" is emitted
 * as the canonical `system.error` + `level: 'warn'`.
 */
export function coerceSituationDivergence<T>(file: T): T {
  const nodes = (file as { nodes?: unknown } | null | undefined)?.nodes;
  if (!Array.isArray(nodes)) return file;

  for (const node of nodes as Array<Record<string, unknown>>) {
    if (!node || typeof node !== 'object') continue;
    const value = node.interpretation_divergence;
    if (typeof value !== 'string') continue; // already a number, undefined, etc. — leave as-is

    const parsed = Number(value);
    const coerced = value.trim() !== '' && Number.isFinite(parsed);
    node.interpretation_divergence = coerced ? parsed : undefined;

    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'situations-load',
      level: 'warn',
      message: coerced
        ? `interpretation_divergence arrived as a numeric string on ${String(node.id ?? '?')}; coerced "${value}" → ${parsed} (t/3002)`
        : `interpretation_divergence arrived as a non-numeric string on ${String(node.id ?? '?')}; stripped "${value}" (t/3002)`,
      data: { nodeId: node.id, value, action: coerced ? 'coerced' : 'stripped' },
    });
  }
  return file;
}
