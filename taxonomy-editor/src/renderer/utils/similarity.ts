// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { cosineSimilarity } from '@lib/embeddings/similarity';

export { cosineSimilarity };

export interface SemanticResult {
  id: string;
  score: number;
}

export function rankBySimilarity(
  queryVector: number[],
  cache: Map<string, number[]>,
  threshold: number,
  maxResults: number,
): SemanticResult[] {
  const scored: SemanticResult[] = [];
  for (const [id, vector] of cache) {
    const score = cosineSimilarity(queryVector, vector);
    if (score >= threshold) {
      scored.push({ id, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}
