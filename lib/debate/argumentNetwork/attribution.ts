// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ── Per-claim taxonomy attribution (t/110) ──────────────

import type { ArgumentNetworkNode, ClaimTaxonomyAttribution } from '../types.js';
import { cosineSimilarity, scoreNodeRelevanceMeanTopN } from '../taxonomyRelevance.js';

/** Thresholds per spec: primary ≥ 0.35, secondary ≥ 0.40. */
const ATTRIBUTION_PRIMARY_THRESHOLD = 0.35;
const ATTRIBUTION_SECONDARY_THRESHOLD = 0.40;

export interface ClaimAttributionResult {
  attributed: number;
  unattributed: number;
  missing_embedding: number;
  novel_argument: number;
  decisions: ClaimAttributionDecision[];
}

export interface ClaimAttributionDecision {
  claim_id: string;
  primary_ref: string | null;
  attribution_confidence: number;
  secondary_refs_count: number;
  unattributed_reason?: 'novel_argument' | 'no_embedding';
}

/**
 * Compute per-claim taxonomy attribution for AN nodes.
 * Compares each claim's attribution_embedding (or embedding fallback) against
 * same-POV taxonomy node embeddings using cosine similarity.
 * Mutates nodes in place (sets claim_taxonomy_attribution).
 *
 * @param nodes - AN nodes to attribute (typically newly extracted nodes)
 * @param speakerPov - The POV key for the speaker (e.g. 'accelerationist')
 * @param nodeEmbeddings - Taxonomy node embeddings keyed by node ID
 * @param candidateNodeIds - Set of taxonomy node IDs eligible for attribution (all BDI categories)
 * @param topN - Number of top vectors for mean-of-top-N multi-vector scoring
 * @returns Attribution summary for diagnostics
 */
export function computeClaimTaxonomyAttribution(
  nodes: ArgumentNetworkNode[],
  speakerPov: string,
  nodeEmbeddings: Record<string, { pov: string; vector: number[]; vectors?: number[][] }>,
  candidateNodeIds: Set<string>,
  topN: number = 3,
): ClaimAttributionResult {
  const decisions: ClaimAttributionDecision[] = [];
  let attributed = 0;
  let unattributed = 0;
  let missingEmbedding = 0;
  let novelArgument = 0;

  // Pre-filter: same-POV nodes with embeddings (all BDI categories)
  const candidateEntries: [string, { vector: number[]; vectors?: number[][] }][] = [];
  for (const [nodeId, entry] of Object.entries(nodeEmbeddings)) {
    if (entry.pov === speakerPov && candidateNodeIds.has(nodeId) && entry.vector?.length > 0) {
      candidateEntries.push([nodeId, { vector: entry.vector, vectors: entry.vectors }]);
    }
  }
  const hasMultiVector = candidateEntries.some(([, e]) => e.vectors && e.vectors.length > 0);

  for (const node of nodes) {
    const queryVector = node.attribution_embedding ?? node.embedding;
    if (!queryVector || queryVector.length === 0) {
      const attribution: ClaimTaxonomyAttribution = {
        primary_ref: '',
        attribution_confidence: 0,
        unattributed_reason: 'no_embedding',
      };
      node.claim_taxonomy_attribution = attribution;
      missingEmbedding++;
      unattributed++;
      decisions.push({
        claim_id: node.id,
        primary_ref: null,
        attribution_confidence: 0,
        secondary_refs_count: 0,
        unattributed_reason: 'no_embedding',
      });
      continue;
    }

    if (candidateEntries.length === 0) {
      const attribution: ClaimTaxonomyAttribution = {
        primary_ref: '',
        attribution_confidence: 0,
        unattributed_reason: 'no_embedding',
      };
      node.claim_taxonomy_attribution = attribution;
      missingEmbedding++;
      unattributed++;
      decisions.push({
        claim_id: node.id,
        primary_ref: null,
        attribution_confidence: 0,
        secondary_refs_count: 0,
        unattributed_reason: 'no_embedding',
      });
      continue;
    }

    // Compute similarity against all candidate nodes
    const similarities: { node_id: string; similarity: number }[] = [];
    if (hasMultiVector) {
      // Mean-of-top-3: build a single-node embeddings map per candidate and score
      const candidateMap: Record<string, { pov: string; vector: number[]; vectors?: number[][] }> = {};
      for (const [nodeId, entry] of candidateEntries) {
        candidateMap[nodeId] = { pov: speakerPov, vector: entry.vector, vectors: entry.vectors };
      }
      const meanScores = scoreNodeRelevanceMeanTopN(queryVector, candidateMap, topN);
      for (const [nodeId, sim] of meanScores) {
        similarities.push({ node_id: nodeId, similarity: sim });
      }
    } else {
      for (const [nodeId, entry] of candidateEntries) {
        const sim = cosineSimilarity(queryVector, entry.vector);
        similarities.push({ node_id: nodeId, similarity: sim });
      }
    }

    // Sort descending by similarity
    similarities.sort((a, b) => b.similarity - a.similarity);

    const best = similarities[0];

    if (best.similarity < ATTRIBUTION_PRIMARY_THRESHOLD) {
      // Unattributed — novel argument
      const attribution: ClaimTaxonomyAttribution = {
        primary_ref: '',
        attribution_confidence: best.similarity,
        unattributed_reason: 'novel_argument',
      };
      node.claim_taxonomy_attribution = attribution;
      novelArgument++;
      unattributed++;
      decisions.push({
        claim_id: node.id,
        primary_ref: null,
        attribution_confidence: best.similarity,
        secondary_refs_count: 0,
        unattributed_reason: 'novel_argument',
      });
      continue;
    }

    // Attributed — primary ref is the best match
    const secondaryRefs = similarities
      .slice(1)
      .filter(s => s.similarity >= ATTRIBUTION_SECONDARY_THRESHOLD);

    const attribution: ClaimTaxonomyAttribution = {
      primary_ref: best.node_id,
      attribution_confidence: best.similarity,
    };
    if (secondaryRefs.length > 0) {
      attribution.secondary_refs = secondaryRefs;
    }
    node.claim_taxonomy_attribution = attribution;
    attributed++;
    decisions.push({
      claim_id: node.id,
      primary_ref: best.node_id,
      attribution_confidence: best.similarity,
      secondary_refs_count: secondaryRefs.length,
    });
  }

  return { attributed, unattributed, missing_embedding: missingEmbedding, novel_argument: novelArgument, decisions };
}
