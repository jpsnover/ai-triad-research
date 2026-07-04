// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeAll } from 'vitest';
import { normalizeNodeId } from './index.js';
import { setCcToSitMapping } from './ccSitMapping.js';

beforeAll(() => {
  setCcToSitMapping({
    'cc-001': 'sit-201',
    'cc-042': 'sit-242',
  });
});

describe('normalizeNodeId', () => {
  it('resolves cc- IDs via mapping to sit- equivalents', () => {
    expect(normalizeNodeId('cc-001')).toBe('sit-201');
    expect(normalizeNodeId('cc-042')).toBe('sit-242');
  });

  it('throws ActionableError for unmapped cc- IDs', () => {
    expect(() => normalizeNodeId('cc-999')).toThrow('No mapping found');
  });

  it('normalizes legacy BDI category slugs', () => {
    expect(normalizeNodeId('acc-goals-001')).toBe('acc-desires-001');
    expect(normalizeNodeId('saf-data-002')).toBe('saf-beliefs-002');
    expect(normalizeNodeId('skp-methods-003')).toBe('skp-intentions-003');
  });

  it('returns current-format IDs unchanged', () => {
    expect(normalizeNodeId('acc-beliefs-001')).toBe('acc-beliefs-001');
    expect(normalizeNodeId('sit-001')).toBe('sit-001');
    expect(normalizeNodeId('pol-001')).toBe('pol-001');
  });
});
