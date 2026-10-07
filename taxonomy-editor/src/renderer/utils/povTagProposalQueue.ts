// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Pure helpers behind the POV-tag proposal review queue (t/4052). The queue records a decision per item in
// taxonomy/Origin/pov-tag-proposals.json and never writes pov_tags; the frozen step-4 write does that later.

import { isNodeOfPov } from '@lib/debate/nodeIdUtils';
import type { PovTagProposal, PovTagProposalsFile, ProposalDecision, ProposalStatus } from '@lib/schema/povTagProposals';

export const PROPOSAL_FILE_SUFFIX = 'pov-tag-proposals.json';

/** Filter value meaning "nothing proposed" for the proposed-tag filter. */
export const NO_TAG = '__none__';

export interface ProposalFilter {
  status: ProposalStatus | 'all';
  /** A tag id, NO_TAG, or 'all'. */
  tag: string;
  /** beliefs / desires / intentions, or 'all'. */
  category: string;
}

export const DEFAULT_PROPOSAL_FILTER: ProposalFilter = { status: 'pending', tag: 'all', category: 'all' };

/** The BDI category in a node id (`skp-desires-009` → `desires`), or '' when the id has none. */
export function proposalCategory(nodeId: string): string {
  return /-(beliefs|desires|intentions)-/.exec(nodeId)?.[1] ?? '';
}

/** The items for one POV's tab. */
export function proposalsForPov(file: PovTagProposalsFile | null, pov: string): PovTagProposal[] {
  return file ? file.proposals.filter(p => isNodeOfPov(p.node_id, pov)) : [];
}

export function filterProposals(items: readonly PovTagProposal[], f: ProposalFilter): PovTagProposal[] {
  return items.filter(p =>
    (f.status === 'all' || p.status === f.status)
    && (f.tag === 'all' || (f.tag === NO_TAG ? p.proposed.length === 0 : p.proposed.includes(f.tag)))
    && (f.category === 'all' || proposalCategory(p.node_id) === f.category));
}

const sameTags = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

/**
 * The decision to send. A "modify" that ends up equal to the proposal (as a set) is sent as `accepted`, since
 * the lib refuses `modified` with final == proposed (CL e/269#3).
 */
export function decisionFor(kind: 'accept' | 'reject' | 'modify', proposed: readonly string[], draft: readonly string[] = []): ProposalDecision {
  if (kind === 'accept') return { status: 'accepted' };
  if (kind === 'reject') return { status: 'rejected' };
  return sameTags(proposed, draft) ? { status: 'accepted' } : { status: 'modified', final: [...draft] };
}

/** Whether the data checkout has the side file uncommitted (reviews saved locally, not yet on data main). */
export function proposalFileUncommitted(changed: ReadonlyArray<{ path: string }>): boolean {
  return changed.some(c => c.path.replace(/\\/g, '/').endsWith(PROPOSAL_FILE_SUFFIX));
}
