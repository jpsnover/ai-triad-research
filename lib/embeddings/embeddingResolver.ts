import type { EmbeddingsFile } from '../electron-shared/embeddingIO.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';

export interface EmbeddingFallback {
  name: string;
  compute: (texts: string[], ids?: string[]) => Promise<number[][]>;
}

export async function resolveEmbeddings(
  texts: string[],
  ids: string[] | undefined,
  localData: EmbeddingsFile | null,
  fallbackChain: EmbeddingFallback[],
): Promise<number[][]> {
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const missingIndices: number[] = [];

  if (ids && localData) {
    for (let i = 0; i < texts.length; i++) {
      const nodeId = ids[i];
      if (nodeId && localData.nodes[nodeId]) {
        results[i] = localData.nodes[nodeId].vector;
      } else {
        missingIndices.push(i);
      }
    }
  } else {
    for (let i = 0; i < texts.length; i++) {
      missingIndices.push(i);
    }
  }

  if (missingIndices.length > 0) {
    const missingTexts = missingIndices.map(i => texts[i]);
    const missingIds = ids ? missingIndices.map(i => ids[i]) : undefined;
    let computed: number[][] | null = null;

    for (const fallback of fallbackChain) {
      try {
        computed = await fallback.compute(missingTexts, missingIds);
        break;
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'ai.fallback',
          component: 'embedding-resolver',
          level: 'warn',
          message: `Embedding fallback "${fallback.name}" failed, trying next`,
          error: { name: (err as Error).name ?? 'Error', message: String(err) },
        });
      }
    }

    if (!computed) {
      const tried = fallbackChain.map(f => f.name).join(', ');
      throw new Error(`All embedding fallbacks failed (tried: ${tried})`);
    }

    for (let j = 0; j < missingIndices.length; j++) {
      results[missingIndices[j]] = computed[j];
    }
  }

  return results as number[][];
}
