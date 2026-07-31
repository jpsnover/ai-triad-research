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

import { log } from '../logger.js';

// t/2029 — input-size cap (DoS backstop). The tag `[^>]*` tail scans O(n) per
// starting position, so pathological input (`<script` repeated with no closing
// `>`) costs O(n²) and can block the event loop (~1.6 s / 140 KB). The global
// body limit is 50 MB and not every caller length-caps its fields
// (`community.ts` sanitizes arbitrary content-map values), so the sanitizer must
// self-defend. Truncating the INPUT bounds cost to O(CAP²) (~80 ms) while leaving
// `[^>]*` unbounded — no per-tag length bound, hence no bypass. 32 KiB is 3.3× the
// largest existing caller field cap (feedback text ≤10 000 chars), so legitimate
// single-field content never reaches it. Truncate-then-sanitize is fail-safe: the
// sanitizer still runs on the kept prefix, so a tag split by the cut is inert text.
// (Slice is by UTF-16 code unit; a surrogate pair split at the boundary leaves a
// lone surrogate — still inert text, a cosmetic data wrinkle, never a bypass.)
// Exported for a single source of truth in the boundary tests.
export const MAX_SANITIZE_INPUT = 32 * 1024;

// t/2027 — control-char obfuscation hardening. Attackers split a dangerous
// keyword with control characters the browser later elides (`java\tscript:`,
// `javascript\0:`, `<scr\0ipt>`), slipping past a contiguous-literal match. An
// optional CTRL class folded between every keyword letter neutralizes these;
// because the whole obfuscated span is replaced, embedded control chars are
// removed only inside the dangerous match — legit whitespace/newlines elsewhere
// (markdown, code fences) are untouched. Set = C0 controls + DEL, NOT space:
// 0x20 isn't stripped mid-scheme by browsers, so folding it would false-positive
// on legit prose ("the java script docs"). TAB/CR/LF/NUL are the real live
// vectors; the rest of C0+DEL is conservative, fail-safe over-inclusion. The
// tag-name fold is likewise conservative (a spec tokenizer ends the tag name at
// TAB/LF/FF/space rather than eliding it) — over-inclusive removal, still safe.
const CTRL = '[\\x00-\\x1F\\x7F]*';
const gap = (word: string): string => word.split('').join(CTRL);
const EXECUTABLE_TAGS = new RegExp(
  `</?(?:${['script', 'iframe', 'object', 'embed', 'style'].map(gap).join('|')})\\b[^>]*>`,
  'gi',
);
const DANGEROUS_SCHEME = new RegExp(`\\b(?:${gap('javascript')}|${gap('vbscript')})${CTRL}:`, 'gi');
const DATA_HTML = new RegExp(`\\b${gap('data')}${CTRL}:${CTRL}${gap('text')}${CTRL}/${CTRL}${gap('html')}`, 'gi');

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
 * Per-match linear: the folded `[\x00-\x1F\x7F]*` classes sit between distinct
 * literals (no `X*X*` adjacency, no nested/overlapping unbounded quantifiers), so
 * the control-char fold adds no ReDoS. The tag `[^>]*` tail's O(n) per-position
 * worst-case scan (pathological no-`>` input → O(n²)) is bounded by the
 * MAX_SANITIZE_INPUT truncation at the top of the function (t/2029).
 */
export function sanitizeUserText(s: string): string {
  let out = s;
  // t/2029 DoS backstop: truncate oversized input BEFORE the O(n²)-prone loops.
  // Best-effort log (never the content — secrets rule) so oversized input isn't
  // invisible to ops; logging must never break sanitization, hence the try/catch.
  if (out.length > MAX_SANITIZE_INPUT) {
    try {
      log.security.warn(
        { originalLength: out.length, cap: MAX_SANITIZE_INPUT },
        'sanitizeUserText: input exceeded cap — truncated before sanitization',
      );
    } catch { /* telemetry — silent by design: this catch wraps the logger itself, so it cannot log; sanitization must proceed regardless */ }
    out = out.slice(0, MAX_SANITIZE_INPUT);
  }
  let prev: string;
  // TERMINATION INVARIANT (nothing else bounds these loops — they exit ONLY on
  // stability, `out === prev`): every replacement below MUST strictly shrink the
  // string OR replace with an irreversible sentinel that can never re-match its
  // own pattern. Tag removal deletes chars; `javascript:`/`vbscript:` → `blocked:`
  // and `data:text/html` → `data:blocked` are sentinels that don't re-match. A
  // future rule that could GROW the string or oscillate would infinite-loop here.
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
