import type { StandardizedTerm, SenseEmbeddingEntry } from '../dictionary/types';
import type { OccurrenceLocation, EnsembleConfig, SenseSignal, ResolvedOccurrence, RoutingConfig } from './types';
import { tokenSortRatio, jaccardSimilarity, levenshteinRatio } from './phraseMatch';

export interface EnsembleInput {
  occurrence: OccurrenceLocation;
  candidateSenses: StandardizedTerm[];
  senseEmbeddings: Map<string, SenseEmbeddingEntry>;
  contextEmbedding: number[] | null;
  config: EnsembleConfig;
  routing: RoutingConfig;
}

export interface EnsembleOutput {
  signals: Record<string, SenseSignal>;
  resolved_to: string | null;
  confidence: 'high' | 'ambiguous';
  margin: number;
  needs_fallback: boolean;
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
  return denom === 0 ? 0 : dot / denom;
}

function getPhraseMatcher(fn: EnsembleConfig['phrase_match_function']): (a: string, b: string) => number {
  switch (fn) {
    case 'token_sort_ratio': return tokenSortRatio;
    case 'jaccard': return jaccardSimilarity;
    case 'levenshtein': return levenshteinRatio;
  }
}

function computePhraseSignal(
  contextText: string,
  phrases: string[],
  config: EnsembleConfig,
): { signal: number; matches: Array<{ phrase: string; score: number }> } {
  const matcher = getPhraseMatcher(config.phrase_match_function);
  const matches: Array<{ phrase: string; score: number }> = [];

  for (const phrase of phrases) {
    const score = matcher(phrase, contextText);
    if (score >= config.phrase_noise_floor) {
      matches.push({ phrase, score });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  let signal: number;
  switch (config.phrase_aggregation) {
    case 'top_k_sum': {
      const topK = matches.slice(0, config.phrase_top_k);
      signal = Math.min(1.0, topK.reduce((s, m) => s + m.score, 0));
      break;
    }
    case 'mean': {
      signal = matches.length > 0
        ? matches.reduce((s, m) => s + m.score, 0) / matches.length
        : 0;
      break;
    }
    case 'max': {
      signal = matches.length > 0 ? matches[0].score : 0;
      break;
    }
  }

  return { signal, matches };
}

export function resolveWithEnsemble(input: EnsembleInput): EnsembleOutput {
  const { occurrence, candidateSenses, senseEmbeddings, contextEmbedding, config, routing } = input;

  const contextText = `${occurrence.context_before} ${occurrence.colloquial_term} ${occurrence.context_after}`;
  const signals: Record<string, SenseSignal> = {};

  for (const sense of candidateSenses) {
    const senseEmb = senseEmbeddings.get(sense.canonical_form);

    const embSim = (contextEmbedding && senseEmb)
      ? Math.max(0, cosineSimilarity(contextEmbedding, senseEmb.embedding))
      : 0;

    const { signal: phraseSignal, matches } = computePhraseSignal(
      contextText,
      sense.characteristic_phrases,
      config,
    );

    const combined = config.w_e * embSim + config.w_p * phraseSignal;

    signals[sense.canonical_form] = {
      embedding_similarity: round4(embSim),
      phrase_signal: round4(phraseSignal),
      phrase_matches: matches.map(m => ({ phrase: m.phrase, score: round4(m.score) })),
      combined_score: round4(combined),
    };
  }

  const sorted = Object.entries(signals).sort((a, b) => b[1].combined_score - a[1].combined_score);

  if (sorted.length === 0) {
    return { signals, resolved_to: null, confidence: 'ambiguous', margin: 0, needs_fallback: true };
  }

  const topScore = sorted[0][1].combined_score;
  const runnerUp = sorted.length > 1 ? sorted[1][1].combined_score : 0;
  const margin = round4(topScore - runnerUp);

  const meetsThreshold = topScore >= routing.top_score_threshold && margin >= routing.margin_threshold;

  if (meetsThreshold) {
    return {
      signals,
      resolved_to: sorted[0][0],
      confidence: 'high',
      margin,
      needs_fallback: false,
    };
  }

  return {
    signals,
    resolved_to: null,
    confidence: 'ambiguous',
    margin,
    needs_fallback: true,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
