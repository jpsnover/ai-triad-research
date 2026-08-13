// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { OpEdSet } from '../../../../lib/oped/types';

// Personal Op-Ed library store (t/2576). A lean list/load/delete/rename surface over
// the bridge trio — deliberately NOT a mirror of useDebateStore's state machine: an
// op-ed set is static text, so there is no live-generation loop to model here. The
// PR#2 create flow adds the generation actions; PR#1 is the library + reader only.
//
// Personal op-eds come through `api.*OpEd*` (Electron: local fs via t/2575 IPC; web:
// t/2573 routes). Community op-eds live in useCommunityStore alongside debates/chats.

interface OpEdStore {
  /** Personal op-ed sets (each set = one create run; single-voice is a set of 1). */
  sets: OpEdSet[];
  /** set_id of the row open in the reader, or null for the table view. */
  selectedSetId: string | null;
  loading: boolean;
  error: string | null;
  /** Edit mode enables the bulk-select checkbox column + inline rename (My only). */
  editMode: boolean;
  selectedIds: Set<string>;

  loadSets: () => Promise<void>;
  selectSet: (id: string | null) => void;
  deleteSet: (id: string) => Promise<void>;
  renameSet: (id: string, topic: string) => Promise<void>;
  setEditMode: (on: boolean) => void;
  toggleSelected: (id: string) => void;
  clearSelected: () => void;
  deleteSelected: () => Promise<void>;
}

export const useOpEdStore = create<OpEdStore>((set, get) => ({
  sets: [],
  selectedSetId: null,
  loading: false,
  error: null,
  editMode: false,
  selectedIds: new Set<string>(),

  loadSets: async () => {
    set({ loading: true, error: null });
    try {
      const sets = await api.listOpEdSets();
      set({ sets, loading: false });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'oped-store', level: 'error', message: 'Failed to load op-ed sets',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      set({ error: String(err), loading: false });
    }
  },

  selectSet: (id) => set({ selectedSetId: id }),

  deleteSet: async (id) => {
    const prev = get().sets;
    // Optimistic removal; roll back on failure. Mutations never auto-retry — the
    // error is re-thrown so the caller surfaces user-visible feedback (toast/inline).
    set({
      sets: prev.filter(s => s.set_id !== id),
      selectedSetId: get().selectedSetId === id ? null : get().selectedSetId,
    });
    try {
      await api.deleteOpEdSet(id);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'oped-store', level: 'error', message: 'Failed to delete op-ed set',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      set({ sets: prev, error: String(err) });
      throw err;
    }
  },

  renameSet: async (id, topic) => {
    const prev = get().sets;
    const target = prev.find(s => s.set_id === id);
    if (!target) return;
    const updated: OpEdSet = { ...target, topic };
    set({ sets: prev.map(s => (s.set_id === id ? updated : s)) });
    try {
      await api.saveOpEdSet(updated);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'oped-store', level: 'error', message: 'Failed to rename op-ed set',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      set({ sets: prev, error: String(err) });
      throw err;
    }
  },

  setEditMode: (on) => set({ editMode: on, selectedIds: on ? get().selectedIds : new Set<string>() }),

  toggleSelected: (id) => {
    const next = new Set(get().selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    set({ selectedIds: next });
  },

  clearSelected: () => set({ selectedIds: new Set<string>() }),

  deleteSelected: async () => {
    const ids = Array.from(get().selectedIds);
    // Sequential, not parallel: mutations must not race, and a mid-batch failure
    // should stop rather than fire the rest blind. deleteSet re-throws on failure.
    for (const id of ids) {
      await get().deleteSet(id);
    }
    set({ selectedIds: new Set<string>(), editMode: false });
  },
}));
