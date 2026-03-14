// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import type { SourceInfo, PipelineSummary, TaxonomyNode, SelectedKeyPoint, Theme } from '../types/types';
import { rankBySimilarity } from '../utils/similarity';
import type { SemanticResult } from '../utils/similarity';

interface SummaryViewerState {
  // Data
  sources: SourceInfo[];
  summaries: Record<string, PipelineSummary>;
  taxonomy: Record<string, TaxonomyNode>;
  snapshots: Record<string, string>;
  loaded: boolean;

  // Selections
  selectedSourceIds: Set<string>;
  selectedKeyPoint: SelectedKeyPoint | null;

  // UI
  theme: Theme;
  pane1Visible: boolean;

  // Document search (triggered by clicking claims/unmapped concepts)
  documentSearchText: string | null;

  // Similarity search
  similarQuery: string | null;
  similarQueryDescription: string | null;
  similarResults: SemanticResult[] | null;
  similarLoading: boolean;
  similarError: string | null;
  similarThreshold: number;
  embeddingCache: Map<string, number[]>;

  // Actions
  loadSources: () => Promise<void>;
  toggleSource: (id: string) => void;
  toggleAll: () => void;
  selectKeyPoint: (docId: string, pov: string, index: number) => void;
  selectDocumentSearch: (docId: string, searchText: string) => void;
  clearKeyPoint: () => void;
  setTheme: (t: Theme) => void;
  togglePane1: () => void;
  addToTaxonomy: (pov: string, category: string, label: string, description: string, interpretations?: { accelerationist: string; safetyist: string; skeptic: string }, docId?: string, conceptIndex?: number) => Promise<{ success: boolean; nodeId: string; error?: string }>;
  runSimilarSearch: (concept: string, description: string) => Promise<void>;
  clearSimilarSearch: () => void;
  setSimilarThreshold: (t: number) => void;
}

export const useStore = create<SummaryViewerState>((set, get) => ({
  sources: [],
  summaries: {},
  taxonomy: {},
  snapshots: {},
  loaded: false,
  selectedSourceIds: new Set<string>(),
  selectedKeyPoint: null,
  documentSearchText: null,
  theme: (localStorage.getItem('summaryviewer-theme') as Theme) || 'system',
  pane1Visible: true,
  similarQuery: null,
  similarQueryDescription: null,
  similarResults: null,
  similarLoading: false,
  similarError: null,
  similarThreshold: 60,
  embeddingCache: new Map(),

  loadSources: async () => {
    try {
      const discovered = await window.electronAPI.discoverSources();
      const sources = discovered as SourceInfo[];

      // Load all summaries in parallel
      const summaries: Record<string, PipelineSummary> = {};
      await Promise.all(
        sources.map(async (s) => {
          const summary = await window.electronAPI.loadSummary(s.id);
          if (summary) {
            summaries[s.id] = summary as PipelineSummary;
          }
        })
      );

      const taxonomy = await window.electronAPI.loadTaxonomy() as Record<string, TaxonomyNode>;

      set({ sources, summaries, taxonomy, loaded: true });
    } catch (err) {
      console.error('[SummaryViewer] Failed to load sources:', err);
      set({ loaded: true });
    }
  },

  toggleSource: (id: string) => {
    set(state => {
      const next = new Set(state.selectedSourceIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedSourceIds: next };
    });
  },

  toggleAll: () => {
    set(state => {
      const allSelected = state.sources.length > 0 &&
        state.sources.every(s => state.selectedSourceIds.has(s.id));
      if (allSelected) {
        return { selectedSourceIds: new Set<string>() };
      }
      return { selectedSourceIds: new Set(state.sources.map(s => s.id)) };
    });
  },

  selectKeyPoint: async (docId: string, pov: string, index: number) => {
    set({ selectedKeyPoint: { docId, pov, index } });

    // Load snapshot if not already cached
    const { snapshots } = get();
    if (!snapshots[docId]) {
      try {
        const text = await window.electronAPI.loadSnapshot(docId);
        set(state => ({
          snapshots: { ...state.snapshots, [docId]: text },
        }));
      } catch (err) {
        console.error('[SummaryViewer] Failed to load snapshot:', err);
      }
    }
  },

  selectDocumentSearch: async (docId: string, searchText: string) => {
    set({
      selectedKeyPoint: { docId, pov: '_search', index: 0 },
      documentSearchText: searchText,
    });

    // Load snapshot if not already cached
    const { snapshots } = get();
    if (!snapshots[docId]) {
      try {
        const text = await window.electronAPI.loadSnapshot(docId);
        set(state => ({
          snapshots: { ...state.snapshots, [docId]: text },
        }));
      } catch (err) {
        console.error('[SummaryViewer] Failed to load snapshot:', err);
      }
    }
  },

  clearKeyPoint: () => {
    set({ selectedKeyPoint: null, documentSearchText: null });
  },

  setTheme: (t: Theme) => {
    localStorage.setItem('summaryviewer-theme', t);
    set({ theme: t });
  },

  togglePane1: () => {
    set(state => ({ pane1Visible: !state.pane1Visible }));
  },

  addToTaxonomy: async (pov: string, category: string, label: string, description: string, interpretations?: { accelerationist: string; safetyist: string; skeptic: string }, docId?: string, conceptIndex?: number) => {
    const result = await window.electronAPI.addTaxonomyNode({ pov, category, label, description, interpretations, docId, conceptIndex });
    if (result.success) {
      // Reload taxonomy and summaries to reflect the resolved concept
      const taxonomy = await window.electronAPI.loadTaxonomy() as Record<string, TaxonomyNode>;
      if (docId) {
        const summary = await window.electronAPI.loadSummary(docId) as PipelineSummary | null;
        if (summary) {
          set(state => ({
            taxonomy,
            summaries: { ...state.summaries, [docId]: summary },
          }));
        } else {
          set({ taxonomy });
        }
      } else {
        set({ taxonomy });
      }
    }
    return result;
  },

  runSimilarSearch: async (concept: string, description: string) => {
    set({ similarLoading: true, similarError: null, similarQuery: concept, similarQueryDescription: description, similarResults: null });

    try {
      let cache = get().embeddingCache;

      // Build embedding cache if empty
      if (cache.size === 0) {
        const taxonomy = get().taxonomy;
        const ids = Object.keys(taxonomy);
        if (ids.length === 0) {
          set({ similarLoading: false, similarError: 'No taxonomy nodes loaded' });
          return;
        }
        const texts = ids.map(id => {
          const node = taxonomy[id];
          return node.description;
        });
        const vectors = await window.electronAPI.computeEmbeddings(texts);
        cache = new Map<string, number[]>();
        ids.forEach((id, i) => cache.set(id, vectors[i]));
        set({ embeddingCache: cache });
      }

      // Compute query embedding
      const queryText = `${concept}: ${description}`;
      const queryVector = await window.electronAPI.computeQueryEmbedding(queryText);

      // Rank results with low threshold (UI slider filters further)
      const results = rankBySimilarity(queryVector, cache, 0.4, 50);
      set({ similarResults: results, similarLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ similarError: message, similarLoading: false });
    }
  },

  clearSimilarSearch: () => {
    set({ similarQuery: null, similarQueryDescription: null, similarResults: null, similarLoading: false, similarError: null });
  },

  setSimilarThreshold: (t: number) => {
    set({ similarThreshold: t });
  },
}));
