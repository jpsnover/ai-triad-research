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
import { generateId, nowISO, stripCodeFences, parseAIJson, parseAtMention, formatRecentTranscript, parsePoverResponse, hashString, looksTruncated, defaultGraphAttributes } from '@lib/debate/helpers';
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
import { getConfiguredModel, getSpeakerModel } from '../shared/modelConfig';
import { generateTextWithProgress, phaseGuardedSet, summarizeTranscriptEntry, makeStageGenerate, routeTurnValidatorHintsIntoSuggestions, getSourceEvidenceIndex, getDocTitles } from '../shared/generation';
import { createDebateGuard, newAbortController, _abortController, claimDebateDriver, releaseDebateDriver, isDailyLimitError, DAILY_LIMIT_MESSAGE } from '../shared/guards';
import { pushWarning, recordDiagnostic, recordSignalHistory, getSignalValue, movingAverageSignal, incrementGapInjectionCount, _gapInjectionCount } from '../shared/diagnostics';
import { runNeutralCheckpoint } from '../shared/neutralCheckpoint';
import { enrichPolicyRefs, serializeNodeSourceMap, formatEdgeContext, formatDebaterEdgeContext, getRelevantTaxonomyContext, getAllKnownNodeIds, getAllPolicyIds, findNodeMetaInStore, getTaxonomyContext } from '../shared/taxonomyContext';
import { extractClaimsAndUpdateAN, commitAnNodes, detectZeroClaims } from '../shared/argumentNetwork';

export interface DebateReflectionSlice {
  requestReflections: () => Promise<void>;
  applyReflectionEdit: (pover: string, editIndex: number, overrides?: { label?: string; description?: string }, options?: { regeneratePhrases?: boolean }) => Promise<{ ok: boolean; error?: string; enrichNodeId?: string }>;
  retryReflectionEditAfterFix: (pover: string, editIndex: number) => Promise<{ ok: boolean; error?: string }>;
  dismissReflectionEdit: (pover: string, editIndex: number) => void;
  acceptConsensus: (clusterId: string) => Promise<{ ok: boolean; error?: string }>;
  rejectConsensus: (clusterId: string) => void;
  retryEnrichment: (nodeId: string, pov: 'accelerationist' | 'safetyist' | 'skeptic') => Promise<void>;
}

export const createDebateReflectionSlice: StateCreator<DebateStore, [], [], DebateReflectionSlice> = (set, get) => ({
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
          // t/1564: AI sometimes hallucinates existing node IDs for add edits
          if (e.edit_type === 'add') e.node_id = null;
          if (e.node_id) {
            const realLabel = taxState.getLabelForId(e.node_id);
            const realDesc = taxState.getDescriptionForId(e.node_id);
            if (realLabel && realLabel !== e.node_id) currentLabel = realLabel;
            if (realDesc) currentDescription = realDesc;
          }
          return {
            edit_type: (e.edit_type || 'revise') as ReflectionEdit['edit_type'],
            node_id: e.node_id ?? null,
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
      // t/1564 backstop: snapshot existing IDs before creation so we can detect collisions
      const preExistingIds = new Set<string>();
      for (const p of ['accelerationist', 'safetyist', 'skeptic'] as const) {
        for (const n of (useTaxonomyStore.getState()[p]?.nodes ?? []) as { id: string }[]) preExistingIds.add(n.id);
      }
      let newId = taxStore.createPovNode(povKey, edit.category);
      if (!newId && !useTaxonomyStore.getState()[povKey]) {
        await taxStore.loadAll(true);
        newId = taxStore.createPovNode(povKey, edit.category);
      }
      if (!newId) {
        const duration = Math.round(performance.now() - startTime);
        getGlobalRecorder()?.record({ type: 'state.error', component: 'reflection-edit', level: 'error', message: 'applyReflectionEdit.result', data: { ok: false, error: 'createPovNode returned empty', pover, editIndex, pov_loaded: !!useTaxonomyStore.getState()[povKey], duration_ms: duration } });
        return { ok: false, error: 'Failed to create taxonomy node. Taxonomy data may not be loaded.' };
      }
      createdNodeId = newId;
      if (preExistingIds.has(newId)) {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'reflection-edit', level: 'error', message: 'createPovNode generated colliding ID', data: { newId, pover } });
        return { ok: false, error: `Generated ID ${newId} already exists — refusing to overwrite. Please retry.` };
      }
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
              assumes_received: 0,
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
                // eslint-disable-next-line local/require-flight-recorder-in-catch -- per-phrase resilience: individual embedding failures are expected; outer catch records if entire enrichment fails
                } catch { /* per-phrase resilience */ }
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
    trackDebateExtraction(get().activeDebateId ?? undefined, edit.edit_type, edit.node_id ?? '');
    const freshReflections = get().reflections;
    const updated = freshReflections.map(r => {
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
    const freshReflections = get().reflections;
    const updated = freshReflections.map(r => {
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
      const updatedClusters = get().consensusClusters.map(c =>
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
          // eslint-disable-next-line local/require-flight-recorder-in-catch -- per-phrase resilience: individual embedding failures are expected; outer catch records if entire enrichment fails
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

});

