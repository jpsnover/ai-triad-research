// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Compute relevance scores for taxonomy nodes against a debate context.
 * Uses embedding cosine similarity to select the most relevant nodes
 * for each debater's prompt.
 */

import type { PovNode, CrossCuttingNode } from '../types/taxonomy';

export interface NodeRelevanceScore {
  nodeId: string;
  score: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
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
 * Select the most relevant POV nodes for a debate, sorted by relevance.
 * Returns up to maxPerCategory nodes per BDI category.
 */
export function selectRelevantNodes(
  povNodes: PovNode[],
  scores: Map<string, number>,
  maxPerCategory: number = 7,
): PovNode[] {
  // Group by category
  const groups: Record<string, { node: PovNode; score: number }[]> = {
    'Data/Facts': [],
    'Goals/Values': [],
    'Methods/Arguments': [],
  };

  for (const node of povNodes) {
    const cat = node.category || 'Methods/Arguments';
    const score = scores.get(node.id) || 0;
    (groups[cat] ?? groups['Methods/Arguments']).push({ node, score });
  }

  // Sort each category by relevance and take top N
  const result: PovNode[] = [];
  for (const cat of ['Data/Facts', 'Goals/Values', 'Methods/Arguments']) {
    const sorted = groups[cat].sort((a, b) => b.score - a.score);
    result.push(...sorted.slice(0, maxPerCategory).map(s => s.node));
  }

  return result;
}

/**
 * Select the most relevant cross-cutting nodes.
 */
export function selectRelevantCCNodes(
  ccNodes: CrossCuttingNode[],
  scores: Map<string, number>,
  max: number = 10,
): CrossCuttingNode[] {
  return ccNodes
    .map(n => ({ node: n, score: scores.get(n.id) || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(s => s.node);
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
