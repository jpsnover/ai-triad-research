// @vitest-environment node

/**
 * t/856 — conservative server-side content sanitization (XSS defense-in-depth).
 */

import { describe, it, expect, vi } from 'vitest';
import { sanitizeUserText, sanitizeDeep, MAX_SANITIZE_INPUT } from '../security/contentSanitizer.js';
import { log } from '../logger.js';

describe('sanitizeUserText (t/856)', () => {
  it('strips executable tag blocks', () => {
    expect(sanitizeUserText('hi <script>alert(1)</script> there')).toBe('hi alert(1) there');
    expect(sanitizeUserText('<iframe src=evil></iframe>x')).toBe('x');
  });

  it('neutralizes dangerous URL schemes', () => {
    expect(sanitizeUserText('[click](javascript:alert(1))')).toBe('[click](blocked:alert(1))');
    expect(sanitizeUserText('vbscript:msgbox')).toBe('blocked:msgbox');
    expect(sanitizeUserText('data:text/html,<b>')).toBe('data:blocked,<b>');
  });

  it('leaves ordinary markdown and comparison operators intact (no regression)', () => {
    expect(sanitizeUserText('if (a < b && b > c) return;')).toBe('if (a < b && b > c) return;');
    expect(sanitizeUserText('# Heading\n- list\n`code`')).toBe('# Heading\n- list\n`code`');
    expect(sanitizeUserText('A normal [link](https://example.com).')).toBe('A normal [link](https://example.com).');
  });

  it('sanitizeDeep walks nested objects/arrays', () => {
    const input = { a: '<script>x</script>', b: ['javascript:y', { c: 'ok' }], n: 5 };
    expect(sanitizeDeep(input)).toEqual({ a: 'x', b: ['blocked:y', { c: 'ok' }], n: 5 });
  });
});

// t/2023 (CodeQL js/incomplete-multi-character-sanitization): a single pass is
// bypassable because removing one match can reform another. The fixed-point loop
// must neutralize the reformed matches too.
describe('sanitizeUserText — multi-pass bypass resistance (t/2023)', () => {
  it('neutralizes a nested tag that reforms after the inner one is stripped', () => {
    // pass 1 strips the inner <script>, leaving <script>; pass 2 strips that.
    const out = sanitizeUserText('<scr<script>ipt>alert(1)');
    expect(out).not.toContain('<script');
    expect(out).toBe('alert(1)');
  });

  it('neutralizes a scheme reformed by tag removal concatenating the halves', () => {
    // removing the tags joins `java` + `script:` → `javascript:`, which the same
    // pass then rewrites to blocked:.
    const out = sanitizeUserText('java<script></script>script:alert(1)');
    expect(out).not.toContain('javascript:');
    expect(out).toBe('blocked:alert(1)');
  });

  it('converges on multiply-nested tags (several passes, under the cap)', () => {
    const out = sanitizeUserText('<scr<scr<script>ipt>ipt>x');
    expect(out).not.toContain('<script');
    expect(out).toBe('x');
  });

  it('is idempotent — sanitizing twice equals sanitizing once', () => {
    const inputs = ['<scr<script>ipt>alert(1)', 'java<script></script>script:x', 'hi <script>a</script>'];
    for (const s of inputs) {
      const once = sanitizeUserText(s);
      expect(sanitizeUserText(once)).toBe(once);
    }
  });

  it('still leaves ordinary text with < / > operators untouched (no over-strip)', () => {
    // The tag regex requires a literal tag-name right after `<`/`</`, so bare
    // comparison operators never match and pass through unchanged.
    expect(sanitizeUserText('a < b > c, and 1<2')).toBe('a < b > c, and 1<2');
  });
});

// t/2027: control chars that a browser later elides (TAB/CR/LF/NUL, etc.) split a
// dangerous keyword past a contiguous-literal match. The folded CTRL class must
// neutralize these — WITHOUT treating a plain space (which browsers do NOT strip
// mid-scheme) as obfuscation.
describe('sanitizeUserText — control-char obfuscation hardening (t/2027)', () => {
  it('neutralizes control-char-split dangerous schemes', () => {
    expect(sanitizeUserText('java\tscript:alert(1)')).toBe('blocked:alert(1)');
    expect(sanitizeUserText('java\nscript:alert(1)')).toBe('blocked:alert(1)');
    expect(sanitizeUserText('java\r\nscript:alert(1)')).toBe('blocked:alert(1)');
    expect(sanitizeUserText('javascript\0:alert(1)')).toBe('blocked:alert(1)');
    expect(sanitizeUserText('vb\tscript:msgbox')).toBe('blocked:msgbox');
    // control char immediately before the colon
    expect(sanitizeUserText('[x](javascript\t:alert(1))')).toBe('[x](blocked:alert(1))');
  });

  it('neutralizes control-char-split executable tags', () => {
    expect(sanitizeUserText('a <scr\0ipt>alert(1)</scr\0ipt> b')).toBe('a alert(1) b');
    expect(sanitizeUserText('<if\trame src=evil></if\trame>x')).toBe('x');
  });

  it('neutralizes obfuscated data:text/html', () => {
    expect(sanitizeUserText('data\0:text/html,<b>')).toBe('data:blocked,<b>');
    expect(sanitizeUserText('data:te\txt/html,x')).toBe('data:blocked,x');
  });

  it('does NOT treat a plain space as obfuscation (no false positives)', () => {
    // U+0020 is not stripped mid-scheme by browsers, so "java script" prose that
    // can never become a live javascript: URI must survive untouched.
    expect(sanitizeUserText('the java script tutorial')).toBe('the java script tutorial');
    expect(sanitizeUserText('read the vb script docs')).toBe('read the vb script docs');
  });
});

// t/2029: the tag `[^>]*` tail makes pathological `<script`-repeat input (no
// closing `>`) O(n²). A MAX_SANITIZE_INPUT truncation before the loops bounds the
// cost while keeping `[^>]*` unbounded (no per-tag bound → no bypass).
const CAP = MAX_SANITIZE_INPUT; // single source of truth

describe('sanitizeUserText — input-size DoS backstop (t/2029)', () => {
  it('bounds the pathological no-`>` payload instead of O(n²) blow-up', () => {
    const payload = '<script'.repeat(50000); // ~350 KB, no `>` anywhere
    const started = performance.now();
    const out = sanitizeUserText(payload);
    const elapsedMs = performance.now() - started;
    // Pre-fix this is 10 s+; the generous 2 s bound cleanly proves the quadratic
    // blow-up is gone without CI-timing flake.
    expect(elapsedMs).toBeLessThan(2000);
    // Input is truncated to the cap before sanitizing (nothing to strip, so the
    // kept prefix passes through unchanged).
    expect(out.length).toBeLessThanOrEqual(CAP);
    expect(out.length).toBeLessThan(payload.length);
  });

  it('cost is independent of input size (cap, not merely faster)', () => {
    // A ~5 MB payload — ~15× the 350 KB case — must NOT be ~15× slower. Because
    // truncation is O(CAP) regardless of n, both cases pay only the CAP-bounded
    // scan; pre-fix a 5 MB pathological input would run for hours.
    const huge = '<script'.repeat(750000); // ~5.25 MB, no `>`
    const started = performance.now();
    sanitizeUserText(huge);
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(500); // size-independent → still ~CAP² (~80 ms)
  });

  it('a dangerous tag straddling the cap boundary is inert, not smuggled', () => {
    // The closing `>` lands BEYOND the cap, so the kept prefix ends in an
    // unterminated `<script src=x` fragment with no `>` — EXECUTABLE_TAGS requires
    // a literal `>` to match, and an unclosed start-tag at EOF is inert per the
    // HTML5 tokenizer. No `>` survives in the kept prefix, so nothing renders.
    const out = sanitizeUserText('A'.repeat(CAP - 4) + '<script src=x>alert(1)</script>');
    expect(out).not.toContain('>');
    expect(out.length).toBeLessThanOrEqual(CAP);
  });

  it('still strips a dangerous construct that sits within the first CAP chars', () => {
    // Script tag at the very start (well within CAP), followed by CAP+ of padding.
    const out = sanitizeUserText('<script>alert(1)</script>' + 'A'.repeat(CAP + 5000));
    expect(out).not.toContain('<script');
    expect(out.startsWith('alert(1)')).toBe(true);
  });

  it('logs a best-effort warning (no raw content) when truncating', () => {
    const spy = vi.spyOn(log.security, 'warn').mockImplementation((() => undefined) as never);
    try {
      sanitizeUserText('x'.repeat(CAP + 1));
      expect(spy).toHaveBeenCalledTimes(1);
      const [meta] = spy.mock.calls[0] as [Record<string, unknown>, string];
      expect(meta).toMatchObject({ originalLength: CAP + 1, cap: CAP });
      // The raw content must never be logged (secrets rule).
      expect(JSON.stringify(spy.mock.calls[0])).not.toContain('xxxxx');
    } finally {
      spy.mockRestore();
    }
  });

  it('leaves at-or-under-CAP input completely untouched (no regression)', () => {
    const spy = vi.spyOn(log.security, 'warn').mockImplementation((() => undefined) as never);
    try {
      expect(sanitizeUserText('a normal comment')).toBe('a normal comment');
      expect(sanitizeUserText('X'.repeat(CAP))).toBe('X'.repeat(CAP));
      expect(spy).not.toHaveBeenCalled(); // exactly CAP does not trip the guard
    } finally {
      spy.mockRestore();
    }
  });

  it('bounds the WORST within-CAP shape — a nested tag-reforming "onion"', () => {
    // The no-`>` payload above exits the fixed-point loop after ONE pass. The
    // empirically-worst within-CAP input is instead a matryoshka of the shortest
    // tag name (`style`): `<st`×N + `yle>`×N reforms `<style>` at the junction and
    // drives the do-while through ~N passes (O(N²) total work), not a single scan.
    // At CAP (N≈4681) this is ~120 ms — the true worst case, still ≪ 2 s and the
    // pre-fix multi-second blow-up. Pins the real bound, not just the single-scan one.
    const N = Math.floor((CAP - 1) / 7); // 3 (`<st`) + 4 (`yle>`) chars per layer
    const onion = '<st'.repeat(N) + 'yle>'.repeat(N);
    expect(onion.length).toBeLessThanOrEqual(CAP);
    const started = performance.now();
    const out = sanitizeUserText(onion);
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(2000);   // bounded — no quadratic-in-input blow-up
    expect(out).not.toContain('<style');    // fully neutralized, nothing renders
  });
});

// t/2030: the matchers operate on literal chars, but CommonMark (react-markdown)
// decodes HTML entities / numeric char refs in link destinations BEFORE the scheme
// is honored — so `javascript&colon;` and `&#106;avascript:` slip past a literal
// matcher yet render a live scheme. We match against an entity-DECODED shadow and
// rewrite only when it reveals a threat, so clean content is returned byte-for-byte.
// Design t/2030#1, TL sign-off e/52#2.
describe('sanitizeUserText — entity/numeric-ref canonicalization (t/2030)', () => {
  it('neutralizes a named-entity-encoded scheme separator (Finding A)', () => {
    expect(sanitizeUserText('[x](javascript&colon;alert(1))')).toBe('[x](blocked:alert(1))');
    expect(sanitizeUserText('vbscript&colon;msgbox')).toBe('blocked:msgbox'); // colon reconstituted then blocked
  });

  it('neutralizes numeric-char-ref-encoded keyword letters (decimal + hex)', () => {
    expect(sanitizeUserText('&#106;avascript:alert(1)')).toBe('blocked:alert(1)'); // &#106; = j
    expect(sanitizeUserText('&#x6a;avascript:alert(1)')).toBe('blocked:alert(1)'); // hex lower x
    expect(sanitizeUserText('&#X6A;avascript:alert(1)')).toBe('blocked:alert(1)'); // hex upper X
    expect(sanitizeUserText('&#0000106;avascript:x')).toBe('blocked:x');           // leading zeros
  });

  it('decodes semicolon-less DECIMAL refs; hex greedily consumes hex digits (browser parity)', () => {
    // Decimal `&#106` stops at the non-digit 'a', so `&#106avascript:` → j+avascript
    // → javascript: → blocked (a real semicolon-less vector).
    expect(sanitizeUserText('&#106avascript:x')).toBe('blocked:x');
    // Hex is different: 'a' IS a hex digit, so a browser (and we) consume `&#x6aa…`
    // as ONE ref — `&#x6aavascript` never reconstitutes `javascript:`. That non-match
    // is correct browser-parity behavior, so the hex vector needs its `;` delimiter:
    expect(sanitizeUserText('&#x6a;avascript:x')).toBe('blocked:x');
  });

  it('collapses LAYERED / double-encoded entities to a fixed point', () => {
    expect(sanitizeUserText('[x](javascript&amp;colon;alert(1))')).toBe('[x](blocked:alert(1))'); // &amp;colon; → &colon; → :
    expect(sanitizeUserText('javascript&amp;#58;x')).toBe('blocked:x');                            // &amp;#58; → &#58; → :
    expect(sanitizeUserText('javascript&amp;amp;colon;x')).toBe('blocked:x');                      // triple layer
  });

  it('neutralizes a vbscript scheme with an entity-encoded letter', () => {
    expect(sanitizeUserText('vb&#115;cript:msgbox')).toBe('blocked:msgbox'); // &#115; = s
  });

  it('broadens data: coverage to the executable-markup media-type family (Finding B, TL option b)', () => {
    expect(sanitizeUserText('[x](data:image/svg+xml;base64,PHN2Zz4=)')).toBe('[x](data:blocked;base64,PHN2Zz4=)');
    expect(sanitizeUserText('data:application/xhtml+xml,<html/>')).toBe('data:blocked,<html/>');
    expect(sanitizeUserText('data:application/xml,<x/>')).toBe('data:blocked,<x/>');
    expect(sanitizeUserText('data:text/xml,<x/>')).toBe('data:blocked,<x/>');
  });

  it('leaves legit (non-markup) data: media types untouched', () => {
    expect(sanitizeUserText('![img](data:image/png;base64,iVBORw0KG)')).toBe('![img](data:image/png;base64,iVBORw0KG)');
    expect(sanitizeUserText('data:application/json,{}')).toBe('data:application/json,{}');
  });

  it('NO regression: legit HTML entities in prose/code are returned BYTE-FOR-BYTE', () => {
    // Rewrite-only-on-threat: a clean input (no scheme/tag in its decoded shadow) is
    // returned verbatim — legit entities are NEVER decoded/mangled in storage.
    for (const s of [
      'Tom &amp; Jerry',            // ampersand entity
      'compare a &lt; b &gt; c',    // angle-bracket entities (also stay ENCODED)
      '&copy; 2026 BKC',            // copyright
      'use `&lt;script&gt;` carefully in docs', // escaped-markup documentation must survive
      'ticket &#35;106 filed',      // numeric ref for '#'
      'Jack &amp Jill',             // semicolon-less legit entity — still verbatim
      'the &nbsp; spacer',
    ]) {
      expect(sanitizeUserText(s)).toBe(s);
    }
  });

  it('does NOT strip entity-encoded angle brackets as tags (correctness refinement)', () => {
    // `&lt;script&gt;` is inert character data in every renderer (a live tag needs a
    // LITERAL `<`), so decoding+stripping it would corrupt legit content for zero
    // security gain. It must pass through unchanged.
    expect(sanitizeUserText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(sanitizeUserText('&#60;script&#62;x')).toBe('&#60;script&#62;x'); // numeric `<`/`>` likewise
  });

  it('is idempotent on entity-obfuscated inputs', () => {
    for (const s of ['[x](javascript&colon;alert(1))', '&#106;avascript:x', 'data:image/svg+xml,<svg/>']) {
      const once = sanitizeUserText(s);
      expect(sanitizeUserText(once)).toBe(once);
    }
  });

  it('handles entity + control-char obfuscation combined', () => {
    // Entity-encoded letter AND a control-char split in the same scheme.
    expect(sanitizeUserText('&#106;ava\tscript:x')).toBe('blocked:x');
  });

  it('sanitizeDeep applies entity canonicalization through nested structures', () => {
    const input = { a: '[x](javascript&colon;go)', b: ['data:image/svg+xml,z', { c: 'Tom &amp; Jerry' }] };
    expect(sanitizeDeep(input)).toEqual({
      a: '[x](blocked:go)',
      b: ['data:blocked,z', { c: 'Tom &amp; Jerry' }], // clean nested string stays verbatim
    });
  });

  it('whole-string granularity: a field mixing a threat with benign entities is canonicalized', () => {
    // When the SAME field carries a real threat, the returned form is the decoded
    // shadow, so co-located benign entities decode too (`&amp;` → `&`). Directionally
    // safe (over-decode) and round-trips through the renderer; documented behavior.
    expect(sanitizeUserText('Tom &amp; Jerry — also javascript&colon;alert(1)'))
      .toBe('Tom & Jerry — also blocked:alert(1)');
  });

  it('numeric decode matches the renderer: C1/control code points → U+FFFD, not a scheme', () => {
    // &#133; (NEL, U+0085) is a C1 control; the renderer's own numeric decoder maps it
    // to U+FFFD, so the decoded shadow is `java␦script:` — U+FFFD is not in the CTRL
    // fold class, so no `javascript:` reconstitutes. The input is therefore treated as
    // clean and returned VERBATIM (decode parity with react-markdown, nothing to
    // exploit — and no over-strip of the benign input).
    expect(sanitizeUserText('java&#133;script:alert(1)')).toBe('java&#133;script:alert(1)');
  });

  it('DATA_MARKUP has no catastrophic backtracking on a long non-matching subtype', () => {
    // Guards the `(?:[a-z]CTRL)+` / `[a-z0-9.+-]*(html|xml)` shape against ReDoS,
    // mirroring the t/2029 EXECUTABLE_TAGS "onion" perf pin.
    const started = performance.now();
    sanitizeUserText('data:' + 'a'.repeat(20000)); // type run with no closing `/subtype`
    expect(performance.now() - started).toBeLessThan(500);
  });
});
