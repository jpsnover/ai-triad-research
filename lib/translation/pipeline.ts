import type { DictionaryLoader } from '../dictionary/loader';
import type { SenseEmbeddingsFile } from '../dictionary/types';
import type {
  TranslationPipelineConfig,
  TranslationRecord,
  TranslationResult,
  PipelineConfigSnapshot,
  ResolvedOccurrence,
  OccurrenceLocation,
} from './types';
import { locateOccurrences } from './locator';
import { resolveWithEnsemble } from './ensemble';
import { resolveFallback, type LlmAdapter } from './llmFallback';

export interface TranslationPipelineOptions {
  config: TranslationPipelineConfig;
  loader: DictionaryLoader;
  senseEmbeddings: SenseEmbeddingsFile;
  adapter?: LlmAdapter;
  embedContext?: (text: string) => Promise<number[]>;
  documentId?: string;
  onProgress?: (msg: string) => void;
}

export async function translateDocument(
  text: string,
  options: TranslationPipelineOptions,
): Promise<TranslationResult> {
  const { config, loader, senseEmbeddings, adapter, embedContext, documentId, onProgress } = options;
  const colloquialTerms = loader.listColloquial({ status: 'do_not_use_bare' });

  onProgress?.(`Stage 1: Locating occurrences of ${colloquialTerms.length} colloquial terms...`);
  const occurrences = locateOccurrences(text, colloquialTerms, config.routing.context_window_tokens * 4);

  if (occurrences.length === 0) {
    return buildResult([], documentId ?? 'unknown', config, loader);
  }

  onProgress?.(`Stage 1 found ${occurrences.length} occurrences. Starting Stage 2 resolution...`);

  const resolved: ResolvedOccurrence[] = [];
  const needsFallback: Array<{ occurrence: OccurrenceLocation; signals: Record<string, import('./types').SenseSignal> }> = [];
  const embeddingMap = new Map(
    Object.entries(senseEmbeddings.entries).map(([k, v]) => [k, v]),
  );

  for (const occ of occurrences) {
    const colloquial = loader.getColloquial(occ.colloquial_term);
    if (!colloquial) continue;

    const candidateCanonicals = colloquial.resolves_to.map(r => r.standardized_term);
    const candidateSenses = candidateCanonicals
      .map(c => loader.getStandardized(c))
      .filter((s): s is NonNullable<typeof s> => s !== null);

    if (candidateSenses.length === 0) continue;

    const contextText = `${occ.context_before} ${occ.colloquial_term} ${occ.context_after}`;
    let contextEmbedding: number[] | null = null;
    if (embedContext) {
      try {
        contextEmbedding = await embedContext(contextText);
      } catch {
        // Proceed without embeddings — phrase signal still works
      }
    }

    const result = resolveWithEnsemble({
      occurrence: occ,
      candidateSenses,
      senseEmbeddings: embeddingMap,
      contextEmbedding,
      config: config.ensemble,
      routing: config.routing,
    });

    if (result.needs_fallback) {
      needsFallback.push({ occurrence: occ, signals: result.signals });
    } else {
      resolved.push({
        ...occ,
        occurrence_id: `occ-${occ.offset}`,
        signals: result.signals,
        resolved_to: result.resolved_to,
        confidence: result.confidence,
        method: 'local_ensemble',
        margin: result.margin,
        rationale: null,
        model: null,
      });
    }
  }

  onProgress?.(`Stage 2: ${resolved.length} resolved locally, ${needsFallback.length} need fallback.`);

  if (needsFallback.length > 0 && config.llm_fallback.enabled && adapter) {
    onProgress?.(`Stage 3: Running LLM fallback for ${needsFallback.length} occurrences...`);

    for (const { occurrence, signals } of needsFallback) {
      const colloquial = loader.getColloquial(occurrence.colloquial_term);
      if (!colloquial) continue;

      const candidateSenses = colloquial.resolves_to
        .map(r => loader.getStandardized(r.standardized_term))
        .filter((s): s is NonNullable<typeof s> => s !== null);

      const largerContextStart = Math.max(0, occurrence.offset - config.llm_fallback.fallback_context_tokens * 4);
      const largerContextEnd = Math.min(text.length, occurrence.offset + occurrence.length + config.llm_fallback.fallback_context_tokens * 4);
      const largerContext = text.slice(largerContextStart, largerContextEnd);

      const fallbackResult = await resolveFallback(
        { occurrence, signals, candidateSenses, config: config.llm_fallback, largerContext },
        adapter,
      );

      resolved.push({
        ...occurrence,
        occurrence_id: `occ-${occurrence.offset}`,
        signals,
        resolved_to: fallbackResult.resolved_to,
        confidence: fallbackResult.confidence,
        method: 'llm_assisted',
        margin: 0,
        rationale: fallbackResult.rationale,
        model: fallbackResult.model,
      });
    }
  } else if (needsFallback.length > 0) {
    for (const { occurrence, signals } of needsFallback) {
      resolved.push({
        ...occurrence,
        occurrence_id: `occ-${occurrence.offset}`,
        signals,
        resolved_to: null,
        confidence: 'ambiguous',
        method: 'local_ensemble',
        margin: 0,
        rationale: config.llm_fallback.enabled
          ? 'No LLM adapter provided'
          : 'LLM fallback disabled',
        model: null,
      });
    }
  }

  onProgress?.(`Pipeline complete: ${resolved.length} occurrences processed.`);
  return buildResult(resolved, documentId ?? 'unknown', config, loader);
}

function buildResult(
  resolved: ResolvedOccurrence[],
  documentId: string,
  config: TranslationPipelineConfig,
  loader: DictionaryLoader,
): TranslationResult {
  const records: TranslationRecord[] = resolved.map(r => ({
    occurrence_id: r.occurrence_id,
    colloquial_term: r.colloquial_term,
    resolved_to: r.resolved_to,
    confidence: r.confidence,
    method: r.method,
    signals: r.signals,
    weights: { w_e: config.ensemble.w_e, w_p: config.ensemble.w_p },
    margin: r.margin,
    rationale: r.rationale,
    fallback_invoked: r.method === 'llm_assisted',
    model: r.model,
    offset: r.offset,
    context_before: r.context_before.slice(-200),
    context_after: r.context_after.slice(0, 200),
    translated_at: new Date().toISOString(),
    dictionary_version: loader.getVersion().schema_version,
  }));

  const summary = {
    total_occurrences: records.length,
    resolved_high: records.filter(r => r.confidence === 'high').length,
    resolved_medium: records.filter(r => r.confidence === 'medium').length,
    ambiguous: records.filter(r => r.confidence === 'ambiguous').length,
    local_resolved: records.filter(r => r.method === 'local_ensemble' && r.resolved_to !== null).length,
    llm_resolved: records.filter(r => r.method === 'llm_assisted' && r.resolved_to !== null).length,
  };

  const snapshot: PipelineConfigSnapshot = {
    w_e: config.ensemble.w_e,
    w_p: config.ensemble.w_p,
    top_score_threshold: config.routing.top_score_threshold,
    margin_threshold: config.routing.margin_threshold,
    phrase_noise_floor: config.ensemble.phrase_noise_floor,
    phrase_aggregation: config.ensemble.phrase_aggregation,
    phrase_top_k: config.ensemble.phrase_top_k,
    llm_fallback_enabled: config.llm_fallback.enabled,
    llm_model: config.llm_fallback.enabled ? config.llm_fallback.model : null,
  };

  return {
    document_id: documentId,
    records,
    summary,
    translated_at: new Date().toISOString(),
    dictionary_version: loader.getVersion().schema_version,
    pipeline_config: snapshot,
  };
}
