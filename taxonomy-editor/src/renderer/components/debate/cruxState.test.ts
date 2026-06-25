// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { cruxDominantState } from './cruxState';

describe('cruxDominantState', () => {
  it('is "resolved" only when all instances are resolved', () => {
    expect(cruxDominantState({ active: 0, resolved: 3, irreducible: 0 })).toBe('resolved');
  });

  it('is "irreducible" when some are irreducible and none are active', () => {
    expect(cruxDominantState({ active: 0, resolved: 1, irreducible: 2 })).toBe('irreducible');
  });

  it('is "active" whenever any instance is still active', () => {
    expect(cruxDominantState({ active: 1, resolved: 5, irreducible: 0 })).toBe('active');
    expect(cruxDominantState({ active: 2, resolved: 0, irreducible: 3 })).toBe('active');
  });

  it('defaults to "active" for an all-zero summary', () => {
    expect(cruxDominantState({ active: 0, resolved: 0, irreducible: 0 })).toBe('active');
  });
});
