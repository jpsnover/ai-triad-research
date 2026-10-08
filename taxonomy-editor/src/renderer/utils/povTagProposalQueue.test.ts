// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import type { PovTagProposal, PovTagProposalsFile } from '@lib/schema/povTagProposals';
import {
  proposalCategory, proposalsForPov, filterProposals, decisionFor, proposalFileUncommitted,
  DEFAULT_PROPOSAL_FILTER, NO_TAG,
} from './povTagProposalQueue';

// t/4052
const item = (node_id: string, proposed: string[], status: PovTagProposal['status'] = 'pending'): PovTagProposal =>
  ({ node_id, proposed, status, final: null, reviewed_by: null, reviewed_at: null });

const file: PovTagProposalsFile = {
  version: 1,
  run: { model: 'x' },
  proposals: [
    item('skp-beliefs-001', ['critical']),
    item('skp-desires-002', ['critical', 'institutional']),
    item('skp-intentions-003', []),
    item('skp-beliefs-004', ['institutional'], 'accepted'),
    item('acc-beliefs-001', ['other']),
  ],
};

describe('proposal queue helpers (t/4052)', () => {
  it('scopes to the POV and reads the category from the id', () => {
    expect(proposalsForPov(file, 'skeptic').map(p => p.node_id)).toEqual(['skp-beliefs-001', 'skp-desires-002', 'skp-intentions-003', 'skp-beliefs-004']);
    expect(proposalsForPov(null, 'skeptic')).toEqual([]);
    expect(proposalCategory('skp-desires-009')).toBe('desires');
    expect(proposalCategory('sit-001')).toBe('');
  });

  it('filters by status (pending by default), proposed tag (incl. none) and category', () => {
    const skp = proposalsForPov(file, 'skeptic');
    expect(filterProposals(skp, DEFAULT_PROPOSAL_FILTER)).toHaveLength(3);
    expect(filterProposals(skp, { status: 'all', tag: 'critical', category: 'all' }).map(p => p.node_id)).toEqual(['skp-beliefs-001', 'skp-desires-002']);
    expect(filterProposals(skp, { status: 'all', tag: NO_TAG, category: 'all' }).map(p => p.node_id)).toEqual(['skp-intentions-003']);
    expect(filterProposals(skp, { status: 'all', tag: 'all', category: 'beliefs' }).map(p => p.node_id)).toEqual(['skp-beliefs-001', 'skp-beliefs-004']);
  });

  it('a modify equal to the proposal (in any order) is sent as accepted; otherwise modified with final', () => {
    expect(decisionFor('accept', ['critical'])).toEqual({ status: 'accepted' });
    expect(decisionFor('reject', ['critical'])).toEqual({ status: 'rejected' });
    expect(decisionFor('modify', ['critical', 'institutional'], ['institutional', 'critical'])).toEqual({ status: 'accepted' });
    expect(decisionFor('modify', ['critical', 'institutional'], ['institutional'])).toEqual({ status: 'modified', final: ['institutional'] });
    expect(decisionFor('modify', ['critical'], [])).toEqual({ status: 'modified', final: [] });
  });

  it('detects the side file among changed files, either slash style', () => {
    expect(proposalFileUncommitted([{ path: 'taxonomy/Origin/pov-tag-proposals.json' }])).toBe(true);
    expect(proposalFileUncommitted([{ path: 'taxonomy\\Origin\\pov-tag-proposals.json' }])).toBe(true);
    expect(proposalFileUncommitted([{ path: 'taxonomy/Origin/skeptic.json' }])).toBe(false);
  });
});
