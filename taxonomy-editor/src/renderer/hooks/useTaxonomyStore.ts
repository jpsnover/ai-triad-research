// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import type {
  PovTaxonomyFile,
  CrossCuttingFile as SituationsFile,
  ConflictFile,
  PovNode,
  CrossCuttingNode as SituationNode,
  GraphAttributes,
  Edge,
  EdgesFile,
  TabId,
  Pov,
  Category,
  ConflictInstance,
  ConflictNote,
} from '../types/taxonomy';
import { interpretationText } from '../types/taxonomy';
import {
  povTaxonomyFileSchema,
  crossCuttingFileSchema as situationsFileSchema,
  conflictFileSchema,
  extractPovErrors,
  extractConflictErrors,
  ValidationErrors,
} from '../utils/validation';
import {
  generatePovNodeId,
  generateCrossCuttingId as generateSituationId,
  generateConflictId,
  todayISO,
} from '../utils/idGenerator';
import { rankBySimilarity } from '../utils/similarity';
import { mapErrorToUserMessage } from '../utils/errorMessages';
import { normalizeNodeProperties, validateTaxonomy, nodeTypeFromId } from '@lib/debate';
import type { ValidationResult } from '@lib/debate';
import { distinctionAnalysisPrompt, nodeCritiquePrompt } from '../prompts/analysis';
import type { NodeCritiqueContext } from '../prompts/analysis';
import { api } from '@bridge';

export type PinnedData =
  | { type: 'pov'; pov: Pov; node: PovNode }
  | { type: 'situations'; node: SituationNode }
  | { type: 'conflict'; conflict: ConflictFile };

export type SearchMode = 'raw' | 'wildcard' | 'regex' | 'semantic';

export type ColorScheme = 'light' | 'dark' | 'bkc' | 'system';

export type AIBackend = 'gemini' | 'claude' | 'groq' | 'openai';

export type GeminiModel =
  | 'gemini-3.1-flash-lite-preview'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'gemini-2.0-flash'
  | 'gemini-2.0-flash-lite'
  | 'gemini-1.5-flash'
  | 'gemini-1.5-pro';

export type ClaudeModel =
  | 'claude-sonnet-4-5'
  | 'claude-haiku-3.5';

export type GroqModel =
  | 'groq-llama-4-scout'
  | 'groq-llama-3.3-70b';

export type OpenAIModel =
  | 'openai-gpt-5.5'
  | 'openai-gpt-5.5-pro';

export type AIModel = GeminiModel | ClaudeModel | GroqModel | OpenAIModel;

export interface AIModelEntry { value: AIModel; label: string }

export const AI_BACKENDS: { value: AIBackend; label: string }[] = [
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'claude', label: 'Anthropic Claude' },
  { value: 'groq', label: 'Groq' },
  { value: 'openai', label: 'OpenAI' },
];

export const MODELS_BY_BACKEND: Record<AIBackend, AIModelEntry[]> = {
  gemini: [
    { value: 'gemini-3.1-flash-lite-preview', label: '3.1 Flash Lite Preview (recommended)' },
    { value: 'gemini-2.5-flash', label: '2.5 Flash' },
    { value: 'gemini-2.5-pro', label: '2.5 Pro' },
    { value: 'gemini-2.0-flash', label: '2.0 Flash' },
    { value: 'gemini-2.0-flash-lite', label: '2.0 Flash Lite (fastest)' },
    { value: 'gemini-1.5-flash', label: '1.5 Flash' },
    { value: 'gemini-1.5-pro', label: '1.5 Pro' },
  ],
  claude: [
    { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
    { value: 'claude-haiku-3.5', label: 'Haiku 3.5 (fastest)' },
  ],
  groq: [
    { value: 'groq-llama-4-scout', label: 'Llama 4 Scout' },
    { value: 'groq-llama-3.3-70b', label: 'Llama 3.3 70B' },
  ],
  openai: [
    { value: 'openai-gpt-5.5', label: 'GPT-5.5' },
    { value: 'openai-gpt-5.5-pro', label: 'GPT-5.5 Pro' },
  ],
};

/** @deprecated Use MODELS_BY_BACKEND.gemini instead */
export const GEMINI_MODELS = MODELS_BY_BACKEND.gemini;

const ALL_MODEL_IDS: Set<string> = new Set(
  Object.values(MODELS_BY_BACKEND).flat().map(m => m.value),
);

const DEFAULT_MODELS: Record<AIBackend, AIModel> = {
  gemini: 'gemini-3.1-flash-lite-preview',
  claude: 'claude-sonnet-4-5',
  groq: 'groq-llama-4-scout',
  openai: 'openai-gpt-5.5',
};

function getStoredBackend(): AIBackend {
  try {
    const stored = localStorage.getItem('taxonomy-editor-ai-backend');
    if (stored === 'gemini' || stored === 'claude' || stored === 'groq' || stored === 'openai') return stored;
  } catch { /* ignore */ }
  return 'gemini';
}

function getStoredModel(): AIModel {
  try {
    const stored = localStorage.getItem('taxonomy-editor-gemini-model');
    if (stored && ALL_MODEL_IDS.has(stored)) return stored as AIModel;
  } catch { /* ignore */ }
  const backend = getStoredBackend();
  return DEFAULT_MODELS[backend];
}

interface AIModelsConfig {
  backends: { id: string; label: string }[];
  models: { id: string; label: string; backend: string }[];
  defaults: Record<string, string>;
}

/** Load ai-models.json from main process and update the in-memory catalogs */
export async function initAIModels(): Promise<void> {
  try {
    const config = await api.loadAIModels() as AIModelsConfig | null;
    if (!config?.models?.length) return;

    // Rebuild backends
    AI_BACKENDS.length = 0;
    for (const b of config.backends) {
      AI_BACKENDS.push({ value: b.id as AIBackend, label: b.label });
    }

    // Rebuild models by backend
    for (const key of Object.keys(MODELS_BY_BACKEND) as AIBackend[]) {
      MODELS_BY_BACKEND[key] = [];
    }
    for (const m of config.models) {
      const backend = m.backend as AIBackend;
      if (!MODELS_BY_BACKEND[backend]) MODELS_BY_BACKEND[backend] = [];
      MODELS_BY_BACKEND[backend].push({ value: m.id as AIModel, label: m.label });
    }

    // Rebuild defaults
    for (const [k, v] of Object.entries(config.defaults)) {
      DEFAULT_MODELS[k as AIBackend] = v as AIModel;
    }

    // Rebuild lookup set
    ALL_MODEL_IDS.clear();
    for (const m of config.models) ALL_MODEL_IDS.add(m.id);

    console.log(`[AI Models] Loaded ${config.models.length} models from ai-models.json`);
  } catch (err) {
    console.warn('[AI Models] Failed to load ai-models.json, using built-in defaults:', err);
  }
}

export function backendForModel(model: string): AIBackend {
  if (model.startsWith('gemini')) return 'gemini';
  if (model.startsWith('claude')) return 'claude';
  if (model.startsWith('groq')) return 'groq';
  return 'gemini';
}

export interface AnalysisElement {
  label: string;
  description: string;
  category: string;
}

const ANALYSIS_CACHE_KEY = 'taxonomy-editor-analysis-cache';

interface AnalysisCacheEntry {
  elementA: AnalysisElement;
  elementB: AnalysisElement;
  model: string;
  result: string;
}

function buildAnalysisCacheId(
  a: AnalysisElement,
  b: AnalysisElement,
  model: string,
): string {
  return `${a.label}\0${a.description}\0${a.category}\0${b.label}\0${b.description}\0${b.category}\0${model}`;
}

function loadAnalysisCache(): Map<string, AnalysisCacheEntry> {
  try {
    const raw = localStorage.getItem(ANALYSIS_CACHE_KEY);
    if (!raw) return new Map();
    const arr: [string, AnalysisCacheEntry][] = JSON.parse(raw);
    return new Map(arr);
  } catch { return new Map(); }
}

function saveAnalysisCache(cache: Map<string, AnalysisCacheEntry>): void {
  try {
    // Keep at most 50 entries to avoid bloating localStorage
    const entries = [...cache.entries()];
    const trimmed = entries.slice(-50);
    localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(trimmed));
  } catch { /* ignore */ }
}

function getStoredTheme(): ColorScheme {
  try {
    const stored = localStorage.getItem('taxonomy-editor-theme');
    if (stored === 'light' || stored === 'dark' || stored === 'bkc' || stored === 'system') return stored;
  } catch { /* ignore */ }
  return 'light';
}

function applyTheme(scheme: ColorScheme) {
  const root = document.documentElement;
  if (scheme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', scheme);
  }
  try { localStorage.setItem('taxonomy-editor-theme', scheme); } catch { /* ignore */ }
}

export interface PolicyRegistryEntry {
  id: string;
  action: string;
  source_povs: string[];
  member_count: number;
}

interface TaxonomyState {
  accelerationist: PovTaxonomyFile | null;
  safetyist: PovTaxonomyFile | null;
  skeptic: PovTaxonomyFile | null;
  situations: SituationsFile | null;
  policyRegistry: PolicyRegistryEntry[] | null;
  conflicts: ConflictFile[];

  activeTab: TabId;
  selectedNodeId: string | null;
  dirty: Set<string>;
  validationErrors: ValidationErrors;
  saveError: string | null;
  loading: boolean;
  backgroundLoading: boolean;
  loadingProgress: { completed: string[]; total: number };

  pinnedStack: PinnedData[];
  pinAtDepth: (depth: number, data: PinnedData) => void;
  closePinnedFromDepth: (depth: number) => void;

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

  analysisResult: string | null;
  analysisLoading: boolean;
  analysisError: string | null;
  analysisStep: number;
  analysisRetry: { attempt: number; maxRetries: number; backoffSeconds: number; limitType: string; limitMessage: string } | null;
  analysisCached: boolean;
  analysisElementA: AnalysisElement | null;
  analysisElementB: AnalysisElement | null;
  runAnalyzeDistinction: (
    elementA: AnalysisElement,
    elementB: AnalysisElement,
    forceRefresh?: boolean,
  ) => Promise<void>;
  clearAnalysis: () => void;
  analysisTitle: string;
  analysisCritiquePov: Pov | null;
  analysisCritiqueNodeId: string | null;
  analysisCritiqueOriginalNode: PovNode | null;
  runNodeCritique: (pov: Pov, node: PovNode) => Promise<void>;

  clusterView: { clusters: { label: string; nodeIds: string[] }[]; misfits?: Set<string> } | null;
  clusterLoading: boolean;
  clusterError: string | null;
  runClusterView: (pov: Pov) => Promise<void>;
  clearClusterView: () => void;

  conflictClusters: { label: string; nodeIds: string[] }[] | null;
  conflictClusterLoading: boolean;
  conflictClusterError: string | null;
  runClusterConflicts: () => Promise<void>;
  clearConflictClusters: () => void;

  setActiveTab: (tab: TabId) => void;
  setSelectedNodeId: (id: string | null) => void;
  navigateToNode: (tab: TabId, id: string) => void;

  loadAll: () => Promise<void>;
  save: () => Promise<void>;
  dismissSaveError: () => void;

  updatePovNode: (pov: Pov, nodeId: string, updates: Partial<PovNode>) => void;
  createPovNode: (pov: Pov, category: Category) => string;
  deletePovNode: (pov: Pov, nodeId: string) => void;
  movePovNodeCategory: (pov: Pov, nodeId: string, newCategory: Category) => void;
  movePovNode: (sourcePov: Pov, nodeId: string, targetPov: Pov, targetCategory: Category) => void;

  updateSituationNode: (nodeId: string, updates: Partial<SituationNode>) => void;
  createSituationNode: () => string;
  deleteSituationNode: (nodeId: string) => void;

  updateConflict: (claimId: string, updates: Partial<ConflictFile>) => void;
  createConflict: (claimLabel: string) => string;
  deleteConflict: (claimId: string) => void;
  addConflictInstance: (claimId: string, instance: ConflictInstance) => void;
  removeConflictInstance: (claimId: string, index: number) => void;
  updateConflictInstance: (claimId: string, index: number, updates: Partial<ConflictInstance>) => void;
  addConflictNote: (claimId: string, note: ConflictNote) => void;
  removeConflictNote: (claimId: string, index: number) => void;
  updateConflictNote: (claimId: string, index: number, updates: Partial<ConflictNote>) => void;

  getAllNodeIds: () => string[];
  getAllConflictIds: () => string[];
  getLabelForId: (id: string) => string;
  getDescriptionForId: (id: string) => string;
  lookupPinnedData: (id: string) => PinnedData | null;

  aiBackend: AIBackend;
  setAIBackend: (backend: AIBackend) => void;
  geminiModel: AIModel;
  setGeminiModel: (model: AIModel) => void;

  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;

  paneSpacing: 'normal' | 'concise';
  setPaneSpacing: (spacing: 'normal' | 'concise') => void;

  /** QBAF visualization toggle (Q-10). Off by default until calibrated. */
  qbafEnabled: boolean;
  setQbafEnabled: (enabled: boolean) => void;

  zoomLevel: number;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;

  attributeFilter: { field: string; value: string; results: { id: string; label: string; pov: string }[] } | null;
  runAttributeFilter: (field: string, value: string) => void;
  clearAttributeFilter: () => void;

  attributeInfo: { field: string; value: string } | null;
  showAttributeInfo: (field: string, value: string) => void;
  clearAttributeInfo: () => void;

  edgesFile: EdgesFile | null;
  edgesLoading: boolean;
  relatedNodeId: string | null;
  selectedEdge: Edge | null;
  loadEdges: () => Promise<void>;
  showRelatedEdges: (nodeId: string | null) => void;
  selectEdge: (edge: Edge | null) => void;

  toolbarPanel: 'search' | 'related' | 'attrFilter' | 'attrInfo' | 'lineage' | 'prompts' | 'console' | 'fallacy' | 'edges' | 'policyAlignment' | 'policyDashboard' | 'vocabulary' | null;
  setToolbarPanel: (panel: 'search' | 'related' | 'attrFilter' | 'attrInfo' | 'lineage' | 'prompts' | 'console' | 'fallacy' | 'edges' | 'policyAlignment' | 'policyDashboard' | 'vocabulary' | null) => void;
  pendingLineageValue: string | null;
  navigateToLineage: (value: string) => void;
  pendingSearchRelatedId: string | null;
  navigateToSearchRelated: (nodeId: string) => void;
  previousView: { panel: 'search' | 'related' | 'attrFilter' | 'attrInfo' | 'lineage' | 'prompts' | 'console' | 'fallacy' | 'edges' | 'policyAlignment' | 'policyDashboard' | 'vocabulary' | null; nodeId: string | null } | null;
  navigateBack: () => void;
}

export const useTaxonomyStore = create<TaxonomyState>((set, get) => ({
  accelerationist: null,
  safetyist: null,
  skeptic: null,
  situations: null,
  policyRegistry: null,
  conflicts: [],

  activeTab: 'accelerationist',
  selectedNodeId: null,
  dirty: new Set(),
  validationErrors: {},
  saveError: null,
  loading: false,
  backgroundLoading: false,
  loadingProgress: { completed: [], total: 0 },

  pinnedStack: [],
  pinAtDepth: (depth, data) => set((state) => ({
    pinnedStack: [...state.pinnedStack.slice(0, depth), data],
  })),
  closePinnedFromDepth: (depth) => set((state) => ({
    pinnedStack: state.pinnedStack.slice(0, depth),
  })),

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

  analysisResult: null,
  analysisLoading: false,
  analysisError: null,
  analysisStep: 0,
  analysisRetry: null,
  analysisCached: false,
  analysisElementA: null,
  analysisElementB: null,
  analysisTitle: 'Analysis',
  analysisCritiquePov: null,
  analysisCritiqueNodeId: null,
  analysisCritiqueOriginalNode: null,

  clusterView: null,
  clusterLoading: false,
  clusterError: null,
  clearClusterView: () => set({ clusterView: null, clusterError: null }),

  conflictClusters: null,
  conflictClusterLoading: false,
  conflictClusterError: null,
  clearConflictClusters: () => set({ conflictClusters: null, conflictClusterError: null }),

  runClusterConflicts: async () => {
    const state = get();
    const conflicts = state.conflicts;
    if (!conflicts || conflicts.length === 0) return;

    set({ conflictClusterLoading: true, conflictClusterError: null });

    try {
      // Ensure embeddings are computed
      let cache = state.embeddingCache;
      if (state.embeddingDirty || cache.size === 0) {
        const { ids, texts } = state.buildEmbeddingTexts(new Set(), new Set());
        if (texts.length === 0) {
          set({ conflictClusterLoading: false, conflictClusterError: 'No embeddings available' });
          return;
        }
        const { vectors } = await api.computeEmbeddings(texts, ids);
        cache = new Map();
        for (let i = 0; i < ids.length; i++) {
          cache.set(ids[i], vectors[i]);
        }
        set({ embeddingCache: cache, embeddingDirty: false });
      }

      const { clusterByEmbedding, buildClusterLabelPrompt } = await import('../utils/clustering');

      const nodeIds = conflicts.map(c => c.claim_id);
      // More clusters for the large conflict set, lower similarity threshold
      const maxClusters = Math.max(8, Math.min(15, Math.ceil(conflicts.length / 50)));
      const rawClusters = clusterByEmbedding(nodeIds, cache, maxClusters, 0.45);

      if (rawClusters.length === 0) {
        set({ conflictClusterLoading: false, conflictClusterError: 'Could not form clusters' });
        return;
      }

      // Build label lookup
      const labelMap = new Map(conflicts.map(c => [c.claim_id, c.claim_label]));
      const multiRawClusters = rawClusters.filter(ids => ids.length > 1);
      const clustersForPrompt = multiRawClusters.map(ids => ({
        nodeIds: ids,
        labels: ids.map(id => labelMap.get(id) || id),
      }));

      let labels: string[];
      if (clustersForPrompt.length > 0) {
        const prompt = buildClusterLabelPrompt(clustersForPrompt);
        const { text } = await api.generateText(prompt);
        try {
          const cleaned = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
          labels = JSON.parse(cleaned);
        } catch {
          labels = multiRawClusters.map((_, i) => `Cluster ${i + 1}`);
        }
      } else {
        labels = [];
      }

      // Map labels back
      const multiClusters: { label: string; nodeIds: string[] }[] = [];
      const singletonIds: string[] = [];
      let multiIdx = 0;

      for (const ids of rawClusters) {
        if (ids.length > 1) {
          multiClusters.push({
            label: labels[multiIdx] || `Cluster ${multiIdx + 1}`,
            nodeIds: ids,
          });
          multiIdx++;
        } else {
          singletonIds.push(...ids);
        }
      }

      // Sort clusters alphabetically by label
      multiClusters.sort((a, b) => a.label.localeCompare(b.label));

      // Sort items within each cluster alphabetically by label
      for (const cluster of multiClusters) {
        cluster.nodeIds.sort((a, b) => (labelMap.get(a) || '').localeCompare(labelMap.get(b) || ''));
      }

      // Append "Other" bucket for singletons
      if (singletonIds.length > 0) {
        singletonIds.sort((a, b) => (labelMap.get(a) || '').localeCompare(labelMap.get(b) || ''));
        multiClusters.push({ label: 'Other', nodeIds: singletonIds });
      }

      set({ conflictClusters: multiClusters, conflictClusterLoading: false });
    } catch (err) {
      set({ conflictClusterLoading: false, conflictClusterError: mapErrorToUserMessage(err) });
    }
  },

  runClusterView: async (pov) => {
    const state = get();
    const file = state[pov];
    if (!file) return;

    set({ clusterLoading: true, clusterError: null });

    try {
      // Ensure embeddings are computed
      let cache = state.embeddingCache;
      if (state.embeddingDirty || cache.size === 0) {
        const { ids, texts } = state.buildEmbeddingTexts(new Set(), new Set());
        if (texts.length === 0) {
          set({ clusterLoading: false, clusterError: 'No embeddings available' });
          return;
        }
        const { vectors } = await api.computeEmbeddings(texts, ids);
        cache = new Map();
        for (let i = 0; i < ids.length; i++) {
          cache.set(ids[i], vectors[i]);
        }
        set({ embeddingCache: cache, embeddingDirty: false });
      }

      const { clusterByEmbedding, buildClusterLabelPrompt } = await import('../utils/clustering');

      const nodeIds = file.nodes.map(n => n.id);
      const rawClusters = clusterByEmbedding(nodeIds, cache, 6, 0.55);

      if (rawClusters.length === 0) {
        set({ clusterLoading: false, clusterError: 'Could not form clusters' });
        return;
      }

      // Build label lookup — only label multi-node clusters (singletons go to "Other")
      const labelMap = new Map(file.nodes.map(n => [n.id, n.label]));
      const multiRawClusters = rawClusters.filter(ids => ids.length > 1);
      const clustersForPrompt = multiRawClusters.map(ids => ({
        nodeIds: ids,
        labels: ids.map(id => labelMap.get(id) || id),
      }));

      let labels: string[];
      if (clustersForPrompt.length > 0) {
        const prompt = buildClusterLabelPrompt(clustersForPrompt);
        const { text } = await api.generateText(prompt);
        try {
          const cleaned = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
          labels = JSON.parse(cleaned);
        } catch {
          labels = multiRawClusters.map((_, i) => `Cluster ${i + 1}`);
        }
      } else {
        labels = [];
      }

      // Map labels back to full rawClusters array (singletons get no label — handled below)
      const fullLabels: string[] = [];
      let multiIdx = 0;
      for (const ids of rawClusters) {
        if (ids.length > 1) {
          fullLabels.push(labels[multiIdx] || `Cluster ${multiIdx + 1}`);
          multiIdx++;
        } else {
          fullLabels.push('');
        }
      }

      // Separate multi-node clusters from singletons
      const multiClusters: { label: string; nodeIds: string[] }[] = [];
      const singletonIds: string[] = [];

      for (let i = 0; i < rawClusters.length; i++) {
        if (rawClusters[i].length === 1) {
          singletonIds.push(...rawClusters[i]);
        } else {
          multiClusters.push({
            label: fullLabels[i] || `Cluster ${i + 1}`,
            nodeIds: rawClusters[i],
          });
        }
      }

      // NLI misfit detection — flag nodes that contradict most of their
      // cluster-mates, which may indicate wrong-POV placement.
      const misfits = new Set<string>();
      try {
        const descMap = new Map(file.nodes.map(n => [n.id, n.description || n.label]));

        // Build all pairs for clusters with 3+ nodes (2-node clusters can't have a misfit)
        const nliPairs: Array<{ text_a: string; text_b: string; clusterIdx: number; idA: string; idB: string }> = [];
        for (let ci = 0; ci < multiClusters.length; ci++) {
          const ids = multiClusters[ci].nodeIds;
          if (ids.length < 3) continue;
          for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
              nliPairs.push({
                text_a: descMap.get(ids[i]) || ids[i],
                text_b: descMap.get(ids[j]) || ids[j],
                clusterIdx: ci,
                idA: ids[i],
                idB: ids[j],
              });
            }
          }
        }

        if (nliPairs.length > 0) {
          const { results } = await api.nliClassify(nliPairs);

          // Per-node contradiction counts within each cluster
          // nodeId → { agrees: number, contradicts: number }
          const nodeCounts = new Map<string, { agrees: number; contradicts: number }>();

          for (let k = 0; k < results.length; k++) {
            const { idA, idB } = nliPairs[k];
            const label = results[k].nli_label;
            for (const id of [idA, idB]) {
              if (!nodeCounts.has(id)) nodeCounts.set(id, { agrees: 0, contradicts: 0 });
            }
            if (label === 'contradiction') {
              nodeCounts.get(idA)!.contradicts++;
              nodeCounts.get(idB)!.contradicts++;
            } else {
              nodeCounts.get(idA)!.agrees++;
              nodeCounts.get(idB)!.agrees++;
            }
          }

          // Flag nodes where contradictions outnumber agreements — but only
          // if they're true outliers. If most nodes in the cluster have high
          // contradiction ratios, the NLI signal is noise (same-POV nodes
          // discussing different topics), not a real misfit.
          const candidateMisfits: string[] = [];
          for (const [nodeId, counts] of nodeCounts) {
            if (counts.contradicts > counts.agrees) {
              candidateMisfits.push(nodeId);
            }
          }
          // Only flag if fewer than half the cluster's nodes are candidates
          // — if most/all nodes are "misfits", none of them really are
          for (let ci = 0; ci < multiClusters.length; ci++) {
            const clusterIds = new Set(multiClusters[ci].nodeIds);
            const clusterCandidates = candidateMisfits.filter(id => clusterIds.has(id));
            if (clusterCandidates.length > 0 && clusterCandidates.length < clusterIds.size / 2) {
              for (const id of clusterCandidates) misfits.add(id);
            }
          }

          if (misfits.size > 0) {
            console.log(`[clusterView] NLI flagged ${misfits.size} potential misfit nodes:`,
              [...misfits].join(', '));
          }
        }
      } catch (nliErr) {
        console.warn('[clusterView] NLI misfit detection failed, continuing without:', nliErr);
      }

      // Sort clusters by size descending
      multiClusters.sort((a, b) => b.nodeIds.length - a.nodeIds.length);

      // Append "Other" bucket for singletons
      if (singletonIds.length > 0) {
        multiClusters.push({ label: 'Other', nodeIds: singletonIds });
      }

      set({ clusterView: { clusters: multiClusters, misfits: misfits.size > 0 ? misfits : undefined }, clusterLoading: false });
    } catch (err) {
      set({ clusterLoading: false, clusterError: mapErrorToUserMessage(err) });
    }
  },

  runAnalyzeDistinction: async (elementA, elementB, forceRefresh) => {
    const model = get().geminiModel;

    // Check cache unless force-refreshing
    if (!forceRefresh) {
      const cache = loadAnalysisCache();
      const cacheId = buildAnalysisCacheId(elementA, elementB, model);
      const cached = cache.get(cacheId);
      if (cached) {
        set({
          analysisResult: cached.result,
          analysisLoading: false,
          analysisError: null,
          analysisStep: 0,
          analysisRetry: null,
          analysisCached: true,
          analysisElementA: elementA,
          analysisElementB: elementB,
        });
        return;
      }
    }

    // Step 1: Preparing elements
    set({
      analysisLoading: true,
      analysisError: null,
      analysisResult: null,
      analysisStep: 1,
      analysisRetry: null,
      analysisCached: false,
      analysisElementA: elementA,
      analysisElementB: elementB,
    });

    // Step 2: Building audit prompt
    set({ analysisStep: 2 });

    const prompt = distinctionAnalysisPrompt(elementA, elementB);

    const unsubscribe = api.onGenerateTextProgress((progress) => {
      set({ analysisRetry: progress });
    });

    try {
      // Step 3: Sending to Gemini AI
      set({ analysisStep: 3 });
      const { text } = await api.generateText(prompt, model);

      // Step 4: Processing response
      set({ analysisStep: 4, analysisRetry: null });

      // Save to cache
      const cache = loadAnalysisCache();
      const cacheId = buildAnalysisCacheId(elementA, elementB, model);
      cache.set(cacheId, { elementA, elementB, model, result: text });
      saveAnalysisCache(cache);

      set({ analysisResult: text, analysisLoading: false, analysisStep: 0, analysisCached: false });
    } catch (err) {
      set({ analysisLoading: false, analysisError: mapErrorToUserMessage(err), analysisStep: 0, analysisRetry: null });
    } finally {
      unsubscribe();
    }
  },

  clearAnalysis: () => set({
    analysisResult: null,
    analysisError: null,
    analysisLoading: false,
    analysisStep: 0,
    analysisRetry: null,
    analysisCached: false,
    analysisElementA: null,
    analysisElementB: null,
    analysisTitle: 'Analysis',
    analysisCritiquePov: null,
    analysisCritiqueNodeId: null,
    analysisCritiqueOriginalNode: null,
  }),

  runNodeCritique: async (pov, node) => {
    const model = get().geminiModel;
    const state = get();
    const POV_LABELS: Record<string, string> = {
      accelerationist: 'Accelerationist',
      safetyist: 'Safetyist',
      skeptic: 'Skeptic',
    };

    set({
      analysisLoading: true,
      analysisError: null,
      analysisResult: null,
      analysisStep: 1,
      analysisRetry: null,
      analysisCached: false,
      analysisElementA: { label: node.label, description: node.description, category: node.category },
      analysisElementB: null,
      analysisTitle: 'AI Analysis',
      analysisCritiquePov: pov,
      analysisCritiqueNodeId: node.id,
      analysisCritiqueOriginalNode: { ...node },
    });

    // Step 2: Build prompt with full context
    set({ analysisStep: 2 });

    // PQ-8: Pre-filter context to target node's neighborhood
    const nodeId = node.id;
    const neighborIds = new Set<string>();
    neighborIds.add(nodeId);
    if (node.parent_id) neighborIds.add(node.parent_id);
    for (const childId of node.children) neighborIds.add(childId);
    for (const sitRef of node.situation_refs) neighborIds.add(sitRef);

    // Edges: only those involving this node or its direct neighbors
    const relevantEdges = state.edgesFile?.edges.filter(
      e => neighborIds.has(e.source) || neighborIds.has(e.target)
    ) ?? [];
    const edgesJson = relevantEdges.length > 0
      ? JSON.stringify(relevantEdges.map(e => ({
          source: e.source, target: e.target, type: e.type,
          confidence: e.confidence, rationale: e.rationale,
        })), null, 2)
      : '(no edges involving this node)';

    // Situations: only those referenced by this node
    const situationsJson = state.situations
      ? JSON.stringify(state.situations.nodes
          .filter(n => node.situation_refs.includes(n.id))
          .map(n => ({
            id: n.id, label: n.label, description: n.description,
          })), null, 2)
      : '(situations not loaded)';

    // POV hierarchy: parent, siblings, children — not the entire file
    const povFile = state[pov];
    const hierarchyIds = new Set(neighborIds);
    if (povFile) {
      // Add siblings (nodes sharing the same parent)
      if (node.parent_id) {
        for (const n of povFile.nodes) {
          if (n.parent_id === node.parent_id) hierarchyIds.add(n.id);
        }
      }
    }
    const povJson = povFile
      ? JSON.stringify(povFile.nodes
          .filter(n => hierarchyIds.has(n.id))
          .map(n => ({
            id: n.id, label: n.label, category: n.category, parent_id: n.parent_id,
          })), null, 2)
      : '(POV file not loaded)';

    // Policies: only those referenced by this node's policy_actions
    const nodePolIds = new Set((node.graph_attributes?.policy_actions ?? []).map(pa => pa.policy_id).filter(Boolean));
    // Also include policies from relevant edges
    for (const e of relevantEdges) {
      if (e.source.startsWith('pol-')) nodePolIds.add(e.source);
      if (e.target.startsWith('pol-')) nodePolIds.add(e.target);
    }
    const policyRegistryJson = state.policyRegistry
      ? JSON.stringify(state.policyRegistry
          .filter(p => nodePolIds.has(p.id) || nodePolIds.size === 0)
          .map(p => ({
            id: p.id, action: p.action, source_povs: p.source_povs,
          })), null, 2)
      : '(policy registry not loaded)';

    const nodeJson = JSON.stringify(node, null, 2);

    const prompt = nodeCritiquePrompt({
      edgesJson,
      crossCuttingJson: situationsJson,
      povJson,
      nodeJson,
      povName: POV_LABELS[pov] || pov,
      policyRegistryJson,
    });

    const unsubscribe = api.onGenerateTextProgress((progress) => {
      set({ analysisRetry: progress });
    });

    try {
      set({ analysisStep: 3 });
      const { text } = await api.generateText(prompt, model);
      set({ analysisStep: 4, analysisRetry: null });
      set({ analysisResult: text, analysisLoading: false, analysisStep: 0 });
    } catch (err) {
      set({ analysisLoading: false, analysisError: mapErrorToUserMessage(err), analysisStep: 0, analysisRetry: null });
    } finally {
      unsubscribe();
    }
  },

  checkApiKey: async () => {
    try {
      const has = await api.hasApiKey();
      set({ hasApiKey: has });
    } catch {
      set({ hasApiKey: false });
    }
  },

  buildEmbeddingTexts: (povScopes, aspectScopes) => {
    const state = get();
    const hasPovFilter = povScopes.size > 0;
    const hasAspectFilter = aspectScopes.size > 0;
    const ids: string[] = [];
    const texts: string[] = [];

    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
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
      console.error('[semantic-search] Error during semantic search for query "' + query + '":', err);
      const detail = mapErrorToUserMessage(err);
      set({
        semanticResults: [],
        embeddingLoading: false,
        embeddingError: `Semantic search failed while computing embeddings for "${query}". ${detail}`,
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

      // Rebuild cache if dirty (no scope filters — search all elements)
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
      // Use a low threshold (0.3) to get many results; the slider filters in UI
      const results = rankBySimilarity(vector, cache, 0.3, 200);
      // Exclude the source node itself
      const filtered = results.filter(r => r.id !== nodeId);
      set({ similarResults: filtered, similarLoading: false, similarStep: null });
    } catch (err) {
      set({ similarLoading: false, similarStep: null, similarError: mapErrorToUserMessage(err) });
    }
  },

  setActiveTab: (tab) => set({ activeTab: tab, selectedNodeId: null, validationErrors: {} }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id, validationErrors: {} }),
  navigateToNode: (tab, id) => set({ activeTab: tab, selectedNodeId: id, validationErrors: {} }),

  loadAll: async () => {
    const steps = [
      'Accelerationist', 'Safetyist', 'Skeptic', 'Situations',
      'Conflicts', 'Policy Registry', 'Conflict Clusters',
    ];
    set({ loading: true, backgroundLoading: false, loadingProgress: { completed: [], total: steps.length } });

    const track = <T,>(label: string, promise: Promise<T>): Promise<T> =>
      promise.then((result) => {
        set((s) => ({
          loadingProgress: {
            ...s.loadingProgress,
            completed: [...s.loadingProgress.completed, label],
          },
        }));
        return result;
      });

    try {
      // Phase 1: Load accelerationist first so the GUI can display immediately
      const acc = await track(steps[0], api.loadTaxonomyFile('accelerationist'));
      const accFile = acc as PovTaxonomyFile;
      if (accFile?.nodes) {
        for (const node of accFile.nodes) {
          normalizeNodeProperties(node as unknown as Record<string, unknown>);
        }
      }
      set({
        accelerationist: accFile,
        loading: false,
        backgroundLoading: true,
        dirty: new Set(),
        embeddingCache: new Map(),
        embeddingDirty: true,
      });

      // Phase 2: Load remaining POVs and data files in the background
      const [saf, skp, cc, conflicts, polReg, conflictClusterData] = await Promise.all([
        track(steps[1], api.loadTaxonomyFile('safetyist')),
        track(steps[2], api.loadTaxonomyFile('skeptic')),
        track(steps[3], api.loadTaxonomyFile('situations')),
        track(steps[4], api.loadConflictFiles()),
        track(steps[5], api.loadPolicyRegistry()),
        track(steps[6], api.loadConflictClusters().catch(() => null)),
      ]);
      const regData = polReg as { policies: PolicyRegistryEntry[] } | null;
      for (const povFile of [saf, skp] as PovTaxonomyFile[]) {
        if (povFile?.nodes) {
          for (const node of povFile.nodes) {
            normalizeNodeProperties(node as unknown as Record<string, unknown>);
          }
        }
      }
      const precomputedClusters = conflictClusterData &&
        typeof conflictClusterData === 'object' &&
        Array.isArray((conflictClusterData as { clusters: unknown }).clusters)
        ? (conflictClusterData as { clusters: { label: string; nodeIds: string[] }[] }).clusters
        : null;

      set({
        safetyist: saf as PovTaxonomyFile,
        skeptic: skp as PovTaxonomyFile,
        situations: cc as SituationsFile,
        policyRegistry: regData?.policies ?? null,
        conflicts: conflicts as ConflictFile[],
        conflictClusters: precomputedClusters,
        backgroundLoading: false,
        embeddingDirty: true,
      });
    } catch (err) {
      set({ loading: false, backgroundLoading: false, saveError: mapErrorToUserMessage(err) });
    }
  },

  dismissSaveError: () => set({ saveError: null }),

  save: async () => {
    const state = get();
    const errors: ValidationErrors = {};
    const dirtyKeys = state.dirty;

    if (dirtyKeys.size === 0) return;

    for (const key of dirtyKeys) {
      if (key === 'accelerationist' || key === 'safetyist' || key === 'skeptic') {
        const file = state[key];
        if (!file) continue;
        const result = povTaxonomyFileSchema.safeParse(file);
        if (!result.success) {
          Object.assign(errors, extractPovErrors(result.error, file.nodes));
        }
      } else if (key === 'situations') {
        const file = state.situations;
        if (!file) continue;
        const result = situationsFileSchema.safeParse(file);
        if (!result.success) {
          Object.assign(errors, extractPovErrors(result.error, file.nodes));
        }
      } else if (key.startsWith('conflict-')) {
        const conflict = state.conflicts.find(c => c.claim_id === key);
        if (!conflict) continue;
        const result = conflictFileSchema.safeParse(conflict);
        if (!result.success) {
          Object.assign(errors, extractConflictErrors(result.error, key));
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      set({ validationErrors: errors, saveError: 'Validation failed. Fix errors before saving.' });
      return;
    }

    // Referential integrity + edge domain/range + BDI consistency checks
    if (state.accelerationist && state.safetyist && state.skeptic && state.situations) {
      const taxData = {
        accelerationist: { nodes: state.accelerationist.nodes },
        safetyist: { nodes: state.safetyist.nodes },
        skeptic: { nodes: state.skeptic.nodes },
        situations: { nodes: state.situations.nodes },
        edges: state.edgesFile?.edges ?? [],
      };
      const integrity: ValidationResult = validateTaxonomy(taxData);
      const integrityErrors = integrity.issues.filter(i => i.severity === 'error');
      if (integrityErrors.length > 0) {
        const errorSummary = integrityErrors
          .slice(0, 5)
          .map(i => `[${i.code}] ${i.entityId}: ${i.message} — Fix: ${i.fix}`)
          .join('\n');
        set({
          validationErrors: errors,
          saveError: `Integrity check failed (${integrityErrors.length} error${integrityErrors.length > 1 ? 's' : ''}):\n${errorSummary}`,
        });
        return;
      }
      // Warnings are logged but don't block save
      const integrityWarnings = integrity.issues.filter(i => i.severity === 'warning');
      if (integrityWarnings.length > 0) {
        console.warn(`[save] ${integrityWarnings.length} integrity warning(s):`,
          integrityWarnings.map(i => `${i.code}: ${i.entityId} — ${i.message}`));
      }
    }

    set({ saveError: null, validationErrors: {} });

    try {
      const promises: Promise<void>[] = [];

      for (const key of dirtyKeys) {
        if (key === 'accelerationist' || key === 'safetyist' || key === 'skeptic') {
          const file = state[key];
          if (file) {
            promises.push(api.saveTaxonomyFile(key, file));
          }
        } else if (key === 'situations') {
          const file = state.situations;
          if (file) {
            promises.push(api.saveTaxonomyFile('situations', file));
          }
        } else if (key.startsWith('conflict-')) {
          const conflict = state.conflicts.find(c => c.claim_id === key);
          if (conflict) {
            promises.push(api.saveConflictFile(key, conflict));
          }
        }
      }

      await Promise.all(promises);
      set({ dirty: new Set() });

      // Fire-and-forget: re-embed changed nodes and update embeddings.json
      const nodesToEmbed: { id: string; text: string; pov: string }[] = [];
      for (const key of dirtyKeys) {
        if (key === 'accelerationist' || key === 'safetyist' || key === 'skeptic') {
          const file = state[key];
          if (file) {
            for (const node of file.nodes) {
              nodesToEmbed.push({ id: node.id, text: node.description, pov: key });
            }
          }
        } else if (key === 'situations') {
          const file = state.situations;
          if (file) {
            for (const node of file.nodes) {
              nodesToEmbed.push({
                id: node.id,
                text: `[situations]\nID: ${node.id}\nLabel: ${node.label}\nDescription: ${node.description}\nAccelerationist interpretation: ${interpretationText(node.interpretations.accelerationist)}\nSafetyist interpretation: ${interpretationText(node.interpretations.safetyist)}\nSkeptic interpretation: ${interpretationText(node.interpretations.skeptic)}`,
                pov: 'situations',
              });
            }
          }
        }
        // Conflicts are not included in embeddings.json (separate system)
      }
      if (nodesToEmbed.length > 0) {
        api.updateNodeEmbeddings(nodesToEmbed).catch((err) => {
          console.warn('[save] Failed to update embeddings:', err);
        });
      }
    } catch (err) {
      set({ saveError: `Save failed: ${mapErrorToUserMessage(err)}` });
    }
  },

  updatePovNode: (pov, nodeId, updates) => {
    set((state) => {
      const file = state[pov];
      if (!file) return state;
      const newNodes = file.nodes.map(n =>
        n.id === nodeId ? { ...n, ...updates } : n,
      );
      const newFile: PovTaxonomyFile = {
        ...file,
        last_modified: todayISO(),
        nodes: newNodes,
      };
      const newDirty = new Set(state.dirty);
      newDirty.add(pov);
      return { [pov]: newFile, dirty: newDirty, embeddingDirty: true };
    });
  },

  createPovNode: (pov, category) => {
    const state = get();
    const file = state[pov];
    if (!file) return '';
    const existingIds = file.nodes.map(n => n.id);
    const newId = generatePovNodeId(pov, category, existingIds);
    const newNode: PovNode = {
      id: newId,
      category,
      label: '',
      description: '',
      parent_id: null,
      children: [],
      situation_refs: [],
    };
    const newFile: PovTaxonomyFile = {
      ...file,
      last_modified: todayISO(),
      nodes: [...file.nodes, newNode],
    };
    const newDirty = new Set(state.dirty);
    newDirty.add(pov);
    set({ [pov]: newFile, dirty: newDirty, selectedNodeId: newId, embeddingDirty: true });
    return newId;
  },

  deletePovNode: (pov, nodeId) => {
    set((state) => {
      const file = state[pov];
      if (!file) return state;
      const newNodes = file.nodes.filter(n => n.id !== nodeId);
      const newFile: PovTaxonomyFile = {
        ...file,
        last_modified: todayISO(),
        nodes: newNodes,
      };
      const newDirty = new Set(state.dirty);
      newDirty.add(pov);
      return {
        [pov]: newFile,
        dirty: newDirty,
        embeddingDirty: true,
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      };
    });
  },

  movePovNodeCategory: (pov, nodeId, newCategory) => {
    set((state) => {
      const file = state[pov];
      if (!file) return state;
      const oldNode = file.nodes.find(n => n.id === nodeId);
      if (!oldNode) return state;

      const oldId = oldNode.id;
      const existingIds = file.nodes.map(n => n.id);
      const newId = generatePovNodeId(pov, newCategory, existingIds);

      // Create new node with new ID and category, copy everything else
      const newNode: PovNode = {
        ...oldNode,
        id: newId,
        category: newCategory,
      };

      // Replace old node with new node in the POV file
      const replaceId = (id: string) => (id === oldId ? newId : id);
      const newNodes = file.nodes.map(n => {
        if (n.id === oldId) return newNode;
        // Update parent_id and children refs in same-POV nodes
        let changed = false;
        let updatedParent = n.parent_id;
        let updatedChildren = n.children;
        if (n.parent_id === oldId) {
          updatedParent = newId;
          changed = true;
        }
        if (n.children.includes(oldId)) {
          updatedChildren = n.children.map(replaceId);
          changed = true;
        }
        return changed ? { ...n, parent_id: updatedParent, children: updatedChildren } : n;
      });
      const newFile: PovTaxonomyFile = {
        ...file,
        last_modified: todayISO(),
        nodes: newNodes,
      };

      const newDirty = new Set(state.dirty);
      newDirty.add(pov);

      // Update situations linked_nodes
      let newSituations = state.situations;
      if (newSituations) {
        let ccChanged = false;
        const ccNodes = newSituations.nodes.map(n => {
          if (n.linked_nodes.includes(oldId)) {
            ccChanged = true;
            return { ...n, linked_nodes: n.linked_nodes.map(replaceId) };
          }
          return n;
        });
        if (ccChanged) {
          newSituations = { ...newSituations, last_modified: todayISO(), nodes: ccNodes };
          newDirty.add('situations');
        }
      }

      // Update conflicts linked_taxonomy_nodes
      let newConflicts = state.conflicts;
      let conflictsChanged = false;
      newConflicts = newConflicts.map(c => {
        if (c.linked_taxonomy_nodes.includes(oldId)) {
          conflictsChanged = true;
          newDirty.add(c.claim_id);
          return { ...c, linked_taxonomy_nodes: c.linked_taxonomy_nodes.map(replaceId) };
        }
        return c;
      });

      return {
        [pov]: newFile,
        situations: newSituations,
        conflicts: conflictsChanged ? newConflicts : state.conflicts,
        dirty: newDirty,
        selectedNodeId: newId,
        embeddingDirty: true,
      };
    });
  },

  movePovNode: (sourcePov, nodeId, targetPov, targetCategory) => {
    // Same-POV move delegates to existing function
    if (sourcePov === targetPov) {
      get().movePovNodeCategory(sourcePov, nodeId, targetCategory);
      return;
    }

    set((state) => {
      const sourceFile = state[sourcePov];
      const targetFile = state[targetPov];
      if (!sourceFile || !targetFile) return state;

      const oldNode = sourceFile.nodes.find(n => n.id === nodeId);
      if (!oldNode) return state;

      const oldId = oldNode.id;
      const targetExistingIds = targetFile.nodes.map(n => n.id);
      const newId = generatePovNodeId(targetPov, targetCategory, targetExistingIds);

      // Create new node in target POV — reset parent/children since they don't cross POVs
      const newNode: PovNode = {
        ...oldNode,
        id: newId,
        category: targetCategory,
        parent_id: null,
        children: [],
      };

      // Remove from source — fix orphaned children (clear their parent_id)
      const newSourceNodes = sourceFile.nodes
        .filter(n => n.id !== oldId)
        .map(n => {
          if (n.parent_id === oldId) return { ...n, parent_id: null };
          if (n.children.includes(oldId)) return { ...n, children: n.children.filter(c => c !== oldId) };
          return n;
        });

      // Add to target
      const newTargetNodes = [...targetFile.nodes, newNode];

      const replaceId = (id: string) => (id === oldId ? newId : id);
      const newDirty = new Set(state.dirty);
      newDirty.add(sourcePov);
      newDirty.add(targetPov);

      // Update situations linked_nodes
      let newSituations = state.situations;
      if (newSituations) {
        let ccChanged = false;
        const ccNodes = newSituations.nodes.map(n => {
          if (n.linked_nodes.includes(oldId)) {
            ccChanged = true;
            return { ...n, linked_nodes: n.linked_nodes.map(replaceId) };
          }
          return n;
        });
        if (ccChanged) {
          newSituations = { ...newSituations, last_modified: todayISO(), nodes: ccNodes };
          newDirty.add('situations');
        }
      }

      // Update conflicts linked_taxonomy_nodes
      let newConflicts = state.conflicts;
      let conflictsChanged = false;
      newConflicts = newConflicts.map(c => {
        if (c.linked_taxonomy_nodes.includes(oldId)) {
          conflictsChanged = true;
          newDirty.add(c.claim_id);
          return { ...c, linked_taxonomy_nodes: c.linked_taxonomy_nodes.map(replaceId) };
        }
        return c;
      });

      // Update edges source/target
      let newEdgesFile = state.edgesFile;
      if (newEdgesFile) {
        let edgesChanged = false;
        const newEdges = newEdgesFile.edges.map(e => {
          const srcMatch = e.source === oldId;
          const tgtMatch = e.target === oldId;
          if (srcMatch || tgtMatch) {
            edgesChanged = true;
            return {
              ...e,
              source: srcMatch ? newId : e.source,
              target: tgtMatch ? newId : e.target,
            };
          }
          return e;
        });
        if (edgesChanged) {
          newEdgesFile = { ...newEdgesFile, edges: newEdges };
          newDirty.add('edges');
        }
      }

      // Update situation_refs on POV nodes that referenced old node via cc links
      // (POV nodes reference CC nodes, not other POV nodes, so no update needed there)

      return {
        [sourcePov]: { ...sourceFile, last_modified: todayISO(), nodes: newSourceNodes },
        [targetPov]: { ...targetFile, last_modified: todayISO(), nodes: newTargetNodes },
        situations: newSituations,
        conflicts: conflictsChanged ? newConflicts : state.conflicts,
        edgesFile: newEdgesFile,
        dirty: newDirty,
        selectedNodeId: newId,
        embeddingDirty: true,
      };
    });
  },

  updateSituationNode: (nodeId, updates) => {
    set((state) => {
      const file = state.situations;
      if (!file) return state;
      const newNodes = file.nodes.map(n =>
        n.id === nodeId ? { ...n, ...updates } : n,
      );
      const newFile: SituationsFile = {
        ...file,
        last_modified: todayISO(),
        nodes: newNodes,
      };
      const newDirty = new Set(state.dirty);
      newDirty.add('situations');
      return { situations: newFile, dirty: newDirty, embeddingDirty: true };
    });
  },

  createSituationNode: () => {
    const state = get();
    const file = state.situations;
    if (!file) return '';
    const existingIds = file.nodes.map(n => n.id);
    const newId = generateSituationId(existingIds);
    const newNode: SituationNode = {
      id: newId,
      label: '',
      description: '',
      interpretations: { accelerationist: '', safetyist: '', skeptic: '' },
      linked_nodes: [],
      conflict_ids: [],
    };
    const newFile: SituationsFile = {
      ...file,
      last_modified: todayISO(),
      nodes: [...file.nodes, newNode],
    };
    const newDirty = new Set(state.dirty);
    newDirty.add('situations');
    set({ situations: newFile, dirty: newDirty, selectedNodeId: newId, embeddingDirty: true });
    return newId;
  },

  deleteSituationNode: (nodeId) => {
    set((state) => {
      const file = state.situations;
      if (!file) return state;
      const newNodes = file.nodes.filter(n => n.id !== nodeId);
      const newFile: SituationsFile = {
        ...file,
        last_modified: todayISO(),
        nodes: newNodes,
      };
      const newDirty = new Set(state.dirty);
      newDirty.add('situations');
      return {
        situations: newFile,
        dirty: newDirty,
        embeddingDirty: true,
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      };
    });
  },

  updateConflict: (claimId, updates) => {
    set((state) => {
      const newConflicts = state.conflicts.map(c =>
        c.claim_id === claimId ? { ...c, ...updates } : c,
      );
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return { conflicts: newConflicts, dirty: newDirty, embeddingDirty: true };
    });
  },

  createConflict: (claimLabel) => {
    const state = get();
    const existingIds = state.conflicts.map(c => c.claim_id);
    const newId = generateConflictId(claimLabel, existingIds);
    const newConflict: ConflictFile = {
      claim_id: newId,
      claim_label: claimLabel,
      description: '',
      status: 'open',
      linked_taxonomy_nodes: [],
      instances: [],
      human_notes: [],
    };
    const newDirty = new Set(state.dirty);
    newDirty.add(newId);
    set({
      conflicts: [...state.conflicts, newConflict],
      dirty: newDirty,
      selectedNodeId: newId,
      embeddingDirty: true,
    });
    return newId;
  },

  deleteConflict: (claimId) => {
    set((state) => {
      const newConflicts = state.conflicts.filter(c => c.claim_id !== claimId);
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return {
        conflicts: newConflicts,
        dirty: newDirty,
        embeddingDirty: true,
        selectedNodeId: state.selectedNodeId === claimId ? null : state.selectedNodeId,
      };
    });
  },

  addConflictInstance: (claimId, instance) => {
    set((state) => {
      const newConflicts = state.conflicts.map(c =>
        c.claim_id === claimId
          ? { ...c, instances: [...c.instances, instance] }
          : c,
      );
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return { conflicts: newConflicts, dirty: newDirty, embeddingDirty: true };
    });
  },

  removeConflictInstance: (claimId, index) => {
    set((state) => {
      const newConflicts = state.conflicts.map(c =>
        c.claim_id === claimId
          ? { ...c, instances: c.instances.filter((_, i) => i !== index) }
          : c,
      );
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return { conflicts: newConflicts, dirty: newDirty, embeddingDirty: true };
    });
  },

  updateConflictInstance: (claimId, index, updates) => {
    set((state) => {
      const newConflicts = state.conflicts.map(c =>
        c.claim_id === claimId
          ? {
              ...c,
              instances: c.instances.map((inst, i) =>
                i === index ? { ...inst, ...updates } : inst,
              ),
            }
          : c,
      );
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return { conflicts: newConflicts, dirty: newDirty, embeddingDirty: true };
    });
  },

  addConflictNote: (claimId, note) => {
    set((state) => {
      const newConflicts = state.conflicts.map(c =>
        c.claim_id === claimId
          ? { ...c, human_notes: [...c.human_notes, note] }
          : c,
      );
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return { conflicts: newConflicts, dirty: newDirty, embeddingDirty: true };
    });
  },

  removeConflictNote: (claimId, index) => {
    set((state) => {
      const newConflicts = state.conflicts.map(c =>
        c.claim_id === claimId
          ? { ...c, human_notes: c.human_notes.filter((_, i) => i !== index) }
          : c,
      );
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return { conflicts: newConflicts, dirty: newDirty, embeddingDirty: true };
    });
  },

  updateConflictNote: (claimId, index, updates) => {
    set((state) => {
      const newConflicts = state.conflicts.map(c =>
        c.claim_id === claimId
          ? {
              ...c,
              human_notes: c.human_notes.map((note, i) =>
                i === index ? { ...note, ...updates } : note,
              ),
            }
          : c,
      );
      const newDirty = new Set(state.dirty);
      newDirty.add(claimId);
      return { conflicts: newConflicts, dirty: newDirty, embeddingDirty: true };
    });
  },

  getAllNodeIds: () => {
    const state = get();
    const ids: string[] = [];
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const file = state[pov];
      if (file) ids.push(...file.nodes.map(n => n.id));
    }
    if (state.situations) {
      ids.push(...state.situations.nodes.map(n => n.id));
    }
    return ids;
  },

  getAllConflictIds: () => {
    return get().conflicts.map(c => c.claim_id);
  },

  getLabelForId: (id: string) => {
    const state = get();
    if (id.startsWith('pol-')) {
      const pol = state.policyRegistry?.find(p => p.id === id);
      return pol?.action || '';
    }
    if (nodeTypeFromId(id) === 'situation') {
      const node = state.situations?.nodes.find(n => n.id === id);
      return node?.label || '';
    }
    if (id.startsWith('conflict-')) {
      const conflict = state.conflicts.find(c => c.claim_id === id);
      return conflict?.claim_label || '';
    }
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const file = state[pov];
      if (file) {
        const node = file.nodes.find(n => n.id === id);
        if (node) return node.label;
      }
    }
    return '';
  },

  getDescriptionForId: (id: string) => {
    const state = get();
    if (id.startsWith('pol-')) {
      const pol = state.policyRegistry?.find(p => p.id === id);
      return pol?.description || '';
    }
    if (nodeTypeFromId(id) === 'situation') {
      const node = state.situations?.nodes.find(n => n.id === id);
      return node?.description || '';
    }
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const file = state[pov];
      if (file) {
        const node = file.nodes.find(n => n.id === id);
        if (node) return node.description;
      }
    }
    return '';
  },

  lookupPinnedData: (id: string): PinnedData | null => {
    const state = get();
    if (nodeTypeFromId(id) === 'situation') {
      const node = state.situations?.nodes.find(n => n.id === id);
      if (node) return { type: 'situations', node: structuredClone(node) };
      return null;
    }
    if (id.startsWith('conflict-')) {
      const conflict = state.conflicts.find(c => c.claim_id === id);
      if (conflict) return { type: 'conflict', conflict: structuredClone(conflict) };
      return null;
    }
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const file = state[pov];
      if (file) {
        const node = file.nodes.find(n => n.id === id);
        if (node) return { type: 'pov', pov, node: structuredClone(node) };
      }
    }
    return null;
  },

  aiBackend: getStoredBackend(),
  setAIBackend: (backend) => {
    try { localStorage.setItem('taxonomy-editor-ai-backend', backend); } catch { /* ignore */ }
    const newModel = DEFAULT_MODELS[backend];
    try { localStorage.setItem('taxonomy-editor-gemini-model', newModel); } catch { /* ignore */ }
    set({ aiBackend: backend, geminiModel: newModel });
  },
  geminiModel: getStoredModel(),
  setGeminiModel: (model) => {
    try { localStorage.setItem('taxonomy-editor-gemini-model', model); } catch { /* ignore */ }
    set({ geminiModel: model });
  },

  colorScheme: getStoredTheme(),
  setColorScheme: (scheme) => {
    applyTheme(scheme);
    set({ colorScheme: scheme });
  },

  paneSpacing: (() => {
    try { return (localStorage.getItem('taxonomy-editor-pane-spacing') as 'normal' | 'concise') || 'normal'; } catch { return 'normal' as const; }
  })(),
  setPaneSpacing: (spacing) => {
    try { localStorage.setItem('taxonomy-editor-pane-spacing', spacing); } catch { /* ignore */ }
    document.documentElement.setAttribute('data-pane-spacing', spacing);
    set({ paneSpacing: spacing });
  },

  qbafEnabled: (() => {
    // Default to true — Q-0 calibration passed (hybrid: AI for Desires/Intentions, human for Beliefs)
    try { const v = localStorage.getItem('taxonomy-editor-qbaf'); return v === null ? true : v === 'true'; } catch { return true; }
  })(),
  setQbafEnabled: (enabled) => {
    try { localStorage.setItem('taxonomy-editor-qbaf', String(enabled)); } catch { /* ignore */ }
    set({ qbafEnabled: enabled });
  },

  zoomLevel: (() => {
    try {
      const stored = localStorage.getItem('taxonomy-editor-zoom');
      if (stored) {
        const n = parseInt(stored, 10);
        if (n >= 60 && n <= 200) return n;
      }
    } catch { /* ignore */ }
    return 100;
  })(),

  zoomIn: () => {
    const next = Math.min(200, get().zoomLevel + 10);
    try { localStorage.setItem('taxonomy-editor-zoom', String(next)); } catch { /* ignore */ }
    set({ zoomLevel: next });
  },

  zoomOut: () => {
    const next = Math.max(60, get().zoomLevel - 10);
    try { localStorage.setItem('taxonomy-editor-zoom', String(next)); } catch { /* ignore */ }
    set({ zoomLevel: next });
  },

  zoomReset: () => {
    try { localStorage.setItem('taxonomy-editor-zoom', '100'); } catch { /* ignore */ }
    set({ zoomLevel: 100 });
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
        // For array fields (assumes, intellectual_lineage), match if any element contains the value
        if (raw.some((v: string) => v.toLowerCase().includes(normalizedValue))) {
          results.push({ id: nodeId, label: nodeLabel, pov });
        }
      } else {
        // For string fields, check if any comma-separated token matches
        const str = String(raw).toLowerCase();
        const tokens = str.split(',').map(t => t.trim());
        if (tokens.some(t => t === normalizedValue)) {
          results.push({ id: nodeId, label: nodeLabel, pov });
        }
      }
    };

    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
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

  edgesFile: null,
  edgesLoading: false,
  relatedNodeId: null,
  selectedEdge: null,

  loadEdges: async () => {
    if (get().edgesFile) return; // already loaded
    set({ edgesLoading: true });
    try {
      const raw = await api.loadEdges();
      set({ edgesFile: raw as EdgesFile | null, edgesLoading: false });
    } catch {
      set({ edgesLoading: false });
    }
  },

  showRelatedEdges: (nodeId) => {
    set({ relatedNodeId: nodeId, selectedEdge: nodeId ? get().selectedEdge : null, ...(nodeId ? { toolbarPanel: 'related' as const } : { toolbarPanel: null }) });
    // Lazy-load edges on first use
    if (nodeId && !get().edgesFile) {
      get().loadEdges();
    }
  },

  selectEdge: (edge) => set({ selectedEdge: edge }),

  toolbarPanel: null,
  setToolbarPanel: (panel) => {
    const state = get();
    set({ toolbarPanel: panel, previousView: { panel: state.toolbarPanel, nodeId: state.selectedNodeId } });
  },
  pendingLineageValue: null,
  navigateToLineage: (value) => {
    const state = get();
    set({
      toolbarPanel: 'lineage',
      pendingLineageValue: value,
      previousView: { panel: state.toolbarPanel, nodeId: state.selectedNodeId },
    });
  },
  pendingSearchRelatedId: null,
  navigateToSearchRelated: (nodeId) => {
    const state = get();
    set({
      toolbarPanel: 'search',
      pendingSearchRelatedId: nodeId,
      previousView: { panel: state.toolbarPanel, nodeId: state.selectedNodeId },
    });
  },
  previousView: null,
  navigateBack: () => {
    const prev = get().previousView;
    if (!prev) {
      set({ toolbarPanel: null, previousView: null });
      return;
    }
    set({
      toolbarPanel: prev.panel,
      previousView: null,
      ...(prev.nodeId ? { selectedNodeId: prev.nodeId } : {}),
    });
  },
}));
