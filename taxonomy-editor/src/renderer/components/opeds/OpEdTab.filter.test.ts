// Regression gate for t/2791 crash: filterSets/filterCommunity must not throw
// when topic is undefined on a community entry.

import { describe, it, expect } from 'vitest';

describe('OpEdTab filter — undefined topic guard', () => {
  const filterSets = (topic: string | undefined, q: string) =>
    !q || (topic?.toLowerCase().includes(q) ?? false);

  const filterCommunity = (topic: string | undefined, q: string) =>
    !q || (topic?.toLowerCase().includes(q) ?? false);

  it('filterSets: does not throw when topic is undefined', () => {
    expect(() => filterSets(undefined, 'ai')).not.toThrow();
    expect(filterSets(undefined, 'ai')).toBe(false);
  });

  it('filterSets: matches when topic is present', () => {
    expect(filterSets('AI Safety Overview', 'safety')).toBe(true);
    expect(filterSets('AI Safety Overview', 'ethics')).toBe(false);
  });

  it('filterSets: empty query returns true (no filter)', () => {
    expect(filterSets(undefined, '')).toBe(true);
  });

  it('filterCommunity: does not throw when topic is undefined', () => {
    expect(() => filterCommunity(undefined, 'ai replaces humans')).not.toThrow();
    expect(filterCommunity(undefined, 'ai replaces humans')).toBe(false);
  });

  it('filterCommunity: matches when topic is present', () => {
    expect(filterCommunity('AI Replaces Humans', 'replaces')).toBe(true);
    expect(filterCommunity('AI Replaces Humans', 'biology')).toBe(false);
  });
});
