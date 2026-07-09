// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  DebateSession,
  SpeakerId,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  CommitmentStore,
  EntryDiagnostics,
  ClaimExtractionTrace,
  ExtractionSummary,
} from '../../../types/debate';
import { POVER_INFO } from '../../../types/debate';
import { useTaxonomyStore } from '../../useTaxonomyStore';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { hashString, looksTruncated, parseAIJson } from '@lib/debate/helpers';
import {
  extractClaimsPrompt,
  classifyClaimsPrompt,
  processExtractedClaims,
  computeClaimTaxonomyAttribution,
  updateUnansweredLedger,
} from '../../../prompts/argumentNetwork';
import { trace, newCallId, TraceEventName } from '../../../lib/trace';
import { updateConvergenceTracker } from '../../../utils/convergenceScoring';
import { computeQbafStrengths } from '@lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '@lib/debate/qbaf';
import { factCheckToBaseStrength } from '@lib/debate/argumentNetwork';
import { needsGc, pruneArgumentNetwork, GC_TRIGGER, GC_TARGET } from '@lib/debate/networkGc';
import { computeConvergenceSignals } from '@lib/debate/convergenceSignals';
import { computeProcessReward } from '@lib/debate/processReward';
import type { ProcessRewardEntry, DebatePhase } from '@lib/debate/types';
import { updateCruxTracker } from '@lib/debate/cruxResolution';
import { evaluateLookaheadPerClaim, buildClaimAnalysis } from '@lib/debate/lookaheadGate';
import type { LookaheadDiagnostics, LookaheadGateResult, ClaimAnalysis, PerClaimResult } from '@lib/debate/lookaheadGate';
import type { MoveAnnotation } from '@lib/debate/helpers';
import { triggerManualDump } from '../../../lib/flightRecorderInit';
import { api } from '@bridge';
import type { GroundingCitation } from '../../../bridge/types';
import { pushWarning, recordDiagnostic } from './diagnostics';
import { getConfiguredModel } from './modelConfig';
import { buildFactCheckPrompt } from './prompts';
import { loadSyntheticVectors, mergeSyntheticVectors } from './taxonomyContext';
import { phaseGuardedSet } from './generation';

/** Maximum number of turn embeddings to retain (enough for recycling detection). */
const TURN_EMBEDDING_WINDOW = 30;

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
  try { void triggerManualDump(); } catch { /* flight recorder dump — silent by design */ }
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
        error: { name: (callErr as Error).name ?? 'Error', message: String(callErr), stack: (callErr as Error).stack },
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
        error: { name: parseErr.name, message: `${parseErr.message} (raw length: ${text.length})`, stack: parseErr.stack },
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
      } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', debate_id: debate.id, component: 'debate-store', level: 'warn', message: 'AN node embedding failed', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } }); }
      if (node.attribution_text_genus) {
        try {
          const { vector } = await api.computeQueryEmbedding(node.attribution_text_genus.slice(0, 300));
          if (vector && vector.length > 0) node.attribution_embedding = vector;
        } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', debate_id: debate.id, component: 'debate-store', level: 'warn', message: 'AN node genus embedding failed', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } }); }
      }
    }

    // Per-claim taxonomy attribution (t/110): compare AN embeddings against same-POV nodes (all BDI categories)
    if (newNodes.length > 0) {
      const speakerPov = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.pov;
      if (speakerPov) {
        try {
          const taxState = useTaxonomyStore.getState();
          const povFile = taxState[speakerPov as keyof typeof taxState] as { nodes: { id: string; category: string; label: string; description: string }[] } | null;
          const povNodes = povFile?.nodes ?? [];
          const allPovNodeIds = new Set(povNodes.map((n) => n.id));

          // Ensure we have embeddings for POV nodes — load from embeddings.json via IPC
          let embCache = taxState.embeddingCache;
          if (embCache.size === 0 || !povNodes.some(n => embCache.has(n.id))) {
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
          const baseNodeEmbeddings: Record<string, { pov: string; vector: number[] }> = {};
          const povMap: Record<string, string> = { acc: 'accelerationist', saf: 'safetyist', skp: 'skeptic' };
          for (const [nodeId, vector] of embCache) {
            const prefix = nodeId.split('-')[0];
            const pov = povMap[prefix];
            if (pov && vector.length > 0) {
              baseNodeEmbeddings[nodeId] = { pov, vector };
            }
          }

          // Merge synthetic multi-vector embeddings when available
          const synVecs = await loadSyntheticVectors();
          const nodeEmbeddings = synVecs
            ? mergeSyntheticVectors(baseNodeEmbeddings, synVecs)
            : baseNodeEmbeddings;

          const attrResult = computeClaimTaxonomyAttribution(
            newNodes, speakerPov, nodeEmbeddings, allPovNodeIds,
          );
          extractionTrace.attribution_attributed = attrResult.attributed;
          extractionTrace.attribution_unattributed = attrResult.unattributed;
          extractionTrace.attribution_missing_embedding = attrResult.missing_embedding;
          extractionTrace.attribution_novel_argument = attrResult.novel_argument;
          extractionTrace.attribution_decisions = attrResult.decisions;
        } catch (e) {
          getGlobalRecorder()?.record({ type: 'system.error', debate_id: debate.id, component: 'debate-store', level: 'warn', message: 'Claim taxonomy attribution failed', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } });
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
              } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', debate_id: debate.id, component: 'debate-store', level: 'warn', message: 'Regen claim embedding failed', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } }); }
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
              error: { name: (regenErr as Error).name ?? 'Error', message: String(regenErr), stack: (regenErr as Error).stack },
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
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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
      const qNodes: QbafNode[] = an.nodes.map((n: ArgumentNetworkNode) => ({ id: n.id, base_strength: n.base_strength ?? 0.5 }));
      const qEdges: QbafEdge[] = an.edges.map((e: ArgumentNetworkEdge) => ({
        source: e.source, target: e.target,
        type: e.type as 'attacks' | 'supports',
        weight: e.weight ?? 0.5,
        attack_type: e.attack_type,
      }));
      const qbafResult = computeQbafStrengths(qNodes, qEdges);
      getGlobalRecorder()?.record({ type: 'an.qbaf', component: 'qbaf', level: 'info', debate_id: baseDebate.id, turn_id: entryId, message: `QBAF propagation: ${qbafResult.iterations} iterations`, data: { iterations: qbafResult.iterations, converged: qbafResult.converged, node_count: qNodes.length } });
      let currentNodes = an.nodes.map((n: ArgumentNetworkNode) => ({
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
            getGlobalRecorder()?.record({ type: 'system.error', debate_id: baseDebate.id, component: 'debate-store', level: 'warn', message: 'Convergence turn embedding failed', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } });
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
            error: { name: (convErr as Error).name ?? 'Error', message: String(convErr), stack: (convErr as Error).stack },
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
          error: { name: (cruxErr as Error).name ?? 'Error', message: String(cruxErr), stack: (cruxErr as Error).stack },
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
          error: { name: (nliErr as Error).name ?? 'Error', message: String(nliErr), stack: (nliErr as Error).stack },
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
        let webCitations: GroundingCitation[] = [];
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
            error: { name: (searchErr as Error).name ?? 'Error', message: String(searchErr), stack: (searchErr as Error).stack },
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
        let vParsed = parseAIJson<{ verdict?: string; explanation?: string; evidence?: string; confidence?: string }>(vText);
        if (!vParsed) {
          vParsed = { verdict: 'unverifiable', evidence: vText.trim() };
        }
        const verdict = vParsed.verdict;
        const explanation = vParsed.explanation || vParsed.evidence || '';

        if (verdict) {
          pNode.verification_status = verdict as ArgumentNetworkNode['verification_status'];
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
                content: `**Fact Check: ${verdictLabel}**\n\n"${pNode.text}"\n\n${explanation}${webNote}`,
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
          error: { name: (verifyErr as Error).name ?? 'Error', message: String(verifyErr), stack: (verifyErr as Error).stack },
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
        error: { name: (saveErr as Error).name ?? 'Error', message: String(saveErr), stack: (saveErr as Error).stack },
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
    try { api.sendDiagnosticsState({ debate: get().activeDebate, selectedEntry: get().selectedDiagEntry }); } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Diagnostics state broadcast failed', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } }); }
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'debate-store',
      level: 'error',
      message: 'Claim extraction failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    console.warn('[AN] Claim extraction failed (non-blocking):', err);
    pushWarning(get, set, 'Argument extraction skipped this turn');
    if (!extractionTrace.error_message) extractionTrace.error_message = String(err);
    if (extractionTrace.status === 'ok') extractionTrace.status = 'adapter_error';
    try { commitTrace(); } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'commitTrace failed during error recovery', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } }); }
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
