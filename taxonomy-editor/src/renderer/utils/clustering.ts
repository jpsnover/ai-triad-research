// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { cosineSimilarity } from './similarity';
import { clusterLabelPrompt } from '../prompts/analysis';

export interface Cluster {
  label: string;
  nodeIds: string[];
}

/**
 * Agglomerative clustering of nodes based on embedding similarity.
 * Merges closest pairs until all intra-cluster similarity drops below threshold.
 */
export function clusterByEmbedding(
  nodeIds: string[],
  embeddingCache: Map<string, number[]>,
  maxClusters: number = 6,
  minClusterSim: number = 0.55,
): string[][] {
  // Filter to nodes that have embeddings
  const ids = nodeIds.filter(id => embeddingCache.has(id));
  if (ids.length === 0) return [];

  // Start: each node is its own cluster
  let clusters: string[][] = ids.map(id => [id]);

  // Precompute pairwise similarities
  const simCache = new Map<string, number>();
  const simKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const getSim = (a: string, b: string): number => {
    const key = simKey(a, b);
    if (simCache.has(key)) return simCache.get(key)!;
    const va = embeddingCache.get(a);
    const vb = embeddingCache.get(b);
    if (!va || !vb) return 0;
    const s = cosineSimilarity(va, vb);
    simCache.set(key, s);
    return s;
  };

  // Average-linkage similarity between two clusters
  const clusterSim = (c1: string[], c2: string[]): number => {
    let total = 0;
    for (const a of c1) {
      for (const b of c2) {
        total += getSim(a, b);
      }
    }
    return total / (c1.length * c2.length);
  };

  // Merge until we reach max clusters or similarity is too low
  while (clusters.length > maxClusters) {
    let bestSim = -1;
    let bestI = 0;
    let bestJ = 1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const s = clusterSim(clusters[i], clusters[j]);
        if (s > bestSim) {
          bestSim = s;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestSim < minClusterSim) break;

    // Merge bestJ into bestI
    clusters[bestI] = [...clusters[bestI], ...clusters[bestJ]];
    clusters.splice(bestJ, 1);
  }

  return clusters;
}

/**
 * Builds the prompt for Gemini to label clusters.
 */
export function buildClusterLabelPrompt(
  clusters: { nodeIds: string[]; labels: string[] }[],
): string {
  return clusterLabelPrompt(clusters);
}
