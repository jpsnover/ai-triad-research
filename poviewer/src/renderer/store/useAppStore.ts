import { create } from 'zustand';
import type { PovCamp, Theme, Point, Source, Notebook, TaxonomyMeta, SearchMode } from '../types/types';
import { HARDCODED_NOTEBOOKS } from '../data/hardcodedData';
import { discoveredToSource, type TaxNodeLookup } from '../utils/pipelineAdapter';

interface PovFilters {
  accelerationist: boolean;
  safetyist: boolean;
  skeptic: boolean;
  'cross-cutting': boolean;
}

// Hardcoded taxonomy metadata (from real files, for prototype fallback)
const TAXONOMY_METADATA: Record<string, Omit<TaxonomyMeta, 'isLoading'>> = {
  accelerationist: { pov: 'accelerationist', colorHex: '#27AE60', nodeCount: 12, lastModified: '2026-02-22' },
  safetyist: { pov: 'safetyist', colorHex: '#E74C3C', nodeCount: 12, lastModified: '2026-02-23' },
  skeptic: { pov: 'skeptic', colorHex: '#F39C12', nodeCount: 8, lastModified: '2026-02-21' },
  'cross-cutting': { pov: 'cross-cutting', colorHex: '#8E44AD', nodeCount: 6, lastModified: '2026-02-22' },
};

// Empty initial notebook — will be populated from pipeline
const INITIAL_NOTEBOOK: Notebook = {
  id: 'default',
  name: 'Research Notebook',
  sources: [],
  taxonomyFiles: [],
};

interface AppState {
  // Notebooks
  notebooks: Notebook[];
  activeNotebookId: string;

  // Source selection
  selectedSourceId: string | null;
  analyzingSourceId: string | null;

  // Source checkboxes
  enabledSourceIds: string[];

  // Point selection
  selectedPointId: string | null;

  // POV filter toggles (shared between Pane 2 and 3)
  povFilters: PovFilters;

  // Theme
  theme: Theme;

  // Search
  searchQuery: string;
  searchMode: SearchMode;
  searchCaseSensitive: boolean;

  // Loaded taxonomy files
  loadedTaxonomies: Record<string, TaxonomyMeta>;

  // View mode for Pane 3
  pane3View: 'points' | 'nodes' | 'gaps';

  // Pipeline loading state
  pipelineLoaded: boolean;

  // Actions
  setActiveNotebook: (id: string) => void;
  addSource: (source: Source) => void;
  updateSource: (sourceId: string, updates: Partial<Source>) => void;
  selectSource: (sourceId: string) => void;
  selectSourceDirect: (sourceId: string) => void;
  selectPoint: (pointId: string | null) => void;
  navigatePoint: (direction: 'prev' | 'next') => void;
  togglePovFilter: (camp: PovCamp) => void;
  setAllPovFilters: (value: boolean) => void;
  setTheme: (theme: Theme) => void;
  toggleSourceEnabled: (sourceId: string) => void;
  setAllSourcesEnabled: (enabled: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: SearchMode) => void;
  setSearchCaseSensitive: (caseSensitive: boolean) => void;
  loadTaxonomy: (pov: string) => void;
  unloadTaxonomy: (pov: string) => void;
  setPane3View: (view: 'points' | 'nodes' | 'gaps') => void;
  loadFromPipeline: () => Promise<void>;
}

function getThemeFromStorage(): Theme {
  try {
    const saved = localStorage.getItem('poviewer-theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch { /* fallback */ }
  return 'light';
}

// Helper to derive source from state (used by actions internally)
function deriveSource(state: AppState): Source | null {
  const notebook = state.notebooks.find(n => n.id === state.activeNotebookId) ?? state.notebooks[0];
  if (!state.selectedSourceId) return null;
  return notebook.sources.find(s => s.id === state.selectedSourceId) ?? null;
}

function deriveVisiblePoints(state: AppState): Point[] {
  const source = deriveSource(state);
  if (!source) return [];
  return source.points.filter(point => {
    if (point.mappings.length === 0) return true;
    return point.mappings.some(m => state.povFilters[m.camp]);
  });
}

export const useAppStore = create<AppState>((set, get) => ({
  notebooks: [INITIAL_NOTEBOOK],
  activeNotebookId: INITIAL_NOTEBOOK.id,
  selectedSourceId: null,
  analyzingSourceId: null,
  enabledSourceIds: [],
  selectedPointId: null,

  povFilters: {
    accelerationist: true,
    safetyist: true,
    skeptic: true,
    'cross-cutting': true,
  },

  searchQuery: '',
  searchMode: 'raw' as SearchMode,
  searchCaseSensitive: false,

  theme: getThemeFromStorage(),

  loadedTaxonomies: {},

  pane3View: 'points' as const,

  pipelineLoaded: false,

  // === Load sources from the PowerShell pipeline (sources/ + summaries/) ===
  loadFromPipeline: async () => {
    if (!window.electronAPI?.discoverSources) {
      // Fallback to hardcoded data when Electron is not available
      set({
        notebooks: HARDCODED_NOTEBOOKS,
        activeNotebookId: HARDCODED_NOTEBOOKS[0].id,
        enabledSourceIds: HARDCODED_NOTEBOOKS[0].sources.map(s => s.id),
        pipelineLoaded: true,
      });
      return;
    }

    try {
      // Build taxonomy node lookup for resolving real labels/descriptions
      const taxNodes: TaxNodeLookup = {};
      if (window.electronAPI.loadTaxonomyFile) {
        const povFiles = ['accelerationist', 'safetyist', 'skeptic', 'cross-cutting'];
        for (const pov of povFiles) {
          try {
            const data = await window.electronAPI.loadTaxonomyFile(pov) as { nodes?: Array<{ id: string; label: string; description: string }> };
            if (data?.nodes) {
              for (const node of data.nodes) {
                taxNodes[node.id] = { label: node.label, description: node.description };
              }
            }
          } catch { /* taxonomy file may not exist */ }
        }
      }

      const discovered = await window.electronAPI.discoverSources() as Array<{
        id: string;
        title: string;
        sourceType: string;
        url: string | null;
        authors: string[];
        dateIngested: string;
        povTags: string[];
        topicTags: string[];
        oneLiner: string;
        summaryStatus: string;
        snapshotText: string;
        hasSummary: boolean;
      }>;

      const sources: Source[] = [];

      for (const disc of discovered) {
        let summary = null;
        if (disc.hasSummary) {
          summary = await window.electronAPI.loadPipelineSummary(disc.id) as Parameters<typeof discoveredToSource>[1];
        }
        sources.push(discoveredToSource(disc, summary, taxNodes));
      }

      const notebook: Notebook = {
        id: 'default',
        name: 'Research Notebook',
        sources,
        taxonomyFiles: [],
      };

      set({
        notebooks: [notebook],
        activeNotebookId: 'default',
        enabledSourceIds: sources.map(s => s.id),
        pipelineLoaded: true,
      });
    } catch (err) {
      console.error('[useAppStore] Failed to load from pipeline:', err);
      // Fallback to hardcoded
      set({
        notebooks: HARDCODED_NOTEBOOKS,
        activeNotebookId: HARDCODED_NOTEBOOKS[0].id,
        enabledSourceIds: HARDCODED_NOTEBOOKS[0].sources.map(s => s.id),
        pipelineLoaded: true,
      });
    }
  },

  setActiveNotebook: (id: string) => {
    const state = get();
    const notebook = state.notebooks.find(n => n.id === id) ?? state.notebooks[0];
    set({
      activeNotebookId: id,
      selectedSourceId: null,
      analyzingSourceId: null,
      selectedPointId: null,
      enabledSourceIds: notebook.sources.map(s => s.id),
    });
  },

  addSource: (source: Source) => {
    set(state => {
      const notebooks = state.notebooks.map(n => {
        if (n.id !== state.activeNotebookId) return n;
        return { ...n, sources: [...n.sources, source] };
      });
      return {
        notebooks,
        enabledSourceIds: [...state.enabledSourceIds, source.id],
      };
    });
  },

  updateSource: (sourceId: string, updates: Partial<Source>) => {
    set(state => ({
      notebooks: state.notebooks.map(n => ({
        ...n,
        sources: n.sources.map(s =>
          s.id === sourceId ? { ...s, ...updates } : s,
        ),
      })),
    }));
  },

  selectSource: (sourceId: string) => {
    const state = get();
    const notebook = state.notebooks.find(n => n.id === state.activeNotebookId) ?? state.notebooks[0];
    const source = notebook.sources.find(s => s.id === sourceId);
    if (!source) return;

    // Direct select — no fake spinner
    set({ selectedSourceId: sourceId, analyzingSourceId: null, selectedPointId: null });
  },

  selectSourceDirect: (sourceId: string) => {
    set({ selectedSourceId: sourceId, analyzingSourceId: null, selectedPointId: null });
  },

  selectPoint: (pointId: string | null) => {
    set({ selectedPointId: pointId });
  },

  navigatePoint: (direction: 'prev' | 'next') => {
    const state = get();
    const visiblePoints = deriveVisiblePoints(state);
    if (visiblePoints.length === 0) return;

    if (!state.selectedPointId) {
      set({ selectedPointId: visiblePoints[0].id });
      return;
    }

    const currentIdx = visiblePoints.findIndex(p => p.id === state.selectedPointId);
    if (currentIdx === -1) {
      set({ selectedPointId: visiblePoints[0].id });
      return;
    }

    const newIdx = direction === 'next'
      ? Math.min(currentIdx + 1, visiblePoints.length - 1)
      : Math.max(currentIdx - 1, 0);

    set({ selectedPointId: visiblePoints[newIdx].id });
  },

  togglePovFilter: (camp: PovCamp) => {
    set(state => ({
      povFilters: {
        ...state.povFilters,
        [camp]: !state.povFilters[camp],
      },
    }));
  },

  setAllPovFilters: (value: boolean) => {
    set({
      povFilters: {
        accelerationist: value,
        safetyist: value,
        skeptic: value,
        'cross-cutting': value,
      },
    });
  },

  setTheme: (theme: Theme) => {
    localStorage.setItem('poviewer-theme', theme);
    set({ theme });
  },

  toggleSourceEnabled: (sourceId: string) => {
    set(state => {
      const ids = state.enabledSourceIds;
      if (ids.includes(sourceId)) {
        return { enabledSourceIds: ids.filter(id => id !== sourceId) };
      }
      return { enabledSourceIds: [...ids, sourceId] };
    });
  },

  setAllSourcesEnabled: (enabled: boolean) => {
    if (enabled) {
      const state = get();
      const notebook = state.notebooks.find(n => n.id === state.activeNotebookId) ?? state.notebooks[0];
      set({ enabledSourceIds: notebook.sources.map(s => s.id) });
    } else {
      set({ enabledSourceIds: [] });
    }
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setSearchMode: (mode: SearchMode) => set({ searchMode: mode }),
  setSearchCaseSensitive: (caseSensitive: boolean) => set({ searchCaseSensitive: caseSensitive }),

  setPane3View: (view: 'points' | 'nodes' | 'gaps') => set({ pane3View: view }),

  loadTaxonomy: (pov: string) => {
    const meta = TAXONOMY_METADATA[pov];
    if (!meta) return;

    set(state => ({
      loadedTaxonomies: {
        ...state.loadedTaxonomies,
        [pov]: { ...meta, isLoading: true },
      },
    }));

    const finish = (nodeCount?: number) => {
      set(state => ({
        loadedTaxonomies: {
          ...state.loadedTaxonomies,
          [pov]: { ...meta, nodeCount: nodeCount ?? meta.nodeCount, isLoading: false },
        },
      }));
    };

    if (window.electronAPI) {
      window.electronAPI.loadTaxonomyFile(pov)
        .then((data: unknown) => {
          const file = data as { nodes?: unknown[] };
          finish(file?.nodes?.length ?? meta.nodeCount);
        })
        .catch(() => finish());
    } else {
      setTimeout(() => finish(), 400);
    }
  },

  unloadTaxonomy: (pov: string) => {
    set(state => {
      const next = { ...state.loadedTaxonomies };
      delete next[pov];
      return { loadedTaxonomies: next };
    });
  },
}));
