// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Unit tests for the pure LibraryListPage-adoption helpers in OpEdTab.tsx (t/3703). The full
// LibraryListPageConfig object itself is exercised indirectly via LibraryListPage.test.tsx's
// generic contract tests plus OpEdCampTags.test.tsx for the page-specific column renderer — these
// cover the per-page glue functions that don't need a component render to verify.

import { describe, it, expect } from 'vitest';
import { opEdLibDate, formatLibDate, opEdCommunityAuthor } from './OpEdTab';

describe('opEdLibDate (t/3703)', () => {
  it('reads created_at on the My variant', () => {
    const row = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' } as never;
    expect(opEdLibDate(row, 'my')).toBe('2026-01-01T00:00:00Z');
  });

  it('reads updated_at on the Community variant', () => {
    const row = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' } as never;
    expect(opEdLibDate(row, 'community')).toBe('2026-01-02T00:00:00Z');
  });

  it('falls back to created_at when updated_at is absent on Community (OpEdSetSummary.updated_at is optional)', () => {
    const row = { created_at: '2026-01-01T00:00:00Z' } as never;
    expect(opEdLibDate(row, 'community')).toBe('2026-01-01T00:00:00Z');
  });
});

describe('formatLibDate (t/3703)', () => {
  it('renders month/day/24h-time with no AM/PM, matching the spec\'s "Aug 16, 10:48" shape', () => {
    const formatted = formatLibDate('2026-08-16T10:48:00Z');
    expect(formatted).not.toMatch(/AM|PM/i);
    expect(formatted).toMatch(/^[A-Za-z]{3}\s\d{1,2},\s\d{2}:\d{2}$/);
  });
});

describe('opEdCommunityAuthor (t/3703)', () => {
  it('reads submitted_by_display off community_metadata', () => {
    expect(opEdCommunityAuthor({ community_metadata: { submitted_by_display: 'Jane' } } as never)).toBe('Jane');
  });

  it('returns undefined when community_metadata is absent, not a crash', () => {
    expect(opEdCommunityAuthor({} as never)).toBeUndefined();
  });
});
