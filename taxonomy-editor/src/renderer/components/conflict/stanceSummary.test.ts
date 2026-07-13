// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import type { ConflictStance } from '../../types/taxonomy';
import { summarizeStances } from './stanceSummary';

const insts = (...stances: ConflictStance[]) => stances.map((stance) => ({ stance }));

describe('summarizeStances', () => {
  it('all-supports → Corroborated (the Andreessen-manifesto case: 2× supports)', () => {
    const s = summarizeStances(insts('supports', 'supports'));
    expect(s.kind).toBe('corroborated');
    expect(s.label).toBe('Corroborated');
    expect(s.detail).toBe('2/2 support');
  });

  it('mixed supports + disputes → Contested', () => {
    const s = summarizeStances(insts('supports', 'disputes', 'supports'));
    expect(s.kind).toBe('contested');
    expect(s.label).toBe('Contested');
    expect(s.detail).toBe('2 support · 1 dispute');
  });

  it('disputes only (0 supports) → Disputed, distinct from Contested', () => {
    const s = summarizeStances(insts('disputes', 'disputes'));
    expect(s.kind).toBe('disputed');
    expect(s.label).toBe('Disputed');
    expect(s.detail).toBe('2/2 dispute');
  });

  it('neutral/qualifies only → Unresolved', () => {
    const s = summarizeStances(insts('neutral', 'qualifies'));
    expect(s.kind).toBe('unresolved');
    expect(s.detail).toBe('2 neutral/qualifying');
  });

  it('zero instances → Unresolved / no instances yet', () => {
    const s = summarizeStances([]);
    expect(s.kind).toBe('unresolved');
    expect(s.detail).toBe('no instances yet');
    expect(s.total).toBe(0);
  });

  it('one support alongside neutral/qualifies still Corroborated (no disputes)', () => {
    const s = summarizeStances(insts('supports', 'neutral', 'qualifies'));
    expect(s.kind).toBe('corroborated');
    expect(s.detail).toBe('1/3 support');
  });

  it('reports per-stance counts and total', () => {
    const s = summarizeStances(insts('supports', 'disputes', 'neutral', 'qualifies'));
    expect(s).toMatchObject({ supports: 1, disputes: 1, neutral: 1, qualifies: 1, total: 4 });
  });
});
