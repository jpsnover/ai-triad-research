// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import { api } from '@bridge';
import type { SupportCaseSummary, SupportCaseDetail } from '../bridge/types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

const SEEN_KEY = 'support-case-responses-seen';

function getSeenCounts(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
  } catch { /* telemetry — silent by design */
    return {};
  }
}

function computeUnread(cases: SupportCaseSummary[]): number {
  const seen = getSeenCounts();
  return cases.filter((c) => c.responseCount > (seen[c.id] ?? 0)).length;
}

interface SupportState {
  cases: SupportCaseSummary[];
  selectedCaseId: string | null;
  selectedDetail: SupportCaseDetail | null;
  loading: boolean;
  detailLoading: boolean;
  error: string | null;
  unreadCount: number;
  fetchCases: () => Promise<void>;
  selectCase: (id: string) => Promise<void>;
  clearSelection: () => void;
}

export const useSupportStore = create<SupportState>((set, get) => ({
  cases: [],
  selectedCaseId: null,
  selectedDetail: null,
  loading: false,
  detailLoading: false,
  error: null,
  unreadCount: 0,

  fetchCases: async () => {
    set({ loading: true, error: null });
    try {
      const cases = (await api.listSupportCases()) as SupportCaseSummary[];
      cases.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      set({ cases, loading: false, unreadCount: computeUnread(cases) });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'support-store',
        level: 'error',
        message: 'Failed to fetch support cases',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      set({ loading: false, error: 'Failed to load support cases' });
    }
  },

  selectCase: async (id: string) => {
    set({ selectedCaseId: id, detailLoading: true, error: null });
    try {
      const detail = (await api.getSupportCaseDetail(id)) as SupportCaseDetail;
      const seen = getSeenCounts();
      seen[id] = detail.responseCount;
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
      set({
        selectedDetail: detail,
        detailLoading: false,
        unreadCount: computeUnread(get().cases),
      });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'support-store',
        level: 'error',
        message: 'Failed to fetch case detail',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      set({ detailLoading: false, error: 'Failed to load case details' });
    }
  },

  clearSelection: () => {
    set({ selectedCaseId: null, selectedDetail: null });
  },
}));
