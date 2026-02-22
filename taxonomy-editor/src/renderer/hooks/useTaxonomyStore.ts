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
  extractZodErrors,
  ValidationErrors,
} from '../utils/validation';
import {
  generatePovNodeId,
  generateCrossCuttingId,
  generateConflictId,
  todayISO,
} from '../utils/idGenerator';

export type PinnedData =
  | { type: 'pov'; pov: Pov; node: PovNode }
  | { type: 'cross-cutting'; node: CrossCuttingNode }
  | { type: 'conflict'; conflict: ConflictFile };

export type SearchMode = 'raw' | 'wildcard' | 'regex';

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

  pinnedData: PinnedData | null;
  setPinnedData: (data: PinnedData | null) => void;

  findQuery: string;
  findMode: SearchMode;
  findCaseSensitive: boolean;
  setFindQuery: (query: string) => void;
  setFindMode: (mode: SearchMode) => void;
  setFindCaseSensitive: (cs: boolean) => void;

  setActiveTab: (tab: TabId) => void;
  setSelectedNodeId: (id: string | null) => void;

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

  pinnedData: null,
  setPinnedData: (data) => set({ pinnedData: data }),

  findQuery: '',
  findMode: 'raw' as SearchMode,
  findCaseSensitive: false,
  setFindQuery: (query) => set({ findQuery: query }),
  setFindMode: (mode) => set({ findMode: mode }),
  setFindCaseSensitive: (cs) => set({ findCaseSensitive: cs }),

  setActiveTab: (tab) => set({ activeTab: tab, selectedNodeId: null, validationErrors: {} }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id, validationErrors: {} }),

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
          Object.assign(errors, extractZodErrors(result.error));
        }
      } else if (key === 'cross-cutting') {
        const file = state.crossCutting;
        if (!file) continue;
        const result = crossCuttingFileSchema.safeParse(file);
        if (!result.success) {
          Object.assign(errors, extractZodErrors(result.error));
        }
      } else if (key.startsWith('conflict-')) {
        const conflict = state.conflicts.find(c => c.claim_id === key);
        if (!conflict) continue;
        const result = conflictFileSchema.safeParse(conflict);
        if (!result.success) {
          Object.assign(errors, extractZodErrors(result.error));
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
      return { [pov]: newFile, dirty: newDirty };
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
    set({ [pov]: newFile, dirty: newDirty, selectedNodeId: newId });
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
      return { crossCutting: newFile, dirty: newDirty };
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
    set({ crossCutting: newFile, dirty: newDirty, selectedNodeId: newId });
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
      return { conflicts: newConflicts, dirty: newDirty };
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
      return { conflicts: newConflicts, dirty: newDirty };
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
      return { conflicts: newConflicts, dirty: newDirty };
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
      return { conflicts: newConflicts, dirty: newDirty };
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
      return { conflicts: newConflicts, dirty: newDirty };
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
      return { conflicts: newConflicts, dirty: newDirty };
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
      return { conflicts: newConflicts, dirty: newDirty };
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
}));
