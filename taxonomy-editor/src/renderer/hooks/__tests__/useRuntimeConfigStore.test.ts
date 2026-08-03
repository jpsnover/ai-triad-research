// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { getNestedValue, setNestedValue } from '../useRuntimeConfigStore';

describe('getNestedValue', () => {
  it('reads a nested value by dot-path', () => {
    const obj = { a: { b: { c: 42 } } };
    expect(getNestedValue(obj, 'a.b.c')).toBe(42);
  });

  it('returns undefined for missing path', () => {
    expect(getNestedValue({ a: 1 }, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined for __proto__ path segment', () => {
    expect(getNestedValue({}, '__proto__')).toBeUndefined();
  });

  it('returns undefined for constructor path segment', () => {
    expect(getNestedValue({}, 'a.constructor.b')).toBeUndefined();
  });

  it('returns undefined for prototype path segment', () => {
    expect(getNestedValue({}, 'prototype.polluted')).toBeUndefined();
  });
});

describe('setNestedValue', () => {
  it('sets a nested value by dot-path', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'a.b.c', 99);
    expect((obj as { a: { b: { c: number } } }).a.b.c).toBe(99);
  });

  it('overwrites an existing nested value', () => {
    const obj: Record<string, unknown> = { x: { y: 1 } };
    setNestedValue(obj, 'x.y', 2);
    expect((obj as { x: { y: number } }).x.y).toBe(2);
  });

  it('does not pollute Object.prototype via __proto__', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, '__proto__.polluted', true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not pollute via constructor path segment', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'constructor.prototype.polluted', true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not pollute via prototype path segment', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'a.prototype.polluted', true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
