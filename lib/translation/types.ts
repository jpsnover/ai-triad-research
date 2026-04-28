export type TranslationConfidence = 'high' | 'medium' | 'ambiguous';
export type TranslationMethod = 'local_ensemble' | 'llm_assisted';

export interface PhraseMatch {
  phrase: string;
  score: number;
}

export interface SenseSignal {
  embedding_similarity: number;
  phrase_signal: number;
  phrase_matches: PhraseMatch[];
  combined_score: number;
}

export interface TranslationRecord {
  occurrence_id: string;
  colloquial_term: string;
  resolved_to: string | null;
  confidence: TranslationConfidence;
  method: TranslationMethod;
  signals: Record<string, SenseSignal>;
  weights: { w_e: number; w_p: number };
  margin: number;
  rationale: string | null;
  fallback_invoked: boolean;
  model: string | null;
  offset: number;
  context_before: string;
  context_after: string;
  translated_at: string;
  dictionary_version: string;
}

export interface TranslationResult {
  document_id: string;
  records: TranslationRecord[];
  summary: {
    total_occurrences: number;
    resolved_high: number;
    resolved_medium: number;
    ambiguous: number;
    local_resolved: number;
    llm_resolved: number;
  };
  translated_at: string;
  dictionary_version: string;
  pipeline_config: PipelineConfigSnapshot;
}

export interface PipelineConfigSnapshot {
  w_e: number;
  w_p: number;
  top_score_threshold: number;
  margin_threshold: number;
  phrase_noise_floor: number;
  phrase_aggregation: string;
  phrase_top_k: number;
  llm_fallback_enabled: boolean;
  llm_model: string | null;
}

export interface OccurrenceLocation {
  colloquial_term: string;
  offset: number;
  length: number;
  context_before: string;
  context_after: string;
  section_heading?: string;
}

export interface EnsembleConfig {
  w_e: number;
  w_p: number;
  phrase_match_function: 'token_sort_ratio' | 'jaccard' | 'levenshtein';
  phrase_noise_floor: number;
  phrase_aggregation: 'top_k_sum' | 'mean' | 'max';
  phrase_top_k: number;
}

export interface RoutingConfig {
  top_score_threshold: number;
  margin_threshold: number;
  context_window_tokens: number;
}

export interface LlmFallbackConfig {
  enabled: boolean;
  provider: string;
  model: string;
  endpoint: string | null;
  fallback_context_tokens: number;
  max_retries: number;
  timeout_seconds: number;
  max_candidate_senses: number;
}

export interface TranslationPipelineConfig {
  ensemble: EnsembleConfig;
  routing: RoutingConfig;
  llm_fallback: LlmFallbackConfig;
}

export interface ResolvedOccurrence extends OccurrenceLocation {
  occurrence_id: string;
  signals: Record<string, SenseSignal>;
  resolved_to: string | null;
  confidence: TranslationConfidence;
  method: TranslationMethod;
  margin: number;
  rationale: string | null;
  model: string | null;
}
