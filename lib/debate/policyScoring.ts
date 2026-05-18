// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Policy consensus scoring and real-world legislation reference types.
 *
 * Computes a composite consensus_score for each policy based on:
 * - member_count (breadth of taxonomy support)
 * - cross-POV endorsement (distinct source_povs)
 * - debate citation frequency
 * - edge analysis (SUPPORTS vs CONTRADICTS ratio)
 */

// ── Types ────────────────────────────────────────────────

/** Real-world legislation reference for a policy item. */
export interface LegislationRef {
  jurisdiction: string;      // e.g., "EU", "US-Federal", "California"
  instrument: string;        // e.g., "AI Act Art. 57-58", "EO-14110 §4.2"
  status: 'enacted' | 'proposed' | 'expired' | 'withdrawn';
  url?: string;
}

/** Extended policy entry with scoring and legislation fields. */
export interface ScoredPolicy {
  id: string;
  action: string;
  source_povs: string[];
  member_count: number;
  tags?: string[];
  consensus_score: number;
  score_components: {
    breadth: number;        // 0-1: member_count normalized
    cross_pov: number;      // 0-1: distinct POVs / 4 (max POVs including situations)
    debate_cited: number;   // 0-1: fraction of debates that cited this policy
    edge_support: number;   // 0-1: SUPPORTS/(SUPPORTS+CONTRADICTS) ratio
  };
  real_world_refs?: LegislationRef[];
  status?: 'active' | 'superseded' | 'merged' | 'archived';
  superseded_by?: string;
  merged_into?: string;
  last_refined_at?: string;
  framing_count_at_refinement?: number;
}

/** Raw policy entry from policy_actions.json. */
export interface RawPolicy {
  id: string;
  action: string;
  source_povs?: string[];
  member_count?: number;
  tags?: string[];
  real_world_refs?: LegislationRef[];
  status?: string;
  superseded_by?: string;
  merged_into?: string;
  last_refined_at?: string;
  framing_count_at_refinement?: number;
}

// ── Consensus scoring ────────────────────────────────────

/**
 * Compute consensus scores for all policies.
 *
 * @param policies - Raw policy entries from the registry
 * @param edges - All edges (for SUPPORTS/CONTRADICTS analysis involving policy-connected nodes)
 * @param debatePolicyRefs - Map of debate_id → set of pol-NNN IDs cited in that debate
 */
export function computeConsensusScores(
  policies: RawPolicy[],
  edges?: Array<{ source: string; target: string; type: string }>,
  debatePolicyRefs?: Map<string, Set<string>>,
): ScoredPolicy[] {
  const maxMemberCount = Math.max(1, ...policies.map(p => p.member_count ?? 0));
  const totalDebates = debatePolicyRefs?.size ?? 0;

  return policies.map(policy => {
    // Breadth: member_count normalized by the most-referenced policy
    const breadth = (policy.member_count ?? 0) / maxMemberCount;

    // Cross-POV: distinct POVs out of 4 possible (acc, saf, skp, situations)
    const povs = new Set(policy.source_povs ?? []);
    const crossPov = Math.min(1, povs.size / 4);

    // Debate citation: fraction of debates that referenced this policy
    let debateCited = 0;
    if (totalDebates > 0 && debatePolicyRefs) {
      let citedCount = 0;
      for (const refs of debatePolicyRefs.values()) {
        if (refs.has(policy.id)) citedCount++;
      }
      debateCited = citedCount / totalDebates;
    }

    // Edge support ratio: among edges involving nodes that reference this policy,
    // what fraction are SUPPORTS vs CONTRADICTS?
    let edgeSupport = 0.5; // neutral default
    if (edges && edges.length > 0) {
      // Simplified: count edges where source or target contains this policy's POV prefix
      // Full implementation would cross-reference node-to-policy mappings
      const policyPovPrefixes = (policy.source_povs ?? []).map(p => {
        if (p === 'accelerationist') return 'acc-';
        if (p === 'safetyist') return 'saf-';
        if (p === 'skeptic') return 'skp-';
        return p + '-';
      });

      let supports = 0;
      let contradicts = 0;
      for (const edge of edges) {
        const involvesPolicy = policyPovPrefixes.some(
          pfx => edge.source.startsWith(pfx) || edge.target.startsWith(pfx),
        );
        if (!involvesPolicy) continue;
        if (edge.type === 'SUPPORTS') supports++;
        else if (edge.type === 'CONTRADICTS') contradicts++;
      }
      const total = supports + contradicts;
      if (total > 0) edgeSupport = supports / total;
    }

    // Composite: weighted average
    const consensus_score =
      0.30 * breadth +
      0.35 * crossPov +
      0.20 * debateCited +
      0.15 * edgeSupport;

    return {
      ...policy,
      source_povs: policy.source_povs ?? [],
      member_count: policy.member_count ?? 0,
      consensus_score: Math.round(consensus_score * 100) / 100,
      score_components: {
        breadth: Math.round(breadth * 100) / 100,
        cross_pov: Math.round(crossPov * 100) / 100,
        debate_cited: Math.round(debateCited * 100) / 100,
        edge_support: Math.round(edgeSupport * 100) / 100,
      },
    } as ScoredPolicy;
  }).sort((a, b) => b.consensus_score - a.consensus_score);
}

/**
 * Get the top N policies by consensus score.
 */
export function topPolicies(scored: ScoredPolicy[], n: number = 10): ScoredPolicy[] {
  return scored.filter(p => p.status !== 'archived' && p.status !== 'superseded').slice(0, n);
}
