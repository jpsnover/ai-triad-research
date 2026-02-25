import { create } from 'zustand';
import type { SourceInfo, PipelineSummary, TaxonomyNode, SelectedKeyPoint, Theme } from '../types/types';

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

  // Actions
  loadSources: () => Promise<void>;
  toggleSource: (id: string) => void;
  toggleAll: () => void;
  selectKeyPoint: (docId: string, pov: string, index: number) => void;
  clearKeyPoint: () => void;
  setTheme: (t: Theme) => void;
  togglePane1: () => void;
  addToTaxonomy: (pov: string, category: string, label: string, description: string) => Promise<{ success: boolean; nodeId: string; error?: string }>;
}

export const useStore = create<SummaryViewerState>((set, get) => ({
  sources: [],
  summaries: {},
  taxonomy: {},
  snapshots: {},
  loaded: false,
  selectedSourceIds: new Set<string>(),
  selectedKeyPoint: null,
  theme: (localStorage.getItem('summaryviewer-theme') as Theme) || 'system',
  pane1Visible: true,

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

  clearKeyPoint: () => {
    set({ selectedKeyPoint: null });
  },

  setTheme: (t: Theme) => {
    localStorage.setItem('summaryviewer-theme', t);
    set({ theme: t });
  },

  togglePane1: () => {
    set(state => ({ pane1Visible: !state.pane1Visible }));
  },

  addToTaxonomy: async (pov: string, category: string, label: string, description: string) => {
    const result = await window.electronAPI.addTaxonomyNode({ pov, category, label, description });
    if (result.success) {
      // Reload taxonomy to pick up the new node
      const taxonomy = await window.electronAPI.loadTaxonomy() as Record<string, TaxonomyNode>;
      set({ taxonomy });
    }
    return result;
  },
}));
