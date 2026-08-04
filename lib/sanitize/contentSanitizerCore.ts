// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * PURE, dependency-light content-sanitization core (t/2035, extracted from
 * server/security/contentSanitizer.ts).
 *
 * This is the shared XSS defense-in-depth primitive: it neutralizes executable
 * tag blocks (script/iframe/style/object/embed) and dangerous URL schemes
 * (javascript:/vbscript:/data:*markup), matching against an entity-DECODED shadow
 * so entity/numeric-char-ref obfuscation can't slip a live scheme past a literal
 * matcher (t/2030). Deliberately NARROW — it does not strip ordinary HTML-like
 * text, `<`/`>` comparison operators, or fenced code structure.
 *
 * WHY a separate lib/ core (t/2033#6, TL e/53#8): both the server community path
 * AND the Electron main-process admin-promote path (`src/main/communityReviewIO`)
 * publish to the SAME public community blob, so both need identical sanitization.
 * The server module couples to pino (`../logger.js`) + the t/2031 ALS budget,
 * neither of which is importable from `src/main` (tsconfig.main boundary). So the
 * pure logic lives here — NO pino, NO AsyncLocalStorage budget — and each consumer
 * wraps it: the server adds the ALS budget + pino; the desktop injects a
 * flight-recorder `onWarn`. The aggregate ALS budget is a SERVER-ONLY concern (it
 * defends a public HTTP surface against remote event-loop exhaustion); the desktop
 * promote path is local-admin, self-recoverable, so it needs only this pure core.
 *
 * Observability is decoupled via an injectable `onWarn` hook rather than a logger
 * import — that is precisely what makes this file importable from `src/main`.
 */

import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import { decodeNumericCharacterReference } from 'micromark-util-decode-numeric-character-reference';
import { ActionableError } from '../debate/errors.js';

// t/2029 — input-size cap (DoS backstop). The tag `[^>]*` tail scans O(n) per
// starting position, so pathological input (`<script` repeated with no closing
// `>`) costs O(n²) and can block the event loop (~1.6 s / 140 KB). Truncating the
// INPUT bounds the cost to a fixed worst case while leaving `[^>]*` unbounded — no
// per-tag length bound, hence no bypass. At CAP the worst case is the nested
// tag-reforming "onion" (~4681 `<style>`-reforming layers) that drives the
// fixed-point loop through ~O(layers²) passes: empirically ~120 ms (a single
// no-`>` scan is ~70 ms) — always ≪ the pre-fix multi-second blow-up. 32 KiB is
// 3.3× the largest existing caller field cap (feedback text ≤10 000 chars), so
// legitimate single-field content never reaches it. Truncate-then-sanitize is
// fail-safe: the sanitizer still runs on the kept prefix, so a tag split by the cut
// is inert text. (Slice is by UTF-16 code unit; a surrogate pair split at the
// boundary leaves a lone surrogate — still inert text, never a bypass.)
export const MAX_SANITIZE_INPUT = 32 * 1024;

/** Warning surfaced by the pure core so a host can log it without the core
 *  importing a logger. Only `oversize-input` (the per-string MAX_SANITIZE_INPUT
 *  truncation) originates here; the aggregate `budget-exhausted` warning is a
 *  server-ALS-wrapper concern and never reaches this core (t/2033#6, e/53#8). */
export interface SanitizeWarning {
  reason: 'oversize-input';
  originalLength: number;
  cap: number;
}
export type SanitizeWarn = (warning: SanitizeWarning) => void;

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
// here because sanitizeText only rewrites when a threat surfaces (clean inputs are
// returned verbatim), so an over-eager decode never corrupts legit content.
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
        location: 'contentSanitizerCore.ts decodeEntitiesFixedPoint',
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
 * MAX_SANITIZE_INPUT truncation in sanitizeText (t/2029).
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
 * Sanitize a single string (pure — no ALS budget, no logger import).
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
 *
 * @param onWarn optional observability hook — invoked with `oversize-input` when the
 *   input exceeds MAX_SANITIZE_INPUT and is truncated. The host logs it (server →
 *   pino; desktop → flight recorder); the core never imports a logger. A throwing
 *   hook can never break sanitization (the call is guarded).
 */
export function sanitizeText(s: string, onWarn?: SanitizeWarn): string {
  let base = s;
  // t/2029 DoS backstop: truncate oversized input BEFORE the O(n²)-prone loops
  // (and before entity decode, so decode is length-bounded too). Surface it via
  // onWarn (never the content — secrets rule); a throwing hook must not break us.
  if (base.length > MAX_SANITIZE_INPUT) {
    if (onWarn) {
      try {
        onWarn({ reason: 'oversize-input', originalLength: base.length, cap: MAX_SANITIZE_INPUT });
      } catch { /* telemetry — silent by design: an onWarn throw must never break sanitization */ }
    }
    base = base.slice(0, MAX_SANITIZE_INPUT);
  }
  const decoded = decodeEntitiesFixedPoint(base);
  const cleaned = neutralize(decoded);
  return cleaned === decoded ? base : cleaned;
}
