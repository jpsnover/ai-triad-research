// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useTaxonomyStore } from './useTaxonomyStore';

export interface CommunityItem {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  community_metadata?: {
    submitted_by_display: string;
    submitted_at: string;
    approved_at: string;
    original_id: string;
  };
}

export interface CommunityChat extends CommunityItem {
  mode?: string;
}

export interface CommunityDebate extends CommunityItem {
  phase?: string;
}

export interface Submission {
  id: string;
  type: 'chat' | 'debate';
  originalId: string;
  submittedBy: string;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  note?: string;
}

interface CommunityStore {
  chats: CommunityChat[];
  debates: CommunityDebate[];
  submissions: Submission[];
  loading: boolean;
  error: string | null;

  fetchChats: () => Promise<void>;
  fetchDebates: () => Promise<void>;
  fetchSubmissions: (status?: string) => Promise<void>;
  submitItem: (type: 'chat' | 'debate', data: unknown, note?: string) => Promise<string>;
  copyItem: (type: 'chats' | 'debates', communityId: string) => Promise<string>;
  approveSubmission: (id: string) => Promise<void>;
  rejectSubmission: (id: string) => Promise<void>;
}

function isElectronMode(): boolean {
  return typeof window !== 'undefined' && 'electronAPI' in window;
}

function getCommunityBaseUrl(): string {
  if (!isElectronMode()) return '';
  const url = useTaxonomyStore.getState().communityServerUrl;
  return url.replace(/\/+$/, '');
}

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const useCommunityStore = create<CommunityStore>((set) => ({
  chats: [],
  debates: [],
  submissions: [],
  loading: false,
  error: null,

  fetchChats: async () => {
    if (isElectronMode()) { set({ chats: [], loading: false }); return; }
    set({ loading: true, error: null });
    try {
      const chats = await fetchJson<CommunityChat[]>('/api/community/chats');
      set({ chats, loading: false });
      api.trackEvent('community_browse', 'community', { type: 'chats', count: chats.length });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'community-store', level: 'error', message: 'Failed to fetch community chats', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      set({ error: String(err), loading: false });
    }
  },

  fetchDebates: async () => {
    if (isElectronMode()) { set({ debates: [], loading: false }); return; }
    set({ loading: true, error: null });
    try {
      const debates = await fetchJson<CommunityDebate[]>('/api/community/debates');
      set({ debates, loading: false });
      api.trackEvent('community_browse', 'community', { type: 'debates', count: debates.length });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'community-store', level: 'error', message: 'Failed to fetch community debates', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      set({ error: String(err), loading: false });
    }
  },

  fetchSubmissions: async (status?: string) => {
    if (isElectronMode()) { set({ submissions: [], loading: false }); return; }
    set({ loading: true, error: null });
    try {
      const qs = status ? `?status=${status}` : '';
      const submissions = await fetchJson<Submission[]>(`/api/admin/submissions${qs}`);
      set({ submissions, loading: false });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'community-store', level: 'error', message: 'Failed to fetch submissions', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      set({ error: String(err), loading: false });
    }
  },

  submitItem: async (type, data, note) => {
    const base = getCommunityBaseUrl();
    if (isElectronMode() && !base) {
      throw new Error('Community server URL not configured. Set it in Settings to share debates.');
    }
    const result = await fetchJson<{ submissionId: string }>(`${base}/api/community/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data, note }),
    });
    return result.submissionId;
  },

  copyItem: async (type, communityId) => {
    if (isElectronMode()) throw new Error('Community Library is not available in desktop mode');
    const result = await fetchJson<{ newId: string }>('/api/community/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, communityId }),
    });
    api.trackEvent('community_copy', 'community', { type, communityId });
    return result.newId;
  },

  approveSubmission: async (id) => {
    if (isElectronMode()) return;
    await fetchJson(`/api/admin/submissions/${id}/approve`, { method: 'POST' });
  },

  rejectSubmission: async (id) => {
    if (isElectronMode()) return;
    await fetchJson(`/api/admin/submissions/${id}/reject`, { method: 'POST' });
  },
}));
