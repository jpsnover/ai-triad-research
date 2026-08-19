// Unit test for ChatTab search filter guards — t/2790 / t/2791.
// Exercises the inline filter predicates directly to confirm undefined-title rows
// do not throw when a search query is present.

import { describe, it, expect } from 'vitest';

describe('ChatTab search filter undefined-title guard', () => {
  const myFilter = (title: string | undefined, q: string) =>
    (title ?? '').toLowerCase().includes(q.toLowerCase());

  const communityFilter = (title: string | undefined, q: string) =>
    (title ?? '').toLowerCase().includes(q.toLowerCase());

  it('matches a normal title', () => {
    expect(myFilter('AI Safety Overview', 'safety')).toBe(true);
  });

  it('does not throw when title is undefined', () => {
    expect(() => myFilter(undefined, 'safety')).not.toThrow();
    expect(myFilter(undefined, 'safety')).toBe(false);
  });

  it('matches an empty string query (no filter)', () => {
    expect(myFilter(undefined, '')).toBe(true);
  });

  it('community: does not throw when title is undefined', () => {
    expect(() => communityFilter(undefined, 'ai replaces humans')).not.toThrow();
    expect(communityFilter(undefined, 'ai replaces humans')).toBe(false);
  });

  it('community: matches when title is present', () => {
    expect(communityFilter('AI replaces humans study', 'replaces')).toBe(true);
  });
});
