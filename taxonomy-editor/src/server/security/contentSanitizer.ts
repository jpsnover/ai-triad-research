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
 *
 * t/2030 — entity/numeric-char-ref canonicalization. CommonMark (react-markdown)
 * decodes HTML entities and numeric character references in link destinations
 * BEFORE the URL scheme is honored, so a literal-only matcher misses
 * `javascript&colon;alert(1)` and `&#106;avascript:` — both reconstitute a live
 * scheme at render. We defeat this by decoding refs into a SHADOW copy, matching
 * against it, and rewriting only when the shadow reveals a threat (see
 * sanitizeUserText). Design: t/2030#1, TL sign-off e/52#2.
 */

import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import { decodeNumericCharacterReference } from 'micromark-util-decode-numeric-character-reference';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { log } from '../logger.js';

// t/2029 — input-size cap (DoS backstop). The tag `[^>]*` tail scans O(n) per
// starting position, so pathological input (`<script` repeated with no closing
// `>`) costs O(n²) and can block the event loop (~1.6 s / 140 KB). The global
// body limit is 50 MB and not every caller length-caps its fields
// (`community.ts` sanitizes arbitrary content-map values), so the sanitizer must
// self-defend. Truncating the INPUT bounds the cost to a fixed worst case while
// leaving `[^>]*` unbounded — no per-tag length bound, hence no bypass. At CAP the
// worst case is the nested tag-reforming "onion" (~4681 `<style>`-reforming layers)
// that drives the fixed-point loop through ~O(layers²) passes: empirically ~120 ms
// (a single no-`>` scan is ~70 ms) — always ≪ the pre-fix multi-second blow-up.
// 32 KiB is 3.3× the
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
// t/2030 (Finding B) — broadened from data:text/html to the whole executable-markup
// media-type FAMILY (TL e/52#2, option b). `data:image/svg+xml`,
// `application/xhtml+xml`, `application/xml`, `text/xml` and any future `*+xml`
// subtype can all carry executable <script> when navigated/embedded. Rule: any
// `data:` whose subtype ENDS IN `html` or `xml` — that captures html, xhtml,
// xml, svg+xml, xhtml+xml, and future `foo+xml` in one shot. Non-markup media
// (`image/png`, `application/json`, base64 blobs) never match, so legit inline
// data URLs are untouched. The `data` keyword, `:`/`/` separators, media type,
// and the `html`/`xml` core keep the t/2027 control-char fold; the optional
// subtype prefix (`svg+`, `xhtml+`) is not folded — a control char there is an
// exotic non-vector and folding a `*`-quantified run risks needless backtracking.
const CTRL_TYPE = `(?:[a-z]${CTRL})+`;                    // media type, control-tolerant
const DATA_SUBTYPE = `[a-z0-9.+-]*(?:${gap('html')}|${gap('xml')})`; // …ends html|xml
const DATA_MARKUP = new RegExp(
  `\\b${gap('data')}${CTRL}:${CTRL}${CTRL_TYPE}${CTRL}/${CTRL}${DATA_SUBTYPE}\\b`,
  'gi',
);

// t/2030 — HTML character-reference candidate: named (`&colon`), decimal (`&#106`),
// or hex (`&#x6a`). The trailing `;` is OPTIONAL: browsers/HTML decode many refs
// without it, so decodeEntitiesFixedPoint decodes a liberal SUPERSET — anything a
// current-or-future renderer might decode, we decode first. Over-decoding is free
// here because sanitizeUserText only rewrites when a threat surfaces (clean inputs
// are returned verbatim), so an over-eager decode never corrupts legit content.
const ENTITY = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);?/g;

/** Decode one matched character reference; returns the match VERBATIM if it is not
 *  a real entity, or if it decodes to `<`/`>` (see below). */
function decodeEntityRef(match: string, ref: string): string {
  let decoded: string;
  if (ref[0] === '#') {
    // Use the renderer's OWN numeric decoder (micromark, same family react-markdown
    // uses) rather than a hand-rolled table, for byte-for-byte parity: it maps
    // out-of-range / surrogate / C0+C1 control / noncharacter code points to U+FFFD
    // exactly as the renderer does, so our shadow never diverges from what renders
    // (TL's load-bearing decode-identically-to-the-renderer decision, e/52#2).
    decoded = ref[1] === 'x' || ref[1] === 'X'
      ? decodeNumericCharacterReference(ref.slice(2), 16)
      : decodeNumericCharacterReference(ref.slice(1), 10);
  } else {
    const named = decodeNamedCharacterReference(ref);
    if (named === false) return match; // not a real named entity — leave verbatim
    decoded = named;
  }
  // Leave `<`/`>`-producing refs ENCODED. Entity-decoded angle brackets are always
  // inert character DATA — no renderer turns `&lt;script&gt;` into a live tag (that
  // needs a LITERAL `<` in the source). Decoding them would only feed the tag
  // matcher false positives and corrupt legit escaped-markup prose, with zero
  // security gain; schemes never require `<`/`>`. (TL flag: t/2030 build refinement.)
  if (decoded === '<' || decoded === '>') return match;
  return decoded;
}

/**
 * Decode HTML character references to a fixed point (collapses layered encodings
 * like `&amp;colon;` → `&colon;` → `:`).
 *
 * Termination: every changing pass STRICTLY SHRINKS the string. Each entity span
 * `&…;?` is ≥3 chars and decodes to ≤2 UTF-16 units — verified across all 2125
 * named entities (worst source-vs-decoded margin is +2) and true for numeric refs
 * (`&#…` ≥3 chars → 1 code point). So the loop runs at most `length` passes and
 * the cap below is UNREACHABLE in practice. We nonetheless THROW past it (never a
 * bounded value-return, which would reintroduce js/incomplete-multi-character-
 * sanitization, t/2001#6): a hit means the shrink invariant was broken by a future
 * edit, and returning a partially-decoded string could hide a live scheme.
 */
function decodeEntitiesFixedPoint(s: string): string {
  let out = s;
  let prev: string;
  const cap = out.length + 1;
  let iter = 0;
  do {
    prev = out;
    out = out.replace(ENTITY, decodeEntityRef);
    if (++iter > cap) {
      throw new ActionableError({
        goal: 'Canonicalize HTML character references before XSS scheme/tag matching',
        problem: 'Entity decode did not converge within the shrink-invariant bound — a decode pass grew or oscillated the string.',
        location: 'contentSanitizer.ts decodeEntitiesFixedPoint',
        nextSteps: [
          'Confirm ENTITY only matches spans that decode to a strictly shorter string',
          'A newly added named entity decoding to ≥3 UTF-16 units would break the bound',
        ],
      });
    }
  } while (out !== prev);
  return out;
}

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
 * MAX_SANITIZE_INPUT truncation in sanitizeUserText (t/2029).
 */
function neutralize(s: string): string {
  let out = s;
  let prev: string;
  // TERMINATION INVARIANT (nothing else bounds these loops — they exit ONLY on
  // stability, `out === prev`): every replacement below MUST strictly shrink the
  // string OR replace with an irreversible sentinel that can never re-match its
  // own pattern. Tag removal deletes chars; `javascript:`/`vbscript:` → `blocked:`
  // and the data-markup family → `data:blocked` are sentinels that don't re-match.
  // A future rule that could GROW the string or oscillate would infinite-loop here.
  do { prev = out; out = out.replace(EXECUTABLE_TAGS, ''); } while (out !== prev);
  do { prev = out; out = out.replace(DANGEROUS_SCHEME, 'blocked:'); } while (out !== prev);
  do { prev = out; out = out.replace(DATA_MARKUP, 'data:blocked'); } while (out !== prev);
  return out;
}

/**
 * Sanitize a single string.
 *
 * t/2030 — decode-into-shadow, rewrite-only-on-threat. We match against an
 * entity-DECODED shadow (so `javascript&colon;` / `&#106;avascript:` are caught
 * the way a renderer would realize them), but rewrite conservatively:
 *   - decode a liberal superset of character references into `decoded`;
 *   - run the neutralizers on `decoded`;
 *   - if nothing matched (`cleaned === decoded`) the whole string is CLEAN → return
 *     it BYTE-FOR-BYTE, so a threat-free field's legit `&amp;`/`&lt;`/`&copy;`/code
 *     fences are never mangled;
 *   - only genuinely-dangerous inputs are returned in canonicalized form.
 * Granularity is whole-string, not per-match: a field that mixes a real threat with
 * benign entities returns the decoded form, so those co-located benign entities are
 * decoded too. That is directionally safe (over-decoding, never under) and round-trips
 * invisibly through the renderer (CommonMark re-escapes a bare `&` on serialization);
 * the `<`/`>` exclusion still protects escaped-markup structure even in that case.
 * This preserves the module's narrow, fail-safe charter without position-mapping
 * matches from the shadow back into the original. Design: t/2030#1, TL e/52#2.
 */
export function sanitizeUserText(s: string): string {
  let base = s;
  // t/2029 DoS backstop: truncate oversized input BEFORE the O(n²)-prone loops
  // (and before entity decode, so decode is length-bounded too).
  // Best-effort log (never the content — secrets rule) so oversized input isn't
  // invisible to ops; logging must never break sanitization, hence the try/catch.
  if (base.length > MAX_SANITIZE_INPUT) {
    try {
      log.security.warn(
        { originalLength: base.length, cap: MAX_SANITIZE_INPUT },
        'sanitizeUserText: input exceeded cap — truncated before sanitization',
      );
    } catch { /* telemetry — silent by design: this catch wraps the logger itself, so it cannot log; sanitization must proceed regardless */ }
    base = base.slice(0, MAX_SANITIZE_INPUT);
  }
  const decoded = decodeEntitiesFixedPoint(base);
  const cleaned = neutralize(decoded);
  return cleaned === decoded ? base : cleaned;
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
