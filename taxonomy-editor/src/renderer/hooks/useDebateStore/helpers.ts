// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  DebateSession,
  DebateSessionSummary,
  DebateAudience,
  SpeakerId,
  TranscriptEntry,
  TaxonomyRef,
} from '../../types/debate';
import { POVER_INFO, AI_POVERS, POV_KEYS, normalizeActivePovers, migrateSpeakerId } from '../../types/debate';
import type { PovNode, CrossCuttingNode as SituationNode, GraphAttributes, Category, Pov } from '../../types/taxonomy';
import { useTaxonomyStore } from '../useTaxonomyStore';
import type { DebateStore } from './types';
// Circular import — safe because all references are at call-time, never at module init
import { useDebateStore } from './store';

declare const __APP_VERSION__: string;
import { DEFAULT_MODEL } from '@lib/ai-client/defaults';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { triggerManualDump } from '../../lib/flightRecorderInit';
import { mapErrorToUserMessage } from '../../utils/errorMessages';
import { formatTaxonomyContext } from '../../utils/taxonomyContext';
import type { TaxonomyContext } from '../../utils/taxonomyContext';
import { extractClaimsPrompt, classifyClaimsPrompt, formatArgumentNetworkContext, formatCommitments, formatEstablishedPoints, updateUnansweredLedger, formatConcessionCandidatesHint, processExtractedClaims, computeClaimTaxonomyAttribution } from '../../prompts/argumentNetwork';
import type { ArgumentNetworkNode, ArgumentNetworkEdge, CommitmentStore, EntryDiagnostics, DebateDiagnostics, DocumentAnalysis, ClaimExtractionTrace, ExtractionSummary, GapArgument, GapInjection, CrossCuttingProposal, TaxonomyGapAnalysis } from '../../types/debate';
import { cosineSimilarity, scoreNodeRelevance, selectRelevantNodes, selectRelevantSituationNodes, buildRelevanceQuery, scoreNodesViaAN, scoreNodesLexical } from '../../utils/taxonomyRelevance';
import type { ANClaimEmbedding, RelevanceOptions } from '../../utils/taxonomyRelevance';
import { trace, newCallId, TraceEventName } from '../../lib/trace';
import { documentAnalysisPrompt, buildTaxonomySample, documentAnalysisContext } from '@lib/debate/documentAnalysis';
import { updateConvergenceTracker } from '../../utils/convergenceScoring';
import {
  clarificationPrompt,
  situationClarificationPrompt,
  documentClarificationPrompt,
  formatSituationDebateContext,
  concludingPrompt,
  userSeedClaimsPrompt,
  openingStatementPrompt,
  debateResponsePrompt,
  crossRespondPrompt,
  debateSynthesisPrompt,
  probingQuestionsPrompt,
  factCheckPrompt,
  contextCompressionPrompt,
  entrySummarizationPrompt,
  missingArgumentsPrompt,
  taxonomyRefinementPrompt,
  reflectionPrompt,
  dolceComplianceRetryPrompt,
  midDebateGapPrompt,
  crossCuttingNodePrompt,
} from '../../prompts/debate';
import { checkDolceCompliance } from '../../utils/dolceCompliance';
import {
  generateId,
  nowISO,
  stripCodeFences,
  parseAIJson,
  extractArraysFromPartialJson,
  parseAtMention,
  formatRecentTranscript,
  parsePoverResponse,
} from '@lib/debate/helpers';
import { normalizeBdiLayer } from '@lib/debate';
import { nodeTypeFromId } from '@lib/debate/nodeIdUtils';
import { computeQbafStrengths } from '@lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '@lib/debate/qbaf';
import { factCheckToBaseStrength } from '@lib/debate/argumentNetwork';
import { needsGc, pruneArgumentNetwork, GC_TRIGGER, GC_TARGET } from '@lib/debate/networkGc';
import { getDebatePhase } from '@lib/debate/types';
import type { ModeratorState, SelectionResult, ModeratorIntervention, InterventionMetadata } from '@lib/debate/types';
import type { PoverResponseMeta, MoveAnnotation } from '@lib/debate/helpers';
import { getMoveName, SUPPORT_MOVES } from '@lib/debate/helpers';
import { resolveTurnValidationConfig } from '@lib/debate/turnValidator';
import { computeConvergenceSignals } from '@lib/debate/convergenceSignals';
import { computeProcessReward } from '@lib/debate/processReward';
import type { ProcessRewardEntry } from '@lib/debate/types';
import { updateCruxTracker } from '@lib/debate/cruxResolution';
import { computeTaxonomyGapAnalysis } from '@lib/debate/taxonomyGapAnalysis';
import {
  updateModeratorState,
  MOVE_RESPONSE_CONFIG,
  DIRECT_RESPONSE_PATTERNS,
} from '@lib/debate/moderator';
import { runModeratorSelection, executeTurnWithRetry } from '@lib/debate/orchestration';
import type { ModeratorSelectionCallbacks, ModeratorSelectionInput, TurnRetryCallbacks, TurnRetryInput } from '@lib/debate/orchestration';
import { pruneSessionData, pruneModeratorState } from '@lib/debate/sessionPruning';
import {
  loadProvisionalWeights,
  initPhaseState,
  evaluatePhaseTransition,
  advanceRound,
  applyTransition,
  buildSignalRegistry,
  computeSaturationScore,
  computeConvergenceScore,
  detectCruxNodes,
} from '@lib/debate/phaseTransitions';
import type { PhaseState, PhaseTransitionConfig, SignalContext, Signal, DebatePhase } from '@lib/debate/types';
import { computeDebateHealthScore } from '@lib/debate/moderator';
import { runTurnPipeline, assemblePipelineResult, runOpeningPipeline, assembleOpeningPipelineResult, getOpeningRepairHints } from '@lib/debate/turnPipeline';
import type { OpeningPipelineInput } from '@lib/debate/turnPipeline';
import type { TurnPipelineInput } from '@lib/debate/turnPipeline';
import type { TurnAttempt, TurnValidation, TurnValidationTrail, TaxonomySuggestion } from '../../types/debate';
import { formatVocabularyContext } from '@lib/debate/vocabularyContext';
import { evaluateLookaheadPerClaim, buildClaimAnalysis } from '@lib/debate/lookaheadGate';
import type { LookaheadDiagnostics, LookaheadGateResult, ClaimAnalysis, PerClaimResult } from '@lib/debate/lookaheadGate';
import { computeStructuralScore, critiqueTopicPrompt, parseTopicCritique, formatCritiqueForRefinement, formatStructuralContext, computeLineageDistribution, formatLineageContext } from '@lib/debate/topicCritique';
import { decomposeResolutionPrompt, topicScopeExtractionPrompt, setTopicScope } from '@lib/debate/prompts';
import type { TopicScope, TopicScopeRiskLevel } from '@lib/debate/types';
import type { TopicCritique, LineageFrameEntry } from '@lib/debate/topicCritique';
import { shouldRunGapCheck, findUnengagedHighRelevanceNodes, collectEngagedNodeIds, MAX_GAP_INJECTIONS } from '@lib/debate/gapCheck';
import { runNeutralEvaluation, buildSpeakerMapping } from '@lib/debate/neutralEvaluator';
import type { NeutralEvaluation, SpeakerMapping } from '@lib/debate/neutralEvaluator';
import { computeBeliefConfidence } from '@lib/debate/beliefConfidence';
import { computeTreePriority } from '@lib/debate/desirePriority';
import { embedDoctrinalBoundaries, computeDoctrinalAnchoring, checkThresholdAnomalies } from '@lib/debate/doctrinalAnchoring';
import type { BoundaryEmbeddings } from '@lib/debate/doctrinalAnchoring';
import { computeOperationality } from '@lib/debate/intentionOperationality';
import type { StandardizedTerm, ColloquialTerm, CampOrigin } from '@lib/dictionary/types';
import { disambiguateTerms } from '@lib/debate/vocabularyDisambiguation';
import { usePromptConfigStore } from '../usePromptConfigStore';
import { api } from '@bridge';
import { getLineageMapping, getL2Categories, isLineageDataLoaded } from '../../data/lineageCategories';

// ── Doctrinal anchoring cache ────────────────────────────────────────
// Tracks which POVs have had doctrinal anchoring applied in this session.
// Once anchored, PovNode objects are mutated in place (doctrinally_anchored, confidence floor).
export let _doctrinalAnchoringApplied = new Set<string>();
export let _boundaryEmbeddingsCache: BoundaryEmbeddings | null = null;

/** Reset doctrinal anchoring cache (call when debate changes or taxonomy reloads). */
export function resetDoctrinalAnchoringCache(): void {
  _doctrinalAnchoringApplied = new Set();
  _boundaryEmbeddingsCache = null;
}

// ── Adaptive staging signal history ──────────────────────────────────
// Per-round signal values for priorSignals.get() and priorSignals.movingAverage().
// Keyed by signal ID → array of { round, value } entries.
export const _signalHistory = new Map<string, { round: number; value: number }[]>();

export function recordSignalHistory(signalId: string, round: number, value: number): void {
  let arr = _signalHistory.get(signalId);
  if (!arr) { arr = []; _signalHistory.set(signalId, arr); }
  // Replace if same round, otherwise append
  const existing = arr.findIndex(e => e.round === round);
  if (existing >= 0) arr[existing].value = value;
  else arr.push({ round, value });
}

export function getSignalValue(signalId: string, roundsBack: number): number | null {
  const arr = _signalHistory.get(signalId);
  if (!arr || arr.length === 0) return null;
  if (roundsBack <= 0) return arr[arr.length - 1]?.value ?? null;
  const idx = arr.length - 1 - roundsBack;
  return idx >= 0 ? arr[idx].value : null;
}

export function movingAverageSignal(signalId: string, windowSize: number): number | null {
  const arr = _signalHistory.get(signalId);
  if (!arr || arr.length < windowSize) return null;
  const slice = arr.slice(-windowSize);
  return slice.reduce((sum, e) => sum + e.value, 0) / slice.length;
}

export function resetSignalHistory(): void {
  _signalHistory.clear();
}

// ── Gap injection counter ────────────────────────────────────────────
export let _gapInjectionCount = 0;
export function resetGapInjectionCount(): void { _gapInjectionCount = 0; }
export function setGapInjectionCount(n: number): void { _gapInjectionCount = n; }
export function incrementGapInjectionCount(): void { _gapInjectionCount++; }

// ── Neutral evaluation speaker mapping ──────────────────────────────
export let _neutralMapping: SpeakerMapping | null = null;
export function resetNeutralMapping(): void { _neutralMapping = null; }

/**
 * Phase-safe debate state update. Background async tasks (extractClaimsAndUpdateAN,
 * runNeutralCheckpoint, summarizeTranscriptEntry) read debate state, do work, then
 * spread the stale snapshot back via set(). If synthesis has set phase='closed' in
 * the meantime, the spread clobbers it back to 'debate' — a phase regression.
 *
 * This helper preserves the current phase when merging background updates.
 */
export function phaseGuardedSet(
  get: () => any,
  set: (partial: any) => void,
  updates: Partial<DebateSession>,
): void {
  const current = get().activeDebate as DebateSession | null;
  if (!current) return;
  set({ activeDebate: { ...current, ...updates } });
}

/** Fire-and-forget neutral evaluation at a checkpoint. Non-blocking, never throws. */
export async function runNeutralCheckpoint(
  checkpoint: 'baseline' | 'midpoint' | 'final',
  get: () => DebateStore,
  set: (partial: Partial<DebateStore>) => void,
  addTranscriptEntry: (entry: { type: string; speaker: string; content: string; taxonomy_refs: TaxonomyRef[]; metadata?: Record<string, unknown> }) => string,
): Promise<void> {
  try {
    const debate = get().activeDebate;
    if (!debate) return;

    if (!_neutralMapping) {
      _neutralMapping = buildSpeakerMapping(debate.active_povers);
    }

    const model = getConfiguredModel();
    const adapter = {
      generateText: async (prompt: string, m: string, opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number }) => {
        const result = await api.generateText(prompt, m, opts?.timeoutMs ?? 30_000, opts?.temperature);
        return result.text;
      },
    };

    const evaluation = await runNeutralEvaluation(checkpoint, {
      adapter,
      topic: debate.topic.final || debate.topic.original,
      transcript: debate.transcript,
      contextSummaries: debate.context_summaries,
      activePovers: debate.active_povers,
      model,
      speakerMapping: _neutralMapping,
    });

    // Store on session (phase-guarded to prevent clobbering 'closed' phase)
    const freshDebate = get().activeDebate;
    if (!freshDebate) return;
    const existing = freshDebate.neutral_evaluations ?? [];
    phaseGuardedSet(get, set, {
      neutral_evaluations: [...existing, evaluation],
      neutral_speaker_mapping: _neutralMapping!,
    });

    // Add transcript entry for visibility
    const cruxCount = evaluation.cruxes?.length ?? 0;
    const claimCount = evaluation.claims?.length ?? 0;
    const notes = evaluation.overall_assessment?.notes ?? '';
    addTranscriptEntry({
      type: 'system',
      speaker: 'system',
      content: `[Neutral evaluation: ${checkpoint}] ${cruxCount} cruxes, ${claimCount} claims evaluated. ${notes}`,
      taxonomy_refs: [],
      metadata: { neutral_checkpoint: checkpoint },
    });

    getGlobalRecorder()?.record({ type: 'state.change', debate_id: debate?.id, component: 'neutral-eval', level: 'info', message: `neutral.${checkpoint}`, data: { cruxes: cruxCount, claims: claimCount, engaging: evaluation.overall_assessment?.debate_is_engaging_real_disagreement } });
  } catch (err) {
    console.warn(`[Neutral Eval] ${checkpoint} failed (non-blocking):`, err);
    getGlobalRecorder()?.record({ type: 'state.error', component: 'neutral-eval', level: 'warn', message: `neutral.${checkpoint}.failed`, data: { error: String(err) } });
  }
}

export function getSpeakerModel(activeDebate: { speaker_models?: Record<string, string> } | null, speaker: string, fallbackModel: string): string {
  return activeDebate?.speaker_models?.[speaker] || fallbackModel;
}

/** Read the model for the current debate context.
 *  Priority: debate-specific override > global Settings model > default */
export function getConfiguredModel(): string {
  // Check debate-specific model first
  const debateModel = useDebateStore.getState().debateModel;
  if (debateModel) {
    console.log(`[model] Using debate-specific model: ${debateModel}`);
    return debateModel;
  }
  try {
    const globalModel = localStorage.getItem('taxonomy-editor-gemini-model') || DEFAULT_MODEL;
    console.log(`[model] Using global model: ${globalModel}`);
    return globalModel;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Failed to read configured model from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    return DEFAULT_MODEL;
  }
}

/**
 * Enrich policy_refs with per-policy relevance from the draft stage.
 * The cite stage produces bare string IDs; the draft stage produces
 * {policy_id, relevance} objects. Merge to get the best of both.
 */
export function enrichPolicyRefs(
  policyRefs: (string | { policy_id: string; relevance: string })[] | undefined,
  draftWorkProduct: Record<string, unknown> | undefined,
): (string | { policy_id: string; relevance: string })[] | undefined {
  if (!policyRefs || policyRefs.length === 0) return policyRefs;
  const draftPolicyRefs = draftWorkProduct?.policy_refs as { policy_id: string; relevance: string }[] | undefined;
  if (!Array.isArray(draftPolicyRefs) || draftPolicyRefs.length === 0) return policyRefs;

  // Build lookup from draft's rich policy refs
  const draftMap = new Map<string, string>();
  for (const dp of draftPolicyRefs) {
    if (dp && typeof dp === 'object' && dp.policy_id && dp.relevance) {
      draftMap.set(dp.policy_id, dp.relevance);
    }
  }
  if (draftMap.size === 0) return policyRefs;

  return policyRefs.map(ref => {
    if (typeof ref === 'string') {
      const relevance = draftMap.get(ref);
      return relevance ? { policy_id: ref, relevance } : ref;
    }
    return ref;
  });
}

/** Normalize progress from either flat shape (Electron IPC) or nested retry shape (lib DebateProgress). */
export function normalizeProgress(p: Record<string, unknown>): { attempt: number; maxRetries: number; backoffSeconds?: number; limitType?: string; limitMessage?: string; phase?: string } {
  // Lib DebateProgress: { phase: 'retry', retry: { attempt, maxRetries, backoffSeconds }, message }
  const retry = p.retry as { attempt: number; maxRetries: number; backoffSeconds: number } | undefined;
  if (retry && typeof retry === 'object') {
    return {
      attempt: retry.attempt,
      maxRetries: retry.maxRetries,
      backoffSeconds: retry.backoffSeconds,
      limitMessage: p.message as string | undefined,
      phase: p.phase as string | undefined,
    };
  }
  // Flat shape from Electron IPC: { attempt, maxRetries, backoffSeconds, limitType, limitMessage }
  return p as { attempt: number; maxRetries: number; backoffSeconds?: number; limitType?: string; limitMessage?: string };
}

/** Call generateText with progress tracking — subscribes to onGenerateTextProgress */
export async function generateTextWithProgress(
  prompt: string,
  model: string,
  activity: string,

  set: (partial: any) => void,
  timeoutMs?: number,
): Promise<{ text: string }> {
  set({ debateActivity: activity, debateProgress: null });
  const unsubscribe = api.onGenerateTextProgress((progress: Record<string, unknown>) => {
    set({ debateProgress: normalizeProgress(progress) });
  });
  try {
    const result = await api.generateText(prompt, model, timeoutMs);
    return result;
  } finally {
    unsubscribe();
    set({ debateProgress: null, debateActivity: null });
  }
}

/** Post-turn summarization (DT-2): generate brief + medium summaries for a transcript entry. */
export async function summarizeTranscriptEntry(
  entryId: string,
  content: string,
  speaker: string,
  model: string,
  get: () => { activeDebate: DebateSession | null },
  set: (partial: Partial<{ activeDebate: DebateSession | null }>) => void,
): Promise<void> {
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const prompt = entrySummarizationPrompt(content, speaker);
      const { text } = await api.generateText(prompt, model, 15000);
      const parsed = parseAIJson<{ brief?: string; medium?: string }>(text);
      if (!parsed) {
        console.warn(`[debate] summarizeEntry: parseAIJson returned null (attempt ${attempt + 1}/${MAX_RETRIES}). Raw response:`, text.slice(0, 500));
        continue;
      }
      if (!parsed.brief || !parsed.medium) {
        console.warn(`[debate] summarizeEntry: missing brief/medium (attempt ${attempt + 1}/${MAX_RETRIES}). Parsed:`, parsed);
        continue;
      }
      // Re-read current state to avoid clobbering phase changes from concurrent tasks
      const debate = get().activeDebate;
      if (!debate) return;
      const entry = debate.transcript.find(e => e.id === entryId);
      if (entry) {
        entry.summaries = { brief: parsed.brief, medium: parsed.medium };
        set({ activeDebate: { ...debate } });
      }
      return; // success
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        debate_id: get().activeDebate?.id,
        component: 'debate-store',
        level: 'warn',
        message: `Summarize entry failed (attempt ${attempt + 1}/${MAX_RETRIES})`,
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      console.warn(`[debate] summarizeEntry failed (attempt ${attempt + 1}/${MAX_RETRIES}):`, err);
    }
  }
  console.warn(`[debate] summarizeEntry: all ${MAX_RETRIES} attempts failed for entry ${entryId}. Detail level pills will be unavailable for this entry.`);
  try {
      const s = useDebateStore.getState();
    if (s.debateWarnings.length < 50) {
      useDebateStore.setState({ debateWarnings: [...s.debateWarnings, 'Entry summarization failed — detail level pills unavailable'] });
    }
  } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', debate_id: get().activeDebate?.id, component: 'debate-store', level: 'warn', message: 'Store not ready during summarizeEntry warning push', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
}

/**
 * Guard against race conditions in async debate operations.
 * Captures the active debate ID at call time; returns a checker that
 * verifies the debate hasn't changed during an await.
 */
export function createDebateGuard(get: () => { activeDebateId: string | null }): () => boolean {
  const capturedId = get().activeDebateId;
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define -- module-level var, safe at call-time
    if (_abortController?.signal.aborted) return false;
    if (capturedId !== get().activeDebateId) {
      console.warn(`[debate] Active debate changed during async operation (was ${capturedId}, now ${get().activeDebateId}). Discarding stale results.`);
      return false;
    }
    return true;
  };
}

export let _abortController: AbortController | null = null;

export function cancelAndResetAbort(): void {
  _abortController?.abort();
  _abortController = null;
}

export function newAbortController(): AbortController {
  _abortController = new AbortController();
  return _abortController;
}

const AI_POVER_ORDER = AI_POVERS;

/** Maximum number of turn embeddings to retain (enough for recycling detection). */
const TURN_EMBEDDING_WINDOW = 30;

/** Push a user-visible warning into debateWarnings state (capped at 50). */
export function pushWarning(

  get: () => any,

  set: (partial: any) => void,
  msg: string,
): void {
  const current: string[] = get().debateWarnings ?? [];
  if (current.length < 50) {
    set({ debateWarnings: [...current, msg] });
  }
}

/** Record diagnostic data for a transcript entry (only when diagnostics enabled) */
export function recordDiagnostic(

  get: () => any,

  set: (partial: any) => void,
  entryId: string,
  data: Partial<EntryDiagnostics>,
): void {
  // Always capture diagnostic data — the toggle only controls UI visibility
  const debate = get().activeDebate as DebateSession | null;
  if (!debate) return;

  const diag: DebateDiagnostics = debate.diagnostics || {
    enabled: true,
    entries: {},
    overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
  };

  diag.entries[entryId] = { ...diag.entries[entryId], ...data };

  // Update overview counters
  if (data.response_time_ms) {
    diag.overview.total_ai_calls++;
    diag.overview.total_response_time_ms += data.response_time_ms;
  }

  // Aggregate per-stage token counts into entry and overview totals
  const stages = data.stage_diagnostics;
  if (stages && stages.length > 0) {
    let entryInput = 0;
    let entryOutput = 0;
    let hasTokens = false;
    for (const s of stages) {
      if (s.input_tokens != null) { entryInput += s.input_tokens; hasTokens = true; }
      if (s.output_tokens != null) { entryOutput += s.output_tokens; hasTokens = true; }
    }
    if (hasTokens) {
      diag.entries[entryId].input_tokens = entryInput;
      diag.entries[entryId].output_tokens = entryOutput;
      diag.overview.total_input_tokens = (diag.overview.total_input_tokens ?? 0) + entryInput;
      diag.overview.total_output_tokens = (diag.overview.total_output_tokens ?? 0) + entryOutput;
    }
  }

  const updatedDebate = { ...debate, diagnostics: diag };
  set({ activeDebate: updatedDebate });

  // Broadcast to popout window
  try { api.sendDiagnosticsState({ debate: updatedDebate, selectedEntry: get().selectedDiagEntry }); } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', debate_id: debate?.id, component: 'debate-store', level: 'warn', message: 'Diagnostics broadcast to popout failed (recordDiagnostic)', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
}

/** djb2 hash for prompt fingerprinting. */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/** Heuristic: does response body look cut off mid-JSON? */
export function looksTruncated(s: string): boolean {
  if (!s) return false;
  const trimmed = s.trimEnd();
  if (trimmed.length === 0) return false;
  let depth = 0;
  for (const c of trimmed) {
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  if (depth > 0) return true;
  const last = trimmed.slice(-1);
  return !(last === '}' || last === ']' || last === '"');
}

/** Incrementally refresh debate.extraction_summary given a new trace. */
export function updateExtractionSummary(

  get: () => any,

  set: (partial: any) => void,
): void {
  const debate = get().activeDebate as DebateSession | null;
  if (!debate) return;

  const traces: ClaimExtractionTrace[] = [];
  const entries = debate.diagnostics?.entries ?? {};
  for (const entryDiag of Object.values(entries) as EntryDiagnostics[]) {
    if (entryDiag.extraction_trace) traces.push(entryDiag.extraction_trace);
  }
  traces.sort((a, b) => a.round - b.round);

  let totalProposed = 0;
  let totalAccepted = 0;
  let totalRejected = 0;
  const rejectionTotals: Record<string, number> = {};
  const growth: { round: number; cumulative_count: number }[] = [];
  for (const t of traces) {
    totalProposed += t.candidates_proposed;
    totalAccepted += t.candidates_accepted;
    totalRejected += t.candidates_rejected;
    for (const [k, v] of Object.entries(t.rejection_reasons)) {
      rejectionTotals[k] = (rejectionTotals[k] ?? 0) + v;
    }
    growth.push({ round: t.round, cumulative_count: t.an_node_count_after });
  }

  let plateauDetected = false;
  let plateauStartedAt: number | undefined;
  let plateauLastAnId: string | undefined;
  if (traces.length >= 2) {
    let tailZero = 0;
    for (let i = traces.length - 1; i >= 0; i--) {
      const t = traces[i];
      if (t.an_node_count_after === t.an_node_count_before) tailZero++;
      else break;
    }
    if (tailZero >= 2) {
      plateauDetected = true;
      const firstZeroIdx = traces.length - tailZero;
      plateauStartedAt = traces[firstZeroIdx]?.round;
      const lastGood = traces[firstZeroIdx - 1];
      plateauLastAnId = lastGood?.an_nodes_added_ids.slice(-1)[0];
    }
  }

  // Compute attribution ratio from traces
  let attrTotal = 0;
  let attrUnattributed = 0;
  for (const t of traces) {
    if (t.attribution_attributed != null || t.attribution_unattributed != null) {
      attrTotal += (t.attribution_attributed ?? 0) + (t.attribution_unattributed ?? 0);
      attrUnattributed += t.attribution_unattributed ?? 0;
    }
  }

  const summary: ExtractionSummary = {
    total_turns: traces.length,
    total_proposed: totalProposed,
    total_accepted: totalAccepted,
    total_rejected: totalRejected,
    acceptance_rate: totalProposed > 0 ? totalAccepted / totalProposed : 0,
    an_growth_series: growth,
    plateau_detected: plateauDetected,
    plateau_started_at_turn: plateauStartedAt,
    plateau_last_an_id: plateauLastAnId,
    rejection_reason_totals: rejectionTotals,
    unattributed_claim_ratio: attrTotal > 0 ? attrUnattributed / attrTotal : undefined,
  };

  set({ activeDebate: { ...debate, extraction_summary: summary } });
}

// ── AN commit instrumentation ─────────────────────────────
//
// Per-turn AN extractions run fire-and-forget, so two commits can race.
// `commitAnNodes` centralises the atomic mint-then-set pattern, asserts
// no ID collisions, and logs before/after state so any clobber is visible.

export function snapshotAnLengths(get: () => any): { nodeCount: number; edgeCount: number; maxNodeId: number } {
  const d = get().activeDebate;
  const an = d?.argument_network ?? { nodes: [], edges: [] };
  let maxId = 0;
  for (const n of an.nodes) {
    const m = /^AN-(\d+)$/.exec(n.id);
    if (m) { const k = parseInt(m[1], 10); if (k > maxId) maxId = k; }
  }
  return { nodeCount: an.nodes.length, edgeCount: an.edges.length, maxNodeId: maxId };
}

export function assertNoDuplicateAnIds(label: string, existing: { id: string }[], incoming: { id: string }[]): void {
  const existingIds = new Set(existing.map(n => n.id));
  const dupsWithExisting: string[] = [];
  const seenInIncoming = new Set<string>();
  const dupsInIncoming: string[] = [];
  for (const n of incoming) {
    if (existingIds.has(n.id)) dupsWithExisting.push(n.id);
    if (seenInIncoming.has(n.id)) dupsInIncoming.push(n.id);
    seenInIncoming.add(n.id);
  }
  if (dupsWithExisting.length || dupsInIncoming.length) {
    const msg = `[AN-INVARIANT] ${label} duplicate AN IDs detected — existing: [${dupsWithExisting.join(', ')}], within-batch: [${dupsInIncoming.join(', ')}]`;
    console.error(msg, { existingIds: [...existingIds], incomingIds: incoming.map(n => n.id) });
    throw new Error(msg);
  }
}

export interface AnCommitResult {
  idBase: number;
  edgeIdBase: number;
  idMap: Record<string, string>;
  assignedNodeIds: string[];
}

/**
 * Atomically mint AN-N / AE-N IDs from fresh state, assert no duplicates,
 * commit via set(), and return the id map for callers that need to remap
 * downstream references (e.g., diagnostic entries, pNode targets).
 *
 * Caller must supply `newNodes`/`newEdges` whose `.id` fields may be
 * tentative — they will be reassigned in place. Edges whose `.source`
 * references a tentative node id are remapped via the returned idMap.
 */
export function commitAnNodes<N extends { id: string }, E extends { id: string; source: string }>(

  get: () => any,

  set: (partial: any) => void,
  label: string,
  newNodes: N[],
  newEdges: E[],

  mergeExtras?: (fresh: any) => any,
): AnCommitResult {
  const before = snapshotAnLengths(get);
  const freshState = get().activeDebate;
  const freshAn = freshState?.argument_network || { nodes: [], edges: [] };
  const idBase = freshAn.nodes.length;
  const edgeIdBase = freshAn.edges.length;
  const idMap: Record<string, string> = {};

  // If existing IDs aren't dense 1..N (e.g., prior corruption), mint past the max.
  const safeBase = Math.max(idBase, before.maxNodeId);
  newNodes.forEach((n, i) => {
    const realId = `AN-${safeBase + i + 1}`;
    idMap[n.id] = realId;
    n.id = realId;
  });
  newEdges.forEach((e, i) => {
    e.id = `AE-${edgeIdBase + i + 1}`;
    if (idMap[e.source]) e.source = idMap[e.source];
  });

  assertNoDuplicateAnIds(label, freshAn.nodes, newNodes);

  const base = mergeExtras ? mergeExtras(freshState) : { ...freshState };
  const anUpdate = {
    ...base,
    argument_network: {
      nodes: [...freshAn.nodes, ...newNodes],
      edges: [...freshAn.edges, ...newEdges],
    },
  };
  // Phase-guarded: re-read current phase to prevent background AN commits
  // from clobbering 'closed' phase set by requestSynthesis (t/301).
  const currentPhase = (get().activeDebate as DebateSession | null)?.phase;
  if (currentPhase) anUpdate.phase = currentPhase;
  set({ activeDebate: anUpdate });

  const after = snapshotAnLengths(get);
  console.log(
    `[AN-COMMIT ${label}] before=${before.nodeCount}/${before.edgeCount} (maxId=${before.maxNodeId}) ` +
    `+${newNodes.length}n/${newEdges.length}e → after=${after.nodeCount}/${after.edgeCount} (maxId=${after.maxNodeId}) ` +
    `assigned=[${newNodes.map(n => n.id).join(', ')}]`,
  );

  if (after.nodeCount !== before.nodeCount + newNodes.length) {
    console.error(
      `[AN-INVARIANT] ${label} length mismatch — expected ${before.nodeCount + newNodes.length}, got ${after.nodeCount}. ` +
      `Something else wrote activeDebate between our read and set.`,
    );
  }

  return { idBase: safeBase, edgeIdBase, idMap, assignedNodeIds: newNodes.map(n => n.id) };
}

/**
 * Run an AN-length invariant check after any set() that might have touched
 * argument_network. If the array shrunk, something clobbered it.
 */
export function checkAnInvariants(label: string, get: () => any, expectedMinCount: number): void {
  const d = get().activeDebate;
  const count = d?.argument_network?.nodes?.length ?? 0;
  if (count < expectedMinCount) {
    console.error(`[AN-INVARIANT] ${label} AN shrank: was ≥${expectedMinCount}, now ${count}. Clobber detected.`);
  }
}

/**
 * Extract claims from a debater's statement and update the argument network.
 * Runs in the background after each turn — does not block the debate flow.
 */
/** Callback for lookahead-driven regeneration. Returns new statement + pre-extracted claims, or null to skip retry. */
export type LookaheadRegenCallback = (guidance: {
  strongFoundations?: ClaimAnalysis['strongFoundations'];
  avoidClaims?: ClaimAnalysis['avoidClaims'];
}) => Promise<{
  statement: string;
  debaterClaims?: { claim: string; targets: string[] }[];
} | null>;

/**
 * Detect zero-claim extraction despite having claim sketches (t/227).
 * Records a flight recorder error and auto-triggers a dump.
 */
export function detectZeroClaims(
  get: () => any, set: (partial: any) => void,
  debateId: string, entryId: string, speaker: SpeakerId,
  sketchCount: number, acceptedCount: number,
  reason: string, rejectionReasons?: Record<string, number>,
): void {
  if (sketchCount === 0 || acceptedCount > 0) return;
  const speakerLabel = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label || speaker;
  const msg = `Claim extraction for ${speakerLabel} produced 0 claims from ${sketchCount} sketches (${reason})`;
  getGlobalRecorder()?.record({
    type: 'system.error',
    debate_id: debateId,
    component: 'claim-extraction-monitor',
    level: 'error',
    message: msg,
    data: { debate_id: debateId, turn_id: entryId, speaker, sketch_count: sketchCount, reason, rejection_reasons: rejectionReasons },
  });
  pushWarning(get, set, msg);
  // Auto-trigger flight recorder dump for diagnosis
  try { triggerManualDump(); } catch { /* flight recorder dump — silent by design */ }
}

export async function extractClaimsAndUpdateAN(
  statement: string,
  speaker: SpeakerId,
  entryId: string,
  taxonomyRefs: string[],

  get: () => any,

  set: (partial: any) => void,
  debaterClaims?: { claim: string; targets: string[] }[],
  regenCallback?: LookaheadRegenCallback,
): Promise<void> {
  const debate = get().activeDebate as DebateSession | null;
  if (!debate) return;

  const model = getConfiguredModel();
  const an = debate.argument_network || { nodes: [], edges: [] };
  const priorClaims = an.nodes.map(n => ({ id: n.id, text: n.text, speaker: POVER_INFO[n.speaker as Exclude<SpeakerId, 'user'>]?.label || n.speaker }));
  const speakerLabel = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label || speaker;

  const sketchCount = debaterClaims?.length ?? 0;

  const extractStartedAt = Date.now();
  const anCountBefore = an.nodes.length;
  const turnRound = (debate.transcript?.length ?? 0) + 1;
  const EXTRACTION_PROMPT_VERSION = 'v1.4';
  recordDiagnostic(get, set, entryId, { extraction_status: 'pending' as const });
  trace(TraceEventName.AN_EXTRACT_START, {
    debate_id: debate.id,
    turn_id: entryId,
    speaker,
    prior_claim_count: priorClaims.length,
    has_debater_claims: !!(debaterClaims && debaterClaims.length > 0),
  });

  // Seed trace — progressively filled in as the extraction lifecycle proceeds.
  const extractionTrace: ClaimExtractionTrace = {
    entry_id: entryId,
    round: turnRound,
    speaker,
    status: 'ok',
    attempt_count: 1,
    prompt_chars: 0,
    prompt_token_estimate: 0,
    response_chars: 0,
    response_truncated: false,
    model,
    response_time_ms: 0,
    candidates_proposed: 0,
    candidates_accepted: 0,
    candidates_rejected: 0,
    rejection_reasons: {},
    rejected_overlap_pcts: [],
    max_overlap_vs_existing: 0,
    an_node_count_before: anCountBefore,
    an_node_count_after: anCountBefore,
    an_nodes_added_ids: [],
    prompt_hash: '',
    extraction_prompt_version: EXTRACTION_PROMPT_VERSION,
  };

  const commitTrace = () => {
    recordDiagnostic(get, set, entryId, { extraction_trace: { ...extractionTrace } });
    updateExtractionSummary(get, set);
  };

  try {
    // Hybrid approach: if debater supplied claims, use classifyClaimsPrompt (lighter).
    // Otherwise fall back to full extractClaimsPrompt (backward compat with older models).
    const prompt = debaterClaims && debaterClaims.length > 0
      ? classifyClaimsPrompt(statement, speakerLabel, debaterClaims, priorClaims)
      : extractClaimsPrompt(statement, speakerLabel, priorClaims);
    extractionTrace.prompt_chars = prompt.length;
    extractionTrace.prompt_token_estimate = Math.round(prompt.length / 4);
    extractionTrace.prompt_hash = hashString(prompt);

    const callId = newCallId();
    const callStartedAt = Date.now();
    trace(TraceEventName.AI_CALL_START, {
      debate_id: debate.id,
      turn_id: entryId,
      call_id: callId,
      speaker,
      model,
      purpose: 'claim_extraction',
      prompt_chars: prompt.length,
    });

    let text: string;
    try {
      ({ text } = await api.generateText(prompt, model));
      extractionTrace.response_time_ms = Date.now() - callStartedAt;
      extractionTrace.response_chars = text.length;
      extractionTrace.response_truncated = looksTruncated(text);
      trace(TraceEventName.AI_CALL_COMPLETE, {
        debate_id: debate.id,
        turn_id: entryId,
        call_id: callId,
        speaker,
        model,
        purpose: 'claim_extraction',
        duration_ms: Date.now() - callStartedAt,
        response_chars: text.length,
      });
    } catch (callErr) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        debate_id: debate.id,
        component: 'debate-store',
        level: 'error',
        message: 'Claim extraction AI call failed',
        error: { name: (callErr as Error).name ?? 'Error', message: String(callErr) },
      });
      extractionTrace.response_time_ms = Date.now() - callStartedAt;
      extractionTrace.status = 'adapter_error';
      extractionTrace.error_message = String(callErr);
      trace(TraceEventName.AI_CALL_FAILED, {
        debate_id: debate.id,
        turn_id: entryId,
        call_id: callId,
        speaker,
        model,
        purpose: 'claim_extraction',
        duration_ms: Date.now() - callStartedAt,
        error: String(callErr),
      });
      throw callErr;
    }
    type ClaimExtractionResult = { claims?: { text: string; bdi_category?: string; base_strength?: number; bdi_sub_scores?: Record<string, number>; specificity?: string; steelman_of?: string | null; responds_to?: { prior_claim_id: string; relationship: string; attack_type?: string; weight?: number; scheme?: string; argumentation_scheme?: string; warrant?: string }[] }[] };
    const parsed = parseAIJson<ClaimExtractionResult>(text);
    if (!parsed) {
      const parseErr = new SyntaxError('Claim extraction JSON recovery failed');
      getGlobalRecorder()?.record({
        type: 'system.error',
        debate_id: debate.id,
        component: 'debate-store',
        level: 'error',
        message: 'Claim extraction JSON parse failed',
        error: { name: parseErr.name, message: `${parseErr.message} (raw length: ${text.length})` },
      });
      extractionTrace.status = extractionTrace.response_truncated ? 'truncated_response' : 'parse_error';
      extractionTrace.error_message = String(parseErr);
      commitTrace();
      throw parseErr;
    }
    if (!parsed.claims || !Array.isArray(parsed.claims)) {
      extractionTrace.status = 'empty_response';
      commitTrace();
      recordDiagnostic(get, set, entryId, { extraction_status: 'complete' as const });
      detectZeroClaims(get, set, debate.id, entryId, speaker, sketchCount, 0, 'no_claims_array');
      trace(TraceEventName.AN_EXTRACT_COMPLETE, {
        debate_id: debate.id,
        turn_id: entryId,
        speaker,
        accepted: 0,
        rejected: 0,
        edges_added: 0,
        duration_ms: Date.now() - extractStartedAt,
        reason: 'no_claims_array',
      });
      return;
    }
    extractionTrace.candidates_proposed = parsed.claims.length;

    const turnNumber = debate.transcript.length;
    const commitments = debate.commitments || {};
    const speakerCommits: CommitmentStore = commitments[speaker] || { asserted: [], conceded: [], challenged: [] };

    const taxEdges = useTaxonomyStore.getState().edgesFile?.edges;
    const claimsResult = processExtractedClaims(
      {
        claims: parsed.claims,
        statement,
        speaker,
        entryId,
        taxonomyRefIds: taxonomyRefs,
        turnNumber,
        existingNodes: an.nodes,
        existingEdgeCount: an.edges.length,
        startNodeId: an.nodes.length + 1,
        taxonomyEdges: taxEdges,
      },
      {
        groundingOverlapThreshold: 0.3,
        isClassifyPath: !!(debaterClaims && debaterClaims.length > 0),
      },
    );

    const { newNodes, newEdges } = claimsResult;
    const diagAccepted = claimsResult.accepted;
    const diagRejected = claimsResult.rejected;


    for (const t of claimsResult.commitments.asserted) {
      if (!speakerCommits.asserted.includes(t)) speakerCommits.asserted.push(t);
    }
    for (const t of claimsResult.commitments.conceded) {
      if (!speakerCommits.conceded.includes(t)) speakerCommits.conceded.push(t);
    }
    for (const t of claimsResult.commitments.challenged) {
      if (!speakerCommits.challenged.includes(t)) speakerCommits.challenged.push(t);
    }

    extractionTrace.candidates_accepted = newNodes.length;
    extractionTrace.candidates_rejected = diagRejected.length;
    Object.assign(extractionTrace.rejection_reasons, claimsResult.rejectionReasons);
    extractionTrace.rejected_overlap_pcts.push(...claimsResult.rejectedOverlapPcts);
    extractionTrace.max_overlap_vs_existing = claimsResult.maxOverlapVsExisting;

    if (newNodes.length === 0) {
      extractionTrace.status = 'no_new_nodes';
      extractionTrace.an_node_count_after = anCountBefore;
      commitTrace();
      recordDiagnostic(get, set, entryId, { extraction_status: 'complete' as const });
      detectZeroClaims(get, set, debate.id, entryId, speaker, sketchCount, 0, 'all_claims_rejected', extractionTrace.rejection_reasons);
      trace(TraceEventName.AN_EXTRACT_COMPLETE, {
        debate_id: debate.id,
        turn_id: entryId,
        speaker,
        accepted: 0,
        rejected: diagRejected.length,
        edges_added: 0,
        duration_ms: Date.now() - extractStartedAt,
        reason: 'all_claims_rejected_or_empty',
      });
      return;
    }

    // Embed new AN nodes for AN-based taxonomy relevance scoring (non-blocking)
    for (const node of newNodes) {
      try {
        const { vector } = await api.computeQueryEmbedding(node.text.slice(0, 300));
        if (vector && vector.length > 0) node.embedding = vector;
      } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', debate_id: debate.id, component: 'debate-store', level: 'warn', message: 'AN node embedding failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
    }

    // Per-claim taxonomy attribution (t/110): compare AN embeddings against same-POV Belief nodes
    if (newNodes.length > 0) {
      const speakerPov = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.pov;
      if (speakerPov) {
        try {
          const taxState = useTaxonomyStore.getState();
          const povFile = taxState[speakerPov as keyof typeof taxState] as { nodes: { id: string; category: string; label: string; description: string }[] } | null;
          const povNodes = povFile?.nodes ?? [];
          const beliefNodes = povNodes.filter((n) => n.category === 'Beliefs');
          const beliefNodeIds = new Set(beliefNodes.map((n) => n.id));

          // Ensure we have embeddings for the belief nodes — load from embeddings.json via IPC
          let embCache = taxState.embeddingCache;
          if (embCache.size === 0 || !beliefNodes.some(n => embCache.has(n.id))) {
            const { ids, texts } = taxState.buildEmbeddingTexts(new Set(), new Set());
            if (ids.length > 0) {
              const { vectors } = await api.computeEmbeddings(texts, ids);
              embCache = new Map<string, number[]>();
              for (let i = 0; i < ids.length; i++) {
                if (vectors[i]?.length > 0) embCache.set(ids[i], vectors[i]);
              }
              useTaxonomyStore.setState({ embeddingCache: embCache, embeddingDirty: false });
            }
          }

          // Build nodeEmbeddings from embeddingCache — add pov from node ID prefix
          const nodeEmbeddings: Record<string, { pov: string; vector: number[] }> = {};
          const povMap: Record<string, string> = { acc: 'accelerationist', saf: 'safetyist', skp: 'skeptic' };
          for (const [nodeId, vector] of embCache) {
            const prefix = nodeId.split('-')[0];
            const pov = povMap[prefix];
            if (pov && vector.length > 0) {
              nodeEmbeddings[nodeId] = { pov, vector };
            }
          }

          const attrResult = computeClaimTaxonomyAttribution(
            newNodes, speakerPov, nodeEmbeddings, beliefNodeIds,
          );
          extractionTrace.attribution_attributed = attrResult.attributed;
          extractionTrace.attribution_unattributed = attrResult.unattributed;
          extractionTrace.attribution_missing_embedding = attrResult.missing_embedding;
          extractionTrace.attribution_novel_argument = attrResult.novel_argument;
          extractionTrace.attribution_decisions = attrResult.decisions;
        } catch (e) {
          getGlobalRecorder()?.record({ type: 'system.error', debate_id: debate.id, component: 'debate-store', level: 'warn', message: 'Claim taxonomy attribution failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } });
          // Attribution failure never blocks extraction
        }
      }
    }

    // ── Pre-commit lookahead gate (t/34) — evaluate before committing ──
    let lookaheadDiag: LookaheadDiagnostics | undefined;
    let bestPerClaim: PerClaimResult[] | undefined;
    try {
      const lookaheadStart = Date.now();
      const lookaheadInput = {
        speaker,
        existingNodes: an.nodes,
        existingEdges: an.edges,
        tentativeClaims: newNodes.map(n => ({ text: n.text, base_strength: n.base_strength ?? 0.5 })),
        tentativeEdges: newEdges,
        cruxes: debate.crux_tracker,
      };
      const { batchResult: firstResult, perClaim: firstPerClaim } = evaluateLookaheadPerClaim(lookaheadInput);
      bestPerClaim = firstPerClaim;

      const MAX_REGEN_ATTEMPTS = 3;
      let bestResult = firstResult;
      let bestNodes = [...newNodes];
      let bestEdges = [...newEdges];
      let bestStatement: string | null = null;
      const regenAttempts: LookaheadGateResult[] = [];
      const perClaimAnalysisLog: { perClaim: PerClaimResult[]; analysis: ClaimAnalysis }[] = [];

      if (!firstResult.pass && regenCallback) {
        // Seed cumulative guidance from the first attempt's per-claim analysis
        const firstAnalysis = buildClaimAnalysis(firstPerClaim);
        perClaimAnalysisLog.push({ perClaim: firstPerClaim, analysis: firstAnalysis });
        const cumulativeStrong = [...firstAnalysis.strongFoundations];
        const cumulativeAvoid = [...firstAnalysis.avoidClaims];

        for (let attempt = 0; attempt < MAX_REGEN_ATTEMPTS; attempt++) {
          console.log(`[Lookahead] Gate failed (Δu=${bestResult.utility_delta.toFixed(3)}), requesting regen ${attempt + 1}/${MAX_REGEN_ATTEMPTS} (${cumulativeStrong.length} strong, ${cumulativeAvoid.length} avoid)`);
          getGlobalRecorder()?.record({ type: 'lookahead.regen', component: 'argument-network-extraction', level: 'info', debate_id: debate.id, turn_id: entryId, speaker, message: `Lookahead gate failed, triggering regen attempt ${attempt + 1}`, data: { attempt: attempt + 1, utility_delta: bestResult.utility_delta, threshold: bestResult.threshold, strong_count: cumulativeStrong.length, avoid_count: cumulativeAvoid.length } });

          const regenResult = await regenCallback({
            strongFoundations: cumulativeStrong.length > 0 ? cumulativeStrong : undefined,
            avoidClaims: cumulativeAvoid.length > 0 ? cumulativeAvoid : undefined,
          });
          if (!regenResult) break; // callback returned null — stop retrying

          // Re-extract claims from regenerated response
          const regenPrompt = regenResult.debaterClaims && regenResult.debaterClaims.length > 0
            ? classifyClaimsPrompt(regenResult.statement, speakerLabel, regenResult.debaterClaims, priorClaims)
            : extractClaimsPrompt(regenResult.statement, speakerLabel, priorClaims);
          try {
            const { text: regenText } = await api.generateText(regenPrompt, model);
            const regenParsed = parseAIJson<{ claims?: typeof parsed.claims }>(regenText);

            if (!regenParsed?.claims || !Array.isArray(regenParsed.claims) || regenParsed.claims.length === 0) {
              regenAttempts.push({ ...bestResult, pass: false, tentative_claims: [], tentative_network_size: { nodes: 0, edges: 0 } });
              continue;
            }

            const taxEdgesRetry = useTaxonomyStore.getState().edgesFile?.edges;
            const regenClaims = processExtractedClaims(
              {
                claims: regenParsed.claims,
                statement: regenResult.statement,
                speaker,
                entryId,
                taxonomyRefIds: taxonomyRefs,
                turnNumber,
                existingNodes: an.nodes,
                existingEdgeCount: an.edges.length,
                startNodeId: an.nodes.length + 1,
                taxonomyEdges: taxEdgesRetry,
              },
              { groundingOverlapThreshold: 0.3, isClassifyPath: !!(regenResult.debaterClaims && regenResult.debaterClaims.length > 0) },
            );

            if (regenClaims.newNodes.length === 0) {
              regenAttempts.push({ ...bestResult, pass: false, tentative_claims: [], tentative_network_size: { nodes: 0, edges: 0 } });
              continue;
            }

            // Embed retry claims
            for (const node of regenClaims.newNodes) {
              try {
                const { vector } = await api.computeQueryEmbedding(node.text.slice(0, 300));
                if (vector && vector.length > 0) node.embedding = vector;
              } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', debate_id: debate.id, component: 'debate-store', level: 'warn', message: 'Regen claim embedding failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
            }

            // Per-claim evaluation on retry claims
            const { batchResult: retryResult, perClaim: retryPerClaim } = evaluateLookaheadPerClaim({
              speaker,
              existingNodes: an.nodes,
              existingEdges: an.edges,
              tentativeClaims: regenClaims.newNodes.map(n => ({ text: n.text, base_strength: n.base_strength ?? 0.5 })),
              tentativeEdges: regenClaims.newEdges,
              cruxes: debate.crux_tracker,
            });
            regenAttempts.push(retryResult);

            // Accumulate analysis from this attempt for subsequent retries
            const retryAnalysis = buildClaimAnalysis(retryPerClaim);
            perClaimAnalysisLog.push({ perClaim: retryPerClaim, analysis: retryAnalysis });
            // Merge: add new strong/avoid items, dedup by text
            const seenStrong = new Set(cumulativeStrong.map(s => s.text));
            for (const s of retryAnalysis.strongFoundations) {
              if (!seenStrong.has(s.text)) { cumulativeStrong.push(s); seenStrong.add(s.text); }
            }
            const seenAvoid = new Set(cumulativeAvoid.map(a => a.text));
            for (const a of retryAnalysis.avoidClaims) {
              if (!seenAvoid.has(a.text)) { cumulativeAvoid.push(a); seenAvoid.add(a.text); }
            }

            // Track the best attempt — use if it passes or beats previous best
            if (retryResult.pass || retryResult.utility_delta > bestResult.utility_delta) {
              bestResult = retryResult;
              bestPerClaim = retryPerClaim;
              bestNodes = regenClaims.newNodes;
              bestEdges = regenClaims.newEdges;
              bestStatement = regenResult.statement;
              console.log(`[Lookahead] Attempt ${attempt + 1} improved: Δu=${retryResult.utility_delta.toFixed(3)} (was ${firstResult.utility_delta.toFixed(3)})`);
            }

            // Stop early if we pass
            if (retryResult.pass) break;
          } catch (regenErr) {
            getGlobalRecorder()?.record({
              type: 'system.error',
              debate_id: debate.id,
              component: 'debate-store',
              level: 'warn',
              message: `Lookahead regen attempt ${attempt + 1} extraction failed`,
              error: { name: (regenErr as Error).name ?? 'Error', message: String(regenErr) },
            });
            console.warn(`[Lookahead] Regen attempt ${attempt + 1} extraction failed:`, regenErr);
            break;
          }
        }

        // Apply best result: update claims and transcript only if an attempt improved on the original
        if (bestResult !== firstResult) {
          newNodes.length = 0;
          newNodes.push(...bestNodes);
          newEdges.length = 0;
          newEdges.push(...bestEdges);
          extractionTrace.candidates_accepted = newNodes.length;

          // Update transcript entry with the best regenerated statement
          if (bestStatement) {
            const currDebate = get().activeDebate as DebateSession | null;
            if (currDebate) {
              const updatedTranscript = currDebate.transcript.map(e =>
                e.id === entryId ? { ...e, content: bestStatement!, metadata: { ...(e.metadata as Record<string, unknown>), lookahead_regenerated: true, lookahead_regen_attempts: regenAttempts.length } } : e,
              );
              phaseGuardedSet(get, set, { transcript: updatedTranscript });
            }
          }
        }

        lookaheadDiag = {
          stage: 'lookahead',
          first_attempt: firstResult,
          regen_triggered: true,
          regen_attempt: regenAttempts[regenAttempts.length - 1], // backwards compat
          regen_attempts: regenAttempts,
          per_claim_analysis: perClaimAnalysisLog,
          final_pass: bestResult !== firstResult && (bestResult.pass || bestResult.utility_delta > firstResult.utility_delta),
          elapsed_ms: Date.now() - lookaheadStart,
        };
      } else {
        // Gate passed or no regen callback — still record per-claim analysis for diagnostics
        const firstAnalysis = buildClaimAnalysis(firstPerClaim);
        lookaheadDiag = {
          stage: 'lookahead',
          first_attempt: firstResult,
          regen_triggered: false,
          per_claim_analysis: [{ perClaim: firstPerClaim, analysis: firstAnalysis }],
          final_pass: firstResult.pass,
          elapsed_ms: Date.now() - lookaheadStart,
        };
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        debate_id: debate.id,
        component: 'debate-store',
        level: 'warn',
        message: 'Lookahead pre-commit gate evaluation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      console.warn('[Lookahead] Pre-commit gate evaluation failed (non-blocking):', err);
    }
    // Filter WEAK claims from passing batches before commit (t/459)
    if (lookaheadDiag?.final_pass && debate.lookahead_filter_weak !== false && bestPerClaim) {
      const weakIndices = new Set(
        bestPerClaim.filter(pc => pc.classification === 'WEAK').map(pc => pc.index),
      );
      if (weakIndices.size > 0) {
        const filteredTexts = [...weakIndices].map(i => newNodes[i]?.text).filter(Boolean);
        const removedIds = new Set(newNodes.filter((_, i) => weakIndices.has(i)).map(n => n.id));
        newNodes.splice(0, newNodes.length, ...newNodes.filter((_, i) => !weakIndices.has(i)));
        newEdges.splice(0, newEdges.length, ...newEdges.filter(e => !removedIds.has(e.source) && !removedIds.has(e.target)));
        extractionTrace.candidates_accepted = newNodes.length;
        lookaheadDiag.filtered_weak_claims = filteredTexts;
        getGlobalRecorder()?.record({
          type: 'debate.lookahead.filter',
          debate_id: debate.id,
          component: 'debate-store',
          level: 'info',
          message: `Filtered ${weakIndices.size} WEAK claim(s) from passing lookahead batch`,
          data: { filtered_count: weakIndices.size, remaining_count: newNodes.length },
        });
      }
    }

    if (lookaheadDiag) recordDiagnostic(get, set, entryId, { lookahead: lookaheadDiag });

    extractionTrace.status = 'ok';

    const commitResult = commitAnNodes(
      get, set,
      `extract[speaker=${speaker},entry=${entryId.slice(-6)}]`,
      newNodes, newEdges,
      (fresh) => ({
        ...fresh,
        commitments: {
          ...(fresh?.commitments ?? commitments),
          [speaker]: speakerCommits,
        },
      }),
    );

    for (const a of diagAccepted) {
      if (commitResult.idMap[a.id]) a.id = commitResult.idMap[a.id];
    }
    extractionTrace.an_node_count_after = commitResult.idBase + newNodes.length;
    extractionTrace.an_nodes_added_ids = commitResult.assignedNodeIds;
    const expectedMinAnCount = commitResult.idBase + newNodes.length;

    await get().saveDebate('extractClaimsAndUpdateAN');
    checkAnInvariants(`post-save(extract,${entryId.slice(-6)})`, get, expectedMinAnCount);

    console.log(`[AN] Extracted ${newNodes.length} claims, ${newEdges.length} edges from ${speakerLabel}'s turn`);
    getGlobalRecorder()?.record({ type: 'an.commit', component: 'argument-network-extraction', level: 'info', debate_id: debate.id, turn_id: entryId, speaker, message: `Committed ${newNodes.length} nodes, ${newEdges.length} edges`, data: { new_nodes: newNodes.length, new_edges: newEdges.length, node_ids: commitResult.assignedNodeIds, an_nodes_after: commitResult.idBase + newNodes.length, rejected: diagRejected.length, rejection_reasons: claimsResult.rejectionReasons } });
    trace(TraceEventName.AN_EXTRACT_COMPLETE, {
      debate_id: debate.id,
      turn_id: entryId,
      speaker,
      accepted: newNodes.length,
      rejected: diagRejected.length,
      edges_added: newEdges.length,
      duration_ms: Date.now() - extractStartedAt,
    });

    // ── Post-extraction analytics (batched into a single set() to avoid re-render storm) ──
    const baseDebate = get().activeDebate;
    if (baseDebate?.argument_network) {
      const an = baseDebate.argument_network;
      const patches: Partial<typeof baseDebate> = {};

      // 1. QBAF strength propagation — computed ONCE, reused by convergence signals and GC
      const qNodes: QbafNode[] = an.nodes.map(n => ({ id: n.id, base_strength: n.base_strength ?? 0.5 }));
      const qEdges: QbafEdge[] = an.edges.map(e => ({
        source: e.source, target: e.target,
        type: e.type as 'attacks' | 'supports',
        weight: e.weight ?? 0.5,
        attack_type: e.attack_type,
      }));
      const qbafResult = computeQbafStrengths(qNodes, qEdges);
      getGlobalRecorder()?.record({ type: 'an.qbaf', component: 'qbaf', level: 'info', debate_id: baseDebate.id, turn_id: entryId, message: `QBAF propagation: ${qbafResult.iterations} iterations`, data: { iterations: qbafResult.iterations, converged: qbafResult.converged, node_count: qNodes.length } });
      let currentNodes = an.nodes.map(n => ({
        ...n,
        computed_strength: qbafResult.strengths.get(n.id) ?? n.computed_strength,
      }));
      let currentEdges = an.edges;

      // 2. Convergence tracker
      const getLabelForId = useTaxonomyStore.getState().getLabelForId;
      const turnNumber = an.nodes.length;
      patches.convergence_tracker = updateConvergenceTracker(
        baseDebate.convergence_tracker,
        { ...an, nodes: currentNodes },
        baseDebate.commitments || {},
        turnNumber,
        getLabelForId,
      );

      // 3. Unanswered claims ledger
      patches.unanswered_claims_ledger = updateUnansweredLedger(
        baseDebate.unanswered_claims_ledger ?? [],
        currentNodes,
        currentEdges,
        baseDebate.transcript.length,
      );

      // 4. Convergence signals (reuses QBAF strengths via precomputedStrengths param)
      if (entryId) {
        try {
          let turnEmbeddings: Map<string, number[]> | undefined;
          const cachedEmbeddings = { ...(baseDebate.turn_embeddings ?? {}) };
          try {
            const currentEntry = baseDebate.transcript.find((e: { id: string }) => e.id === entryId);
            if (currentEntry) {
              const { vector } = await api.computeQueryEmbedding(currentEntry.content.slice(0, 1000));
              cachedEmbeddings[entryId] = vector;
            }
            turnEmbeddings = new Map(Object.entries(cachedEmbeddings));
          } catch (e) {
            getGlobalRecorder()?.record({ type: 'system.error', debate_id: baseDebate.id, component: 'debate-store', level: 'warn', message: 'Convergence turn embedding failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } });
            if (Object.keys(cachedEmbeddings).length > 0) {
              turnEmbeddings = new Map(Object.entries(cachedEmbeddings));
            }
          }
          // Prune stale turn embeddings — keep only the most recent N entries
          const recentEntryIds = new Set(
            baseDebate.transcript.slice(-TURN_EMBEDDING_WINDOW).map((e: { id: string }) => e.id),
          );
          for (const key of Object.keys(cachedEmbeddings)) {
            if (!recentEntryIds.has(key)) delete cachedEmbeddings[key];
          }
          patches.turn_embeddings = cachedEmbeddings;

          const sig = computeConvergenceSignals(
            entryId,
            speaker,
            baseDebate.transcript,
            currentNodes,
            currentEdges,
            baseDebate.convergence_signals ?? [],
            turnEmbeddings,
            qbafResult.strengths,
            baseDebate.topic?.embedding,
            baseDebate.topic?.clause_embeddings,
          );
          patches.convergence_signals = [...(get().activeDebate?.convergence_signals ?? []), sig];
          getGlobalRecorder()?.record({ type: 'debate.signal', component: 'convergence-signals', level: 'info', debate_id: baseDebate.id, turn_id: entryId, speaker, message: 'Convergence signals computed', data: { round: sig.round, move_polarity: sig.move_polarity?.ratio, dialectical_engagement: sig.dialectical_engagement?.ratio, argument_redundancy: sig.argument_redundancy?.avg_self_overlap, crux_engagement_rate: sig.crux_engagement_rate?.cumulative_count } });

          // 4b. Process reward — continuous turn quality score (PRM-adjacent signal)
          const turnTrail = get().activeDebate?.turn_validations?.[entryId];
          const turnValidation = turnTrail?.final;
          if (turnValidation) {
            const currentEntry = baseDebate.transcript.find((e: { id: string }) => e.id === entryId);
            const entryMeta = currentEntry?.metadata as Record<string, unknown> | undefined;
            const moveTypes = (entryMeta?.move_types as (string | MoveAnnotation)[]) ?? [];
            const phase = ((entryMeta?.debate_phase as string) ?? 'argumentation') as DebatePhase;

            // Count prior turn's distinct moves for diversity comparison
            const priorSpeakerEntry = baseDebate.transcript
              .filter((e: { speaker: string; type: string }) => e.speaker === speaker && e.type === 'statement')
              .slice(-2)[0]; // second-to-last statement by this speaker
            const priorMeta = priorSpeakerEntry?.metadata as Record<string, unknown> | undefined;
            const priorMoves = (priorMeta?.move_types as (string | MoveAnnotation)[]) ?? [];

            const pr = computeProcessReward({
              convergenceSignals: sig,
              turnValidation,
              phase,
              moveCount: moveTypes.length,
              priorMoveCount: priorMoves.length > 0 ? priorMoves.length : undefined,
              taxonomyRefCount: currentEntry?.taxonomy_refs?.length ?? 0,
            });

            const prEntry: ProcessRewardEntry = {
              entry_id: entryId,
              round: sig.round,
              speaker,
              phase,
              score: pr.score,
              components: pr.components,
            };
            patches.process_rewards = [...(get().activeDebate?.process_rewards ?? []), prEntry];
            getGlobalRecorder()?.record({ type: 'debate.signal', component: 'process-reward', level: 'info', debate_id: baseDebate.id, turn_id: entryId, speaker, message: `Process reward: ${pr.score.toFixed(3)}`, data: { score: pr.score, ...pr.components } });
          }
        } catch (convErr) {
          getGlobalRecorder()?.record({
            type: 'system.error',
            debate_id: baseDebate.id,
            component: 'debate-store',
            level: 'warn',
            message: 'Convergence signal computation failed',
            error: { name: (convErr as Error).name ?? 'Error', message: String(convErr) },
          });
          console.warn('[Convergence] Signal computation failed (non-blocking):', convErr);
          pushWarning(get, set, 'Convergence analysis skipped this turn');
        }
      }

      // 5. Network GC (uses QBAF-updated computed_strength already on nodes)
      if (needsGc(currentNodes.length, GC_TRIGGER)) {
        const gcResult = pruneArgumentNetwork(currentNodes, currentEdges, GC_TARGET);
        if (gcResult.prunedNodes.length > 0) {
          currentNodes = gcResult.nodes;
          currentEdges = gcResult.edges;
          console.info(`[AN-GC] Pruned ${gcResult.before} → ${gcResult.after} nodes`);
          getGlobalRecorder()?.record({ type: 'an.gc', component: 'argument-network-extraction', level: 'info', debate_id: baseDebate.id, message: `Network GC: ${gcResult.before} → ${gcResult.after} nodes`, data: { nodes_before: gcResult.before, nodes_after: gcResult.after, edges_removed: gcResult.prunedNodes.length } });
        }
      }

      // 6. Crux resolution tracking
      try {
        patches.crux_tracker = updateCruxTracker(
          baseDebate.crux_tracker,
          currentNodes,
          currentEdges,
          baseDebate.commitments ?? {},
          turnNumber,
        );
      } catch (cruxErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          debate_id: baseDebate.id,
          component: 'debate-store',
          level: 'warn',
          message: 'Crux resolution tracker update failed',
          error: { name: (cruxErr as Error).name ?? 'Error', message: String(cruxErr) },
        });
        console.warn('[CruxResolution] Tracker update failed (non-blocking):', cruxErr);
        pushWarning(get, set, 'Crux resolution tracking skipped');
      }

      // Single batched state update — re-read fresh state to avoid clobbering
      // concurrent writes (turn_validations, position_drift, adaptive_staging)
      // from the main crossRespond flow which runs in parallel.
      const freshForBatch = get().activeDebate;
      if (freshForBatch) {
        set({
          activeDebate: {
            ...freshForBatch,
            ...patches,
            argument_network: { ...an, nodes: currentNodes, edges: currentEdges },
          },
        });
      }
    }

    // Steelman validation (non-blocking)
    const steelmanNodes = newNodes.filter(n => n.steelman_of);
    if (steelmanNodes.length > 0) {
      try {
        for (const sNode of steelmanNodes) {
          const targetPover = sNode.steelman_of!;
          const targetCommits = (get().activeDebate?.commitments?.[targetPover] as CommitmentStore | undefined);
          if (!targetCommits || targetCommits.asserted.length === 0) continue;

          const pairs = targetCommits.asserted.slice(-10).map(assertion => ({
            text_a: sNode.text,
            text_b: assertion,
          }));
          const nliResult = await api.nliClassify(pairs);
          const maxEntailment = Math.max(...nliResult.results.map(r => r.nli_entailment ?? 0));

          if (maxEntailment < 0.6) {
            const targetLabel = POVER_INFO[targetPover as Exclude<SpeakerId, 'user'>]?.label ?? targetPover;
            const speakerLbl = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label ?? speaker;
            const topAssertions = targetCommits.asserted.slice(-3).map(a => `"${a}"`).join('; ');

            const addEntry = get().addTranscriptEntry;
            if (addEntry) {
              const steelEntryId = addEntry({
                type: 'system',
                speaker: 'system',
                content: `[Steelman check] ${speakerLbl}'s steelman of ${targetLabel}'s position (max entailment: ${maxEntailment.toFixed(2)}) diverges from their actual assertions. ${targetLabel} actually asserted: ${topAssertions}`,
                taxonomy_refs: [],
              });
              recordDiagnostic(get, set, steelEntryId, {
                raw_response: JSON.stringify({ steelman_text: sNode.text, target_pover: targetPover, max_entailment: maxEntailment, nli_results: nliResult.results }),
                model: 'nli',
              });
            }
          }
        }
      } catch (nliErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          debate_id: debate.id,
          component: 'debate-store',
          level: 'warn',
          message: 'Steelman NLI validation failed',
          error: { name: (nliErr as Error).name ?? 'Error', message: String(nliErr) },
        });
        console.warn('[Steelman] NLI validation failed (non-blocking):', nliErr);
        pushWarning(get, set, 'Steelman validation skipped this turn');
      }
    }

    // Inline empirical claim verification (non-blocking)
    // Uses the same two-pass approach as the manual factCheckSelection path:
    //   Pass 1: grounded web search for evidence
    //   Pass 2: structured verdict analysis with the evidence
    const preciseBeliefs = newNodes.filter(n => n.bdi_category === 'belief' && n.specificity === 'precise');
    let factCheckMutated = false;
    for (const pNode of preciseBeliefs.slice(0, 2)) {
      try {
        const fcModel = getConfiguredModel();

        // Pass 1: web search for evidence (same as manual path)
        let webContext = '';
        let webQueries: string[] = [];
        let webCitations: import('../bridge/types').GroundingCitation[] = [];
        try {
          const searchResult = await api.generateTextWithSearch(
            `Fact-check this claim from an AI policy debate. Find recent, authoritative sources that support or contradict it. Be specific about what evidence you found.\n\nClaim: "${pNode.text}"`,
            fcModel,
          );
          webContext = searchResult.text;
          webQueries = searchResult.searchQueries || [];
          webCitations = searchResult.citations || [];
        } catch (searchErr) {
          getGlobalRecorder()?.record({
            type: 'system.error',
            debate_id: debate.id,
            component: 'debate-store',
            level: 'warn',
            message: `Inline verify web search failed for ${pNode.id}`,
            error: { name: (searchErr as Error).name ?? 'Error', message: String(searchErr) },
          });
          console.warn(`[Verify] Web search failed for ${pNode.id}, proceeding without:`, searchErr);
          pushWarning(get, set, 'Web verification unavailable for some claims');
          webContext = '(Web search unavailable)';
        }

        // Pass 2: structured verdict analysis with all evidence
        const verdictPrompt = buildFactCheckPrompt(
          pNode.text,
          pNode.text,
          '',
          webContext && webContext !== '(Web search unavailable)' ? `=== WEB SEARCH RESULTS ===\n${webContext}` : '',
          get().activeDebate?.audience,
        );
        const { text: vText } = await api.generateText(verdictPrompt, fcModel);
        let vParsed = parseAIJson<{ verdict?: string; explanation?: string; evidence?: string }>(vText);
        if (!vParsed) {
          vParsed = { verdict: 'unverifiable', evidence: vText.trim() };
        }
        const verdict = vParsed.verdict;
        const explanation = vParsed.explanation || vParsed.evidence || '';

        if (verdict) {
          pNode.verification_status = verdict;
          pNode.verification_evidence = explanation;

          // Update base_strength from fact-check verdict (theory-of-success §4.4)
          const fcConfidence = vParsed.confidence as string | undefined;
          pNode.base_strength = factCheckToBaseStrength(verdict, fcConfidence);
          pNode.scoring_method = 'fact_check';

          factCheckMutated = true;
          phaseGuardedSet(get, set, {});  // trigger re-render without clobbering phase

          if (verdict === 'disputed' || verdict === 'verified' || verdict === 'supported') {
            const addEntry = get().addTranscriptEntry;
            const hasWeb = !!webContext && webContext !== '(Web search unavailable)';
            const webNote = webQueries.length > 0
              ? `\n\n*Web sources consulted: ${webQueries.slice(0, 3).join(', ')}*`
              : hasWeb
                ? '\n\n*Verified against web search results*'
                : '';
            if (addEntry) {
              const verdictLabel = verdict === 'disputed' ? 'Disputed' : verdict === 'supported' ? 'Supported' : 'Verified';
              addEntry({
                type: 'fact-check',
                speaker: 'system',
                content: `**Fact Check: ${verdictLabel}**\n\n"${pNode.text.length > 120 ? pNode.text.slice(0, 117) + '...' : pNode.text}"\n\n${explanation}${webNote}`,
                taxonomy_refs: [],
                metadata: {
                  fact_check: {
                    verdict,
                    explanation,
                    checked_text: pNode.text,
                    web_search_used: hasWeb,
                    web_search_queries: webQueries.length ? webQueries : undefined,
                    web_search_evidence: hasWeb ? webContext : undefined,
                    web_search_citations: webCitations.length ? webCitations : undefined,
                    target_an_id: pNode.id,
                  },
                },
              });
            }

            // Create an AN node + edge capturing the fact-check finding so the
            // argument network reflects the evidence (mirrors manual fact-check path).
            const cur = get().activeDebate as DebateSession | null;
            if (cur) {
              const attackType = verdict === 'disputed' ? 'attacks' : 'supports';
              const factCheckEntryId = cur.transcript[cur.transcript.length - 1]?.id || entryId;
              const fcNode: ArgumentNetworkNode = {
                id: 'pending-fc-node',
                text: `Fact-check (${verdict}): ${explanation}`,
                speaker: 'system',
                source_entry_id: factCheckEntryId,
                taxonomy_refs: [],
                turn_number: cur.transcript.length,
                base_strength: attackType === 'attacks' ? 0.7 : 0.6,
                scoring_method: 'bdi_criteria',
                bdi_category: 'belief',
                specificity: 'precise',
              };
              const fcEdge: ArgumentNetworkEdge = {
                id: 'pending-fc-edge',
                source: 'pending-fc-node',
                target: pNode.id,
                type: attackType,
                attack_type: attackType === 'attacks' ? 'rebut' : undefined,
                scheme: attackType === 'attacks' ? 'EMPIRICAL CHALLENGE' : 'EXTEND',
                warrant: `Inline fact-check evidence (web search): ${String(explanation).slice(0, 100)}`,
                argumentation_scheme: 'ARGUMENT_FROM_EVIDENCE',
              };
              commitAnNodes(get, set, `factcheck(inline,pNode=${pNode.id})`, [fcNode], [fcEdge]);
              factCheckMutated = true;
            }
          }
        }
      } catch (verifyErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          debate_id: debate.id,
          component: 'debate-store',
          level: 'warn',
          message: `Inline verification failed for ${pNode.id}`,
          error: { name: (verifyErr as Error).name ?? 'Error', message: String(verifyErr) },
        });
        console.warn(`[Verify] Inline verification failed for ${pNode.id} (non-blocking):`, verifyErr);
        pushWarning(get, set, 'Claim verification skipped');
        pNode.verification_status = 'pending';
      }
    }
    try { await get().saveDebate('extractClaimsAndUpdateAN:postAnalytics'); } catch (saveErr) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        debate_id: debate.id,
        component: 'debate-store',
        level: 'warn',
        message: 'Failed to persist post-extraction analytics',
        error: { name: (saveErr as Error).name ?? 'Error', message: String(saveErr) },
      });
      console.warn('[Extract] Failed to persist post-extraction analytics:', saveErr);
      pushWarning(get, set, 'Post-extraction data could not be saved');
    }

    // Record claim extraction diagnostics
    recordDiagnostic(get, set, entryId, {
      extracted_claims: { accepted: diagAccepted, rejected: diagRejected },
      extraction_status: 'complete' as const,
    });
    commitTrace();

    // Broadcast updated state to popout
    try { api.sendDiagnosticsState({ debate: get().activeDebate, selectedEntry: get().selectedDiagEntry }); } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Diagnostics state broadcast failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'debate-store',
      level: 'error',
      message: 'Claim extraction failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err) },
    });
    console.warn('[AN] Claim extraction failed (non-blocking):', err);
    pushWarning(get, set, 'Argument extraction skipped this turn');
    if (!extractionTrace.error_message) extractionTrace.error_message = String(err);
    if (extractionTrace.status === 'ok') extractionTrace.status = 'adapter_error';
    try { commitTrace(); } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'commitTrace failed during error recovery', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
    recordDiagnostic(get, set, entryId, { extraction_status: 'failed' as const });
    detectZeroClaims(get, set, debate.id, entryId, speaker, sketchCount, 0, 'extraction_failed');
    trace(TraceEventName.AN_EXTRACT_FAILED, {
      debate_id: debate.id,
      turn_id: entryId,
      speaker,
      duration_ms: Date.now() - extractStartedAt,
      error: String(err),
    });
  }
}

// ── Turn-validator helpers ───────────────────────────────

export function getAllKnownNodeIds(): Set<string> {
  const s = new Set<string>();
  const state = useTaxonomyStore.getState();
  for (const pov of POV_KEYS) {
    for (const n of state[pov]?.nodes ?? []) s.add(n.id);
  }
  for (const n of state.situations?.nodes ?? []) s.add(n.id);
  return s;
}

export function getAllPolicyIds(): Set<string> {
  const s = new Set<string>();
  for (const p of useTaxonomyStore.getState().policyRegistry ?? []) s.add(p.id);
  return s;
}

export function findNodeMetaInStore(nodeId: string): { label: string; pov: string; description: string } | undefined {
  const state = useTaxonomyStore.getState();
  for (const pov of POV_KEYS) {
    const n = state[pov]?.nodes.find(x => x.id === nodeId);
    if (n) return { label: n.label, pov, description: n.description };
  }
  const sit = state.situations?.nodes.find(x => x.id === nodeId);
  if (sit) return { label: sit.label, pov: 'situations', description: sit.description };
  return undefined;
}

export function routeTurnValidatorHintsIntoSuggestions(
  validation: TurnValidation,
  entryId: string,
  existing: TaxonomySuggestion[] | undefined,
): TaxonomySuggestion[] {
  const out: TaxonomySuggestion[] = existing ? [...existing] : [];
  const HINT_TO_SUGGESTION = {
    narrow: 'narrow', broaden: 'broaden', split: 'split', merge: 'merge',
    qualify: 'qualify', retire: 'retire', new_node: 'new_node',
  } as const;

  for (const hint of validation.clarifies_taxonomy) {
    const type = HINT_TO_SUGGESTION[hint.action];
    if (!type) continue;

    if (type === 'new_node') {
      if (!hint.label) continue;
      if (out.some(s => s.source === 'turn-validator' && s.suggestion_type === 'new_node' && s.node_label === hint.label)) continue;
      out.push({
        node_id: `pending:${hint.label}`,
        node_label: hint.label,
        node_pov: 'unknown',
        suggestion_type: 'new_node',
        rationale: hint.rationale || 'Proposed mid-debate by the turn validator.',
        evidence_claim_ids: hint.evidence_claim_id ? [hint.evidence_claim_id] : undefined,
        source: 'turn-validator',
        origin_entry_id: entryId,
      });
      continue;
    }

    if (!hint.node_id) continue;
    if (out.some(s => s.source === 'turn-validator' && s.node_id === hint.node_id && s.suggestion_type === type)) continue;

    const meta = findNodeMetaInStore(hint.node_id);
    out.push({
      node_id: hint.node_id,
      node_label: meta?.label ?? hint.node_id,
      node_pov: meta?.pov ?? 'unknown',
      suggestion_type: type,
      current_description: meta?.description,
      rationale: hint.rationale || 'Surfaced mid-debate by the turn validator.',
      evidence_claim_ids: hint.evidence_claim_id ? [hint.evidence_claim_id] : undefined,
      source: 'turn-validator',
      origin_entry_id: entryId,
      merge_with_node_ids: type === 'merge' ? hint.node_ids : undefined,
    });
  }
  return out;
}

// ── Source evidence index (lazy-loaded once per session via IPC) ──
let _cachedEvidenceIndex: Record<string, unknown> | null | undefined;
export async function getSourceEvidenceIndex(): Promise<Record<string, unknown> | undefined> {
  if (_cachedEvidenceIndex !== undefined) return _cachedEvidenceIndex ?? undefined;
  try {
    const bridge = api as unknown as { loadSourceEvidenceIndex?: () => Promise<Record<string, unknown> | null> };
    console.log(`[debate-store] getSourceEvidenceIndex: bridge.loadSourceEvidenceIndex exists = ${!!bridge.loadSourceEvidenceIndex}`);
    if (!bridge.loadSourceEvidenceIndex) { _cachedEvidenceIndex = null; return undefined; }
    const result = await bridge.loadSourceEvidenceIndex();
    console.log(`[debate-store] getSourceEvidenceIndex: result = ${result ? `object with ${Object.keys(result).length} keys` : String(result)}`);
    _cachedEvidenceIndex = result;
    return result ?? undefined;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'debate-store',
      level: 'warn',
      message: 'Failed to load source evidence index',
      error: { name: (err as Error).name ?? 'Error', message: String(err) },
    });
    console.error(`[debate-store] getSourceEvidenceIndex ERROR:`, err);
    _cachedEvidenceIndex = null;
    return undefined;
  }
}

let _cachedDocTitles: Record<string, string> | null | undefined;
export async function getDocTitles(): Promise<Record<string, string> | undefined> {
  if (_cachedDocTitles !== undefined) return _cachedDocTitles ?? undefined;
  try {
    const bridge = api as unknown as { loadDocTitles?: () => Promise<Record<string, string> | null> };
    if (!bridge.loadDocTitles) { _cachedDocTitles = null; return undefined; }
    const result = await bridge.loadDocTitles();
    _cachedDocTitles = result;
    return result ?? undefined;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'debate-store',
      level: 'warn',
      message: 'Failed to load doc titles',
      error: { name: (err as Error).name ?? 'Error', message: String(err) },
    });
    _cachedDocTitles = null;
    return undefined;
  }
}

// ── Stage generate factory (shared by opening + cross-respond) ──

export function makeStageGenerate(
  set: (partial: Record<string, unknown>) => void,
  model: string,
): (prompt: string, callModel: string, options: { temperature?: number; timeoutMs?: number }, label: string) => Promise<string> {
  return async (prompt, callModel, options, label) => {
    set({ debateActivity: label, debateProgress: null });
    const unsubscribe = api.onGenerateTextProgress((progress: Record<string, unknown>) => {
      set({ debateProgress: normalizeProgress(progress) });
    });
    try {
      const result = await api.generateText(prompt, callModel || model, options.timeoutMs, options.temperature);
      return result.text;
    } finally {
      unsubscribe();
      set({ debateProgress: null, debateActivity: null });
    }
  };
}

// ── Taxonomy grounding helpers ───────────────────────────

/** Get taxonomy data from the taxonomy store for a given POV */
export function getTaxonomyContext(pov: string): TaxonomyContext {
  const state = useTaxonomyStore.getState();

  const povFile = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
  const povNodes: PovNode[] = povFile?.nodes ?? [];
  const situationNodes: SituationNode[] = state.situations?.nodes ?? [];
  const policyRegistry = (state.policyRegistry ?? []).map(p => ({ id: p.id, action: p.action, source_povs: p.source_povs }));

  return { povNodes, situationNodes, policyRegistry };
}

import type { NodeScoringSource, RelevanceSourceEntry } from './types';

export interface TaxonomyContextWithSources extends TaxonomyContext {
  nodeSourceMap?: Map<string, NodeScoringSource>;
}

/** Serialize nodeSourceMap to an array for storage on transcript entry metadata. Only includes refs actually used. */
export function serializeNodeSourceMap(
  sourceMap: Map<string, NodeScoringSource> | undefined,
  refs: { node_id: string }[],
): RelevanceSourceEntry[] | undefined {
  if (!sourceMap || sourceMap.size === 0) return undefined;
  const result: RelevanceSourceEntry[] = [];
  for (const ref of refs) {
    const src = sourceMap.get(ref.node_id);
    if (src) {
      result.push({
        node_id: ref.node_id,
        source: src.source,
        an_score: src.anScore,
        topic_score: src.topicScore,
        best_claim_id: src.bestClaimId,
        best_claim_text: src.bestClaimText,
        best_claim_sim: src.bestClaimSim,
      });
    }
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Get taxonomy context filtered by relevance to the debate topic.
 * Falls back to unfiltered if embeddings unavailable.
 */
export async function getRelevantTaxonomyContext(
  pov: string,
  topic: string,
  recentTranscript: string,
  threshold: number = 0.45,
): Promise<TaxonomyContextWithSources> {
  const state = useTaxonomyStore.getState();
  const povFile = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
  const allPovNodes: PovNode[] = povFile?.nodes ?? [];
  const allCCNodes: SituationNode[] = state.situations?.nodes ?? [];

  try {
    // Build a combined node embedding map for scoring (POV + CC nodes)
    const allNodeTexts = [
      ...allPovNodes.map(n => `${n.label}: ${n.description}`),
      ...allCCNodes.map(n => `${n.label}: ${n.description}`),
    ];
    const allNodeIds = [
      ...allPovNodes.map(n => n.id),
      ...allCCNodes.map(n => n.id),
    ];
    const { vectors: allVectors } = await api.computeEmbeddings(allNodeTexts, allNodeIds);
    const nodeEmbeddings: Record<string, { pov: string; vector: number[] }> = {};
    for (let i = 0; i < allNodeIds.length; i++) {
      nodeEmbeddings[allNodeIds[i]] = { pov, vector: allVectors[i] };
    }

    // Doctrinal anchoring: embed boundary strings once, then apply confidence floors to Beliefs
    if (!_doctrinalAnchoringApplied.has(pov)) {
      try {
        // Embed boundary strings (cached across POVs)
        if (!_boundaryEmbeddingsCache) {
          const boundaries: Record<string, string[]> = {};
          for (const p of AI_POVERS) {
            const info = POVER_INFO[p];
            if (info?.doctrinal_boundaries?.length > 0) {
              boundaries[info.pov] = info.doctrinal_boundaries;
            }
          }
          if (Object.keys(boundaries).length > 0) {
            _boundaryEmbeddingsCache = await embedDoctrinalBoundaries(
              boundaries,
              async (text: string) => {
                const { vector } = await api.computeQueryEmbedding(text);
                return vector;
              },
            );
          }
        }

        const boundaryVectors = _boundaryEmbeddingsCache?.[pov] ?? [];
        if (boundaryVectors.length > 0) {
          const beliefs = allPovNodes.filter(n => n.category === 'Beliefs');
          const results = computeDoctrinalAnchoring(beliefs, boundaryVectors, nodeEmbeddings);
          const anomaly = checkThresholdAnomalies(results, beliefs.length);
          if (anomaly) console.warn(anomaly.warning);
          const anchoredCount = results.filter(r => r.anchored).length;
          const floorCount = results.filter(r => r.floorApplied).length;
          if (anchoredCount > 0) {
            console.log(`[doctrinal] ${pov}: ${anchoredCount}/${beliefs.length} Beliefs anchored, ${floorCount} floor-applied`);
          }
        }
        _doctrinalAnchoringApplied.add(pov);
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'debate-store',
          level: 'warn',
          message: 'Doctrinal anchoring failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err) },
        });
        console.warn('[doctrinal] Anchoring failed (non-blocking):', err);
        _doctrinalAnchoringApplied.add(pov); // don't retry on failure
      }
    }

    // Collect AN claims and embed them for multi-claim relevance scoring
      const debate = useDebateStore.getState().activeDebate;
    const anNodes = debate?.argument_network?.nodes ?? [];
    let scores: Map<string, number>;
    let nodeSourceMap: Map<string, NodeScoringSource> | undefined;

    // Use pre-computed embeddings from AN nodes (set by t/442 on extraction)
    const embeddedAnNodes = anNodes.filter(n => n.embedding && n.embedding.length > 0);

    if (embeddedAnNodes.length > 0) {
      // AN-based scoring: use cached embeddings from extraction, score nodes by max similarity
      const claimEmbeddings: ANClaimEmbedding[] = embeddedAnNodes.map(n => ({
        id: n.id,
        vector: n.embedding!,
        strength: n.computed_strength,
      }));

      scores = scoreNodesViaAN(claimEmbeddings, nodeEmbeddings, undefined, true);
      console.log(`[taxonomy] AN-based scoring: ${claimEmbeddings.length}/${anNodes.length} claims (with embeddings) against ${allNodeIds.length} nodes`);

      // Also compute topic-only scores for hybrid source tracking
      const query = buildRelevanceQuery(topic, recentTranscript);
      const { vector: queryVector } = await api.computeQueryEmbedding(query);
      const topicScores = scoreNodeRelevance(queryVector, nodeEmbeddings);

      // Build per-node source tracking: which AN claim matched best, AN vs topic comparison
      nodeSourceMap = new Map<string, NodeScoringSource>();
      for (const nodeId of allNodeIds) {
        const anScore = scores.get(nodeId) ?? 0;
        const topicScore = topicScores.get(nodeId) ?? 0;
        const entry = nodeEmbeddings[nodeId];
        if (!entry?.vector) continue;

        // Find best matching AN claim for this node
        let bestSim = 0;
        let bestClaim: typeof claimEmbeddings[0] | null = null;
        for (const claim of claimEmbeddings) {
          const sim = cosineSimilarity(entry.vector, claim.vector);
          if (sim > bestSim) { bestSim = sim; bestClaim = claim; }
        }

        const anNode = bestClaim ? anNodes.find(n => n.id === bestClaim!.id) : null;
        nodeSourceMap.set(nodeId, {
          source: anScore >= topicScore * 0.5 ? 'an' : 'topic',
          anScore,
          topicScore,
          bestClaimId: bestClaim?.id,
          bestClaimText: anNode?.text,
          bestClaimSim: bestSim,
        });
      }
    } else {
      // No AN yet (pre-opening) — fall back to single topic query
      const query = buildRelevanceQuery(topic, recentTranscript);
      const { vector: queryVector } = await api.computeQueryEmbedding(query);
      scores = scoreNodeRelevance(queryVector, nodeEmbeddings);
      console.log(`[taxonomy] Topic-query scoring (no AN claims yet): ${allNodeIds.length} nodes`);
    }

    // Build relevance options with optional lineage boost
    const relevanceOpts: RelevanceOptions = { threshold, minPerCategory: 3, maxTotal: 35 };
    const lineageFrame = debate?.topic?.critique?.lineage_frame;
    getGlobalRecorder()?.record({
      type: 'lineage.boost-check',
      component: 'debate-store',
      level: 'debug',
      message: 'Lineage boost check',
      data: {
        has_lineage_frame: !!lineageFrame,
        frame_count: lineageFrame?.length ?? 0,
        lineage_data_loaded: isLineageDataLoaded(),
      },
    });
    if (lineageFrame && lineageFrame.length > 0 && isLineageDataLoaded()) {
      const mapping = getLineageMapping();
      const lineageByNode: Record<string, string[]> = {};
      for (const node of allPovNodes) {
        const ga = (node as { graph_attributes?: { intellectual_lineage?: (string | { name: string })[] } }).graph_attributes;
        const lineage = ga?.intellectual_lineage;
        if (lineage && lineage.length > 0) {
          lineageByNode[node.id] = lineage.map(v => typeof v === 'string' ? v : v.name);
        }
      }
      const nameToCluster: Record<string, string> = {};
      for (const [name, val] of Object.entries(mapping)) {
        nameToCluster[name] = val.l2;
      }
      relevanceOpts.lineageBoost = {
        traditions: lineageFrame.map(f => f.cluster_id),
        boost: 0.08,
        lineageByNode,
        nameToCluster,
      };
      getGlobalRecorder()?.record({
        type: 'lineage.boost-applied',
        component: 'debate-store',
        level: 'info',
        message: 'Lineage boost applied',
        data: {
          traditions: lineageFrame.map((f: { cluster_id: string; label?: string }) => f.label ?? f.cluster_id),
          node_count_with_lineage: Object.keys(lineageByNode).length,
          cluster_count: Object.keys(nameToCluster).length,
          boost_value: 0.08,
        },
      });
    } else if (lineageFrame) {
      getGlobalRecorder()?.record({
        type: 'lineage.boost-skipped',
        component: 'debate-store',
        level: 'warn',
        message: 'Lineage boost skipped',
        data: {
          reason: lineageFrame.length === 0 ? 'empty_frame' : 'data_not_loaded',
          frame_count: lineageFrame.length,
          lineage_data_loaded: isLineageDataLoaded(),
        },
      });
    }

    const scoredPov = selectRelevantNodes(allPovNodes, scores, relevanceOpts);
    const scoredCC = selectRelevantSituationNodes(allCCNodes, scores, threshold, 3, 15);

    // Log lineage boost outcome — confirms how many nodes were actually promoted
    const _lb = (scoredPov as unknown as { _lineageBoost?: { boostedNodeIds: string[]; promotedNodeIds: string[]; promotedCount: number } })._lineageBoost;
    if (_lb) {
      getGlobalRecorder()?.record({
        type: 'lineage.boost-result',
        component: 'debate-store',
        level: _lb.promotedCount > 0 ? 'info' : 'debug',
        message: _lb.promotedCount > 0
          ? `Lineage boost promoted ${_lb.promotedCount} nodes`
          : 'Lineage boost applied but promoted 0 nodes',
        data: { boosted_count: _lb.boostedNodeIds.length, promoted_count: _lb.promotedCount, promoted_node_ids: _lb.promotedNodeIds?.slice(0, 10), total_selected: scoredPov.length, total_candidates: allPovNodes.length },
      });
    }

    // Build injection manifest for diagnostics (mirrors debateEngine's _lastInjectionManifest)
    const injectionManifest: Record<string, unknown> = {
      povNodeIds: scoredPov.map(s => s.node.id),
      povPrimaryIds: scoredPov.filter(s => s.score >= threshold + 0.1).map(s => s.node.id).slice(0, 5),
      situationNodeIds: scoredCC.map(s => s.node.id),
    };
    if (_lb && _lb.boostedNodeIds.length > 0) {
      injectionManifest.lineage_boost = {
        boosted: _lb.boostedNodeIds.length,
        promoted: _lb.promotedCount,
        boostedNodeIds: _lb.boostedNodeIds.slice(0, 20),
        promotedNodeIds: _lb.promotedNodeIds.slice(0, 20),
      };
    }

    // Unwrap ScoredPovNode → PovNode and build nodeScores map
    const filteredPov = scoredPov.map(s => s.node);
    const filteredCC = scoredCC.map(s => s.node);
    const nodeScores = new Map<string, number>();
    for (const s of scoredPov) nodeScores.set(s.node.id, s.score);
    for (const s of scoredCC) nodeScores.set(s.node.id, s.score);

    console.log(`[taxonomy] Relevance-filtered: ${filteredPov.length} POV nodes (from ${allPovNodes.length}), ${filteredCC.length} CC nodes (from ${allCCNodes.length})`);

    // Situation divergence summary — surfaces interpretation alignment at debate setup
    {
      const withDiv = filteredCC.filter(n => n.interpretation_divergence != null);
      if (withDiv.length > 0) {
        const high = withDiv.filter(n => n.interpretation_divergence! > 0.40).length;
        const medium = withDiv.filter(n => n.interpretation_divergence! >= 0.20 && n.interpretation_divergence! <= 0.40).length;
        const low = withDiv.filter(n => n.interpretation_divergence! < 0.20).length;
        const mean = withDiv.reduce((s, n) => s + n.interpretation_divergence!, 0) / withDiv.length;
        const deprioritized = allCCNodes.filter(n => n.interpretation_divergence != null && n.interpretation_divergence < 0.20).length - low;
        getGlobalRecorder()?.record({
          type: 'situation.divergence-summary',
          component: 'debate-store',
          level: low > 0 ? 'warn' : 'info',
          message: `Situation divergence: ${high} high, ${medium} moderate, ${low} low (mean ${mean.toFixed(2)})`,
          data: {
            activated_count: withDiv.length,
            high_divergence: high,
            medium_divergence: medium,
            low_divergence: low,
            mean_divergence: Math.round(mean * 100) / 100,
            deprioritized_count: deprioritized > 0 ? deprioritized : 0,
          },
        });
      }
    }

    const policyRegistry = (state.policyRegistry ?? []).map(p => ({ id: p.id, action: p.action, source_povs: p.source_povs }));
    return { povNodes: filteredPov, situationNodes: filteredCC, policyRegistry, nodeScores, nodeSourceMap, injectionManifest };
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'debate-store',
      level: 'warn',
      message: 'Taxonomy relevance scoring failed, using unfiltered fallback',
      error: { name: (err as Error).name ?? 'Error', message: String(err) },
    });
    console.warn('[taxonomy] Relevance scoring failed, using unfiltered:', err);
    try {
      const s = useDebateStore.getState();
      if (s.debateWarnings.length < 50) {
        useDebateStore.setState({ debateWarnings: [...s.debateWarnings, 'Taxonomy relevance scoring unavailable'] });
      }
    } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Store not ready during relevance scoring fallback', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
    const policyRegistry = (state.policyRegistry ?? []).map(p => ({ id: p.id, action: p.action, source_povs: p.source_povs }));
    // Fallback: first 21 POV nodes + first 10 CC nodes
    return {
      povNodes: allPovNodes.slice(0, 21),
      situationNodes: allCCNodes.slice(0, 10),
      policyRegistry,
    };
  }
}

/** Format cross-POV tensions for injection into a specific debater's prompt */
export function formatDebaterEdgeContext(debaterPov: string): string {
  const edgesFile = useTaxonomyStore.getState().edgesFile;
  if (!edgesFile?.edges) return '';

  const povPrefixes: Record<string, string> = {
    accelerationist: 'acc-', safetyist: 'saf-', skeptic: 'skp-',
  };

  const myPrefix = povPrefixes[debaterPov];
  if (!myPrefix) return '';

  const otherPrefixes = Object.entries(povPrefixes)
    .filter(([pov]) => pov !== debaterPov)
    .map(([, prefix]) => prefix);

  const signalTypes = new Set(['CONTRADICTS', 'TENSION_WITH', 'WEAKENS']);

  // Find edges connecting this debater's POV to other POVs
  const relevantEdges = edgesFile.edges.filter(e => {
    if (!signalTypes.has(e.type)) return false;
    if (e.status !== 'approved' && e.confidence < 0.75) return false;
    const srcIsMine = e.source.startsWith(myPrefix);
    const tgtIsMine = e.target.startsWith(myPrefix);
    const srcIsOther = otherPrefixes.some(p => e.source.startsWith(p));
    const tgtIsOther = otherPrefixes.some(p => e.target.startsWith(p));
    return (srcIsMine && tgtIsOther) || (tgtIsMine && srcIsOther);
  });

  if (relevantEdges.length === 0) return '';

  // Take top 5-15 by confidence
  const top = relevantEdges
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 15);

  // Resolve node labels for readability
  const getLabel = (id: string): string => {
    const state = useTaxonomyStore.getState();
    for (const pov of POV_KEYS) {
      const node = state[pov]?.nodes?.find(n => n.id === id);
      if (node) return node.label;
    }
    return id;
  };

  const lines = [
    '',
    '=== KNOWN TENSIONS WITH OPPOSING POSITIONS ===',
    'These are documented structural disagreements between your position and other perspectives.',
    'Use these to target your arguments at real fault lines rather than talking past opponents.',
  ];
  for (const e of top) {
    const srcLabel = getLabel(e.source);
    const tgtLabel = getLabel(e.target);
    lines.push(`${e.source} (${srcLabel}) ${e.type} ${e.target} (${tgtLabel})`);
    if (e.rationale) {
      lines.push(`  ${e.rationale.slice(0, 150)}`);
    }
  }
  return lines.join('\n');
}

/** Format relevant edges between active debaters' nodes for the moderator */
export function formatEdgeContext(activePovers: string[]): string {
  const edgesFile = useTaxonomyStore.getState().edgesFile;
  if (!edgesFile?.edges) return '';

  // Map pover labels to POV prefixes
  const povPrefixes: Record<string, string> = {
    accelerationist: 'acc-', safetyist: 'saf-', skeptic: 'skp-',
  };
  const labelToPov: Record<string, string> = {
    Accelerationist: 'accelerationist', Safetyist: 'safetyist', Skeptic: 'skeptic',
    Prometheus: 'accelerationist', Sentinel: 'safetyist', Cassandra: 'skeptic',
  };

  // Find cross-POV edges of high-signal types
  const signalTypes = new Set(['CONTRADICTS', 'TENSION_WITH', 'WEAKENS', 'RESPONDS_TO']);
  const activePovs = activePovers.map(l => labelToPov[l]).filter(Boolean);
  const activePrefixes = activePovs.map(p => povPrefixes[p]).filter(Boolean);

  const relevantEdges = edgesFile.edges.filter(e => {
    if (!signalTypes.has(e.type)) return false;
    if (e.status !== 'approved' && e.confidence < 0.75) return false;
    // Must be cross-POV
    const srcPrefix = activePrefixes.find(p => e.source.startsWith(p));
    const tgtPrefix = activePrefixes.find(p => e.target.startsWith(p));
    return srcPrefix && tgtPrefix && srcPrefix !== tgtPrefix;
  });

  if (relevantEdges.length === 0) return '';

  // Take top edges by confidence
  const top = relevantEdges
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 15);

  const lines = ['', '=== KNOWN TENSIONS BETWEEN POSITIONS ==='];
  for (const e of top) {
    lines.push(`${e.source} ${e.type} ${e.target} (confidence: ${(e.confidence ?? 0).toFixed(2)})`);
  }
  return lines.join('\n');
}

// ── Prompt builders (delegate to prompts/debate.ts) ──────

export function buildClarificationPrompt(topic: string, sourceContent?: string, audience?: DebateAudience, lineageContext?: string): string {
  return clarificationPrompt(topic, sourceContent, audience, lineageContext);
}

/** Build lineage context string from pre-computed critique or fallback from all taxonomy nodes. */
export function buildLineageContext(): string | undefined {
  const debate = useDebateStore.getState().activeDebate;
  const lineageFrame = debate?.topic?.critique?.lineage_frame;
  if (lineageFrame && lineageFrame.length > 0) {
    return formatLineageContext(lineageFrame);
  }

  // Fallback: compute from all taxonomy nodes (document/situation debates without topic critique)
  if (!isLineageDataLoaded()) return undefined;
  const taxState = useTaxonomyStore.getState();
  const mapping = getLineageMapping();
  const l2Cats = getL2Categories();

  const allNodeIds: string[] = [];
  const lineageByNode: Record<string, string[]> = {};
  for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
    const file = taxState[pov];
    if (!file?.nodes) continue;
    for (const node of file.nodes) {
      allNodeIds.push(node.id);
      const ga = (node as { graph_attributes?: { intellectual_lineage?: (string | { name: string })[] } }).graph_attributes;
      const lineage = ga?.intellectual_lineage;
      if (lineage && lineage.length > 0) {
        lineageByNode[node.id] = lineage.map(v => typeof v === 'string' ? v : v.name);
      }
    }
  }

  const nameToCluster: Record<string, string> = {};
  for (const [name, val] of Object.entries(mapping)) {
    nameToCluster[name] = val.l2;
  }
  const clusterLabels: Record<string, string> = {};
  for (const cat of l2Cats) {
    clusterLabels[cat.id] = cat.label;
  }

  const frame = computeLineageDistribution({ activatedNodeIds: allNodeIds, lineageByNode, nameToCluster, clusterLabels });
  if (frame.length === 0) return undefined;
  return formatLineageContext(frame);
}

export function buildSynthesisPrompt(
  originalTopic: string,
  clarifications: { speaker: string; questions: string[]; answers: string }[],
  audience?: DebateAudience,
  critique?: TopicCritique | null,
): string {
  let qaPairs = '';
  for (const c of clarifications) {
    qaPairs += `\n${c.speaker} asked:\n`;
    for (const q of c.questions) qaPairs += `  - ${q}\n`;
    qaPairs += `User answered: ${c.answers}\n`;
  }
  const critiqueContext = critique ? formatCritiqueForRefinement(critique) : undefined;
  return concludingPrompt(originalTopic, qaPairs, audience, critiqueContext);
}


export function buildDebateResponsePrompt(
  poverId: Exclude<SpeakerId, 'user'>,
  topic: string,
  taxonomyContext: string,
  recentTranscript: string,
  question: string,
  addressing: string,
  sourceContent?: string,
  length: string = 'medium',
  docAnalysis?: DocumentAnalysis,
  audience?: DebateAudience,
): string {
  const info = POVER_INFO[poverId];
  return debateResponsePrompt(info.label, info.pov, info.personality, topic, taxonomyContext, recentTranscript, question, addressing, sourceContent, length, docAnalysis, audience, buildLineageContext());
}

export function formatGapHint(gapInjections?: GapInjection[]): string {
  const args = gapInjections?.[0]?.arguments;
  if (!args || args.length === 0) return '';
  const lines = args.map((g, i) =>
    `  ${i + 1}. [${g.gap_type}] ${g.argument} (Why missing: ${g.why_missing})`,
  );
  return `\n\n## Identified Debate Gaps (unaddressed)\nThe following gaps were identified mid-debate but have NOT yet been substantively addressed by any debater. Prioritize steering the conversation toward these:\n${lines.join('\n')}\n`;
}



export function buildCrossRespondPrompt(
  poverId: Exclude<SpeakerId, 'user'>,
  topic: string,
  taxonomyContext: string,
  recentTranscript: string,
  focusPoint: string,
  addressing: string,
  length: string = 'medium',
  sourceContent?: string,
  docAnalysis?: DocumentAnalysis,
): string {
  const info = POVER_INFO[poverId];
  return crossRespondPrompt(info.label, info.pov, info.personality, topic, taxonomyContext, recentTranscript, focusPoint, addressing, length, sourceContent, docAnalysis, info.doctrinal_boundaries);
}

export function buildDebateSynthesisPrompt(
  topic: string,
  transcript: string,
  hasSourceDocument: boolean = false,
  audience?: DebateAudience,
): string {
  // Include policy registry context for synthesis analysis
  const policyRegistry = useTaxonomyStore.getState().policyRegistry ?? [];
  let policyContext = '';
  if (policyRegistry.length > 0) {
    const policyLines = policyRegistry.slice(0, 30).map(p => `${p.id}: ${p.action}`);
    policyContext = `\n\n=== POLICY REGISTRY (reference pol-NNN IDs for policy implications) ===\n${policyLines.join('\n')}`;
  }
  return debateSynthesisPrompt(topic, transcript, hasSourceDocument, policyContext, audience);
}

export function buildProbingQuestionsPrompt(
  topic: string,
  transcript: string,
  unreferencedNodes: string[],
  hasSourceDocument: boolean = false,
  audience?: DebateAudience,
): string {
  return probingQuestionsPrompt(topic, transcript, unreferencedNodes, hasSourceDocument, undefined, audience);
}

export function buildFactCheckPrompt(
  selectedText: string,
  statementContext: string,
  taxonomyNodes: string,
  conflictData: string,
  audience?: DebateAudience,
): string {
  return factCheckPrompt(selectedText, statementContext, taxonomyNodes, conflictData, audience);
}

export function buildContextCompressionPrompt(
  entries: string,
  audience?: DebateAudience,
): string {
  return contextCompressionPrompt(entries, audience);
}

// ── Reflection helpers ───────────────────────────────────

export function defaultGraphAttributes(pov: Pov, category: Category): GraphAttributes {
  const epistemicByCategory: Record<Category, string> = {
    Beliefs: 'empirical_claim',
    Desires: 'normative_prescription',
    Intentions: 'strategic_recommendation',
  };
  const scopeByCategory: Record<Category, 'claim' | 'scheme'> = {
    Beliefs: 'claim',
    Desires: 'claim',
    Intentions: 'scheme',
  };
  const rhetoricalByPov: Record<Pov, string> = {
    accelerationist: 'techno_optimism',
    safetyist: 'precautionary_framing',
    skeptic: 'structural_critique',
  };
  const emotionalByPov: Record<Pov, string> = {
    accelerationist: 'aspirational',
    safetyist: 'cautionary',
    skeptic: 'measured',
  };
  return {
    epistemic_type: epistemicByCategory[category],
    rhetorical_strategy: rhetoricalByPov[pov],
    emotional_register: emotionalByPov[pov],
    node_scope: scopeByCategory[category],
    assumes: [],
    falsifiability: 'medium',
  };
}

// ── Reflection types ─────────────────────────────────────


/** Helper to get node label for fact check (standalone, no React hooks) */
export function getNodeLabelForFactCheck(nodeId: string): string {
  const state = useTaxonomyStore.getState();
  if (nodeTypeFromId(nodeId) === 'situation') {
    const node = state.situations?.nodes?.find((n: { id: string }) => n.id === nodeId);
    return node?.label || nodeId;
  }
  const povMap: Record<string, string> = { 'acc-': 'accelerationist', 'saf-': 'safetyist', 'skp-': 'skeptic' };
  for (const [prefix, pov] of Object.entries(povMap)) {
    if (nodeId.startsWith(prefix)) {
      const povFile = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
      const node = povFile?.nodes?.find((n: { id: string }) => n.id === nodeId);
      return node?.label || nodeId;
    }
  }
  return nodeId;
}
