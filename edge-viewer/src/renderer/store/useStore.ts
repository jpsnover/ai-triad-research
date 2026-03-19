// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import type {
  Theme,
  Pov,
  TaxonomyNode,
  Edge,
  IndexedEdge,
  EdgesFile,
  FilterState,
  EdgeStatus,
  EdgeType,
} from '../types/types';

interface NodeMap {
  [id: string]: TaxonomyNode & { pov: Pov };
}

interface AppState {
  // Data
  nodeMap: NodeMap;
  edgesFile: EdgesFile | null;
  indexedEdges: IndexedEdge[];
  loaded: boolean;
  error: string | null;

  // Selection
  selectedEdgeIndex: number | null;

  // Filters
  filters: FilterState;

  // UI
  theme: Theme;

  // Computed
  filteredEdges: IndexedEdge[];

  // Actions
  loadData: () => Promise<void>;
  setTheme: (t: Theme) => void;
  selectEdge: (index: number | null) => void;
  setFilter: (key: keyof FilterState, value: string | number | boolean) => void;
  resetFilters: () => void;
  updateEdgeStatus: (index: number, status: EdgeStatus) => Promise<void>;
  bulkUpdateVisible: (status: EdgeStatus) => Promise<void>;
}

function getInitialStatus(): EdgeStatus | '' {
  try {
    const params = new URLSearchParams(window.location.search);
    const val = params.get('status');
    if (val === 'proposed' || val === 'approved' || val === 'rejected') return val;
  } catch {
    /* fallback */
  }
  return '';
}

const DEFAULT_FILTERS: FilterState = {
  sourcePov: '',
  targetPov: '',
  edgeType: '',
  status: getInitialStatus(),
  minConfidence: 0,
  searchText: '',
  crossPovOnly: false,
};

function getThemeFromStorage(): Theme {
  try {
    const saved = localStorage.getItem('edge-viewer-theme');
    if (saved === 'light' || saved === 'dark' || saved === 'bkc' || saved === 'system')
      return saved;
  } catch {
    /* fallback */
  }
  return 'light';
}

function applyFilters(edges: IndexedEdge[], filters: FilterState): IndexedEdge[] {
  return edges.filter((e) => {
    if (filters.sourcePov && e.sourcePov !== filters.sourcePov) return false;
    if (filters.targetPov && e.targetPov !== filters.targetPov) return false;
    if (filters.edgeType && e.type !== filters.edgeType) return false;
    if (filters.status && e.status !== filters.status) return false;
    if (e.confidence < filters.minConfidence) return false;
    if (filters.crossPovOnly && e.sourcePov === e.targetPov) return false;
    if (filters.searchText) {
      const q = filters.searchText.toLowerCase();
      const haystack = [
        e.source,
        e.target,
        e.sourceLabel,
        e.targetLabel,
        e.rationale,
        e.type,
        e.notes || '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export const useStore = create<AppState>((set, get) => ({
  nodeMap: {},
  edgesFile: null,
  indexedEdges: [],
  loaded: false,
  error: null,
  selectedEdgeIndex: null,
  filters: { ...DEFAULT_FILTERS },
  theme: getThemeFromStorage(),
  filteredEdges: [],

  loadData: async () => {
    try {
      const allNodeData = await window.electronAPI.readAllNodes();
      const nodeMap: NodeMap = {};
      for (const { pov, nodes } of allNodeData) {
        for (const n of nodes as TaxonomyNode[]) {
          nodeMap[n.id] = { ...n, pov: pov as Pov };
        }
      }

      const raw = (await window.electronAPI.readEdges()) as EdgesFile | null;
      if (!raw) {
        set({ nodeMap, loaded: true, error: 'No edges.json found' });
        return;
      }

      const indexed: IndexedEdge[] = raw.edges.map((e: Edge, i: number) => ({
        ...e,
        index: i,
        sourcePov: nodeMap[e.source]?.pov || ('unknown' as Pov),
        targetPov: nodeMap[e.target]?.pov || ('unknown' as Pov),
        sourceLabel: nodeMap[e.source]?.label || e.source,
        targetLabel: nodeMap[e.target]?.label || e.target,
      }));

      const { filters } = get();
      set({
        nodeMap,
        edgesFile: raw,
        indexedEdges: indexed,
        filteredEdges: applyFilters(indexed, filters),
        loaded: true,
        error: null,
      });
    } catch (err) {
      console.error('Failed to load data:', err);
      set({ loaded: true, error: String(err) });
    }
  },

  setTheme: (t: Theme) => {
    localStorage.setItem('edge-viewer-theme', t);
    set({ theme: t });
  },

  selectEdge: (index: number | null) => {
    set({ selectedEdgeIndex: index });
  },

  setFilter: (key, value) => {
    const { filters, indexedEdges } = get();
    const updated = { ...filters, [key]: value };
    set({ filters: updated, filteredEdges: applyFilters(indexedEdges, updated) });
  },

  resetFilters: () => {
    const { indexedEdges } = get();
    set({
      filters: { ...DEFAULT_FILTERS },
      filteredEdges: applyFilters(indexedEdges, DEFAULT_FILTERS),
    });
  },

  updateEdgeStatus: async (index: number, status: EdgeStatus) => {
    await window.electronAPI.updateEdgeStatus(index, status);
    const { indexedEdges, filters } = get();
    const updated = indexedEdges.map((e) =>
      e.index === index ? { ...e, status } : e
    );
    set({
      indexedEdges: updated,
      filteredEdges: applyFilters(updated, filters),
    });
  },

  bulkUpdateVisible: async (status: EdgeStatus) => {
    const { filteredEdges, indexedEdges, filters } = get();
    const indices = filteredEdges.map((e) => e.index);
    if (indices.length === 0) return;
    await window.electronAPI.bulkUpdateEdges(indices, status);
    const updated = indexedEdges.map((e) =>
      indices.includes(e.index) ? { ...e, status } : e
    );
    set({
      indexedEdges: updated,
      filteredEdges: applyFilters(updated, filters),
    });
  },
}));
