// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { effectiveCamp } from './utils.js';

describe('effectiveCamp', () => {
  it('returns speaker when steelman_of is absent', () => {
    expect(effectiveCamp({ speaker: 'accelerationist' })).toBe('accelerationist');
  });

  it('returns steelman_of when present — steelman belongs to the steelmanned camp', () => {
    expect(effectiveCamp({ speaker: 'accelerationist', steelman_of: 'skeptic' })).toBe('skeptic');
  });

  it('returns speaker when steelman_of is undefined', () => {
    expect(effectiveCamp({ speaker: 'safetyist', steelman_of: undefined })).toBe('safetyist');
  });
});
