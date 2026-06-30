// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { ArgumentNetworkNode } from './types.js';
import type { DocMetaMap } from './evidenceFromSummaries.js';

// ── Venue tier classification ────────────────────────────────

export type VenueTier =
  | 'peer_reviewed'
  | 'conference'
  | 'preprint'
  | 'policy_doc'
  | 'blog_news'
  | 'unknown';

const VENUE_TIER_SCORES: Record<VenueTier, number> = {
  peer_reviewed: 1.0,
  conference:    0.8,
  preprint:      0.6,
  policy_doc:    0.7,
  blog_news:     0.4,
  unknown:       0.3,
};

const RECENCY_HALF_LIFE = 5;

export function classifyVenueTier(meta: { title: string; provenance_label?: string }): VenueTier {
  const lower = ((meta.title ?? '') + ' ' + (meta.provenance_label ?? '')).toLowerCase();

  if (/\b(journal|peer.?review|ieee|acm\s|lancet|pnas|plos|nature\s+(medicine|biotechnology|communications|neuroscience|methods|physics|chemistry|climate|energy|human\s+behaviour)|science\s+(advances|robotics|translational))\b/.test(lower)) return 'peer_reviewed';
  if (/\b(conference|proceedings|workshop|icml|neurips|iclr|aaai|cvpr|emnlp|acl\s)\b/.test(lower)) return 'conference';
  if (/\b(arxiv|preprint|ssrn|biorxiv|medrxiv)\b/.test(lower)) return 'preprint';
  if (/\b(act\b|executive order|regulation|statute|directive|bill\b|white\s?paper|policy|government|gao|oecd|eu\s|un\s)\b/.test(lower)) return 'policy_doc';
  if (/\b(blog|news|medium|substack|guardian|nytimes|reuters|bbc|techcrunch|wired|verge)\b/.test(lower)) return 'blog_news';

  return 'unknown';
}

export function venueTierScore(tier: VenueTier): number {
  return VENUE_TIER_SCORES[tier];
}

// ── Source recency ───────────────────────────────────────────

export function extractYear(meta: { title: string; provenance_label?: string }): number | null {
  const match = ((meta.provenance_label ?? '') + ' ' + (meta.title ?? '')).match(/\b((?:19|20)\d{2})\b/);
  return match ? parseInt(match[1], 10) : null;
}

export function computeRecency(publicationYear: number, currentYear: number): number {
  const age = Math.max(0, currentYear - publicationYear);
  return Math.pow(0.5, age / RECENCY_HALF_LIFE);
}

// ── Evidence breadth ─────────────────────────────────────────

export function computeEvidenceBreadth(nodes: ArgumentNetworkNode[]): number | null {
  if (nodes.length === 0) return null;
  let totalDistinctSources = 0;
  let nodesWithEvidence = 0;
  for (const node of nodes) {
    if (!node.evidence_graph?.evidence_items?.length) continue;
    const docIds = new Set(node.evidence_graph.evidence_items.map(e => e.source_doc_id));
    totalDistinctSources += docIds.size;
    nodesWithEvidence++;
  }
  if (nodesWithEvidence === 0) return null;
  return totalDistinctSources / nodesWithEvidence;
}

// ── Aggregate scoring for calibration ────────────────────────

export interface SourceAuthorityResult {
  source_authority_mean: number | null;
  source_recency_mean: number | null;
  evidence_breadth_per_claim: number | null;
}

export function computeSourceAuthority(
  nodes: ArgumentNetworkNode[],
  docMeta?: DocMetaMap,
): SourceAuthorityResult {
  const currentYear = new Date().getFullYear();
  const evidenceBreadth = computeEvidenceBreadth(nodes);

  if (!docMeta || Object.keys(docMeta).length === 0) {
    return {
      source_authority_mean: null,
      source_recency_mean: null,
      evidence_breadth_per_claim: evidenceBreadth,
    };
  }

  const citedDocIds = new Set<string>();
  for (const node of nodes) {
    if (!node.evidence_graph?.evidence_items) continue;
    for (const item of node.evidence_graph.evidence_items) {
      citedDocIds.add(item.source_doc_id);
    }
  }

  if (citedDocIds.size === 0) {
    return {
      source_authority_mean: null,
      source_recency_mean: null,
      evidence_breadth_per_claim: evidenceBreadth,
    };
  }

  const venueScores: number[] = [];
  const recencyScores: number[] = [];
  for (const docId of citedDocIds) {
    const meta = docMeta[docId];
    if (!meta) {
      venueScores.push(VENUE_TIER_SCORES.unknown);
      continue;
    }
    venueScores.push(venueTierScore(classifyVenueTier(meta)));
    const year = extractYear(meta);
    if (year != null) {
      recencyScores.push(computeRecency(year, currentYear));
    }
  }

  return {
    source_authority_mean: venueScores.length > 0
      ? venueScores.reduce((a, b) => a + b, 0) / venueScores.length
      : null,
    source_recency_mean: recencyScores.length > 0
      ? recencyScores.reduce((a, b) => a + b, 0) / recencyScores.length
      : null,
    evidence_breadth_per_claim: evidenceBreadth,
  };
}
