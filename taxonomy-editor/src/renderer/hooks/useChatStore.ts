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
import { useTaxonomyStore, getStoredModel } from './useTaxonomyStore';
import { extractHttpUrls } from '../../../../lib/url-fetch/extractHttpUrls';
import { mapErrorToUserMessage } from '../utils/errorMessages';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { api } from '@bridge';
import type { UrlContextMetadata } from '@lib/ai-client/index';
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
  return getStoredModel();
}

function isUrlContextMetadata(payload: unknown): payload is UrlContextMetadata {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p.urlMetadata)) return false;
  return (p.urlMetadata as unknown[]).every(
    (e) => typeof e === 'object' && e !== null &&
      typeof (e as Record<string, unknown>).retrievedUrl === 'string' &&
      typeof (e as Record<string, unknown>).urlRetrievalStatus === 'string',
  );
}

async function streamChatWithProgress(
  systemInstruction: string,
  messages: { role: 'user' | 'model'; content: string }[],
  model: string,
  temperature: number,
  activity: string,
  set: (partial: Partial<ChatStore>) => void,
  onChunk: (chunk: string) => void,
  urlContext?: boolean,
  chatSessionId?: string,
): Promise<{ text: string; urlContextMetadata?: UrlContextMetadata }> {
  set({ chatActivity: activity, chatStreamingText: null });
  let urlContextMetadata: UrlContextMetadata | undefined;
  const unsubChunk = api.onChatStreamChunk(onChunk);
  const unsubMeta = api.onChatStreamUrlMetadata?.((payload) => {
    if (isUrlContextMetadata(payload)) {
      urlContextMetadata = payload;
      getGlobalRecorder()?.record({
        type: 'chat.url-context-result',
        component: 'chat-store',
        level: 'info',
        message: 'URL context metadata received',
        data: {
          entry_count: payload.urlMetadata.length,
          success_count: payload.urlMetadata.filter(e => e.urlRetrievalStatus === 'SUCCESS').length,
        },
      });
    } else {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'chat-store', level: 'debug', message: 'onChatStreamUrlMetadata payload did not match UrlContextMetadata shape', error: { name: 'TypeError', message: 'Non-conforming url-context metadata', stack: '' } });
    }
  });
  try {
    const text = await api.startChatStream(systemInstruction, messages, model, temperature, urlContext, chatSessionId ? { chatSessionId } : undefined);
    return { text, urlContextMetadata };
  } finally {
    unsubChunk();
    unsubMeta?.();
    set({ chatStreamingText: null, chatActivity: null });
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

/** Remove reasoning-model `<think>…</think>` / `<thinking>…</thinking>` blocks that
 *  DeepSeek/Groq prepend before their JSON, so they never leak into user-visible
 *  content (t/2453 — production bug: the raw think dump was rendered in chat). */
function stripThinkingBlocks(text: string): string {
  return text.replace(/<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
}

/** Parse the POVer's JSON response into content + taxonomy refs */
export function parseChatResponse(text: string, model?: string): { response: string; taxonomyRefs: TaxonomyRef[] } {
  const stripped = stripThinkingBlocks(text);
  // Observability (t/2454): a stripped-vs-input difference means a reasoning model
  // (DeepSeek/Groq) emitted a <think> block. Record it so thinking-model incidents are
  // diagnosable from a flight-recorder dump without a live repro. Silent otherwise.
  if (stripped !== text.trim()) {
    getGlobalRecorder()?.record({
      type: 'chat.thinking-stripped',
      component: 'chat-store',
      level: 'debug',
      message: 'Stripped thinking block from model response',
      data: { model: model ?? null, blockLength: text.length - stripped.length },
    });
  }
  try {
    const parsed = JSON.parse(stripCodeFences(stripped));
    const response = parsed.response || stripped;
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
    return { response: stripped, taxonomyRefs: [] };
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
  chatStreamingText: string | null;
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
  appendStreamingText: (chunk: string) => void;
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
  chatStreamingText: null,
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

  appendStreamingText: (chunk) => {
    set((state) => ({ chatStreamingText: (state.chatStreamingText ?? '') + chunk }));
  },

  generateOpening: async () => {
    const { activeChat, saveChat, chatGenerating } = get();
    if (!activeChat || activeChat.transcript.length > 0 || chatGenerating) return;

    const isStillValid = createChatGuard(get);
    set({ chatGenerating: true, chatError: null, chatStreamingText: null });

    try {
      const info = POVER_INFO[activeChat.pover];
      const ctx = getTaxonomyContext(info.pov);
      const taxonomyBlock = formatTaxonomyContext(ctx, info.pov, undefined, CHAT_CONTEXT_CONFIG);
      const model = getConfiguredModel();
      const temperature = CHAT_MODE_TEMPERATURE[activeChat.mode];

      const systemInstruction = chatSystemPrompt(
        info.label, info.pov, info.personality,
        activeChat.mode, activeChat.topic, taxonomyBlock,
      );
      const userContent = chatOpeningPrompt(activeChat.mode, activeChat.topic);

      const { text: fullText } = await streamChatWithProgress(
        systemInstruction,
        [{ role: 'user', content: userContent }],
        model,
        temperature,
        `${info.label} is thinking...`,
        set,
        (chunk) => get().appendStreamingText(chunk),
        undefined,
        activeChat.id,
      );

      if (!isStillValid()) return;

      const { response, taxonomyRefs } = parseChatResponse(fullText, model);

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
      set({ chatError: `Failed to start conversation: ${mapErrorToUserMessage(err)}`, chatStreamingText: null });
      // createChat pre-saved an empty session before generation; the opening never landed, so remove
      // it from storage + the sidebar list rather than leaving a stale empty chat (t/2491). Cleanup
      // failures must not mask the original error, so they're swallowed after being recorded.
      try {
        await api.deleteChatSession(activeChat.id);
        const sessions = await api.listChatSessions();
        set({ sessions: sessions as ChatSessionSummary[] });
      } catch (cleanupErr) {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'chat-store', level: 'warn', message: 'Failed to clean up empty chat session after opening failure', error: { name: (cleanupErr as Error).name ?? 'Error', message: String(cleanupErr), stack: (cleanupErr as Error).stack } });
      }
    } finally {
      set({ chatGenerating: false });
    }
  },

  sendMessage: async (message) => {
    const { activeChat, chatGenerating } = get();
    if (!activeChat || !message.trim() || chatGenerating) return;

    const isStillValid = createChatGuard(get);
    set({ chatGenerating: true, chatError: null, chatStreamingText: null });

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

    getGlobalRecorder()?.record({
      type: 'chat.user-message',
      component: 'chat-store',
      level: 'info',
      message: 'User sent chat message',
      data: {
        message_text: message.trim().slice(0, 500),
        chat_session_id: activeChat.id,
        pover: activeChat.pover,
        transcript_length: withUserMsg.transcript.length,
      },
    });

    try {
      const info = POVER_INFO[activeChat.pover];
      const ctx = getTaxonomyContext(info.pov);
      const taxonomyBlock = formatTaxonomyContext(ctx, info.pov, undefined, CHAT_CONTEXT_CONFIG);
      const model = getConfiguredModel();
      const temperature = CHAT_MODE_TEMPERATURE[activeChat.mode];

      const detectedUrls = extractHttpUrls(message.trim());
      const urlDetected = detectedUrls.length > 0;
      const urlContext = urlDetected;
      getGlobalRecorder()?.record({
        type: 'chat.url-context-decision',
        component: 'chat-store',
        level: 'info',
        message: 'URL context gating decision',
        data: {
          url_detected: urlDetected,
          url_context_enabled: urlContext,
          gating_reason: !urlDetected ? 'no-url' : 'enabled',
          ingestion_path: urlContext ? 'provider' : 'none',
          model,
        },
      });
      const systemInstruction = chatSystemPrompt(
        info.label, info.pov, info.personality,
        activeChat.mode, activeChat.topic, taxonomyBlock,
        urlContext,
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
      const userContent = chatContinuationPrompt(message.trim(), transcriptText, priorClaims);

      const activity = urlContext
        ? `Fetching page for ${info.label}…`
        : `${info.label} is thinking…`;
      const { text: fullText, urlContextMetadata } = await streamChatWithProgress(
        systemInstruction,
        [{ role: 'user', content: userContent }],
        model,
        temperature,
        activity,
        set,
        (chunk) => get().appendStreamingText(chunk),
        urlContext,
        activeChat.id,
      );

      if (!isStillValid()) return;

      const { response, taxonomyRefs } = parseChatResponse(fullText, model);

      const poverEntry: ChatEntry = {
        id: generateId(),
        timestamp: nowISO(),
        speaker: activeChat.pover,
        content: response,
        taxonomy_refs: taxonomyRefs,
        ...(urlContextMetadata && { url_context_metadata: urlContextMetadata }),
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
      set({ chatError: `Response failed: ${mapErrorToUserMessage(err)}`, chatStreamingText: null });
    } finally {
      set({ chatGenerating: false });
    }
  },
}));
