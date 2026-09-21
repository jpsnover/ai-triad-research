import type { EmbeddingsFile } from '../electron-shared/embeddingIO.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';
import { ActionableError } from '../debate/errors.js';

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

    getGlobalRecorder()?.record({
      type: 'ai.request',
      component: 'embedding-resolver',
      level: 'info',
      message: 'computing embeddings',
      data: { chainMembers: fallbackChain.map(f => f.name) },
    });

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
          data: { chainMembers: fallbackChain.map(f => f.name) },
          error: { name: (err as Error).name ?? 'Error', message: String(err) },
        });
      }
    }

    if (!computed) {
      // Every backend in the chain failed. Fail with an ActionableError (not a bare throw) so the
      // upstream catch/triage doesn't misattribute this to an unrelated cause (e.g. "ONNX init
      // failure"): the real cause is chain exhaustion, and each member's specific failure is in the
      // ai.fallback WARN records emitted above. (e/134 #3; root AGENTS.md error-handling convention.)
      const tried = fallbackChain.length ? fallbackChain.map(f => f.name).join(', ') : '(empty chain)';
      throw new ActionableError({
        goal: 'Resolve embeddings for the requested texts',
        problem: `All embedding fallbacks failed (tried: ${tried})`,
        location: 'lib/embeddings/embeddingResolver.ts resolveEmbeddings',
        nextSteps: [
          'Inspect the ai.fallback WARN records above for each backend’s specific failure',
          'Ensure at least one embedding backend is available: provision the ONNX model, install Python sentence-transformers, or set a Gemini API key',
          'Retry once a backend is restored',
        ],
      });
    }

    for (let j = 0; j < missingIndices.length; j++) {
      results[missingIndices[j]] = computed[j];
    }
  }

  return results as number[][];
}
