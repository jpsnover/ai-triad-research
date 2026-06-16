// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { StateCreator } from 'zustand';
import type { DebateStore } from '../types';
import type { Category } from '../../../types/taxonomy';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { nowISO } from '@lib/debate/helpers';
import { computeStructuralScore, critiqueTopicPrompt, parseTopicCritique, formatStructuralContext, computeLineageDistribution, formatLineageContext } from '@lib/debate/topicCritique';
import type { LineageFrameEntry } from '@lib/debate/topicCritique';
import { useTaxonomyStore } from '../../useTaxonomyStore';
import { getConfiguredModel, generateTextWithProgress } from '../helpers';
import { getLineageMapping, getL2Categories, isLineageDataLoaded } from '../../../data/lineageCategories';

export interface TopicCritiqueSlice {
  topicCritiqueLoading: boolean;
  runTopicCritique: () => Promise<void>;
  reEvaluateSuggestedTopic: (suggestedText: string) => Promise<void>;
}

export const createTopicCritiqueSlice: StateCreator<DebateStore, [], [], TopicCritiqueSlice> = (set, get) => ({
  topicCritiqueLoading: false,

  runTopicCritique: async () => {
    const { activeDebate, saveDebate } = get();
    if (!activeDebate) return;

    if (activeDebate.source_type !== 'topic') return;
    if (activeDebate.topic.critique) return;
    if (get().topicCritiqueLoading) return;

    set({ topicCritiqueLoading: true, debateError: null });
    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;
    getGlobalRecorder()?.record({ type: 'topic.critique', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'topicCritique.started', data: { phase: activeDebate.phase, transcript_length: activeDebate.transcript.length, model } });

    try {
      const taxState = useTaxonomyStore.getState();
      const povFiles = ['accelerationist', 'safetyist', 'skeptic'] as const;
      const allPovNodes: { id: string; pov: string; category: Category }[] = [];
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

      const { vector: topicEmbedding } = await api.computeQueryEmbedding(topic);
      const { vectors: nodeVectors } = await api.computeEmbeddings(allNodeTexts, allNodeIds);

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

      let lineageFrame: LineageFrameEntry[] = [];
      if (isLineageDataLoaded() && structuralScore.activated_nodes.length > 0) {
        const mapping = getLineageMapping();
        const l2Cats = getL2Categories();

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

      let structuralContext = formatStructuralContext(structuralScore);
      if (lineageFrame.length > 0) {
        structuralContext += '\n' + formatLineageContext(lineageFrame);
      }
      const prompt = critiqueTopicPrompt(topic, structuralContext);
      const { text } = await generateTextWithProgress(prompt, model, `Evaluating topic quality (${model})`, set);
      const critique = parseTopicCritique(text, structuralScore);

      if (lineageFrame.length > 0) {
        critique.lineage_frame = lineageFrame;
      }

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
          if (parsed.composite_score >= critique.composite_score) {
            suggestedCritique = parsed;
          } else {
            console.log(`[TopicCritique] Suggested topic scored ${parsed.composite_score} < original ${critique.composite_score} — discarding suggestion`);
          }
        } catch (sugErr) {
          getGlobalRecorder()?.record({
            type: 'system.error',
            debate_id: activeDebate.id,
            component: 'debate-store',
            level: 'warn',
            message: 'Suggested topic scoring failed',
            error: { name: (sugErr as Error).name ?? 'Error', message: String(sugErr), stack: (sugErr as Error).stack },
          });
          console.warn('[TopicCritique] Suggested topic scoring failed (non-blocking):', sugErr);
        }
      }

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
        debate_id: activeDebate.id,
        component: 'debate-store',
        level: 'warn',
        message: 'Topic critique failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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
      const allPovNodes: { id: string; pov: string; category: Category }[] = [];
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
        debate_id: activeDebate.id,
        component: 'debate-store',
        level: 'warn',
        message: 'Re-evaluate suggested topic failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      console.warn('[TopicCritique] Re-evaluate suggested failed (non-blocking):', err);
      set({ topicCritiqueLoading: false, debateActivity: null });
    }
  },
});
