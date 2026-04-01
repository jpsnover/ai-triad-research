// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  CommitmentStore,
  ConvergenceIssue,
  ConvergenceTracker,
} from '@lib/debate/types';

const MAX_ISSUES = 6;
const MIN_CLAIMS_PER_ISSUE = 2;

interface ArgumentNetwork {
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
}

// ── Issue extraction ──────────────────────────────────

interface IssueCandidate {
  taxonomy_ref: string;
  label: string;
  claim_count: number;
  claim_ids: string[];
}

/**
 * Group AN nodes by taxonomy_ref, rank by claim count.
 * Returns all candidates (caller decides how many to display).
 */
export function extractIssuesFromAN(
  an: ArgumentNetwork,
  getLabelForId: (id: string) => string,
): IssueCandidate[] {
  const groups = new Map<string, string[]>();

  for (const node of an.nodes) {
    if (node.taxonomy_refs.length === 0) {
      const existing = groups.get('_general') || [];
      existing.push(node.id);
      groups.set('_general', existing);
    } else {
      for (const ref of node.taxonomy_refs) {
        const existing = groups.get(ref) || [];
        existing.push(node.id);
        groups.set(ref, existing);
      }
    }
  }

  const candidates: IssueCandidate[] = [];
  for (const [ref, claimIds] of groups) {
    if (claimIds.length < MIN_CLAIMS_PER_ISSUE) continue;
    const label = ref === '_general' ? 'General' : (getLabelForId(ref) || ref);
    candidates.push({
      taxonomy_ref: ref === '_general' ? '' : ref,
      label,
      claim_count: claimIds.length,
      claim_ids: claimIds,
    });
  }

  candidates.sort((a, b) => b.claim_count - a.claim_count);
  return candidates;
}

// ── Convergence scoring ───────────────────────────────

/**
 * Compute convergence score (0–1) for a set of claims.
 *
 * Three signals, weighted:
 *   0.40 — Cross-speaker support ratio
 *   0.35 — Concession rate
 *   0.25 — Stance alignment (speaker pairs with mutual support)
 */
export function computeConvergence(
  an: ArgumentNetwork,
  commitments: Record<string, CommitmentStore>,
  claimIds: string[],
): number {
  const claimSet = new Set(claimIds);
  const claimNodes = an.nodes.filter(n => claimSet.has(n.id));
  if (claimNodes.length === 0) return 0;

  // Build speaker → claims map
  const speakerClaims = new Map<string, Set<string>>();
  for (const node of claimNodes) {
    const existing = speakerClaims.get(node.speaker) || new Set();
    existing.add(node.id);
    speakerClaims.set(node.speaker, existing);
  }

  const speakers = [...speakerClaims.keys()].filter(s => s !== 'system');
  if (speakers.length < 2) return 0.5; // Only one speaker on this issue — neutral baseline

  // Signal 1: Cross-speaker support ratio
  let crossSupports = 0;
  let crossAttacks = 0;
  for (const edge of an.edges) {
    if (!claimSet.has(edge.source) && !claimSet.has(edge.target)) continue;
    const srcNode = an.nodes.find(n => n.id === edge.source);
    const tgtNode = an.nodes.find(n => n.id === edge.target);
    if (!srcNode || !tgtNode || srcNode.speaker === tgtNode.speaker) continue;
    if (srcNode.speaker === 'system' || tgtNode.speaker === 'system') continue;
    if (edge.type === 'supports') crossSupports++;
    else if (edge.type === 'attacks') crossAttacks++;
  }
  // No cross-speaker edges yet — use 0.5 baseline (unknown)
  const totalCross = crossSupports + crossAttacks;
  const supportRatio = totalCross === 0 ? 0.5 : crossSupports / totalCross;

  // Signal 2: Concession rate
  let concessions = 0;
  for (const speaker of speakers) {
    const store = commitments[speaker];
    if (!store) continue;
    for (const cid of store.conceded) {
      if (claimSet.has(cid)) concessions++;
    }
  }
  const concessionRate = concessions / Math.max(1, claimNodes.length);

  // Signal 3: Stance alignment — speaker pairs with at least one cross-support
  let pairsWithSupport = 0;
  let totalPairs = 0;
  for (let i = 0; i < speakers.length; i++) {
    for (let j = i + 1; j < speakers.length; j++) {
      totalPairs++;
      const si = speakers[i];
      const sj = speakers[j];
      const hasSupport = an.edges.some(e => {
        if (e.type !== 'supports') return false;
        const src = an.nodes.find(n => n.id === e.source);
        const tgt = an.nodes.find(n => n.id === e.target);
        if (!src || !tgt) return false;
        return (
          (src.speaker === si && tgt.speaker === sj) ||
          (src.speaker === sj && tgt.speaker === si)
        ) && (claimSet.has(e.source) || claimSet.has(e.target));
      });
      if (hasSupport) pairsWithSupport++;
    }
  }
  const alignment = pairsWithSupport / Math.max(1, totalPairs);

  return Math.min(1, 0.4 * supportRatio + 0.35 * concessionRate + 0.25 * alignment);
}

// ── Tracker update ────────────────────────────────────

/**
 * Recompute convergence for all tracked issues and refresh the available list.
 * Called after each extractClaimsAndUpdateAN pass.
 */
export function updateConvergenceTracker(
  tracker: ConvergenceTracker | undefined,
  an: ArgumentNetwork,
  commitments: Record<string, CommitmentStore>,
  currentTurn: number,
  getLabelForId: (id: string) => string,
): ConvergenceTracker {
  const allCandidates = extractIssuesFromAN(an, getLabelForId);

  if (!tracker || tracker.issues.length === 0) {
    // First time — auto-select top issues
    const top = allCandidates.slice(0, MAX_ISSUES);
    const issues: ConvergenceIssue[] = top.map((c, i) => {
      const score = computeConvergence(an, commitments, c.claim_ids);
      return {
        id: `ci-${i}`,
        label: c.label,
        taxonomy_ref: c.taxonomy_ref || null,
        convergence: score,
        claim_ids: c.claim_ids,
        history: [{ turn: currentTurn, value: score }],
      };
    });
    const trackedRefs = new Set(issues.map(i => i.taxonomy_ref || ''));
    return {
      issues,
      available_issues: allCandidates.filter(c => !trackedRefs.has(c.taxonomy_ref)).slice(0, 20),
      last_updated_turn: currentTurn,
    };
  }

  // Update existing issues — refresh claim_ids and recompute scores
  const candidateMap = new Map(allCandidates.map(c => [c.taxonomy_ref, c]));
  const updatedIssues = tracker.issues.map(issue => {
    const ref = issue.taxonomy_ref || '';
    const candidate = candidateMap.get(ref);
    const claimIds = candidate?.claim_ids || issue.claim_ids;
    const score = computeConvergence(an, commitments, claimIds);
    return {
      ...issue,
      claim_ids: claimIds,
      convergence: score,
      history: [...issue.history, { turn: currentTurn, value: score }],
    };
  });

  // Auto-fill up to MAX_ISSUES if new candidates are available
  const trackedRefs = new Set(updatedIssues.map(i => i.taxonomy_ref || ''));
  const untracked = allCandidates.filter(c => !trackedRefs.has(c.taxonomy_ref));
  let nextId = Math.max(0, ...updatedIssues.map(i => parseInt(i.id.replace('ci-', '')) || 0)) + 1;
  while (updatedIssues.length < MAX_ISSUES && untracked.length > 0) {
    const candidate = untracked.shift()!;
    const score = computeConvergence(an, commitments, candidate.claim_ids);
    updatedIssues.push({
      id: `ci-${nextId++}`,
      label: candidate.label,
      taxonomy_ref: candidate.taxonomy_ref || null,
      convergence: score,
      claim_ids: candidate.claim_ids,
      history: [{ turn: currentTurn, value: score }],
    });
    trackedRefs.add(candidate.taxonomy_ref);
  }

  return {
    issues: updatedIssues,
    available_issues: untracked.map(c => ({ taxonomy_ref: c.taxonomy_ref, label: c.label, claim_count: c.claim_count })).slice(0, 20),
    last_updated_turn: currentTurn,
  };
}

// ── Issue swap ────────────────────────────────────────

let _nextId = 100;

export function swapIssue(
  tracker: ConvergenceTracker,
  removeId: string,
  addTaxonomyRef: string,
  addLabel: string,
  an: ArgumentNetwork,
  commitments: Record<string, CommitmentStore>,
  currentTurn: number,
): ConvergenceTracker {
  const removed = tracker.issues.find(i => i.id === removeId);
  const remaining = tracker.issues.filter(i => i.id !== removeId);

  // Find claims for the new issue
  const claimIds = an.nodes
    .filter(n => addTaxonomyRef ? n.taxonomy_refs.includes(addTaxonomyRef) : n.taxonomy_refs.length === 0)
    .map(n => n.id);

  const score = computeConvergence(an, commitments, claimIds);
  const newIssue: ConvergenceIssue = {
    id: `ci-${_nextId++}`,
    label: addLabel,
    taxonomy_ref: addTaxonomyRef || null,
    convergence: score,
    claim_ids: claimIds,
    history: [{ turn: currentTurn, value: score }],
  };

  const issues = [...remaining, newIssue];
  const trackedRefs = new Set(issues.map(i => i.taxonomy_ref || ''));

  // Put the removed issue back in available
  const available = tracker.available_issues.filter(a => a.taxonomy_ref !== addTaxonomyRef);
  if (removed) {
    available.push({
      taxonomy_ref: removed.taxonomy_ref || '',
      label: removed.label,
      claim_count: removed.claim_ids.length,
    });
  }

  return {
    issues,
    available_issues: available.filter(a => !trackedRefs.has(a.taxonomy_ref)).slice(0, 20),
    last_updated_turn: currentTurn,
  };
}
