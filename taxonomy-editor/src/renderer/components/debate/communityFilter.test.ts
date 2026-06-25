// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { filterCommunityDebates } from './communityFilter';
import type { CommunityDebate } from '../../hooks/useCommunityStore';

const debates = [
  { id: '1', title: 'AI safety timelines', updated_at: '2026-01-01' },
  { id: '2', title: 'GPU export controls', updated_at: '2026-01-01', community_metadata: { submitted_by_display: 'Ada Lovelace' } },
  { id: '3', title: 'Open weights debate', updated_at: '2026-01-01' },
] as unknown as CommunityDebate[];

describe('filterCommunityDebates', () => {
  it('returns all when the query is empty or whitespace', () => {
    expect(filterCommunityDebates(debates, '')).toHaveLength(3);
    expect(filterCommunityDebates(debates, '   ')).toHaveLength(3);
  });

  it('matches on title, case-insensitively', () => {
    expect(filterCommunityDebates(debates, 'SAFETY').map(d => d.id)).toEqual(['1']);
  });

  it('matches on the submitter display name (participant)', () => {
    expect(filterCommunityDebates(debates, 'lovelace').map(d => d.id)).toEqual(['2']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterCommunityDebates(debates, 'zzz-no-match')).toHaveLength(0);
  });

  it('does not throw when community_metadata is absent', () => {
    expect(() => filterCommunityDebates(debates, 'lovelace')).not.toThrow();
  });
});
