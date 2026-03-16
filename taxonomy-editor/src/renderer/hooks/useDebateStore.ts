// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import type {
  DebateSession,
  DebateSessionSummary,
  PoverId,
  TranscriptEntry,
} from '../types/debate';

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

interface DebateStore {
  // Session list
  sessions: DebateSessionSummary[];
  sessionsLoading: boolean;

  // Active debate
  activeDebateId: string | null;
  activeDebate: DebateSession | null;
  debateLoading: boolean;
  debateGenerating: PoverId | null;
  debateError: string | null;

  // Actions
  loadSessions: () => Promise<void>;
  createDebate: (topic: string, povers: PoverId[], userIsPover: boolean) => Promise<string>;
  loadDebate: (id: string) => Promise<void>;
  deleteDebate: (id: string) => Promise<void>;
  closeDebate: () => void;
  addTranscriptEntry: (entry: Omit<TranscriptEntry, 'id' | 'timestamp'>) => void;
  updatePhase: (phase: DebateSession['phase']) => void;
  updateTopic: (topic: Partial<DebateSession['topic']>) => void;
  saveDebate: () => Promise<void>;
  setGenerating: (pover: PoverId | null) => void;
  setError: (error: string | null) => void;
}

export const useDebateStore = create<DebateStore>((set, get) => ({
  sessions: [],
  sessionsLoading: false,
  activeDebateId: null,
  activeDebate: null,
  debateLoading: false,
  debateGenerating: null,
  debateError: null,

  loadSessions: async () => {
    set({ sessionsLoading: true });
    try {
      const raw = await window.electronAPI.listDebateSessions();
      set({ sessions: raw as DebateSessionSummary[], sessionsLoading: false });
    } catch {
      set({ sessionsLoading: false });
    }
  },

  createDebate: async (topic, povers, userIsPover) => {
    const id = generateId();
    const now = nowISO();
    const title = topic.length > 60 ? topic.slice(0, 57) + '...' : topic;
    const session: DebateSession = {
      id,
      title,
      created_at: now,
      updated_at: now,
      phase: 'setup',
      topic: {
        original: topic,
        refined: null,
        final: topic,
      },
      active_povers: povers,
      user_is_pover: userIsPover,
      transcript: [],
      context_summaries: [],
    };
    await window.electronAPI.saveDebateSession(session);
    set({ activeDebateId: id, activeDebate: session });
    // Refresh session list
    await get().loadSessions();
    return id;
  },

  loadDebate: async (id) => {
    set({ debateLoading: true, debateError: null });
    try {
      const raw = await window.electronAPI.loadDebateSession(id);
      const session = raw as DebateSession;
      set({ activeDebateId: id, activeDebate: session, debateLoading: false });
    } catch (err) {
      set({ debateLoading: false, debateError: String(err) });
    }
  },

  deleteDebate: async (id) => {
    try {
      await window.electronAPI.deleteDebateSession(id);
      const { activeDebateId } = get();
      if (activeDebateId === id) {
        set({ activeDebateId: null, activeDebate: null });
      }
      await get().loadSessions();
    } catch (err) {
      set({ debateError: String(err) });
    }
  },

  closeDebate: () => {
    set({ activeDebateId: null, activeDebate: null, debateError: null, debateGenerating: null });
  },

  addTranscriptEntry: (entry) => {
    const { activeDebate } = get();
    if (!activeDebate) return;
    const full: TranscriptEntry = {
      ...entry,
      id: generateId(),
      timestamp: nowISO(),
    };
    const updated: DebateSession = {
      ...activeDebate,
      updated_at: nowISO(),
      transcript: [...activeDebate.transcript, full],
    };
    set({ activeDebate: updated });
  },

  updatePhase: (phase) => {
    const { activeDebate } = get();
    if (!activeDebate) return;
    set({ activeDebate: { ...activeDebate, phase, updated_at: nowISO() } });
  },

  updateTopic: (topic) => {
    const { activeDebate } = get();
    if (!activeDebate) return;
    set({
      activeDebate: {
        ...activeDebate,
        topic: { ...activeDebate.topic, ...topic },
        updated_at: nowISO(),
      },
    });
  },

  saveDebate: async () => {
    const { activeDebate } = get();
    if (!activeDebate) return;
    try {
      await window.electronAPI.saveDebateSession(activeDebate);
      // Update session list entry
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === activeDebate.id
            ? { ...s, title: activeDebate.title, updated_at: activeDebate.updated_at, phase: activeDebate.phase }
            : s,
        ),
      }));
    } catch (err) {
      set({ debateError: String(err) });
    }
  },

  setGenerating: (pover) => set({ debateGenerating: pover }),
  setError: (error) => set({ debateError: error }),
}));
