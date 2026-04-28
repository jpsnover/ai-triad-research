export type {
  TranslationConfidence,
  TranslationMethod,
  PhraseMatch,
  SenseSignal,
  TranslationRecord,
  TranslationResult,
  PipelineConfigSnapshot,
  OccurrenceLocation,
  EnsembleConfig,
  RoutingConfig,
  LlmFallbackConfig,
  TranslationPipelineConfig,
  ResolvedOccurrence,
} from './types';

export { locateOccurrences } from './locator';
export { resolveWithEnsemble } from './ensemble';
export { resolveFallback, buildFallbackPrompt } from './llmFallback';
export type { LlmAdapter } from './llmFallback';
export { translateDocument } from './pipeline';
export type { TranslationPipelineOptions } from './pipeline';
export { tokenSortRatio, jaccardSimilarity, levenshteinRatio } from './phraseMatch';
