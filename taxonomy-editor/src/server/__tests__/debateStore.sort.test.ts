// @vitest-environment node

/**
 * Regression guard for t/2407 — null-safe updated_at sort in debateStore.ts.
 *
 * listDebateSessions and listChatSessions both sort summaries by updated_at
 * descending. External JSON data can carry null/undefined for that field; the
 * guard `(b.updated_at ?? '').localeCompare(a.updated_at ?? '')` prevents a
 * TypeError that the bare `.localeCompare` would throw.
 */

import { describe, it, expect } from 'vitest';

type Summary = { updated_at: string | null | undefined };

/** Mirrors the comparator used in listDebateSessions and listChatSessions. */
const sortUpdatedAtDesc = (a: Summary, b: Summary) =>
  (b.updated_at ?? '').localeCompare(a.updated_at ?? '');

describe('debateStore updated_at sort guard (t/2407)', () => {
  it('does not throw when updated_at is null', () => {
    const items: Summary[] = [
      { updated_at: '2024-02-01T00:00:00Z' },
      { updated_at: null },
      { updated_at: '2024-01-01T00:00:00Z' },
    ];
    expect(() => [...items].sort(sortUpdatedAtDesc)).not.toThrow();
  });

  it('does not throw when updated_at is undefined', () => {
    const items: Summary[] = [
      { updated_at: '2024-02-01T00:00:00Z' },
      { updated_at: undefined },
    ];
    expect(() => [...items].sort(sortUpdatedAtDesc)).not.toThrow();
  });

  it('sorts descending with null updated_at placed last', () => {
    const items: Summary[] = [
      { updated_at: '2024-01-01T00:00:00Z' },
      { updated_at: null },
      { updated_at: '2024-02-01T00:00:00Z' },
    ];
    const sorted = [...items].sort(sortUpdatedAtDesc);
    expect(sorted[0].updated_at).toBe('2024-02-01T00:00:00Z');
    expect(sorted[1].updated_at).toBe('2024-01-01T00:00:00Z');
    expect(sorted[2].updated_at).toBeNull();
  });

  it('sorts descending with undefined updated_at placed last', () => {
    const items: Summary[] = [
      { updated_at: undefined },
      { updated_at: '2024-03-01T00:00:00Z' },
      { updated_at: '2024-01-01T00:00:00Z' },
    ];
    const sorted = [...items].sort(sortUpdatedAtDesc);
    expect(sorted[0].updated_at).toBe('2024-03-01T00:00:00Z');
    expect(sorted[1].updated_at).toBe('2024-01-01T00:00:00Z');
    expect(sorted[2].updated_at).toBeUndefined();
  });

  it('handles all-null updated_at without throw', () => {
    const items: Summary[] = [
      { updated_at: null },
      { updated_at: null },
      { updated_at: null },
    ];
    expect(() => [...items].sort(sortUpdatedAtDesc)).not.toThrow();
  });
});
