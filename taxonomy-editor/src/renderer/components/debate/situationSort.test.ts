// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { sortSituationNodes } from './situationSort';
import type { SituationNode } from '../../types/taxonomy';

const nodes = [
  { id: 'sit-3', label: 'Cherry', interpretation_divergence: 0.2 },
  { id: 'sit-1', label: 'Apple' },
  { id: 'sit-2', label: 'Banana', interpretation_divergence: 0.8 },
] as unknown as SituationNode[];

describe('sortSituationNodes', () => {
  it('sorts by id', () => {
    expect(sortSituationNodes(nodes, 'id').map(n => n.id)).toEqual(['sit-1', 'sit-2', 'sit-3']);
  });

  it('sorts by label', () => {
    expect(sortSituationNodes(nodes, 'label').map(n => n.label)).toEqual(['Apple', 'Banana', 'Cherry']);
  });

  it('sorts by divergence (highest first), unscored nodes last', () => {
    expect(sortSituationNodes(nodes, 'divergence').map(n => n.id)).toEqual(['sit-2', 'sit-3', 'sit-1']);
  });

  it('does not mutate the input array', () => {
    const before = nodes.map(n => n.id);
    sortSituationNodes(nodes, 'id');
    expect(nodes.map(n => n.id)).toEqual(before);
  });

  // t/2998 regression: string interpretation_divergence must not crash the sort comparator
  it('handles string interpretation_divergence without throwing (t/2998 sort-path)', () => {
    const mixed = [
      { id: 'a', label: 'A', interpretation_divergence: '0.5' as unknown as number },
      { id: 'b', label: 'B', interpretation_divergence: 0.8 },
      { id: 'c', label: 'C' },
    ] as unknown as SituationNode[];
    expect(() => sortSituationNodes(mixed, 'divergence')).not.toThrow();
    const sorted = sortSituationNodes(mixed, 'divergence');
    expect(sorted).toHaveLength(3);
    expect(sorted[0].id).toBe('b');
  });
});
