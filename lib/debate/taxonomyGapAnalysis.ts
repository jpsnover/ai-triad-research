// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  TaxonomyGapAnalysis,
  PovCoverage,
  BdiBalance,
  CrossPovGap,
  UnmappedArgument,
  GapSummary,
  TranscriptEntry,
  ArgumentNetworkNode,
} from './types.js';

// ── Helper types for inputs ──────────────────────────────────────────

export interface TaxonomyNode {
  id: string;
  label: string;
  category: string;
  description?: string;
}

export interface ContextManifestEntry {
  round: number;
  speaker: string;
  pov: string;
  injected_node_ids: string[];
  primary_node_ids: string[];
  referenced_node_ids: string[];
}

// ── Internal constants ───────────────────────────────────────────────

/** Map POV labels to SpeakerId speaker names. */
const POV_TO_SPEAKER: Record<string, string> = {
  accelerationist: 'prometheus',
  safetyist: 'sentinel',
  skeptic: 'cassandra',
};

/** Map SpeakerId speaker names back to POV labels. */
const SPEAKER_TO_POV: Record<string, string> = {
  prometheus: 'accelerationist',
  sentinel: 'safetyist',
  cassandra: 'skeptic',
};

/** Canonical BDI category names. */
const BDI_CATEGORIES = ['Beliefs', 'Desires', 'Intentions'] as const;

/** Node-ID prefix to BDI category mapping (e.g. acc-B-001 → Beliefs). */
const BDI_PREFIX_MAP: Record<string, string> = {
  B: 'Beliefs',
  D: 'Desires',
  I: 'Intentions',
};

// ── Internal helpers ─────────────────────────────────────────────────

/** Normalize a category string to the canonical BDI form. */
function normalizeBdiCategory(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower === 'beliefs' || lower === 'belief') return 'Beliefs';
  if (lower === 'desires' || lower === 'desire') return 'Desires';
  if (lower === 'intentions' || lower === 'intention') return 'Intentions';
  return raw;
}

/** Derive BDI category from a node ID like "acc-B-001" or "saf-D-042". */
function bdiCategoryFromNodeId(nodeId: string): string {
  const parts = nodeId.split('-');
  if (parts.length >= 2) {
    const mapped = BDI_PREFIX_MAP[parts[1]];
    if (mapped) return mapped;
  }
  return 'unknown';
}

/**
 * Extract taxonomy ref node IDs from a transcript entry's taxonomy_refs field.
 * Handles both TaxonomyRef objects ({node_id, relevance}) and bare strings.
 */
function extractRefNodeIds(entry: TranscriptEntry): string[] {
  if (!entry.taxonomy_refs || !Array.isArray(entry.taxonomy_refs)) return [];
  return entry.taxonomy_refs.map(ref =>
    typeof ref === 'string' ? ref : ref.node_id,
  );
}

/** Simple tokenizer: lowercase, strip punctuation, split on whitespace. */
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * Check whether a text contains key terms from a query string.
 * Returns true if at least 2 non-trivial tokens from the query appear in the text,
 * or if the query is very short (1-2 tokens), at least 1 token matches.
 */
function textContainsKeyTerms(text: string, query: string): boolean {
  const textTokens = new Set(tokenize(text));
  const queryTokens = tokenize(query).filter(t => t.length > 3); // skip short words
  if (queryTokens.length === 0) return false;
  const threshold = queryTokens.length <= 2 ? 1 : 2;
  let matches = 0;
  for (const qt of queryTokens) {
    if (textTokens.has(qt)) matches++;
    if (matches >= threshold) return true;
  }
  return false;
}

/** Truncate a string to a given length, appending "..." if truncated. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

// ── Per-POV Coverage computation ─────────────────────────────────────

function computePovCoverage(
  pov: string,
  taxonomyNodes: TaxonomyNode[],
  contextManifests: ContextManifestEntry[],
  transcript: TranscriptEntry[],
): PovCoverage {
  const speaker = POV_TO_SPEAKER[pov] ?? pov;
  const povManifests = contextManifests.filter(m => m.pov === pov);

  // Collect unique node IDs across all manifests for this POV
  const injectedSet = new Set<string>();
  const primarySet = new Set<string>();
  const manifestReferencedSet = new Set<string>();

  for (const m of povManifests) {
    for (const id of m.injected_node_ids) injectedSet.add(id);
    for (const id of m.primary_node_ids) primarySet.add(id);
    for (const id of m.referenced_node_ids) manifestReferencedSet.add(id);
  }

  // Collect taxonomy refs from transcript entries for this speaker
  const transcriptReferencedSet = new Set<string>();
  for (const entry of transcript) {
    if (entry.speaker === speaker) {
      for (const nodeId of extractRefNodeIds(entry)) {
        transcriptReferencedSet.add(nodeId);
      }
    }
  }

  // Union of referenced from manifests and transcript
  const allReferenced = new Set([...manifestReferencedSet, ...transcriptReferencedSet]);

  // Build the taxonomy node ID set for this POV
  const taxonomyNodeIds = new Set(taxonomyNodes.map(n => n.id));

  // Unreferenced relevant: primary but never referenced
  const unreferencedRelevant: string[] = [];
  for (const id of primarySet) {
    if (!allReferenced.has(id)) unreferencedRelevant.push(id);
  }

  // Never injected: taxonomy nodes that never appeared in any manifest
  const neverInjected: string[] = [];
  for (const id of taxonomyNodeIds) {
    if (!injectedSet.has(id)) neverInjected.push(id);
  }

  // Category breakdown
  const categoryBreakdown: Record<string, { injected: number; referenced: number }> = {};
  for (const cat of BDI_CATEGORIES) {
    categoryBreakdown[cat] = { injected: 0, referenced: 0 };
  }
  for (const node of taxonomyNodes) {
    const cat = normalizeBdiCategory(node.category);
    if (!categoryBreakdown[cat]) {
      categoryBreakdown[cat] = { injected: 0, referenced: 0 };
    }
    if (injectedSet.has(node.id)) categoryBreakdown[cat].injected++;
    if (allReferenced.has(node.id)) categoryBreakdown[cat].referenced++;
  }

  const injectedCount = injectedSet.size;
  const referencedCount = allReferenced.size;
  const utilizationRate = injectedCount > 0 ? referencedCount / injectedCount : 0;

  return {
    total_nodes: taxonomyNodes.length,
    injected_nodes: injectedCount,
    referenced_nodes: referencedCount,
    utilization_rate: utilizationRate,
    unreferenced_relevant: unreferencedRelevant,
    never_injected: neverInjected,
    category_breakdown: categoryBreakdown,
  };
}

// ── BDI Balance computation ──────────────────────────────────────────

function computeBdiBalance(
  pov: string,
  taxonomyNodes: TaxonomyNode[],
  anNodes: ArgumentNetworkNode[],
  referencedNodeIds: Set<string>,
): BdiBalance {
  const speaker = POV_TO_SPEAKER[pov] ?? pov;

  // Count taxonomy nodes per BDI category
  const catNodeCount: Record<string, number> = { Beliefs: 0, Desires: 0, Intentions: 0 };
  const catCitedCount: Record<string, number> = { Beliefs: 0, Desires: 0, Intentions: 0 };

  for (const node of taxonomyNodes) {
    const cat = normalizeBdiCategory(node.category);
    if (catNodeCount[cat] !== undefined) {
      catNodeCount[cat]++;
      if (referencedNodeIds.has(node.id)) catCitedCount[cat]++;
    }
  }

  // Count AN nodes per BDI category for this speaker
  const catArgCount: Record<string, number> = { Beliefs: 0, Desires: 0, Intentions: 0 };
  const speakerAnNodes = anNodes.filter(n => n.speaker === speaker);
  for (const n of speakerAnNodes) {
    let cat: string;
    if (n.bdi_category) {
      cat = normalizeBdiCategory(n.bdi_category);
    } else {
      // Derive from node ID prefix pattern via taxonomy_refs
      cat = deriveBdiFromAnNode(n);
    }
    if (catArgCount[cat] !== undefined) catArgCount[cat]++;
  }

  // Find weakest category (lowest cited/total ratio)
  let weakest = 'Beliefs';
  let worstRatio = Infinity;
  for (const cat of BDI_CATEGORIES) {
    const total = catNodeCount[cat];
    const ratio = total > 0 ? catCitedCount[cat] / total : 1; // no nodes = not weak
    if (ratio < worstRatio) {
      worstRatio = ratio;
      weakest = cat;
    }
  }

  const recommendation = `Consider adding more ${weakest} nodes for the ${pov} perspective`;

  return {
    beliefs: {
      node_count: catNodeCount.Beliefs,
      cited_count: catCitedCount.Beliefs,
      argument_count: catArgCount.Beliefs,
    },
    desires: {
      node_count: catNodeCount.Desires,
      cited_count: catCitedCount.Desires,
      argument_count: catArgCount.Desires,
    },
    intentions: {
      node_count: catNodeCount.Intentions,
      cited_count: catCitedCount.Intentions,
      argument_count: catArgCount.Intentions,
    },
    weakest_category: weakest,
    recommendation,
  };
}

/** Derive BDI category from an AN node's taxonomy refs or ID patterns. */
function deriveBdiFromAnNode(node: ArgumentNetworkNode): string {
  if (node.taxonomy_refs && node.taxonomy_refs.length > 0) {
    // Use the first taxonomy ref's ID pattern
    const cat = bdiCategoryFromNodeId(node.taxonomy_refs[0]);
    if (cat !== 'unknown') return cat;
  }
  return 'unknown';
}

// ── Unmapped Arguments computation ───────────────────────────────────

function computeUnmappedArguments(
  anNodes: ArgumentNetworkNode[],
  allTaxonomyNodeIds: Set<string>,
): UnmappedArgument[] {
  const unmapped: UnmappedArgument[] = [];

  for (const node of anNodes) {
    // Skip system/document nodes — only care about agent arguments
    if (node.speaker === 'system' || node.speaker === 'document') continue;

    const hasRefs = node.taxonomy_refs && node.taxonomy_refs.length > 0;
    if (hasRefs) continue;

    // Determine gap type
    const speakerPov = SPEAKER_TO_POV[node.speaker] ?? '';
    const gapType = classifyGapType(node, speakerPov, allTaxonomyNodeIds);

    unmapped.push({
      an_node_id: node.id,
      text: truncate(node.text, 200),
      speaker: node.speaker,
      gap_type: gapType,
    });
  }

  return unmapped;
}

/** Classify the gap type for an unmapped AN node. */
function classifyGapType(
  node: ArgumentNetworkNode,
  speakerPov: string,
  allTaxonomyNodeIds: Set<string>,
): 'cross_cutting' | 'novel_argument' | 'refinement_needed' {
  // Check if the node text or ID references another POV's namespace
  const otherPovPrefixes = Object.entries(POV_TO_SPEAKER)
    .filter(([pov]) => pov !== speakerPov)
    .map(([pov]) => {
      // POV namespace prefixes: acc-, saf-, skp-
      if (pov === 'accelerationist') return 'acc-';
      if (pov === 'safetyist') return 'saf-';
      if (pov === 'skeptic') return 'skp-';
      return '';
    })
    .filter(Boolean);

  // Check if any part of the node text mentions concepts from other POV namespaces
  const textLower = node.text.toLowerCase();
  for (const prefix of otherPovPrefixes) {
    // Check if the text mentions node-ID-like references from other POVs
    if (textLower.includes(prefix)) return 'cross_cutting';
  }

  // Also check if none of the taxonomy node IDs are referenced at all — truly novel
  // Since we already know taxonomy_refs is empty, check if the node's text
  // doesn't even loosely relate to any taxonomy concept.
  // Without embeddings, we approximate: if the AN node has no taxonomy refs and
  // doesn't cross POV boundaries, it could be novel or needs refinement.
  // Use a simple heuristic: if the node was created in an early round, it's more
  // likely novel; later rounds are more likely refinements.
  if (node.turn_number <= 2) return 'novel_argument';
  return 'refinement_needed';
}

// ── Cross-POV Gaps computation ───────────────────────────────────────

function computeCrossPovGaps(
  transcript: TranscriptEntry[],
  taxonomyNodes: Record<string, TaxonomyNode[]>,
): CrossPovGap[] {
  const gaps: CrossPovGap[] = [];

  // Find synthesis entries
  const synthesisEntries = transcript.filter(e => e.type === 'synthesis');

  for (const entry of synthesisEntries) {
    const meta = entry.metadata as Record<string, unknown> | undefined;
    if (!meta) continue;

    // Extract areas of disagreement from synthesis metadata
    const disagreements = (meta.areas_of_disagreement ?? meta.disagreements ?? []) as Array<{
      point?: string;
      description?: string;
      positions?: Array<{ pover?: string; pov?: string; stance?: string }>;
      bdi_layer?: string;
    }>;

    for (const disagreement of disagreements) {
      const point = disagreement.point ?? disagreement.description ?? '';
      if (!point) continue;

      // For each POV, check if its taxonomy has nodes covering this topic
      for (const [pov, nodes] of Object.entries(taxonomyNodes)) {
        const hasCoverage = nodes.some(n => {
          const labelMatch = textContainsKeyTerms(n.label, point);
          const descMatch = n.description ? textContainsKeyTerms(n.description, point) : false;
          return labelMatch || descMatch;
        });

        if (!hasCoverage) {
          // Check if this POV was involved in the disagreement
          const positions = disagreement.positions ?? [];
          const povInvolved = positions.some(p => {
            const speaker = p.pover ?? p.pov ?? '';
            return speaker === pov || speaker === (POV_TO_SPEAKER[pov] ?? '');
          });

          // Only flag gaps for POVs that are involved in or affected by the disagreement
          if (povInvolved || positions.length === 0) {
            gaps.push({
              description: `No ${pov} taxonomy node addresses: "${truncate(point, 100)}"`,
              evidence_entries: [entry.id],
              suggested_bdi: disagreement.bdi_layer ?? 'belief',
              suggested_pov: pov,
            });
          }
        }
      }
    }
  }

  return gaps;
}

// ── Summary computation ──────────────────────────────────────────────

function computeSummary(
  povCoverage: Record<string, PovCoverage>,
  bdiBalance: Record<string, BdiBalance>,
  unmappedArguments: UnmappedArgument[],
  crossPovGaps: CrossPovGap[],
): GapSummary {
  // Overall coverage: average utilization rate across POVs
  const povs = Object.keys(povCoverage);
  let totalUtilization = 0;
  let minUtilization = Infinity;
  let mostUnderservedPov = '';

  for (const pov of povs) {
    const rate = povCoverage[pov].utilization_rate;
    totalUtilization += rate;
    if (rate < minUtilization) {
      minUtilization = rate;
      mostUnderservedPov = pov;
    }
  }

  const overallCoveragePct = povs.length > 0
    ? (totalUtilization / povs.length) * 100
    : 0;

  // Most underserved BDI: find the category across all POVs with lowest cited/total ratio
  let worstBdi = 'Beliefs';
  let worstBdiRatio = Infinity;
  for (const pov of povs) {
    const balance = bdiBalance[pov];
    if (!balance) continue;
    for (const cat of BDI_CATEGORIES) {
      const key = cat.toLowerCase() as 'beliefs' | 'desires' | 'intentions';
      const data = balance[key];
      if (data && data.node_count > 0) {
        const ratio = data.cited_count / data.node_count;
        if (ratio < worstBdiRatio) {
          worstBdiRatio = ratio;
          worstBdi = cat;
        }
      }
    }
  }

  // Build recommendation
  let recommendation: string;
  if (unmappedArguments.length > 5) {
    recommendation = `${unmappedArguments.length} arguments lack taxonomy grounding — consider expanding taxonomy coverage`;
  } else if (mostUnderservedPov && minUtilization < 0.3) {
    recommendation = `The ${mostUnderservedPov} taxonomy has low utilization (${Math.round(minUtilization * 100)}%) — consider revising node relevance or adding more targeted nodes`;
  } else if (crossPovGaps.length > 0) {
    recommendation = `${crossPovGaps.length} cross-POV gap(s) detected — taxonomy nodes may be missing for key disagreement points`;
  } else if (overallCoveragePct < 50) {
    recommendation = `Overall taxonomy coverage is ${Math.round(overallCoveragePct)}% — many injected nodes go unused`;
  } else {
    recommendation = 'Taxonomy coverage is adequate — no critical gaps detected';
  }

  return {
    overall_coverage_pct: Math.round(overallCoveragePct * 100) / 100,
    most_underserved_pov: mostUnderservedPov || 'none',
    most_underserved_bdi: worstBdi,
    unmapped_argument_count: unmappedArguments.length,
    cross_pov_gap_count: crossPovGaps.length,
    recommendation,
  };
}

// ── Main exported function ───────────────────────────────────────────

/**
 * Compute a deterministic taxonomy gap analysis from debate data.
 *
 * Analyzes per-POV coverage, BDI balance, unmapped arguments, and cross-POV
 * gaps using only the transcript, argument network, taxonomy, and context
 * manifests. No LLM calls — all computation is pure and deterministic.
 */
export function computeTaxonomyGapAnalysis(
  transcript: TranscriptEntry[],
  anNodes: ArgumentNetworkNode[],
  taxonomyNodes: Record<string, TaxonomyNode[]>,
  contextManifests: ContextManifestEntry[],
): TaxonomyGapAnalysis {
  const povs = Object.keys(taxonomyNodes);

  // 1. Per-POV coverage
  const povCoverage: Record<string, PovCoverage> = {};
  for (const pov of povs) {
    povCoverage[pov] = computePovCoverage(
      pov,
      taxonomyNodes[pov] ?? [],
      contextManifests,
      transcript,
    );
  }

  // Build a global set of referenced node IDs per POV (for BDI balance)
  const referencedByPov: Record<string, Set<string>> = {};
  for (const pov of povs) {
    const speaker = POV_TO_SPEAKER[pov] ?? pov;
    const povManifests = contextManifests.filter(m => m.pov === pov);
    const refs = new Set<string>();
    for (const m of povManifests) {
      for (const id of m.referenced_node_ids) refs.add(id);
    }
    for (const entry of transcript) {
      if (entry.speaker === speaker) {
        for (const nodeId of extractRefNodeIds(entry)) refs.add(nodeId);
      }
    }
    referencedByPov[pov] = refs;
  }

  // 2. BDI balance
  const bdiBalance: Record<string, BdiBalance> = {};
  for (const pov of povs) {
    bdiBalance[pov] = computeBdiBalance(
      pov,
      taxonomyNodes[pov] ?? [],
      anNodes,
      referencedByPov[pov] ?? new Set(),
    );
  }

  // 3. Unmapped arguments
  const allTaxonomyNodeIds = new Set<string>();
  for (const nodes of Object.values(taxonomyNodes)) {
    for (const n of nodes) allTaxonomyNodeIds.add(n.id);
  }
  const unmappedArguments = computeUnmappedArguments(anNodes, allTaxonomyNodeIds);

  // 4. Cross-POV gaps
  const crossPovGaps = computeCrossPovGaps(transcript, taxonomyNodes);

  // 5. Summary
  const summary = computeSummary(povCoverage, bdiBalance, unmappedArguments, crossPovGaps);

  return {
    pov_coverage: povCoverage,
    bdi_balance: bdiBalance,
    unmapped_arguments: unmappedArguments,
    cross_pov_gaps: crossPovGaps,
    summary,
  };
}
