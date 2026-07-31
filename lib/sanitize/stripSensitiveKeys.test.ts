// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

import { describe, it, expect, vi } from 'vitest';
import { stripSensitiveKeys, SENSITIVE_KEYS, SECRET_PREFIX_RE } from './stripSensitiveKeys.js';

// Marker sanitizer: proves the injected fn ran on a given string (and only surviving ones).
const tag = (s: string): string => `S(${s})`;

describe('stripSensitiveKeys', () => {
  it('drops SENSITIVE_KEYS entries wholesale (and sanitizes survivors)', () => {
    const out = stripSensitiveKeys(
      { keep: 'x', api_key: 'anything', token: 't', _internal: { a: 1 } },
      tag,
    );
    expect(out).toEqual({ keep: 'S(x)' });
  });

  it('object branch: skips secret-prefixed string VALUES entirely (never kept, never sanitized)', () => {
    const out = stripSensitiveKeys({ a: 'sk-live-xyz', b: 'AIzaFoo', c: 'normal' }, tag);
    expect(out).toEqual({ c: 'S(normal)' }); // a + b dropped by SECRET_PREFIX_RE
  });

  it('array branch: redacts secret-prefixed elements to "" and sanitizes the rest in place', () => {
    const out = stripSensitiveKeys(['sk-abc', 'hello', 'Bearer tok'], tag);
    expect(out).toEqual(['', 'S(hello)', '']); // shape preserved; secrets blanked, not dropped
  });

  it('array branch: non-string elements recurse with the sanitize fn threaded', () => {
    const out = stripSensitiveKeys([{ x: 'y', secret: 's' }], tag);
    expect(out).toEqual([{ x: 'S(y)' }]);
  });

  it('recurses into nested objects, threading the sanitize fn', () => {
    const out = stripSensitiveKeys({ outer: { inner: 'v', password: 'p' } }, tag);
    expect(out).toEqual({ outer: { inner: 'S(v)' } });
  });

  it('passes scalars / null through untouched (no sanitize call)', () => {
    const sanitize = vi.fn((s: string) => s);
    expect(stripSensitiveKeys(42, sanitize)).toBe(42);
    expect(stripSensitiveKeys(null, sanitize)).toBeNull();
    expect(sanitize).not.toHaveBeenCalled();
  });

  it('invokes the injected sanitize fn for each surviving string (object + array)', () => {
    const sanitize = vi.fn((s: string) => s.toUpperCase());
    stripSensitiveKeys({ a: 'x', arr: ['y'] }, sanitize);
    expect(sanitize).toHaveBeenCalledWith('x');
    expect(sanitize).toHaveBeenCalledWith('y');
  });

  it('exposes the frozen parity-anchor constants', () => {
    expect(SENSITIVE_KEYS.has('api_key')).toBe(true);
    expect(SENSITIVE_KEYS.has('diagnostics_state')).toBe(true);
    expect(SENSITIVE_KEYS.size).toBe(19); // drift guard — a dropped/added key trips this
    expect(SECRET_PREFIX_RE.test('sk-abc')).toBe(true);
    expect(SECRET_PREFIX_RE.test('AIzaXYZ')).toBe(true);
    expect(SECRET_PREFIX_RE.test('Bearer tok')).toBe(true);
    expect(SECRET_PREFIX_RE.test('normal-text')).toBe(false);
  });
});
