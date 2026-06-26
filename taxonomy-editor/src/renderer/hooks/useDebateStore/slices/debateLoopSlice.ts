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

export interface DebateLoopSlice {
  askQuestion: (input: string) => Promise<void>;
  crossRespond: () => Promise<void>;
  generateNewsReport: () => Promise<void>;
  requestReflections: () => Promise<void>;
  applyReflectionEdit: (pover: string, editIndex: number, overrides?: { label?: string; description?: string }, options?: { regeneratePhrases?: boolean }) => Promise<{ ok: boolean; error?: string; enrichNodeId?: string }>;
  retryReflectionEditAfterFix: (pover: string, editIndex: number) => Promise<{ ok: boolean; error?: string }>;
  dismissReflectionEdit: (pover: string, editIndex: number) => void;
  acceptConsensus: (clusterId: string) => Promise<{ ok: boolean; error?: string }>;
  rejectConsensus: (clusterId: string) => void;
  retryEnrichment: (nodeId: string, pov: 'accelerationist' | 'safetyist' | 'skeptic') => Promise<void>;
  clearEnrichmentStatus: (nodeId: string) => void;
}

export const createDebateLoopSlice: StateCreator<DebateStore, [], [], DebateLoopSlice> = (set, get) => ({
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
    const aiPovers = AI_POVERS.filter((p) => activeDebate.active_povers.includes(p));
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
        const speakerModel = getSpeakerModel(activeDebate, poverId, model);
        const t0 = Date.now();
        const { text } = await generateTextWithProgress(prompt, speakerModel, `${POVER_INFO[poverId].label} is responding (${speakerModel})`, set);
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
          metadata: { ...meta, relevance_sources: relevanceSources, injection_manifest: ctx.injectionManifest },
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
          debate_id: activeDebate?.id,
          component: 'debate-store',
          level: 'error',
          message: `${info.label} failed to respond (user prompt)`,
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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
              const regenAssembled = assemblePipelineResult(regenPipelineResult);
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
        debate_id: activeDebate?.id,
        component: 'debate-store',
        level: 'error',
        message: 'News report generation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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
              const { text: retryText } = await api.generateText(retryPrompt, model);
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
                debate_id: activeDebate?.id,
                component: 'debate-store',
                level: 'warn',
                message: `DOLCE compliance retry ${attempt} failed for edit ${ei}`,
                error: { name: (retryErr as Error).name ?? 'Error', message: String(retryErr), stack: (retryErr as Error).stack },
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
          debate_id: activeDebate?.id,
          component: 'debate-store',
          level: 'error',
          message: `Reflection generation failed for ${info.label}`,
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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
          debate_id: activeDebate?.id,
          component: 'debate-store',
          level: 'warn',
          message: 'Consensus detection failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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

  applyReflectionEdit: async (pover: string, editIndex: number, overrides?: { label?: string; description?: string }, options?: { regeneratePhrases?: boolean }) => {
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
        }, { source: 'debate_reflection', debateId: debateId ?? undefined, reason: edit.rationale || undefined });
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
      const reflectionSource = { source: 'debate_reflection' as const, debateId: get().activeDebateId ?? undefined, reason: edit.rationale || undefined };
      if (edit.edit_type === 'deprecate') {
        const deprecatedDesc = finalDescription || `[DEPRECATED] ${edit.current_description || ''}`;
        taxStore.updatePovNode(povKey, edit.node_id, {
          label: finalLabel || edit.current_label || '',
          description: deprecatedDesc,
        }, reflectionSource);
      } else {
        taxStore.updatePovNode(povKey, edit.node_id, {
          label: finalLabel || edit.current_label || '',
          description: finalDescription,
        }, reflectionSource);
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

    // Enrich with AI-generated graph attributes + synthetic embeddings.
    // Runs for new nodes AND edited nodes (skip deprecations — those are being retired).
    // Uses a dirty flag (_phrase_regen_pending) so incomplete enrichments are detectable across sessions.
    const enrichNodeId = createdNodeId ?? (edit.node_id && edit.edit_type !== 'deprecate' ? edit.node_id : null);
    if (enrichNodeId) {
      const shouldRegeneratePhrases = edit.edit_type === 'add' || !!options?.regeneratePhrases;
      // Set dirty flag before starting enrichment
      const preNode = useTaxonomyStore.getState()[povKey]?.nodes.find(n => n.id === enrichNodeId);
      if (preNode) {
        useTaxonomyStore.getState().updatePovNode(povKey, enrichNodeId, {
          graph_attributes: { ...preNode.graph_attributes, _phrase_regen_pending: true },
        });
        await useTaxonomyStore.getState().save();
      }
      set({ enrichmentStatus: { ...get().enrichmentStatus, [enrichNodeId]: { status: 'pending' } } });
      const enrichStartTime = performance.now();
      getGlobalRecorder()?.record({ type: 'state.change', component: 'reflection-enrichment', level: 'info', message: 'enrichment.start', data: { node_id: enrichNodeId, pov: povKey, edit_type: edit.edit_type, regeneratePhrases: shouldRegeneratePhrases } });

      void (async () => {
        try {
          const { reflectionNodeEnrichmentPrompt } = await import('../../../prompts/analysis');
          const enrichPrompt = reflectionNodeEnrichmentPrompt({
            id: enrichNodeId,
            label: finalLabel || edit.current_label || '',
            description: finalDescription,
            category: edit.category,
            pov: povKey,
          });
          const enrichModel = getConfiguredModel();
          const { text } = await api.generateText(enrichPrompt, enrichModel);
          const enriched = JSON.parse(stripCodeFences(text));
          const currentTaxStore = useTaxonomyStore.getState();
          const currentNode = currentTaxStore[povKey]?.nodes.find(n => n.id === enrichNodeId);
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
            ...(enriched.attribution_text && { attribution_text: enriched.attribution_text }),
          };
          // Keep dirty flag until embeddings are also done
          currentTaxStore.updatePovNode(povKey, enrichNodeId, { graph_attributes: mergedAttrs });
          await currentTaxStore.save();

          if (shouldRegeneratePhrases) {
            const phrasesToEmbed: string[] = [];
            if (enriched.attribution_text) phrasesToEmbed.push(enriched.attribution_text);
            if (Array.isArray(enriched.synthetic_phrases)) {
              for (const p of enriched.synthetic_phrases) {
                if (typeof p === 'string' && p.length > 0) phrasesToEmbed.push(p);
              }
            }
            if (phrasesToEmbed.length > 0) {
              const vectors: number[][] = [];
              for (const phrase of phrasesToEmbed) {
                try {
                  const { vector } = await api.computeQueryEmbedding(phrase.slice(0, 500));
                  if (vector?.length > 0) vectors.push(vector);
                } catch { /* per-phrase resilience — outer catch records if entire enrichment fails */ }
              }
              if (vectors.length > 0) {
                const povShort = povKey === 'accelerationist' ? 'acc' : povKey === 'safetyist' ? 'saf' : 'skp';
                await api.updateSyntheticEmbeddings(enrichNodeId, povShort, vectors);
              }
            }
          }

          // Clear dirty flag only after attributes + embeddings are fully done
          const finalNode = useTaxonomyStore.getState()[povKey]?.nodes.find(n => n.id === enrichNodeId);
          if (finalNode?.graph_attributes?._phrase_regen_pending) {
            const finalAttrs = { ...finalNode.graph_attributes };
            delete finalAttrs._phrase_regen_pending;
            useTaxonomyStore.getState().updatePovNode(povKey, enrichNodeId, { graph_attributes: finalAttrs });
            await useTaxonomyStore.getState().save();
          }

          const enrichDuration = Math.round(performance.now() - enrichStartTime);
          getGlobalRecorder()?.record({ type: 'state.change', component: 'reflection-enrichment', level: 'info', message: 'enrichment.complete', duration_ms: enrichDuration, data: { node_id: enrichNodeId, pov: povKey, fields: Object.keys(enriched), regeneratePhrases: shouldRegeneratePhrases } });
          set({ enrichmentStatus: { ...get().enrichmentStatus, [enrichNodeId]: { status: 'success' } } });
        } catch (err) {
          const enrichDuration = Math.round(performance.now() - enrichStartTime);
          getGlobalRecorder()?.record({ type: 'system.error', component: 'reflection-enrichment', level: 'error', message: 'enrichment.failed', duration_ms: enrichDuration, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack }, data: { node_id: enrichNodeId, pov: povKey, edit_type: edit.edit_type } });
          set({ enrichmentStatus: { ...get().enrichmentStatus, [enrichNodeId]: { status: 'error', error: String(err) } } });
        }
      })();
    }

    getGlobalRecorder()?.record({ type: 'state.change', component: 'reflection-edit', level: 'info', message: 'applyReflectionEdit.result', data: { ok: true, pover, editIndex, edit_type: edit.edit_type, node_id: edit.node_id, enrichNodeId, duration_ms: duration } });
    trackDebateExtraction(get().activeDebateId ?? undefined, edit.edit_type, edit.node_id);
    const updated = reflections.map(r => {
      if (r.pover !== pover) return r;
      return {
        ...r,
        edits: r.edits.map((e, i) => i === editIndex ? { ...e, status: 'approved' as const } : e),
      };
    });
    set({ reflections: updated });
    return { ok: true, enrichNodeId: enrichNodeId ?? undefined };
  },

  // "Fix it" recovery: a prior applyReflectionEdit already mutated the node in memory but
  // its save was rejected by the taxonomy integrity check (e.g. dangling CONVERGES_WITH
  // edges left over from consensus acceptance). Auto-remove the dangling references, then
  // re-save the still-pending change — no node is re-created, so 'add' edits can't duplicate.
  retryReflectionEditAfterFix: async (pover: string, editIndex: number) => {
    const { reflections } = get();
    const reflection = reflections.find(r => r.pover === pover);
    const edit = reflection?.edits[editIndex];
    if (!reflection || !edit) return { ok: false, error: 'Edit not found' };

    const taxStore = useTaxonomyStore.getState();
    taxStore.fixIntegrityErrors();
    await useTaxonomyStore.getState().save();

    const { saveError, validationErrors } = useTaxonomyStore.getState();
    if (saveError) {
      const errorDetails = Object.entries(validationErrors ?? {});
      const detailedError = errorDetails.length > 0
        ? `${saveError}\n${errorDetails.map(([field, msg]) => `• ${field}: ${msg}`).join('\n')}`
        : saveError;
      getGlobalRecorder()?.record({ type: 'state.error', component: 'reflection-edit', level: 'error', message: 'retryReflectionEditAfterFix.result', data: { ok: false, error: saveError, pover, editIndex } });
      return { ok: false, error: detailedError };
    }

    getGlobalRecorder()?.record({ type: 'state.change', component: 'reflection-edit', level: 'info', message: 'retryReflectionEditAfterFix.result', data: { ok: true, pover, editIndex, edit_type: edit.edit_type, node_id: edit.node_id } });
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

      // Create CONVERGES_WITH edges from each converging POV node to the situation node.
      // The source must be a REAL node id, never a fabricated symbol — otherwise the edge
      // is dangling and the taxonomy integrity check rejects every subsequent save.
      // Source = the converging proposal's existing node (revise/qualify edits). ADD
      // proposals have no node yet, so their convergence is captured only in the situation
      // node's convergence_source metadata (no edge), avoiding dangling references.
      const currentEdgesFile = useTaxonomyStore.getState().edgesFile;
      if (currentEdgesFile) {
        const { reflections: reflForEdges } = get();
        const povNodeIds = new Set<string>();
        for (const pov of POV_KEYS) {
          const f = useTaxonomyStore.getState()[pov];
          if (f) for (const n of f.nodes) povNodeIds.add(n.id);
        }
        const convergenceEdges = cluster.proposals
          .map(p => reflForEdges.find(r => r.pover === p.pov)?.edits[p.editIndex]?.node_id ?? null)
          .filter((srcId): srcId is string => srcId !== null && povNodeIds.has(srcId))
          .map(srcId => ({
            source: srcId,
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
        if (convergenceEdges.length > 0) {
          const updatedEdgesFile = {
            ...currentEdgesFile,
            last_modified: nowISO(),
            edges: [...currentEdgesFile.edges, ...convergenceEdges],
          };
          const dirty = new Set(useTaxonomyStore.getState().dirty);
          dirty.add('edges');
          useTaxonomyStore.setState({ edgesFile: updatedEdgesFile, dirty });
        }
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
        debate_id: activeDebateId ?? undefined,
        component: 'debate-store',
        level: 'error',
        message: 'Accept consensus failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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

  retryEnrichment: async (nodeId: string, pov: 'accelerationist' | 'safetyist' | 'skeptic') => {
    const taxStore = useTaxonomyStore.getState();
    const node = taxStore[pov]?.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Ensure dirty flag is set before starting so a crash mid-retry is detectable
    useTaxonomyStore.getState().updatePovNode(pov, nodeId, {
      graph_attributes: { ...node.graph_attributes, _phrase_regen_pending: true },
    });
    await useTaxonomyStore.getState().save();

    set({ enrichmentStatus: { ...get().enrichmentStatus, [nodeId]: { status: 'pending' } } });
    const startTime = performance.now();
    getGlobalRecorder()?.record({ type: 'state.change', component: 'reflection-enrichment', level: 'info', message: 'enrichment.retry', data: { node_id: nodeId, pov } });

    try {
      const { reflectionNodeEnrichmentPrompt } = await import('../../../prompts/analysis');
      const enrichPrompt = reflectionNodeEnrichmentPrompt({
        id: nodeId,
        label: node.label,
        description: node.description,
        category: node.category,
        pov,
      });
      const enrichModel = getConfiguredModel();
      const { text } = await api.generateText(enrichPrompt, enrichModel);
      const enriched = JSON.parse(stripCodeFences(text));
      const currentNode = useTaxonomyStore.getState()[pov]?.nodes.find(n => n.id === nodeId);
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
        ...(enriched.attribution_text && { attribution_text: enriched.attribution_text }),
      };
      // Keep dirty flag until embeddings are also done
      useTaxonomyStore.getState().updatePovNode(pov, nodeId, { graph_attributes: mergedAttrs });
      await useTaxonomyStore.getState().save();

      const phrasesToEmbed: string[] = [];
      if (enriched.attribution_text) phrasesToEmbed.push(enriched.attribution_text);
      if (Array.isArray(enriched.synthetic_phrases)) {
        for (const p of enriched.synthetic_phrases) {
          if (typeof p === 'string' && p.length > 0) phrasesToEmbed.push(p);
        }
      }
      if (phrasesToEmbed.length > 0) {
        const vectors: number[][] = [];
        for (const phrase of phrasesToEmbed) {
          try {
            const { vector } = await api.computeQueryEmbedding(phrase.slice(0, 500));
            if (vector?.length > 0) vectors.push(vector);
          } catch { /* per-phrase resilience */ }
        }
        if (vectors.length > 0) {
          const povShort = pov === 'accelerationist' ? 'acc' : pov === 'safetyist' ? 'saf' : 'skp';
          await api.updateSyntheticEmbeddings(nodeId, povShort, vectors);
        }
      }

      // Clear dirty flag only after attributes + embeddings are fully done
      const finalNode = useTaxonomyStore.getState()[pov]?.nodes.find(n => n.id === nodeId);
      if (finalNode?.graph_attributes?._phrase_regen_pending) {
        const finalAttrs = { ...finalNode.graph_attributes };
        delete finalAttrs._phrase_regen_pending;
        useTaxonomyStore.getState().updatePovNode(pov, nodeId, { graph_attributes: finalAttrs });
        await useTaxonomyStore.getState().save();
      }

      const duration = Math.round(performance.now() - startTime);
      getGlobalRecorder()?.record({ type: 'state.change', component: 'reflection-enrichment', level: 'info', message: 'enrichment.retry.complete', duration_ms: duration, data: { node_id: nodeId, pov, fields: Object.keys(enriched) } });
      set({ enrichmentStatus: { ...get().enrichmentStatus, [nodeId]: { status: 'success' } } });
    } catch (err) {
      const duration = Math.round(performance.now() - startTime);
      getGlobalRecorder()?.record({ type: 'system.error', component: 'reflection-enrichment', level: 'error', message: 'enrichment.retry.failed', duration_ms: duration, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack }, data: { node_id: nodeId, pov } });
      set({ enrichmentStatus: { ...get().enrichmentStatus, [nodeId]: { status: 'error', error: String(err) } } });
    }
  },

  clearEnrichmentStatus: (nodeId: string) => {
    const current = { ...get().enrichmentStatus };
    delete current[nodeId];
    set({ enrichmentStatus: current });
  },
});
