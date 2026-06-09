// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { StateCreator } from 'zustand';
import type { TaxonomyStore, ToolbarPanel } from '../types';
import type {
  TabId,
  Category,
  GraphAttributes,
} from '../../../types/taxonomy';
import { interpretationText } from '../../../types/taxonomy';
import { rankBySimilarity } from '../../../utils/similarity';
import { mapErrorToUserMessage } from '../../../utils/errorMessages';
import { POV_KEYS } from '@lib/debate/types';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

export type SearchMode = 'raw' | 'wildcard' | 'regex' | 'semantic';

export interface SearchSlice {
  findQuery: string;
  findMode: SearchMode;
  findCaseSensitive: boolean;
  setFindQuery: (query: string) => void;
  setFindMode: (mode: SearchMode) => void;
  setFindCaseSensitive: (cs: boolean) => void;

  embeddingCache: Map<string, number[]>;
  embeddingDirty: boolean;
  embeddingLoading: boolean;
  embeddingError: string | null;
  hasApiKey: boolean;
  checkApiKey: () => Promise<void>;
  runSemanticSearch: (query: string, povScopes: Set<TabId>, aspectScopes: Set<Category>) => Promise<void>;
  semanticResults: { id: string; score: number }[];
  buildEmbeddingTexts: (povScopes: Set<TabId>, aspectScopes: Set<Category>) => { ids: string[]; texts: string[] };

  similarResults: { id: string; score: number }[] | null;
  similarLoading: boolean;
  similarStep: string | null;
  similarError: string | null;
  similarThreshold: number;
  setSimilarThreshold: (threshold: number) => void;
  runSimilarSearch: (nodeId: string, label: string, description: string) => Promise<void>;
  clearSimilarSearch: () => void;

  attributeFilter: { field: string; value: string; results: { id: string; label: string; pov: string }[] } | null;
  runAttributeFilter: (field: string, value: string) => void;
  clearAttributeFilter: () => void;

  attributeInfo: { field: string; value: string } | null;
  showAttributeInfo: (field: string, value: string) => void;
  clearAttributeInfo: () => void;
}

export const createSearchSlice: StateCreator<TaxonomyStore, [], [], SearchSlice> = (set, get) => ({
  findQuery: '',
  findMode: 'raw' as SearchMode,
  findCaseSensitive: false,
  setFindQuery: (query) => set({ findQuery: query }),
  setFindMode: (mode) => set({ findMode: mode }),
  setFindCaseSensitive: (cs) => set({ findCaseSensitive: cs }),

  embeddingCache: new Map(),
  embeddingDirty: true,
  embeddingLoading: false,
  embeddingError: null,
  hasApiKey: false,
  semanticResults: [],

  similarResults: null,
  similarLoading: false,
  similarStep: null,
  similarError: null,
  similarThreshold: 60,
  setSimilarThreshold: (threshold) => set({ similarThreshold: threshold }),
  clearSimilarSearch: () => {
    const panel = get().toolbarPanel;
    set({ similarResults: null, similarError: null, ...(panel === 'search' ? { toolbarPanel: null } : {}) });
  },

  checkApiKey: async () => {
    try {
      const has = await api.hasApiKey();
      set({ hasApiKey: has });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to check API key availability', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
      set({ hasApiKey: false });
    }
  },

  buildEmbeddingTexts: (povScopes, aspectScopes) => {
    const state = get();
    const hasPovFilter = povScopes.size > 0;
    const hasAspectFilter = aspectScopes.size > 0;
    const ids: string[] = [];
    const texts: string[] = [];

    for (const pov of POV_KEYS) {
      if (hasPovFilter && !povScopes.has(pov)) continue;
      const file = state[pov];
      if (!file) continue;
      for (const node of file.nodes) {
        if (hasAspectFilter && !aspectScopes.has(node.category)) continue;
        ids.push(node.id);
        texts.push(node.description);
      }
    }

    if (!hasPovFilter || povScopes.has('situations')) {
      if (state.situations && !hasAspectFilter) {
        for (const node of state.situations.nodes) {
          ids.push(node.id);
          texts.push(
            `[situations]\nID: ${node.id}\nLabel: ${node.label}\nDescription: ${node.description}\nAccelerationist interpretation: ${interpretationText(node.interpretations.accelerationist)}\nSafetyist interpretation: ${interpretationText(node.interpretations.safetyist)}\nSkeptic interpretation: ${interpretationText(node.interpretations.skeptic)}`,
          );
        }
      }
    }

    if (!hasPovFilter || povScopes.has('conflicts')) {
      if (!hasAspectFilter) {
        for (const conflict of state.conflicts) {
          const notes = (conflict.human_notes || []).map((n: { note: string }) => n.note).join(' | ');
          ids.push(conflict.claim_id);
          texts.push(
            `[conflict] Status: ${conflict.status}\nID: ${conflict.claim_id}\nClaim: ${conflict.claim_label}\nDescription: ${conflict.description}${notes ? `\nNotes: ${notes}` : ''}`,
          );
        }
      }
    }

    return { ids, texts };
  },

  runSemanticSearch: async (query, povScopes, aspectScopes) => {
    if (!query.trim()) {
      set({ semanticResults: [] });
      return;
    }

    set({ embeddingLoading: true, embeddingError: null });

    try {
      const state = get();
      let cache = state.embeddingCache;

      if (state.embeddingDirty || cache.size === 0) {
        console.log('[semantic-search] Building embedding texts...');
        const { ids, texts } = state.buildEmbeddingTexts(povScopes, aspectScopes);
        console.log(`[semantic-search] Built ${ids.length} texts for embedding`);
        if (texts.length === 0) {
          set({ semanticResults: [], embeddingLoading: false });
          return;
        }
        console.log('[semantic-search] Computing embeddings...');
        const result = await api.computeEmbeddings(texts, ids);
        console.log('[semantic-search] computeEmbeddings returned:', result ? `vectors: ${result.vectors?.length}` : 'null/undefined');
        const { vectors } = result;
        cache = new Map();
        for (let i = 0; i < ids.length; i++) {
          cache.set(ids[i], vectors[i]);
        }
        set({ embeddingCache: cache, embeddingDirty: false });
      }

      console.log(`[semantic-search] Computing query embedding for: "${query}"`);
      const qResult = await api.computeQueryEmbedding(query);
      console.log('[semantic-search] computeQueryEmbedding returned:', qResult ? `vector length: ${qResult.vector?.length}` : 'null/undefined');
      const { vector } = qResult;
      const results = rankBySimilarity(vector, cache, 0.3, 25);
      console.log(`[semantic-search] Found ${results.length} results above threshold`);
      set({ semanticResults: results, embeddingLoading: false });
    } catch (err) {
      const { aiBackend, geminiModel } = get();
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'error', message: 'Semantic search failed', error: { name: (err as Error).name ?? 'Error', message: String(err) }, data: { aiBackend, geminiModel } });
      console.error('[semantic-search] Error during semantic search for query "' + query + '":', err);
      const detail = mapErrorToUserMessage(err);
      set({
        semanticResults: [],
        embeddingLoading: false,
        embeddingError: `Semantic search failed while computing embeddings for "${query}" using ${aiBackend}/${geminiModel}. ${detail}`,
      });
    }
  },

  runSimilarSearch: async (nodeId, label, description) => {
    const queryText = `${label}\n${description}`;
    if (!queryText.trim()) {
      set({ similarResults: [], similarLoading: false });
      return;
    }

    set({ similarLoading: true, similarStep: 'Preparing search...', similarError: null, similarResults: null, toolbarPanel: 'search' });

    try {
      const state = get();
      let cache = state.embeddingCache;

      if (state.embeddingDirty || cache.size === 0) {
        set({ similarStep: 'Building embedding texts...' });
        const { ids, texts } = state.buildEmbeddingTexts(new Set(), new Set());
        if (texts.length === 0) {
          set({ similarResults: [], similarLoading: false, similarStep: null });
          return;
        }
        set({ similarStep: `Computing embeddings for ${texts.length} nodes...` });
        const { vectors } = await api.computeEmbeddings(texts, ids);
        cache = new Map();
        for (let i = 0; i < ids.length; i++) {
          cache.set(ids[i], vectors[i]);
        }
        set({ embeddingCache: cache, embeddingDirty: false });
      }

      set({ similarStep: 'Computing query embedding...' });
      const { vector } = await api.computeQueryEmbedding(queryText);
      set({ similarStep: 'Ranking results...' });
      const results = rankBySimilarity(vector, cache, 0.3, 200);
      const filtered = results.filter(r => r.id !== nodeId);
      set({ similarResults: filtered, similarLoading: false, similarStep: null });
    } catch (err) {
      const { aiBackend, geminiModel } = get();
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'error', message: 'Similar node search failed', error: { name: (err as Error).name ?? 'Error', message: String(err) }, data: { aiBackend, geminiModel } });
      set({ similarLoading: false, similarStep: null, similarError: `[${aiBackend}/${geminiModel}] ${mapErrorToUserMessage(err)}` });
    }
  },

  attributeFilter: null,

  runAttributeFilter: (field, value) => {
    const state = get();
    const results: { id: string; label: string; pov: string }[] = [];
    const normalizedValue = value.toLowerCase();

    const matchAttr = (attrs: GraphAttributes | undefined, nodeId: string, nodeLabel: string, pov: string) => {
      if (!attrs) return;
      const raw = (attrs as Record<string, unknown>)[field];
      if (raw == null) return;

      if (Array.isArray(raw)) {
        if (raw.some((v: unknown) => { const s = typeof v === 'string' ? v : (v as { name?: string })?.name ?? ''; return s.toLowerCase().includes(normalizedValue); })) {
          results.push({ id: nodeId, label: nodeLabel, pov });
        }
      } else {
        const str = String(raw).toLowerCase();
        const tokens = str.split(',').map(t => t.trim());
        if (tokens.some(t => t === normalizedValue)) {
          results.push({ id: nodeId, label: nodeLabel, pov });
        }
      }
    };

    for (const pov of POV_KEYS) {
      const file = state[pov];
      if (!file) continue;
      for (const node of file.nodes) {
        matchAttr(node.graph_attributes, node.id, node.label, pov);
      }
    }

    if (state.situations) {
      for (const node of state.situations.nodes) {
        matchAttr(node.graph_attributes, node.id, node.label, 'situations');
      }
    }

    const current = get();
    set({
      attributeFilter: { field, value, results },
      toolbarPanel: 'attrFilter',
      previousView: { panel: current.toolbarPanel, nodeId: current.selectedNodeId },
    });
  },

  clearAttributeFilter: () => {
    const panel = get().toolbarPanel;
    set({ attributeFilter: null, ...(panel === 'attrFilter' ? { toolbarPanel: null } : {}) });
  },

  attributeInfo: null,
  showAttributeInfo: (field, value) => set({ attributeInfo: { field, value }, toolbarPanel: 'attrInfo' }),
  clearAttributeInfo: () => {
    const panel = get().toolbarPanel;
    set({ attributeInfo: null, ...(panel === 'attrInfo' ? { toolbarPanel: null } : {}) });
  },
});
