// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import type {
  DebateSession,
  DebateSessionSummary,
  DebateSourceType,
  DebateAudience,
  SpeakerId,
  TranscriptEntry,
  TaxonomyRef,
} from '../types/debate';
import { POVER_INFO, AI_POVERS, POV_KEYS, normalizeActivePovers, migrateSpeakerId } from '../types/debate';
import type { PovNode, CrossCuttingNode as SituationNode, GraphAttributes, Category, Pov } from '../types/taxonomy';
import { useTaxonomyStore } from './useTaxonomyStore';

declare const __APP_VERSION__: string;
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { mapErrorToUserMessage } from '../utils/errorMessages';
import { formatTaxonomyContext } from '../utils/taxonomyContext';
import type { TaxonomyContext } from '../utils/taxonomyContext';
import { extractClaimsPrompt, classifyClaimsPrompt, formatArgumentNetworkContext, formatCommitments, formatEstablishedPoints, updateUnansweredLedger, formatConcessionCandidatesHint, processExtractedClaims, computeClaimTaxonomyAttribution } from '../prompts/argumentNetwork';
import type { ArgumentNetworkNode, ArgumentNetworkEdge, CommitmentStore, EntryDiagnostics, DebateDiagnostics, DocumentAnalysis, ClaimExtractionTrace, ExtractionSummary, GapArgument, GapInjection, CrossCuttingProposal, TaxonomyGapAnalysis } from '../types/debate';
import { cosineSimilarity, scoreNodeRelevance, selectRelevantNodes, selectRelevantSituationNodes, buildRelevanceQuery, scoreNodesViaAN, scoreNodesLexical } from '../utils/taxonomyRelevance';
import type { ANClaimEmbedding, RelevanceOptions } from '../utils/taxonomyRelevance';
import { trace, newCallId, TraceEventName } from '../lib/trace';
import { documentAnalysisPrompt, buildTaxonomySample, documentAnalysisContext } from '@lib/debate/documentAnalysis';
import { updateConvergenceTracker } from '../utils/convergenceScoring';
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
} from '../prompts/debate';
import { checkDolceCompliance } from '../utils/dolceCompliance';
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
import type { TurnAttempt, TurnValidation, TurnValidationTrail, TaxonomySuggestion } from '../types/debate';
import { formatVocabularyContext } from '@lib/debate/vocabularyContext';
import { evaluateLookaheadPerClaim, buildClaimAnalysis } from '@lib/debate/lookaheadGate';
import type { LookaheadDiagnostics, LookaheadGateResult, ClaimAnalysis, PerClaimResult } from '@lib/debate/lookaheadGate';
import { computeStructuralScore, critiqueTopicPrompt, parseTopicCritique, formatCritiqueForRefinement, formatStructuralContext, computeLineageDistribution, formatLineageContext } from '@lib/debate/topicCritique';
import type { TopicCritique, LineageFrameEntry } from '@lib/debate/topicCritique';
import { shouldRunGapCheck, findUnengagedHighRelevanceNodes, collectEngagedNodeIds, MAX_GAP_INJECTIONS } from '@lib/debate/gapCheck';
import { runNeutralEvaluation, buildSpeakerMapping } from '@lib/debate/neutralEvaluator';
import type { NeutralEvaluation, SpeakerMapping } from '@lib/debate/neutralEvaluator';
import { computeBeliefConfidence } from '@lib/debate/beliefConfidence';
import { computeTreePriority } from '@lib/debate/desirePriority';
import { embedDoctrinalBoundaries, computeDoctrinalAnchoring, checkThresholdAnomalies } from '@lib/debate/doctrinalAnchoring';
import type { BoundaryEmbeddings } from '@lib/debate/doctrinalAnchoring';
import { computeOperationality } from '@lib/debate/intentionOperationality';
import type { StandardizedTerm, ColloquialTerm } from '@lib/dictionary/types';
import { usePromptConfigStore } from './usePromptConfigStore';
import { api } from '@bridge';
import { getLineageMapping, getL2Categories, isLineageDataLoaded } from '../data/lineageCategories';

// ── Doctrinal anchoring cache ────────────────────────────────────────
// Tracks which POVs have had doctrinal anchoring applied in this session.
// Once anchored, PovNode objects are mutated in place (doctrinally_anchored, confidence floor).
let _doctrinalAnchoringApplied = new Set<string>();
let _boundaryEmbeddingsCache: BoundaryEmbeddings | null = null;

/** Reset doctrinal anchoring cache (call when debate changes or taxonomy reloads). */
function resetDoctrinalAnchoringCache(): void {
  _doctrinalAnchoringApplied = new Set();
  _boundaryEmbeddingsCache = null;
}

// ── Adaptive staging signal history ──────────────────────────────────
// Per-round signal values for priorSignals.get() and priorSignals.movingAverage().
// Keyed by signal ID → array of { round, value } entries.
const _signalHistory = new Map<string, { round: number; value: number }[]>();

function recordSignalHistory(signalId: string, round: number, value: number): void {
  let arr = _signalHistory.get(signalId);
  if (!arr) { arr = []; _signalHistory.set(signalId, arr); }
  // Replace if same round, otherwise append
  const existing = arr.findIndex(e => e.round === round);
  if (existing >= 0) arr[existing].value = value;
  else arr.push({ round, value });
}

function getSignalValue(signalId: string, roundsBack: number): number | null {
  const arr = _signalHistory.get(signalId);
  if (!arr || arr.length === 0) return null;
  if (roundsBack <= 0) return arr[arr.length - 1]?.value ?? null;
  const idx = arr.length - 1 - roundsBack;
  return idx >= 0 ? arr[idx].value : null;
}

function movingAverageSignal(signalId: string, windowSize: number): number | null {
  const arr = _signalHistory.get(signalId);
  if (!arr || arr.length < windowSize) return null;
  const slice = arr.slice(-windowSize);
  return slice.reduce((sum, e) => sum + e.value, 0) / slice.length;
}

function resetSignalHistory(): void {
  _signalHistory.clear();
}

// ── Gap injection counter ────────────────────────────────────────────
let _gapInjectionCount = 0;
function resetGapInjectionCount(): void { _gapInjectionCount = 0; }

// ── Neutral evaluation speaker mapping ──────────────────────────────
let _neutralMapping: SpeakerMapping | null = null;
function resetNeutralMapping(): void { _neutralMapping = null; }

/** Fire-and-forget neutral evaluation at a checkpoint. Non-blocking, never throws. */
async function runNeutralCheckpoint(
  checkpoint: 'baseline' | 'midpoint' | 'final',
  get: () => ReturnType<typeof useDebateStore.getState>,
  set: (partial: Partial<ReturnType<typeof useDebateStore.getState>>) => void,
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

    // Store on session
    const freshDebate = get().activeDebate;
    if (!freshDebate) return;
    const existing = freshDebate.neutral_evaluations ?? [];
    set({
      activeDebate: {
        ...freshDebate,
        neutral_evaluations: [...existing, evaluation],
        neutral_speaker_mapping: _neutralMapping!,
      },
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

    getGlobalRecorder()?.record({ type: 'state.change', component: 'neutral-eval', level: 'info', message: `neutral.${checkpoint}`, data: { cruxes: cruxCount, claims: claimCount, engaging: evaluation.overall_assessment?.debate_is_engaging_real_disagreement } });
  } catch (err) {
    console.warn(`[Neutral Eval] ${checkpoint} failed (non-blocking):`, err);
    getGlobalRecorder()?.record({ type: 'state.error', component: 'neutral-eval', level: 'warn', message: `neutral.${checkpoint}.failed`, data: { error: String(err) } });
  }
}

/** Read the model for the current debate context.
 *  Priority: debate-specific override > global Settings model > default */
function getConfiguredModel(): string {
  // Check debate-specific model first
  // eslint-disable-next-line @typescript-eslint/no-use-before-define -- store defined below, safe at call-time
  const debateModel = useDebateStore.getState().debateModel;
  if (debateModel) {
    console.log(`[model] Using debate-specific model: ${debateModel}`);
    return debateModel;
  }
  try {
    const globalModel = localStorage.getItem('taxonomy-editor-gemini-model') || 'gemini-flash-lite-latest';
    console.log(`[model] Using global model: ${globalModel}`);
    return globalModel;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Failed to read configured model from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    return 'gemini-flash-lite-latest';
  }
}

/**
 * Enrich policy_refs with per-policy relevance from the draft stage.
 * The cite stage produces bare string IDs; the draft stage produces
 * {policy_id, relevance} objects. Merge to get the best of both.
 */
function enrichPolicyRefs(
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
function normalizeProgress(p: Record<string, unknown>): { attempt: number; maxRetries: number; backoffSeconds?: number; limitType?: string; limitMessage?: string; phase?: string } {
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
async function generateTextWithProgress(
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
async function summarizeTranscriptEntry(
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
    // eslint-disable-next-line @typescript-eslint/no-use-before-define -- store defined below, safe at call-time
    const s = useDebateStore.getState();
    if (s.debateWarnings.length < 50) {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      useDebateStore.setState({ debateWarnings: [...s.debateWarnings, 'Entry summarization failed — detail level pills unavailable'] });
    }
  } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Store not ready during summarizeEntry warning push', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
}

/**
 * Guard against race conditions in async debate operations.
 * Captures the active debate ID at call time; returns a checker that
 * verifies the debate hasn't changed during an await.
 */
function createDebateGuard(get: () => { activeDebateId: string | null }): () => boolean {
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

let _abortController: AbortController | null = null;

const AI_POVER_ORDER = AI_POVERS;

/** Maximum number of turn embeddings to retain (enough for recycling detection). */
const TURN_EMBEDDING_WINDOW = 30;

/** Push a user-visible warning into debateWarnings state (capped at 50). */
function pushWarning(

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
function recordDiagnostic(

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

  const updatedDebate = { ...debate, diagnostics: diag };
  set({ activeDebate: updatedDebate });

  // Broadcast to popout window
  try { api.sendDiagnosticsState({ debate: updatedDebate, selectedEntry: get().selectedDiagEntry }); } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Diagnostics broadcast to popout failed (recordDiagnostic)', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
}

/** djb2 hash for prompt fingerprinting. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/** Heuristic: does response body look cut off mid-JSON? */
function looksTruncated(s: string): boolean {
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
function updateExtractionSummary(

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

function snapshotAnLengths(get: () => any): { nodeCount: number; edgeCount: number; maxNodeId: number } {
  const d = get().activeDebate;
  const an = d?.argument_network ?? { nodes: [], edges: [] };
  let maxId = 0;
  for (const n of an.nodes) {
    const m = /^AN-(\d+)$/.exec(n.id);
    if (m) { const k = parseInt(m[1], 10); if (k > maxId) maxId = k; }
  }
  return { nodeCount: an.nodes.length, edgeCount: an.edges.length, maxNodeId: maxId };
}

function assertNoDuplicateAnIds(label: string, existing: { id: string }[], incoming: { id: string }[]): void {
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

interface AnCommitResult {
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
function commitAnNodes<N extends { id: string }, E extends { id: string; source: string }>(

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
  const updated = {
    ...base,
    argument_network: {
      nodes: [...freshAn.nodes, ...newNodes],
      edges: [...freshAn.edges, ...newEdges],
    },
  };
  set({ activeDebate: updated });

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
function checkAnInvariants(label: string, get: () => any, expectedMinCount: number): void {
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
type LookaheadRegenCallback = (guidance: {
  strongFoundations?: ClaimAnalysis['strongFoundations'];
  avoidClaims?: ClaimAnalysis['avoidClaims'];
}) => Promise<{
  statement: string;
  debaterClaims?: { claim: string; targets: string[] }[];
} | null>;

async function extractClaimsAndUpdateAN(
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

  const extractStartedAt = Date.now();
  const anCountBefore = an.nodes.length;
  const turnRound = (debate.transcript?.length ?? 0) + 1;
  const EXTRACTION_PROMPT_VERSION = 'v1.4';
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
    let cleaned = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
    const fb = cleaned.indexOf('{'), lb = cleaned.lastIndexOf('}');
    if (fb >= 0 && lb > fb) cleaned = cleaned.slice(fb, lb + 1);
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

    let parsed: { claims?: { text: string; bdi_category?: string; base_strength?: number; bdi_sub_scores?: Record<string, number>; specificity?: string; steelman_of?: string | null; responds_to?: { prior_claim_id: string; relationship: string; attack_type?: string; weight?: number; scheme?: string; argumentation_scheme?: string; warrant?: string }[] }[] };
    try {
      parsed = JSON.parse(cleaned) as typeof parsed;
    } catch (parseErr) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'error',
        message: 'Claim extraction JSON parse failed',
        error: { name: (parseErr as Error).name ?? 'Error', message: String(parseErr) },
      });
      extractionTrace.status = extractionTrace.response_truncated ? 'truncated_response' : 'parse_error';
      extractionTrace.error_message = String(parseErr);
      commitTrace();
      throw parseErr;
    }
    if (!parsed.claims || !Array.isArray(parsed.claims)) {
      extractionTrace.status = 'empty_response';
      commitTrace();
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
      } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'AN node embedding failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
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
          getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Claim taxonomy attribution failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } });
          // Attribution failure never blocks extraction
        }
      }
    }

    // ── Pre-commit lookahead gate (t/34) — evaluate before committing ──
    let lookaheadDiag: LookaheadDiagnostics | undefined;
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
            let regenCleaned = regenText.replace(/```json\s*/g, '').replace(/```/g, '').trim();
            const rfb = regenCleaned.indexOf('{'), rlb = regenCleaned.lastIndexOf('}');
            if (rfb >= 0 && rlb > rfb) regenCleaned = regenCleaned.slice(rfb, rlb + 1);
            regenCleaned = regenCleaned.replace(/,\s*([}\]])/g, '$1');
            const regenParsed = JSON.parse(regenCleaned) as { claims?: typeof parsed.claims };

            if (!regenParsed.claims || !Array.isArray(regenParsed.claims) || regenParsed.claims.length === 0) {
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
              } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Regen claim embedding failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
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
              set({ activeDebate: { ...currDebate, transcript: updatedTranscript } });
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
        component: 'debate-store',
        level: 'warn',
        message: 'Lookahead pre-commit gate evaluation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      console.warn('[Lookahead] Pre-commit gate evaluation failed (non-blocking):', err);
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
            getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Convergence turn embedding failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } });
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
          patches.convergence_signals = [...(baseDebate.convergence_signals ?? []), sig];
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
            patches.process_rewards = [...(baseDebate.process_rewards ?? []), prEntry];
            getGlobalRecorder()?.record({ type: 'debate.signal', component: 'process-reward', level: 'info', debate_id: baseDebate.id, turn_id: entryId, speaker, message: `Process reward: ${pr.score.toFixed(3)}`, data: { score: pr.score, ...pr.components } });
          }
        } catch (convErr) {
          getGlobalRecorder()?.record({
            type: 'system.error',
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
          component: 'debate-store',
          level: 'warn',
          message: 'Crux resolution tracker update failed',
          error: { name: (cruxErr as Error).name ?? 'Error', message: String(cruxErr) },
        });
        console.warn('[CruxResolution] Tracker update failed (non-blocking):', cruxErr);
        pushWarning(get, set, 'Crux resolution tracking skipped');
      }

      // Single batched state update — one spread, one React re-render
      set({
        activeDebate: {
          ...baseDebate,
          ...patches,
          argument_network: { ...an, nodes: currentNodes, edges: currentEdges },
        },
      });
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
          const currentDebate = get().activeDebate;
          if (currentDebate) set({ activeDebate: { ...currentDebate } });

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
    if (factCheckMutated) {
      try { await get().saveDebate('extractClaimsAndUpdateAN:verify'); } catch (saveErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'debate-store',
          level: 'warn',
          message: 'Failed to persist inline fact-check mutations',
          error: { name: (saveErr as Error).name ?? 'Error', message: String(saveErr) },
        });
        console.warn('[Verify] Failed to persist inline fact-check mutations:', saveErr);
        pushWarning(get, set, 'Fact-check results could not be saved');
      }
    }

    // Record claim extraction diagnostics
    recordDiagnostic(get, set, entryId, {
      extracted_claims: { accepted: diagAccepted, rejected: diagRejected },
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

function getAllKnownNodeIds(): Set<string> {
  const s = new Set<string>();
  const state = useTaxonomyStore.getState();
  for (const pov of POV_KEYS) {
    for (const n of state[pov]?.nodes ?? []) s.add(n.id);
  }
  for (const n of state.situations?.nodes ?? []) s.add(n.id);
  return s;
}

function getAllPolicyIds(): Set<string> {
  const s = new Set<string>();
  for (const p of useTaxonomyStore.getState().policyRegistry ?? []) s.add(p.id);
  return s;
}

function findNodeMetaInStore(nodeId: string): { label: string; pov: string; description: string } | undefined {
  const state = useTaxonomyStore.getState();
  for (const pov of POV_KEYS) {
    const n = state[pov]?.nodes.find(x => x.id === nodeId);
    if (n) return { label: n.label, pov, description: n.description };
  }
  const sit = state.situations?.nodes.find(x => x.id === nodeId);
  if (sit) return { label: sit.label, pov: 'situations', description: sit.description };
  return undefined;
}

function routeTurnValidatorHintsIntoSuggestions(
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
async function getSourceEvidenceIndex(): Promise<Record<string, unknown> | undefined> {
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
async function getDocTitles(): Promise<Record<string, string> | undefined> {
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

function makeStageGenerate(
  set: (partial: Record<string, unknown>) => void,
  model: string,
): (prompt: string, _model: string, options: { temperature?: number; timeoutMs?: number }, label: string) => Promise<string> {
  return async (prompt, _model, options, label) => {
    set({ debateActivity: label, debateProgress: null });
    const unsubscribe = api.onGenerateTextProgress((progress: Record<string, unknown>) => {
      set({ debateProgress: normalizeProgress(progress) });
    });
    try {
      const result = await api.generateText(prompt, model, options.timeoutMs, options.temperature);
      return result.text;
    } finally {
      unsubscribe();
      set({ debateProgress: null, debateActivity: null });
    }
  };
}

// ── Taxonomy grounding helpers ───────────────────────────

/** Get taxonomy data from the taxonomy store for a given POV */
function getTaxonomyContext(pov: string): TaxonomyContext {
  const state = useTaxonomyStore.getState();

  const povFile = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
  const povNodes: PovNode[] = povFile?.nodes ?? [];
  const situationNodes: SituationNode[] = state.situations?.nodes ?? [];
  const policyRegistry = (state.policyRegistry ?? []).map(p => ({ id: p.id, action: p.action, source_povs: p.source_povs }));

  return { povNodes, situationNodes, policyRegistry };
}

/** Per-node scoring source tracking for diagnostics display. */
export interface NodeScoringSource {
  source: 'an' | 'topic';
  anScore: number;
  topicScore: number;
  bestClaimId?: string;
  bestClaimText?: string;
  bestClaimSim?: number;
}

/** Extended TaxonomyContext with per-node scoring source info for diagnostics. */
interface TaxonomyContextWithSources extends TaxonomyContext {
  nodeSourceMap?: Map<string, NodeScoringSource>;
}

/** Serialized per-ref source info for storage on transcript entry metadata. */
export interface RelevanceSourceEntry {
  node_id: string;
  source: 'an' | 'topic';
  an_score: number;
  topic_score: number;
  best_claim_id?: string;
  best_claim_text?: string;
  best_claim_sim?: number;
}

/** Serialize nodeSourceMap to an array for storage on transcript entry metadata. Only includes refs actually used. */
function serializeNodeSourceMap(
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
async function getRelevantTaxonomyContext(
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
    // eslint-disable-next-line @typescript-eslint/no-use-before-define -- store defined below, safe at call-time
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
        level: 'info',
        message: 'Lineage boost result after selectRelevantNodes',
        data: { boosted_count: _lb.boostedNodeIds.length, promoted_count: _lb.promotedCount, promoted_node_ids: _lb.promotedNodeIds, total_selected: scoredPov.length, total_candidates: allPovNodes.length },
      });
    }

    // Unwrap ScoredPovNode → PovNode and build nodeScores map
    const filteredPov = scoredPov.map(s => s.node);
    const filteredCC = scoredCC.map(s => s.node);
    const nodeScores = new Map<string, number>();
    for (const s of scoredPov) nodeScores.set(s.node.id, s.score);
    for (const s of scoredCC) nodeScores.set(s.node.id, s.score);

    console.log(`[taxonomy] Relevance-filtered: ${filteredPov.length} POV nodes (from ${allPovNodes.length}), ${filteredCC.length} CC nodes (from ${allCCNodes.length})`);

    const policyRegistry = (state.policyRegistry ?? []).map(p => ({ id: p.id, action: p.action, source_povs: p.source_povs }));
    return { povNodes: filteredPov, situationNodes: filteredCC, policyRegistry, nodeScores, nodeSourceMap };
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'debate-store',
      level: 'warn',
      message: 'Taxonomy relevance scoring failed, using unfiltered fallback',
      error: { name: (err as Error).name ?? 'Error', message: String(err) },
    });
    console.warn('[taxonomy] Relevance scoring failed, using unfiltered:', err);
    // Surface warning via store — useDebateStore is defined below but accessible at call time
    try {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      const s = useDebateStore.getState();
      if (s.debateWarnings.length < 50) {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
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
function formatDebaterEdgeContext(debaterPov: string): string {
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
function formatEdgeContext(activePovers: string[]): string {
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

function buildClarificationPrompt(topic: string, sourceContent?: string, audience?: DebateAudience, lineageContext?: string): string {
  return clarificationPrompt(topic, sourceContent, audience, lineageContext);
}

/** Build lineage context string from pre-computed critique or fallback from all taxonomy nodes. */
function buildLineageContext(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-use-before-define -- store defined below, safe at call-time
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

function buildSynthesisPrompt(
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


function buildDebateResponsePrompt(
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
  return debateResponsePrompt(info.label, info.pov, info.personality, topic, taxonomyContext, recentTranscript, question, addressing, sourceContent, length, docAnalysis, audience);
}

function formatGapHint(gapInjections?: GapInjection[]): string {
  const args = gapInjections?.[0]?.arguments;
  if (!args || args.length === 0) return '';
  const lines = args.map((g, i) =>
    `  ${i + 1}. [${g.gap_type}] ${g.argument} (Why missing: ${g.why_missing})`,
  );
  return `\n\n## Identified Debate Gaps (unaddressed)\nThe following gaps were identified mid-debate but have NOT yet been substantively addressed by any debater. Prioritize steering the conversation toward these:\n${lines.join('\n')}\n`;
}



function buildCrossRespondPrompt(
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

function buildDebateSynthesisPrompt(
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

function buildProbingQuestionsPrompt(
  topic: string,
  transcript: string,
  unreferencedNodes: string[],
  hasSourceDocument: boolean = false,
  audience?: DebateAudience,
): string {
  return probingQuestionsPrompt(topic, transcript, unreferencedNodes, hasSourceDocument, undefined, audience);
}

function buildFactCheckPrompt(
  selectedText: string,
  statementContext: string,
  taxonomyNodes: string,
  conflictData: string,
  audience?: DebateAudience,
): string {
  return factCheckPrompt(selectedText, statementContext, taxonomyNodes, conflictData, audience);
}

function buildContextCompressionPrompt(
  entries: string,
  audience?: DebateAudience,
): string {
  return contextCompressionPrompt(entries, audience);
}

// ── Reflection helpers ───────────────────────────────────

function defaultGraphAttributes(pov: Pov, category: Category): GraphAttributes {
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

export interface ReflectionEdit {
  edit_type: 'revise' | 'add' | 'qualify' | 'deprecate';
  node_id: string | null;
  category: 'Beliefs' | 'Desires' | 'Intentions';
  current_label: string | null;
  proposed_label: string;
  current_description: string | null;
  proposed_description: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  evidence_entries: string[];
  status: 'pending' | 'approved' | 'dismissed';
}

export interface ReflectionResult {
  pover: string;
  label: string;
  reflection_summary: string;
  edits: ReflectionEdit[];
}

// ── Consensus detection types ────────────────────────────

export interface ConsensusProposal {
  pov: string;
  editIndex: number;
  proposed_label: string;
  proposed_description: string;
  rationale: string;
  evidence_entries: string[];
}

export interface ConsensusCluster {
  id: string;
  proposals: ConsensusProposal[];
  similarityScores: Record<string, number>; // e.g. "acc-saf": 0.82
  status: 'pending' | 'accepted' | 'rejected';
}

// ── Store interface ──────────────────────────────────────

interface DebateStore {
  // Session list
  sessions: DebateSessionSummary[];
  sessionsLoading: boolean;

  // Active debate
  activeDebateId: string | null;
  activeDebate: DebateSession | null;
  debateLoading: boolean;
  debateGenerating: SpeakerId | null;
  debateError: string | null;
  responseLength: 'claims' | 'brief' | 'medium' | 'detailed' | 'reasoning' | 'convergence';
  setResponseLength: (length: 'claims' | 'brief' | 'medium' | 'detailed' | 'reasoning' | 'convergence') => void;
  audience: DebateAudience;
  setAudience: (audience: DebateAudience) => void;
  /** Set display tier for a specific transcript entry (DT-3). */
  setEntryDisplayTier: (entryId: string, tier: 'claims' | 'brief' | 'medium' | 'detailed' | 'reasoning' | 'convergence') => void;
  debateProgress: { attempt: number; maxRetries: number; backoffSeconds?: number; limitType?: string; limitMessage?: string; phase?: string } | null;
  debateActivity: string | null; // human-readable description of what's happening
  inspectedNodeId: string | null; // Phase 6: node currently shown in pane 3
  debateModel: string | null; // debate-specific model override (null = use global)
  debateTemperature: number | null; // debate-specific temperature (null = use default 0.7)
  vocabularyTerms: { standardized: StandardizedTerm[]; colloquial: ColloquialTerm[] } | null;
  diagnosticsEnabled: boolean;
  selectedDiagEntry: string | null; // transcript entry ID selected for diagnostics
  diagPopoutOpen: boolean;
  debateWarnings: string[];

  // Actions
  clearWarnings: () => void;
  cancelDebate: () => void;
  toggleDiagnostics: () => void;
  selectDiagEntry: (entryId: string | null, force?: boolean) => void;
  setDiagPopoutOpen: (open: boolean) => void;
  inspectNode: (nodeId: string | null) => void;
  loadSessions: () => Promise<void>;
  createDebate: (topic: string, povers: SpeakerId[], userIsPover: boolean, sourceType?: DebateSourceType, sourceRef?: string, sourceContent?: string, debateModel?: string, protocolId?: string, debateTemperature?: number, debateAudience?: DebateAudience, options?: { evaluatorModel?: string; pacing?: string; useAdaptiveStaging?: boolean }) => Promise<string>;
  createSituationDebate: (ccNodeId: string) => Promise<string>;
  createConflictDebate: (claimId: string) => Promise<string>;
  loadDebate: (id: string) => Promise<void>;
  deleteDebate: (id: string) => Promise<void>;
  renameDebate: (id: string, newTitle: string) => Promise<void>;
  closeDebate: () => void;
  addTranscriptEntry: (entry: Omit<TranscriptEntry, 'id' | 'timestamp'>) => string;
  deleteTranscriptEntries: (entryIds: string[]) => Promise<void>;
  togglePover: (poverId: SpeakerId) => Promise<void>;
  updatePhase: (phase: DebateSession['phase']) => void;
  updateTopic: (topic: Partial<DebateSession['topic']>) => void;
  saveDebate: (caller?: string) => Promise<void>;
  setGenerating: (pover: SpeakerId | null) => void;
  setError: (error: string | null) => void;

  // Phase 1.5: Topic Critique (wisdom-generating quality gate)
  topicCritiqueLoading: boolean;
  runTopicCritique: () => Promise<void>;
  reEvaluateSuggestedTopic: (suggestedText: string) => Promise<void>;

  // Phase 2: Clarification
  runClarification: () => Promise<void>;
  submitAnswersAndSynthesize: (answers: string) => Promise<void>;
  beginDebate: () => Promise<void>;

  // Phase 2.5: Edit Claims (document/URL debates only)
  updateClaim: (claimId: string, newText: string) => void;
  deleteClaim: (claimId: string) => void;
  proceedToOpening: () => void;

  // Phase 3: Opening Statements
  openingOrder: Exclude<SpeakerId, 'user'>[];
  setOpeningOrder: (order: Exclude<SpeakerId, 'user'>[]) => void;
  initialCrossRespondRounds: number;
  setInitialCrossRespondRounds: (n: number) => void;
  runOpeningStatements: () => Promise<void>;
  submitUserOpening: (statement: string) => Promise<void>;

  // Phase 4: Main Debate Loop
  askQuestion: (input: string) => Promise<void>;
  crossRespond: () => Promise<void>;

  // Phase 5: Synthesis & Probing
  requestSynthesis: () => Promise<void>;
  requestProbingQuestions: () => Promise<void>;

  // Gap analysis features
  gapInjections: GapInjection[];
  crossCuttingProposals: CrossCuttingProposal[];
  taxonomyGapAnalysis: TaxonomyGapAnalysis | null;

  // Phase 6: Reflections
  reflections: ReflectionResult[];
  consensusClusters: ConsensusCluster[];
  requestReflections: () => Promise<void>;
  applyReflectionEdit: (pover: string, editIndex: number, overrides?: { label?: string; description?: string }) => Promise<{ ok: boolean; error?: string }>;
  dismissReflectionEdit: (pover: string, editIndex: number) => void;
  acceptConsensus: (clusterId: string) => Promise<{ ok: boolean; error?: string }>;
  rejectConsensus: (clusterId: string) => void;

  // News Report
  newsReport: string | null;
  newsReportLoading: boolean;
  newsReportError: string | null;
  generateNewsReport: () => Promise<void>;

  // AN node editing
  updateAnNodeSubScore: (nodeId: string, key: string, value: number) => void;

  // Phase 7: Fact Check
  factCheckSelection: (selectedText: string, entryId: string) => Promise<void>;

  // Phase 8: Context Window Management
  compressOldTranscript: () => Promise<void>;
}

export const useDebateStore = create<DebateStore>((set, get) => ({
  sessions: [],
  sessionsLoading: false,
  activeDebateId: null,
  activeDebate: null,
  debateLoading: false,
  debateGenerating: null,
  responseLength: 'detailed',
  setResponseLength: (length) => {
    set({ responseLength: length });
    // Clear per-entry display_tier overrides so all entries follow the new default
    const debate = get().activeDebate;
    if (debate) {
      let changed = false;
      for (const entry of debate.transcript) {
        if (entry.display_tier) {
          entry.display_tier = undefined;
          changed = true;
        }
      }
      if (changed) set({ activeDebate: { ...debate } });
    }
  },
  audience: 'policymakers' as DebateAudience,
  setAudience: (audience) => {
    set({ audience });
    const debate = get().activeDebate;
    if (debate) {
      debate.audience = audience;
      set({ activeDebate: { ...debate } });
    }
  },
  setEntryDisplayTier: (entryId, tier) => {
    const debate = get().activeDebate;
    if (!debate) return;
    const entry = debate.transcript.find(e => e.id === entryId);
    if (!entry) return;
    entry.display_tier = tier;
    set({ activeDebate: { ...debate } });
  },
  openingOrder: [],
  setOpeningOrder: (order) => set({ openingOrder: order }),
  initialCrossRespondRounds: 3,
  setInitialCrossRespondRounds: (n) => set({ initialCrossRespondRounds: n }),
  debateError: null,
  debateProgress: null,
  debateActivity: null,
  gapInjections: [],
  crossCuttingProposals: [],
  taxonomyGapAnalysis: null,
  reflections: [],
  consensusClusters: [],
  newsReport: null,
  newsReportLoading: false,
  newsReportError: null,
  inspectedNodeId: null,
  debateModel: null,
  debateTemperature: null,
  vocabularyTerms: null,
  topicCritiqueLoading: false,
  diagnosticsEnabled: false,
  selectedDiagEntry: null,
  diagPopoutOpen: false,
  debateWarnings: [],

  clearWarnings: () => set({ debateWarnings: [] }),
  cancelDebate: () => {
    _abortController?.abort();
    _abortController = null;
    set({ debateGenerating: null, debateActivity: null });
  },
  toggleDiagnostics: () => {
    const enabled = !get().diagnosticsEnabled;
    set({ diagnosticsEnabled: enabled });
    // Initialize diagnostics on the active debate if enabling
    if (enabled && get().activeDebate && !get().activeDebate!.diagnostics) {
      const updated = {
        ...get().activeDebate!,
        diagnostics: {
          enabled: true,
          entries: {},
          overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
        },
      };
      set({ activeDebate: updated });
    }
    // Auto-open popup window when enabling; close when disabling
    if (enabled) {
      void api.openDiagnosticsWindow().then(() => {
        set({ diagPopoutOpen: true });
        setTimeout(() => {
          api.sendDiagnosticsState({ debate: get().activeDebate, selectedEntry: get().selectedDiagEntry });
        }, 1000);
      }).catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Failed to open diagnostics window', error: { name: (err as Error).name ?? 'Error', message: String(err) } }); });
    } else {
      try { void api.closeDiagnosticsWindow?.(); } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Failed to close diagnostics window', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
      set({ diagPopoutOpen: false });
    }
  },

  selectDiagEntry: (entryId, force) => {
    set({ selectedDiagEntry: entryId });
    // Broadcast to popout diagnostics window
    try {
      const debate = get().activeDebate;
      api.sendDiagnosticsState({ debate, selectedEntry: entryId, forceSelect: !!force });
    } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Diagnostics state broadcast to popout failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
  },

  setDiagPopoutOpen: (open) => set({ diagPopoutOpen: open }),

  loadSessions: async () => {
    set({ sessionsLoading: true });
    try {
      const raw = await api.listDebateSessionsMeta();
      set({ sessions: raw as DebateSessionSummary[], sessionsLoading: false });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'error',
        message: 'Failed to load debate sessions',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      set({ sessionsLoading: false });
    }
  },

  createDebate: async (topic, povers, userIsPover, sourceType = 'topic', sourceRef = '', sourceContent = '', debateModel, protocolId, debateTemperature, debateAudience, options) => {
    resetDoctrinalAnchoringCache();
    resetNeutralMapping();
    resetSignalHistory();
    resetGapInjectionCount();
    const id = generateId();
    const now = nowISO();
    const title = topic.length > 60 ? topic.slice(0, 57) + '...' : topic;
    const session: DebateSession = {
      id,
      title,
      created_at: now,
      updated_at: now,
      app_version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined,
      audience: debateAudience ?? get().audience,
      phase: 'setup',
      topic: {
        original: topic,
        refined: null,
        final: topic,
      },
      source_type: sourceType,
      source_ref: sourceRef,
      source_content: sourceContent,
      active_povers: povers,
      user_is_pover: userIsPover,
      transcript: [],
      context_summaries: [],
      generated_with_prompt_version: 'dolce-phase-1',
      debate_model: debateModel || undefined,
      evaluator_model: options?.evaluatorModel || undefined,
      protocol_id: protocolId || 'structured',
      debate_temperature: debateTemperature ?? undefined,
      adaptive_staging: options?.useAdaptiveStaging
        ? { enabled: true, pacing: (options.pacing as 'tight' | 'moderate' | 'thorough') ?? 'moderate' }
        : undefined,
      origin: { mode: 'gui' },
    };
    await api.saveDebateSession(session);
    // Initialize opening order with shuffled AI povers so the setup screen can show it
    const aiPoversForOrder = AI_POVER_ORDER.filter(p => povers.includes(p));
    const shuffledOrder = [...aiPoversForOrder];
    for (let i = shuffledOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledOrder[i], shuffledOrder[j]] = [shuffledOrder[j], shuffledOrder[i]];
    }
    set({ activeDebateId: id, activeDebate: session, debateModel: debateModel || null, debateTemperature: debateTemperature ?? null, openingOrder: shuffledOrder });
    void api.setDebateTemperature(debateTemperature ?? null);
    await get().loadSessions();
    getGlobalRecorder()?.record({ type: 'lifecycle', component: 'debate-store', level: 'info', debate_id: id, message: 'Debate created', data: { topic: title, povers, protocol: protocolId, model: debateModel } });
    return id;
  },

  createSituationDebate: async (ccNodeId: string) => {
    const taxState = useTaxonomyStore.getState();
    const ccNode = taxState.situations?.nodes.find(n => n.id === ccNodeId);
    if (!ccNode) throw new Error(`Situation node ${ccNodeId} not found`);

    // Resolve linked node descriptions
    const linkedNodeDescriptions: string[] = [];
    for (const linkedId of ccNode.linked_nodes) {
      for (const pov of POV_KEYS) {
        const file = taxState[pov];
        const node = file?.nodes.find(n => n.id === linkedId);
        if (node) {
          linkedNodeDescriptions.push(`[${node.id}] ${node.label}: ${node.description}`);
          break;
        }
      }
    }

    // Resolve conflict summaries
    const conflictSummaries: string[] = [];
    for (const conflictId of ccNode.conflict_ids) {
      const conflict = taxState.conflicts.find(c => c.claim_id === conflictId);
      if (conflict) {
        const stances = conflict.instances.map(i => `${i.doc_id}: ${i.stance}`).join('; ');
        conflictSummaries.push(`[${conflict.claim_id}] ${conflict.claim_label} — ${conflict.description} (${stances})`);
      }
    }

    const attrs = ccNode.graph_attributes as Record<string, unknown> | undefined;
    const sourceContent = formatSituationDebateContext({
      id: ccNode.id,
      label: ccNode.label,
      description: ccNode.description,
      interpretations: ccNode.interpretations,
      assumes: attrs?.assumes as string[] | undefined,
      steelmanVulnerability: attrs?.steelman_vulnerability as string | undefined,
      possibleFallacies: attrs?.possible_fallacies as { fallacy: string; confidence: string; explanation: string }[] | undefined,
      linkedNodeDescriptions,
      conflictSummaries,
    });

    const topic = ccNode.label;
    const allPovers = [...AI_POVERS] as SpeakerId[];

    const id = await get().createDebate(topic, allPovers, false, 'situations', ccNodeId, sourceContent);
    await get().loadDebate(id);
    get().updatePhase('clarification');
    await get().saveDebate('createSituationDebate');
    return id;
  },

  createConflictDebate: async (claimId: string) => {
    const taxState = useTaxonomyStore.getState();
    const conflict = taxState.conflicts.find(c => c.claim_id === claimId);
    if (!conflict) throw new Error(`Conflict ${claimId} not found`);

    // Build structured context from the conflict
    const lines: string[] = [
      `=== CONFLICT: ${conflict.claim_id} ===`,
      `Claim: ${conflict.claim_label}`,
      `Description: ${conflict.description}`,
      `Status: ${conflict.status}`,
    ];

    if (conflict.instances.length > 0) {
      lines.push('', '=== DOCUMENTED INSTANCES ===');
      for (const inst of conflict.instances) {
        lines.push(`- [${inst.doc_id}] (${inst.stance}): ${inst.assertion}`);
      }
    }

    // Resolve linked node descriptions
    if (conflict.linked_taxonomy_nodes.length > 0) {
      lines.push('', '=== LINKED TAXONOMY NODES ===');
      for (const linkedId of conflict.linked_taxonomy_nodes) {
        for (const pov of POV_KEYS) {
          const file = taxState[pov];
          const node = file?.nodes.find(n => n.id === linkedId);
          if (node) {
            lines.push(`[${node.id}] ${node.label}: ${node.description}`);
            break;
          }
        }
        // Also check situations
        const sitNode = taxState.situations?.nodes.find(n => n.id === linkedId);
        if (sitNode) {
          lines.push(`[${sitNode.id}] ${sitNode.label}: ${sitNode.description}`);
        }
      }
    }

    if (conflict.human_notes.length > 0) {
      lines.push('', '=== HUMAN NOTES ===');
      for (const note of conflict.human_notes) {
        lines.push(`- ${note.author} (${note.date}): ${note.note}`);
      }
    }

    const sourceContent = lines.join('\n');
    const topic = `Conflict: ${conflict.claim_label}`;
    const allPovers = [...AI_POVERS] as SpeakerId[];

    // createDebate saves to disk and sets activeDebate directly — no need for loadDebate
    const id = await get().createDebate(topic, allPovers, false, 'topic', claimId, sourceContent);
    get().updatePhase('clarification');
    await get().saveDebate('createConflictDebate');
    return id;
  },

  loadDebate: async (id) => {
    resetDoctrinalAnchoringCache();
    resetSignalHistory();
    resetGapInjectionCount();
    resetNeutralMapping();
    set({ debateLoading: true, debateError: null, debateWarnings: [], newsReport: null, newsReportLoading: false, newsReportError: null });
    try {
      const raw = await api.loadDebateSession(id);
      const session = raw as DebateSession;
      // Speaker migration shim: normalize legacy character names → POV keys
      // Old debates stored ['prometheus','sentinel','cassandra'] instead of ['accelerationist','safetyist','skeptic']
      session.active_povers = normalizeActivePovers(session.active_povers);
      for (const entry of session.transcript) {
        entry.speaker = migrateSpeakerId(entry.speaker) as SpeakerId;
      }
      if (session.opening_order) {
        session.opening_order = session.opening_order.map(s => migrateSpeakerId(s)) as typeof session.opening_order;
      }
      if (session.argument_network?.nodes) {
        for (const node of session.argument_network.nodes) {
          node.speaker = migrateSpeakerId(node.speaker);
        }
      }

      // BDI migration shim: normalize legacy bdi_layer values in synthesis entries
      for (const entry of session.transcript) {
        if (entry.type === 'concluding' && entry.metadata?.synthesis) {
          const synthesis = entry.metadata.synthesis as { areas_of_disagreement?: { bdi_layer?: string }[] };
          if (Array.isArray(synthesis.areas_of_disagreement)) {
            for (const d of synthesis.areas_of_disagreement) {
              if (d.bdi_layer) {
                d.bdi_layer = normalizeBdiLayer(d.bdi_layer as Parameters<typeof normalizeBdiLayer>[0]);
              }
            }
          }
        }
      }
      set({ activeDebateId: id, activeDebate: session, debateLoading: false, debateModel: session.debate_model || null, debateTemperature: session.debate_temperature ?? null, audience: session.audience ?? 'policymakers', openingOrder: session.opening_order ?? [] });
      // Restore gap injection count from loaded session
      _gapInjectionCount = session.gap_injections?.length ?? 0;
      // Load prompt config from session (Phase B)
      usePromptConfigStore.getState().loadSessionConfig(
        (session as Record<string, unknown>).prompt_config as Record<string, number | boolean | string> | undefined
      );
      // Set temperature on the main process
      void api.setDebateTemperature(session.debate_temperature ?? null);
      getGlobalRecorder()?.record({ type: 'state.load', component: 'debate-store', level: 'info', debate_id: id, message: 'Debate loaded', data: { phase: session.phase, transcript_length: session.transcript.length, an_nodes: (session as Record<string, unknown>).argument_network ? ((session as Record<string, unknown>).argument_network as { nodes?: unknown[] }).nodes?.length ?? 0 : 0 } });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'state.error', component: 'debate-store', level: 'error', debate_id: id, message: 'Failed to load debate', error: { name: 'LoadError', message: String(err) } });
      set({ debateLoading: false, debateError: mapErrorToUserMessage(err) });
    }
  },

  deleteDebate: async (id) => {
    try {
      await api.deleteDebateSession(id);
      const { activeDebateId } = get();
      if (activeDebateId === id) {
        set({ activeDebateId: null, activeDebate: null, debateModel: null });
      }
      await get().loadSessions();
      getGlobalRecorder()?.record({ type: 'lifecycle', component: 'debate-store', level: 'info', debate_id: id, message: 'Debate deleted' });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'error',
        message: 'Failed to delete debate',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      set({ debateError: mapErrorToUserMessage(err) });
    }
  },

  renameDebate: async (id, newTitle) => {
    try {
      const raw = await api.loadDebateSession(id);
      const session = raw as DebateSession;
      session.active_povers = normalizeActivePovers(session.active_povers);
      session.title = newTitle;
      session.updated_at = nowISO();
      await api.saveDebateSession(session);
      // Update active debate if it's the one being renamed
      if (get().activeDebateId === id) {
        set({ activeDebate: session });
      }
      await get().loadSessions();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'error',
        message: 'Failed to rename debate',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      set({ debateError: mapErrorToUserMessage(err) });
    }
  },

  closeDebate: () => {
    const closingId = get().activeDebateId;
    set({ activeDebateId: null, activeDebate: null, debateError: null, debateWarnings: [], debateGenerating: null, debateModel: null, debateTemperature: null, vocabularyTerms: null });
    void api.setDebateTemperature(null);
    usePromptConfigStore.getState().resetSession();
    if (closingId) getGlobalRecorder()?.record({ type: 'lifecycle', component: 'debate-store', level: 'info', debate_id: closingId, message: 'Debate closed' });
  },

  addTranscriptEntry: (entry) => {
    const { activeDebate } = get();
    const entryId = generateId();
    if (!activeDebate) return entryId;
    const full: TranscriptEntry = {
      ...entry,
      id: entryId,
      timestamp: nowISO(),
    };
    const updated: DebateSession = {
      ...activeDebate,
      updated_at: nowISO(),
      transcript: [...activeDebate.transcript, full],
    };
    set({ activeDebate: updated });
    return entryId;
  },

  deleteTranscriptEntries: async (entryIds) => {
    const { activeDebate, saveDebate } = get();
    if (!activeDebate) return;
    const idsToRemove = new Set(entryIds);
    const filtered = activeDebate.transcript.filter(e => !idsToRemove.has(e.id));

    // Clean up orphaned diagnostics entries
    let diagnostics = activeDebate.diagnostics;
    if (diagnostics) {
      const cleanedEntries = { ...diagnostics.entries };
      for (const id of idsToRemove) {
        delete cleanedEntries[id];
      }
      diagnostics = { ...diagnostics, entries: cleanedEntries };
    }

    // Clean up orphaned AN nodes and edges referencing deleted entries
    let an = activeDebate.argument_network;
    if (an) {
      const removedNodeIds = new Set<string>();
      const cleanedNodes = an.nodes.filter(n => {
        if (n.source_entry_id && idsToRemove.has(n.source_entry_id)) {
          removedNodeIds.add(n.id);
          return false;
        }
        return true;
      });
      const cleanedEdges = an.edges.filter(e =>
        !removedNodeIds.has(e.source) && !removedNodeIds.has(e.target),
      );
      an = { nodes: cleanedNodes, edges: cleanedEdges };
    }

    const updated: DebateSession = {
      ...activeDebate,
      updated_at: nowISO(),
      transcript: filtered,
      ...(diagnostics ? { diagnostics } : {}),
      ...(an ? { argument_network: an } : {}),
    };
    set({ activeDebate: updated });
    await saveDebate('deleteTranscriptEntries');
  },

  togglePover: async (poverId) => {
    const { activeDebate, saveDebate } = get();
    if (!activeDebate) return;
    const current = activeDebate.active_povers;
    let updated: SpeakerId[];
    if (current.includes(poverId)) {
      // Remove — but must keep at least 2
      updated = current.filter(p => p !== poverId);
      if (updated.filter(p => p !== 'user').length < 1) return; // Need at least 1 AI pover
    } else {
      // Add
      updated = [...current, poverId];
    }
    const newDebate: DebateSession = {
      ...activeDebate,
      active_povers: updated,
      updated_at: nowISO(),
    };
    set({ activeDebate: newDebate });
    await saveDebate('togglePover');
  },

  updatePhase: (phase) => {
    const { activeDebate } = get();
    if (!activeDebate) return;
    set({ activeDebate: { ...activeDebate, phase, updated_at: nowISO() } });
  },

  updateTopic: (topic) => {
    const { activeDebate } = get();
    if (!activeDebate) return;
    set({
      activeDebate: {
        ...activeDebate,
        topic: { ...activeDebate.topic, ...topic },
        updated_at: nowISO(),
      },
    });
  },

  saveDebate: async (caller?: string) => {
    const { activeDebate } = get();
    if (!activeDebate) return;
    try {
      // Persist prompt config overrides with session (Phase B)
      const promptConfig = usePromptConfigStore.getState().exportSessionConfig();
      if (Object.keys(promptConfig).length > 0) {
        (activeDebate as Record<string, unknown>).prompt_config = promptConfig;
      }
      await api.saveDebateSession(activeDebate);
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === activeDebate.id
            ? { ...s, title: activeDebate.title, updated_at: activeDebate.updated_at, phase: activeDebate.phase }
            : s,
        ),
      }));
      getGlobalRecorder()?.record({ type: 'state.save', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'Debate saved', data: { phase: activeDebate.phase, transcript_length: activeDebate.transcript.length, caller: caller ?? 'unknown' } });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'state.error', component: 'debate-store', level: 'error', debate_id: activeDebate.id, message: 'Failed to save debate', error: { name: 'SaveError', message: String(err) }, data: { caller: caller ?? 'unknown' } });
      set({ debateError: mapErrorToUserMessage(err) });
    }
  },

  setGenerating: (pover) => set({ debateGenerating: pover }),
  inspectNode: (nodeId) => set({ inspectedNodeId: nodeId }),
  setError: (error) => set({ debateError: error }),

  // ── Phase 1.5: Topic Critique ─────────────────────────────

  runTopicCritique: async () => {
    const { activeDebate, saveDebate } = get();
    if (!activeDebate) return;

    // Guard: only for free-form topics, don't rerun if already critiqued
    if (activeDebate.source_type !== 'topic') return;
    if (activeDebate.topic.critique) return;
    if (get().topicCritiqueLoading) return;

    set({ topicCritiqueLoading: true, debateError: null });
    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;
    getGlobalRecorder()?.record({ type: 'topic.critique', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'topicCritique.started', data: { phase: activeDebate.phase, transcript_length: activeDebate.transcript.length, model } });

    try {
      // Phase A: structural scoring from taxonomy embeddings
      const taxState = useTaxonomyStore.getState();
      const povFiles = ['accelerationist', 'safetyist', 'skeptic'] as const;
      const allPovNodes: { id: string; pov: string; category: import('../types/taxonomy').Category }[] = [];
      const allNodeTexts: string[] = [];
      const allNodeIds: string[] = [];

      for (const pov of povFiles) {
        const file = taxState[pov];
        if (!file?.nodes) continue;
        for (const n of file.nodes) {
          allPovNodes.push({ id: n.id, pov, category: n.category });
          allNodeTexts.push(`${n.label}: ${n.description}`);
          allNodeIds.push(n.id);
        }
      }

      const sitNodes = taxState.situations?.nodes ?? [];
      for (const n of sitNodes) {
        allNodeTexts.push(`${n.label}: ${n.description}`);
        allNodeIds.push(n.id);
      }

      // Compute topic embedding via local model (same all-MiniLM-L6-v2 as embeddings.json)
      // to ensure cosine similarity is meaningful against cached node vectors.
      const { vector: topicEmbedding } = await api.computeQueryEmbedding(topic);

      // Load node embeddings from cache (same model)
      const { vectors: nodeVectors } = await api.computeEmbeddings(allNodeTexts, allNodeIds);

      // Validate dimension match — if the topic came from a different model (API fallback),
      // cosine similarity would be meaningless, so warn and skip structural scoring
      const nodeEmbeddings: Record<string, { pov: string; vector: number[] }> = {};
      const dimMismatch = nodeVectors.length > 0 && nodeVectors[0].length > 0
        && topicEmbedding.length !== nodeVectors[0].length;
      if (dimMismatch) {
        console.warn(`[TopicCritique] Dimension mismatch: topic=${topicEmbedding.length}d, nodes=${nodeVectors[0].length}d — structural scores will be zero`);
      }
      for (let i = 0; i < allNodeIds.length; i++) {
        const povNode = allPovNodes.find(n => n.id === allNodeIds[i]);
        nodeEmbeddings[allNodeIds[i]] = { pov: povNode?.pov ?? 'situations', vector: nodeVectors[i] };
      }

      const structuralScore = computeStructuralScore({
        topicEmbedding,
        povNodes: allPovNodes,
        situationNodes: sitNodes.map(n => ({ id: n.id })),
        embeddings: nodeEmbeddings,
      });

      // Lineage distribution (deterministic — from activated nodes' intellectual_lineage)
      let lineageFrame: LineageFrameEntry[] = [];
      if (isLineageDataLoaded() && structuralScore.activated_nodes.length > 0) {
        const mapping = getLineageMapping();
        const l2Cats = getL2Categories();

        // Build per-node lineage lookup from taxonomy nodes
        const lineageByNode: Record<string, string[]> = {};
        for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
          const file = taxState[pov];
          if (!file?.nodes) continue;
          for (const node of file.nodes) {
            const ga = (node as { graph_attributes?: { intellectual_lineage?: (string | { name: string })[] } }).graph_attributes;
            const lineage = ga?.intellectual_lineage;
            if (lineage && lineage.length > 0) {
              lineageByNode[node.id] = lineage.map(v => typeof v === 'string' ? v : v.name);
            }
          }
        }

        // Build name→cluster and cluster→label lookups from lineage categories
        const nameToCluster: Record<string, string> = {};
        for (const [name, val] of Object.entries(mapping)) {
          nameToCluster[name] = val.l2;
        }
        const clusterLabels: Record<string, string> = {};
        for (const cat of l2Cats) {
          clusterLabels[cat.id] = cat.label;
        }

        lineageFrame = computeLineageDistribution({
          activatedNodeIds: structuralScore.activated_nodes.map(n => n.id),
          lineageByNode,
          nameToCluster,
          clusterLabels,
        });
      }

      // Phase B: LLM frame analysis (with structural + lineage context from Phase A)
      let structuralContext = formatStructuralContext(structuralScore);
      if (lineageFrame.length > 0) {
        structuralContext += '\n' + formatLineageContext(lineageFrame);
      }
      const prompt = critiqueTopicPrompt(topic, structuralContext);
      const { text } = await generateTextWithProgress(prompt, model, `Evaluating topic quality (${model})`, set);
      const critique = parseTopicCritique(text, structuralScore);

      // Store lineage frame on the critique
      if (lineageFrame.length > 0) {
        critique.lineage_frame = lineageFrame;
      }

      // Score the suggested rewrite too (for side-by-side comparison)
      let suggestedCritique: ReturnType<typeof parseTopicCritique> | undefined;
      if (critique.rewritten_topic && critique.rewritten_topic !== topic) {
        try {
          const { vector: suggestedEmbedding } = await api.computeQueryEmbedding(critique.rewritten_topic);
          const suggestedStructural = computeStructuralScore({
            topicEmbedding: suggestedEmbedding,
            povNodes: allPovNodes,
            situationNodes: sitNodes.map(n => ({ id: n.id })),
            embeddings: nodeEmbeddings,
          });
          const suggestedPrompt = critiqueTopicPrompt(critique.rewritten_topic, formatStructuralContext(suggestedStructural));
          const { text: suggestedText } = await generateTextWithProgress(suggestedPrompt, model, `Scoring suggested topic (${model})`, set);
          const parsed = parseTopicCritique(suggestedText, suggestedStructural);
          // Quality gate: only present the suggestion if it scores at least as high as the original
          if (parsed.composite_score >= critique.composite_score) {
            suggestedCritique = parsed;
          } else {
            console.log(`[TopicCritique] Suggested topic scored ${parsed.composite_score} < original ${critique.composite_score} — discarding suggestion`);
          }
        } catch (sugErr) {
          getGlobalRecorder()?.record({
            type: 'system.error',
            component: 'debate-store',
            level: 'warn',
            message: 'Suggested topic scoring failed',
            error: { name: (sugErr as Error).name ?? 'Error', message: String(sugErr) },
          });
          console.warn('[TopicCritique] Suggested topic scoring failed (non-blocking):', sugErr);
        }
      }

      // Store critique on session — read FRESH state to avoid clobbering phase/transcript
      // that may have advanced while critique was running (fire-and-forget race).
      const freshDebate = get().activeDebate;
      if (freshDebate) {
        set({
          activeDebate: {
            ...freshDebate,
            topic: { ...freshDebate.topic, critique, ...(suggestedCritique ? { suggested_critique: suggestedCritique } : {}) },
            updated_at: nowISO(),
          },
          topicCritiqueLoading: false,
          debateActivity: null,
        });
      } else {
        set({ topicCritiqueLoading: false, debateActivity: null });
      }
      await get().saveDebate('runTopicCritique');

      getGlobalRecorder()?.record({
        type: 'topic.critique', component: 'debate-store', level: 'info',
        debate_id: activeDebate.id,
        message: `Topic critique: ${critique.rating} (${critique.composite_score}/20)${suggestedCritique ? `, suggested: ${suggestedCritique.rating} (${suggestedCritique.composite_score}/20)` : ''}`,
        data: { structural: structuralScore.total, frame: critique.frame_score?.total ?? 0, rating: critique.rating },
      });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'warn',
        message: 'Topic critique failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      console.warn('[TopicCritique] Failed (non-blocking):', err);
      set({ topicCritiqueLoading: false, debateActivity: null });
    }
  },

  reEvaluateSuggestedTopic: async (suggestedText: string) => {
    const { activeDebate, saveDebate } = get();
    if (!activeDebate || !suggestedText.trim()) return;
    if (get().topicCritiqueLoading) return;

    set({ topicCritiqueLoading: true, debateError: null });
    const model = getConfiguredModel();
    getGlobalRecorder()?.record({ type: 'topic.critique', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'reEvaluateSuggestedTopic.started', data: { phase: activeDebate.phase, transcript_length: activeDebate.transcript.length, model } });

    try {
      const taxState = useTaxonomyStore.getState();
      const povFiles = ['accelerationist', 'safetyist', 'skeptic'] as const;
      const allPovNodes: { id: string; pov: string; category: import('../types/taxonomy').Category }[] = [];
      const allNodeTexts: string[] = [];
      const allNodeIds: string[] = [];

      for (const pov of povFiles) {
        const file = taxState[pov];
        if (!file?.nodes) continue;
        for (const n of file.nodes) {
          allPovNodes.push({ id: n.id, pov, category: n.category });
          allNodeTexts.push(`${n.label}: ${n.description}`);
          allNodeIds.push(n.id);
        }
      }

      const sitNodes = taxState.situations?.nodes ?? [];
      for (const n of sitNodes) {
        allNodeTexts.push(`${n.label}: ${n.description}`);
        allNodeIds.push(n.id);
      }

      const { vector: suggestedEmbedding } = await api.computeQueryEmbedding(suggestedText);
      const { vectors: nodeVectors } = await api.computeEmbeddings(allNodeTexts, allNodeIds);

      const nodeEmbeddings: Record<string, { pov: string; vector: number[] }> = {};
      for (let i = 0; i < allNodeIds.length; i++) {
        const povNode = allPovNodes.find(n => n.id === allNodeIds[i]);
        nodeEmbeddings[allNodeIds[i]] = { pov: povNode?.pov ?? 'situations', vector: nodeVectors[i] };
      }

      const suggestedStructural = computeStructuralScore({
        topicEmbedding: suggestedEmbedding,
        povNodes: allPovNodes,
        situationNodes: sitNodes.map(n => ({ id: n.id })),
        embeddings: nodeEmbeddings,
      });

      const suggestedPrompt = critiqueTopicPrompt(suggestedText, formatStructuralContext(suggestedStructural));
      const { text } = await generateTextWithProgress(suggestedPrompt, model, `Re-evaluating suggested topic (${model})`, set);
      const suggestedCritique = parseTopicCritique(text, suggestedStructural);

      // Update only the suggested_critique and rewritten_topic — read FRESH state
      const freshDebate = get().activeDebate;
      if (freshDebate) {
        set({
          activeDebate: {
            ...freshDebate,
            topic: {
              ...freshDebate.topic,
              critique: { ...freshDebate.topic.critique!, rewritten_topic: suggestedText },
              suggested_critique: suggestedCritique,
            },
            updated_at: nowISO(),
          },
          topicCritiqueLoading: false,
          debateActivity: null,
        });
      } else {
        set({ topicCritiqueLoading: false, debateActivity: null });
      }
      await get().saveDebate('reEvaluateSuggestedTopic');
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'warn',
        message: 'Re-evaluate suggested topic failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      console.warn('[TopicCritique] Re-evaluate suggested failed (non-blocking):', err);
      set({ topicCritiqueLoading: false, debateActivity: null });
    }
  },

  // ── Phase 2: Clarification ──────────────────────────────

  runClarification: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate, debateGenerating } = get();
    if (!activeDebate) return;

    // Guard: don't run if already generating or if clarification already exists
    if (debateGenerating) return;
    if (activeDebate.transcript.some(e => e.type === 'clarification')) return;

    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [] });
    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;

    set({ debateGenerating: 'system' as SpeakerId });
    const lineageCtx = buildLineageContext();
    const prompt = activeDebate.source_type === 'situations'
      ? situationClarificationPrompt(topic, activeDebate.source_content, activeDebate.audience, lineageCtx)
      : (activeDebate.source_type === 'document' || activeDebate.source_type === 'url')
        ? documentClarificationPrompt(topic, activeDebate.source_content, activeDebate.audience, lineageCtx)
        : buildClarificationPrompt(topic, activeDebate.source_content || undefined, activeDebate.audience, lineageCtx);
    try {
      const { text } = await generateTextWithProgress(prompt, model, `Generating clarifying questions (${model})`, set);
      if (!isStillValid()) return;
      let questions: string[];
      const clarParsed = parseAIJson<{ questions?: string[] } | string[]>(text);
      if (clarParsed && typeof clarParsed === 'object' && 'questions' in clarParsed && Array.isArray(clarParsed.questions)) {
        questions = clarParsed.questions.slice(0, 3);
      } else if (Array.isArray(clarParsed)) {
        questions = clarParsed.slice(0, 3);
      } else {
        questions = [text.trim()];
      }
      if (questions.length > 0) {
        addTranscriptEntry({
          type: 'clarification',
          speaker: 'system',
          content: questions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
          taxonomy_refs: [],
          metadata: { questions },
        });
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'error',
        message: 'Failed to generate clarifying questions',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      addTranscriptEntry({
        type: 'system',
        speaker: 'system',
        content: `Failed to generate clarifying questions: ${mapErrorToUserMessage(err)}`,
        taxonomy_refs: [],
      });
    }

    set({ debateGenerating: null });
    get().updatePhase('clarification');
    await saveDebate('runClarification');
  },

  submitAnswersAndSynthesize: async (answers: string) => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    const isStillValid = createDebateGuard(get);

    addTranscriptEntry({
      type: 'answer',
      speaker: 'user',
      content: answers,
      taxonomy_refs: [],
    });

    set({ debateError: null, debateWarnings: [], debateGenerating: 'system' as SpeakerId });

    const clarifications: { speaker: string; questions: string[]; answers: string }[] = [];
    const clarEntries = get().activeDebate!.transcript.filter((e) => e.type === 'clarification');
    for (const entry of clarEntries) {
      const rawQs = entry.metadata?.questions;
      // Handle both old format (string[]) and new format ({question, options}[])
      const qs: string[] = Array.isArray(rawQs)
        ? rawQs.map((q: unknown) => typeof q === 'string' ? q : (q as { question: string }).question ?? String(q))
        : [entry.content];
      clarifications.push({
        speaker: POVER_INFO[entry.speaker as Exclude<SpeakerId, 'user'>]?.label || entry.speaker,
        questions: qs,
        answers,
      });
    }

    const model = getConfiguredModel();
    const baselineCritique = activeDebate.topic.critique;
    const baselineScore = baselineCritique?.composite_score ?? 0;

    // Quality gate: retry refinement if the new topic scores lower than the original
    const MAX_REFINEMENT_ATTEMPTS = 3;
    let bestTopic: string | null = null;
    let bestScore = baselineScore;
    let bestCritique: ReturnType<typeof parseTopicCritique> | null = null;

    for (let attempt = 0; attempt < MAX_REFINEMENT_ATTEMPTS; attempt++) {
      const prompt = buildSynthesisPrompt(activeDebate.topic.original, clarifications, activeDebate.audience, baselineCritique);
      const label = attempt === 0
        ? `Synthesizing refined topic (${model})`
        : `Refining topic, attempt ${attempt + 1}/${MAX_REFINEMENT_ATTEMPTS} (${model})`;
      try {
        const { text } = await generateTextWithProgress(prompt, model, label, set);
        if (!isStillValid()) { set({ debateGenerating: null }); return; }
        const parsed = parseAIJson<{ refined_topic?: string }>(text);
        const candidate = parsed?.refined_topic || text.trim();

        // Score the candidate if we have a baseline to compare against
        if (baselineCritique) {
          try {
            const critiquePrompt = critiqueTopicPrompt(candidate);
            const { text: critiqueText } = await generateTextWithProgress(critiquePrompt, model, `Scoring refined topic (${model})`, set);
            if (!isStillValid()) { set({ debateGenerating: null }); return; }
            const candidateCritique = parseTopicCritique(critiqueText, baselineCritique.structural_score);

            if (candidateCritique.composite_score >= baselineScore) {
              bestTopic = candidate;
              bestScore = candidateCritique.composite_score;
              bestCritique = candidateCritique;
              console.log(`[TopicRefinement] Attempt ${attempt + 1}: score ${candidateCritique.composite_score} >= baseline ${baselineScore} — accepted`);
              break;
            }
            console.log(`[TopicRefinement] Attempt ${attempt + 1}: score ${candidateCritique.composite_score} < baseline ${baselineScore} — discarding`);
          } catch (scoreErr) {
            getGlobalRecorder()?.record({
              type: 'system.error',
              component: 'debate-store',
              level: 'warn',
              message: 'Topic refinement scoring failed, accepting candidate',
              error: { name: (scoreErr as Error).name ?? 'Error', message: String(scoreErr) },
            });
            // Scoring failed — accept the candidate rather than blocking refinement
            console.warn('[TopicRefinement] Scoring failed, accepting candidate:', scoreErr);
            bestTopic = candidate;
            break;
          }
        } else {
          // No baseline critique — accept the first candidate
          bestTopic = candidate;
          break;
        }
      } catch (genErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'debate-store',
          level: 'error',
          message: `Topic refinement attempt ${attempt + 1} generation failed`,
          error: { name: (genErr as Error).name ?? 'Error', message: String(genErr) },
        });
        console.warn(`[TopicRefinement] Attempt ${attempt + 1} generation failed:`, genErr);
        break;
      }
    }

    // If all attempts scored lower, keep the existing topic
    const refinedTopic = bestTopic ?? activeDebate.topic.final;
    const keptOriginal = bestTopic === null && baselineCritique != null;

    try {
      get().updateTopic({ refined: refinedTopic, final: refinedTopic, ...(bestCritique ? { refined_critique: bestCritique } : {}) });

      addTranscriptEntry({
        type: 'system',
        speaker: 'system',
        content: keptOriginal
          ? `Topic refinement: all ${MAX_REFINEMENT_ATTEMPTS} attempts scored below baseline (${baselineScore}/20). Keeping original topic.`
          : `Refined topic: "${refinedTopic}"${bestScore > baselineScore ? ` (score: ${bestScore}/20, was ${baselineScore}/20)` : ''}`,
        taxonomy_refs: [],
        metadata: { refined_topic: refinedTopic, refinement_kept_original: keptOriginal || undefined, refinement_score: bestScore || undefined },
      });

      // Extract user seed claims from Q&A and inject into argument network
      try {
        let qaPairsForClaims = '';
        for (const c of clarifications) {
          qaPairsForClaims += `\nQuestions:\n`;
          for (const q of c.questions) qaPairsForClaims += `  - ${q}\n`;
          qaPairsForClaims += `User answered: ${c.answers}\n`;
        }
        const seedPrompt = userSeedClaimsPrompt(refinedTopic, qaPairsForClaims, activeDebate.audience);
        const { text: seedText } = await generateTextWithProgress(seedPrompt, model, `Extracting user positions (${model})`, set);
        if (isStillValid()) {
          const seedParsed = parseAIJson<{ claims?: { claim: string; bdi_category?: string }[] }>(seedText);
          if (seedParsed?.claims && seedParsed.claims.length > 0) {
            const debate = get().activeDebate!;
            const existingAN = debate.argument_network ?? { nodes: [], edges: [] };
            const answerEntry = debate.transcript.find(e => e.type === 'answer');
            const sourceEntryId = answerEntry?.id ?? '';

            const seedNodes: ArgumentNetworkNode[] = seedParsed.claims.slice(0, 5).map((c, i) => ({
              id: `user-seed-${String(i + 1).padStart(3, '0')}`,
              text: c.claim,
              speaker: 'user' as ArgumentNetworkNode['speaker'],
              source_entry_id: sourceEntryId,
              taxonomy_refs: [],
              turn_number: 0,
              bdi_category: (['belief', 'desire', 'intention'].includes(c.bdi_category ?? '') ? c.bdi_category : undefined) as ArgumentNetworkNode['bdi_category'],
              base_strength: 0.5,
            }));

            set({
              activeDebate: {
                ...debate,
                argument_network: {
                  nodes: [...existingAN.nodes, ...seedNodes],
                  edges: [...existingAN.edges],
                },
              },
            });

            addTranscriptEntry({
              type: 'system',
              speaker: 'system',
              content: `Extracted ${seedNodes.length} user position${seedNodes.length > 1 ? 's' : ''} into the argument network:\n${seedNodes.map(n => `- [${n.id}] ${n.text}`).join('\n')}`,
              taxonomy_refs: [],
              metadata: { user_seed_claims: seedNodes.map(n => ({ id: n.id, text: n.text, bdi_category: n.bdi_category })) },
            });
          }
        }
      } catch (seedErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'debate-store',
          level: 'warn',
          message: 'User seed claim extraction failed',
          error: { name: (seedErr as Error).name ?? 'Error', message: String(seedErr) },
        });
        console.warn('[debate] User seed claim extraction failed (non-fatal):', seedErr);
        pushWarning(get, set, 'User position extraction skipped — debaters will not see your stated positions in the graph');
      }

      // Synthesis succeeded — auto-advance to the debate
      set({ debateGenerating: null });
      await saveDebate('submitAnswersAndSynthesize');
      await get().beginDebate();
      return;
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'error',
        message: 'Topic synthesis failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      set({ debateError: `Topic synthesis failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate('submitAnswersAndSynthesize:finally');
    }

  },

  beginDebate: async () => {
    const { activeDebate, updatePhase, saveDebate, addTranscriptEntry } = get();

    // Lineage pipeline status check — surfaces misconfiguration instantly
    if (activeDebate) {
      const lineageFrame = activeDebate.topic?.critique?.lineage_frame;
      const lineageDataLoaded = isLineageDataLoaded();
      const frameComputed = !!lineageFrame && lineageFrame.length > 0;
      const boostWillBeApplied = frameComputed && lineageDataLoaded;
      getGlobalRecorder()?.record({
        type: 'lineage.pipeline-status',
        component: 'debate-store',
        level: boostWillBeApplied ? 'info' : 'warn',
        debate_id: activeDebate.id,
        message: boostWillBeApplied ? 'Lineage pipeline ready' : 'Lineage pipeline incomplete',
        data: {
          lineage_data_loaded: lineageDataLoaded,
          lineage_frame_computed: frameComputed,
          lineage_frame_traditions: lineageFrame?.map((f: { cluster_id: string; label?: string }) => f.label ?? f.cluster_id) ?? [],
          boost_configured: boostWillBeApplied,
          code_path: 'useDebateStore',
        },
      });
    }

    // Document pre-analysis: extract i-nodes, tension points, and claims summary
    // Runs here so it executes whether the user submitted answers or skipped clarification
    if (activeDebate && !activeDebate.document_analysis &&
        (activeDebate.source_type === 'document' || activeDebate.source_type === 'url')) {
      set({ debateGenerating: 'system' as SpeakerId });
      const model = getConfiguredModel();
      const isStillValid = createDebateGuard(get);
      try {
        const taxStore = useTaxonomyStore.getState();
        const taxonomySample = buildTaxonomySample({
          accelerationist: { nodes: (taxStore.accelerationist?.nodes ?? []) as PovNode[] },
          safetyist: { nodes: (taxStore.safetyist?.nodes ?? []) as PovNode[] },
          skeptic: { nodes: (taxStore.skeptic?.nodes ?? []) as PovNode[] },
          situations: { nodes: (taxStore.situations?.nodes ?? []) as SituationNode[] },
          policyRegistry: (taxStore.policyRegistry ?? []).map(p => ({ id: p.id, action: p.action })),
        });

        const activePovers = activeDebate.active_povers
          .filter(p => p !== 'user')
          .map(p => POVER_INFO[p as Exclude<SpeakerId, 'user'>]?.pov)
          .filter(Boolean);

        const { prompt: analysisPrompt } = documentAnalysisPrompt(
          activeDebate.source_content,
          activeDebate.topic.final,
          activePovers,
          taxonomySample,
        );

        const { text: analysisText } = await generateTextWithProgress(
          analysisPrompt, model, `Analyzing document claims (${model})`, set,
        );
        if (!isStillValid()) return;

        const analysis = parseAIJson<DocumentAnalysis>(analysisText);
        if (analysis && analysis.i_nodes && analysis.i_nodes.length > 0) {
          addTranscriptEntry({
            type: 'system',
            speaker: 'system',
            content: `Document analysis complete: ${analysis.i_nodes.length} claims extracted, ${analysis.tension_points.length} tension points identified.\n\n${analysis.claims_summary}`,
            taxonomy_refs: [],
          });

          // Seed argument network with document i-nodes
          const debate = get().activeDebate;
          if (debate) {
            const existingAN = debate.argument_network ?? { nodes: [], edges: [] };
            const lastEntry = debate.transcript.slice(-1)[0];
            const sourceEntryId = lastEntry?.id ?? '';
            const docNodes: ArgumentNetworkNode[] = analysis.i_nodes.map(inode => ({
              id: inode.id,
              text: inode.text,
              speaker: 'document' as ArgumentNetworkNode['speaker'],
              source_entry_id: sourceEntryId,
              taxonomy_refs: inode.taxonomy_refs,
              turn_number: 0,
            }));

            // Embed doc i-nodes for AN-based taxonomy relevance scoring (non-blocking)
            for (const node of docNodes) {
              try {
                const { vector } = await api.computeQueryEmbedding(node.text.slice(0, 300));
                if (vector && vector.length > 0) node.embedding = vector;
              } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Doc i-node embedding failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
            }

            set({
              activeDebate: {
                ...debate,
                document_analysis: analysis,
                argument_network: {
                  nodes: [...existingAN.nodes, ...docNodes],
                  edges: [...existingAN.edges],
                },
              },
            });
          }
        }
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'debate-store',
          level: 'error',
          message: 'Document analysis failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err) },
        });
        console.warn('[debate] Document analysis failed:', err);
        pushWarning(get, set, 'Document analysis could not be completed');
        addTranscriptEntry({
          type: 'system',
          speaker: 'system',
          content: `Document analysis skipped: ${mapErrorToUserMessage(err)}`,
          taxonomy_refs: [],
        });
      } finally {
        set({ debateGenerating: null });
        await saveDebate('beginDebate:docAnalysis');
      }
    }

    // Load vocabulary terms for standardized term enforcement
    try {
      const dict = await api.loadDictionary();
      if (dict.standardized.length > 0) {
        set({ vocabularyTerms: { standardized: dict.standardized as StandardizedTerm[], colloquial: dict.colloquial as ColloquialTerm[] } });
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'warn',
        message: 'Vocabulary loading failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      console.warn('[debate] Vocabulary loading failed, debates will use bare terms:', err);
      pushWarning(get, set, 'Vocabulary dictionary unavailable — debates will use bare terms');
    }

    // If document analysis produced claims, let the user review/edit them before opening
    const freshDebate = get().activeDebate;
    if (freshDebate?.document_analysis?.i_nodes?.length) {
      updatePhase('edit-claims');
      await saveDebate('beginDebate:editClaims');
      return;
    }

    // No claims to edit — proceed directly to opening
    get().proceedToOpening();
    await saveDebate('beginDebate:proceed');
  },

  // ── Phase 2.5: Edit Claims ──────────────────────────────

  updateClaim: (claimId: string, newText: string) => {
    const debate = get().activeDebate;
    if (!debate?.document_analysis) return;

    const updatedINodes = debate.document_analysis.i_nodes.map(n =>
      n.id === claimId ? { ...n, text: newText } : n,
    );
    const updatedAN = debate.argument_network
      ? {
          ...debate.argument_network,
          nodes: debate.argument_network.nodes.map(n =>
            n.id === claimId ? { ...n, text: newText } : n,
          ),
        }
      : undefined;

    set({
      activeDebate: {
        ...debate,
        document_analysis: { ...debate.document_analysis, i_nodes: updatedINodes },
        ...(updatedAN ? { argument_network: updatedAN } : {}),
      },
    });
  },

  deleteClaim: (claimId: string) => {
    const debate = get().activeDebate;
    if (!debate?.document_analysis) return;

    const updatedINodes = debate.document_analysis.i_nodes.filter(n => n.id !== claimId);
    const updatedTensions = debate.document_analysis.tension_points.map(tp => ({
      ...tp,
      i_node_ids: tp.i_node_ids.filter(id => id !== claimId),
    })).filter(tp => tp.i_node_ids.length > 0);
    const updatedAN = debate.argument_network
      ? {
          ...debate.argument_network,
          nodes: debate.argument_network.nodes.filter(n => n.id !== claimId),
          edges: debate.argument_network.edges.filter(e => e.source !== claimId && e.target !== claimId),
        }
      : undefined;

    set({
      activeDebate: {
        ...debate,
        document_analysis: {
          ...debate.document_analysis,
          i_nodes: updatedINodes,
          tension_points: updatedTensions,
        },
        ...(updatedAN ? { argument_network: updatedAN } : {}),
      },
    });
  },

  proceedToOpening: () => {
    const { activeDebate, updatePhase, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    updatePhase('opening');
    getGlobalRecorder()?.record({ type: 'debate.phase', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'Phase: opening', data: { phase: 'opening' } });

    // Only shuffle if no order has been set yet (preserves user customization from setup screen)
    const { openingOrder: existingOrder } = get();
    if (existingOrder.length === 0) {
      const aiPovers = AI_POVER_ORDER.filter((p) => activeDebate.active_povers.includes(p));
      const shuffled = [...aiPovers];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      set({ openingOrder: shuffled });
    }

    // Persist on the debate object so it survives app restarts
    const freshDebate = get().activeDebate;
    const finalOrder = get().openingOrder;
    if (freshDebate) {
      set({ activeDebate: { ...freshDebate, opening_order: finalOrder } });
    }

    const claimCount = activeDebate.document_analysis?.i_nodes?.length;
    addTranscriptEntry({
      type: 'system',
      speaker: 'system',
      content: `The debate begins${claimCount ? ` with ${claimCount} source claims` : ''}. Opening statements will follow.`,
      taxonomy_refs: [],
    });

    void saveDebate('proceedToOpening');
  },

  // ── Phase 3: Opening Statements ─────────────────────────

  runOpeningStatements: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    _abortController = new AbortController();
    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [] });
    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;

    // Use the user-configurable opening order (randomized at proceedToOpening).
    // Priority: Zustand state > persisted on debate object > default order.
    const { openingOrder } = get();
    const resolvedOrder = openingOrder.length > 0
      ? openingOrder
      : (activeDebate.opening_order && activeDebate.opening_order.length > 0)
        ? activeDebate.opening_order
        : AI_POVER_ORDER;
    const aiPovers = (resolvedOrder as readonly (typeof AI_POVER_ORDER[number])[]).filter(
      (p) => activeDebate.active_povers.includes(p),
    );

    // Idempotency: collect prior statements from existing openings (supports resume after interruption)
    const existingOpenings = new Set(
      activeDebate.transcript.filter(e => e.type === 'opening').map(e => e.speaker),
    );
    const priorStatements: { speaker: string; statement: string }[] = [];
    for (const poverId of aiPovers) {
      const existing = activeDebate.transcript.find(e => e.type === 'opening' && e.speaker === poverId);
      if (existing) {
        const info = POVER_INFO[poverId];
        priorStatements.push({ speaker: info.label, statement: existing.content });
      }
    }

    const stageGenerate = makeStageGenerate(set as (partial: Record<string, unknown>) => void, model);

    console.log(`[debate-store] Opening statements: aiPovers=${JSON.stringify(aiPovers)}, existingOpenings=${JSON.stringify([...existingOpenings])}, resolvedOrder=${JSON.stringify(resolvedOrder)}`);

    for (const poverId of aiPovers) {
      // Skip POVers who already delivered an opening (idempotency after interruption)
      if (existingOpenings.has(poverId)) {
        console.log(`[debate-store] Skipping ${poverId} — already has opening`);
        continue;
      }

      set({ debateGenerating: poverId });
      const info = POVER_INFO[poverId];

      try {
        const recentText = priorStatements.map(ps => ps.statement).join('\n').slice(-500);
        const ctx = await getRelevantTaxonomyContext(info.pov, topic, recentText);
        const speakerClaims = (get().activeDebate?.argument_network?.nodes || []).filter(n => n.speaker === poverId);
        const commitBlock = formatCommitments(
          get().activeDebate?.commitments?.[poverId] || { asserted: [], conceded: [], challenged: [] },
          speakerClaims,
        );
        const allANNodes = (get().activeDebate?.argument_network?.nodes || []).map(n => ({
          id: n.id, text: n.text, speaker: POVER_INFO[n.speaker as Exclude<SpeakerId, 'user'>]?.label || n.speaker,
        }));
        const establishedBlock = formatEstablishedPoints(allANNodes, info.label, 10);
        const edgeBlock = formatDebaterEdgeContext(info.pov);
        const vocab = get().vocabularyTerms;
        const vocabBlock = vocab
          ? '\n' + formatVocabularyContext({ pov: info.pov, standardizedTerms: vocab.standardized, colloquialTerms: vocab.colloquial })
          : '';
        const taxonomyBlock = formatTaxonomyContext(ctx, info.pov) + commitBlock + establishedBlock + edgeBlock + vocabBlock;

        const docAnalysis = activeDebate.document_analysis;

        let priorBlock = '';
        if (priorStatements.length > 0) {
          priorBlock = '\n\n=== PRIOR OPENING STATEMENTS ===\n';
          for (const ps of priorStatements) {
            priorBlock += `\n${ps.speaker}:\n${ps.statement}\n`;
          }
        }

        const userSeeds = (get().activeDebate?.argument_network?.nodes || [])
          .filter(n => n.speaker === 'user' && n.id.startsWith('user-seed-'))
          .map(n => ({ id: n.id, text: n.text, bdi_category: n.bdi_category }));

        const pipelineInput: OpeningPipelineInput = {
          label: info.label,
          pov: info.pov,
          personality: info.personality,
          topic,
          taxonomyContext: taxonomyBlock,
          priorStatements: priorBlock,
          isFirst: priorStatements.length === 0,
          sourceContent: docAnalysis ? undefined : (activeDebate.source_content || undefined),
          documentAnalysis: docAnalysis,
          audience: activeDebate.audience,
          model,
          userSeedClaims: userSeeds.length > 0 ? userSeeds : undefined,
          availablePovNodeIds: [...getAllKnownNodeIds()],
          doctrinalBoundaries: info.doctrinal_boundaries,
        };

        let pipelineResult = await runOpeningPipeline(
          pipelineInput,
          stageGenerate,
          (_stage, label) => set({ debateActivity: label }),
        );
        if (!isStillValid()) {
          console.warn(`[debate-store] Debate state changed after ${info.label} opening pipeline — remaining speakers will be skipped. activeDebateId: ${get().activeDebateId}, aborted: ${_abortController?.signal.aborted}`);
          addTranscriptEntry({ type: 'system', speaker: 'system', content: `Opening generation interrupted after ${info.label} — debate state changed during generation.`, taxonomy_refs: [] });
          return;
        }

        // Opening retry: if per-stage validation found errors, retry once with repair hints.
        const openingRepairHints = getOpeningRepairHints(pipelineResult);
        if (openingRepairHints.length > 0) {
          console.log(`[debate-store] Opening retry for ${info.label}: ${openingRepairHints.length} issue(s)`);
          set({ debateActivity: `${info.label} retrying (${openingRepairHints.length} issue${openingRepairHints.length > 1 ? 's' : ''})` });
          try {
            pipelineResult = await runOpeningPipeline(
              { ...pipelineInput, repairHints: openingRepairHints },
              stageGenerate,
              (_stage, label) => set({ debateActivity: label }),
            );
          } catch (err) {
            getGlobalRecorder()?.record({
              type: 'system.error',
              component: 'debate-store',
              level: 'warn',
              message: `Opening retry failed for ${info.label}`,
              error: { name: (err as Error).name ?? 'Error', message: String(err) },
            });
            console.warn(`[debate-store] Opening retry failed for ${info.label}:`, err);
          }
          if (!isStillValid()) {
            console.warn(`[debate-store] Debate state changed after ${info.label} opening retry — remaining speakers will be skipped. activeDebateId: ${get().activeDebateId}, aborted: ${_abortController?.signal.aborted}`);
            addTranscriptEntry({ type: 'system', speaker: 'system', content: `Opening generation interrupted after ${info.label} retry — debate state changed during generation.`, taxonomy_refs: [] });
            return;
          }
        }

        const knownNodeIds = getAllKnownNodeIds();
        const { statement, taxonomyRefs, meta } = assembleOpeningPipelineResult(pipelineResult, knownNodeIds);

        // Guard: reject empty or trivially short opening statements
        if (!statement || statement.trim().length < 50) {
          console.error(`[debate] ${info.label} opening produced empty/trivial statement (${statement.length} chars) — treating as failure`);
          throw new Error(`Opening statement was empty or too short (${statement.trim().length} chars). The AI may have returned only structural metadata without prose content.`);
        }

        // Enrich policy refs with per-policy relevance from draft stage
        meta.policy_refs = enrichPolicyRefs(meta.policy_refs, pipelineResult.draft as unknown as Record<string, unknown>);

        // Enrich taxonomy refs with relevance scores from context injection
        if (ctx.nodeScores) {
          for (const ref of taxonomyRefs) {
            const score = ctx.nodeScores.get(ref.node_id);
            if (score != null) ref.relevance_score = score;
          }
        }

        // Serialize source tracking for diagnostics display
        const relevanceSources = serializeNodeSourceMap(ctx.nodeSourceMap, taxonomyRefs);

        addTranscriptEntry({
          type: 'opening',
          speaker: poverId,
          content: statement,
          taxonomy_refs: taxonomyRefs,
          policy_refs: meta.policy_refs,
          metadata: {
            key_assumptions: meta.key_assumptions,
            my_claims: meta.my_claims,
            turn_symbols: meta.turn_symbols,
            relevance_sources: relevanceSources,
          },
        });
        const lastEntry = get().activeDebate?.transcript.slice(-1)[0];

        // Record diagnostics with full stage data
        if (lastEntry) {
          const draftDiag = pipelineResult.stage_diagnostics.find(s => s.stage === 'draft');
          recordDiagnostic(get, set, lastEntry.id, {
            prompt: draftDiag?.prompt ?? '',
            raw_response: draftDiag?.raw_response ?? '',
            model,
            response_time_ms: pipelineResult.total_time_ms,
            taxonomy_context: taxonomyBlock,
            commitment_context: commitBlock || undefined,
            stage_diagnostics: pipelineResult.stage_diagnostics,
          });
        }

        priorStatements.push({ speaker: info.label, statement });

        // Summarize for detail tiers (awaited so summaries persist with save)
        if (lastEntry) {
          await summarizeTranscriptEntry(lastEntry.id, statement, info.label, model, get, set);
        }

        // Save after each statement so progress persists
        await saveDebate('runOpeningStatements:perStatement');

        // Extract claims in background (non-blocking)
        if (lastEntry) {
          void extractClaimsAndUpdateAN(statement, poverId, lastEntry.id, taxonomyRefs.map(r => r.node_id), get, set, meta.my_claims);
        }
      } catch (err) {
        console.error(`[debate] ${info.label} opening statement failed:`, err);
        getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'error', message: `Opening statement failed: ${info.label}`, error: { name: (err as Error).name, message: (err as Error).message, stack: (err as Error).stack?.slice(0, 500) } });
        addTranscriptEntry({
          type: 'system',
          speaker: 'system',
          content: `${info.label} failed to deliver opening statement: ${mapErrorToUserMessage(err)}`,
          taxonomy_refs: [],
        });
      }
    }

    set({ debateGenerating: null });

    // If user is a POVer, wait for their input (phase stays 'opening')
    // Otherwise, transition to debate phase — but only if at least one valid opening was delivered
    if (!activeDebate.user_is_pover) {
      const currentDebate = get().activeDebate;
      const validOpenings = (currentDebate?.transcript ?? []).filter(
        e => e.type === 'opening' && e.content && e.content.trim().length > 0,
      );
      if (validOpenings.length > 0) {
        get().updatePhase('debate');
        const expectedCount = aiPovers.length;
        const suffix = validOpenings.length < expectedCount
          ? ` (${expectedCount - validOpenings.length} debater${expectedCount - validOpenings.length > 1 ? 's' : ''} failed to deliver — they will join during cross-respond.)`
          : '';
        addTranscriptEntry({
          type: 'system',
          speaker: 'system',
          content: `Opening statements complete.${suffix} The floor is open.`,
          taxonomy_refs: [],
        });
      }
      // If no valid openings at all, stay in 'opening' phase so user can retry
    }

    // Cache opening embeddings for position drift detection (non-blocking)
    try {
      const currentDebate = get().activeDebate;
      if (currentDebate) {
        const openingEmbeddings: Record<string, number[]> = {};
        for (const entry of currentDebate.transcript) {
          if (entry.type !== 'opening' || entry.speaker === 'system') continue;
          try {
            const result = await api.computeQueryEmbedding(entry.content.slice(0, 1000));
            openingEmbeddings[entry.speaker] = result.vector;
          } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Opening embedding computation failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
        }
        // Store on session metadata for cross-respond access
        if (Object.keys(openingEmbeddings).length > 0) {
          const d = get().activeDebate;
          if (d) {
            if (!d.metadata) d.metadata = {};
            d.metadata._openingEmbeddings = openingEmbeddings;
            set({ activeDebate: { ...d } });
          }
        }
      }
    } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Opening embeddings caching failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }

    // Neutral evaluation: baseline checkpoint (after openings, before cross-respond)
    void runNeutralCheckpoint('baseline', get, set as any, addTranscriptEntry);

    await saveDebate('runOpeningStatements:end');

    // Auto-run initial cross-respond rounds if configured
    const { initialCrossRespondRounds } = get();
    if (!activeDebate.user_is_pover) {
      const freshDebate = get().activeDebate;
      const adaptive = freshDebate?.adaptive_staging;
      if (adaptive?.enabled) {
        // Adaptive: run until phase transitions signal termination (up to maxTotalRounds)
        const weights = loadProvisionalWeights();
        const pacingPresetName = adaptive.pacing ?? 'moderate';
        const pacingPreset = weights.pacing_presets[pacingPresetName] ?? weights.pacing_presets.moderate;
        const maxRounds = pacingPreset?.maxTotalRounds ?? 12;
        const loopDebateId = freshDebate?.id;
        getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'adaptive-loop', level: 'info', debate_id: loopDebateId, message: 'Adaptive loop started', data: { pacing: pacingPresetName, maxTotalRounds: maxRounds, argumentationExit: pacingPreset?.argumentationExit, concludingExit: pacingPreset?.concludingExit } });
        let loopExitReason = 'maxRounds_exhausted';
        let loopIterations = 0;
        for (let i = 0; i < maxRounds; i++) {
          loopIterations = i + 1;
          const d = get().activeDebate;
          if (!d) { loopExitReason = 'debate_null'; break; }
          // Stop if phase reached termination
          if (d.adaptive_staging?.phase_state?.current_phase === 'terminated') { loopExitReason = 'phase_terminated'; break; }
          const preLen = d.transcript.length;
          try {
            await get().crossRespond();
          } catch (loopErr) {
            console.error(`[debate] Adaptive loop iteration ${i} failed:`, loopErr);
            getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'error', debate_id: d.id, message: `Adaptive loop failed at iteration ${i}`, data: { iteration: i, error: String(loopErr), stack: (loopErr as Error).stack?.slice(0, 500) } });
            set({ debateError: `Cross-respond failed: ${(loopErr as Error).message?.slice(0, 200) ?? String(loopErr)}` });
            loopExitReason = 'crossRespond_error';
            break;
          }
          // If crossRespond returned without adding a debater statement (e.g. agreement
          // detected), break to avoid re-running moderator selection in a loop.
          const post = get().activeDebate;
          if (!post) { loopExitReason = 'post_debate_null'; break; }
          if (post.transcript.length === preLen) {
            loopExitReason = `no_transcript_growth(preLen=${preLen},postLen=${post.transcript.length})`;
            getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'adaptive-loop', level: 'warn', debate_id: loopDebateId, message: 'Loop break: no transcript growth', data: { iteration: i, preLen, postLen: post.transcript.length, phase: post.adaptive_staging?.phase_state?.current_phase } });
            break;
          }
          if (!post.transcript.slice(preLen).some(e => e.type === 'statement')) {
            const newEntryTypes = post.transcript.slice(preLen).map(e => e.type);
            loopExitReason = `no_statement_in_new_entries(types=${newEntryTypes.join(',')})`;
            getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'adaptive-loop', level: 'warn', debate_id: loopDebateId, message: 'Loop break: no statement in new entries', data: { iteration: i, preLen, postLen: post.transcript.length, newEntryTypes, phase: post.adaptive_staging?.phase_state?.current_phase } });
            break;
          }
        }
        // Log loop completion with full context
        const finalDebate = get().activeDebate;
        const finalPhase = finalDebate?.adaptive_staging?.phase_state?.current_phase;
        getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'adaptive-loop', level: 'info', debate_id: loopDebateId, message: `Adaptive loop ended: ${loopExitReason}`, data: { exit_reason: loopExitReason, iterations: loopIterations, maxRounds, final_phase: finalPhase, transcript_length: finalDebate?.transcript?.length, an_nodes: finalDebate?.argument_network?.nodes?.length } });
        // Auto-trigger synthesis when adaptive debate terminates OR loop exhausted
        if (finalPhase === 'terminated') {
          await get().requestSynthesis();
        } else if (finalDebate && loopExitReason === 'maxRounds_exhausted') {
          getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'adaptive-loop', level: 'warn', debate_id: loopDebateId, message: 'Forcing synthesis: loop exhausted without phase termination', data: { iterations: loopIterations, maxRounds, final_phase: finalPhase } });
          await get().requestSynthesis();
        }
      } else if (initialCrossRespondRounds > 0) {
        for (let i = 0; i < initialCrossRespondRounds; i++) {
          const d = get().activeDebate;
          if (!d) break;
          const preLen = d.transcript.length;
          await get().crossRespond();
          const post = get().activeDebate;
          if (!post || post.transcript.length === preLen || !post.transcript.slice(preLen).some(e => e.type === 'statement')) break;
        }
      }
    }
  },

  submitUserOpening: async (statement: string) => {
    const { addTranscriptEntry, updatePhase, saveDebate } = get();

    addTranscriptEntry({
      type: 'opening',
      speaker: 'user',
      content: statement,
      taxonomy_refs: [],
    });

    updatePhase('debate');

    addTranscriptEntry({
      type: 'system',
      speaker: 'system',
      content: 'Opening statements complete. The floor is open.',
      taxonomy_refs: [],
    });

    await saveDebate('submitUserOpening');
  },

  // ── Phase 4: Main Debate Loop ────────────────────────────

  askQuestion: async (input: string) => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate || !input.trim()) return;

    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [] });

    // Parse @-mentions to determine targets
    const { targets, cleanedInput } = parseAtMention(input);

    // Validate targets are active POVers
    for (const t of targets) {
      if (!activeDebate.active_povers.includes(t)) {
        const label = t === 'user' ? 'You' : POVER_INFO[t as Exclude<SpeakerId, 'user'>]?.label || t;
        set({ debateError: `${label} is not in this debate` });
        return;
      }
    }

    // Add user's question to transcript
    addTranscriptEntry({
      type: 'question',
      speaker: 'user',
      content: input,
      taxonomy_refs: [],
      addressing: targets.length === 1 ? targets[0] : 'all',
    });

    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;

    // Determine which AI POVers should respond
    const aiPovers = AI_POVER_ORDER.filter((p) => activeDebate.active_povers.includes(p));
    const respondingPovers = targets.length > 0
      ? aiPovers.filter((p) => targets.includes(p)) // Targeted: only mentioned POVers
      : aiPovers; // All active AI POVers

    if (respondingPovers.length === 0) {
      // User targeted themselves or no AI POVers — nothing to generate
      await saveDebate('askQuestion:noResponders');
      return;
    }

    const recentTranscript = formatRecentTranscript(get().activeDebate!.transcript, 8, get().activeDebate!.context_summaries);

    // Generate responses sequentially so each sees prior responses
    for (const poverId of respondingPovers) {
      set({ debateGenerating: poverId });

      const info = POVER_INFO[poverId];
      const currentTranscriptForRelevance = formatRecentTranscript(get().activeDebate!.transcript, 4, get().activeDebate!.context_summaries);
      const ctx = await getRelevantTaxonomyContext(info.pov, topic, currentTranscriptForRelevance);
      const speakerClaims = (get().activeDebate?.argument_network?.nodes || []).filter(n => n.speaker === poverId);
      const commitBlock = formatCommitments(
        get().activeDebate?.commitments?.[poverId] || { asserted: [], conceded: [], challenged: [] },
        speakerClaims,
      );
      const allANNodes = (get().activeDebate?.argument_network?.nodes || []).map(n => ({
        id: n.id, text: n.text, speaker: POVER_INFO[n.speaker as Exclude<SpeakerId, 'user'>]?.label || n.speaker,
      }));
      const establishedBlock = formatEstablishedPoints(allANNodes, info.label, 10);
      const edgeBlock = formatDebaterEdgeContext(info.pov);
      const taxonomyBlock = formatTaxonomyContext(ctx, info.pov) + commitBlock + establishedBlock + edgeBlock;

      // Use the most current transcript (includes responses from prior POVers in this round)
      const currentTranscript = formatRecentTranscript(get().activeDebate!.transcript, 8, get().activeDebate!.context_summaries);

      const drDocAnalysis = activeDebate.document_analysis;
      const prompt = buildDebateResponsePrompt(
        poverId,
        topic,
        taxonomyBlock,
        currentTranscript,
        cleanedInput,
        targets.length > 0 ? poverId : 'all',
        drDocAnalysis ? undefined : (activeDebate.source_content || undefined),
        get().responseLength,
        drDocAnalysis,
        activeDebate.audience,
      );

      try {
        const t0 = Date.now();
        const { text } = await generateTextWithProgress(prompt, model, `${POVER_INFO[poverId].label} is responding (${model})`, set);
        const responseTime = Date.now() - t0;
        if (!isStillValid()) return;
        const { statement, taxonomyRefs, meta } = parsePoverResponse(text);

        // Enrich taxonomy refs with relevance scores from context injection
        if (ctx.nodeScores) {
          for (const ref of taxonomyRefs) {
            const score = ctx.nodeScores.get(ref.node_id);
            if (score != null) ref.relevance_score = score;
          }
        }

        // Serialize source tracking for diagnostics display
        const relevanceSources = serializeNodeSourceMap(ctx.nodeSourceMap, taxonomyRefs);

        addTranscriptEntry({
          type: 'statement',
          speaker: poverId,
          content: statement,
          taxonomy_refs: taxonomyRefs,
          policy_refs: meta.policy_refs,
          addressing: 'user',
          metadata: { ...meta, relevance_sources: relevanceSources },
        });

        const lastEntry = get().activeDebate?.transcript.slice(-1)[0];
        if (lastEntry) {
          recordDiagnostic(get, set, lastEntry.id, {
            prompt,
            raw_response: text,
            model,
            response_time_ms: responseTime,
            taxonomy_context: taxonomyBlock,
            commitment_context: commitBlock || undefined,
          });
          void extractClaimsAndUpdateAN(statement, poverId, lastEntry.id, taxonomyRefs.map(r => r.node_id), get, set, meta.my_claims);
          await summarizeTranscriptEntry(lastEntry.id, statement, info.label, model, get, set);
        }
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'debate-store',
          level: 'error',
          message: `${info.label} failed to respond (user prompt)`,
          error: { name: (err as Error).name ?? 'Error', message: String(err) },
        });
        addTranscriptEntry({
          type: 'system',
          speaker: 'system',
          content: `${info.label} failed to respond: ${mapErrorToUserMessage(err)}`,
          taxonomy_refs: [],
        });
      }
    }

    set({ debateGenerating: null });
    await saveDebate('askQuestion:end');
  },

  crossRespond: async () => {
    console.warn('%c[DEBATE-STORE] crossRespond ENTERED', 'color: red; font-weight: bold; font-size: 14px');
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;
    getGlobalRecorder()?.record({ type: 'debate.round', component: 'debate-store', level: 'debug', debate_id: activeDebate?.id, message: 'crossRespond entered', data: { phase: activeDebate?.phase, transcript_length: activeDebate?.transcript.length, adaptive_phase: activeDebate?.adaptive_staging?.phase_state?.current_phase } });

    // Guard: if openings completed but abort guard prevented phase transition, fix it now
    if (activeDebate.phase === 'opening' && activeDebate.transcript.some(e => e.type === 'opening')) {
      get().updatePhase('debate');
    }

    _abortController = new AbortController();
    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [] });

    // Lazy-load edges for moderator context
    const taxState = useTaxonomyStore.getState();
    if (!taxState.edgesFile) {
      await useTaxonomyStore.getState().loadEdges();
    }

    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;
    const aiPovers = AI_POVER_ORDER.filter((p) => activeDebate.active_povers.includes(p));

    if (aiPovers.length < 2) {
      set({ debateError: 'Need at least 2 AI debaters for cross-response' });
      return;
    }

    const recentTranscript = formatRecentTranscript(activeDebate.transcript, 8, activeDebate.context_summaries);
    const poverLabels = aiPovers.map((p) => POVER_INFO[p].label);

    // Bypass moderator when debate is already terminated/closed — pick missing debater directly
    const isAlreadyTerminated = activeDebate.phase === 'closed'
      || (activeDebate as Record<string, unknown>).adaptive_staging
        && ((activeDebate as Record<string, unknown>).adaptive_staging as Record<string, unknown>)?.phase_state
        && ((activeDebate as Record<string, unknown>).adaptive_staging as Record<string, unknown> & { phase_state: { current_phase: string } }).phase_state.current_phase === 'terminated';
    if (isAlreadyTerminated) {
      // Find debaters who haven't spoken in the last round
      const lastRoundSpeakers = new Set<string>();
      for (let j = activeDebate.transcript.length - 1; j >= 0; j--) {
        const e = activeDebate.transcript[j];
        if (e.type === 'statement') lastRoundSpeakers.add(e.speaker);
        else if (e.type === 'system' && /\[Phase|Moderator|Round/.test(e.content)) break;
        else if (e.type !== 'statement' && e.type !== 'system') break;
      }
      const missingPovers = aiPovers.filter(p => !lastRoundSpeakers.has(p));
      if (missingPovers.length > 0) {
        // Use the first missing pover and jump straight to step 2 (response generation)
        const responderPover = missingPovers[0];
        const crossRespondRound = activeDebate.transcript.filter(e => e.type === 'statement').length + 1;
        const phase = 'concluding';
        const focusPoint = 'Give your final statement on this debate.';
        const addressingLabel = 'all';
        set({ debateGenerating: responderPover });

        // Jump to step 2 with these values — the rest of crossRespond handles it
        // We need to skip to the pipeline section; use a goto-like pattern by setting these
        // and falling through. Instead, extract a helper or inline the pipeline call.
        // For simplicity: call the pipeline inline here.
        const info = POVER_INFO[responderPover];
        const currentTranscript = formatRecentTranscript(get().activeDebate!.transcript, 8, get().activeDebate!.context_summaries);
        const ctx = await getRelevantTaxonomyContext(info.pov, topic, currentTranscript);
        const speakerClaims = (activeDebate.argument_network?.nodes || []).filter(n => n.speaker === responderPover);
        const commitBlock = formatCommitments(
          activeDebate.commitments?.[responderPover] || { asserted: [], conceded: [], challenged: [] },
          speakerClaims,
        );
        const allANNodes = (activeDebate.argument_network?.nodes || []).map(n => ({
          id: n.id, text: n.text, speaker: POVER_INFO[n.speaker as Exclude<SpeakerId, 'user'>]?.label || n.speaker,
        }));
        const establishedBlock = formatEstablishedPoints(allANNodes, info.label, 10);
        const edgeBlock = formatDebaterEdgeContext(info.pov);
        const concessionAN = activeDebate.argument_network;
        const priorConceded = activeDebate.commitments?.[responderPover]?.conceded ?? [];
        const concessionHint = concessionAN
          ? formatConcessionCandidatesHint(concessionAN.nodes, concessionAN.edges, responderPover, priorConceded)
          : '';
        const crVocab = get().vocabularyTerms;
        const crVocabBlock = crVocab
          ? '\n' + formatVocabularyContext({ pov: info.pov, standardizedTerms: crVocab.standardized, colloquialTerms: crVocab.colloquial })
          : '';
        const taxonomyBlock = formatTaxonomyContext(ctx, info.pov) + crVocabBlock;
        const crDocAnalysis = activeDebate.document_analysis;
        const priorMoves = activeDebate.transcript
          .filter(e => e.speaker === responderPover && e.metadata)
          .flatMap(e => {
            const mt = (e.metadata as Record<string, unknown>)?.move_types;
            return Array.isArray(mt) ? mt.map(m => getMoveName(m)) : [];
          })
          .slice(-6);
        const priorRefs = activeDebate.transcript
          .filter(e => e.speaker === responderPover && e.type !== 'opening')
          .slice(-2)
          .flatMap(e => (e.taxonomy_refs ?? []).map(r => r.node_id));
        const availablePovNodeIds = [...getAllKnownNodeIds()];
        const debaterGapHint = formatGapHint(activeDebate.gap_injections);
        const [evidenceIndex, docTitles] = await Promise.all([getSourceEvidenceIndex(), getDocTitles()]);

        const pipelineInput: TurnPipelineInput = {
          label: info.label,
          pov: info.pov,
          personality: info.personality,
          topic,
          taxonomyContext: taxonomyBlock,
          commitmentContext: commitBlock,
          establishedPoints: establishedBlock,
          edgeContext: edgeBlock,
          concessionHint: concessionHint + debaterGapHint,
          recentTranscript: currentTranscript,
          focusPoint,
          addressing: addressingLabel,
          phase,
          priorMoves,
          priorRefs,
          availablePovNodeIds,
          pendingIntervention: undefined,
          sourceContent: crDocAnalysis ? undefined : (activeDebate.source_content || undefined),
          documentAnalysis: crDocAnalysis,
          audience: activeDebate.audience,
          model,
          sourceEvidenceIndex: evidenceIndex as TurnPipelineInput['sourceEvidenceIndex'],
          docTitles: docTitles as TurnPipelineInput['docTitles'],
          doctrinalBoundaries: info.doctrinal_boundaries,
        };

        const stageGenerate = makeStageGenerate(set as (partial: Record<string, unknown>) => void, model);
        const pipelineResult = await runTurnPipeline(pipelineInput, stageGenerate);
        if (!isStillValid()) { set({ debateGenerating: null }); return; }

        const { statement, taxonomyRefs, meta } = parsePoverResponse(pipelineResult.final_text);
        if (ctx.nodeScores) {
          for (const ref of taxonomyRefs) {
            const score = ctx.nodeScores.get(ref.node_id);
            if (score != null) ref.relevance_score = score;
          }
        }
        const relevanceSources = serializeNodeSourceMap(ctx.nodeSourceMap, taxonomyRefs);
        addTranscriptEntry({
          type: 'statement',
          speaker: responderPover,
          content: statement,
          taxonomy_refs: taxonomyRefs,
          policy_refs: meta.policy_refs,
          addressing: addressingLabel,
          metadata: { ...meta, round: crossRespondRound, moderator_trace: { selected: info.label, selection_reason: 'post_termination_final_statement' }, relevance_sources: relevanceSources },
        });
        const lastEntry = get().activeDebate?.transcript.slice(-1)[0];
        if (lastEntry) {
          const draftDiag = pipelineResult.stage_diagnostics.find(s => s.stage === 'draft');
          recordDiagnostic(get, set, lastEntry.id, {
            prompt: draftDiag?.raw_response ?? pipelineResult.final_text,
            raw_response: pipelineResult.final_text,
            model,
            taxonomy_context: taxonomyBlock,
            commitment_context: commitBlock || undefined,
            stage_diagnostics: pipelineResult.stage_diagnostics,
          });
          void extractClaimsAndUpdateAN(statement, responderPover, lastEntry.id, taxonomyRefs.map(r => r.node_id), get, set, meta.my_claims);
          await summarizeTranscriptEntry(lastEntry.id, statement, info.label, model, get, set);
        }
        set({ debateGenerating: null });
        await saveDebate('crossRespond:postTermination');
        return;
      }
    }

    // Step 1: Active moderator — delegate to shared orchestration
    set({ debateGenerating: 'system' as SpeakerId, debateActivity: 'Moderator selection...' });

    const crossRespondRound = activeDebate.transcript.filter(e => e.type === 'statement').length + 1;
    const adaptiveStaging = activeDebate.adaptive_staging;
    let totalRoundsForPhase: number;
    let phase: string;
    if (adaptiveStaging?.enabled) {
      const weights = loadProvisionalWeights();
      const pacingPreset = weights.pacing_presets[adaptiveStaging.pacing] ?? weights.pacing_presets.moderate;
      totalRoundsForPhase = pacingPreset.maxTotalRounds;
      // Initialize phase state on first round if not present
      if (!adaptiveStaging.phase_state) {
        const config: PhaseTransitionConfig = {
          useAdaptiveStaging: true,
          maxTotalRounds: pacingPreset.maxTotalRounds,
          pacing: adaptiveStaging.pacing,
          dialecticalStyle: 'adversarial',
          argumentationExitThreshold: pacingPreset.argumentationExit,
          concludingExitThreshold: pacingPreset.concludingExit,
          allowEarlyTermination: true,
        };
        adaptiveStaging.phase_state = initPhaseState(config);
        set({ activeDebate: { ...activeDebate } });
      }
      phase = adaptiveStaging.phase_state.current_phase;
    } else {
      totalRoundsForPhase = get().initialCrossRespondRounds || 5;
      phase = getDebatePhase(crossRespondRound, totalRoundsForPhase * 3);
    }
    getGlobalRecorder()?.record({ type: 'debate.round', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: `Cross-respond round ${crossRespondRound} start`, data: { round: crossRespondRound, phase, speakers: aiPovers } });

    const sourceDocSummary = activeDebate.document_analysis?.claims_summary
      ?? (activeDebate.source_content ? activeDebate.source_content.slice(0, 2000) : undefined);

    const selectionCallbacks: ModeratorSelectionCallbacks = {
      generate: async (prompt, _model, _options, label) => {
        const { text } = await generateTextWithProgress(prompt, model, label, set);
        return text;
      },
      addEntry: (entry) => addTranscriptEntry(entry),
      progress: (_phase, _speaker, message) => set({ debateActivity: message ?? null }),
      warn: (context, err, _recovery) => console.warn(`[Moderator] ${context}:`, err),
      formatEdgeContext: (activeLabels) => ({ text: formatEdgeContext(activeLabels) }),
      isAborted: () => !isStillValid(),
    };

    const selectionInput: ModeratorSelectionInput = {
      round: crossRespondRound,
      phase,
      activePovers: aiPovers,
      totalRounds: totalRoundsForPhase * 3,
      model,
      audience: activeDebate.audience,
      sourceDocSummary,
      transcript: activeDebate.transcript,
      contextSummaries: activeDebate.context_summaries,
      argumentNetwork: activeDebate.argument_network ?? undefined,
      convergenceSignals: activeDebate.convergence_signals,
      unansweredLedger: activeDebate.unanswered_claims_ledger,
      gapInjections: activeDebate.gap_injections,
      commitments: activeDebate.commitments,
      existingModState: activeDebate.moderator_state,
      poverInfo: POVER_INFO as Record<string, { label: string; pov: string; personality?: string }>,
    };

    let modResult: Awaited<ReturnType<typeof runModeratorSelection>>;
    try {
      modResult = await runModeratorSelection(selectionInput, selectionCallbacks);
      if (!isStillValid()) return;
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'error',
        message: 'Cross-respond moderator selection failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      set({ debateError: `Cross-respond selection failed: ${mapErrorToUserMessage(err)}`, debateGenerating: null });
      return;
    }

    if (modResult.earlyReturn && modResult.agreementDetected) {
      // Persist moderator state and stop — agreement detected
      const freshDebate = get().activeDebate;
      if (freshDebate) {
        set({ activeDebate: { ...freshDebate, moderator_state: modResult.modState } });
      }
      set({ debateGenerating: null });
      await saveDebate('crossRespond:agreement');
      return;
    }

    const responderPover = modResult.responder;
    const focusPoint = modResult.focusPoint;
    const addressingLabel = modResult.addressing;
    const intervention = modResult.intervention;
    const interventionBriefInjection = modResult.interventionBriefInjection;
    const healthScore = modResult.healthScore;
    const selectionResult = modResult.selectionResult as SelectionResult | null;

    // Update moderator state after selection/intervention
    const modState = modResult.modState;
    const engineValidation = intervention
      ? { proceed: true, validated_move: intervention.move, validated_family: intervention.family, validated_target: intervention.target_debater } as import('@lib/debate/types').EngineValidationResult
      : { proceed: false, validated_move: (selectionResult?.suggested_move ?? 'PIN') as import('@lib/debate/types').InterventionMove, validated_family: 'elicitation' as import('@lib/debate/types').InterventionFamily, validated_target: responderPover } as import('@lib/debate/types').EngineValidationResult;
    updateModeratorState(modState, intervention, engineValidation, crossRespondRound, phase);
    getGlobalRecorder()?.record({ type: 'debate.moderate', component: 'moderator', level: 'info', debate_id: activeDebate.id, message: intervention ? `Moderator intervention: ${intervention.move}` : `Moderator selected: ${responderPover}`, data: { responder: responderPover, intervention_move: intervention?.move ?? null, budget_remaining: modState.budget_remaining, health_score: healthScore?.value, health_trend: healthScore?.trend } });

    // Persist moderator state on the session
    {
      const freshDebate = get().activeDebate;
      if (freshDebate) {
        set({ activeDebate: { ...freshDebate, moderator_state: modState } });
      }
    }

    // Build moderator trace for diagnostics
    const anNodes = activeDebate.argument_network?.nodes ?? [];
    const lastSpeakerEntry = [...activeDebate.transcript].reverse().find(
      (e) => (e.type === 'statement' || e.type === 'opening') && e.speaker !== 'user' && e.speaker !== 'system',
    );
    const lastSpeaker = lastSpeakerEntry?.speaker as Exclude<SpeakerId, 'user'> | undefined;
    const moderatorTrace: Record<string, unknown> = {
      selected: POVER_INFO[responderPover].label,
      excluded_last_speaker: lastSpeaker ? POVER_INFO[lastSpeaker]?.label ?? lastSpeaker : null,
      candidates: aiPovers
        .filter(p => p !== lastSpeaker)
        .map((p, i) => {
          const poverClaims = anNodes.filter(n => n.speaker === p);
          const scoredClaims = poverClaims.filter(n => n.computed_strength != null);
          const avgStrength = scoredClaims.length > 0
            ? scoredClaims.reduce((sum, n) => sum + n.computed_strength!, 0) / scoredClaims.length
            : null;
          return {
            debater: POVER_INFO[p].label,
            computed_strength: avgStrength,
            claim_count: poverClaims.length,
            scored_count: scoredClaims.length,
            rank: i + 1,
          };
        }),
      convergence_score: activeDebate.convergence_tracker?.issues?.[0]?.convergence ?? null,
      convergence_triggered: false,
      commitment_snapshot: Object.fromEntries(
        aiPovers.map(p => [
          POVER_INFO[p].label,
          {
            asserted: (activeDebate.commitments?.[p]?.asserted ?? []).length,
            conceded: (activeDebate.commitments?.[p]?.conceded ?? []).length,
            challenged: (activeDebate.commitments?.[p]?.challenged ?? []).length,
          },
        ])
      ),
      selection_reason: 'moderator_ai_selection',
      focus_point: focusPoint,
      selection_prompt: modResult.diagnostics.selectionPrompt,
      selection_response: modResult.diagnostics.selectionResponse,
      health_score: healthScore.value,
      health_components: healthScore.components,
      health_trend: healthScore.trend,
      intervention_recommended: selectionResult?.intervene ?? false,
      intervention_move: selectionResult?.suggested_move ?? null,
      intervention_validated: engineValidation?.proceed ?? false,
      intervention_suppressed_reason: engineValidation?.suppressed_reason ?? null,
      intervention_suppression_explanation: engineValidation?.suppression_explanation ?? null,
      intervention_target: selectionResult?.target_debater ?? null,
      trigger_reasoning: selectionResult?.trigger_reasoning ?? null,
      trigger_evidence: selectionResult?.trigger_evidence ?? null,
      budget_remaining: modState.budget_remaining,
      budget_total: modState.budget_total,
      cooldown_rounds_left: Math.max(0, modState.required_gap - modState.rounds_since_last_intervention),
      burden_per_debater: { ...modState.burden_per_debater },
    };

    // Step 2: Generate the cross-response
    set({ debateGenerating: responderPover });

    const info = POVER_INFO[responderPover];
    const currentTranscript = formatRecentTranscript(get().activeDebate!.transcript, 8, get().activeDebate!.context_summaries);
    const ctx = await getRelevantTaxonomyContext(info.pov, topic, currentTranscript);
    const speakerClaims = (activeDebate.argument_network?.nodes || []).filter(n => n.speaker === responderPover);
    const commitBlock = formatCommitments(
      activeDebate.commitments?.[responderPover] || { asserted: [], conceded: [], challenged: [] },
      speakerClaims,
    );
    const allANNodes = (activeDebate.argument_network?.nodes || []).map(n => ({
      id: n.id, text: n.text, speaker: POVER_INFO[n.speaker as Exclude<SpeakerId, 'user'>]?.label || n.speaker,
    }));
    const establishedBlock = formatEstablishedPoints(allANNodes, info.label, 10);
    const edgeBlock = formatDebaterEdgeContext(info.pov);

    // QBAF-grounded concession hint: surface strong opposing claims this debater
    // hasn't attacked or already conceded. Counterbalances the rotation rule
    // that blocks consecutive CONCEDE openings.
    const concessionAN = activeDebate.argument_network;
    const priorConceded = activeDebate.commitments?.[responderPover]?.conceded ?? [];
    const concessionHint = concessionAN
      ? formatConcessionCandidatesHint(concessionAN.nodes, concessionAN.edges, responderPover, priorConceded)
      : '';
    const concessionCandidateIds = concessionHint
      ? concessionAN!.nodes
          .filter(n => n.speaker !== responderPover)
          .filter(n => (n.computed_strength ?? n.base_strength ?? 0) >= 0.65)
          .filter(n => !concessionAN!.edges.some(e => e.type === 'attacks' && concessionAN!.nodes.find(x => x.id === e.source)?.speaker === responderPover && e.target === n.id))
          .filter(n => !priorConceded.includes(n.id) && !priorConceded.includes(n.text))
          .sort((a, b) => (b.computed_strength ?? 0) - (a.computed_strength ?? 0))
          .slice(0, 2)
          .map(n => n.id)
      : [];

    const crVocab = get().vocabularyTerms;
    const crVocabBlock = crVocab
      ? '\n' + formatVocabularyContext({ pov: info.pov, standardizedTerms: crVocab.standardized, colloquialTerms: crVocab.colloquial })
      : '';
    const taxonomyBlock = formatTaxonomyContext(ctx, info.pov) + crVocabBlock;
    const crDocAnalysis = activeDebate.document_analysis;

    // Collect prior move types for diversity enforcement
    const priorMoves = activeDebate.transcript
      .filter(e => e.speaker === responderPover && e.metadata)
      .flatMap(e => {
        const mt = (e.metadata as Record<string, unknown>)?.move_types;
        return Array.isArray(mt) ? mt.map(m => getMoveName(m)) : [];
      })
      .slice(-6);

    // Collect prior refs for citation rotation
    const priorRefs = activeDebate.transcript
      .filter(e => e.speaker === responderPover && e.type !== 'opening')
      .slice(-2)
      .flatMap(e => (e.taxonomy_refs ?? []).map(r => r.node_id));

    const availablePovNodeIds = [...getAllKnownNodeIds()];

    // ── 4-stage pipeline: BRIEF → PLAN → DRAFT → CITE ──
    const debaterGapHint = formatGapHint(activeDebate.gap_injections);
    // Build pendingIntervention for the Draft/Cite stages
    const pendingInterventionData = intervention ? (() => {
      const moveConfig = MOVE_RESPONSE_CONFIG[intervention.move as keyof typeof MOVE_RESPONSE_CONFIG];
      const targetLabel = POVER_INFO[intervention.target_debater as Exclude<SpeakerId, 'user'>]?.label ?? intervention.target_debater;
      const isTargeted = targetLabel.toLowerCase() === info.label.toLowerCase();
      return {
        move: intervention.move,
        family: intervention.family,
        targetDebater: targetLabel,
        responseField: moveConfig?.field ?? undefined,
        responseSchema: moveConfig?.schema ?? undefined,
        directResponsePattern: DIRECT_RESPONSE_PATTERNS[intervention.move as keyof typeof DIRECT_RESPONSE_PATTERNS] ?? undefined,
        isTargeted,
      };
    })() : undefined;

    // Load source evidence index and document titles (cached after first call)
    const [evidenceIndex, docTitles] = await Promise.all([getSourceEvidenceIndex(), getDocTitles()]);

    const pipelineInput: TurnPipelineInput = {
      label: info.label,
      pov: info.pov,
      personality: info.personality,
      topic,
      taxonomyContext: taxonomyBlock,
      commitmentContext: commitBlock,
      establishedPoints: establishedBlock,
      edgeContext: edgeBlock,
      concessionHint: concessionHint + debaterGapHint + interventionBriefInjection,
      recentTranscript: currentTranscript,
      focusPoint,
      addressing: addressingLabel,
      phase,
      priorMoves,
      priorRefs,
      availablePovNodeIds,
      pendingIntervention: pendingInterventionData,
      sourceContent: crDocAnalysis ? undefined : (activeDebate.source_content || undefined),
      documentAnalysis: crDocAnalysis,
      audience: activeDebate.audience,
      model,
      sourceEvidenceIndex: evidenceIndex as TurnPipelineInput['sourceEvidenceIndex'],
      docTitles: docTitles as TurnPipelineInput['docTitles'],
      doctrinalBoundaries: info.doctrinal_boundaries,
    };

    const stageGenerate = makeStageGenerate(set as (partial: Record<string, unknown>) => void, model);

    try {
      console.warn('%c[DEBATE-STORE] Inside try block — about to build retryCallbacks', 'color: cyan; font-weight: bold; font-size: 12px');
      // ── Per-turn validation + retry loop ──
      const activeSnapshot = get().activeDebate;
      const vConfig = resolveTurnValidationConfig(undefined);

      const retryCallbacks: TurnRetryCallbacks = {
        runPipeline: (input) => runTurnPipeline(
          input, stageGenerate,
          (_stage, label) => set({ debateActivity: label }),
        ),
        assembleResult: (result) => assemblePipelineResult(result),
        callJudge: async (jp: string, label: string) => {
          const r = await generateTextWithProgress(jp, vConfig.judgeModel, label, set);
          return r.text;
        },
        isAborted: () => !isStillValid(),
      };

      const retryInput: TurnRetryInput = {
        pipelineInput,
        model,
        speaker: responderPover,
        round: crossRespondRound,
        priorTurns: (activeSnapshot?.transcript ?? [])
          .filter(e => e.speaker === responderPover && e.type !== 'opening')
          .slice(-2),
        recentTurns: (activeSnapshot?.transcript ?? [])
          .filter(e => e.speaker !== 'system' && e.speaker !== 'user')
          .slice(-2),
        knownNodeIds: getAllKnownNodeIds(),
        policyIds: getAllPolicyIds(),
        audience: get().audience,
        pendingIntervention: intervention,
      };

      console.warn('%c[DEBATE-STORE] About to call executeTurnWithRetry', 'color: lime; font-weight: bold; font-size: 14px');
      const turnResult = await executeTurnWithRetry(retryInput, retryCallbacks);
      console.warn('%c[DEBATE-STORE] executeTurnWithRetry returned', 'color: lime; font-weight: bold; font-size: 14px', { attempts: turnResult.attempts.length, outcome: turnResult.validation.outcome });
      if (turnResult.aborted) return;
      const { statement, taxonomyRefs, meta, validation, attempts, pipelineResult } = turnResult;

      // Enrich taxonomy refs with relevance scores from context injection
      if (ctx.nodeScores) {
        for (const ref of taxonomyRefs) {
          const score = ctx.nodeScores.get(ref.node_id);
          if (score != null) ref.relevance_score = score;
        }
      }

      // Serialize source tracking for diagnostics display
      const relevanceSources = serializeNodeSourceMap(ctx.nodeSourceMap, taxonomyRefs);

      // Extract caveats: only QUALITY (judge weakness) hints — not DRAFT or CITE structural hints
      const CITE_RE = /taxonomy_refs.*(?:filler|too-short|relevance)|No new taxonomy_refs|Unknown taxonomy node|Unknown policy_refs|grounding_confidence/i;
      const DRAFT_RE = /move_types|my_claims|paragraph|statement|hedge|constructive|pin_response|probe_response|challenge_response|clarification|check_response|revoice|reflection|compressed_thesis|commitment/i;
      const caveats = (validation.repairHints ?? []).filter((h: string) =>
        !CITE_RE.test(h) && !DRAFT_RE.test(h)
      );

      // Add ungrounded claims from the evidence work product
      const evidenceDiagForCaveats = pipelineResult.stage_diagnostics.find((s: { stage: string }) => s.stage === 'evidence');
      const ungroundedClaims = (evidenceDiagForCaveats?.work_product as Record<string, unknown>)?.ungrounded_claims as
        Array<{ claim: string; reason: string }> | undefined;
      if (ungroundedClaims?.length) {
        for (const uc of ungroundedClaims) {
          caveats.push(`[Ungrounded] ${uc.claim}`);
        }
      }

      addTranscriptEntry({
        type: 'statement',
        speaker: responderPover,
        content: statement,
        taxonomy_refs: taxonomyRefs,
        policy_refs: enrichPolicyRefs(meta.policy_refs, pipelineResult.draft as unknown as Record<string, unknown>),
        addressing: 'all',
        caveats: caveats.length > 0 ? caveats : undefined,
        metadata: {
          cross_respond: true, round: crossRespondRound,
          focus_point: focusPoint, addressing_label: addressingLabel,
          moderator_trace: moderatorTrace, ...meta,
          relevance_sources: relevanceSources,
          turn_validation_outcome: validation.outcome,
          turn_validation_score: validation.score,
          turn_validation_attempts: attempts.length,
          turn_validation_flagged: validation.outcome === 'accept_with_flag' ? true : undefined,
          concession_candidates_offered: concessionCandidateIds.length > 0 ? concessionCandidateIds : undefined,
          concession_considered: (meta as Record<string, unknown>)?.concession_considered as string | undefined,
        },
      });

      // Persist validation trail + route clarifies_taxonomy hints
      {
        const lastId = get().activeDebate?.transcript.slice(-1)[0]?.id;
        if (lastId) {
          const curr = get().activeDebate;
          if (curr) {
            const trail: TurnValidationTrail = { attempts, final: validation };
            const trails = { ...(curr.turn_validations ?? {}), [lastId]: trail };
            let suggestions = curr.taxonomy_suggestions;
            if (validation.clarifies_taxonomy.length > 0) {
              suggestions = routeTurnValidatorHintsIntoSuggestions(validation, lastId, suggestions);
            }
            set({ activeDebate: { ...curr, turn_validations: trails, taxonomy_suggestions: suggestions } });
          }
        }
      }

      const draftDiag = pipelineResult.stage_diagnostics.find(s => s.stage === 'draft');
      const lastEntry = get().activeDebate?.transcript.slice(-1)[0];
      if (lastEntry) {
        recordDiagnostic(get, set, lastEntry.id, {
          prompt: draftDiag?.prompt ?? '',
          raw_response: draftDiag?.raw_response ?? '',
          model,
          response_time_ms: pipelineResult.total_time_ms,
          taxonomy_context: taxonomyBlock,
          commitment_context: commitBlock || undefined,
          stage_diagnostics: pipelineResult.stage_diagnostics,
        });
        void extractClaimsAndUpdateAN(statement, responderPover, lastEntry.id, taxonomyRefs.map(r => r.node_id), get, set, meta.my_claims,
          // Lookahead regen callback: regenerate with per-claim guidance, frozen Brief
          async (guidance) => {
            try {
              const regenPipelineInput = {
                ...pipelineInput,
                frozenBrief: pipelineResult.brief,           // skip Brief stage — situation doesn't change between retries
                strongFoundations: guidance.strongFoundations, // "base your argument on these"
                avoidClaims: guidance.avoidClaims,             // "do not use these for these reasons"
              };
              const regenPipelineResult = await runTurnPipeline(regenPipelineInput, stageGenerate, (_stage, label) => set({ debateActivity: `Regenerating: ${label}` }));
              const regenAssembled = assemblePipelineResult(regenPipelineResult);
              if (!regenAssembled) return null;
              const { statement: newStatement, meta: newMeta } = regenAssembled;
              return { statement: newStatement, debaterClaims: newMeta.my_claims };
            } catch (err) {
              getGlobalRecorder()?.record({
                type: 'system.error',
                component: 'debate-store',
                level: 'warn',
                message: 'Lookahead response regeneration failed',
                error: { name: (err as Error).name ?? 'Error', message: String(err) },
              });
              console.warn('[Lookahead] Response regeneration failed:', err);
              return null;
            }
          },
        );
        // Post-turn summarization (DT-2)
        await summarizeTranscriptEntry(lastEntry.id, statement, info.label, model, get, set);

        // Position drift detection (non-blocking)
        try {
          const currentD = get().activeDebate;
          const openingEmbeds = currentD?.metadata?._openingEmbeddings as Record<string, number[]> | undefined;
          if (openingEmbeds && openingEmbeds[responderPover]) {
            const responseEmbed = await api.computeQueryEmbedding(statement.slice(0, 1000));
            const selfSim = cosineSimilarity(responseEmbed.vector, openingEmbeds[responderPover]);
            const opponentSims: Record<string, number> = {};
            for (const [pov, embed] of Object.entries(openingEmbeds)) {
              if (pov !== responderPover) opponentSims[pov] = cosineSimilarity(responseEmbed.vector, embed);
            }
            // Re-read fresh state — the await above yielded to the event loop,
            // so concurrent commits (e.g., fire-and-forget extractClaimsAndUpdateAN)
            // may have landed in between. Spreading the stale `currentD` would
            // clobber their writes (notably argument_network).
            const freshD = get().activeDebate;
            const drift = freshD?.position_drift ?? [];
            drift.push({ round: crossRespondRound, speaker: responderPover, self_similarity: selfSim, opponent_similarities: opponentSims });
            if (freshD) {
              set({ activeDebate: { ...freshD, position_drift: drift } });
            }

            // Sycophancy detection
            const speakerDrift = drift.filter(d => d.speaker === responderPover);
            if (speakerDrift.length >= 3) {
              const recent = speakerDrift.slice(-3);
              const selfDecreasing = recent.every((d, i) => i === 0 || d.self_similarity < recent[i - 1].self_similarity);
              const opponents = Object.keys(recent[0].opponent_similarities);
              const driftingToward = opponents.find(opp =>
                recent.every((d, i) => i === 0 || (d.opponent_similarities[opp] ?? 0) > (recent[i - 1].opponent_similarities[opp] ?? 0)),
              );
              const concessions = currentD?.commitments?.[responderPover]?.conceded ?? [];
              if (selfDecreasing && driftingToward && concessions.length === 0) {
                const opLabel = POVER_INFO[driftingToward as Exclude<SpeakerId, 'user'>]?.label ?? driftingToward;
                addTranscriptEntry({
                  type: 'system', speaker: 'system',
                  content: `[Sycophancy guard] ${info.label} appears to be drifting toward ${opLabel}'s position over the last 3 turns without explicit concession. Self-similarity: ${recent.map(d => d.self_similarity.toFixed(2)).join(' → ')}.`,
                  taxonomy_refs: [],
                });
              }
            }
          }
        } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Position drift detection failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
      }
      // ── Neutral evaluation: midpoint checkpoint ──
      try {
        const midDebate = get().activeDebate;
        if (midDebate && !(midDebate.neutral_evaluations ?? []).some(e => e.checkpoint === 'midpoint')) {
          const midTotal = get().initialCrossRespondRounds || 5;
          const midRound = Math.ceil(midTotal / 2) + 1;
          const curRound = midDebate.transcript.filter(e => e.type === 'statement').length;
          if (curRound === midRound) {
            void runNeutralCheckpoint('midpoint', get, set as any, addTranscriptEntry);
          }
        }
      } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Neutral midpoint checkpoint failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }

      // ── Gap injection — scheduled at midpoint + responsive every 3 rounds after ──
      try {
        const gapDebate = get().activeDebate;
        if (gapDebate) {
          const totalRounds = get().initialCrossRespondRounds || 5;
          const gapRound = Math.ceil(totalRounds / 2) + 1;
          const currentRound = gapDebate.transcript.filter(e => e.type === 'statement').length;

          let triggerType: 'scheduled' | 'responsive' | null = null;
          let focusNodes: { id: string; label: string; description: string }[] | undefined;

          if (currentRound === gapRound && _gapInjectionCount === 0) {
            triggerType = 'scheduled';
          } else if (shouldRunGapCheck(currentRound, gapRound, _gapInjectionCount)) {
            // Responsive check: find unengaged high-relevance nodes (deterministic, no LLM)
            const anNodes = gapDebate.argument_network?.nodes ?? [];
            const engagedIds = collectEngagedNodeIds(
              anNodes.map(n => ({ taxonomy_refs: n.taxonomy_refs ?? [] })),
              gapDebate.transcript.map(e => ({ taxonomy_refs: e.taxonomy_refs ?? [] })),
            );
            const allTaxNodes: { id: string; label: string; description: string }[] = [];
            for (const pov of POV_KEYS) {
              const ctx = getTaxonomyContext(pov);
              for (const n of ctx.povNodes) {
                allTaxNodes.push({ id: n.id, label: n.label, description: n.description });
              }
            }
            const recentText = formatRecentTranscript(gapDebate.transcript, 8, gapDebate.context_summaries);
            const query = `${gapDebate.topic.final}\n\n${recentText}`.slice(0, 500);
            const scores = scoreNodesLexical(query, allTaxNodes, []);
            const unengaged = findUnengagedHighRelevanceNodes(allTaxNodes, engagedIds, scores);
            if (unengaged.length > 0) {
              triggerType = 'responsive';
              focusNodes = unengaged.slice(0, 5);
            }
          }

          if (triggerType) {
            const gapModel = getConfiguredModel();
            const gapTranscript = formatRecentTranscript(gapDebate.transcript, 20, gapDebate.context_summaries);
            const gapSummaryLines: string[] = [];
            for (const pov of POV_KEYS) {
              const ctx = getTaxonomyContext(pov);
              for (const n of ctx.povNodes) {
                gapSummaryLines.push(`[${n.id}] ${n.label} (${n.category ?? 'unknown'}) — ${pov}`);
              }
            }
            const anTexts = (gapDebate.argument_network?.nodes || []).map(n => n.text);
            const gapPrompt = midDebateGapPrompt(
              gapDebate.topic.final,
              gapTranscript,
              gapSummaryLines.slice(0, 80).join('\n'),
              anTexts,
              focusNodes,
            );
            const { text: gapText } = await api.generateText(gapPrompt, gapModel, 30_000);
            const gapParsed = parseAIJson<{ gap_arguments: GapArgument[] }>(gapText);
            const gapArgs = gapParsed?.gap_arguments ?? [];

            if (gapArgs.length > 0) {
              const header = triggerType === 'scheduled' ? 'Mid-Debate Gap Analysis' : 'Responsive Gap Analysis';
              const gapContent = gapArgs.map((g, i) =>
                `**Gap ${i + 1} (${g.gap_type}):** ${g.argument}\n*Why missing:* ${g.why_missing}`
              ).join('\n\n');

              const gapEntryId = addTranscriptEntry({
                type: 'system',
                speaker: 'system',
                content: `## ${header}\n\n${gapContent}`,
                taxonomy_refs: [],
                metadata: { gap_analysis: true, gap_arguments: gapArgs, trigger: triggerType, focus_nodes: focusNodes?.map(n => n.id) },
              });

              _gapInjectionCount++;
              const injection: GapInjection = {
                round: currentRound,
                arguments: gapArgs,
                transcript_entry_id: gapEntryId,
                responses: [],
                trigger: triggerType,
                ...(focusNodes && { focus_nodes: focusNodes.map(n => n.id) }),
              };

              const freshGapDebate = get().activeDebate;
              if (freshGapDebate) {
                const existing = freshGapDebate.gap_injections ?? [];
                set({
                  activeDebate: {
                    ...freshGapDebate,
                    gap_injections: [...existing, injection],
                  },
                  gapInjections: [...existing, injection],
                });
              }

              recordDiagnostic(get, set, gapEntryId, {
                prompt: gapPrompt,
                raw_response: gapText,
                model: gapModel,
              });

              getGlobalRecorder()?.record({ type: 'state.change', component: 'gap-injection', level: 'info', message: `gap.${triggerType}`, data: { round: currentRound, args: gapArgs.length, focus: focusNodes?.length ?? 0, total_injections: _gapInjectionCount } });
            }
          }
        }
      } catch (gapErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'debate-store',
          level: 'warn',
          message: 'Gap injection analysis failed',
          error: { name: (gapErr as Error).name ?? 'Error', message: String(gapErr) },
        });
        console.warn('[Gap Injection] Gap analysis failed (non-blocking):', gapErr);
        pushWarning(get, set, 'Gap analysis skipped this turn');
      }
    } catch (err) {
      addTranscriptEntry({
        type: 'system',
        speaker: 'system',
        content: `${info.label} failed to cross-respond: ${mapErrorToUserMessage(err)}`,
        taxonomy_refs: [],
      });
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'error', debate_id: activeDebate.id, message: `Pipeline failed for ${responderPover} R${crossRespondRound}`, data: { round: crossRespondRound, speaker: responderPover, error: String(err), stack: (err as Error).stack?.slice(0, 500), transcript_length: get().activeDebate?.transcript.length } });
    }

    getGlobalRecorder()?.record({ type: 'debate.round', component: 'debate-store', level: 'debug', debate_id: activeDebate.id, message: `Cross-respond turn complete, entering post-processing`, data: { round: crossRespondRound, speaker: responderPover, transcript_length: get().activeDebate?.transcript.length } });

    const postDebate = get().activeDebate;
    if (postDebate) {
      try {
      pruneSessionData(postDebate);
      if (postDebate.moderator_state) pruneModeratorState(postDebate.moderator_state);

      // ── Adaptive staging: evaluate phase transition after each round ──
      if (postDebate.adaptive_staging?.enabled && postDebate.adaptive_staging.phase_state) {
        const asState = postDebate.adaptive_staging.phase_state;
        const weights = loadProvisionalWeights();
        const pacingPreset = weights.pacing_presets[postDebate.adaptive_staging.pacing] ?? weights.pacing_presets.moderate;
        const config: PhaseTransitionConfig = {
          useAdaptiveStaging: true,
          maxTotalRounds: pacingPreset.maxTotalRounds,
          pacing: postDebate.adaptive_staging.pacing,
          dialecticalStyle: 'adversarial',
          argumentationExitThreshold: asState.argumentation_exit_threshold,
          concludingExitThreshold: asState.concluding_exit_threshold,
          allowEarlyTermination: true,
        };

        // Advance round counter
        const advanced = advanceRound(asState);
        advanced.api_calls_used = (advanced.api_calls_used ?? 0) + 1;

        // Build signal context from session data
        const an = postDebate.argument_network ?? { nodes: [], edges: [] };
        const recentConvSignals = postDebate.convergence_signals ?? [];
        const lastConvSignal = recentConvSignals.length > 0 ? recentConvSignals[recentConvSignals.length - 1] : null;
        const allStatements = postDebate.transcript
          .filter(e => e.type === 'statement' || e.type === 'opening')
          .map(e => {
            const meta = e.metadata as Record<string, unknown> | undefined;
            return {
              round: (meta?.round as number) ?? 0,
              speaker: e.speaker,
              text: e.content,
              extraction_status: 'ok' as const,
              claims_accepted: (meta?.extracted_claims_accepted as number) ?? 0,
              claims_rejected: 0,
              category_validity_ratio: 1.0,
            };
          });
        const lastRoundStatements = allStatements.filter(s => s.round === crossRespondRound);
        const lastClaimsAccepted = lastRoundStatements.reduce((sum, s) => sum + s.claims_accepted, 0);

        const signalCtx: SignalContext = {
          network: {
            nodes: an.nodes.map(n => ({
              id: n.id, speaker: n.speaker,
              computed_strength: n.computed_strength ?? 0.5,
              base_strength: n.base_strength,
              base_strength_category: n.bdi_category,
              argumentation_scheme: (an.edges.find(e => e.source === n.id))?.argumentation_scheme,
              taxonomy_refs: n.taxonomy_refs.map(id => ({
                node_id: typeof id === 'string' ? id : (id as unknown as { node_id: string }).node_id,
                relevance: 'medium',
              })),
              turn_number: n.turn_number,
            })),
            edges: an.edges.map(e => ({
              id: e.id, source: e.source, target: e.target, type: e.type,
              attack_type: e.attack_type, weight: e.weight ?? 0.5,
              scheme: e.scheme, argumentation_scheme: e.argumentation_scheme,
            })),
            nodeCount: an.nodes.length,
          },
          transcript: {
            currentRound: crossRespondRound,
            roundsInPhase: advanced.rounds_in_phase,
            activePovsCount: aiPovers.length,
            lastNRounds: (n: number) => {
              const maxRound = crossRespondRound;
              const minRound = Math.max(1, maxRound - n + 1);
              return allStatements.filter(s => s.round >= minRound && s.round <= maxRound);
            },
          },
          priorSignals: {
            get: (signalId: string, roundsBack: number) => getSignalValue(signalId, roundsBack),
            movingAverage: (signalId: string, windowSize: number) => movingAverageSignal(signalId, windowSize),
          },
          convergenceSignals: {
            argument_redundancy: { avg_self_overlap: lastConvSignal?.argument_redundancy?.avg_self_overlap ?? 0, semantic_max_similarity: lastConvSignal?.argument_redundancy?.semantic_max_similarity },
            dialectical_engagement: { ratio: lastConvSignal?.dialectical_engagement?.ratio ?? 1 },
            position_drift: { drift: lastConvSignal?.position_drift?.drift ?? 0 },
            concession_opportunity: {
              outcome: lastConvSignal?.concession_opportunity?.outcome ?? 'none',
              strong_attacks_faced: lastConvSignal?.concession_opportunity?.strong_attacks_faced ?? 0,
            },
          },
          processRewards: (postDebate.process_rewards ?? []).slice(-12).map(pr => ({
            round: pr.round, score: pr.score,
          })),
          phase: {
            current: advanced.current_phase,
            allPovsResponded: true,
            cruxNodes: detectCruxNodes(
              an.nodes.map(n => ({ id: n.id, speaker: n.speaker, computed_strength: n.computed_strength ?? 0.5, taxonomy_refs: [], turn_number: n.turn_number })),
              an.edges.map(e => ({ id: e.id, source: e.source, target: e.target, type: e.type, weight: e.weight ?? 0.5 })),
            ),
            cruxResolution: (postDebate.crux_tracker ?? []).map(c => ({ id: c.id, state: c.state, support_polarity: c.support_polarity })),
            priorCruxClusters: advanced.prior_crux_clusters,
            regressionCount: advanced.regression_count,
            argumentationExitThreshold: advanced.argumentation_exit_threshold,
            concludingExitThreshold: advanced.concluding_exit_threshold,
          },
          extraction: {
            lastRoundStatus: 'ok',
            lastRoundClaimsAccepted: lastClaimsAccepted,
            lastRoundCategoryValidityRatio: 1.0,
          },
        };

        // Build signals and evaluate
        const signals = buildSignalRegistry();

        // Build health score for early termination
        const turnCounts: Record<string, number> = {};
        for (const p of aiPovers) turnCounts[p] = 0;
        for (const e of postDebate.transcript) {
          if (e.type === 'statement' && e.speaker !== 'system' && e.speaker !== 'moderator') {
            turnCounts[e.speaker] = (turnCounts[e.speaker] ?? 0) + 1;
          }
        }
        const referencedIds = new Set<string>();
        for (const e of postDebate.transcript.slice(-6)) {
          for (const ref of e.taxonomy_refs) referencedIds.add(ref.node_id);
        }
        const taxState = useTaxonomyStore.getState();
        const relevantNodeCount = Math.max(1,
          (taxState.accelerationist?.nodes?.length ?? 0) +
          (taxState.safetyist?.nodes?.length ?? 0) +
          (taxState.skeptic?.nodes?.length ?? 0));
        const asHealthScore = computeDebateHealthScore(recentConvSignals.slice(-3), turnCounts, referencedIds.size, relevantNodeCount);

        const result = evaluatePhaseTransition(advanced, signalCtx, signals, config, asHealthScore);
        getGlobalRecorder()?.record({ type: 'debate.round', component: 'adaptive-staging', level: 'debug', debate_id: postDebate.id, message: `Phase evaluation computed`, data: { round: crossRespondRound, action: result.action, reason: result.reason } });

        // Compute and record signal scores for history tracking
        const coldStart = advanced.rounds_in_phase < 2;
        const satScore = computeSaturationScore(signals, signalCtx, coldStart);
        const convScore = computeConvergenceScore(signalCtx, coldStart);
        recordSignalHistory('_argumentative_saturation_score', crossRespondRound, satScore);
        recordSignalHistory('_convergence_score', crossRespondRound, convScore);

        // Record peak trackers
        if (lastConvSignal) {
          const peakEngagement = getSignalValue('_peak_engagement_ratio', 0) ?? 0;
          const currentEngagement = lastConvSignal.dialectical_engagement?.ratio ?? 0;
          if (currentEngagement > peakEngagement) {
            recordSignalHistory('_peak_engagement_ratio', crossRespondRound, currentEngagement);
          }
        }
        const peakClaims = getSignalValue('_peak_claims_per_round', 0) ?? 0;
        if (lastClaimsAccepted > peakClaims) {
          recordSignalHistory('_peak_claims_per_round', crossRespondRound, lastClaimsAccepted);
        }

        // Record individual signal values
        for (const signal of signals) {
          if (!signal.enabled) continue;
          try {
            const val = Math.max(0, Math.min(1, signal.compute(signalCtx)));
            recordSignalHistory(signal.id, crossRespondRound, val);
          } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Phase signal computation failed', error: { name: (e as Error).name ?? 'Error', message: String(e) } }); }
        }

        // Flight recorder telemetry — per-round state snapshot for diagnostics
        getGlobalRecorder()?.record({
          type: 'debate.round', component: 'adaptive-staging', level: 'info',
          debate_id: postDebate.id,
          message: `Phase evaluation: ${advanced.current_phase} R${crossRespondRound}`,
          data: {
            round: crossRespondRound, phase: advanced.current_phase,
            rounds_in_phase: advanced.rounds_in_phase,
            total_rounds_elapsed: advanced.total_rounds_elapsed,
            saturation_score: satScore, convergence_score: convScore,
            argumentation_exit_threshold: advanced.argumentation_exit_threshold,
            concluding_exit_threshold: advanced.concluding_exit_threshold,
            health_score: asHealthScore, action: result.action,
            reason: result.reason, confidence_deferred: result.confidence_deferred,
            network_nodes: signalCtx.network.nodeCount,
            network_edges: signalCtx.network.edgeCount,
            api_calls_used: advanced.api_calls_used,
            maxTotalRounds: config.maxTotalRounds,
            transcript_length: postDebate.transcript.length,
          },
        });

        // Apply transition
        const prevPhase = advanced.current_phase;
        const newState = applyTransition(advanced, result);

        // Handle transitions
        if (result.action === 'transition' || result.action === 'force_transition') {
          addTranscriptEntry({
            type: 'system', speaker: 'system',
            content: `[Phase transition] ${prevPhase} → ${newState.current_phase}: ${result.reason}`,
            taxonomy_refs: [],
            metadata: { adaptive_transition: true, from_phase: prevPhase, to_phase: newState.current_phase, reason: result.reason },
          });
        } else if (result.action === 'regress') {
          addTranscriptEntry({
            type: 'system', speaker: 'system',
            content: `[Phase regression] concluding → argumentation: ${result.reason}. Threshold ratcheted to ${(newState.argumentation_exit_threshold * 100).toFixed(0)}%.`,
            taxonomy_refs: [],
            metadata: { adaptive_regression: true, reason: result.reason, new_threshold: newState.argumentation_exit_threshold },
          });
        } else if (result.action === 'terminate') {
          addTranscriptEntry({
            type: 'system', speaker: 'system',
            content: `[Adaptive termination] ${result.reason}`,
            taxonomy_refs: [],
            metadata: { adaptive_termination: true, reason: result.reason },
          });
          // Mark terminated so auto-run loop stops
          newState.current_phase = 'terminated';
        }

        // Persist updated phase state + UI convenience fields
        const freshPostDebate = get().activeDebate;
        if (freshPostDebate?.adaptive_staging) {
          freshPostDebate.adaptive_staging.phase_state = newState;
          // Write UI-facing fields for PhaseProgressBar
          const asObj = freshPostDebate.adaptive_staging as Record<string, unknown>;
          asObj.current_phase = newState.current_phase;
          asObj.rounds_in_phase = newState.rounds_in_phase;
          asObj.phase_progress = newState.total_rounds_elapsed / config.maxTotalRounds;
          asObj.approaching_transition = result.action === 'transition' || result.action === 'force_transition';
          asObj.rationale = result.reason;
          set({ activeDebate: { ...freshPostDebate } });
        }
      } else {
        set({ activeDebate: { ...postDebate } });
      }
      } catch (postErr) {
        console.error('[crossRespond] Post-processing failed:', postErr);
        getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'error', debate_id: postDebate.id, message: 'Cross-respond post-processing failed', data: { error: String(postErr), stack: (postErr as Error).stack?.slice(0, 500) } });
      }
    }

    set({ debateGenerating: null });
    getGlobalRecorder()?.record({ type: 'debate.round', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: `Cross-respond round ${crossRespondRound} end` , data: { round: crossRespondRound } });
    await saveDebate('crossRespond:end');
  },

  // ── Phase 5: Synthesis & Probing ──────────────────────────

  requestSynthesis: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    _abortController = new AbortController();
    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [], debateGenerating: 'system' as SpeakerId });
    getGlobalRecorder()?.record({ type: 'debate.phase', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'Phase: concluding', data: { phase: 'concluding' } });

    const model = getConfiguredModel();
    const fullTranscript = formatRecentTranscript(activeDebate.transcript, 50);
    const hasSourceDoc = activeDebate.source_type === 'document' || activeDebate.source_type === 'url';
    const prompt = buildDebateSynthesisPrompt(activeDebate.topic.final, fullTranscript, hasSourceDoc, activeDebate.audience);

    try {
      const synthStartMs = Date.now();
      const { text } = await generateTextWithProgress(prompt, model, `Generating synthesis (${model})`, set, 180_000);
      const synthElapsedMs = Date.now() - synthStartMs;
      if (!isStillValid()) return;

    
      let synthesis: any = parseAIJson(text);
      if (!synthesis) {
        // Synthesis responses are often truncated by token limits.
        // Salvage complete top-level arrays from the partial JSON.
        const stripped = stripCodeFences(text);
        const salvaged = extractArraysFromPartialJson(stripped);
        const hasData = Object.values(salvaged).some(v => Array.isArray(v) && v.length > 0);
        if (hasData) {
          synthesis = salvaged;
        } else {
          synthesis = { _raw_text: stripped, areas_of_agreement: [], areas_of_disagreement: [], unresolved_questions: [], taxonomy_coverage: [] };
        }
      }

      // Build readable content
      // Strip inline node IDs from text fields — they belong in taxonomy_refs, not prose
      const stripNodeIds = (text: string) =>
        text.replace(/\b(?:acc|saf|skp|sit|cc)-(?:beliefs|desires|intentions)-\d+\b/g, '')
            .replace(/\s{2,}/g, ' ').trim();

      const lines: string[] = [];
      if (synthesis._raw_text) {
        lines.push('*Synthesis could not be parsed as structured data. Raw output:*');
        lines.push('');
        // Break raw text into readable paragraphs at sentence boundaries and bullet markers
        const formatted = synthesis._raw_text
          .replace(/([.!?])\s+(?=[A-Z"*-])/g, '$1\n\n')  // paragraph break at sentence ends before capitals
          .replace(/\s*[-–—•]\s+/g, '\n- ')               // normalize bullet-like markers
          .replace(/\s*\d+\.\s+/g, (m: string) => '\n' + m.trim() + ' '); // numbered lists
        lines.push(formatted);
      }
      if (synthesis.areas_of_agreement?.length > 0) {
        lines.push('## Areas of Agreement', '');
        for (const a of synthesis.areas_of_agreement) {
          const who = Array.isArray(a.povers) ? a.povers.map((p: string) => POVER_INFO[p as Exclude<SpeakerId, 'user'>]?.label || p).join(', ') : '';
          lines.push(`- ${stripNodeIds(a.point)}${who ? ` (${who})` : ''}`);
        }
      }
      if (synthesis.areas_of_disagreement?.length > 0) {
        lines.push('', '## Areas of Disagreement', '');
        for (const d of synthesis.areas_of_disagreement) {
          const typeTag = d.type ? ` [${d.type}]` : '';
          const bdiTag = d.bdi_layer ? ` {${d.bdi_layer}}` : '';
          lines.push(`- **${stripNodeIds(d.point)}**${typeTag}${bdiTag}`);
          if (d.resolvability) {
            lines.push(`  - *Resolution path: ${d.resolvability.replace(/_/g, ' ')}*`);
          }
          if (Array.isArray(d.positions)) {
            for (const pos of d.positions) {
              const label = POVER_INFO[pos.pover as Exclude<SpeakerId, 'user'>]?.label || pos.pover;
              lines.push(`  - ${label}: ${stripNodeIds(pos.stance)}`);
            }
          }
        }
      }
      if (synthesis.cruxes?.length > 0) {
        lines.push('', '## Cruxes', '');
        for (const c of synthesis.cruxes) {
          const typeTag = c.type ? ` [${c.type}]` : '';
          lines.push(`- ${stripNodeIds(c.question)}${typeTag}`);
          if (c.if_yes) lines.push(`  - If yes: ${stripNodeIds(c.if_yes)}`);
          if (c.if_no) lines.push(`  - If no: ${stripNodeIds(c.if_no)}`);
        }
      }
      if (synthesis.document_claims?.length > 0) {
        lines.push('', '## Document Claims', '');
        for (const dc of synthesis.document_claims) {
          const accepted = Array.isArray(dc.accepted_by)
            ? dc.accepted_by.map((p: string) => POVER_INFO[p as Exclude<SpeakerId, 'user'>]?.label || p).join(', ')
            : '';
          const challenged = Array.isArray(dc.challenged_by)
            ? dc.challenged_by.map((p: string) => POVER_INFO[p as Exclude<SpeakerId, 'user'>]?.label || p).join(', ')
            : '';
          lines.push(`- ${stripNodeIds(dc.claim)}`);
          if (accepted) lines.push(`  - Accepted by: ${accepted}`);
          if (challenged) lines.push(`  - Challenged by: ${challenged}${dc.challenge_basis ? ` — ${stripNodeIds(dc.challenge_basis)}` : ''}`);
        }
      }
      if (synthesis.argument_map?.length > 0) {
        lines.push('', '## Argument Map', '');
        for (const claim of synthesis.argument_map) {
          const claimantLabel = POVER_INFO[claim.claimant as Exclude<SpeakerId, 'user'>]?.label || claim.claimant;
          const typeTag = claim.type ? ` [${claim.type}]` : '';
          lines.push(`- **${claim.claim_id}** (${claimantLabel})${typeTag}: ${stripNodeIds(claim.claim)}`);
          if (claim.supported_by?.length > 0) {
            for (const sup of claim.supported_by) {
              if (typeof sup === 'string') {
                lines.push(`  - Supported by: ${sup}`);
              } else {
                const schemeTag = sup.scheme ? ` (${sup.scheme.replace(/_/g, ' ')})` : '';
                lines.push(`  - Supported by ${sup.claim_id}${schemeTag}${sup.warrant ? `: ${stripNodeIds(sup.warrant)}` : ''}`);
              }
            }
          }
          if (claim.attacked_by?.length > 0) {
            for (const attack of claim.attacked_by) {
              const attackerLabel = POVER_INFO[attack.claimant as Exclude<SpeakerId, 'user'>]?.label || attack.claimant;
              const schemeTag = attack.scheme ? ` via ${attack.scheme}` : '';
              lines.push(`  - ← **${attack.claim_id}** ${attack.attack_type}${schemeTag} (${attackerLabel}): ${stripNodeIds(attack.claim)}`);
            }
          }
        }
      }
      if (synthesis.preferences?.length > 0) {
        lines.push('', '## Resolution Analysis', '');
        for (const p of synthesis.preferences) {
          if (p.prevails === 'undecidable') {
            lines.push(`- **${stripNodeIds(p.conflict)}** — Undecidable`);
            lines.push(`  - *${stripNodeIds(p.rationale)}*`);
          } else {
            let prevailsText = p.prevails;
            if (/^C\d+$/.test(p.prevails) && synthesis.argument_map) {
              const claim = synthesis.argument_map.find((c: { claim_id: string; claim: string; claimant: string }) => c.claim_id === p.prevails);
              if (claim) prevailsText = `${claim.claimant}: "${stripNodeIds(claim.claim)}"`;
            }
            lines.push(`- **${stripNodeIds(p.conflict)}** — Stronger: ${prevailsText} (${p.criterion?.replace(/_/g, ' ')})`);
            lines.push(`  - *${stripNodeIds(p.rationale)}*`);
          }
          if (p.what_would_change_this) {
            lines.push(`  - Would change if: ${stripNodeIds(p.what_would_change_this)}`);
          }
        }
      }
      if (synthesis.unresolved_questions?.length > 0) {
        lines.push('', '## Unresolved Questions', '');
        for (const q of synthesis.unresolved_questions) {
          lines.push(`- ${stripNodeIds(q)}`);
        }
      }

      const taxonomyCoverage: TaxonomyRef[] = (synthesis.taxonomy_coverage || [])
        .filter((t: Record<string, unknown>) => t.node_id)
        .map((t: Record<string, unknown>) => ({ node_id: t.node_id as string, relevance: (t.how_used as string) || '' }));

      const synthEntryId = addTranscriptEntry({
        type: 'concluding',
        speaker: 'system',
        content: lines.join('\n'),
        taxonomy_refs: taxonomyCoverage,
        metadata: { synthesis },
      });

      recordDiagnostic(get, set, synthEntryId, {
        prompt,
        raw_response: text,
        model,
        response_time_ms: synthElapsedMs,
      });

      // Missing arguments pass — fire after synthesis, non-blocking
      try {
        const synthText = lines.join('\n').slice(0, 4000);
        const summaryLines: string[] = [];
        for (const pov of POV_KEYS) {
          const ctx = getTaxonomyContext(pov);
          for (const n of ctx.povNodes) {
            summaryLines.push(`[${n.id}] ${n.label} (${n.category ?? 'unknown'}) — ${pov}`);
          }
        }
        const maPrompt = missingArgumentsPrompt(
          activeDebate.topic.final,
          summaryLines.slice(0, 80).join('\n'),
          synthText,
          activeDebate.audience,
        );
        const { text: maText } = await api.generateText(maPrompt, model);
        const maParsed = parseAIJson<{ missing_arguments?: unknown[] }>(maText);
        if (maParsed?.missing_arguments && Array.isArray(maParsed.missing_arguments)) {
          const currentDebate = get().activeDebate;
          if (currentDebate) {
            set({ activeDebate: { ...currentDebate, missing_arguments: maParsed.missing_arguments.slice(0, 5) } });
          }
        }
      } catch (maErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'debate-store',
          level: 'warn',
          message: 'Missing arguments detection failed',
          error: { name: (maErr as Error).name ?? 'Error', message: String(maErr) },
        });
        console.warn('[Missing Args] Pass failed (non-blocking):', maErr);
        pushWarning(get, set, 'Missing argument detection skipped');
      }

      // Taxonomy refinement pass — suggest node revisions based on debate evidence
      try {
        const currentD = get().activeDebate;
        if (currentD) {
          const synthText = lines.join('\n').slice(0, 4000);

          // Collect all referenced node IDs from transcript
          const refIds = new Set<string>();
          for (const entry of currentD.transcript) {
            for (const ref of entry.taxonomy_refs ?? []) {
              refIds.add(ref.node_id);
            }
          }

          if (refIds.size > 0) {
            // Resolve to full node data
            const referencedNodes: { id: string; label: string; pov: string; category: string; description: string }[] = [];
            for (const pov of POV_KEYS) {
              const ctx = getTaxonomyContext(pov);
              for (const n of ctx.povNodes) {
                if (refIds.has(n.id)) {
                  referencedNodes.push({
                    id: n.id,
                    label: n.label,
                    pov,
                    category: n.category ?? 'unknown',
                    description: n.description,
                  });
                }
              }
            }

            if (referencedNodes.length > 0) {
              // Build argument map summary
              const an = currentD.argument_network;
              let anSummary = '(no argument network)';
              if (an && an.nodes.length > 0) {
                const anLines = an.nodes.slice(0, 30).map(n => {
                  const attacks = an.edges.filter(e => e.target === n.id && e.type === 'attacks');
                  const supports = an.edges.filter(e => e.target === n.id && e.type === 'supports');
                  let line = `${n.id} (${n.speaker}): "${n.text}"`;
                  if (attacks.length) line += ` [attacked ${attacks.length}x]`;
                  if (supports.length) line += ` [supported ${supports.length}x]`;
                  return line;
                });
                anSummary = anLines.join('\n');
              }

              const trPrompt = taxonomyRefinementPrompt(
                currentD.topic.final,
                synthText,
                referencedNodes.slice(0, 25),
                anSummary,
                activeDebate.audience,
              );
              const { text: trText } = await api.generateText(trPrompt, model);
              const trParsed = parseAIJson<{ taxonomy_suggestions?: unknown[] }>(trText);
              if (trParsed?.taxonomy_suggestions && Array.isArray(trParsed.taxonomy_suggestions)) {
                const latestD = get().activeDebate;
                if (latestD) {
                  set({ activeDebate: { ...latestD, taxonomy_suggestions: trParsed.taxonomy_suggestions.slice(0, 10) } });
                }
              }
            }
          }
        }
      } catch (trErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'debate-store',
          level: 'warn',
          message: 'Taxonomy refinement pass failed',
          error: { name: (trErr as Error).name ?? 'Error', message: String(trErr) },
        });
        console.warn('[Taxonomy Refinement] Pass failed (non-blocking):', trErr);
        pushWarning(get, set, 'Taxonomy refinement suggestions skipped');
      }

      // Cross-cutting node promotion — propose situation nodes from 3-way agreements
      try {
        const ccDebate = get().activeDebate;
        const synthEntry = ccDebate?.transcript.find(e => e.type === 'concluding');
        const synthData = (synthEntry?.metadata as Record<string, unknown>)?.synthesis as Record<string, unknown> | undefined;
        const agreements = ((synthData?.areas_of_agreement ?? []) as { point: string; povers?: string[] }[])
          .filter(a => (a.povers?.length ?? 0) >= 3);

        if (agreements.length > 0 && ccDebate) {
          const ccTaxState = useTaxonomyStore.getState();
          const sitLabels = (ccTaxState.situations?.nodes || []).map(n => n.label);
          const ccPrompt = crossCuttingNodePrompt(
            agreements.map(a => ({ point: a.point, povers: a.povers ?? [] })),
            sitLabels,
            ccDebate.topic.final,
          );
          const { text: ccText } = await api.generateText(ccPrompt, model, 30_000);
          const ccParsed = parseAIJson<{ proposals: CrossCuttingProposal[] }>(ccText);

          if (ccParsed?.proposals?.length) {
            const freshCcDebate = get().activeDebate;
            if (freshCcDebate) {
              set({
                activeDebate: {
                  ...freshCcDebate,
                  cross_cutting_proposals: ccParsed.proposals,
                },
                crossCuttingProposals: ccParsed.proposals,
              });
            }
          }
        }
      } catch (ccErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'debate-store',
          level: 'warn',
          message: 'Cross-cutting proposals detection failed',
          error: { name: (ccErr as Error).name ?? 'Error', message: String(ccErr) },
        });
        console.warn('[Cross-Cutting Proposals] Pass failed (non-blocking):', ccErr);
        pushWarning(get, set, 'Cross-cutting proposal detection skipped');
      }

      // Taxonomy gap analysis (deterministic — no LLM calls)
      try {
        const gapDebate = get().activeDebate;
        if (gapDebate) {
          const gapTaxState = useTaxonomyStore.getState();
          const taxonomyNodes: Record<string, { id: string; label: string; category: string; description?: string }[]> = {};
          for (const pov of POV_KEYS) {
            taxonomyNodes[pov] = (gapTaxState[pov]?.nodes || []).map(n => ({
              id: n.id, label: n.label, category: n.category ?? 'unknown', description: n.description,
            }));
          }

          const gapAnalysis = computeTaxonomyGapAnalysis(
            gapDebate.transcript,
            gapDebate.argument_network?.nodes || [],
            taxonomyNodes,
            [],  // Context manifests — TODO: collect during turns
          );

          const freshGapDebate = get().activeDebate;
          if (freshGapDebate) {
            set({
              activeDebate: {
                ...freshGapDebate,
                taxonomy_gap_analysis: gapAnalysis,
              },
              taxonomyGapAnalysis: gapAnalysis,
            });
          }
        }
      } catch (tgaErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'debate-store',
          level: 'warn',
          message: 'Taxonomy gap analysis failed',
          error: { name: (tgaErr as Error).name ?? 'Error', message: String(tgaErr) },
        });
        console.warn('[Taxonomy Gap Analysis] Pass failed (non-blocking):', tgaErr);
        pushWarning(get, set, 'Taxonomy gap analysis skipped');
      }

      // Neutral evaluation: final checkpoint (after synthesis)
      void runNeutralCheckpoint('final', get, set as any, addTranscriptEntry);

      // Transition phase to closed now that synthesis and all post-synthesis passes are done
      get().updatePhase('closed');

      // Emit lineage.debate-summary — aggregates per-turn lineage boost data for quick impact assessment
      try {
        const closedDebate = get().activeDebate;
        if (closedDebate) {
          const allBoosted = new Set<string>();
          const allPromoted = new Set<string>();
          const allInjected = new Set<string>();
          const allReferenced = new Set<string>();
          let turnsWithBoost = 0;

          for (const entry of closedDebate.transcript) {
            if (entry.type !== 'opening' && entry.type !== 'statement') continue;
            const manifest = (entry.metadata as Record<string, unknown>)?.injection_manifest as {
              lineage_boost?: { boostedNodeIds?: string[]; promotedNodeIds?: string[] };
              povNodeIds?: string[];
            } | undefined;
            if (!manifest) continue;

            for (const id of (entry.taxonomy_refs ?? []).map((r: { node_id: string }) => r.node_id)) allReferenced.add(id);
            for (const id of manifest.povNodeIds ?? []) allInjected.add(id);

            const lb = manifest.lineage_boost;
            if (lb) {
              turnsWithBoost++;
              for (const id of lb.boostedNodeIds ?? []) allBoosted.add(id);
              for (const id of lb.promotedNodeIds ?? []) allPromoted.add(id);
            }
          }

          if (allBoosted.size > 0) {
            const promotedCited = [...allPromoted].filter(id => allReferenced.has(id));
            const promotedCitationRate = allPromoted.size > 0 ? promotedCited.length / allPromoted.size : 0;
            const baselineCitationRate = allInjected.size > 0 ? allReferenced.size / allInjected.size : 0;
            const frameLabels = closedDebate.topic?.critique?.lineage_frame?.map(
              (f: { cluster_id: string; label?: string }) => f.label ?? f.cluster_id,
            ) ?? [];

            getGlobalRecorder()?.record({
              type: 'lineage.debate-summary',
              component: 'debate-store',
              level: 'info',
              debate_id: closedDebate.id,
              message: 'Lineage boost debate summary',
              data: {
                lineage_frame: frameLabels,
                turns_with_boost: turnsWithBoost,
                total_boosted: allBoosted.size,
                total_promoted: allPromoted.size,
                promoted_node_ids: [...allPromoted],
                promoted_cited: promotedCited.length,
                promoted_citation_rate: Math.round(promotedCitationRate * 1000) / 1000,
                baseline_citation_rate: Math.round(baselineCitationRate * 1000) / 1000,
                verdict: promotedCitationRate > 0.15 ? 'high_impact' : promotedCitationRate > 0.05 ? 'moderate_impact' : 'low_impact',
              },
            });
          }
        }
      } catch (summaryErr) {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'debate-store', level: 'warn',
          message: 'Lineage debate summary emission failed',
          error: { name: (summaryErr as Error).name ?? 'Error', message: String(summaryErr) },
        });
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'error',
        message: 'Synthesis failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      set({ debateError: `Synthesis failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate('requestSynthesis');
    }
  },

  requestProbingQuestions: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [], debateGenerating: 'system' as SpeakerId });

    const model = getConfiguredModel();
    const fullTranscript = formatRecentTranscript(activeDebate.transcript, 50);

    // Find taxonomy nodes not yet referenced
    const referencedNodes = new Set<string>();
    for (const entry of activeDebate.transcript) {
      for (const ref of entry.taxonomy_refs) {
        referencedNodes.add(ref.node_id);
      }
    }

    // Gather all taxonomy node IDs from all POVs
    const allNodeIds: string[] = [];
    for (const pov of POV_KEYS) {
      const ctx = getTaxonomyContext(pov);
      for (const n of ctx.povNodes) allNodeIds.push(`[${n.id}] ${n.label}`);
    }
    const ccCtx = getTaxonomyContext('accelerationist'); // situations are the same from any POV
    for (const n of ccCtx.situationNodes) allNodeIds.push(`[${n.id}] ${n.label}`);

    const unreferenced = allNodeIds.filter((desc) => {
      const match = desc.match(/^\[([^\]]+)\]/);
      return match && !referencedNodes.has(match[1]);
    }).slice(0, 20); // Limit to keep prompt reasonable

    const hasSourceDoc = activeDebate.source_type === 'document' || activeDebate.source_type === 'url';
    const prompt = buildProbingQuestionsPrompt(activeDebate.topic.final, fullTranscript, unreferenced, hasSourceDoc, activeDebate.audience);

    try {
      const { text } = await generateTextWithProgress(prompt, model, `Generating probing questions (${model})`, set);
      if (!isStillValid()) return;

      type ProbingQ = { text: string; targets: string[] };
      let questions: ProbingQ[] = [];
      const probParsed = parseAIJson<{ questions?: ProbingQ[] } | ProbingQ[]>(text);
      if (probParsed && typeof probParsed === 'object' && 'questions' in probParsed && Array.isArray(probParsed.questions)) {
        questions = probParsed.questions;
      } else if (Array.isArray(probParsed)) {
        questions = probParsed;
      }
      if (questions.length === 0) {
        questions = [{ text: text.trim(), targets: [] }];
      }

      const probingRound = activeDebate.transcript.filter(e => e.type === 'statement').length;
      addTranscriptEntry({
        type: 'probing',
        speaker: 'system',
        content: questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n'),
        taxonomy_refs: [],
        metadata: { probing_questions: questions, round: probingRound },
      });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'error',
        message: 'Probing questions generation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      set({ debateError: `Probing questions failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate('requestProbingQuestions');
    }
  },

  // ── Phase 7: Fact Check ──────────────────────────────────

  factCheckSelection: async (selectedText: string, entryId: string) => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    if (selectedText.length < 10) {
      set({ debateError: 'Select a complete claim to fact-check (at least 10 characters)' });
      return;
    }

    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [], debateGenerating: 'system' as SpeakerId });

    const model = getConfiguredModel();

    // Find the statement that contains this text
    const sourceEntry = activeDebate.transcript.find((e) => e.id === entryId);
    const statementContext = sourceEntry?.content || selectedText;

    // Gather taxonomy nodes from the statement's refs + general context
    const allNodes: string[] = [];
    if (sourceEntry?.taxonomy_refs) {
      for (const ref of sourceEntry.taxonomy_refs) {
        const label = getNodeLabelForFactCheck(ref.node_id);
        allNodes.push(`[${ref.node_id}] ${label} — ${ref.relevance}`);
      }
    }

    // Also include some general taxonomy context
    for (const pov of POV_KEYS) {
      const ctx = getTaxonomyContext(pov);
      for (const n of ctx.povNodes.slice(0, 5)) {
        if (!allNodes.some((l) => l.includes(n.id))) {
          allNodes.push(`[${n.id}] ${n.label}: ${n.description}`);
        }
      }
    }

    // Gather conflict data — filter by relevance to the statement's taxonomy refs
    const conflicts = useTaxonomyStore.getState().conflicts || [];
    const refNodeIds = new Set((sourceEntry?.taxonomy_refs || []).map(r => r.node_id));
    const conflictLines: string[] = [];
    for (const c of conflicts as { claim_id?: string; claim_label?: string; description?: string; status?: string; linked_taxonomy_nodes?: string[] }[]) {
      if (!c.claim_label) continue;
      // Prioritize conflicts that share taxonomy nodes with the statement
      const linked = Array.isArray(c.linked_taxonomy_nodes) ? c.linked_taxonomy_nodes : [];
      const isRelevant = linked.some(n => refNodeIds.has(n));
      if (isRelevant) {
        conflictLines.unshift(`[${c.claim_id || 'unknown'}] ${c.claim_label}: ${c.description || ''} (${c.status || 'open'})`);
      } else if (conflictLines.length < 10) {
        // Text similarity fallback — check if conflict label overlaps with claim
        const claimWords = new Set(selectedText.toLowerCase().split(/\s+/).filter(w => w.length > 4));
        const labelWords = (c.claim_label || '').toLowerCase().split(/\s+/);
        const overlap = labelWords.filter(w => claimWords.has(w)).length;
        if (overlap >= 2) {
          conflictLines.push(`[${c.claim_id || 'unknown'}] ${c.claim_label} (${c.status || 'open'})`);
        }
      }
    }

    // Step 1: Run grounded web search for external verification
    // Gemini uses native google_search grounding; non-Gemini backends use
    // Tavily search + LLM when TAVILY_API_KEY is configured (see embeddings.ts).
    set({ debateActivity: `Searching the web for evidence (${model})` });
    let webContext = '';
    let searchQueries: string[] = [];
    let webCitations: import('../bridge/types').GroundingCitation[] = [];
    try {
      const searchResult = await api.generateTextWithSearch(
        `Fact-check this claim from an AI policy debate. Find recent, authoritative sources that support or contradict it. Be specific about what evidence you found.\n\nClaim: "${selectedText}"\n\nContext: ${statementContext.slice(0, 500)}`,
        model,
      );
      webContext = searchResult.text;
      searchQueries = searchResult.searchQueries || [];
      webCitations = searchResult.citations || [];
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'warn',
        message: 'Fact-check web search failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      console.warn('[factCheck] Web search failed, proceeding with internal data only:', err);
      pushWarning(get, set, 'Web search unavailable for fact-check');
      webContext = '(Web search unavailable)';
    }
    if (!isStillValid()) return;

    // Step 2: Run main fact-check with all evidence
    const prompt = buildFactCheckPrompt(
      selectedText,
      statementContext,
      allNodes.join('\n'),
      conflictLines.slice(0, 15).join('\n') + (webContext ? `\n\n=== WEB SEARCH RESULTS ===\n${webContext}` : ''),
      activeDebate.audience,
    );

    try {
      set({ debateActivity: `Analyzing evidence (${model})` });
      const { text } = await generateTextWithProgress(prompt, model, `Fact-checking claim (${model})`, set);
      if (!isStillValid()) return;

      let result = parseAIJson<{ verdict?: string; explanation?: string; sources?: unknown[]; points?: unknown[] }>(text);
      if (!result) {
        result = { verdict: 'unverifiable', explanation: text.trim(), sources: [], points: [] };
      }

      const verdictLabels: Record<string, string> = {
        supported: 'Supported',
        disputed: 'Disputed',
        unverifiable: 'Unverifiable',
        false: 'False',
      };

      const sources = Array.isArray(result.sources) ? result.sources : [];
      const sourceRefs = sources
        .filter((s: Record<string, unknown>) => s.node_id || s.conflict_id)
        .map((s: Record<string, unknown>) => ({
          node_id: (s.node_id as string) || (s.conflict_id as string) || '',
          relevance: s.conflict_id ? `Conflict: ${s.conflict_id}` : '',
        }));

      const webNote = searchQueries.length > 0
        ? `\n\n*Web sources consulted: ${searchQueries.slice(0, 3).join(', ')}*`
        : webContext && webContext !== '(Web search unavailable)'
          ? '\n\n*Verified against web search results*'
          : '';

      addTranscriptEntry({
        type: 'fact-check',
        speaker: 'system',
        content: `**Fact Check: ${verdictLabels[result.verdict] || result.verdict}**\n\n"${selectedText.length > 120 ? selectedText.slice(0, 117) + '...' : selectedText}"\n\n${result.explanation}${webNote}`,
        taxonomy_refs: sourceRefs,
        metadata: {
          fact_check: {
            verdict: result.verdict,
            explanation: result.explanation,
            sources: result.sources,
            checked_text: selectedText,
            web_search_used: !!webContext && webContext !== '(Web search unavailable)',
            web_search_queries: searchQueries,
            web_search_evidence: webContext && webContext !== '(Web search unavailable)' ? webContext : undefined,
            web_search_citations: webCitations.length ? webCitations : undefined,
          },
        },
      });

      // ── Generate AN nodes and edges from fact-check points ──
      // Always create AN nodes for a fact-check so the argument network captures
      // the evidence. Falls back gracefully when:
      //   - LLM omitted `points` → synthesize one from verdict+explanation
      //   - No existing AN nodes match entryId → synthesize a target node from selectedText
      const rawPoints = Array.isArray(result.points) ? result.points as { text: string; type?: 'supports' | 'attacks'; evidence_basis?: string }[] : [];
      const points = rawPoints.filter(p => p && p.text && p.text.length > 0);
      const debate = get().activeDebate;
      if (debate) {
        const an = debate.argument_network || { nodes: [], edges: [] };
        const factCheckEntryId = debate.transcript[debate.transcript.length - 1]?.id || generateId();
        const baseTurnNumber = an.nodes.length > 0 ? Math.max(...an.nodes.map(n => n.turn_number)) + 1 : 1;

        // Find AN nodes belonging to the checked statement
        const targetNodes = an.nodes.filter(n => n.source_entry_id === entryId);
        const checkedWords = new Set(selectedText.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        const rankedTargets = targetNodes
          .map(n => {
            const words = n.text.toLowerCase().split(/\s+/);
            const overlap = words.filter(w => checkedWords.has(w)).length;
            return { node: n, overlap };
          })
          .sort((a, b) => b.overlap - a.overlap);

        let nextNodeIdx = an.nodes.length;
        let nextEdgeIdx = an.edges.length;
        const newNodes: typeof an.nodes = [];
        const newEdges: typeof an.edges = [];

        // If no existing target AN node for this entry, synthesize one from the
        // selected text so fact-check findings have something to attach to.
        let bestTarget = rankedTargets[0]?.node;
        if (!bestTarget) {
          const syntheticId = `AN-${nextNodeIdx++}`;
          const syntheticNode = {
            id: syntheticId,
            text: selectedText.length > 300 ? selectedText.slice(0, 297) + '...' : selectedText,
            speaker: 'system' as const,
            source_entry_id: entryId,
            taxonomy_refs: [],
            turn_number: baseTurnNumber,
            base_strength: 0.5,
            scoring_method: 'unscored' as const,
            bdi_category: 'belief' as const,
            specificity: 'precise' as const,
          };
          newNodes.push(syntheticNode);
          bestTarget = syntheticNode;
        }

        // If the LLM returned no usable points, synthesize one from the verdict + explanation
        // so the fact-check still appears in the argument network.
        const pointsToAdd = points.length > 0 ? points : [{
          text: result.explanation || `Fact-check verdict: ${result.verdict}`,
          type: (result.verdict === 'disputed' || result.verdict === 'false') ? 'attacks' as const : 'supports' as const,
          evidence_basis: 'mixed',
        }];

        for (const pt of pointsToAdd.slice(0, 4)) {
          if (!pt.text) continue;
          const attackType = pt.type === 'attacks' ? 'attacks' : 'supports';
          const nodeId = `AN-${nextNodeIdx++}`;
          newNodes.push({
            id: nodeId,
            text: pt.text,
            speaker: 'system',
            source_entry_id: factCheckEntryId,
            taxonomy_refs: [],
            turn_number: baseTurnNumber,
            base_strength: attackType === 'attacks' ? 0.7 : 0.6,
            scoring_method: 'bdi_criteria',
            bdi_category: 'belief',
            specificity: 'precise',
          });
          const edgeId = `AE-${nextEdgeIdx++}`;
          newEdges.push({
            id: edgeId,
            source: nodeId,
            target: bestTarget.id,
            type: attackType,
            attack_type: attackType === 'attacks' ? 'rebut' : undefined,
            scheme: attackType === 'attacks' ? 'EMPIRICAL CHALLENGE' : 'EXTEND',
            warrant: `Fact-check evidence (${pt.evidence_basis || 'mixed'}): ${pt.text.slice(0, 100)}`,
            argumentation_scheme: 'ARGUMENT_FROM_EVIDENCE',
          });
        }

        if (newNodes.length > 0) {
          commitAnNodes(get, set, `factcheck(manual,entry=${entryId.slice(-6)})`, newNodes, newEdges);
        }
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'error',
        message: 'Fact check failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      set({ debateError: `Fact check failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate('factCheckSelection');
    }
  },

  // ── Phase 8: Context Window Management ───────────────────

  compressOldTranscript: async () => {
    const { activeDebate, saveDebate } = get();
    if (!activeDebate) return;

    const transcript = activeDebate.transcript;
    // Only compress if there are enough entries (keep last 8, compress the rest)
    const KEEP_RECENT = 8;
    const MIN_TO_COMPRESS = 12;

    if (transcript.length < MIN_TO_COMPRESS) return;

    // Find entries that haven't been summarized yet
    const lastSummaryIdx = activeDebate.context_summaries.length > 0
      ? transcript.findIndex((e) => e.id === activeDebate.context_summaries[activeDebate.context_summaries.length - 1].up_to_entry_id)
      : -1;

    const startIdx = lastSummaryIdx + 1;
    const endIdx = transcript.length - KEEP_RECENT;

    if (endIdx <= startIdx) return; // Nothing to compress

    const toCompress = transcript.slice(startIdx, endIdx);
    if (toCompress.length < 4) return; // Not enough to bother

    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [], debateGenerating: 'system' as SpeakerId });

    const model = getConfiguredModel();
    const entriesText = toCompress.map((e) => {
      const label = e.speaker === 'user' ? 'Moderator'
        : e.speaker === 'system' ? 'System'
        : POVER_INFO[e.speaker as Exclude<SpeakerId, 'user'>]?.label || e.speaker;
      return `${label} [${e.type}]: ${e.content}`;
    }).join('\n\n');

    const prompt = buildContextCompressionPrompt(entriesText, activeDebate.audience);

    try {
      const { text } = await generateTextWithProgress(prompt, model, `Compressing debate history (${model})`, set);
      if (!isStillValid()) return;

      let summary: string;
      const compParsed = parseAIJson<{ summary?: string }>(text);
      summary = compParsed?.summary || text.trim();

      const lastCompressedEntry = toCompress[toCompress.length - 1];
      const updatedSummaries = [
        ...activeDebate.context_summaries,
        { up_to_entry_id: lastCompressedEntry.id, summary },
      ];

      set({
        activeDebate: {
          ...get().activeDebate!,
          context_summaries: updatedSummaries,
          updated_at: nowISO(),
        },
      });

      await saveDebate('compressOldTranscript');
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'error',
        message: 'Context compression failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      set({ debateError: `Context compression failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
    }
  },

  generateNewsReport: async () => {
    const { activeDebate } = get();
    if (!activeDebate) return;
    const hasSynthesis = activeDebate.transcript.some(e => e.type === 'synthesis' || e.type === 'concluding');
    if (!hasSynthesis) {
      set({ newsReportError: 'A synthesis must exist before generating a news report.' });
      return;
    }
    set({ newsReportLoading: true, newsReportError: null, newsReport: null });
    try {
      const result = await api.generateNewsReport(activeDebate.id);
      set({ newsReport: result.article, newsReportLoading: false });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'error',
        message: 'News report generation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      set({ newsReportError: `News report generation failed: ${err instanceof Error ? err.message : String(err)}`, newsReportLoading: false });
    }
  },

  requestReflections: async () => {
    const { activeDebate, saveDebate } = get();
    if (!activeDebate) return;

    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [], reflections: [], consensusClusters: [] });

    const model = getConfiguredModel();
    const fullTranscript = formatRecentTranscript(activeDebate.transcript, 50);
    const povers = (activeDebate.active_povers ?? []).filter(p => p !== 'user') as Exclude<SpeakerId, 'user'>[];
    const results: ReflectionResult[] = [];

    for (const pover of povers) {
      if (!isStillValid()) return;
      const info = POVER_INFO[pover];
      if (!info) continue;

      set({ debateGenerating: pover as SpeakerId });

      const taxState = useTaxonomyStore.getState();
      const povKey = info.pov as 'accelerationist' | 'safetyist' | 'skeptic';
      const povFile = taxState[povKey];
      const nodes = (povFile?.nodes ?? []).map(n => ({
        id: n.id,
        category: n.category,
        label: n.label,
        description: n.description,
      }));

      const an = activeDebate.argument_network;
      const anBlock = an
        ? formatArgumentNetworkContext(
            an.nodes.map(n => ({ id: n.id, text: n.text, speaker: POVER_INFO[n.speaker as Exclude<SpeakerId, 'user'>]?.label || n.speaker })),
            an.edges,
          )
        : undefined;

      const speakerClaims = (an?.nodes || []).filter(n => n.speaker === pover);
      const commitBlock = formatCommitments(
        activeDebate.commitments?.[pover] || { asserted: [], conceded: [], challenged: [] },
        speakerClaims,
      );

      const convSignals = activeDebate.convergence_signals;
      const convBlock = convSignals && convSignals.length > 0
        ? convSignals.slice(-5).map(s =>
            `Turn ${s.entry_id} (${POVER_INFO[s.speaker as Exclude<SpeakerId, 'user'>]?.label || s.speaker}): ` +
            `move_polarity=${s.move_polarity?.ratio?.toFixed(2) ?? 'N/A'}, ` +
            `dialectical_engagement=${s.dialectical_engagement?.ratio?.toFixed(2) ?? 'N/A'}, ` +
            `argument_redundancy=${s.argument_redundancy?.max_self_overlap?.toFixed(2) ?? 'N/A'}`
          ).join('\n')
        : undefined;

      // Pass prior reflections so later camps don't duplicate earlier proposals
      const priorReflections = results.map(r => ({
        pov: r.pover,
        edits: r.edits.map(e => ({
          edit_type: e.edit_type,
          proposed_label: e.proposed_label,
          category: e.category,
        })),
      }));

      const prompt = reflectionPrompt(
        info.label,
        info.pov,
        info.personality,
        activeDebate.topic.final,
        nodes,
        fullTranscript,
        anBlock || undefined,
        commitBlock || undefined,
        convBlock,
        activeDebate.audience,
        info.doctrinal_boundaries,
        priorReflections.length > 0 ? priorReflections : undefined,
      );

      try {
        const { text } = await generateTextWithProgress(prompt, model, `${info.label} is reflecting...`, set, 120_000);
        if (!isStillValid()) return;

        const parsed = parseAIJson<{
          reflection_summary?: string;
          edits?: Array<{
            edit_type: string;
            node_id: string | null;
            category: string;
            current_label: string | null;
            proposed_label: string;
            current_description: string | null;
            proposed_description: string;
            rationale: string;
            confidence?: string;
            evidence_entries?: string[];
          }>;
        }>(text);

        const taxState = useTaxonomyStore.getState();
        const edits: ReflectionEdit[] = (parsed?.edits ?? []).map(e => {
          // Ground-truth: override AI-provided current_label/current_description
          // with actual taxonomy values to prevent hallucinated labels.
          let currentLabel = e.current_label;
          let currentDescription = e.current_description;
          if (e.node_id) {
            const realLabel = taxState.getLabelForId(e.node_id);
            const realDesc = taxState.getDescriptionForId(e.node_id);
            if (realLabel && realLabel !== e.node_id) currentLabel = realLabel;
            if (realDesc) currentDescription = realDesc;
          }
          return {
            edit_type: (e.edit_type || 'revise') as ReflectionEdit['edit_type'],
            node_id: e.node_id,
            category: (e.category || 'Beliefs') as ReflectionEdit['category'],
            current_label: currentLabel,
            proposed_label: e.proposed_label || '',
            current_description: currentDescription,
            proposed_description: e.proposed_description || '',
            rationale: e.rationale || '',
            confidence: (['high', 'medium', 'low'].includes(e.confidence || '') ? e.confidence : 'medium') as ReflectionEdit['confidence'],
            evidence_entries: Array.isArray(e.evidence_entries) ? e.evidence_entries : [],
            status: 'pending' as const,
          };
        });

        // DOLCE compliance retry — fix non-compliant descriptions up to 3 times
        for (let ei = 0; ei < edits.length; ei++) {
          const edit = edits[ei];
          const MAX_DOLCE_RETRIES = 3;
          for (let attempt = 1; attempt <= MAX_DOLCE_RETRIES; attempt++) {
            const violations = checkDolceCompliance(edit.proposed_description, edit.node_id || '');
            const errors = violations.filter(v => v.severity === 'error');
            if (errors.length === 0) break;
            if (!isStillValid()) return;

            set({ debateActivity: `${info.label}: fixing DOLCE compliance (attempt ${attempt}/${MAX_DOLCE_RETRIES})…` });
            try {
              const retryPrompt = dolceComplianceRetryPrompt(edit, violations, attempt);
              const { text: retryText } = await api.generateText(retryPrompt, model, 30_000);
              const fixed = parseAIJson<{
                proposed_description?: string;
                proposed_label?: string;
              }>(retryText);
              if (fixed?.proposed_description) {
                edit.proposed_description = fixed.proposed_description;
                if (fixed.proposed_label) edit.proposed_label = fixed.proposed_label;
              }
            } catch (retryErr) {
              getGlobalRecorder()?.record({
                type: 'system.error',
                component: 'debate-store',
                level: 'warn',
                message: `DOLCE compliance retry ${attempt} failed for edit ${ei}`,
                error: { name: (retryErr as Error).name ?? 'Error', message: String(retryErr) },
              });
              console.warn(`[debate] DOLCE retry ${attempt} failed for edit ${ei}:`, retryErr);
              break;
            }
          }
        }

        results.push({
          pover: povKey,
          label: info.label,
          reflection_summary: parsed?.reflection_summary || '',
          edits,
        });

        set({ reflections: [...results] });
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'debate-store',
          level: 'error',
          message: `Reflection generation failed for ${info.label}`,
          error: { name: (err as Error).name ?? 'Error', message: String(err) },
        });
        results.push({
          pover: povKey,
          label: info.label,
          reflection_summary: `Error: ${mapErrorToUserMessage(err)}`,
          edits: [],
        });
        set({ reflections: [...results] });
      }
    }

    // ── Consensus detection: find overlapping ADD proposals across POVs ──
    const addProposals: ConsensusProposal[] = [];
    for (const result of results) {
      for (let i = 0; i < result.edits.length; i++) {
        const edit = result.edits[i];
        if (edit.edit_type === 'add') {
          addProposals.push({
            pov: result.pover,
            editIndex: i,
            proposed_label: edit.proposed_label,
            proposed_description: edit.proposed_description,
            rationale: edit.rationale,
            evidence_entries: edit.evidence_entries,
          });
        }
      }
    }

    const clusters: ConsensusCluster[] = [];
    if (addProposals.length >= 2) {
      try {
        // Compute embeddings for all ADD proposals
        const embeddings: { pov: string; editIndex: number; vector: number[] }[] = [];
        for (const p of addProposals) {
          const { vector } = await api.computeQueryEmbedding(p.proposed_description.slice(0, 500));
          embeddings.push({ pov: p.pov, editIndex: p.editIndex, vector });
        }

        // Pairwise similarity (only across different POVs)
        const pairs: { a: number; b: number; sim: number }[] = [];
        for (let i = 0; i < embeddings.length; i++) {
          for (let j = i + 1; j < embeddings.length; j++) {
            if (embeddings[i].pov === embeddings[j].pov) continue;
            const sim = cosineSimilarity(embeddings[i].vector, embeddings[j].vector);
            if (sim > 0.70) pairs.push({ a: i, b: j, sim });
          }
        }

        // Cluster overlapping pairs using union-find
        if (pairs.length > 0) {
          const parent = new Map<number, number>();
          const find = (x: number): number => {
            if (!parent.has(x)) parent.set(x, x);
            if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
            return parent.get(x)!;
          };
          const union = (a: number, b: number) => { parent.set(find(a), find(b)); };

          for (const { a, b } of pairs) { union(a, b); }

          // Group by root
          const groups = new Map<number, number[]>();
          for (const idx of new Set([...pairs.map(p => p.a), ...pairs.map(p => p.b)])) {
            const root = find(idx);
            if (!groups.has(root)) groups.set(root, []);
            groups.get(root)!.push(idx);
          }

          for (const members of groups.values()) {
            // Only create cluster if at least 2 different POVs
            const povSet = new Set(members.map(m => embeddings[m].pov));
            if (povSet.size < 2) continue;

            const clusterProposals = members.map(m => addProposals[m]);
            const scores: Record<string, number> = {};
            for (const { a, b, sim } of pairs) {
              if (members.includes(a) && members.includes(b)) {
                const key = [embeddings[a].pov.slice(0, 3), embeddings[b].pov.slice(0, 3)].sort().join('-');
                scores[key] = Math.max(scores[key] || 0, sim);
              }
            }

            clusters.push({
              id: generateId(),
              proposals: clusterProposals,
              similarityScores: scores,
              status: 'pending',
            });
          }
        }
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'debate-store',
          level: 'warn',
          message: 'Consensus detection failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err) },
        });
        console.warn('[reflections] Consensus detection failed (non-fatal):', err);
      }
    }

    if (clusters.length > 0) {
      set({ consensusClusters: clusters });
    }

    // Add a transcript entry for the reflection
    const summaryLines = results.map(r =>
      `**${r.label}:** ${r.reflection_summary} (${r.edits.length} edit${r.edits.length !== 1 ? 's' : ''} proposed)`
    );
    if (clusters.length > 0) {
      summaryLines.push(`\n**Consensus detected:** ${clusters.length} convergence cluster${clusters.length !== 1 ? 's' : ''} found across POV proposals.`);
    }
    const reflEntry: TranscriptEntry = {
      id: generateId(),
      speaker: 'system',
      type: 'reflection',
      content: `## Reflections\n\n${summaryLines.join('\n\n')}`,
      timestamp: nowISO(),
      taxonomy_refs: [],
      metadata: { reflection_results: results, consensus_clusters: clusters.length > 0 ? clusters : undefined },
    };
    set({
      debateGenerating: null,
      activeDebate: {
        ...get().activeDebate!,
        transcript: [...get().activeDebate!.transcript, reflEntry],
        updated_at: nowISO(),
      },
    });
    await saveDebate('requestReflections');
  },

  applyReflectionEdit: async (pover: string, editIndex: number, overrides?: { label?: string; description?: string }) => {
    const startTime = performance.now();
    const { reflections } = get();
    const reflection = reflections.find(r => r.pover === pover);
    const edit = reflection?.edits[editIndex];
    getGlobalRecorder()?.record({ type: 'state.change', component: 'reflection-edit', level: 'info', message: 'applyReflectionEdit.called', data: { pover, editIndex, edit_type: edit?.edit_type, node_id: edit?.node_id, hasOverrides: !!overrides } });
    if (!reflection || !edit) { getGlobalRecorder()?.record({ type: 'state.error', component: 'reflection-edit', level: 'warn', message: 'applyReflectionEdit.result', data: { ok: false, error: 'Edit not found', pover, editIndex } }); return { ok: false, error: 'Edit not found' }; }

    const finalLabel = overrides?.label ?? edit.proposed_label;
    const finalDescription = overrides?.description ?? edit.proposed_description;
    const taxStore = useTaxonomyStore.getState();
    const povKey = pover as 'accelerationist' | 'safetyist' | 'skeptic';

    let createdNodeId: string | null = null;
    if (edit.edit_type === 'add') {
      const newId = taxStore.createPovNode(povKey, edit.category);
      createdNodeId = newId;
      if (newId) {
        const debateId = get().activeDebateId;
        taxStore.updatePovNode(povKey, newId, {
          label: finalLabel,
          description: finalDescription,
          graph_attributes: defaultGraphAttributes(povKey, edit.category),
          debate_refs: debateId ? [debateId] : [],
        });
        // Provisional weight assignment (t/148) — new nodes get an initial weight immediately
        const createdNode = useTaxonomyStore.getState()[povKey]?.nodes.find(n => n.id === newId);
        if (createdNode) {
          const today = new Date().toISOString().slice(0, 10);
          if (edit.category === 'Beliefs') {
            const confidence = computeBeliefConfidence({
              epistemic_type: createdNode.graph_attributes?.epistemic_type,
              falsifiability: createdNode.graph_attributes?.falsifiability,
              source_doc_count: 0,
              debate_ref_count: createdNode.debate_refs?.length ?? 0,
              supports_received: 0,
              attacks_received: 0,
            });
            taxStore.updatePovNode(povKey, newId, {
              confidence,
              confidence_history: [{ date: today, value: confidence, delta: 0, reason: 'provisional — reflection' }],
            });
          } else if (edit.category === 'Desires') {
            const priority = computeTreePriority(createdNode);
            taxStore.updatePovNode(povKey, newId, {
              priority,
              priority_history: [{ date: today, value: priority, delta: 0, reason: 'provisional — reflection' }],
            });
          } else if (edit.category === 'Intentions') {
            const operationality = computeOperationality(createdNode);
            taxStore.updatePovNode(povKey, newId, {
              operationality,
              operationality_history: [{ date: today, value: operationality, delta: 0, reason: 'provisional — reflection' }],
            });
          }
        }
      }
    } else if (edit.node_id) {
      if (edit.edit_type === 'deprecate') {
        const deprecatedDesc = finalDescription || `[DEPRECATED] ${edit.current_description || ''}`;
        taxStore.updatePovNode(povKey, edit.node_id, {
          label: finalLabel || edit.current_label || '',
          description: deprecatedDesc,
        });
      } else {
        taxStore.updatePovNode(povKey, edit.node_id, {
          label: finalLabel || edit.current_label || '',
          description: finalDescription,
        });
      }
    }

    await taxStore.save();

    // Only mark as approved if save succeeded — include specific validation errors
    const { saveError, validationErrors } = useTaxonomyStore.getState();
    const duration = Math.round(performance.now() - startTime);
    if (saveError) {
      const errorDetails = Object.entries(validationErrors ?? {});
      const detailedError = errorDetails.length > 0
        ? `${saveError}\n${errorDetails.map(([field, msg]) => `• ${field}: ${msg}`).join('\n')}`
        : saveError;
      getGlobalRecorder()?.record({ type: 'state.error', component: 'reflection-edit', level: 'error', message: 'applyReflectionEdit.result', data: { ok: false, error: saveError, validationErrors, pover, editIndex, duration_ms: duration } });
      return { ok: false, error: detailedError };
    }

    // Fire-and-forget: enrich new nodes with AI-generated graph attributes
    if (createdNodeId) {
      void (async () => {
        try {
          const { reflectionNodeEnrichmentPrompt } = await import('../prompts/analysis');
          const enrichPrompt = reflectionNodeEnrichmentPrompt({
            id: createdNodeId!,
            label: finalLabel,
            description: finalDescription,
            category: edit.category,
            pov: povKey,
          });
          const enrichModel = getConfiguredModel();
          const { text } = await api.generateText(enrichPrompt, enrichModel, 15000);
          const enriched = JSON.parse(stripCodeFences(text));
          const currentTaxStore = useTaxonomyStore.getState();
          const currentNode = currentTaxStore[povKey]?.nodes.find(n => n.id === createdNodeId);
          if (!currentNode) return;
          const mergedAttrs: GraphAttributes = {
            ...currentNode.graph_attributes,
            ...(enriched.epistemic_type && { epistemic_type: enriched.epistemic_type }),
            ...(enriched.rhetorical_strategy && { rhetorical_strategy: enriched.rhetorical_strategy }),
            ...(enriched.assumes?.length > 0 && { assumes: enriched.assumes }),
            ...(enriched.falsifiability && { falsifiability: enriched.falsifiability }),
            ...(enriched.audience && { audience: enriched.audience }),
            ...(enriched.emotional_register && { emotional_register: enriched.emotional_register }),
            ...(enriched.intellectual_lineage?.length > 0 && { intellectual_lineage: enriched.intellectual_lineage }),
            ...(enriched.steelman_vulnerability && { steelman_vulnerability: enriched.steelman_vulnerability }),
            ...(enriched.node_scope && { node_scope: enriched.node_scope }),
          };
          currentTaxStore.updatePovNode(povKey, createdNodeId!, { graph_attributes: mergedAttrs });
          await currentTaxStore.save();
          getGlobalRecorder()?.record({ type: 'state.change', component: 'reflection-edit', level: 'info', message: 'reflectionEnrichment.complete', data: { node_id: createdNodeId, fields: Object.keys(enriched) } });
        } catch (err) {
          getGlobalRecorder()?.record({ type: 'state.error', component: 'reflection-edit', level: 'warn', message: 'reflectionEnrichment.failed', data: { node_id: createdNodeId, error: String(err) } });
        }
      })();
    }

    getGlobalRecorder()?.record({ type: 'state.change', component: 'reflection-edit', level: 'info', message: 'applyReflectionEdit.result', data: { ok: true, pover, editIndex, edit_type: edit.edit_type, node_id: edit.node_id, duration_ms: duration } });
    const updated = reflections.map(r => {
      if (r.pover !== pover) return r;
      return {
        ...r,
        edits: r.edits.map((e, i) => i === editIndex ? { ...e, status: 'approved' as const } : e),
      };
    });
    set({ reflections: updated });
    return { ok: true };
  },

  dismissReflectionEdit: (pover: string, editIndex: number) => {
    const { reflections } = get();
    const updated = reflections.map(r => {
      if (r.pover !== pover) return r;
      return {
        ...r,
        edits: r.edits.map((e, i) => i === editIndex ? { ...e, status: 'dismissed' as const } : e),
      };
    });
    set({ reflections: updated });
  },

  acceptConsensus: async (clusterId: string) => {
    const { consensusClusters, activeDebateId } = get();
    const cluster = consensusClusters.find(c => c.id === clusterId);
    if (!cluster || cluster.status !== 'pending') return { ok: false, error: 'Cluster not found or already resolved' };

    try {
      // Build proposals for the prompt
      const { consensusSituationPrompt } = await import('@lib/debate/prompts');
      type CP = import('@lib/debate/prompts').ConvergenceProposal;
      const promptProposals: CP[] = cluster.proposals.map(p => ({
        pov: p.pov,
        proposed_label: p.proposed_label,
        proposed_description: p.proposed_description,
        rationale: p.rationale,
        evidence_entries: p.evidence_entries,
      }));

      const prompt = consensusSituationPrompt(promptProposals, cluster.similarityScores, activeDebateId || '');
      const model = getConfiguredModel();
      const { text } = await api.generateText(prompt, model);

      // Parse the situation node response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { ok: false, error: 'Failed to parse situation node response' };
      const parsed = JSON.parse(jsonMatch[0]) as {
        label: string;
        description: string;
        interpretations: Record<string, string>;
        convergence_type: 'full' | 'partial' | 'conditional';
      };

      // Create the situation node
      const taxStore = useTaxonomyStore.getState();
      const newId = taxStore.createSituationNode();
      if (!newId) return { ok: false, error: 'Failed to create situation node' };

      taxStore.updateSituationNode(newId, {
        label: parsed.label,
        description: parsed.description,
        interpretations: {
          accelerationist: parsed.interpretations.accelerationist || '',
          safetyist: parsed.interpretations.safetyist || '',
          skeptic: parsed.interpretations.skeptic || '',
        },
        debate_refs: activeDebateId ? [activeDebateId] : [],
        convergence_source: {
          debate_id: activeDebateId || '',
          convergence_type: parsed.convergence_type || 'partial',
          original_proposals: Object.fromEntries(
            cluster.proposals.map(p => [p.pov, { proposed_label: p.proposed_label, evidence_entries: p.evidence_entries }])
          ),
          similarity_scores: cluster.similarityScores,
        },
      });

      // Create CONVERGES_WITH edges from each converging POV to the situation node
      const currentEdgesFile = useTaxonomyStore.getState().edgesFile;
      if (currentEdgesFile) {
        const convergenceEdges = cluster.proposals.map(p => ({
          source: `${p.pov.slice(0, 3)}-convergence`, // symbolic source — links POV to situation
          target: newId,
          type: 'CONVERGES_WITH' as const,
          bidirectional: false,
          confidence: 0.8,
          weight: 0.8,
          rationale: `Consensus detected via embedding similarity (debate: ${activeDebateId})`,
          status: 'proposed' as const,
          discovered_at: nowISO(),
          model: 'consensus-detection',
        }));
        const updatedEdgesFile = {
          ...currentEdgesFile,
          last_modified: nowISO(),
          edges: [...currentEdgesFile.edges, ...convergenceEdges],
        };
        const dirty = new Set(useTaxonomyStore.getState().dirty);
        dirty.add('edges');
        useTaxonomyStore.setState({ edgesFile: updatedEdgesFile, dirty });
      }

      await taxStore.save();
      const saveError = useTaxonomyStore.getState().saveError;
      if (saveError) return { ok: false, error: saveError };

      // Mark cluster as accepted and dismiss the individual edits
      const updatedClusters = consensusClusters.map(c =>
        c.id === clusterId ? { ...c, status: 'accepted' as const } : c
      );
      // Dismiss the per-POV ADD edits that are now covered by the situation node
      const { reflections } = get();
      const updatedReflections = reflections.map(r => {
        const matchingProposal = cluster.proposals.find(p => p.pov === r.pover);
        if (!matchingProposal) return r;
        return {
          ...r,
          edits: r.edits.map((e, i) => i === matchingProposal.editIndex ? { ...e, status: 'dismissed' as const } : e),
        };
      });
      set({ consensusClusters: updatedClusters, reflections: updatedReflections });
      return { ok: true };
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-store',
        level: 'error',
        message: 'Accept consensus failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  rejectConsensus: (clusterId: string) => {
    const { consensusClusters } = get();
    const updated = consensusClusters.map(c =>
      c.id === clusterId ? { ...c, status: 'rejected' as const } : c
    );
    set({ consensusClusters: updated });
  },

  updateAnNodeSubScore: (nodeId: string, key: string, value: number) => {
    const debate = get().activeDebate;
    if (!debate?.argument_network) return;
    const nodes = debate.argument_network.nodes.map(n => {
      if (n.id !== nodeId || !n.bdi_sub_scores) return n;
      const updated = { ...n.bdi_sub_scores, [key]: value };
      const vals = Object.values(updated).filter((v): v is number => v != null);
      const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : n.base_strength;
      return { ...n, bdi_sub_scores: updated, base_strength: avg };
    });
    set({
      activeDebate: {
        ...debate,
        argument_network: { ...debate.argument_network, nodes },
      },
    });
  },
}));

// Expose store for flight recorder context provider (avoids circular import)
((window as unknown as { __ZUSTAND_STORES__?: Record<string, unknown> }).__ZUSTAND_STORES__ ??= {} as Record<string, unknown>).debate = useDebateStore;

/** Helper to get node label for fact check (standalone, no React hooks) */
function getNodeLabelForFactCheck(nodeId: string): string {
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

// ── State-clobber detection (t/194) ─────────────────────────────────
// Zustand subscriber that fires after every set(). Detects phase regressions
// and transcript shrinkage — both are always bugs caused by stale-state clobbers.
const PHASE_ORDER: Record<string, number> = { setup: 0, clarification: 1, 'edit-claims': 2, opening: 3, debate: 4, closed: 5 };

useDebateStore.subscribe((state, prev) => {
  const curr = state.activeDebate;
  const old = prev.activeDebate;
  if (!curr || !old || curr.id !== old.id) return;

  // Phase regression detection
  const currPhaseIdx = PHASE_ORDER[curr.phase] ?? -1;
  const oldPhaseIdx = PHASE_ORDER[old.phase] ?? -1;
  if (currPhaseIdx >= 0 && oldPhaseIdx >= 0 && currPhaseIdx < oldPhaseIdx) {
    console.error(`[STATE-GUARD] Phase regression: ${old.phase} → ${curr.phase}`);
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'state-guard', level: 'error',
      debate_id: curr.id,
      message: `Phase regression detected: ${old.phase} → ${curr.phase}`,
      data: { from: old.phase, to: curr.phase, from_idx: oldPhaseIdx, to_idx: currPhaseIdx, transcript_before: old.transcript.length, transcript_after: curr.transcript.length },
    });
  }

  // Transcript shrinkage detection
  if (curr.transcript.length < old.transcript.length) {
    console.error(`[STATE-GUARD] Transcript shrinkage: ${old.transcript.length} → ${curr.transcript.length}`);
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'state-guard', level: 'error',
      debate_id: curr.id,
      message: `Transcript shrinkage: ${old.transcript.length} → ${curr.transcript.length}`,
      data: { before: old.transcript.length, after: curr.transcript.length, phase: curr.phase },
    });
  }
});
