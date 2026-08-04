// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { stripSensitiveKeys } from '../communityReviewIO.js';

/**
 * t/2033 (sibling of t/2032): the desktop admin-promote path's `stripSensitiveKeys` recursed
 * array elements straight back through itself, so array-of-strings elements hit the scalar
 * early-return and were published to the public community blob VERBATIM — bypassing both the
 * secret-prefix screen and XSS sanitization. Fix mirrors the server (community.ts) exactly:
 * secret-prefix → redact to '' (array, preserve shape) / omit key (object); else the shared lib
 * `sanitizeText` neutralizes executable tags + dangerous schemes; non-strings recurse.
 *
 * `communityReviewIO` has no static electron import, so the real function is exercised directly
 * (not a replica — a replica is exactly how the array bypass shipped untested, t/2032).
 */
describe('stripSensitiveKeys — array-element screening (t/2033)', () => {
  it('REGRESSION: array-of-strings XSS payload is neutralized (was published verbatim)', () => {
    const out = stripSensitiveKeys({ tags: ['<script>alert(1)</script>', 'ok'] }) as { tags: string[] };
    expect(out.tags[0]).not.toContain('<script>');   // executable tag stripped
    expect(out.tags[0]).toBe('alert(1)');
    expect(out.tags[1]).toBe('ok');                    // clean string byte-for-byte
    expect(out.tags).toHaveLength(2);                  // array shape preserved
  });

  it('REGRESSION: array-of-strings secret-prefix value is redacted to \'\' (was leaked)', () => {
    const out = stripSensitiveKeys({ keys: ['sk-LEAKED', 'AIzaLEAKED', 'plain'] }) as { keys: string[] };
    expect(out.keys).toEqual(['', '', 'plain']);       // redact-to-'' FIRST, shape preserved
  });

  it('array dangerous scheme is neutralized', () => {
    const out = stripSensitiveKeys({ links: ['javascript:alert(1)'] }) as { links: string[] };
    expect(out.links[0]).not.toMatch(/javascript:/i);
    expect(out.links[0]).toBe('blocked:alert(1)');
  });

  it('array non-string elements recurse (objects screened, scalars pass through)', () => {
    const out = stripSensitiveKeys({
      items: [{ body: '<iframe src=x>', api_key: 'sk-drop' }, 42, null],
    }) as { items: [Record<string, unknown>, number, null] };
    expect(out.items[0]).not.toHaveProperty('api_key'); // SENSITIVE_KEYS omitted in nested object
    expect(out.items[0].body).not.toContain('<iframe'); // sanitized
    expect(out.items[1]).toBe(42);
    expect(out.items[2]).toBeNull();
  });
});

describe('stripSensitiveKeys — object-property parity + nesting (t/2033)', () => {
  it('object string property is XSS-sanitized (parity — was stored verbatim pre-fix)', () => {
    // The sanitizer is deliberately narrow: it removes executable TAG MARKUP, not text content,
    // so the `x` between the tags survives — `<script>x</script>hi` → `xhi`. The live <script>
    // markup (the actual XSS vector) is gone; that's the security property.
    const out = stripSensitiveKeys({ body: '<script>x</script>hi' }) as { body: string };
    expect(out.body).toBe('xhi');
    expect(out.body).not.toContain('<script');
  });

  it('object secret-prefix property omits the whole key (asymmetry vs array redact-to-\'\')', () => {
    const out = stripSensitiveKeys({ leak: 'sk-SECRET', keep: 'safe' }) as Record<string, unknown>;
    expect(out).not.toHaveProperty('leak');
    expect(out.keep).toBe('safe');
  });

  it('SENSITIVE_KEYS are dropped', () => {
    const out = stripSensitiveKeys({ token: 'x', password: 'y', title: 'ok' }) as Record<string, unknown>;
    expect(out).toEqual({ title: 'ok' });
  });

  it('deep nesting (object → array → object) is fully screened', () => {
    const out = stripSensitiveKeys({
      outer: { tags: ['<script>bad</script>', 'sk-leak'], meta: { secret: 'z', note: 'keep' } },
    }) as { outer: { tags: string[]; meta: Record<string, unknown> } };
    expect(out.outer.tags).toEqual(['bad', '']);        // XSS neutralized + secret redacted
    expect(out.outer.meta).not.toHaveProperty('secret'); // SENSITIVE_KEYS dropped at depth
    expect(out.outer.meta.note).toBe('keep');
  });

  it('clean scalars and strings pass through unchanged', () => {
    const out = stripSensitiveKeys({ n: 1, b: true, s: 'plain text & fine' }) as Record<string, unknown>;
    expect(out).toEqual({ n: 1, b: true, s: 'plain text & fine' });
  });
});
