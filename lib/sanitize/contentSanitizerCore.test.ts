// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

/**
 * t/2035 — pure sanitizer core unit tests. These pin the CORE contract (decode +
 * neutralize + per-string cap + injectable onWarn), independent of the server ALS
 * budget / pino wrapper. The full behavior-preservation regression for the hardened
 * server surface (t/2027/2029/2030/2031) lives in
 * taxonomy-editor/src/server/__tests__/contentSanitizer.test.ts and must stay green.
 */

import { describe, it, expect, vi } from 'vitest';
import { sanitizeText, MAX_SANITIZE_INPUT } from './contentSanitizerCore.js';
import type { SanitizeWarning } from './contentSanitizerCore.js';

describe('sanitizeText — core neutralization (t/856/t/2027)', () => {
  it('strips executable tag blocks', () => {
    expect(sanitizeText('hi <script>alert(1)</script> there')).toBe('hi alert(1) there');
    expect(sanitizeText('<iframe src=evil></iframe>x')).toBe('x');
  });

  it('neutralizes dangerous URL schemes', () => {
    expect(sanitizeText('[click](javascript:alert(1))')).toBe('[click](blocked:alert(1))');
    expect(sanitizeText('vbscript:msgbox')).toBe('blocked:msgbox');
  });

  it('neutralizes control-char-split schemes/tags (t/2027)', () => {
    expect(sanitizeText('java\tscript:alert(1)')).toBe('blocked:alert(1)');
    expect(sanitizeText('a <scr\0ipt>x</scr\0ipt> b')).toBe('a x b');
  });

  it('leaves ordinary markdown / comparison operators intact', () => {
    expect(sanitizeText('if (a < b && b > c) return;')).toBe('if (a < b && b > c) return;');
    expect(sanitizeText('A normal [link](https://example.com).')).toBe('A normal [link](https://example.com).');
  });

  it('multi-pass: neutralizes a scheme reformed by tag removal (t/2023)', () => {
    expect(sanitizeText('java<script></script>script:alert(1)')).toBe('blocked:alert(1)');
    expect(sanitizeText('<scr<script>ipt>alert(1)')).toBe('alert(1)');
  });
});

describe('sanitizeText — entity/numeric-ref canonicalization (t/2030)', () => {
  it('neutralizes entity/numeric-encoded schemes', () => {
    expect(sanitizeText('[x](javascript&colon;alert(1))')).toBe('[x](blocked:alert(1))');
    expect(sanitizeText('&#106;avascript:alert(1)')).toBe('blocked:alert(1)');   // &#106; = j
    expect(sanitizeText('&#x6a;avascript:alert(1)')).toBe('blocked:alert(1)');
    expect(sanitizeText('[x](javascript&amp;colon;alert(1))')).toBe('[x](blocked:alert(1))'); // layered
  });

  it('broadens data: to the executable-markup media-type family (Finding B)', () => {
    expect(sanitizeText('[x](data:image/svg+xml;base64,PHN2Zz4=)')).toBe('[x](data:blocked;base64,PHN2Zz4=)');
    expect(sanitizeText('data:application/xhtml+xml,<html/>')).toBe('data:blocked,<html/>');
    expect(sanitizeText('![img](data:image/png;base64,iVBORw0KG)')).toBe('![img](data:image/png;base64,iVBORw0KG)'); // legit untouched
  });

  it('returns clean input BYTE-FOR-BYTE (legit entities never mangled)', () => {
    for (const s of ['Tom &amp; Jerry', 'compare a &lt; b &gt; c', '&copy; 2026', 'use `&lt;script&gt;` in docs']) {
      expect(sanitizeText(s)).toBe(s);
    }
  });

  it('does NOT decode/strip entity-encoded angle brackets (inert character data)', () => {
    expect(sanitizeText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(sanitizeText('&#60;script&#62;x')).toBe('&#60;script&#62;x');
  });
});

describe('sanitizeText — per-string cap + injectable onWarn (t/2029/t/2035)', () => {
  it('truncates oversized input and fires onWarn with oversize-input (no content)', () => {
    const seen: SanitizeWarning[] = [];
    const out = sanitizeText('x'.repeat(MAX_SANITIZE_INPUT + 10), (w) => seen.push(w));
    expect(out.length).toBeLessThanOrEqual(MAX_SANITIZE_INPUT);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ reason: 'oversize-input', originalLength: MAX_SANITIZE_INPUT + 10, cap: MAX_SANITIZE_INPUT });
    // secrets rule: the warning carries only lengths, never the content.
    expect(JSON.stringify(seen[0])).not.toContain('xxxxx');
  });

  it('does NOT fire onWarn for at-or-under-cap input', () => {
    const warn = vi.fn();
    sanitizeText('X'.repeat(MAX_SANITIZE_INPUT), warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is pure: works with NO onWarn hook (no logger dependency)', () => {
    // tag blocks are removed; content BETWEEN them is kept (narrow charter), so
    // `<script>x</script>hi` → `xhi`. The point here is no-hook → no throw.
    expect(sanitizeText('<script>x</script>hi')).toBe('xhi');
    expect(sanitizeText('y'.repeat(MAX_SANITIZE_INPUT + 5)).length).toBeLessThanOrEqual(MAX_SANITIZE_INPUT);
  });

  it('a throwing onWarn never breaks sanitization', () => {
    const boom = () => { throw new Error('logger down'); };
    expect(sanitizeText('<script>x</script>ok'.padEnd(MAX_SANITIZE_INPUT + 50, 'z'), boom).length)
      .toBeLessThanOrEqual(MAX_SANITIZE_INPUT);
  });

  it('bounds the pathological no-`>` payload (t/2029 DoS backstop travels with the core)', () => {
    const started = performance.now();
    const out = sanitizeText('<script'.repeat(50000)); // ~350 KB, no `>`
    expect(performance.now() - started).toBeLessThan(2000);
    expect(out.length).toBeLessThanOrEqual(MAX_SANITIZE_INPUT);
  });
});
