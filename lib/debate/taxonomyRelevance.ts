// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Compute relevance scores for taxonomy nodes against a debate context.
 * Uses embedding cosine similarity to select the most relevant nodes
 * for each debater's prompt.
 */

import type { PovNode, SituationNode } from './taxonomyTypes';

export interface NodeRelevanceScore {
  nodeId: string;
  score: number;
}

export interface ScoredPovNode {
  node: PovNode;
  score: number;
}

export interface ScoredSituationNode {
  node: SituationNode;
  score: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Compute relevance scores for all nodes against a query embedding.
 * Returns a Map of nodeId → similarity score.
 */
export function scoreNodeRelevance(
  queryVector: number[],
  nodeEmbeddings: Record<string, { pov: string; vector: number[] }>,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const [nodeId, entry] of Object.entries(nodeEmbeddings)) {
    if (entry.vector && Array.isArray(entry.vector)) {
      scores.set(nodeId, cosineSimilarity(queryVector, entry.vector));
    }
  }
  return scores;
}

/**
 * Select relevant POV nodes for a debate based on similarity threshold.
 * Includes all nodes above the threshold, sorted by relevance.
 * A minimum of 3 per category is guaranteed even if below threshold.
 */
export function selectRelevantNodes(
  povNodes: PovNode[],
  scores: Map<string, number>,
  threshold: number = 0.45,
  minPerCategory: number = 3,
  maxTotal?: number,
): ScoredPovNode[] {
  // Group by category
  const groups: Record<string, ScoredPovNode[]> = {
    'Beliefs': [],
    'Desires': [],
    'Intentions': [],
  };

  for (const node of povNodes) {
    const cat = node.category || 'Intentions';
    const score = scores.get(node.id) || 0;
    (groups[cat] ?? groups['Intentions']).push({ node, score });
  }

  // For each category: include all above threshold, guarantee minimum
  const result: ScoredPovNode[] = [];
  for (const cat of ['Beliefs', 'Desires', 'Intentions']) {
    const sorted = groups[cat].sort((a, b) => b.score - a.score);
    const aboveThreshold = sorted.filter(s => s.score >= threshold);
    // Take at least minPerCategory, even if below threshold
    const selected = aboveThreshold.length >= minPerCategory
      ? aboveThreshold
      : sorted.slice(0, Math.max(minPerCategory, aboveThreshold.length));
    result.push(...selected);
  }

  return maxTotal != null ? result.slice(0, maxTotal) : result;
}

/**
 * Select relevant situation nodes based on similarity threshold.
 */
export function selectRelevantSituationNodes(
  situationNodes: SituationNode[],
  scores: Map<string, number>,
  threshold: number = 0.45,
  min: number = 3,
  max: number = 15,
): ScoredSituationNode[] {
  const scored = situationNodes
    .map(n => ({ node: n, score: scores.get(n.id) || 0 }))
    .sort((a, b) => b.score - a.score);

  const aboveThreshold = scored.filter(s => s.score >= threshold);
  const selected = aboveThreshold.length >= min
    ? aboveThreshold
    : scored.slice(0, Math.max(min, aboveThreshold.length));

  return selected.slice(0, max);
}

/**
 * Build a query string from the debate context for embedding.
 * Combines topic + recent transcript for relevance scoring.
 */
export function buildRelevanceQuery(
  topic: string,
  recentTranscript: string,
  maxLength: number = 500,
): string {
  const combined = `${topic}\n\n${recentTranscript}`;
  return combined.length > maxLength ? combined.slice(0, maxLength) : combined;
}
