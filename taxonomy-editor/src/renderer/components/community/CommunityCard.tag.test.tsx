// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommunityCard } from './CommunityLibrary';
import type { OpEdCommunityEntry } from '../../../../../lib/oped/types';

// t/3992: a community op-ed scoped to one wing says so (TL t/3960#3 cond 2).
const entry = (tag?: OpEdCommunityEntry['tag']): OpEdCommunityEntry => ({
  id: 'o1', topic: 'Licensing', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  camps: ['skeptic'], voice_count: 1, community_metadata: null, ...(tag ? { tag } : {}),
});
const card = (item: OpEdCommunityEntry) =>
  render(<CommunityCard item={item} isAdmin={false} onCopy={vi.fn()} onRemove={vi.fn()} />);

describe('CommunityCard op-ed tag badge (t/3992)', () => {
  it('shows the wing and mode for a tagged op-ed', () => {
    card(entry({ pov: 'skeptic', tag: 'critical', mode: 'scope', label: 'Critical' }));
    expect(screen.getByText('Skeptic · Critical wing (Scope)')).toBeTruthy();
  });

  it('shows no wing badge for an untagged op-ed', () => {
    card(entry());
    expect(screen.queryByText(/ wing \(/)).toBeNull();
  });
});
