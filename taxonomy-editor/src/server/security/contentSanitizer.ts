// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Conservative server-side content sanitization (t/856, XSS defense-in-depth).
 *
 * Stored XSS is already triple-mitigated client-side (react-markdown drops raw
 * HTML, strips javascript:/data: URLs, strict CSP blocks inline scripts). This
 * adds a server-side layer so the defense doesn't rely solely on the renderer:
 * a future renderer swap or CSP regression shouldn't make stored content
 * instantly exploitable.
 *
 * Deliberately NARROW to avoid corrupting legitimate markdown/code: it only
 * neutralizes executable tag blocks (script/iframe/style/object/embed) and
 * dangerous URL schemes — it does not strip ordinary HTML-like text, `<`/`>`
 * comparison operators, or fenced code content structure.
 */

const EXECUTABLE_TAGS = /<\/?(?:script|iframe|object|embed|style)\b[^>]*>/gi;
const DANGEROUS_SCHEME = /\b(?:javascript|vbscript):/gi;
const DATA_HTML = /\bdata:text\/html/gi;

/**
 * Neutralize executable tags + dangerous URL schemes in a single string.
 *
 * t/2023 (CodeQL js/incomplete-multi-character-sanitization): a SINGLE pass is
 * bypassable because removing one match can reform another — `<scr<script>ipt>`
 * strips the inner tag and leaves `<script>`, and removing tags can concatenate
 * halves into a scheme (`java<script></script>script:` → `javascript:`). So each
 * removal is applied to a FIXED POINT: repeat `replace` until the string stops
 * changing (the canonical CodeQL-recognized remediation — the loop exits ONLY on
 * stability, never on a bound, so the result provably contains no residual match).
 *
 * Order matters: strip executable tags fully first — that both handles nested
 * tags and exposes any scheme that tag-splitting concealed — then neutralize
 * schemes. Scheme/data replacements never contain `<`, so they can't reform a
 * tag, so the tag loop need not re-run afterward.
 *
 * Termination: every changed tag-pass strictly shrinks the string (each removes
 * ≥1 tag); scheme substitutions are shrinking and idempotent after the first
 * pass — so every loop converges. No fail-closed bound is needed (an early bound
 * would let the loop return a possibly-unsanitized string, which is the very
 * defect this query flags).
 *
 * The three regexes are linear-time (single bounded `[^>]*`, fixed alternations,
 * literals) — no nested/overlapping unbounded quantifiers, so no ReDoS.
 */
export function sanitizeUserText(s: string): string {
  let out = s;
  let prev: string;
  do { prev = out; out = out.replace(EXECUTABLE_TAGS, ''); } while (out !== prev);
  do { prev = out; out = out.replace(DANGEROUS_SCHEME, 'blocked:'); } while (out !== prev);
  do { prev = out; out = out.replace(DATA_HTML, 'data:blocked'); } while (out !== prev);
  return out;
}

/** Recursively sanitize every string in a JSON-like value (arrays/objects). */
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === 'string') return sanitizeUserText(value) as unknown as T;
  if (Array.isArray(value)) return value.map(sanitizeDeep) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeDeep(v);
    return out as unknown as T;
  }
  return value;
}
