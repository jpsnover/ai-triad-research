// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { StateCreator } from 'zustand';
import type { DebateStore } from '../types';
import type { ExplorationSummary } from '@lib/debate/explorationSummary';
import { extractExplorationSummary } from '@lib/debate/explorationSummary';
import { EXPLORATION_PRESET } from '@lib/debate/explorationPresetConfig';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

export interface ExplorationSlice {
  explorationSummary: ExplorationSummary | null;
  explorationSourceId: string | null;
  explorationModel: string | null;

  setExplorationModel: (model: string | null) => void;
  extractExplorationSummary: () => void;
  updateExplorationSummary: (summary: ExplorationSummary) => void;
  clearExplorationSummary: () => void;
  startSeededDebate: () => Promise<string | null>;
  extractAndSeedFromDebate: (debateId: string) => Promise<void>;
}

function seedExplorationIntoDebate(
  get: () => DebateStore,
  set: (partial: Partial<DebateStore>) => void,
  summary: ExplorationSummary,
  sourceId: string | null,
) {
  const debate = get().activeDebate;
  if (!debate) return;

  set({
    activeDebate: {
      ...debate,
      exploration_summary: summary,
      exploration_source_id: sourceId ?? undefined,
      crux_tracker: summary.cruxes.map((c, i) => ({
        id: `explore-crux-${i}`,
        description: c.description,
        disagreement_type: c.disagreement_type,
        state: c.state,
        speakers_involved: c.speakers_involved,
        identified_turn: 0,
        history: [],
        attacking_claim_ids: [],
        last_computed_strength: 0.5,
        support_polarity: 0,
      })),
    },
  });
}

export const createExplorationSlice: StateCreator<DebateStore, [], [], ExplorationSlice> = (set, get) => ({
  explorationSummary: null,
  explorationSourceId: null,
  explorationModel: null,

  setExplorationModel: (model) => set({ explorationModel: model }),

  extractExplorationSummary: () => {
    const { activeDebate } = get();
    if (!activeDebate || activeDebate.phase !== 'closed') return;

    try {
      const summary = extractExplorationSummary(activeDebate);
      set({ explorationSummary: summary, explorationSourceId: activeDebate.id });

      getGlobalRecorder()?.record({
        type: 'lifecycle',
        component: 'exploration',
        level: 'info',
        debate_id: activeDebate.id,
        message: 'Exploration summary extracted',
        data: {
          cruxes: summary.cruxes.length,
          effective_situations: summary.effective_situations.length,
          an_nodes: summary.argument_sketch.nodes.length,
        },
      });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'exploration',
        level: 'error',
        message: 'Failed to extract exploration summary',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }
  },

  updateExplorationSummary: (summary) => set({ explorationSummary: summary }),

  clearExplorationSummary: () => set({ explorationSummary: null, explorationSourceId: null }),

  extractAndSeedFromDebate: async (debateId: string) => {
    const { loadDebate, activeDebate } = get();

    if (activeDebate?.id !== debateId) {
      await loadDebate(debateId);
    }

    const debate = get().activeDebate;
    if (!debate || debate.phase !== 'closed') return;

    try {
      const summary = extractExplorationSummary(debate);
      set({ explorationSummary: summary, explorationSourceId: debate.id });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'exploration',
        level: 'error',
        message: 'Failed to extract exploration summary for rerun',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }
  },

  startSeededDebate: async () => {
    const { explorationSummary, explorationSourceId, createDebate, loadDebate, activeDebate: currentDebate } = get();
    if (!explorationSummary) return null;

    const rc = explorationSummary.recommended_config;

    try {
      const id = await createDebate(
        explorationSummary.topic.final || explorationSummary.topic.refined || explorationSummary.topic.original,
        currentDebate?.active_povers ?? ['accelerationist', 'safetyist', 'skeptic'] as any[],
        currentDebate?.user_is_pover ?? false,
        currentDebate?.source_type ?? 'topic',
        currentDebate?.source_ref ?? '',
        currentDebate?.source_content ?? '',
        currentDebate?.debate_model,
        'structured',
        rc.temperature,
        currentDebate?.audience,
        { pacing: rc.pacing, useAdaptiveStaging: true, background: currentDebate?.topic.background },
      );

      seedExplorationIntoDebate(get, set, explorationSummary, explorationSourceId);
      await get().saveDebate('exploration-seed');

      set({ explorationSummary: null, explorationSourceId: null });
      await loadDebate(id);
      get().updatePhase('clarification');
      await get().saveDebate('seeded-debate-setup');

      getGlobalRecorder()?.record({
        type: 'lifecycle', component: 'exploration', level: 'info', debate_id: id,
        message: 'Seeded production debate from exploration',
        data: { source_debate: explorationSourceId, cruxes_seeded: explorationSummary.cruxes.length },
      });
      return id;
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'exploration', level: 'error',
        message: 'Failed to create seeded debate',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return null;
    }
  },
});

export { EXPLORATION_PRESET };
