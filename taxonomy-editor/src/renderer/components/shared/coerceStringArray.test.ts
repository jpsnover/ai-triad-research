// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { coerceStringArray } from './coerceStringArray';

describe('coerceStringArray (polymorphic aliases/source_refs, t/1882#7 / t/1884#4)', () => {
  it('returns an array unchanged', () => {
    expect(coerceStringArray(['a', 'b'])).toEqual(['a', 'b']);
  });
  it('null / undefined → []', () => {
    expect(coerceStringArray(null)).toEqual([]);
    expect(coerceStringArray(undefined)).toEqual([]);
  });
  it('an empty array → []', () => {
    expect(coerceStringArray([])).toEqual([]);
  });
  it('a bare string → single-element array (NOT split into characters)', () => {
    expect(coerceStringArray('GDPR')).toEqual(['GDPR']);
    expect(coerceStringArray('GDPR')[0]).toBe('GDPR'); // not "G"
  });
});
