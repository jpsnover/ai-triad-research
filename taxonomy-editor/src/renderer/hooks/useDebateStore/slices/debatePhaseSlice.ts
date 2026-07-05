// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { StateCreator } from 'zustand';
import type { DebateStore } from '../types';
import type { ReflectionEdit, ReflectionResult, ConsensusProposal, ConsensusCluster } from '../types';
import type {
  DebateSession,
  SpeakerId,
  TranscriptEntry,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  GapInjection,
  CrossCuttingProposal,
} from '../../../types/debate';
import { POVER_INFO, AI_POVERS, POV_KEYS } from '../../../types/debate';
import type { PovNode, CrossCuttingNode as SituationNode, GraphAttributes, Category, Pov } from '../../../types/taxonomy';
import type { ModeratorState, SelectionResult, ModeratorIntervention, InterventionMetadata, DebatePhase } from '@lib/debate/types';
import type { PoverResponseMeta, MoveAnnotation } from '@lib/debate/helpers';
import type { PhaseState, PhaseTransitionConfig, SignalContext, Signal } from '@lib/debate/types';
import type { ProcessRewardEntry } from '@lib/debate/types';
import type { ModeratorSelectionCallbacks, ModeratorSelectionInput, TurnRetryCallbacks, TurnRetryInput } from '@lib/debate/orchestration';
import type { TurnPipelineInput } from '@lib/debate/turnPipeline';
import type { TurnAttempt, TurnValidation, TurnValidationTrail, TaxonomySuggestion } from '../../../types/debate';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { trackDebateTurn, trackDebateExtraction } from '../../../lib/analyticsEmitter';
import { triggerManualDump } from '../../../lib/flightRecorderInit';
import { generateId, nowISO, stripCodeFences, parseAIJson, parseAtMention, formatRecentTranscript, parsePoverResponse } from '@lib/debate/helpers';
import { getMoveName, SUPPORT_MOVES } from '@lib/debate/helpers';
import { formatTaxonomyContext } from '../../../utils/taxonomyContext';
import { formatArgumentNetworkContext, formatCommitments, formatEstablishedPoints, updateUnansweredLedger, formatConcessionCandidatesHint, computeClaimTaxonomyAttribution } from '../../../prompts/argumentNetwork';
import { formatVocabularyContext } from '@lib/debate/vocabularyContext';
import {
  debateResponsePrompt,
  crossRespondPrompt,
  reflectionPrompt,
  dolceComplianceRetryPrompt,
  midDebateGapPrompt,
  crossCuttingNodePrompt,
} from '../../../prompts/debate';
import { checkDolceCompliance } from '../../../utils/dolceCompliance';
import { nodeTypeFromId } from '@lib/debate/nodeIdUtils';
import { computeQbafStrengths } from '@lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '@lib/debate/qbaf';
import { factCheckToBaseStrength } from '@lib/debate/argumentNetwork';
import { needsGc, pruneArgumentNetwork, GC_TRIGGER, GC_TARGET } from '@lib/debate/networkGc';
import { getDebatePhase } from '@lib/debate/types';
import { resolveTurnValidationConfig } from '@lib/debate/turnValidator';
import { computeConvergenceSignals } from '@lib/debate/convergenceSignals';
import { computeProcessReward } from '@lib/debate/processReward';
import { updateCruxTracker } from '@lib/debate/cruxResolution';
import { computeTaxonomyGapAnalysis } from '@lib/debate/taxonomyGapAnalysis';
import {
  updateModeratorState,
  MOVE_RESPONSE_CONFIG,
  DIRECT_RESPONSE_PATTERNS,
  computeDebateHealthScore,
} from '@lib/debate/moderator';
import { runModeratorSelection, executeTurnWithRetry } from '@lib/debate/orchestration';
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
import { runTurnPipeline, assemblePipelineResult } from '@lib/debate/turnPipeline';
import { evaluateLookaheadPerClaim, buildClaimAnalysis } from '@lib/debate/lookaheadGate';
import type { LookaheadDiagnostics, LookaheadGateResult, ClaimAnalysis, PerClaimResult } from '@lib/debate/lookaheadGate';
import { shouldRunGapCheck, findUnengagedHighRelevanceNodes, collectEngagedNodeIds, MAX_GAP_INJECTIONS } from '@lib/debate/gapCheck';
import { computeBeliefConfidence } from '@lib/debate/beliefConfidence';
import { computeTreePriority } from '@lib/debate/desirePriority';
import { computeOperationality } from '@lib/debate/intentionOperationality';
import { useTaxonomyStore } from '../../useTaxonomyStore';
import { usePromptConfigStore } from '../../usePromptConfigStore';
import { mapErrorToUserMessage } from '../../../utils/errorMessages';
import { cosineSimilarity, scoreNodesLexical } from '../../../utils/taxonomyRelevance';
import {
  getConfiguredModel,
  getSpeakerModel,
  generateTextWithProgress,
  createDebateGuard,
  pushWarning,
  recordDiagnostic,
  phaseGuardedSet,
  enrichPolicyRefs,
  serializeNodeSourceMap,
  buildDebateResponsePrompt,
  buildCrossRespondPrompt,
  formatGapHint,
  formatEdgeContext,
  formatDebaterEdgeContext,
  getRelevantTaxonomyContext,
  makeStageGenerate,
  getAllKnownNodeIds,
  getAllPolicyIds,
  findNodeMetaInStore,
  routeTurnValidatorHintsIntoSuggestions,
  getSourceEvidenceIndex,
  getDocTitles,
  extractClaimsAndUpdateAN,
  summarizeTranscriptEntry,
  hashString,
  looksTruncated,
  commitAnNodes,
  defaultGraphAttributes,
  detectZeroClaims,
  runNeutralCheckpoint,
  recordSignalHistory,
  getSignalValue,
  movingAverageSignal,
  newAbortController,
  incrementGapInjectionCount,
  _abortController,
  _gapInjectionCount,
  getTaxonomyContext,
  claimDebateDriver,
  releaseDebateDriver,
  isDailyLimitError,
  DAILY_LIMIT_MESSAGE,
} from '../helpers';

export interface DebatePhaseSlice {
  crossRespond: () => Promise<void>;
}

export const createDebatePhaseSlice: StateCreator<DebateStore, [], [], DebatePhaseSlice> = (set, get) => ({
  crossRespond: async () => {

    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) {
      getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'debate-store', level: 'warn', message: 'crossRespond called with no activeDebate — exiting' });
      return;
    }
    if (!claimDebateDriver()) {
      set({ debateError: 'Another window is already running this debate.' });
      getGlobalRecorder()?.record({ type: 'lifecycle', component: 'debate-store', level: 'warn', debate_id: activeDebate.id, message: 'Debate driver claim denied — another window owns it' });
      return;
    }
    getGlobalRecorder()?.record({ type: 'debate.round', component: 'debate-store', level: 'debug', debate_id: activeDebate?.id, message: 'crossRespond entered', data: { phase: activeDebate?.phase, transcript_length: activeDebate?.transcript.length, adaptive_phase: activeDebate?.adaptive_staging?.phase_state?.current_phase } });

    // Guard: if openings completed but abort guard prevented phase transition, fix it now
    if (activeDebate.phase === 'opening' && activeDebate.transcript.some(e => e.type === 'opening')) {
      get().updatePhase('debate');
    }

    newAbortController();
    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [] });

    // Lazy-load edges for moderator context
    const taxState = useTaxonomyStore.getState();
    if (!taxState.edgesFile) {
      await useTaxonomyStore.getState().loadEdges();
    }

    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;
    const aiPovers = AI_POVERS.filter((p) => activeDebate.active_povers.includes(p));

    if (aiPovers.length < 2) {
      releaseDebateDriver();
      set({ debateError: 'Need at least 2 AI debaters for cross-response' });
      getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'debate-store', level: 'warn', debate_id: activeDebate.id, message: 'crossRespond exiting — fewer than 2 AI debaters', data: { aiPovers: aiPovers.length } });
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
        set({ debateGenerating: responderPover, debateActivity: `${POVER_INFO[responderPover].label} is preparing...` });

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
          model: getSpeakerModel(activeDebate, responderPover, model),
          briefModel: activeDebate.stage_models?.brief || undefined,
          planModel: activeDebate.stage_models?.plan || undefined,
          citeModel: activeDebate.stage_models?.cite || undefined,
          sourceEvidenceIndex: evidenceIndex as TurnPipelineInput['sourceEvidenceIndex'],
          docTitles: docTitles as TurnPipelineInput['docTitles'],
          doctrinalBoundaries: info.doctrinal_boundaries,
          background: activeDebate.topic?.background || undefined,
        };

        const stageGenerate = makeStageGenerate(set as (partial: Record<string, unknown>) => void, getSpeakerModel(activeDebate, responderPover, model));
        const pipelineResult = await runTurnPipeline(pipelineInput, stageGenerate);
        if (!isStillValid()) { releaseDebateDriver(); set({ debateGenerating: null }); getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'debate.ended', data: { reason: 'debate_switched' } }); return; }

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
          metadata: { ...meta, round: crossRespondRound, moderator_trace: { selected: info.label, selection_reason: 'post_termination_final_statement' }, relevance_sources: relevanceSources, injection_manifest: ctx.injectionManifest },
        });
        const lastEntry = get().activeDebate?.transcript.slice(-1)[0];
        if (lastEntry) {

          const draftDiag = pipelineResult.stage_diagnostics.find(s => s.stage === 'draft');
          const topicAlignDiagTerm = pipelineResult.topicAlignmentResult
            ? {
              topic_aligned: pipelineResult.topicAlignmentResult.topic_aligned,
              repaired: pipelineResult.topicAlignmentResult.repaired || undefined,
              draft_attempt: pipelineResult.topicAlignmentResult.draft_attempt,
              scope_used: get().activeDebate?.topic?.scope ?? null,
            }
            : undefined;
          recordDiagnostic(get, set, lastEntry.id, {
            prompt: draftDiag?.raw_response ?? pipelineResult.final_text,
            raw_response: pipelineResult.final_text,
            model,
            taxonomy_context: taxonomyBlock,
            commitment_context: commitBlock || undefined,
            stage_diagnostics: pipelineResult.stage_diagnostics,
            topic_alignment: topicAlignDiagTerm,
            quality_gate: pipelineResult.qualityGateResult,
          });
          void extractClaimsAndUpdateAN(statement, responderPover, lastEntry.id, taxonomyRefs.map(r => r.node_id), get, set, meta.my_claims);
          await summarizeTranscriptEntry(lastEntry.id, statement, info.label, model, get, set);
        }
        releaseDebateDriver();
        set({ debateGenerating: null });
        getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'debate.ended', data: { reason: 'post_termination_complete' } });
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
          phaseBoundsOverride: adaptiveStaging.phase_bounds_override,
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
      if (!isStillValid()) {
        getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'crossRespond aborted post-moderator — debate no longer valid' });
        releaseDebateDriver(); return;
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        debate_id: activeDebate?.id,
        component: 'debate-store',
        level: 'error',
        message: 'Cross-respond moderator selection failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      releaseDebateDriver();
      if (isDailyLimitError(err)) {
        set({ debateError: DAILY_LIMIT_MESSAGE, dailyLimitPaused: true, debateGenerating: null });
        getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'debate.paused', data: { reason: 'daily_token_limit' } });
      } else {
        set({ debateError: `Cross-respond selection failed: ${mapErrorToUserMessage(err)}`, debateRetryAction: 'crossRespond', debateGenerating: null });
        getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'debate.ended', data: { reason: 'error', error: String(err) } });
      }
      return;
    }

    if (modResult.earlyReturn && modResult.agreementDetected) {
      // Persist moderator state and stop — agreement detected
      getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'Agreement detected — skipping debater turn', data: { round: crossRespondRound, phase, focus: modResult.focusPoint } });
      const freshDebate = get().activeDebate;
      if (freshDebate) {
        set({ activeDebate: { ...freshDebate, moderator_state: modResult.modState } });
      }
      releaseDebateDriver();
      set({ debateGenerating: null });
      getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'debate.ended', data: { reason: 'agreement_detected', round: crossRespondRound } });
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
    const engineValidation = modResult.engineValidation
      ?? (intervention
        ? { proceed: true, validated_move: intervention.move, validated_family: intervention.family, validated_target: intervention.target_debater } as import('@lib/debate/types').EngineValidationResult
        : { proceed: false, validated_move: (selectionResult?.suggested_move ?? 'PIN') as import('@lib/debate/types').InterventionMove, validated_family: 'elicitation' as import('@lib/debate/types').InterventionFamily, validated_target: responderPover } as import('@lib/debate/types').EngineValidationResult);
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
    set({ debateGenerating: responderPover, debateActivity: `${POVER_INFO[responderPover].label} is preparing...` });

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

    const lastOpponentEntry = (activeDebate.transcript ?? [])
      .filter(e => e.speaker !== responderPover && e.speaker !== 'system' && e.speaker !== 'user' && e.type !== 'opening')
      .slice(-1)[0];
    const lastOpponentStatement = lastOpponentEntry
      ? (typeof lastOpponentEntry.content === 'string' ? lastOpponentEntry.content : JSON.stringify(lastOpponentEntry.content))
      : undefined;

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
      model: getSpeakerModel(activeDebate, responderPover, model),
      briefModel: activeDebate.stage_models?.brief || undefined,
      planModel: activeDebate.stage_models?.plan || undefined,
      citeModel: activeDebate.stage_models?.cite || undefined,
      sourceEvidenceIndex: evidenceIndex as TurnPipelineInput['sourceEvidenceIndex'],
      docTitles: docTitles as TurnPipelineInput['docTitles'],
      doctrinalBoundaries: info.doctrinal_boundaries,
      background: activeDebate.topic?.background || undefined,
      topicScope: activeDebate.topic?.scope ?? undefined,
      preCheckModel: resolveTurnValidationConfig(undefined).preCheckModel,
      lastOpponentStatement,
    };

    const stageGenerate = makeStageGenerate(set as (partial: Record<string, unknown>) => void, getSpeakerModel(activeDebate, responderPover, model));

    try {

      // ── Per-turn validation + retry loop ──
      const activeSnapshot = get().activeDebate;
      const vConfig = resolveTurnValidationConfig(undefined);

      const retryCallbacks: TurnRetryCallbacks = {
        runPipeline: (input) => runTurnPipeline(
          input, stageGenerate,
          (_stage, label) => set({ debateActivity: label }),
        ),
        assembleResult: (result) => assemblePipelineResult(result, getAllKnownNodeIds()),
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
      if (turnResult.aborted) {
        getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'crossRespond aborted post-turn — debate terminated during pipeline', data: { round: crossRespondRound, speaker: responderPover } });
        releaseDebateDriver(); return;
      }
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
          injection_manifest: ctx.injectionManifest,
        },
      });

      trackDebateTurn(activeDebate.id, crossRespondRound, responderPover);

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
        const topicAlignDiag = pipelineResult.topicAlignmentResult
          ? {
            topic_aligned: pipelineResult.topicAlignmentResult.topic_aligned,
            repaired: pipelineResult.topicAlignmentResult.repaired || undefined,
            draft_attempt: pipelineResult.topicAlignmentResult.draft_attempt,
            scope_used: get().activeDebate?.topic?.scope ?? null,
          }
          : undefined;
        recordDiagnostic(get, set, lastEntry.id, {
          prompt: draftDiag?.prompt ?? '',
          raw_response: draftDiag?.raw_response ?? '',
          model,
          response_time_ms: pipelineResult.total_time_ms,
          taxonomy_context: taxonomyBlock,
          commitment_context: commitBlock || undefined,
          stage_diagnostics: pipelineResult.stage_diagnostics,
          topic_alignment: topicAlignDiag,
          quality_gate: pipelineResult.qualityGateResult,
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
              const regenAssembled = assemblePipelineResult(regenPipelineResult, getAllKnownNodeIds());
              if (!regenAssembled) return null;
              const { statement: newStatement, meta: newMeta } = regenAssembled;
              return { statement: newStatement, debaterClaims: newMeta.my_claims };
            } catch (err) {
              getGlobalRecorder()?.record({
                type: 'system.error',
                debate_id: activeDebate?.id,
                component: 'debate-store',
                level: 'warn',
                message: 'Lookahead response regeneration failed',
                error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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
        } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', debate_id: activeDebate?.id, component: 'debate-store', level: 'warn', message: 'Position drift detection failed', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } }); }
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
      } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', debate_id: activeDebate?.id, component: 'debate-store', level: 'warn', message: 'Neutral midpoint checkpoint failed', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } }); }

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
            const { text: gapText } = await api.generateText(gapPrompt, gapModel);
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

              incrementGapInjectionCount();
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

              getGlobalRecorder()?.record({ type: 'state.change', debate_id: activeDebate?.id, component: 'gap-injection', level: 'info', message: `gap.${triggerType}`, data: { round: currentRound, args: gapArgs.length, focus: focusNodes?.length ?? 0, total_injections: _gapInjectionCount } });
            }
          }
        }
      } catch (gapErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          debate_id: activeDebate?.id,
          component: 'debate-store',
          level: 'warn',
          message: 'Gap injection analysis failed',
          error: { name: (gapErr as Error).name ?? 'Error', message: String(gapErr), stack: (gapErr as Error).stack },
        });
        console.warn('[Gap Injection] Gap analysis failed (non-blocking):', gapErr);
        pushWarning(get, set, 'Gap analysis skipped this turn');
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'error', debate_id: activeDebate.id, message: `Pipeline failed for ${responderPover} R${crossRespondRound}`, data: { round: crossRespondRound, speaker: responderPover, error: String(err), stack: (err as Error).stack?.slice(0, 500), transcript_length: get().activeDebate?.transcript.length } });
      if (isDailyLimitError(err)) {
        addTranscriptEntry({ type: 'system', speaker: 'system', content: DAILY_LIMIT_MESSAGE, taxonomy_refs: [] });
        releaseDebateDriver();
        set({ debateGenerating: null, debateActivity: null, debateError: DAILY_LIMIT_MESSAGE, dailyLimitPaused: true });
        getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'debate.paused', data: { reason: 'daily_token_limit', round: crossRespondRound, speaker: responderPover } });
        return;
      }
      addTranscriptEntry({
        type: 'system',
        speaker: 'system',
        content: `${info.label} failed to cross-respond: ${mapErrorToUserMessage(err)}`,
        taxonomy_refs: [],
      });
      getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'debate-store', level: 'error', debate_id: activeDebate.id, message: 'debate.turn_failed', data: { reason: 'pipeline_error', round: crossRespondRound, speaker: responderPover, error: String(err) } });
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
          phaseBoundsOverride: postDebate.adaptive_staging.phase_bounds_override,
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
          } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', debate_id: postDebate.id, component: 'debate-store', level: 'warn', message: 'Phase signal computation failed', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } }); }
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

        // Apply transition (skipped in step mode — user controls phase manually)
        const isStepMode = postDebate.adaptive_staging.step_mode;
        const prevPhase = advanced.current_phase;
        const newState = isStepMode ? advanced : applyTransition(advanced, result);

        if (!isStepMode) {
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
            newState.current_phase = 'terminated';
          }
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

    // Auto-probing disabled — probing questions are available on demand via requestProbingQuestions()

    releaseDebateDriver();
    set({ debateGenerating: null });
    getGlobalRecorder()?.record({ type: 'debate.round', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: `Cross-respond round ${crossRespondRound} end` , data: { round: crossRespondRound } });
    await saveDebate('crossRespond:end');
  },
});

