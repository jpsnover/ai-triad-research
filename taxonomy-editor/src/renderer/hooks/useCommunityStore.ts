// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';

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
    set({ loading: true, error: null });
    try {
      const chats = await fetchJson<CommunityChat[]>('/api/community/chats');
      set({ chats, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  fetchDebates: async () => {
    set({ loading: true, error: null });
    try {
      const debates = await fetchJson<CommunityDebate[]>('/api/community/debates');
      set({ debates, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  fetchSubmissions: async (status?: string) => {
    set({ loading: true, error: null });
    try {
      const qs = status ? `?status=${status}` : '';
      const submissions = await fetchJson<Submission[]>(`/api/admin/submissions${qs}`);
      set({ submissions, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  submitItem: async (type, data, note) => {
    const result = await fetchJson<{ submissionId: string }>('/api/community/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data, note }),
    });
    return result.submissionId;
  },

  copyItem: async (type, communityId) => {
    const result = await fetchJson<{ newId: string }>('/api/community/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, communityId }),
    });
    return result.newId;
  },

  approveSubmission: async (id) => {
    await fetchJson(`/api/admin/submissions/${id}/approve`, { method: 'POST' });
  },

  rejectSubmission: async (id) => {
    await fetchJson(`/api/admin/submissions/${id}/reject`, { method: 'POST' });
  },
}));
