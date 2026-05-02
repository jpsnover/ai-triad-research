// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import type {
  DebateSession,
  DebateSessionSummary,
  DebateSourceType,
  DebateAudience,
  PoverId,
  TranscriptEntry,
  TaxonomyRef,
} from '../types/debate';
import { POVER_INFO, AI_POVERS, POV_KEYS } from '../types/debate';
import type { PovNode, CrossCuttingNode as SituationNode, GraphAttributes, Category, Pov } from '../types/taxonomy';
import { useTaxonomyStore } from './useTaxonomyStore';

declare const __APP_VERSION__: string;
import { mapErrorToUserMessage } from '../utils/errorMessages';
import { formatTaxonomyContext } from '../utils/taxonomyContext';
import type { TaxonomyContext } from '../utils/taxonomyContext';
import { extractClaimsPrompt, classifyClaimsPrompt, formatArgumentNetworkContext, formatCommitments, formatEstablishedPoints, updateUnansweredLedger, formatConcessionCandidatesHint, processExtractedClaims } from '../prompts/argumentNetwork';
import type { ArgumentNetworkNode, ArgumentNetworkEdge, CommitmentStore, EntryDiagnostics, DebateDiagnostics, DocumentAnalysis, ClaimExtractionTrace, ExtractionSummary, GapArgument, GapInjection, CrossCuttingProposal, TaxonomyGapAnalysis } from '../types/debate';
import { cosineSimilarity, scoreNodeRelevance, selectRelevantNodes, selectRelevantSituationNodes, buildRelevanceQuery } from '../utils/taxonomyRelevance';
import { trace, newCallId, TraceEventName } from '../lib/trace';
import { documentAnalysisPrompt, buildTaxonomySample, documentAnalysisContext } from '@lib/debate/documentAnalysis';
import { updateConvergenceTracker } from '../utils/convergenceScoring';
import {
  clarificationPrompt,
  situationClarificationPrompt,
  documentClarificationPrompt,
  formatSituationDebateContext,
  synthesisPrompt,
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
  midDebateGapPrompt,
  crossCuttingNodePrompt,
} from '../prompts/debate';
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
import { runTurnPipeline, assemblePipelineResult, runOpeningPipeline, assembleOpeningPipelineResult } from '@lib/debate/turnPipeline';
import type { OpeningPipelineInput } from '@lib/debate/turnPipeline';
import type { TurnPipelineInput } from '@lib/debate/turnPipeline';
import type { TurnAttempt, TurnValidation, TurnValidationTrail, TaxonomySuggestion } from '../types/debate';
import { formatVocabularyContext } from '@lib/debate/vocabularyContext';
import type { StandardizedTerm, ColloquialTerm } from '@lib/dictionary/types';
import { usePromptConfigStore } from './usePromptConfigStore';
import { api } from '@bridge';

/** Read the model for the current debate context.
 *  Priority: debate-specific override > global Settings model > default */
function getConfiguredModel(): string {
  // Check debate-specific model first
  const debateModel = useDebateStore.getState().debateModel;
  if (debateModel) {
    console.log(`[model] Using debate-specific model: ${debateModel}`);
    return debateModel;
  }
  try {
    const globalModel = localStorage.getItem('taxonomy-editor-gemini-model') || 'gemini-3.1-flash-lite-preview';
    console.log(`[model] Using global model: ${globalModel}`);
    return globalModel;
  } catch {
    return 'gemini-3.1-flash-lite-preview';
  }
}

/** Call generateText with progress tracking — subscribes to onGenerateTextProgress */
async function generateTextWithProgress(
  prompt: string,
  model: string,
  activity: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: (partial: any) => void,
  timeoutMs?: number,
): Promise<{ text: string }> {
  set({ debateActivity: activity, debateProgress: null });
  const unsubscribe = api.onGenerateTextProgress((progress: Record<string, unknown>) => {
    set({ debateProgress: progress });
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
      console.warn(`[debate] summarizeEntry failed (attempt ${attempt + 1}/${MAX_RETRIES}):`, err);
    }
  }
  console.warn(`[debate] summarizeEntry: all ${MAX_RETRIES} attempts failed for entry ${entryId}. Detail level pills will be unavailable for this entry.`);
  try {
    const s = useDebateStore.getState();
    if (s.debateWarnings.length < 50) {
      useDebateStore.setState({ debateWarnings: [...s.debateWarnings, 'Entry summarization failed — detail level pills unavailable'] });
    }
  } catch { /* store may not be ready */ }
}

/**
 * Guard against race conditions in async debate operations.
 * Captures the active debate ID at call time; returns a checker that
 * verifies the debate hasn't changed during an await.
 */
function createDebateGuard(get: () => { activeDebateId: string | null }): () => boolean {
  const capturedId = get().activeDebateId;
  return () => {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: () => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: () => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  try { api.sendDiagnosticsState({ debate: updatedDebate, selectedEntry: get().selectedDiagEntry }); } catch { /* ignore */ }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: () => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  };

  set({ activeDebate: { ...debate, extraction_summary: summary } });
}

// ── AN commit instrumentation ─────────────────────────────
//
// Per-turn AN extractions run fire-and-forget, so two commits can race.
// `commitAnNodes` centralises the atomic mint-then-set pattern, asserts
// no ID collisions, and logs before/after state so any clobber is visible.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: () => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: (partial: any) => void,
  label: string,
  newNodes: N[],
  newEdges: E[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
async function extractClaimsAndUpdateAN(
  statement: string,
  speaker: PoverId,
  entryId: string,
  taxonomyRefs: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: () => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: (partial: any) => void,
  debaterClaims?: { claim: string; targets: string[] }[],
): Promise<void> {
  const debate = get().activeDebate as DebateSession | null;
  if (!debate) return;

  const model = getConfiguredModel();
  const an = debate.argument_network || { nodes: [], edges: [] };
  const priorClaims = an.nodes.map(n => ({ id: n.id, text: n.text, speaker: POVER_INFO[n.speaker as Exclude<PoverId, 'user'>]?.label || n.speaker }));
  const speakerLabel = POVER_INFO[speaker as Exclude<PoverId, 'user'>]?.label || speaker;

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

    speakerCommits.asserted.push(...claimsResult.commitments.asserted);
    speakerCommits.conceded.push(...claimsResult.commitments.conceded);
    speakerCommits.challenged.push(...claimsResult.commitments.challenged);

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

    await get().saveDebate();
    checkAnInvariants(`post-save(extract,${entryId.slice(-6)})`, get, expectedMinAnCount);

    console.log(`[AN] Extracted ${newNodes.length} claims, ${newEdges.length} edges from ${speakerLabel}'s turn`);
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
          } catch {
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
          );
          patches.convergence_signals = [...(baseDebate.convergence_signals ?? []), sig];
        } catch (convErr) {
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
            const targetLabel = POVER_INFO[targetPover as Exclude<PoverId, 'user'>]?.label ?? targetPover;
            const speakerLbl = POVER_INFO[speaker as Exclude<PoverId, 'user'>]?.label ?? speaker;
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
                scoring_method: 'ai_rubric',
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
        console.warn(`[Verify] Inline verification failed for ${pNode.id} (non-blocking):`, verifyErr);
        pushWarning(get, set, 'Claim verification skipped');
        pNode.verification_status = 'pending';
      }
    }
    if (factCheckMutated) {
      try { await get().saveDebate(); } catch (saveErr) {
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
    try { api.sendDiagnosticsState({ debate: get().activeDebate, selectedEntry: get().selectedDiagEntry }); } catch { /* ignore */ }
  } catch (err) {
    console.warn('[AN] Claim extraction failed (non-blocking):', err);
    pushWarning(get, set, 'Argument extraction skipped this turn');
    if (!extractionTrace.error_message) extractionTrace.error_message = String(err);
    if (extractionTrace.status === 'ok') extractionTrace.status = 'adapter_error';
    try { commitTrace(); } catch { /* ignore */ }
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

// ── Stage generate factory (shared by opening + cross-respond) ──

function makeStageGenerate(
  set: (partial: Record<string, unknown>) => void,
  model: string,
): (prompt: string, _model: string, options: { temperature?: number; timeoutMs?: number }, label: string) => Promise<string> {
  return async (prompt, _model, options, label) => {
    set({ debateActivity: label, debateProgress: null });
    const unsubscribe = api.onGenerateTextProgress((progress: Record<string, unknown>) => {
      set({ debateProgress: progress as { attempt: number; maxRetries: number; backoffSeconds?: number; limitType?: string; limitMessage?: string } });
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

/**
 * Get taxonomy context filtered by relevance to the debate topic.
 * Falls back to unfiltered if embeddings unavailable.
 */
async function getRelevantTaxonomyContext(
  pov: string,
  topic: string,
  recentTranscript: string,
  threshold: number = 0.45,
): Promise<TaxonomyContext> {
  const state = useTaxonomyStore.getState();
  const povFile = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
  const allPovNodes: PovNode[] = povFile?.nodes ?? [];
  const allCCNodes: SituationNode[] = state.situations?.nodes ?? [];

  try {
    // Build query from debate context
    const query = buildRelevanceQuery(topic, recentTranscript);

    // Get query embedding
    const { vector: queryVector } = await api.computeQueryEmbedding(query);

    // Get embeddings for all POV nodes
    const nodeTexts = allPovNodes.map(n => `${n.label}: ${n.description}`);
    const nodeIds = allPovNodes.map(n => n.id);
    const { vectors } = await api.computeEmbeddings(nodeTexts, nodeIds);

    // Build scores map
    const scores = new Map<string, number>();
    for (let i = 0; i < nodeIds.length; i++) {
      const dot = queryVector.reduce((s, v, j) => s + v * vectors[i][j], 0);
      const normQ = Math.sqrt(queryVector.reduce((s, v) => s + v * v, 0));
      const normN = Math.sqrt(vectors[i].reduce((s, v) => s + v * v, 0));
      scores.set(nodeIds[i], normQ > 0 && normN > 0 ? dot / (normQ * normN) : 0);
    }

    // Also score CC nodes
    const ccTexts = allCCNodes.map(n => `${n.label}: ${n.description}`);
    const ccIds = allCCNodes.map(n => n.id);
    if (ccTexts.length > 0) {
      const { vectors: ccVectors } = await api.computeEmbeddings(ccTexts, ccIds);
      for (let i = 0; i < ccIds.length; i++) {
        const dot = queryVector.reduce((s, v, j) => s + v * ccVectors[i][j], 0);
        const normQ = Math.sqrt(queryVector.reduce((s, v) => s + v * v, 0));
        const normN = Math.sqrt(ccVectors[i].reduce((s, v) => s + v * v, 0));
        scores.set(ccIds[i], normQ > 0 && normN > 0 ? dot / (normQ * normN) : 0);
      }
    }

    const scoredPov = selectRelevantNodes(allPovNodes, scores, threshold, 3, 35);
    const scoredCC = selectRelevantSituationNodes(allCCNodes, scores, threshold, 3, 15);

    // Unwrap ScoredPovNode → PovNode and build nodeScores map
    const filteredPov = scoredPov.map(s => s.node);
    const filteredCC = scoredCC.map(s => s.node);
    const nodeScores = new Map<string, number>();
    for (const s of scoredPov) nodeScores.set(s.node.id, s.score);
    for (const s of scoredCC) nodeScores.set(s.node.id, s.score);

    console.log(`[taxonomy] Relevance-filtered: ${filteredPov.length} POV nodes (from ${allPovNodes.length}), ${filteredCC.length} CC nodes (from ${allCCNodes.length})`);

    const policyRegistry = (state.policyRegistry ?? []).map(p => ({ id: p.id, action: p.action, source_povs: p.source_povs }));
    return { povNodes: filteredPov, situationNodes: filteredCC, policyRegistry, nodeScores };
  } catch (err) {
    console.warn('[taxonomy] Relevance scoring failed, using unfiltered:', err);
    // Surface warning via store — useDebateStore is defined below but accessible at call time
    try {
      const s = useDebateStore.getState();
      if (s.debateWarnings.length < 50) {
        useDebateStore.setState({ debateWarnings: [...s.debateWarnings, 'Taxonomy relevance scoring unavailable'] });
      }
    } catch { /* store may not be ready during init */ }
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
    lines.push(`${e.source} ${e.type} ${e.target} (confidence: ${e.confidence.toFixed(2)})`);
  }
  return lines.join('\n');
}

// ── Prompt builders (delegate to prompts/debate.ts) ──────

function buildClarificationPrompt(topic: string, sourceContent?: string, audience?: DebateAudience): string {
  return clarificationPrompt(topic, sourceContent, audience);
}

function buildSynthesisPrompt(
  originalTopic: string,
  clarifications: { speaker: string; questions: string[]; answers: string }[],
  audience?: DebateAudience,
): string {
  let qaPairs = '';
  for (const c of clarifications) {
    qaPairs += `\n${c.speaker} asked:\n`;
    for (const q of c.questions) qaPairs += `  - ${q}\n`;
    qaPairs += `User answered: ${c.answers}\n`;
  }
  return synthesisPrompt(originalTopic, qaPairs, audience);
}


function buildDebateResponsePrompt(
  poverId: Exclude<PoverId, 'user'>,
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
  poverId: Exclude<PoverId, 'user'>,
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
  return crossRespondPrompt(info.label, info.pov, info.personality, topic, taxonomyContext, recentTranscript, focusPoint, addressing, length, sourceContent, docAnalysis);
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

// ── Store interface ──────────────────────────────────────

interface DebateStore {
  // Session list
  sessions: DebateSessionSummary[];
  sessionsLoading: boolean;

  // Active debate
  activeDebateId: string | null;
  activeDebate: DebateSession | null;
  debateLoading: boolean;
  debateGenerating: PoverId | null;
  debateError: string | null;
  responseLength: 'brief' | 'medium' | 'detailed';
  setResponseLength: (length: 'brief' | 'medium' | 'detailed') => void;
  audience: DebateAudience;
  setAudience: (audience: DebateAudience) => void;
  /** Set display tier for a specific transcript entry (DT-3). */
  setEntryDisplayTier: (entryId: string, tier: 'brief' | 'medium' | 'detailed') => void;
  debateProgress: { attempt: number; maxRetries: number; backoffSeconds?: number; limitType?: string; limitMessage?: string } | null;
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
  selectDiagEntry: (entryId: string | null) => void;
  setDiagPopoutOpen: (open: boolean) => void;
  inspectNode: (nodeId: string | null) => void;
  loadSessions: () => Promise<void>;
  createDebate: (topic: string, povers: PoverId[], userIsPover: boolean, sourceType?: DebateSourceType, sourceRef?: string, sourceContent?: string, debateModel?: string, protocolId?: string, debateTemperature?: number, debateAudience?: DebateAudience, options?: { evaluatorModel?: string; pacing?: string; useAdaptiveStaging?: boolean }) => Promise<string>;
  createSituationDebate: (ccNodeId: string) => Promise<string>;
  loadDebate: (id: string) => Promise<void>;
  deleteDebate: (id: string) => Promise<void>;
  renameDebate: (id: string, newTitle: string) => Promise<void>;
  closeDebate: () => void;
  addTranscriptEntry: (entry: Omit<TranscriptEntry, 'id' | 'timestamp'>) => string;
  deleteTranscriptEntries: (entryIds: string[]) => Promise<void>;
  togglePover: (poverId: PoverId) => Promise<void>;
  updatePhase: (phase: DebateSession['phase']) => void;
  updateTopic: (topic: Partial<DebateSession['topic']>) => void;
  saveDebate: () => Promise<void>;
  setGenerating: (pover: PoverId | null) => void;
  setError: (error: string | null) => void;

  // Phase 2: Clarification
  runClarification: () => Promise<void>;
  submitAnswersAndSynthesize: (answers: string) => Promise<void>;
  beginDebate: () => Promise<void>;

  // Phase 2.5: Edit Claims (document/URL debates only)
  updateClaim: (claimId: string, newText: string) => void;
  deleteClaim: (claimId: string) => void;
  proceedToOpening: () => void;

  // Phase 3: Opening Statements
  openingOrder: Exclude<PoverId, 'user'>[];
  setOpeningOrder: (order: Exclude<PoverId, 'user'>[]) => void;
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
  requestReflections: () => Promise<void>;
  applyReflectionEdit: (pover: string, editIndex: number) => void;
  dismissReflectionEdit: (pover: string, editIndex: number) => void;

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
  setResponseLength: (length) => set({ responseLength: length }),
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
  inspectedNodeId: null,
  debateModel: null,
  debateTemperature: null,
  vocabularyTerms: null,
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
      api.openDiagnosticsWindow().then(() => {
        set({ diagPopoutOpen: true });
        setTimeout(() => {
          api.sendDiagnosticsState({ debate: get().activeDebate, selectedEntry: get().selectedDiagEntry });
        }, 1000);
      }).catch(() => { /* ignore */ });
    } else {
      try { api.closeDiagnosticsWindow?.(); } catch { /* ignore */ }
      set({ diagPopoutOpen: false });
    }
  },

  selectDiagEntry: (entryId) => {
    set({ selectedDiagEntry: entryId });
    // Broadcast to popout diagnostics window
    try {
      const debate = get().activeDebate;
      api.sendDiagnosticsState({ debate, selectedEntry: entryId });
    } catch { /* popout may not exist */ }
  },

  setDiagPopoutOpen: (open) => set({ diagPopoutOpen: open }),

  loadSessions: async () => {
    set({ sessionsLoading: true });
    try {
      const raw = await api.listDebateSessions();
      set({ sessions: raw as DebateSessionSummary[], sessionsLoading: false });
    } catch {
      set({ sessionsLoading: false });
    }
  },

  createDebate: async (topic, povers, userIsPover, sourceType = 'topic', sourceRef = '', sourceContent = '', debateModel, protocolId, debateTemperature, debateAudience, options) => {
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
    };
    await api.saveDebateSession(session);
    set({ activeDebateId: id, activeDebate: session, debateModel: debateModel || null, debateTemperature: debateTemperature ?? null });
    api.setDebateTemperature(debateTemperature ?? null);
    await get().loadSessions();
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
    const allPovers = [...AI_POVERS] as PoverId[];

    const id = await get().createDebate(topic, allPovers, false, 'situations', ccNodeId, sourceContent);
    await get().loadDebate(id);
    get().updatePhase('clarification');
    await get().saveDebate();
    return id;
  },

  loadDebate: async (id) => {
    set({ debateLoading: true, debateError: null, debateWarnings: [] });
    try {
      const raw = await api.loadDebateSession(id);
      const session = raw as DebateSession;
      // BDI migration shim: normalize legacy bdi_layer values in synthesis entries
      for (const entry of session.transcript) {
        if (entry.type === 'synthesis' && entry.metadata?.synthesis) {
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
      set({ activeDebateId: id, activeDebate: session, debateLoading: false, debateModel: session.debate_model || null, debateTemperature: session.debate_temperature ?? null, audience: session.audience ?? 'policymakers' });
      // Load prompt config from session (Phase B)
      usePromptConfigStore.getState().loadSessionConfig(
        (session as Record<string, unknown>).prompt_config as Record<string, number | boolean | string> | undefined
      );
      // Set temperature on the main process
      api.setDebateTemperature(session.debate_temperature ?? null);
    } catch (err) {
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
    } catch (err) {
      set({ debateError: mapErrorToUserMessage(err) });
    }
  },

  renameDebate: async (id, newTitle) => {
    try {
      const raw = await api.loadDebateSession(id);
      const session = raw as DebateSession;
      session.title = newTitle;
      session.updated_at = nowISO();
      await api.saveDebateSession(session);
      // Update active debate if it's the one being renamed
      if (get().activeDebateId === id) {
        set({ activeDebate: session });
      }
      await get().loadSessions();
    } catch (err) {
      set({ debateError: mapErrorToUserMessage(err) });
    }
  },

  closeDebate: () => {
    set({ activeDebateId: null, activeDebate: null, debateError: null, debateWarnings: [], debateGenerating: null, debateModel: null, debateTemperature: null, vocabularyTerms: null });
    api.setDebateTemperature(null);
    usePromptConfigStore.getState().resetSession();
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
    const updated: DebateSession = {
      ...activeDebate,
      updated_at: nowISO(),
      transcript: filtered,
    };
    set({ activeDebate: updated });
    await saveDebate();
  },

  togglePover: async (poverId) => {
    const { activeDebate, saveDebate } = get();
    if (!activeDebate) return;
    const current = activeDebate.active_povers;
    let updated: PoverId[];
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
    await saveDebate();
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

  saveDebate: async () => {
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
    } catch (err) {
      set({ debateError: mapErrorToUserMessage(err) });
    }
  },

  setGenerating: (pover) => set({ debateGenerating: pover }),
  inspectNode: (nodeId) => set({ inspectedNodeId: nodeId }),
  setError: (error) => set({ debateError: error }),

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

    set({ debateGenerating: 'system' as PoverId });
    const prompt = activeDebate.source_type === 'situations'
      ? situationClarificationPrompt(topic, activeDebate.source_content, activeDebate.audience)
      : (activeDebate.source_type === 'document' || activeDebate.source_type === 'url')
        ? documentClarificationPrompt(topic, activeDebate.source_content, activeDebate.audience)
        : buildClarificationPrompt(topic, activeDebate.source_content || undefined, activeDebate.audience);
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
      addTranscriptEntry({
        type: 'system',
        speaker: 'system',
        content: `Failed to generate clarifying questions: ${mapErrorToUserMessage(err)}`,
        taxonomy_refs: [],
      });
    }

    set({ debateGenerating: null });
    get().updatePhase('clarification');
    await saveDebate();
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

    set({ debateError: null, debateWarnings: [], debateGenerating: 'system' as PoverId });

    const clarifications: { speaker: string; questions: string[]; answers: string }[] = [];
    const clarEntries = get().activeDebate!.transcript.filter((e) => e.type === 'clarification');
    for (const entry of clarEntries) {
      const rawQs = entry.metadata?.questions;
      // Handle both old format (string[]) and new format ({question, options}[])
      const qs: string[] = Array.isArray(rawQs)
        ? rawQs.map((q: unknown) => typeof q === 'string' ? q : (q as { question: string }).question ?? String(q))
        : [entry.content];
      clarifications.push({
        speaker: POVER_INFO[entry.speaker as Exclude<PoverId, 'user'>]?.label || entry.speaker,
        questions: qs,
        answers,
      });
    }

    const model = getConfiguredModel();
    const prompt = buildSynthesisPrompt(activeDebate.topic.original, clarifications, activeDebate.audience);

    try {
      const { text } = await generateTextWithProgress(prompt, model, `Synthesizing refined topic (${model})`, set);
      if (!isStillValid()) { set({ debateGenerating: null }); return; }
      let refinedTopic: string;
      const parsed = parseAIJson<{ refined_topic?: string }>(text);
      refinedTopic = parsed?.refined_topic || text.trim();

      get().updateTopic({ refined: refinedTopic, final: refinedTopic });

      addTranscriptEntry({
        type: 'system',
        speaker: 'system',
        content: `Refined topic: "${refinedTopic}"`,
        taxonomy_refs: [],
        metadata: { refined_topic: refinedTopic },
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
        console.warn('[debate] User seed claim extraction failed (non-fatal):', seedErr);
        pushWarning(get, set, 'User position extraction skipped — debaters will not see your stated positions in the graph');
      }

      // Synthesis succeeded — auto-advance to the debate
      set({ debateGenerating: null });
      await saveDebate();
      await get().beginDebate();
      return;
    } catch (err) {
      set({ debateError: `Topic synthesis failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate();
    }

  },

  beginDebate: async () => {
    const { activeDebate, updatePhase, saveDebate, addTranscriptEntry } = get();

    // Document pre-analysis: extract i-nodes, tension points, and claims summary
    // Runs here so it executes whether the user submitted answers or skipped clarification
    if (activeDebate && !activeDebate.document_analysis &&
        (activeDebate.source_type === 'document' || activeDebate.source_type === 'url')) {
      set({ debateGenerating: 'system' as PoverId });
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
          .map(p => POVER_INFO[p as Exclude<PoverId, 'user'>]?.pov)
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
        await saveDebate();
      }
    }

    // Load vocabulary terms for standardized term enforcement
    try {
      const dict = await api.loadDictionary();
      if (dict.standardized.length > 0) {
        set({ vocabularyTerms: { standardized: dict.standardized as StandardizedTerm[], colloquial: dict.colloquial as ColloquialTerm[] } });
      }
    } catch (err) {
      console.warn('[debate] Vocabulary loading failed, debates will use bare terms:', err);
      pushWarning(get, set, 'Vocabulary dictionary unavailable — debates will use bare terms');
    }

    // If document analysis produced claims, let the user review/edit them before opening
    const freshDebate = get().activeDebate;
    if (freshDebate?.document_analysis?.i_nodes?.length) {
      updatePhase('edit-claims');
      await saveDebate();
      return;
    }

    // No claims to edit — proceed directly to opening
    get().proceedToOpening();
    await saveDebate();
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

    const aiPovers = AI_POVER_ORDER.filter((p) => activeDebate.active_povers.includes(p));
    const shuffled = [...aiPovers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    set({ openingOrder: shuffled });

    const claimCount = activeDebate.document_analysis?.i_nodes?.length;
    addTranscriptEntry({
      type: 'system',
      speaker: 'system',
      content: `The debate begins${claimCount ? ` with ${claimCount} source claims` : ''}. Opening statements will follow.`,
      taxonomy_refs: [],
    });

    saveDebate();
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

    // Use the user-configurable opening order (randomized at beginDebate)
    const { openingOrder } = get();
    const aiPovers = openingOrder.length > 0
      ? openingOrder.filter((p) => activeDebate.active_povers.includes(p))
      : AI_POVER_ORDER.filter((p) => activeDebate.active_povers.includes(p));

    // Collect prior statements as we go (sequential — each sees the ones before it)
    const priorStatements: { speaker: string; statement: string }[] = [];

    const stageGenerate = makeStageGenerate(set as (partial: Record<string, unknown>) => void, model);

    for (const poverId of aiPovers) {
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
          id: n.id, text: n.text, speaker: POVER_INFO[n.speaker as Exclude<PoverId, 'user'>]?.label || n.speaker,
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
        };

        const pipelineResult = await runOpeningPipeline(
          pipelineInput,
          stageGenerate,
          (_stage, label) => set({ debateActivity: label }),
        );
        if (!isStillValid()) return;

        const knownNodeIds = getAllKnownNodeIds();
        const { statement, taxonomyRefs, meta } = assembleOpeningPipelineResult(pipelineResult, knownNodeIds);

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
        await saveDebate();

        // Extract claims in background (non-blocking)
        if (lastEntry) {
          extractClaimsAndUpdateAN(statement, poverId, lastEntry.id, taxonomyRefs.map(r => r.node_id), get, set, meta.my_claims);
        }
      } catch (err) {
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
    // Otherwise, transition to debate phase
    if (!activeDebate.user_is_pover) {
      get().updatePhase('debate');
      addTranscriptEntry({
        type: 'system',
        speaker: 'system',
        content: 'Opening statements complete. The floor is open.',
        taxonomy_refs: [],
      });
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
          } catch { /* non-critical */ }
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
    } catch { /* non-critical */ }

    await saveDebate();

    // Auto-run initial cross-respond rounds if configured
    const { initialCrossRespondRounds } = get();
    if (initialCrossRespondRounds > 0 && !activeDebate.user_is_pover) {
      for (let i = 0; i < initialCrossRespondRounds; i++) {
        if (!get().activeDebate) break;
        await get().crossRespond();
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

    await saveDebate();
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
        const label = t === 'user' ? 'You' : POVER_INFO[t as Exclude<PoverId, 'user'>]?.label || t;
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
      await saveDebate();
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
        id: n.id, text: n.text, speaker: POVER_INFO[n.speaker as Exclude<PoverId, 'user'>]?.label || n.speaker,
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

        addTranscriptEntry({
          type: 'statement',
          speaker: poverId,
          content: statement,
          taxonomy_refs: taxonomyRefs,
          policy_refs: meta.policy_refs,
          addressing: 'user',
          metadata: { ...meta },
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
          extractClaimsAndUpdateAN(statement, poverId, lastEntry.id, taxonomyRefs.map(r => r.node_id), get, set, meta.my_claims);
          await summarizeTranscriptEntry(lastEntry.id, statement, info.label, model, get, set);
        }
      } catch (err) {
        addTranscriptEntry({
          type: 'system',
          speaker: 'system',
          content: `${info.label} failed to respond: ${mapErrorToUserMessage(err)}`,
          taxonomy_refs: [],
        });
      }
    }

    set({ debateGenerating: null });
    await saveDebate();
  },

  crossRespond: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

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

    // Step 1: Active moderator — delegate to shared orchestration
    set({ debateGenerating: aiPovers[0] });

    const crossRespondRound = activeDebate.transcript.filter(e => e.type === 'statement').length + 1;
    const totalRoundsForPhase = get().initialCrossRespondRounds || 5;
    const phase = getDebatePhase(crossRespondRound, totalRoundsForPhase * 3);

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
      await saveDebate();
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
    const lastSpeaker = lastSpeakerEntry?.speaker as Exclude<PoverId, 'user'> | undefined;
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
      id: n.id, text: n.text, speaker: POVER_INFO[n.speaker as Exclude<PoverId, 'user'>]?.label || n.speaker,
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

    const crTaxState = useTaxonomyStore.getState();
    const povFile = crTaxState[info.pov as keyof typeof crTaxState] as { nodes?: { id: string }[] } | null;
    const availablePovNodeIds = povFile?.nodes?.map(n => n.id) ?? [];

    // ── 4-stage pipeline: BRIEF → PLAN → DRAFT → CITE ──
    const debaterGapHint = formatGapHint(activeDebate.gap_injections);
    // Build pendingIntervention for the Draft/Cite stages
    const pendingInterventionData = intervention ? (() => {
      const moveConfig = MOVE_RESPONSE_CONFIG[intervention.move as keyof typeof MOVE_RESPONSE_CONFIG];
      const targetLabel = POVER_INFO[intervention.target_debater as Exclude<PoverId, 'user'>]?.label ?? intervention.target_debater;
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
    };

    const stageGenerate = makeStageGenerate(set as (partial: Record<string, unknown>) => void, model);

    try {
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

      const turnResult = await executeTurnWithRetry(retryInput, retryCallbacks);
      if (turnResult.aborted) return;
      const { statement, taxonomyRefs, meta, validation, attempts, pipelineResult } = turnResult;

      addTranscriptEntry({
        type: 'statement',
        speaker: responderPover,
        content: statement,
        taxonomy_refs: taxonomyRefs,
        policy_refs: meta.policy_refs,
        addressing: 'all',
        metadata: {
          cross_respond: true, round: crossRespondRound,
          focus_point: focusPoint, addressing_label: addressingLabel,
          moderator_trace: moderatorTrace, ...meta,
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
        extractClaimsAndUpdateAN(statement, responderPover, lastEntry.id, taxonomyRefs.map(r => r.node_id), get, set, meta.my_claims);
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
                const opLabel = POVER_INFO[driftingToward as Exclude<PoverId, 'user'>]?.label ?? driftingToward;
                addTranscriptEntry({
                  type: 'system', speaker: 'system',
                  content: `[Sycophancy guard] ${info.label} appears to be drifting toward ${opLabel}'s position over the last 3 turns without explicit concession. Self-similarity: ${recent.map(d => d.self_similarity.toFixed(2)).join(' → ')}.`,
                  taxonomy_refs: [],
                });
              }
            }
          }
        } catch { /* non-critical */ }
      }
      // ── Mid-debate gap injection — fires once at the midpoint ──
      try {
        const gapDebate = get().activeDebate;
        if (gapDebate && !gapDebate.gap_injections) {
          const totalRounds = get().initialCrossRespondRounds || 5;
          const gapRound = Math.ceil(totalRounds / 2) + 1;
          const currentRound = gapDebate.transcript.filter(e => e.type === 'statement').length;

          if (currentRound === gapRound) {
            const gapModel = getConfiguredModel();
            const gapTranscript = formatRecentTranscript(gapDebate.transcript, 20, gapDebate.context_summaries);
            // Build taxonomy summary — same pattern as missing arguments pass
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
            );
            const { text: gapText } = await api.generateText(gapPrompt, gapModel, 30_000);
            const gapParsed = parseAIJson<{ gap_arguments: GapArgument[] }>(gapText);
            const gapArgs = gapParsed?.gap_arguments ?? [];

            if (gapArgs.length > 0) {
              const gapContent = gapArgs.map((g, i) =>
                `**Gap ${i + 1} (${g.gap_type}):** ${g.argument}\n*Why missing:* ${g.why_missing}`
              ).join('\n\n');

              const gapEntryId = addTranscriptEntry({
                type: 'system',
                speaker: 'system',
                content: `## Mid-Debate Gap Analysis\n\n${gapContent}`,
                taxonomy_refs: [],
                metadata: { gap_analysis: true, gap_arguments: gapArgs },
              });

              const freshGapDebate = get().activeDebate;
              if (freshGapDebate) {
                set({
                  activeDebate: {
                    ...freshGapDebate,
                    gap_injections: [{
                      round: currentRound,
                      arguments: gapArgs,
                      transcript_entry_id: gapEntryId,
                      responses: [],
                      trigger: 'scheduled',
                    }],
                  },
                  gapInjections: [{
                    round: currentRound,
                    arguments: gapArgs,
                    transcript_entry_id: gapEntryId,
                    responses: [],
                    trigger: 'scheduled',
                  }],
                });
              }

              recordDiagnostic(get, set, gapEntryId, {
                prompt: gapPrompt,
                raw_response: gapText,
                model: gapModel,
              });
            }
          }
        }
      } catch (gapErr) {
        console.warn('[Gap Injection] Mid-debate gap analysis failed (non-blocking):', gapErr);
        pushWarning(get, set, 'Gap analysis skipped this turn');
      }
    } catch (err) {
      addTranscriptEntry({
        type: 'system',
        speaker: 'system',
        content: `${info.label} failed to cross-respond: ${mapErrorToUserMessage(err)}`,
        taxonomy_refs: [],
      });
    }

    const postDebate = get().activeDebate;
    if (postDebate) {
      pruneSessionData(postDebate);
      if (postDebate.moderator_state) pruneModeratorState(postDebate.moderator_state);
      set({ activeDebate: { ...postDebate } });
    }

    set({ debateGenerating: null });
    await saveDebate();
  },

  // ── Phase 5: Synthesis & Probing ──────────────────────────

  requestSynthesis: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    _abortController = new AbortController();
    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [], debateGenerating: 'system' as PoverId });

    const model = getConfiguredModel();
    const fullTranscript = formatRecentTranscript(activeDebate.transcript, 50);
    const hasSourceDoc = activeDebate.source_type === 'document' || activeDebate.source_type === 'url';
    const prompt = buildDebateSynthesisPrompt(activeDebate.topic.final, fullTranscript, hasSourceDoc, activeDebate.audience);

    try {
      const synthStartMs = Date.now();
      const { text } = await generateTextWithProgress(prompt, model, `Generating synthesis (${model})`, set, 180_000);
      const synthElapsedMs = Date.now() - synthStartMs;
      if (!isStillValid()) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        lines.push(synthesis._raw_text);
      }
      if (synthesis.areas_of_agreement?.length > 0) {
        lines.push('## Areas of Agreement', '');
        for (const a of synthesis.areas_of_agreement) {
          const who = Array.isArray(a.povers) ? a.povers.map((p: string) => POVER_INFO[p as Exclude<PoverId, 'user'>]?.label || p).join(', ') : '';
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
              const label = POVER_INFO[pos.pover as Exclude<PoverId, 'user'>]?.label || pos.pover;
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
            ? dc.accepted_by.map((p: string) => POVER_INFO[p as Exclude<PoverId, 'user'>]?.label || p).join(', ')
            : '';
          const challenged = Array.isArray(dc.challenged_by)
            ? dc.challenged_by.map((p: string) => POVER_INFO[p as Exclude<PoverId, 'user'>]?.label || p).join(', ')
            : '';
          lines.push(`- ${stripNodeIds(dc.claim)}`);
          if (accepted) lines.push(`  - Accepted by: ${accepted}`);
          if (challenged) lines.push(`  - Challenged by: ${challenged}${dc.challenge_basis ? ` — ${stripNodeIds(dc.challenge_basis)}` : ''}`);
        }
      }
      if (synthesis.argument_map?.length > 0) {
        lines.push('', '## Argument Map', '');
        for (const claim of synthesis.argument_map) {
          const claimantLabel = POVER_INFO[claim.claimant as Exclude<PoverId, 'user'>]?.label || claim.claimant;
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
              const attackerLabel = POVER_INFO[attack.claimant as Exclude<PoverId, 'user'>]?.label || attack.claimant;
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
        type: 'synthesis',
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
        console.warn('[Taxonomy Refinement] Pass failed (non-blocking):', trErr);
        pushWarning(get, set, 'Taxonomy refinement suggestions skipped');
      }

      // Cross-cutting node promotion — propose situation nodes from 3-way agreements
      try {
        const ccDebate = get().activeDebate;
        const synthEntry = ccDebate?.transcript.find(e => e.type === 'synthesis');
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
        console.warn('[Taxonomy Gap Analysis] Pass failed (non-blocking):', tgaErr);
        pushWarning(get, set, 'Taxonomy gap analysis skipped');
      }
    } catch (err) {
      set({ debateError: `Synthesis failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate();
    }
  },

  requestProbingQuestions: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [], debateGenerating: 'system' as PoverId });

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
      set({ debateError: `Probing questions failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate();
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
    set({ debateError: null, debateWarnings: [], debateGenerating: 'system' as PoverId });

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
            scoring_method: 'default_pending' as const,
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
            scoring_method: 'ai_rubric',
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
      set({ debateError: `Fact check failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate();
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
    set({ debateError: null, debateWarnings: [], debateGenerating: 'system' as PoverId });

    const model = getConfiguredModel();
    const entriesText = toCompress.map((e) => {
      const label = e.speaker === 'user' ? 'Moderator'
        : e.speaker === 'system' ? 'System'
        : POVER_INFO[e.speaker as Exclude<PoverId, 'user'>]?.label || e.speaker;
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

      await saveDebate();
    } catch (err) {
      set({ debateError: `Context compression failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
    }
  },

  requestReflections: async () => {
    const { activeDebate, saveDebate } = get();
    if (!activeDebate) return;

    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [], reflections: [] });

    const model = getConfiguredModel();
    const fullTranscript = formatRecentTranscript(activeDebate.transcript, 50);
    const povers = (activeDebate.active_povers ?? []).filter(p => p !== 'user') as Exclude<PoverId, 'user'>[];
    const results: ReflectionResult[] = [];

    for (const pover of povers) {
      if (!isStillValid()) return;
      const info = POVER_INFO[pover];
      if (!info) continue;

      set({ debateGenerating: pover as PoverId });

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
            an.nodes.map(n => ({ id: n.id, text: n.text, speaker: POVER_INFO[n.speaker as Exclude<PoverId, 'user'>]?.label || n.speaker })),
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
            `Turn ${s.entry_id} (${POVER_INFO[s.speaker as Exclude<PoverId, 'user'>]?.label || s.speaker}): ` +
            `move_disposition=${s.move_disposition?.ratio?.toFixed(2) ?? 'N/A'}, ` +
            `engagement_depth=${s.engagement_depth?.ratio?.toFixed(2) ?? 'N/A'}, ` +
            `recycling_rate=${s.recycling_rate?.max_self_overlap?.toFixed(2) ?? 'N/A'}`
          ).join('\n')
        : undefined;

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

        const edits: ReflectionEdit[] = (parsed?.edits ?? []).map(e => ({
          edit_type: (e.edit_type || 'revise') as ReflectionEdit['edit_type'],
          node_id: e.node_id,
          category: (e.category || 'Beliefs') as ReflectionEdit['category'],
          current_label: e.current_label,
          proposed_label: e.proposed_label || '',
          current_description: e.current_description,
          proposed_description: e.proposed_description || '',
          rationale: e.rationale || '',
          confidence: (['high', 'medium', 'low'].includes(e.confidence || '') ? e.confidence : 'medium') as ReflectionEdit['confidence'],
          evidence_entries: Array.isArray(e.evidence_entries) ? e.evidence_entries : [],
          status: 'pending' as const,
        }));

        results.push({
          pover: povKey,
          label: info.label,
          reflection_summary: parsed?.reflection_summary || '',
          edits,
        });

        set({ reflections: [...results] });
      } catch (err) {
        results.push({
          pover: povKey,
          label: info.label,
          reflection_summary: `Error: ${mapErrorToUserMessage(err)}`,
          edits: [],
        });
        set({ reflections: [...results] });
      }
    }

    // Add a transcript entry for the reflection
    const summaryLines = results.map(r =>
      `**${r.label}:** ${r.reflection_summary} (${r.edits.length} edit${r.edits.length !== 1 ? 's' : ''} proposed)`
    );
    const reflEntry: TranscriptEntry = {
      id: generateId(),
      speaker: 'system',
      type: 'reflection',
      content: `## Reflections\n\n${summaryLines.join('\n\n')}`,
      timestamp: nowISO(),
      taxonomy_refs: [],
      metadata: { reflection_results: results },
    };
    set({
      debateGenerating: null,
      activeDebate: {
        ...get().activeDebate!,
        transcript: [...get().activeDebate!.transcript, reflEntry],
        updated_at: nowISO(),
      },
    });
    await saveDebate();
  },

  applyReflectionEdit: (pover: string, editIndex: number) => {
    const { reflections } = get();
    const reflection = reflections.find(r => r.pover === pover);
    if (!reflection || !reflection.edits[editIndex]) return;

    const edit = reflection.edits[editIndex];
    const taxStore = useTaxonomyStore.getState();
    const povKey = pover as 'accelerationist' | 'safetyist' | 'skeptic';

    if (edit.edit_type === 'add') {
      const newId = taxStore.createPovNode(povKey, edit.category);
      if (newId) {
        const debateId = get().activeDebateId;
        taxStore.updatePovNode(povKey, newId, {
          label: edit.proposed_label,
          description: edit.proposed_description,
          graph_attributes: defaultGraphAttributes(povKey, edit.category),
          debate_refs: debateId ? [debateId] : [],
        });
      }
    } else if (edit.node_id) {
      if (edit.edit_type === 'deprecate') {
        const deprecatedDesc = edit.proposed_description || `[DEPRECATED] ${edit.current_description || ''}`;
        taxStore.updatePovNode(povKey, edit.node_id, {
          label: edit.proposed_label || edit.current_label || '',
          description: deprecatedDesc,
        });
      } else {
        taxStore.updatePovNode(povKey, edit.node_id, {
          label: edit.proposed_label || edit.current_label || '',
          description: edit.proposed_description,
        });
      }
    }

    taxStore.save();

    // Mark as approved
    const updated = reflections.map(r => {
      if (r.pover !== pover) return r;
      return {
        ...r,
        edits: r.edits.map((e, i) => i === editIndex ? { ...e, status: 'approved' as const } : e),
      };
    });
    set({ reflections: updated });
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
