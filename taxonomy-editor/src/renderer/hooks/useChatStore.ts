// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import type {
  ChatSession,
  ChatSessionSummary,
  ChatMode,
  ChatEntry,
} from '../types/chat';
import type { SpeakerId, TaxonomyRef } from '../types/debate';
import { POVER_INFO } from '../types/debate';
import type { PovNode, CrossCuttingNode as SituationNode } from '../types/taxonomy';
import { useTaxonomyStore } from './useTaxonomyStore';
import { mapErrorToUserMessage } from '../utils/errorMessages';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { api } from '@bridge';
import { DEFAULT_MODEL } from '@lib/ai-client/defaults';
import { formatTaxonomyContext } from '../utils/taxonomyContext';
import type { TaxonomyContext, FormatContextConfig } from '../utils/taxonomyContext';
import {
  chatSystemPrompt,
  chatOpeningPrompt,
  chatContinuationPrompt,
  CHAT_MODE_TEMPERATURE,
} from '../prompts/chat';

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

function getConfiguredModel(): string {
  // eslint-disable-next-line @typescript-eslint/no-use-before-define -- store defined below, safe at call-time
  const chatModel = useChatStore.getState().chatModel;
  if (chatModel) return chatModel;
  try {
    return localStorage.getItem('taxonomy-editor-gemini-model') || DEFAULT_MODEL;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'chat-store', level: 'debug', message: 'Failed to read chat model from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    return DEFAULT_MODEL;
  }
}

async function generateTextWithProgress(
  prompt: string,
  model: string,
  activity: string,
  set: (partial: Partial<ChatStore>) => void,
): Promise<{ text: string }> {
  set({ chatActivity: activity, chatProgress: null });
  const unsubscribe = api.onGenerateTextProgress((progress) => {
    set({ chatProgress: progress as ChatStore['chatProgress'] });
  });
  try {
    return await api.generateText(prompt, model);
  } finally {
    unsubscribe();
    set({ chatProgress: null, chatActivity: null });
  }
}

function stripCodeFences(text: string): string {
  return text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
}

const CHAT_CONTEXT_CONFIG: FormatContextConfig = { maxNodes: 9999, maxDesires: 9999 };

function getTaxonomyContext(pov: string): TaxonomyContext {
  const state = useTaxonomyStore.getState();
  const povFile = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
  const povNodes: PovNode[] = povFile?.nodes ?? [];
  const situationNodes: SituationNode[] = state.situations?.nodes ?? [];
  return { povNodes, situationNodes };
}

/** Parse the POVer's JSON response into content + taxonomy refs */
function parseChatResponse(text: string): { response: string; taxonomyRefs: TaxonomyRef[] } {
  try {
    const parsed = JSON.parse(stripCodeFences(text));
    const response = parsed.response || text.trim();
    const taxonomyRefs: TaxonomyRef[] = Array.isArray(parsed.taxonomy_refs)
      ? parsed.taxonomy_refs
        .filter((r: Record<string, unknown>) => r.node_id && typeof r.node_id === 'string')
        .map((r: Record<string, unknown>) => ({
          node_id: r.node_id as string,
          relevance: (r.relevance as string) || '',
        }))
      : [];
    return { response, taxonomyRefs };
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'chat-store', level: 'debug', message: 'Chat response JSON parse failed, using raw text', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    return { response: text.trim(), taxonomyRefs: [] };
  }
}

/** Build transcript text for context window */
function formatTranscriptForContext(transcript: ChatEntry[], poverLabel: string): string {
  if (transcript.length === 0) return '';
  const lines: string[] = [];
  for (const entry of transcript) {
    const speaker = entry.speaker === 'user' ? 'You' : entry.speaker === 'system' ? 'System' : poverLabel;
    lines.push(`${speaker}: ${entry.content}`);
  }
  return lines.join('\n\n');
}

function createChatGuard(get: () => { activeChatId: string | null }): () => boolean {
  const capturedId = get().activeChatId;
  return () => {
    if (capturedId !== get().activeChatId) {
      console.warn(`[chat] Active chat changed during async operation`);
      return false;
    }
    return true;
  };
}

// ── Store interface ──────────────────────────────────────

interface ChatStore {
  sessions: ChatSessionSummary[];
  sessionsLoading: boolean;

  activeChatId: string | null;
  activeChat: ChatSession | null;
  chatLoading: boolean;
  chatGenerating: boolean;
  chatError: string | null;
  chatProgress: { attempt: number; maxRetries: number; backoffSeconds?: number; limitType?: string; limitMessage?: string } | null;
  chatActivity: string | null;
  chatModel: string | null;

  // Actions
  loadSessions: () => Promise<void>;
  createChat: (mode: ChatMode, pover: Exclude<SpeakerId, 'user'>, topic: string, chatModel?: string) => Promise<string>;
  loadChat: (id: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  renameChat: (id: string, newTitle: string) => Promise<void>;
  changeMode: (mode: ChatMode) => Promise<void>;
  saveChat: () => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  generateOpening: () => Promise<void>;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: [],
  sessionsLoading: false,
  activeChatId: null,
  activeChat: null,
  chatLoading: false,
  chatGenerating: false,
  chatError: null,
  chatProgress: null,
  chatActivity: null,
  chatModel: null,

  loadSessions: async () => {
    set({ sessionsLoading: true });
    try {
      const raw = await api.listChatSessions();
      set({ sessions: raw as ChatSessionSummary[] });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'chat-store', level: 'error', message: 'Failed to load chat sessions', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    } finally {
      set({ sessionsLoading: false });
    }
  },

  createChat: async (mode, pover, topic, chatModel) => {
    const id = generateId();
    const now = nowISO();
    const session: ChatSession = {
      id,
      title: topic.length > 60 ? topic.slice(0, 57) + '...' : topic,
      created_at: now,
      updated_at: now,
      mode,
      topic,
      pover,
      transcript: [],
      chat_model: chatModel,
    };
    await api.saveChatSession(session);
    api.trackEvent('chat_start', 'chat', { mode, pover });
    const sessions = await api.listChatSessions();
    set({ sessions: sessions as ChatSessionSummary[] });
    return id;
  },

  loadChat: async (id) => {
    set({ chatLoading: true, chatError: null, chatGenerating: false });
    try {
      const raw = await api.loadChatSession(id);
      const session = raw as ChatSession;
      set({
        activeChatId: session.id,
        activeChat: session,
        chatModel: session.chat_model || null,
      });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'chat-store', level: 'error', message: 'Failed to load chat session', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      set({ chatError: `Failed to load chat: ${err}` });
    } finally {
      set({ chatLoading: false });
    }
  },

  deleteChat: async (id) => {
    try {
      await api.deleteChatSession(id);
      const { activeChatId } = get();
      if (activeChatId === id) {
        set({ activeChatId: null, activeChat: null, chatModel: null });
      }
      const sessions = await api.listChatSessions();
      set({ sessions: sessions as ChatSessionSummary[] });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'chat-store', level: 'error', message: 'Failed to delete chat session', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      set({ chatError: `Failed to delete chat: ${err}` });
    }
  },

  renameChat: async (id, newTitle) => {
    const { activeChat, sessions } = get();
    if (activeChat && activeChat.id === id) {
      const updated = { ...activeChat, title: newTitle, updated_at: nowISO() };
      set({ activeChat: updated });
      await api.saveChatSession(updated);
    } else {
      // Load, rename, save
      try {
        const raw = await api.loadChatSession(id);
        const session = raw as ChatSession;
        session.title = newTitle;
        session.updated_at = nowISO();
        await api.saveChatSession(session);
      } catch (err) {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'chat-store', level: 'error', message: 'Failed to rename chat session', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      }
    }
    // Update session list
    set({
      sessions: sessions.map(s => s.id === id ? { ...s, title: newTitle, updated_at: nowISO() } : s),
    });
  },

  changeMode: async (mode) => {
    const { activeChat } = get();
    if (!activeChat) return;
    const updated = { ...activeChat, mode, updated_at: nowISO() };
    set({ activeChat: updated });
    await api.saveChatSession(updated);
    // Update session list
    const sessions = await api.listChatSessions();
    set({ sessions: sessions as ChatSessionSummary[] });
  },

  saveChat: async () => {
    const { activeChat } = get();
    if (!activeChat) return;
    const updated = { ...activeChat, updated_at: nowISO() };
    set({ activeChat: updated });
    await api.saveChatSession(updated);
  },

  generateOpening: async () => {
    const { activeChat, saveChat, chatGenerating } = get();
    if (!activeChat || activeChat.transcript.length > 0 || chatGenerating) return;

    const isStillValid = createChatGuard(get);
    set({ chatGenerating: true, chatError: null });

    try {
      const info = POVER_INFO[activeChat.pover];
      const ctx = getTaxonomyContext(info.pov);
      const taxonomyBlock = formatTaxonomyContext(ctx, info.pov, undefined, CHAT_CONTEXT_CONFIG);
      const model = getConfiguredModel();

      // Set per-mode temperature before generating
      await api.setDebateTemperature(CHAT_MODE_TEMPERATURE[activeChat.mode]);

      const systemBlock = chatSystemPrompt(
        info.label, info.pov, info.personality,
        activeChat.mode, activeChat.topic, taxonomyBlock,
      );
      const userBlock = chatOpeningPrompt(activeChat.mode, activeChat.topic);
      const prompt = `${systemBlock}\n\n${userBlock}`;

      const result = await generateTextWithProgress(
        prompt, model, `${info.label} is thinking...`, set,
      );

      if (!isStillValid()) return;

      const { response, taxonomyRefs } = parseChatResponse(result.text);

      const entry: ChatEntry = {
        id: generateId(),
        timestamp: nowISO(),
        speaker: activeChat.pover,
        content: response,
        taxonomy_refs: taxonomyRefs,
      };

      const updated = {
        ...get().activeChat!,
        transcript: [...get().activeChat!.transcript, entry],
        updated_at: nowISO(),
      };
      set({ activeChat: updated });
      await api.saveChatSession(updated);

      // Update session list
      const sessions = await api.listChatSessions();
      set({ sessions: sessions as ChatSessionSummary[] });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'chat-store', level: 'error', message: 'Failed to generate opening message', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      set({ chatError: `Failed to start conversation: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ chatGenerating: false });
    }
  },

  sendMessage: async (message) => {
    const { activeChat, chatGenerating } = get();
    if (!activeChat || !message.trim() || chatGenerating) return;

    const isStillValid = createChatGuard(get);
    set({ chatGenerating: true, chatError: null });

    // Add user message to transcript
    const userEntry: ChatEntry = {
      id: generateId(),
      timestamp: nowISO(),
      speaker: 'user',
      content: message.trim(),
      taxonomy_refs: [],
    };

    const withUserMsg = {
      ...activeChat,
      transcript: [...activeChat.transcript, userEntry],
      updated_at: nowISO(),
    };
    set({ activeChat: withUserMsg });

    try {
      const info = POVER_INFO[activeChat.pover];
      const ctx = getTaxonomyContext(info.pov);
      const taxonomyBlock = formatTaxonomyContext(ctx, info.pov, undefined, CHAT_CONTEXT_CONFIG);
      const model = getConfiguredModel();

      // Set per-mode temperature before generating
      await api.setDebateTemperature(CHAT_MODE_TEMPERATURE[activeChat.mode]);

      const systemBlock = chatSystemPrompt(
        info.label, info.pov, info.personality,
        activeChat.mode, activeChat.topic, taxonomyBlock,
      );
      const transcriptText = formatTranscriptForContext(
        withUserMsg.transcript, info.label,
      );
      // PQ-7: Extract prior claims from POVer's responses for consistency tracking
      const priorClaims = withUserMsg.transcript
        .filter(e => e.speaker !== 'user' && e.content.length > 20)
        .map(e => {
          // Take the first substantive sentence as a claim summary
          const firstSentence = e.content.match(/^[^.!?]+[.!?]/)?.[0] ?? e.content.slice(0, 120);
          return firstSentence.trim();
        })
        .filter(Boolean);
      const userBlock = chatContinuationPrompt(message.trim(), transcriptText, priorClaims);
      const prompt = `${systemBlock}\n\n${userBlock}`;

      const result = await generateTextWithProgress(
        prompt, model, `${info.label} is thinking...`, set,
      );

      if (!isStillValid()) return;

      const { response, taxonomyRefs } = parseChatResponse(result.text);

      const poverEntry: ChatEntry = {
        id: generateId(),
        timestamp: nowISO(),
        speaker: activeChat.pover,
        content: response,
        taxonomy_refs: taxonomyRefs,
      };

      const updated = {
        ...get().activeChat!,
        transcript: [...get().activeChat!.transcript, poverEntry],
        updated_at: nowISO(),
      };
      set({ activeChat: updated });
      await api.saveChatSession(updated);

      // Update session list
      const sessions = await api.listChatSessions();
      set({ sessions: sessions as ChatSessionSummary[] });
    } catch (err) {
      if (!isStillValid()) return;
      getGlobalRecorder()?.record({ type: 'system.error', component: 'chat-store', level: 'error', message: 'Failed to send chat message', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      set({ chatError: `Response failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ chatGenerating: false });
    }
  },
}));
