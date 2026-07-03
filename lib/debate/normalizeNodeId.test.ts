// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { normalizeNodeId } from './index.js';

describe('normalizeNodeId', () => {
  it('throws ActionableError for cc- IDs instead of mapping to sit- (collision hazard)', () => {
    expect(() => normalizeNodeId('cc-001')).toThrow('cc- and sit- are distinct node namespaces');
    expect(() => normalizeNodeId('cc-042')).toThrow();
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
