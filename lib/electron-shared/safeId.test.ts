// @vitest-environment node

import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { SAFE_ID_RE, isSafeId, assertSafeId, assertContainedIn } from './safeId.js';

describe('SAFE_ID_RE', () => {
  it('matches valid identifiers', () => {
    expect(SAFE_ID_RE.test('abc')).toBe(true);
    expect(SAFE_ID_RE.test('abc-123')).toBe(true);
    expect(SAFE_ID_RE.test('_under')).toBe(true);
    expect(SAFE_ID_RE.test('A1B2-c3_d4')).toBe(true);
    expect(SAFE_ID_RE.test('debate-abc123')).toBe(true);
  });

  it('rejects traversal and unsafe characters', () => {
    expect(SAFE_ID_RE.test('')).toBe(false);
    expect(SAFE_ID_RE.test('../evil')).toBe(false);
    expect(SAFE_ID_RE.test('/etc/passwd')).toBe(false);
    expect(SAFE_ID_RE.test('a/b')).toBe(false);
    expect(SAFE_ID_RE.test('a\\b')).toBe(false);
    expect(SAFE_ID_RE.test('a.b')).toBe(false);
    expect(SAFE_ID_RE.test('a b')).toBe(false);
    expect(SAFE_ID_RE.test('a\x00b')).toBe(false);
  });
});

describe('isSafeId', () => {
  it('returns true for valid ids', () => {
    expect(isSafeId('abc123')).toBe(true);
    expect(isSafeId('my-id_here')).toBe(true);
  });

  it('returns false for invalid ids', () => {
    expect(isSafeId('')).toBe(false);
    expect(isSafeId('../evil')).toBe(false);
    expect(isSafeId('/absolute')).toBe(false);
    expect(isSafeId('has.dot')).toBe(false);
    expect(isSafeId('has space')).toBe(false);
  });
});

describe('assertSafeId', () => {
  it('returns the value when valid', () => {
    expect(assertSafeId('debate-abc')).toBe('debate-abc');
    expect(assertSafeId('node_123', 'node id')).toBe('node_123');
  });

  it('throws ActionableError with statusCode 400 on traversal', () => {
    expect(() => assertSafeId('../evil')).toThrow(/invalid id/i);
    expect(() => assertSafeId('../evil')).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('throws with custom label', () => {
    expect(() => assertSafeId('bad/path', 'debate id')).toThrow(/invalid debate id/i);
  });

  it('throws on empty string', () => {
    expect(() => assertSafeId('')).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('throws on absolute paths', () => {
    expect(() => assertSafeId('/etc/passwd')).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('assertContainedIn', () => {
  const base = path.resolve('/base/dir');

  it('accepts a path strictly inside the base', () => {
    expect(() => assertContainedIn(path.resolve('/base/dir/file.json'), base)).not.toThrow();
    expect(() => assertContainedIn(path.resolve('/base/dir/sub/file.json'), base)).not.toThrow();
  });

  it('rejects path equal to base (not strictly inside)', () => {
    expect(() => assertContainedIn(base, base)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects path that resolves outside via traversal', () => {
    expect(() => assertContainedIn(path.resolve('/base/dir/../other/file.json'), base)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects path in a completely different directory', () => {
    expect(() => assertContainedIn(path.resolve('/other/path/file.json'), base)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects sibling directory sharing a prefix (startsWith false-pass guard)', () => {
    // /base/dirx/file.json should NOT be accepted for base /base/dir
    expect(() => assertContainedIn(path.resolve('/base/dirx/file.json'), base)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('handles Windows-style mixed separators via path.resolve normalisation', () => {
    // path.resolve normalises separators, so this should work correctly cross-platform
    const winBase = path.resolve('C:/Users/data/debates');
    const inside = path.resolve('C:/Users/data/debates/debate-abc.json');
    const outside = path.resolve('C:/Users/data/debatesx/file.json');
    expect(() => assertContainedIn(inside, winBase)).not.toThrow();
    expect(() => assertContainedIn(outside, winBase)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});
