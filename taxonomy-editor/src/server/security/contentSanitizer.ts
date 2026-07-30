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

// Fail-closed backstop for the fixed-point loop below. Termination does NOT
// depend on this cap — every changed pass strictly shrinks the string (tag
// removal deletes chars; scheme/data substitutions are shrinking), so the loop
// provably converges on its own. The cap only bounds a hypothetical future
// change that broke the shrinking property. Non-adversarial content converges in
// ~1 pass; matryoshka-nested tags need ~depth+2 passes, so the cap is set well
// above any realistic nesting (a legit document with >100 levels of nested
// tag-like text does not exist) while still tripping the fail-closed strip on a
// deliberately pathological input rather than looping unbounded.
const MAX_SANITIZE_PASSES = 100;

/**
 * Neutralize executable tags + dangerous URL schemes in a single string.
 *
 * t/2023 (CodeQL js/incomplete-multi-character-sanitization): a SINGLE pass is
 * bypassable because removing one match can reform another — `<scr<script>ipt>`
 * strips the inner tag and leaves `<script>`, and removing tags can concatenate
 * halves into a scheme (`java<script></script>script:` → `javascript:`). So we
 * apply the pipeline to a FIXED POINT (repeat until the string stops changing).
 *
 * Termination: every pass that matches a tag strictly shortens the string (finite
 * tags); the scheme/data replacements are idempotent once no tag reforms them —
 * so the loop converges. MAX_SANITIZE_PASSES is a defensive, fail-closed backstop:
 * if a pathological input somehow hasn't converged, we strip all angle brackets so
 * no tag can survive rather than return possibly-executable content.
 *
 * The three regexes are linear-time (single bounded `[^>]*`, fixed alternations,
 * literals) — no nested/overlapping unbounded quantifiers, so no ReDoS.
 */
export function sanitizeUserText(s: string): string {
  let out = s;
  let prev: string;
  let passes = 0;
  do {
    prev = out;
    out = out
      .replace(EXECUTABLE_TAGS, '')
      .replace(DANGEROUS_SCHEME, 'blocked:')
      .replace(DATA_HTML, 'data:blocked');
    passes++;
  } while (out !== prev && passes < MAX_SANITIZE_PASSES);
  // Fail-closed: non-convergence within the cap means a pathological input —
  // guarantee no executable tag can survive by neutralizing residual brackets.
  if (out !== prev) out = out.replace(/[<>]/g, '');
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
