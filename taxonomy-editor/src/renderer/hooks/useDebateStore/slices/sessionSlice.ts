// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { StateCreator } from 'zustand';
import type { DebateStore } from '../types';
import type {
  DebateSession,
  DebateSessionSummary,
  DebateSourceType,
  DebateAudience,
  SpeakerId,
  TranscriptEntry,
  EntryDiagnostics,
} from '../../../types/debate';
import { POVER_INFO, AI_POVERS, POV_KEYS, normalizeActivePovers, migrateSpeakerId } from '../../../types/debate';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { trackDebateAbandon, trackDebateStart } from '../../../lib/analyticsEmitter';
import { useTaxonomyStore } from '../../useTaxonomyStore';
import { usePromptConfigStore } from '../../usePromptConfigStore';
import { mapErrorToUserMessage } from '../../../utils/errorMessages';
import { formatSituationDebateContext } from '../../../prompts/debate';
import { normalizeBdiLayer } from '@lib/debate';
import { generateId, nowISO } from '@lib/debate/helpers';
import type { MoveAnnotation } from '@lib/debate/helpers';
import { getMoveName } from '@lib/debate/helpers';
import { disambiguateTerms } from '@lib/debate/vocabularyDisambiguation';
import type { CampOrigin } from '@lib/dictionary/types';
import {
  resetDoctrinalAnchoringCache,
  resetNeutralMapping,
  resetSignalHistory,
  resetGapInjectionCount,
  setGapInjectionCount,
} from '../helpers';

declare const __APP_VERSION__: string;

export interface SessionSlice {
  sessions: DebateSessionSummary[];
  sessionsLoading: boolean;
  activeDebateId: string | null;
  activeDebate: DebateSession | null;
  debateLoading: boolean;

  loadSessions: () => Promise<void>;
  createDebate: (topic: string, povers: SpeakerId[], userIsPover: boolean, sourceType?: DebateSourceType, sourceRef?: string, sourceContent?: string, debateModel?: string, protocolId?: string, debateTemperature?: number, debateAudience?: DebateAudience, options?: { title?: string; evaluatorModel?: string; pacing?: string; useAdaptiveStaging?: boolean; phaseBoundsOverride?: { maxConfrontationRounds?: number; maxArgumentationRounds?: number; maxConcludingRounds?: number }; speakerModels?: Record<string, string>; modelTier?: 'basic' | 'advanced'; stepMode?: boolean; stageModels?: { brief?: string; plan?: string; cite?: string }; background?: string }) => Promise<string>;
  createSituationDebate: (ccNodeId: string) => Promise<string>;
  createConflictDebate: (claimId: string) => Promise<string>;
  loadDebate: (id: string) => Promise<void>;
  loadDebateFromData: (raw: unknown, opts?: { readOnly?: boolean }) => void;
  deleteDebate: (id: string) => Promise<void>;
  renameDebate: (id: string, newTitle: string) => Promise<void>;
  closeDebate: () => void;
  addTranscriptEntry: (entry: Omit<TranscriptEntry, 'id' | 'timestamp'>) => string;
  deleteTranscriptEntries: (entryIds: string[]) => Promise<void>;
  togglePover: (poverId: SpeakerId) => Promise<void>;
  updatePhase: (phase: DebateSession['phase']) => void;
  updateTopic: (topic: Partial<DebateSession['topic']>) => void;
  saveDebate: (caller?: string) => Promise<void>;
  toggleStepMode: () => Promise<void>;
  setDebatePhase: (phase: 'confrontation' | 'argumentation' | 'concluding') => Promise<void>;
}

export const createSessionSlice: StateCreator<DebateStore, [], [], SessionSlice> = (set, get) => ({
  sessions: [],
  sessionsLoading: false,
  activeDebateId: null,
  activeDebate: null,
  debateLoading: false,

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
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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
    const title = options?.title?.trim() || (topic.length > 60 ? topic.slice(0, 57) + '...' : topic);
    const runId = generateId();
    const session: DebateSession = {
      id,
      run_id: runId,
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
        background: options?.background || undefined,
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
      speaker_models: options?.speakerModels || undefined,
      stage_models: options?.stageModels ? { ...options.stageModels } as Record<string, string> : undefined,
      model_tier: options?.modelTier || undefined,
      protocol_id: protocolId || 'structured',
      debate_temperature: debateTemperature ?? undefined,
      adaptive_staging: options?.useAdaptiveStaging
        ? { enabled: true, pacing: (options.pacing as 'tight' | 'moderate' | 'thorough') ?? 'moderate', phase_bounds_override: options.phaseBoundsOverride, step_mode: options.stepMode || undefined }
        : undefined,
      origin: { mode: 'gui' },
    };
    await api.saveDebateSession(session);
    api.trackEvent('debate_start', 'debate', { topic: session.title, protocol: protocolId || 'structured' });
    trackDebateStart(id, session.title, protocolId || 'structured');
    const aiPoversForOrder = AI_POVERS.filter(p => povers.includes(p));
    const shuffledOrder = [...aiPoversForOrder];
    for (let i = shuffledOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledOrder[i], shuffledOrder[j]] = [shuffledOrder[j], shuffledOrder[i]];
    }
    set({ activeDebateId: id, activeDebate: session, debateModel: debateModel || null, debateTemperature: debateTemperature ?? null, openingOrder: shuffledOrder });
    api.setDebateTemperature(debateTemperature ?? null).catch((err: unknown) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'setDebateTemperature failed (non-critical)', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); });
    await get().loadSessions();
    getGlobalRecorder()?.setEventContext({ debate_id: id, run_id: runId });
    getGlobalRecorder()?.record({ type: 'lifecycle', component: 'debate-store', level: 'info', debate_id: id, run_id: runId, message: 'Debate created', data: { topic: title, povers, protocol: protocolId, model: debateModel } });
    getGlobalRecorder()?.record({ type: 'debate.phase', component: 'debate-store', level: 'info', debate_id: id, run_id: runId, message: 'debate.start', data: { phase: 'setup', topic: title, povers, protocol: protocolId, model: debateModel, audience: session.audience, source_type: sourceType, source_ref: sourceRef } });
    return id;
  },

  createSituationDebate: async (ccNodeId: string) => {
    const taxState = useTaxonomyStore.getState();
    const ccNode = taxState.situations?.nodes.find(n => n.id === ccNodeId);
    if (!ccNode) throw new Error(`Situation node ${ccNodeId} not found`);

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
      const runId = generateId();
      session.run_id = runId;
      set({ activeDebateId: id, activeDebate: session, debateLoading: false, debateModel: session.debate_model || null, debateTemperature: session.debate_temperature ?? null, audience: session.audience ?? 'policymakers', openingOrder: session.opening_order ?? [], selectedDiagEntry: null });
      setGapInjectionCount(session.gap_injections?.length ?? 0);
      usePromptConfigStore.getState().loadSessionConfig(
        (session as Record<string, unknown>).prompt_config as Record<string, number | boolean | string> | undefined
      );
      api.setDebateTemperature(session.debate_temperature ?? null).catch((err: unknown) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'setDebateTemperature failed (non-critical)', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); });
      try { api.sendDiagnosticsState({ debate: session, selectedEntry: null }); } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', debate_id: id, component: 'debate-store', level: 'warn', message: 'Diagnostics broadcast to popout failed (loadDebate)', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } }); }
      getGlobalRecorder()?.setEventContext({ debate_id: id, run_id: runId });
      getGlobalRecorder()?.record({ type: 'state.load', component: 'debate-store', level: 'info', debate_id: id, run_id: runId, message: 'Debate loaded', data: { phase: session.phase, transcript_length: session.transcript.length, an_nodes: (session as Record<string, unknown>).argument_network ? ((session as Record<string, unknown>).argument_network as { nodes?: unknown[] }).nodes?.length ?? 0 : 0 } });
      getGlobalRecorder()?.record({ type: 'debate.phase', component: 'debate-store', level: 'info', debate_id: id, run_id: runId, message: 'debate.start', data: { phase: session.phase, topic: session.topic.final, povers: session.active_povers, protocol: session.protocol_id, model: session.debate_model, transcript_length: session.transcript.length, resumed: true } });

      if (session.interrupted_turn) {
        const speakerLabel = POVER_INFO[session.interrupted_turn.speaker as Exclude<SpeakerId, 'user'>]?.label ?? session.interrupted_turn.speaker;
        getGlobalRecorder()?.record({ type: 'lifecycle', component: 'debate-store', level: 'info', debate_id: id, message: 'Interrupted turn detected on load', data: session.interrupted_turn });
        get().addTranscriptEntry({
          type: 'system',
          speaker: 'system',
          content: `[Recovered] ${speakerLabel}'s turn was interrupted when the window closed (round ${session.interrupted_turn.round}, ${session.interrupted_turn.phase} phase). Auto-resuming…`,
          taxonomy_refs: [],
          metadata: { interrupted_turn_recovery: true, ...session.interrupted_turn },
        });
        const fresh = get().activeDebate;
        if (fresh) {
          const { interrupted_turn: _, ...cleaned } = fresh;
          set({ activeDebate: cleaned as DebateSession });
        }
        void get().saveDebate('loadDebate:interrupted_turn_recovery');
        setTimeout(() => {
          const s = get();
          if (s.activeDebateId === id && !s.debateGenerating) {
            getGlobalRecorder()?.record({ type: 'lifecycle', component: 'debate-store', level: 'info', debate_id: id, message: 'Auto-resuming after interrupted turn recovery' });
            void s.crossRespond();
          } else {
            getGlobalRecorder()?.record({ type: 'lifecycle', component: 'debate-store', level: 'info', debate_id: id, message: 'Loop not auto-resumed', data: { reason: s.activeDebateId !== id ? 'debate_switched' : 'already_generating', activeDebateId: s.activeDebateId, debateGenerating: s.debateGenerating } });
          }
        }, 100);
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'state.error', component: 'debate-store', level: 'error', debate_id: id, message: 'Failed to load debate', error: { name: 'LoadError', message: String(err), stack: (err as Error).stack } });
      set({ debateLoading: false, debateError: mapErrorToUserMessage(err) });
    }
  },

  loadDebateFromData: (raw, opts) => {
    resetDoctrinalAnchoringCache();
    resetSignalHistory();
    resetGapInjectionCount();
    resetNeutralMapping();
    const session = raw as DebateSession;
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
    const runId = generateId();
    session.run_id = runId;
    set({
      activeDebateId: session.id,
      activeDebate: session,
      debateLoading: false,
      debateError: null,
      debateWarnings: [],
      debateModel: session.debate_model || null,
      debateTemperature: session.debate_temperature ?? null,
      audience: session.audience ?? 'policymakers',
      openingOrder: session.opening_order ?? [],
      selectedDiagEntry: null,
      communityReadOnly: opts?.readOnly ?? false,
    });
    setGapInjectionCount(session.gap_injections?.length ?? 0);
    getGlobalRecorder()?.setEventContext({ debate_id: session.id, run_id: runId });
    getGlobalRecorder()?.record({ type: 'state.load', component: 'debate-store', level: 'info', debate_id: session.id, run_id: runId, message: 'Debate loaded from data', data: { phase: session.phase, transcript_length: session.transcript.length, readOnly: opts?.readOnly ?? false } });
  },

  deleteDebate: async (id) => {
    try {
      await api.deleteDebateSession(id);
      const { activeDebateId } = get();
      if (activeDebateId === id) {
        set({ activeDebateId: null, activeDebate: null, debateModel: null });
        getGlobalRecorder()?.setEventContext({ debate_id: undefined, run_id: undefined, phase: undefined, round: undefined, turn_index: undefined, speaker: undefined });
      }
      await get().loadSessions();
      getGlobalRecorder()?.record({ type: 'lifecycle', component: 'debate-store', level: 'info', debate_id: id, message: 'Debate deleted' });
      getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'debate-store', level: 'info', debate_id: id, message: 'debate.ended', data: { reason: 'deleted' } });
      trackDebateAbandon(id, 'deleted');
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        debate_id: id,
        component: 'debate-store',
        level: 'error',
        message: 'Failed to delete debate',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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
      if (get().activeDebateId === id) {
        set({ activeDebate: session });
      }
      await get().loadSessions();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        debate_id: id,
        component: 'debate-store',
        level: 'error',
        message: 'Failed to rename debate',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      set({ debateError: mapErrorToUserMessage(err) });
    }
  },

  closeDebate: () => {
    const closingId = get().activeDebateId;
    set({ activeDebateId: null, activeDebate: null, debateError: null, debateWarnings: [], debateGenerating: null, debateModel: null, debateTemperature: null, vocabularyTerms: null });
    api.setDebateTemperature(null).catch((err: unknown) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'setDebateTemperature failed (non-critical)', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); });
    usePromptConfigStore.getState().resetSession();
    getGlobalRecorder()?.setEventContext({ debate_id: undefined, run_id: undefined, phase: undefined, round: undefined, turn_index: undefined, speaker: undefined });
    if (closingId) {
      getGlobalRecorder()?.record({ type: 'lifecycle', component: 'debate-store', level: 'info', debate_id: closingId, message: 'Debate closed' });
      getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'debate-store', level: 'info', debate_id: closingId, message: 'debate.ended', data: { reason: 'closed' } });
      trackDebateAbandon(closingId, 'closed');
    }
  },

  addTranscriptEntry: (entry) => {
    const { activeDebate, vocabularyTerms } = get();
    const entryId = generateId();
    if (!activeDebate) return entryId;

    if (entry.type === 'opening' && entry.speaker !== 'system') {
      const existing = activeDebate.transcript.find(
        e => e.type === 'opening' && e.speaker === entry.speaker,
      );
      if (existing) {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'debate-store', level: 'warn',
          debate_id: activeDebate.id,
          message: `Duplicate opening blocked for ${entry.speaker} — already has opening ${existing.id}`,
        });
        return existing.id;
      }
    }

    const full: TranscriptEntry = {
      ...entry,
      id: entryId,
      timestamp: nowISO(),
    };

    if (vocabularyTerms?.colloquial &&
        (full.type === 'opening' || full.type === 'statement') &&
        full.speaker !== 'system' && full.speaker !== 'moderator' && full.speaker !== 'user') {
      const poverPov = POVER_INFO[full.speaker as Exclude<SpeakerId, 'user'>]?.pov as CampOrigin | undefined;
      if (poverPov) {
        const result = disambiguateTerms(full.content, poverPov, vocabularyTerms.colloquial);
        if (result.terms.length > 0) {
          full.metadata = full.metadata ?? {};
          full.metadata.vocabulary_resolutions = result.terms
            .filter(t => !t.ambiguous)
            .map(t => ({ colloquial: t.bare, canonical: t.canonical, confidence: t.confidence, offset: t.offset }));
          if (result.ambiguousCount > 0) {
            full.metadata.vocabulary_ambiguities = result.terms
              .filter(t => t.ambiguous)
              .map(t => ({ colloquial: t.bare, offset: t.offset }));
          }
        }
      }
    }

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

    let diagnostics = activeDebate.diagnostics;
    if (diagnostics) {
      const cleanedEntries = { ...diagnostics.entries };
      for (const id of idsToRemove) {
        delete cleanedEntries[id];
      }
      diagnostics = { ...diagnostics, entries: cleanedEntries };
    }

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

    const freshDebate = get().activeDebate ?? activeDebate;
    const updated: DebateSession = {
      ...freshDebate,
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
      updated = current.filter(p => p !== poverId);
      if (updated.filter(p => p !== 'user').length < 1) return;
    } else {
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
    void get().saveDebate('updatePhase');
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
    void get().saveDebate('updateTopic');
  },

  toggleStepMode: async () => {
    const { activeDebate, saveDebate } = get();
    if (!activeDebate?.adaptive_staging) return;
    const newMode = !activeDebate.adaptive_staging.step_mode;
    const newDebate = {
      ...activeDebate,
      adaptive_staging: { ...activeDebate.adaptive_staging, step_mode: newMode },
      updated_at: nowISO(),
    };
    set({ activeDebate: newDebate });
    await saveDebate('toggleStepMode');
  },

  setDebatePhase: async (phase) => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate?.adaptive_staging?.phase_state) return;
    const prev = activeDebate.adaptive_staging.phase_state.current_phase;
    if (prev === phase) return;
    const newPhaseState = { ...activeDebate.adaptive_staging.phase_state, current_phase: phase, rounds_in_phase: 0 };
    const asObj = { ...activeDebate.adaptive_staging, phase_state: newPhaseState, current_phase: phase, rounds_in_phase: 0 };
    const newDebate = { ...activeDebate, adaptive_staging: asObj, updated_at: nowISO() };
    set({ activeDebate: newDebate });
    addTranscriptEntry({
      type: 'system', speaker: 'system',
      content: `[Manual phase change] ${prev} → ${phase}`,
      taxonomy_refs: [],
      metadata: { manual_phase_change: true, from_phase: prev, to_phase: phase },
    });
    await saveDebate('setDebatePhase');
  },

  saveDebate: async (caller?: string) => {
    const { activeDebate } = get();
    if (!activeDebate) return;
    try {
      const promptConfig = usePromptConfigStore.getState().exportSessionConfig();
      if (Object.keys(promptConfig).length > 0) {
        (activeDebate as Record<string, unknown>).prompt_config = promptConfig;
      }

      const overview = activeDebate.diagnostics?.overview;
      if (overview) {
        overview.move_type_counts = {};
        overview.disagreement_type_counts = {};
        overview.claims_accepted = 0;
        overview.claims_rejected = 0;
        let turnsWithSitRefs = 0;
        let totalDebateTurns = 0;
        const uniqueSitIds = new Set<string>();
        for (const e of activeDebate.transcript) {
          if (e.type !== 'statement' && e.type !== 'opening') continue;
          totalDebateTurns++;
          const meta = e.metadata as Record<string, unknown> | undefined;
          if (Array.isArray(meta?.move_types)) {
            for (const m of meta.move_types as (string | MoveAnnotation)[]) {
              const name = getMoveName(m);
              overview.move_type_counts[name] = (overview.move_type_counts[name] ?? 0) + 1;
            }
          }
          if (typeof meta?.disagreement_type === 'string') {
            overview.disagreement_type_counts[meta.disagreement_type] =
              (overview.disagreement_type_counts[meta.disagreement_type] ?? 0) + 1;
          }
          const refs = e.taxonomy_refs;
          if (refs && refs.length > 0) {
            const sitRefs = refs.filter(r => r.node_id.startsWith('sit-'));
            if (sitRefs.length > 0) {
              turnsWithSitRefs++;
              for (const r of sitRefs) uniqueSitIds.add(r.node_id);
            }
          }
        }
        const entries = activeDebate.diagnostics?.entries ?? {};
        for (const diag of Object.values(entries) as EntryDiagnostics[]) {
          const trace = diag.extraction_trace;
          if (trace) {
            overview.claims_accepted += trace.candidates_accepted ?? 0;
            overview.claims_rejected += trace.candidates_rejected ?? 0;
          }
        }
        if (totalDebateTurns > 0) {
          overview.situation_citations = {
            turns_with_sit_refs: turnsWithSitRefs,
            total_debate_turns: totalDebateTurns,
            citation_rate: turnsWithSitRefs / totalDebateTurns,
            unique_sit_ids_cited: [...uniqueSitIds].sort(),
          };
        }
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
      getGlobalRecorder()?.record({ type: 'state.error', component: 'debate-store', level: 'error', debate_id: activeDebate.id, message: 'Failed to save debate', error: { name: 'SaveError', message: String(err), stack: (err as Error).stack }, data: { caller: caller ?? 'unknown' } });
      set({ debateError: mapErrorToUserMessage(err) });
    }
  },
});
