// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import type { SourceInfo, PipelineSummary, TaxonomyNode, SelectedKeyPoint, Theme, PotentialEdge, PolicyRegistryEntry } from '../types/types';
import { rankBySimilarity } from '../utils/similarity';
import { mapErrorToUserMessage } from '../utils/errorMessages';
import type { SemanticResult } from '../utils/similarity';
import { buildPotentialEdgesSystemPrompt, buildPotentialEdgesUserPrompt } from '../prompts/potentialEdges';
import type { AIBackend, AIModel } from './aiModels';
import { getStoredBackend, getStoredModel, storeBackend, storeModel, DEFAULT_MODELS } from './aiModels';

interface SummaryViewerState {
  // Data
  sources: SourceInfo[];
  summaries: Record<string, PipelineSummary>;
  taxonomy: Record<string, TaxonomyNode>;
  policyRegistry: PolicyRegistryEntry[];
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

  // Potential edges
  potentialEdgesQuery: string | null;
  potentialEdges: PotentialEdge[] | null;
  potentialEdgesLoading: boolean;
  potentialEdgesError: string | null;

  // AI settings
  aiBackend: AIBackend;
  aiModel: AIModel;
  setAIBackend: (backend: AIBackend) => void;
  setAIModel: (model: AIModel) => void;

  // Actions
  loadSources: () => Promise<void>;
  toggleSource: (id: string) => void;
  toggleAll: (filterIds?: string[]) => void;
  selectKeyPoint: (docId: string, pov: string, index: number) => void;
  selectDocumentSearch: (docId: string, searchText: string) => void;
  clearKeyPoint: () => void;
  setTheme: (t: Theme) => void;
  togglePane1: () => void;
  addToTaxonomy: (pov: string, category: string, label: string, description: string, interpretations?: { accelerationist: string; safetyist: string; skeptic: string }, docId?: string, conceptIndex?: number) => Promise<{ success: boolean; nodeId: string; error?: string }>;
  runSimilarSearch: (concept: string, description: string) => Promise<void>;
  clearSimilarSearch: () => void;
  setSimilarThreshold: (t: number) => void;
  runPotentialEdges: (concept: { label: string; description: string; pov: string; category: string }) => Promise<void>;
  clearPotentialEdges: () => void;
}

export const useStore = create<SummaryViewerState>((set, get) => ({
  sources: [],
  summaries: {},
  taxonomy: {},
  policyRegistry: [],
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
  potentialEdgesQuery: null,
  potentialEdges: null,
  potentialEdgesLoading: false,
  potentialEdgesError: null,

  aiBackend: getStoredBackend(),
  aiModel: getStoredModel(),
  setAIBackend: (backend) => {
    storeBackend(backend);
    const newModel = DEFAULT_MODELS[backend];
    storeModel(newModel);
    set({ aiBackend: backend, aiModel: newModel });
  },
  setAIModel: (model) => {
    storeModel(model);
    set({ aiModel: model });
  },

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
      const polReg = await window.electronAPI.loadPolicyRegistry() as { policies: PolicyRegistryEntry[] } | null;

      set({ sources, summaries, taxonomy, policyRegistry: polReg?.policies ?? [], loaded: true });
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

  toggleAll: (filterIds?: string[]) => {
    set(state => {
      const ids = filterIds || state.sources.map(s => s.id);
      const allSelected = ids.length > 0 && ids.every(id => state.selectedSourceIds.has(id));
      if (allSelected) {
        // Deselect only the filtered set
        const next = new Set(state.selectedSourceIds);
        for (const id of ids) next.delete(id);
        return { selectedSourceIds: next };
      }
      // Select the filtered set (additive)
      const next = new Set(state.selectedSourceIds);
      for (const id of ids) next.add(id);
      return { selectedSourceIds: next };
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
    const result = await window.electronAPI.addTaxonomyNode({ pov, category, label, description, interpretations, docId, conceptIndex }) as { success: boolean; nodeId: string; error?: string };
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

      // Invalidate embedding cache so next similar search reloads from file
      // (the new node's embedding will be available after Update-TaxEmbeddings)
      set({ embeddingCache: new Map() });
    }
    return result;
  },

  runSimilarSearch: async (concept: string, description: string) => {
    set({
      similarLoading: true, similarError: null, similarQuery: concept, similarQueryDescription: description, similarResults: null,
      // Clear potential edges if showing
      potentialEdgesQuery: null, potentialEdges: null, potentialEdgesError: null,
    });

    try {
      let cache = get().embeddingCache;

      // Load pre-computed embeddings from embeddings.json if cache is empty
      if (cache.size === 0) {
        const loaded = await window.electronAPI.loadEmbeddings();
        if (!loaded || Object.keys(loaded).length === 0) {
          set({ similarLoading: false, similarError: 'No embeddings found. Run Update-TaxEmbeddings to generate them.' });
          return;
        }
        cache = new Map<string, number[]>(Object.entries(loaded));
        set({ embeddingCache: cache });
      }

      // Compute query embedding via local Python (same model as embeddings.json)
      const queryText = `${concept}: ${description}`;
      const queryVector = await window.electronAPI.computeQueryEmbedding(queryText);

      // Rank results with low threshold (UI slider filters further)
      const results = rankBySimilarity(queryVector, cache, 0.4, 50);
      set({ similarResults: results, similarLoading: false });
    } catch (err) {
      set({ similarError: mapErrorToUserMessage(err), similarLoading: false });
    }
  },

  clearSimilarSearch: () => {
    set({ similarQuery: null, similarQueryDescription: null, similarResults: null, similarLoading: false, similarError: null });
  },

  setSimilarThreshold: (t: number) => {
    set({ similarThreshold: t });
  },

  runPotentialEdges: async (concept) => {
    set({
      potentialEdgesLoading: true,
      potentialEdgesError: null,
      potentialEdgesQuery: concept.label,
      potentialEdges: null,
      // Clear similar search if showing
      similarQuery: null, similarResults: null, similarError: null,
    });

    try {
      const taxonomy = get().taxonomy;
      const candidateNodes = Object.entries(taxonomy).map(([id, node]) => {
        const pov = id.startsWith('acc-') ? 'accelerationist'
          : id.startsWith('saf-') ? 'safetyist'
          : id.startsWith('skp-') ? 'skeptic'
          : 'cross-cutting';
        return { id, label: node.label, description: node.description, pov, category: node.category };
      });

      const systemPrompt = buildPotentialEdgesSystemPrompt();
      const userPrompt = buildPotentialEdgesUserPrompt(concept, candidateNodes);

      const rawText = await window.electronAPI.generateContent(systemPrompt, userPrompt, get().aiModel);
      // Strip markdown fences and trailing commas that Gemini sometimes emits
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .replace(/,\s*([}\]])/g, '$1');
      const parsed = JSON.parse(cleaned) as { edges: PotentialEdge[] };

      // Validate: filter to only edges referencing real nodes
      const validIds = new Set(Object.keys(taxonomy));
      const validEdges = (parsed.edges || []).filter(e => validIds.has(e.target) && e.confidence >= 0.5);
      // Sort by confidence descending
      validEdges.sort((a, b) => b.confidence - a.confidence);

      set({ potentialEdges: validEdges, potentialEdgesLoading: false });
    } catch (err) {
      set({ potentialEdgesError: mapErrorToUserMessage(err), potentialEdgesLoading: false });
    }
  },

  clearPotentialEdges: () => {
    set({ potentialEdgesQuery: null, potentialEdges: null, potentialEdgesLoading: false, potentialEdgesError: null });
  },
}));
