import { cosineSimilarity } from './taxonomyRelevance.js';
import type { ArgumentNetworkNode } from './types.js';

export const EXCLUSION_RATIO_THRESHOLD = 0.95;
export const SCOPE_BOUNDARY_THRESHOLD = 0.65;

export interface ExclusionDemotion {
  node_id: string;
  similarity_main: number;
  similarity_exclusion: number;
  ratio: number;
}

export interface ExclusionFilterResult {
  passed: string[];
  demoted: ExclusionDemotion[];
}

export interface ExclusionViolation {
  claim_id: string;
  claim_text: string;
  node_id: string;
  similarity_main: number;
  similarity_exclusion: number;
}

export interface ScopeDriftWarning {
  debater: string;
  node_id: string;
  similarity: number;
  draft_excerpt: string;
}

type NodeEmbeddingEntry = { pov: string; vector: number[]; exclusion_vector?: number[] };

export function checkClaimExclusionBoundary(
  nodes: readonly ArgumentNetworkNode[],
  nodeEmbeddings: Record<string, NodeEmbeddingEntry>,
  threshold = EXCLUSION_RATIO_THRESHOLD,
): ExclusionViolation[] {
  const violations: ExclusionViolation[] = [];

  for (const node of nodes) {
    if (!node.embedding) continue;
    const primaryRef = node.claim_taxonomy_attribution?.primary_ref;
    if (!primaryRef) continue;

    const entry = nodeEmbeddings[primaryRef];
    if (!entry?.exclusion_vector) continue;

    const simMain = cosineSimilarity(node.embedding, entry.vector);
    const simExcl = cosineSimilarity(node.embedding, entry.exclusion_vector);

    if (simExcl > simMain * threshold) {
      violations.push({
        claim_id: node.id,
        claim_text: node.text,
        node_id: primaryRef,
        similarity_main: simMain,
        similarity_exclusion: simExcl,
      });
    }
  }

  return violations;
}

export function checkDraftScopeBoundary(
  draftEmbedding: number[],
  taxonomyRefIds: readonly string[],
  nodeEmbeddings: Record<string, NodeEmbeddingEntry>,
  debater: string,
  draftText: string,
  threshold = SCOPE_BOUNDARY_THRESHOLD,
): ScopeDriftWarning[] {
  const warnings: ScopeDriftWarning[] = [];

  for (const nodeId of taxonomyRefIds) {
    const entry = nodeEmbeddings[nodeId];
    if (!entry?.exclusion_vector) continue;

    const sim = cosineSimilarity(draftEmbedding, entry.exclusion_vector);
    if (sim > threshold) {
      warnings.push({
        debater,
        node_id: nodeId,
        similarity: sim,
        draft_excerpt: draftText.slice(0, 200),
      });
    }
  }

  return warnings;
}

export interface SituationExclusionResult {
  passed: string[];
  skipped: { node_id: string; similarity_exclusion: number }[];
}

export function filterByExclusionAbsolute(
  candidateNodeIds: readonly string[],
  queryVector: number[],
  nodeEmbeddings: Record<string, { pov: string; vector: number[]; exclusion_vector?: number[] }>,
  threshold = SCOPE_BOUNDARY_THRESHOLD,
): SituationExclusionResult {
  const passed: string[] = [];
  const skipped: { node_id: string; similarity_exclusion: number }[] = [];

  for (const nodeId of candidateNodeIds) {
    const entry = nodeEmbeddings[nodeId];
    if (!entry?.exclusion_vector) {
      passed.push(nodeId);
      continue;
    }

    const simExcl = cosineSimilarity(queryVector, entry.exclusion_vector);
    if (simExcl > threshold) {
      skipped.push({ node_id: nodeId, similarity_exclusion: simExcl });
    } else {
      passed.push(nodeId);
    }
  }

  return { passed, skipped };
}

export function filterByExclusionRatio(
  candidateNodeIds: readonly string[],
  queryVector: number[],
  nodeEmbeddings: Record<string, { pov: string; vector: number[]; exclusion_vector?: number[] }>,
  threshold = EXCLUSION_RATIO_THRESHOLD,
): ExclusionFilterResult {
  const passed: string[] = [];
  const demoted: ExclusionDemotion[] = [];

  for (const nodeId of candidateNodeIds) {
    const entry = nodeEmbeddings[nodeId];
    if (!entry?.exclusion_vector) {
      passed.push(nodeId);
      continue;
    }

    const simMain = cosineSimilarity(queryVector, entry.vector);
    const simExcl = cosineSimilarity(queryVector, entry.exclusion_vector);

    if (simExcl > simMain * threshold) {
      demoted.push({ node_id: nodeId, similarity_main: simMain, similarity_exclusion: simExcl, ratio: simExcl / simMain });
    } else {
      passed.push(nodeId);
    }
  }

  return { passed, demoted };
}
