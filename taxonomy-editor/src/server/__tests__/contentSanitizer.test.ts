// @vitest-environment node

/**
 * t/856 — conservative server-side content sanitization (XSS defense-in-depth).
 */

import { describe, it, expect } from 'vitest';
import { sanitizeUserText, sanitizeDeep } from '../security/contentSanitizer.js';

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
    // Non-adversarial input converges in one pass and never hits the fail-closed
    // bracket strip, so comparison operators survive.
    expect(sanitizeUserText('a < b > c, and 1<2')).toBe('a < b > c, and 1<2');
  });
});
