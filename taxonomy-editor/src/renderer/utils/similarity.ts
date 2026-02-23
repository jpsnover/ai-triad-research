export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

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
