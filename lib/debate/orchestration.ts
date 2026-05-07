// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Shared debate orchestration logic — extracted from useDebateStore and
 * debateEngine to eliminate dual-maintained code. Both consumers delegate
 * to these functions via callbacks for AI calls and state management.
 *
 * Follows the same pattern as turnPipeline.ts (StageGenerateFn callbacks).
 */

import type {
  PoverId,
  TranscriptEntry,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  ConvergenceSignals,
  ModeratorState,
  ModeratorIntervention,
  SelectionResult,
  EngineValidationResult,
  DebateHealthScore,
  InterventionMetadata,
  InterventionMove,
  DebatePhase,
  DebateAudience,
  GapInjection,
  UnansweredClaimEntry,
  TurnPipelineResult,
  TurnPipelineInput,
  TurnValidation,
  TurnAttempt,
  TaxonomyRef,
  TurnValidationConfig,
} from './types.js';

import {
  initModeratorState,
  validateRecommendation,
  updateModeratorState,
  computeDebateHealthScore,
  updateSliBreaches,
  computeTriggerEvaluationContext,
  formatTriggerContext,
  buildIntervention,
  buildInterventionBriefInjection,
  getSynthesisResponder,
} from './moderator.js';

import {
  moderatorSelectionPrompt,
  moderatorInterventionPrompt,
  formatCriticalQuestions,
  selectReframingMetaphor,
} from './prompts.js';

import {
  formatArgumentNetworkContext,
  formatUnansweredClaimsHint,
  formatSpecifyHint,
} from './argumentNetwork.js';

import { parseAIJson } from './helpers.js';
import { parseJsonRobust, formatRecentTranscript, getMoveName } from './helpers.js';
import type { PoverResponseMeta } from './helpers.js';
import type { GenerateOptions } from './aiAdapter.js';
import { validateTurn, resolveTurnValidationConfig } from './turnValidator.js';

// ── Callback Interfaces ─────────────────────────────────

export type GenerateFn = (
  prompt: string,
  model: string,
  options: GenerateOptions,
  label: string,
) => Promise<string>;

export interface ModeratorSelectionCallbacks {
  generate: GenerateFn;
  addEntry(entry: Omit<TranscriptEntry, 'id' | 'timestamp'>): string;
  progress(phase: string, speaker?: string, message?: string): void;
  warn(context: string, err: unknown, recovery: string): void;
  formatEdgeContext(activePovers: string[]): { text: string; edges_used?: unknown[] };
  isAborted?(): boolean;
}

// ── Input / Output Types ────────────────────────────────

export interface ModeratorSelectionInput {
  round: number;
  phase: DebatePhase;
  activePovers: Exclude<PoverId, 'user'>[];
  totalRounds: number;
  model: string;
  audience?: DebateAudience;
  sourceDocSummary?: string;
  transcript: ReadonlyArray<TranscriptEntry>;
  contextSummaries?: ReadonlyArray<unknown>;
  argumentNetwork?: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] };
  convergenceSignals?: ConvergenceSignals[];
  unansweredLedger?: UnansweredClaimEntry[];
  gapInjections?: GapInjection[];
  commitments?: Record<string, { asserted?: unknown[]; conceded?: unknown[]; challenged?: unknown[] }>;
  existingModState?: ModeratorState | null;
  /** POV info lookup: poverId → { label, pov } */
  poverInfo: Record<string, { label: string; pov: string; personality?: string }>;
}

export interface ModeratorSelectionResult {
  responder: Exclude<PoverId, 'user'>;
  focusPoint: string;
  addressing: string;
  agreementDetected: boolean;
  selectionResult: Partial<SelectionResult>;
  intervention?: ModeratorIntervention;
  interventionBriefInjection: string;
  /** Moderator state with health score appended but NOT yet updated for this round's intervention. Callers must call updateModeratorState() at end of round. */
  modState: ModeratorState;
  healthScore: DebateHealthScore;
  diagnostics: {
    selectionPrompt: string;
    selectionResponse: string;
    selectionElapsed: number;
    edgeContextLength: number;
    anContextLength: number;
    qbafContextLength: number;
    edgesUsed?: unknown[];
    recentScheme?: string | null;
    metaphorReframeOffered?: string | null;
  };
  /** null if the response was parsed successfully; set to the error if parsing failed */
  selectionParseError?: unknown;
  /** True if agreement was detected and a system entry was added */
  earlyReturn: boolean;
}

// ── Shared Helper: Build Moderator Context ──────────────

function buildQbafContext(an: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] }, poverInfo: Record<string, { label: string }>): string {
  if (!an.nodes.some(n => n.computed_strength != null)) return '';
  const addressed = new Set(an.edges.map(e => e.target));
  const unaddressed = an.nodes
    .filter(n => n.computed_strength != null && !addressed.has(n.id))
    .sort((a, b) => (b.computed_strength ?? 0) - (a.computed_strength ?? 0))
    .slice(0, 5);
  if (unaddressed.length === 0) return '';
  return '\n\n=== STRONGEST UNADDRESSED CLAIMS (by QBAF strength) ===\n'
    + 'Prioritize these — they are well-supported but no one has responded to them yet.\n'
    + 'Claims marked [unscored] have default strength (0.5) — their actual strength is unknown pending human review.\n'
    + 'Claims marked [low-confidence] are Belief claims where AI scoring reliability is poor — weight them carefully.\n'
    + unaddressed.map(n => {
      const unscoredTag = n.scoring_method === 'default_pending' ? ' [unscored]' : '';
      const bdiTag = n.bdi_category ? ` ${n.bdi_category[0].toUpperCase()}` : '';
      const confTag = n.bdi_confidence != null && n.bdi_confidence < 0.5 ? ' [low-confidence]' : '';
      return `- ${n.id} (${poverInfo[n.speaker]?.label ?? n.speaker},${bdiTag}, strength ${n.computed_strength!.toFixed(2)}${unscoredTag}${confTag}): ${n.text}`;
    }).join('\n');
}

function buildGapHint(gapInjections?: GapInjection[]): string {
  if (!gapInjections || gapInjections.length === 0) return '';
  const last = gapInjections[gapInjections.length - 1];
  const transcriptEntry = last.transcript_entry_id;
  if (!transcriptEntry) return '';
  return `\n\n## Identified Debate Gaps (unaddressed)\nThe following gaps were identified mid-debate but have NOT yet been substantively addressed by any debater. Prioritize steering the conversation toward these:\n- Gap injection from round ${last.round ?? '?'}: See transcript for details.\n`;
}

function findRecentScheme(an?: { edges: ArgumentNetworkEdge[] }): string | null {
  if (!an) return null;
  return an.edges
    .filter(e => e.argumentation_scheme && e.argumentation_scheme !== 'OTHER')
    .slice(-1)[0]?.argumentation_scheme ?? null;
}

function checkMetaphorReframe(
  round: number,
  transcript: ReadonlyArray<TranscriptEntry>,
  an?: { edges: ArgumentNetworkEdge[] },
): ReturnType<typeof selectReframingMetaphor> {
  if (round < 4) return null;
  const last3Moves = transcript
    .filter(e => e.speaker !== 'system' && e.speaker !== 'user' && e.speaker !== 'moderator')
    .slice(-3)
    .flatMap(e => ((e.metadata as Record<string, unknown>)?.move_types as (string | { move_type?: string })[] ?? []))
    .map(m => getMoveName(m));
  const concedeDist = last3Moves.filter(m => m === 'CONCEDE').length;
  const distinguishDist = last3Moves.filter(m => m === 'DISTINGUISH').length;
  const isStalling = (concedeDist >= 2 && distinguishDist >= 2) || last3Moves.length === 0;
  const recentAgreement = transcript
    .filter(e => e.speaker === 'system')
    .some(e => e.content.includes('agreement'));

  if (!isStalling && !recentAgreement) return null;

  const usedSources = (an?.edges ?? [])
    .filter(e => e.argumentation_scheme === 'ARGUMENT_FROM_METAPHOR')
    .map(e => e.warrant ?? '')
    .filter(Boolean);
  return selectReframingMetaphor(usedSources, round);
}

// ── Main Orchestration Function ─────────────────────────

export async function runModeratorSelection(
  input: ModeratorSelectionInput,
  callbacks: ModeratorSelectionCallbacks,
): Promise<ModeratorSelectionResult> {
  const {
    round, phase, activePovers, totalRounds, model,
    audience, sourceDocSummary, transcript, contextSummaries,
    argumentNetwork: an, convergenceSignals, unansweredLedger,
    gapInjections, commitments, existingModState, poverInfo,
  } = input;

  const activeLabels = activePovers.map(p => poverInfo[p].label);
  const recentTranscript = formatRecentTranscript(
    transcript as TranscriptEntry[], 8, contextSummaries,
  );

  // Initialize or restore moderator state
  const modState: ModeratorState = existingModState
    ? { ...existingModState }
    : initModeratorState(totalRounds, activePovers);
  modState.round = round;
  modState.phase = phase;

  // Compute turn counts
  const turnCounts: Record<string, number> = {};
  for (const p of activePovers) turnCounts[p] = 0;
  for (const e of transcript) {
    if ((e.type === 'statement' || e.type === 'opening') && e.speaker !== 'system' && e.speaker !== 'moderator') {
      const key = turnCounts[e.speaker] != null ? e.speaker : poverInfo[e.speaker]?.label;
      if (key != null && turnCounts[key] != null) {
        turnCounts[key]++;
      } else if (e.speaker in turnCounts) {
        turnCounts[e.speaker]++;
      }
    }
  }

  // Compute debate health score
  const recentSignals = (convergenceSignals ?? []).slice(-3);
  const citedNodeIds = new Set(
    (transcript as TranscriptEntry[]).flatMap(e => (e.taxonomy_refs ?? []).map(r => r.node_id)),
  );
  const relevantNodeCount = Math.max(an?.nodes?.length ?? 1, 1);
  const healthScore = computeDebateHealthScore(recentSignals, turnCounts, citedNodeIds.size, relevantNodeCount);
  if (modState.health_history.length > 0) {
    const prev = modState.health_history[modState.health_history.length - 1];
    healthScore.trend = healthScore.value - prev.value;
  }
  healthScore.consecutive_decline = modState.consecutive_decline;
  modState.health_history.push(healthScore);
  updateSliBreaches(healthScore, modState);

  // Build context blocks
  const { text: edgeContext, edges_used: edgesUsed } = callbacks.formatEdgeContext(activeLabels);
  const anContext = (an && an.nodes.length > 0)
    ? formatArgumentNetworkContext(
        an.nodes.map(n => ({ id: n.id, text: n.text, speaker: poverInfo[n.speaker]?.label || n.speaker })),
        an.edges,
      )
    : '';
  const qbafContext = an ? buildQbafContext(an, poverInfo) : '';
  const ledgerHint = formatUnansweredClaimsHint(unansweredLedger ?? [], round);
  const specifyHint = an ? formatSpecifyHint(an.nodes, an.edges) : '';
  const gapHint = buildGapHint(gapInjections);
  const recentScheme = findRecentScheme(an);
  const metaphorReframe = checkMetaphorReframe(round, transcript, an);

  const triggerCtx = computeTriggerEvaluationContext(modState, turnCounts);
  const triggerBlock = formatTriggerContext(triggerCtx);

  // ── Synthesis COMMIT automation ──
  const synthesisTarget = phase === 'synthesis'
    ? getSynthesisResponder(modState, activePovers, transcript as TranscriptEntry[])
    : null;

  let responder: Exclude<PoverId, 'user'> | null = null;
  let focusPoint = 'Continue the discussion';
  let addressing = 'general';
  let agreementDetected = false;
  let selectionResultObj: Partial<SelectionResult> = {};
  let activeIntervention: ModeratorIntervention | undefined;
  let interventionBriefInjection = '';
  let selectionPrompt = '';
  let selectionText = '';
  let selectionElapsed = 0;
  let selectionParseError: unknown;

  if (synthesisTarget) {
    // Deterministic synthesis — skip Stage 1 LLM, fire COMMIT directly
    responder = synthesisTarget as Exclude<PoverId, 'user'>;
    focusPoint = 'Provide your final commitment: concessions, conditions for change, and sharpest remaining disagreements';
    addressing = 'all';
    selectionResultObj = {
      responder: synthesisTarget,
      addressing: 'general',
      focus_point: focusPoint,
      agreement_detected: false,
      intervene: true,
      suggested_move: 'COMMIT' as InterventionMove,
      target_debater: synthesisTarget,
      trigger_reasoning: 'Automatic COMMIT in synthesis phase',
    };

    const validation = validateRecommendation(selectionResultObj as SelectionResult, modState);
    if (validation.proceed) {
      try {
        const stage2Prompt = moderatorInterventionPrompt(
          validation.validated_move,
          validation.validated_family,
          poverInfo[validation.validated_target]?.label ?? validation.validated_target,
          'Automatic synthesis-phase COMMIT',
          undefined,
          formatRecentTranscript(transcript as TranscriptEntry[], 4, contextSummaries),
          audience,
          sourceDocSummary,
        );
        const stage2Text = await callbacks.generate(
          stage2Prompt, model, { temperature: 0.7, timeoutMs: 60_000 },
          `Round ${round}: Moderator COMMIT → ${poverInfo[synthesisTarget]?.label}`,
        );

        const stage2Parsed = parseJsonRobust(stage2Text) as Record<string, unknown>;
        const interventionText = stage2Parsed.text as string;

        if (interventionText && interventionText.trim().length > 0) {
          activeIntervention = buildIntervention(
            validation, interventionText,
            'Automatic synthesis-phase COMMIT',
            { signal: 'synthesis_phase', round },
          );

          callbacks.addEntry({
            type: 'intervention',
            speaker: 'moderator',
            content: interventionText,
            taxonomy_refs: [],
            addressing: validation.validated_target,
            intervention_metadata: {
              family: activeIntervention.family,
              move: activeIntervention.move,
              force: activeIntervention.force,
              burden: activeIntervention.burden,
              target_debater: activeIntervention.target_debater,
              trigger_reason: activeIntervention.trigger_reason,
              source_evidence: activeIntervention.source_evidence,
            },
          });

          callbacks.progress('debate', undefined, `Moderator: COMMIT → ${poverInfo[synthesisTarget]?.label}`);
        }
      } catch (err) {
        callbacks.warn('Moderator synthesis COMMIT generation', err, 'Proceeding without COMMIT intervention');
      }
    }
  } else {
    // ── Stage 1: Enhanced moderator selection ──
    selectionPrompt = moderatorSelectionPrompt(
      recentTranscript, activeLabels,
      edgeContext + anContext + qbafContext + ledgerHint + specifyHint + gapHint,
      triggerBlock,
      recentScheme ?? undefined, metaphorReframe, phase, audience,
      sourceDocSummary,
    );

    const selectionStart = Date.now();
    selectionText = await callbacks.generate(
      selectionPrompt, model, { temperature: 0.7, timeoutMs: 60_000 },
      `Round ${round}: Moderator selection`,
    );
    selectionElapsed = Date.now() - selectionStart;

    if (callbacks.isAborted?.()) {
      // Return early with a placeholder — caller handles abort
      return buildEarlyReturn(modState, healthScore, activePovers[0], poverInfo);
    }

    try {
      const parsed = parseJsonRobust(selectionText) as Record<string, unknown>;
      const labelMap: Record<string, Exclude<PoverId, 'user'>> = {};
      for (const p of activePovers) {
        labelMap[p] = p;
        labelMap[poverInfo[p].label.toLowerCase()] = p;
        labelMap[poverInfo[p].label] = p;
      }
      responder = labelMap[String(parsed.responder ?? '').toLowerCase()] ?? null;
      focusPoint = (parsed.focus_point as string) ?? focusPoint;
      addressing = (parsed.addressing as string) ?? 'general';
      agreementDetected = !!parsed.agreement_detected;

      selectionResultObj = {
        responder: responder ?? activePovers[0],
        addressing: (addressing as PoverId | 'general') ?? 'general',
        focus_point: focusPoint,
        agreement_detected: agreementDetected,
        intervene: !!parsed.intervene,
        suggested_move: parsed.suggested_move as InterventionMove | undefined,
        target_debater: labelMap[String(parsed.target_debater ?? '').toLowerCase()] ?? undefined,
        trigger_reasoning: parsed.trigger_reasoning as string | undefined,
        trigger_evidence: parsed.trigger_evidence as SelectionResult['trigger_evidence'] | undefined,
      };

      if (agreementDetected) {
        callbacks.addEntry({
          type: 'system',
          speaker: 'system',
          content: `[Round ${round}] Moderator detected broad agreement. ${focusPoint ? `Focus: ${focusPoint}` : ''}`,
          taxonomy_refs: [],
        });

        updateModeratorState(modState, undefined, {
          proceed: false,
          validated_move: selectionResultObj.suggested_move ?? ('PIN' as InterventionMove),
          validated_family: 'elicitation',
          validated_target: responder ?? activePovers[0],
        }, round, phase);

        return {
          responder: responder ?? activePovers[0],
          focusPoint,
          addressing,
          agreementDetected: true,
          selectionResult: selectionResultObj,
          interventionBriefInjection: '',
          modState,
          healthScore,
          diagnostics: {
            selectionPrompt, selectionResponse: selectionText, selectionElapsed,
            edgeContextLength: edgeContext.length, anContextLength: anContext.length,
            qbafContextLength: qbafContext.length, edgesUsed,
            recentScheme, metaphorReframeOffered: metaphorReframe?.source ?? null,
          },
          earlyReturn: true,
        };
      }

      // ── Engine validation (deterministic) ──
      if (selectionResultObj.intervene && selectionResultObj.suggested_move && selectionResultObj.target_debater) {
        const validation = validateRecommendation(selectionResultObj as SelectionResult, modState);

        if (validation.proceed) {
          try {
            const stage2Prompt = moderatorInterventionPrompt(
              validation.validated_move,
              validation.validated_family,
              poverInfo[validation.validated_target]?.label ?? validation.validated_target,
              selectionResultObj.trigger_reasoning ?? '',
              selectionResultObj.trigger_evidence?.source_claim,
              formatRecentTranscript(transcript as TranscriptEntry[], 4, contextSummaries),
              audience,
              sourceDocSummary,
            );

            const stage2Text = await callbacks.generate(
              stage2Prompt, model, { temperature: 0.7, timeoutMs: 60_000 },
              `Round ${round}: Moderator intervention (${validation.validated_move})`,
            );

            if (callbacks.isAborted?.()) {
              return buildEarlyReturn(modState, healthScore, activePovers[0], poverInfo);
            }

            const stage2Parsed = parseJsonRobust(stage2Text) as Record<string, unknown>;
            const interventionText = (stage2Parsed.text as string) ?? stage2Text;

            if (interventionText && interventionText.trim().length > 0) {
              activeIntervention = buildIntervention(
                validation, interventionText,
                selectionResultObj.trigger_reasoning ?? 'Engine-validated intervention',
                {
                  signal: selectionResultObj.trigger_evidence?.signal_name,
                  claim: selectionResultObj.trigger_evidence?.source_claim,
                  round: selectionResultObj.trigger_evidence?.source_round ?? undefined,
                },
                stage2Parsed.original_claim_text as string | undefined,
              );

              responder = validation.validated_target as Exclude<PoverId, 'user'>;

              interventionBriefInjection = buildInterventionBriefInjection(
                activeIntervention, poverInfo[responder]?.label ?? responder,
              );

              const interventionMeta: InterventionMetadata = {
                family: activeIntervention.family,
                move: activeIntervention.move,
                force: activeIntervention.force,
                burden: activeIntervention.burden,
                target_debater: activeIntervention.target_debater,
                trigger_reason: activeIntervention.trigger_reason,
                source_evidence: activeIntervention.source_evidence,
                prerequisite_applied: activeIntervention.prerequisite_applied,
                original_claim_text: activeIntervention.original_claim_text,
              };

              callbacks.addEntry({
                type: 'intervention',
                speaker: 'moderator',
                content: interventionText,
                taxonomy_refs: [],
                addressing: activeIntervention.target_debater as PoverId,
                intervention_metadata: interventionMeta,
              });

              callbacks.progress('debate', undefined,
                `Moderator: ${activeIntervention.move} → ${poverInfo[responder]?.label}`);
            }
          } catch (stage2Err) {
            callbacks.warn('Moderator Stage 2 generation', stage2Err, 'Proceeding without intervention');
          }
        }
      }
    } catch (err) {
      selectionParseError = err;
      callbacks.warn('Parsing moderator selection', err, 'Falling back to least-recently-spoken debater');
    }
  }

  // Enforce turn alternation: never select the last speaker
  const lastSpeakerEntry = [...transcript].reverse().find(
    (e) => (e.type === 'statement' || e.type === 'opening') && e.speaker !== 'user' && e.speaker !== 'system' && e.speaker !== 'moderator',
  );
  const lastSpeaker = lastSpeakerEntry?.speaker as Exclude<PoverId, 'user'> | undefined;

  if (!responder || !activePovers.includes(responder) || (responder === lastSpeaker && !activeIntervention)) {
    const alternatives = activePovers.filter(p => p !== lastSpeaker);
    if (alternatives.length > 0) {
      // Pick least-recently-spoken
      const lastSpoke = new Map<string, number>();
      transcript.forEach((e, i) => {
        if (e.speaker !== 'user' && e.speaker !== 'system' && e.speaker !== 'moderator') lastSpoke.set(e.speaker, i);
      });
      responder = alternatives.reduce((best, p) =>
        (lastSpoke.get(p) ?? -1) < (lastSpoke.get(best) ?? -1) ? p : best,
      );
    } else {
      responder = activePovers[0];
    }
  }

  return {
    responder,
    focusPoint,
    addressing,
    agreementDetected,
    selectionResult: selectionResultObj,
    intervention: activeIntervention,
    interventionBriefInjection,
    modState,
    healthScore,
    diagnostics: {
      selectionPrompt, selectionResponse: selectionText, selectionElapsed,
      edgeContextLength: edgeContext.length, anContextLength: anContext.length,
      qbafContextLength: qbafContext.length, edgesUsed,
      recentScheme, metaphorReframeOffered: metaphorReframe?.source ?? null,
    },
    selectionParseError,
    earlyReturn: false,
  };
}

function buildEarlyReturn(
  modState: ModeratorState,
  healthScore: DebateHealthScore,
  fallbackResponder: Exclude<PoverId, 'user'>,
  _poverInfo: Record<string, { label: string }>,
): ModeratorSelectionResult {
  return {
    responder: fallbackResponder,
    focusPoint: '',
    addressing: 'general',
    agreementDetected: false,
    selectionResult: {},
    interventionBriefInjection: '',
    modState,
    healthScore,
    diagnostics: {
      selectionPrompt: '', selectionResponse: '', selectionElapsed: 0,
      edgeContextLength: 0, anContextLength: 0, qbafContextLength: 0,
    },
    earlyReturn: true,
  };
}


// ══════════════════════════════════════════════════════════
// Stage 2: Turn execution with validation retry loop
// ══════════════════════════════════════════════════════════

export interface TurnRetryCallbacks {
  runPipeline: (input: TurnPipelineInput) => Promise<TurnPipelineResult>;
  assembleResult: (result: TurnPipelineResult) => { statement: string; taxonomyRefs: TaxonomyRef[]; meta: PoverResponseMeta };
  callJudge: (prompt: string, label: string) => Promise<string>;
  callJudgeFallback?: (prompt: string, label: string) => Promise<string>;
  isAborted?: () => boolean;
}

export interface TurnRetryInput {
  pipelineInput: TurnPipelineInput;
  validationConfig?: TurnValidationConfig;
  model: string;
  speaker: PoverId;
  round: number;
  priorTurns: TranscriptEntry[];
  recentTurns: TranscriptEntry[];
  knownNodeIds: ReadonlySet<string>;
  policyIds: ReadonlySet<string>;
  audience?: DebateAudience;
  pendingIntervention?: ModeratorIntervention;
}

export interface TurnRetryResult {
  statement: string;
  taxonomyRefs: TaxonomyRef[];
  meta: PoverResponseMeta;
  validation: TurnValidation;
  attempts: TurnAttempt[];
  pipelineResult: TurnPipelineResult;
  aborted: boolean;
}

export async function executeTurnWithRetry(
  input: TurnRetryInput,
  callbacks: TurnRetryCallbacks,
): Promise<TurnRetryResult> {
  const vConfig = resolveTurnValidationConfig(input.validationConfig);
  const attempts: TurnAttempt[] = [];
  let attemptIdx = 0;

  // Pipeline can throw on JSON parse failures (e.g., Brief stage malformed JSON).
  // Retry up to maxRetries times before propagating the error.
  let pipelineResult: Awaited<ReturnType<typeof callbacks.runPipeline>>;
  let pipelineError: Error | null = null;
  for (let pipelineAttempt = 0; pipelineAttempt <= vConfig.maxRetries; pipelineAttempt++) {
    try {
      pipelineResult = await callbacks.runPipeline(input.pipelineInput);
      pipelineError = null;
      break;
    } catch (err) {
      pipelineError = err instanceof Error ? err : new Error(String(err));
      if (pipelineAttempt < vConfig.maxRetries) {
        // Log and retry — transient parse errors from weak models often succeed on retry
        console.warn(`[orchestration] Pipeline attempt ${pipelineAttempt + 1} failed: ${pipelineError.message.slice(0, 100)}. Retrying...`);
      }
    }
  }
  if (pipelineError || !pipelineResult!) {
    throw pipelineError ?? new Error('Pipeline failed after retries');
  }

  if (callbacks.isAborted?.()) {
    const a = callbacks.assembleResult(pipelineResult);
    return { ...a, validation: SKIPPED_VALIDATION, attempts: [], pipelineResult, aborted: true };
  }

  let assembled = callbacks.assembleResult(pipelineResult);
  let { statement, taxonomyRefs, meta } = assembled;
  let validation: TurnValidation;

  for (;;) {
    validation = await validateTurn({
      statement, taxonomyRefs, meta,
      phase: input.pipelineInput.phase,
      speaker: input.speaker,
      round: input.round,
      priorTurns: input.priorTurns,
      recentTurns: input.recentTurns,
      knownNodeIds: input.knownNodeIds,
      policyIds: input.policyIds,
      audience: input.audience,
      config: vConfig,
      callJudge: callbacks.callJudge,
      callJudgeFallback: callbacks.callJudgeFallback,
      pendingIntervention: input.pendingIntervention,
    });

    const draftDiag = pipelineResult.stage_diagnostics.find(s => s.stage === 'draft');
    attempts.push({
      attempt: attemptIdx,
      model: input.model,
      prompt_delta: '',
      raw_response: draftDiag?.raw_response ?? '',
      response_time_ms: pipelineResult.total_time_ms,
      validation,
    });

    if (validation.outcome !== 'retry' || attemptIdx >= vConfig.maxRetries) break;

    attemptIdx += 1;
    try {
      pipelineResult = await callbacks.runPipeline({
        ...input.pipelineInput,
        repairHints: validation.repairHints,
      });
    } catch (err) {
      // Pipeline parse failure on retry — treat as failed attempt, break with current validation
      console.warn(`[orchestration] Pipeline retry ${attemptIdx} failed: ${err instanceof Error ? err.message.slice(0, 100) : err}`);
      break;
    }
    if (callbacks.isAborted?.()) {
      return { statement, taxonomyRefs, meta, validation, attempts, pipelineResult, aborted: true };
    }
    assembled = callbacks.assembleResult(pipelineResult);
    ({ statement, taxonomyRefs, meta } = assembled);
  }

  return { statement, taxonomyRefs, meta, validation, attempts, pipelineResult, aborted: false };
}

const SKIPPED_VALIDATION: TurnValidation = {
  outcome: 'skipped',
  process_reward: 1,
  dimensions: {
    schema:      { pass: true, issues: [] },
    grounding:   { pass: true, issues: [] },
    advancement: { pass: true, signals: [] },
    clarifies:   { pass: true, signals: [] },
  },
  repairHints: [],
  clarifies_taxonomy: [],
  judge_used: false,
};
