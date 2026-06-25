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
