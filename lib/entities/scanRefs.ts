// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { parseEntityRef } from './types.js';
import type { EntityRef } from './types.js';

/** A detected ref token in free text. `start` inclusive / `end` exclusive char offsets;
 *  `raw` is the matched token; `ref` is its typed {@link EntityRef}. */
export interface RefSpan {
  ref: EntityRef;
  start: number;
  end: number;
  raw: string;
}

// Candidate ID-token detector (t/1814). Prefix-anchored alternation covering all six kinds;
// every candidate is validated + typed by parseEntityRef, and unrecognized tokens are dropped
// (no false linkification). A token must not be embedded in a larger alphanumeric run — the
// negative lookbehind/lookahead enforce token boundaries — and suffixes start and end on an
// alphanumeric (no leading/trailing hyphen). IDs are lowercase by convention, so matching is
// lowercase-only. `\d+` on node ids is greedy → maximal (longest) match at each position.
const SUFFIX = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?'; // alnum-bounded, interior hyphens allowed
const REF_TOKEN_RE = new RegExp(
  '(?<![A-Za-z0-9])(?:' +
    `term:${SUFFIX}` +                                         // term:<slug>
    '|(?:acc|saf|skp)-(?:beliefs|desires|intentions)-\\d+' +   // node {pov}-{cat}-NNN
    `|(?:sit|cc|pol|ent|org)-${SUFFIX}` +                      // situation/policy/entity/organization
  ')(?![A-Za-z0-9])',
  'g',
);

/**
 * Detect selectable ID-token references in free statement/chat text and return typed,
 * **non-overlapping, left-to-right** spans. Tokens that fail {@link parseEntityRef} are
 * dropped (never emitted). Detects ALL six kinds — v1 render surfaces apply their own
 * kind filter at the render boundary (so enabling org/entity linkification later is a
 * consumer filter flip, not a scanner change).
 *
 * Pure: no React, no I/O. Single source of truth for ref detection shared by t/1776
 * (debate render) and t/1777 (chat). (t/1814)
 *
 * Overlap rule: matches are non-overlapping and leftmost — the regex scan consumes each
 * token's span before continuing, and within a position the maximal token is taken.
 */
export function scanRefs(text: string): RefSpan[] {
  const spans: RefSpan[] = [];
  REF_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_TOKEN_RE.exec(text)) !== null) {
    const raw = m[0];
    const ref = parseEntityRef(raw);
    if (!ref) continue; // candidate didn't validate — refusal discipline, never emit
    spans.push({ ref, start: m.index, end: m.index + raw.length, raw });
  }
  return spans;
}
