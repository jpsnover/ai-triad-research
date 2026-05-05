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
 *
 * Default maxClusters=6 is intentionally lower than the canonical 10 (used by
 * Get-EmbeddingClusters.ps1 and compute-conflict-clusters.mjs) because this
 * runs in the UI where fewer clusters produce a cleaner visual layout. Callers
 * may pass a higher value when appropriate.
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
 * Partition a cluster into two opposing sides using NLI pairwise labels.
 *
 * Builds an undirected graph where contradiction edges connect opposing nodes.
 * Attempts greedy 2-coloring: pick an uncolored node, color it A, then color
 * its contradiction neighbors B, and so on (BFS). Entailment edges reinforce
 * same-side assignment. If the graph has conflicts (odd cycles), returns null.
 *
 * @param nodeIds    IDs of nodes in the cluster
 * @param pairLabels Array of { idA, idB, label } for each classified pair
 * @returns [sideA, sideB] arrays, or null if not cleanly bipartite
 */
export function partitionBipartite(
  nodeIds: string[],
  pairLabels: Array<{ idA: string; idB: string; label: string }>,
): [string[], string[]] | null {
  if (nodeIds.length < 2) return null;

  // Build adjacency: nodeId → [{neighbor, sameOrOpposite}]
  const adj = new Map<string, Array<{ neighbor: string; same: boolean }>>();
  for (const id of nodeIds) adj.set(id, []);

  for (const p of pairLabels) {
    if (!adj.has(p.idA) || !adj.has(p.idB)) continue;
    const same = p.label === 'entailment' || p.label === 'neutral';
    adj.get(p.idA)!.push({ neighbor: p.idB, same });
    adj.get(p.idB)!.push({ neighbor: p.idA, same });
  }

  // BFS 2-coloring
  const color = new Map<string, 0 | 1>();
  let conflict = false;

  for (const startId of nodeIds) {
    if (color.has(startId)) continue;
    color.set(startId, 0);
    const queue = [startId];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const currColor = color.get(curr)!;

      for (const edge of adj.get(curr) || []) {
        const expectedColor: 0 | 1 = edge.same ? currColor : (1 - currColor) as 0 | 1;
        if (color.has(edge.neighbor)) {
          if (color.get(edge.neighbor) !== expectedColor) {
            conflict = true;
          }
        } else {
          color.set(edge.neighbor, expectedColor);
          queue.push(edge.neighbor);
        }
      }
    }
  }

  if (conflict) return null;

  const sideA = nodeIds.filter(id => color.get(id) === 0);
  const sideB = nodeIds.filter(id => color.get(id) === 1);

  // Only meaningful if both sides are non-empty
  if (sideA.length === 0 || sideB.length === 0) return null;

  return [sideA, sideB];
}

/**
 * Builds the prompt for Gemini to label clusters.
 */
export function buildClusterLabelPrompt(
  clusters: { nodeIds: string[]; labels: string[] }[],
): string {
  return clusterLabelPrompt(clusters);
}
