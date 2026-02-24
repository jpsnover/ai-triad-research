import { create } from 'zustand';
import type {
  PovTaxonomyFile,
  CrossCuttingFile,
  ConflictFile,
  PovNode,
  CrossCuttingNode,
  TabId,
  Pov,
  Category,
  ConflictInstance,
  ConflictNote,
} from '../types/taxonomy';
import {
  povTaxonomyFileSchema,
  crossCuttingFileSchema,
  conflictFileSchema,
  extractPovErrors,
  extractConflictErrors,
  ValidationErrors,
} from '../utils/validation';
import {
  generatePovNodeId,
  generateCrossCuttingId,
  generateConflictId,
  todayISO,
} from '../utils/idGenerator';
import { rankBySimilarity } from '../utils/similarity';

export type PinnedData =
  | { type: 'pov'; pov: Pov; node: PovNode }
  | { type: 'cross-cutting'; node: CrossCuttingNode }
  | { type: 'conflict'; conflict: ConflictFile };

export type SearchMode = 'raw' | 'wildcard' | 'regex' | 'semantic';

export type ColorScheme = 'light' | 'dark' | 'system';

export type GeminiModel =
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'gemini-2.0-flash'
  | 'gemini-2.0-flash-lite'
  | 'gemini-1.5-flash'
  | 'gemini-1.5-pro';

export const GEMINI_MODELS: { value: GeminiModel; label: string }[] = [
  { value: 'gemini-2.5-flash', label: '2.5 Flash (recommended)' },
  { value: 'gemini-2.5-pro', label: '2.5 Pro' },
  { value: 'gemini-2.0-flash', label: '2.0 Flash' },
  { value: 'gemini-2.0-flash-lite', label: '2.0 Flash Lite (fastest)' },
  { value: 'gemini-1.5-flash', label: '1.5 Flash' },
  { value: 'gemini-1.5-pro', label: '1.5 Pro' },
];

const GEMINI_MODEL_IDS: Set<string> = new Set(GEMINI_MODELS.map(m => m.value));

function getStoredModel(): GeminiModel {
  try {
    const stored = localStorage.getItem('taxonomy-editor-gemini-model');
    if (stored && GEMINI_MODEL_IDS.has(stored)) return stored as GeminiModel;
  } catch { /* ignore */ }
  return 'gemini-2.0-flash';
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
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
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

interface TaxonomyState {
  accelerationist: PovTaxonomyFile | null;
  safetyist: PovTaxonomyFile | null;
  skeptic: PovTaxonomyFile | null;
  crossCutting: CrossCuttingFile | null;
  conflicts: ConflictFile[];

  activeTab: TabId;
  selectedNodeId: string | null;
  dirty: Set<string>;
  validationErrors: ValidationErrors;
  saveError: string | null;
  loading: boolean;

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

  setActiveTab: (tab: TabId) => void;
  setSelectedNodeId: (id: string | null) => void;
  navigateToNode: (tab: TabId, id: string) => void;

  loadAll: () => Promise<void>;
  save: () => Promise<void>;

  updatePovNode: (pov: Pov, nodeId: string, updates: Partial<PovNode>) => void;
  createPovNode: (pov: Pov, category: Category) => string;
  deletePovNode: (pov: Pov, nodeId: string) => void;

  updateCrossCuttingNode: (nodeId: string, updates: Partial<CrossCuttingNode>) => void;
  createCrossCuttingNode: () => string;
  deleteCrossCuttingNode: (nodeId: string) => void;

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
  lookupPinnedData: (id: string) => PinnedData | null;

  geminiModel: GeminiModel;
  setGeminiModel: (model: GeminiModel) => void;

  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;

  zoomLevel: number;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
}

export const useTaxonomyStore = create<TaxonomyState>((set, get) => ({
  accelerationist: null,
  safetyist: null,
  skeptic: null,
  crossCutting: null,
  conflicts: [],

  activeTab: 'accelerationist',
  selectedNodeId: null,
  dirty: new Set(),
  validationErrors: {},
  saveError: null,
  loading: false,

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
  similarError: null,
  similarThreshold: 60,
  setSimilarThreshold: (threshold) => set({ similarThreshold: threshold }),
  clearSimilarSearch: () => set({ similarResults: null, similarError: null }),

  analysisResult: null,
  analysisLoading: false,
  analysisError: null,
  analysisStep: 0,
  analysisRetry: null,
  analysisCached: false,
  analysisElementA: null,
  analysisElementB: null,

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

    const prompt = `Role: Act as a Logical Analyst and Semantic Auditor.

Task: Compare two provided elements (Label + Description) to determine if they are functionally identical, semantically redundant, or if a meaningful distinction exists between them.

Evaluation Framework:

Semantic Mapping: Do the descriptions cover the same conceptual territory using different syntax?

Functional Utility: If one element were deleted, would any unique information, constraint, or application be lost?

The "So What?" Test: Does the difference in phrasing lead to a different real-world outcome or technical requirement?
Consider the Category of the element and how this relates to the analysis. For example, a Method might be used to implement a Goal/Value .  A Fact/Data might backup or verify a claim.  A Concept might be a component of a Method or a Goal.  A Risk might be mitigated by a Method or be a consequence of not following a Method.

Input Data:

Element A:
Category: ${elementA.category}
Label: ${elementA.label}
Description: ${elementA.description}

Element B:
Category: ${elementB.category}
Label: ${elementB.label}
Description: ${elementB.description}

Required Output Format:

The Verdict: [Identical | Redundant | Distinct]

The Delta: Identify the exact words or phrases that create a perceived difference. Analyze if these are "cosmetic" (synonyms) or "structural" (changing the scope).

Logical Gap: If you claim they are different, define the specific scenario where Element A applies but Element B does not. If they are the same, provide a single, "Steel-manned" version that consolidates both perfectly.

Blind Spot Check: Is one a subset of the other (Taxonomic overlap)?`;

    const unsubscribe = window.electronAPI.onGenerateTextProgress((progress) => {
      set({ analysisRetry: progress });
    });

    try {
      // Step 3: Sending to Gemini AI
      set({ analysisStep: 3 });
      const { text } = await window.electronAPI.generateText(prompt, model);

      // Step 4: Processing response
      set({ analysisStep: 4, analysisRetry: null });

      // Save to cache
      const cache = loadAnalysisCache();
      const cacheId = buildAnalysisCacheId(elementA, elementB, model);
      cache.set(cacheId, { elementA, elementB, model, result: text });
      saveAnalysisCache(cache);

      set({ analysisResult: text, analysisLoading: false, analysisStep: 0, analysisCached: false });
    } catch (err) {
      set({ analysisLoading: false, analysisError: String(err), analysisStep: 0, analysisRetry: null });
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
  }),

  checkApiKey: async () => {
    try {
      const has = await window.electronAPI.hasApiKey();
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
        texts.push(
          `[${pov}] ${node.category}\nID: ${node.id}\nLabel: ${node.label}\nDescription: ${node.description}`,
        );
      }
    }

    if (!hasPovFilter || povScopes.has('cross-cutting')) {
      if (state.crossCutting && !hasAspectFilter) {
        for (const node of state.crossCutting.nodes) {
          ids.push(node.id);
          texts.push(
            `[cross-cutting]\nID: ${node.id}\nLabel: ${node.label}\nDescription: ${node.description}\nAccelerationist interpretation: ${node.interpretations.accelerationist}\nSafetyist interpretation: ${node.interpretations.safetyist}\nSkeptic interpretation: ${node.interpretations.skeptic}`,
          );
        }
      }
    }

    if (!hasPovFilter || povScopes.has('conflicts')) {
      if (!hasAspectFilter) {
        for (const conflict of state.conflicts) {
          const notes = conflict.human_notes.map(n => n.note).join(' | ');
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
        const { ids, texts } = state.buildEmbeddingTexts(povScopes, aspectScopes);
        if (texts.length === 0) {
          set({ semanticResults: [], embeddingLoading: false });
          return;
        }
        const { vectors } = await window.electronAPI.computeEmbeddings(texts);
        cache = new Map();
        for (let i = 0; i < ids.length; i++) {
          cache.set(ids[i], vectors[i]);
        }
        set({ embeddingCache: cache, embeddingDirty: false });
      }

      const { vector } = await window.electronAPI.computeQueryEmbedding(query);
      const results = rankBySimilarity(vector, cache, 0.3, 25);
      set({ semanticResults: results, embeddingLoading: false });
    } catch (err) {
      set({ embeddingLoading: false, embeddingError: String(err) });
    }
  },

  runSimilarSearch: async (nodeId, label, description) => {
    const queryText = `${label}\n${description}`;
    if (!queryText.trim()) {
      set({ similarResults: [], similarLoading: false });
      return;
    }

    set({ similarLoading: true, similarError: null, similarResults: null });

    try {
      const state = get();
      let cache = state.embeddingCache;

      // Rebuild cache if dirty (no scope filters — search all elements)
      if (state.embeddingDirty || cache.size === 0) {
        const { ids, texts } = state.buildEmbeddingTexts(new Set(), new Set());
        if (texts.length === 0) {
          set({ similarResults: [], similarLoading: false });
          return;
        }
        const { vectors } = await window.electronAPI.computeEmbeddings(texts);
        cache = new Map();
        for (let i = 0; i < ids.length; i++) {
          cache.set(ids[i], vectors[i]);
        }
        set({ embeddingCache: cache, embeddingDirty: false });
      }

      const { vector } = await window.electronAPI.computeQueryEmbedding(queryText);
      // Use a low threshold (0.3) to get many results; the slider filters in UI
      const results = rankBySimilarity(vector, cache, 0.3, 200);
      // Exclude the source node itself
      const filtered = results.filter(r => r.id !== nodeId);
      set({ similarResults: filtered, similarLoading: false });
    } catch (err) {
      set({ similarLoading: false, similarError: String(err) });
    }
  },

  setActiveTab: (tab) => set({ activeTab: tab, selectedNodeId: null, validationErrors: {} }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id, validationErrors: {} }),
  navigateToNode: (tab, id) => set({ activeTab: tab, selectedNodeId: id, validationErrors: {} }),

  loadAll: async () => {
    set({ loading: true });
    try {
      const [acc, saf, skp, cc, conflicts] = await Promise.all([
        window.electronAPI.loadTaxonomyFile('accelerationist'),
        window.electronAPI.loadTaxonomyFile('safetyist'),
        window.electronAPI.loadTaxonomyFile('skeptic'),
        window.electronAPI.loadTaxonomyFile('cross-cutting'),
        window.electronAPI.loadConflictFiles(),
      ]);
      set({
        accelerationist: acc as PovTaxonomyFile,
        safetyist: saf as PovTaxonomyFile,
        skeptic: skp as PovTaxonomyFile,
        crossCutting: cc as CrossCuttingFile,
        conflicts: conflicts as ConflictFile[],
        loading: false,
        dirty: new Set(),
        embeddingCache: new Map(),
        embeddingDirty: true,
      });
    } catch (err) {
      set({ loading: false, saveError: String(err) });
    }
  },

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
      } else if (key === 'cross-cutting') {
        const file = state.crossCutting;
        if (!file) continue;
        const result = crossCuttingFileSchema.safeParse(file);
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

    set({ saveError: null, validationErrors: {} });

    try {
      const promises: Promise<void>[] = [];

      for (const key of dirtyKeys) {
        if (key === 'accelerationist' || key === 'safetyist' || key === 'skeptic') {
          const file = state[key];
          if (file) {
            promises.push(window.electronAPI.saveTaxonomyFile(key, file));
          }
        } else if (key === 'cross-cutting') {
          const file = state.crossCutting;
          if (file) {
            promises.push(window.electronAPI.saveTaxonomyFile('cross-cutting', file));
          }
        } else if (key.startsWith('conflict-')) {
          const conflict = state.conflicts.find(c => c.claim_id === key);
          if (conflict) {
            promises.push(window.electronAPI.saveConflictFile(key, conflict));
          }
        }
      }

      await Promise.all(promises);
      set({ dirty: new Set() });
    } catch (err) {
      set({ saveError: `Save failed: ${err}` });
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
      cross_cutting_refs: [],
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

  updateCrossCuttingNode: (nodeId, updates) => {
    set((state) => {
      const file = state.crossCutting;
      if (!file) return state;
      const newNodes = file.nodes.map(n =>
        n.id === nodeId ? { ...n, ...updates } : n,
      );
      const newFile: CrossCuttingFile = {
        ...file,
        last_modified: todayISO(),
        nodes: newNodes,
      };
      const newDirty = new Set(state.dirty);
      newDirty.add('cross-cutting');
      return { crossCutting: newFile, dirty: newDirty, embeddingDirty: true };
    });
  },

  createCrossCuttingNode: () => {
    const state = get();
    const file = state.crossCutting;
    if (!file) return '';
    const existingIds = file.nodes.map(n => n.id);
    const newId = generateCrossCuttingId(existingIds);
    const newNode: CrossCuttingNode = {
      id: newId,
      label: '',
      description: '',
      interpretations: { accelerationist: '', safetyist: '', skeptic: '' },
      linked_nodes: [],
      conflict_ids: [],
    };
    const newFile: CrossCuttingFile = {
      ...file,
      last_modified: todayISO(),
      nodes: [...file.nodes, newNode],
    };
    const newDirty = new Set(state.dirty);
    newDirty.add('cross-cutting');
    set({ crossCutting: newFile, dirty: newDirty, selectedNodeId: newId, embeddingDirty: true });
    return newId;
  },

  deleteCrossCuttingNode: (nodeId) => {
    set((state) => {
      const file = state.crossCutting;
      if (!file) return state;
      const newNodes = file.nodes.filter(n => n.id !== nodeId);
      const newFile: CrossCuttingFile = {
        ...file,
        last_modified: todayISO(),
        nodes: newNodes,
      };
      const newDirty = new Set(state.dirty);
      newDirty.add('cross-cutting');
      return {
        crossCutting: newFile,
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
    if (state.crossCutting) {
      ids.push(...state.crossCutting.nodes.map(n => n.id));
    }
    return ids;
  },

  getAllConflictIds: () => {
    return get().conflicts.map(c => c.claim_id);
  },

  getLabelForId: (id: string) => {
    const state = get();
    if (id.startsWith('cc-')) {
      const node = state.crossCutting?.nodes.find(n => n.id === id);
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

  lookupPinnedData: (id: string): PinnedData | null => {
    const state = get();
    if (id.startsWith('cc-')) {
      const node = state.crossCutting?.nodes.find(n => n.id === id);
      if (node) return { type: 'cross-cutting', node: structuredClone(node) };
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
}));
