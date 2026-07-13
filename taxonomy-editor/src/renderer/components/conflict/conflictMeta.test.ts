// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { earliestInstanceDate, campColorVarForNodeId } from './conflictMeta';

describe('earliestInstanceDate', () => {
  it('returns the earliest parseable date, formatted', () => {
    const out = earliestInstanceDate([
      { date_flagged: '2026-03-31' },
      { date_flagged: '2026-01-15' },
      { date_flagged: '2026-05-02' },
    ]);
    // Locale-independent check on the earliest date's year/parts.
    expect(out).toContain('2026');
    expect(out).toBe(new Date(Date.parse('2026-01-15')).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
  });

  it('ignores empty / unparseable dates', () => {
    const out = earliestInstanceDate([{ date_flagged: '' }, { date_flagged: 'not-a-date' }, { date_flagged: '2026-06-01' }]);
    expect(out).toBe(new Date(Date.parse('2026-06-01')).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
  });

  it('returns null when there are no instances or no valid dates', () => {
    expect(earliestInstanceDate([])).toBeNull();
    expect(earliestInstanceDate([{ date_flagged: '' }, { date_flagged: 'x' }])).toBeNull();
  });
});

describe('campColorVarForNodeId', () => {
  it('maps each camp prefix to its color token', () => {
    expect(campColorVarForNodeId('acc-intentions-052')).toBe('var(--color-acc)');
    expect(campColorVarForNodeId('saf-belief-001')).toBe('var(--color-saf)');
    expect(campColorVarForNodeId('skp-desire-010')).toBe('var(--color-skp)');
  });

  it('falls back to the situation token for sit-/cc-/unknown', () => {
    expect(campColorVarForNodeId('sit-042')).toBe('var(--color-sit)');
    expect(campColorVarForNodeId('cc-099')).toBe('var(--color-sit)');
    expect(campColorVarForNodeId('weird')).toBe('var(--color-sit)');
  });
});
