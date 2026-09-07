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
import { getConfiguredModel } from '../shared/modelConfig';
import { generateTextWithProgress } from '../shared/generation';
import { getGreatestHits } from '../shared/getGreatestHits';
import { getLineageMapping, getL2Categories, isLineageDataLoaded } from '../../../data/lineageCategories';

// t/3392: the same corpus-narrowing the per-turn taxonomy relevance path applies (t/1998,
// taxonomyContext.ts) must also apply to topic-critique framing, or "exclude greatest hits" only
// prunes the debater shortlist while the frame prompt still sees the full corpus. Fetches the
// exclusion list once per critique call; returns undefined when the toggle is off OR the list is
// requested-but-unavailable — callers get the unfiltered (today's) behavior in both cases, with a
// WARN on the latter so a missing calibration file degrades loudly, not silently (fallback-path
// logging convention, docs/error-handling.md).
async function getFramingExclusionSet(excludeFlag: boolean | undefined, debateId: string): Promise<Set<string> | undefined> {
  if (!excludeFlag) return undefined;
  const ids = await getGreatestHits();
  if (ids && ids.length > 0) return new Set(ids);
  getGlobalRecorder()?.record({
    type: 'system.error',
    debate_id: debateId,
    component: 'debate-store',
    level: 'warn',
    message: 'Greatest-hits exclusion is On but the exclusion list is unavailable — topic-critique framing NOT filtered (t/3392)',
    data: { reason: ids ? 'empty_list' : 'list_unavailable' },
  });
  return undefined;
}

/** Drop excluded node ids from the pov/situation node lists and the embeddings map fed to
 *  computeStructuralScore — the exclusion must apply to ALL THREE consistently (t/3392), since
 *  computeStructuralScore looks up the pov node for an activated embedding by id. */
function applyFramingExclusion<P extends { id: string }, S extends { id: string }>(
  povNodes: P[],
  situationNodes: S[],
  nodeEmbeddings: Record<string, { pov: string; vector: number[] }>,
  exclude: Set<string> | undefined,
): { povNodes: P[]; situationNodes: S[]; nodeEmbeddings: Record<string, { pov: string; vector: number[] }> } {
  if (!exclude || exclude.size === 0) return { povNodes, situationNodes, nodeEmbeddings };
  const filteredEmbeddings: Record<string, { pov: string; vector: number[] }> = {};
  for (const [id, entry] of Object.entries(nodeEmbeddings)) {
    if (!exclude.has(id)) filteredEmbeddings[id] = entry;
  }
  return {
    povNodes: povNodes.filter(n => !exclude.has(n.id)),
    situationNodes: situationNodes.filter(n => !exclude.has(n.id)),
    nodeEmbeddings: filteredEmbeddings,
  };
}

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
      // t/1567: force-reload taxonomy from disk so topic-critique scores against
      // the latest nodes (not a stale in-memory snapshot from session start).
      await useTaxonomyStore.getState().loadAll(true);
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

      // t/3392: apply the debate's greatest-hits exclusion to framing, same as the per-turn path.
      const exclusionSet = await getFramingExclusionSet(activeDebate.exclude_greatest_hits, activeDebate.id);
      const framingSituationNodes = sitNodes.map(n => ({ id: n.id }));
      const filtered = applyFramingExclusion(allPovNodes, framingSituationNodes, nodeEmbeddings, exclusionSet);

      const structuralScore = computeStructuralScore({
        topicEmbedding,
        povNodes: filtered.povNodes,
        situationNodes: filtered.situationNodes,
        embeddings: filtered.nodeEmbeddings,
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
          // t/3392: same filtered set as the original-topic score above — the composite-score
          // comparison a few lines down must compare apples to apples under the same exclusion.
          const suggestedStructural = computeStructuralScore({
            topicEmbedding: suggestedEmbedding,
            povNodes: filtered.povNodes,
            situationNodes: filtered.situationNodes,
            embeddings: filtered.nodeEmbeddings,
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

      // t/3392: same exclusion as runTopicCritique — re-evaluation must frame under the same
      // corpus the original critique + the debate itself use.
      const exclusionSet = await getFramingExclusionSet(activeDebate.exclude_greatest_hits, activeDebate.id);
      const filtered = applyFramingExclusion(allPovNodes, sitNodes.map(n => ({ id: n.id })), nodeEmbeddings, exclusionSet);

      const suggestedStructural = computeStructuralScore({
        topicEmbedding: suggestedEmbedding,
        povNodes: filtered.povNodes,
        situationNodes: filtered.situationNodes,
        embeddings: filtered.nodeEmbeddings,
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
