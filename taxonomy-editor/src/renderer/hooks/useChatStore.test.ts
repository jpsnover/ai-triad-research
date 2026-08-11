// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockApi, mockRecord } = vi.hoisted(() => {
  const mockRecord = vi.fn();
  const mockApi = {
    listChatSessions: vi.fn().mockResolvedValue([]),
    loadChatSession: vi.fn(),
    saveChatSession: vi.fn().mockResolvedValue(undefined),
    deleteChatSession: vi.fn().mockResolvedValue(undefined),
    setDebateTemperature: vi.fn().mockResolvedValue(undefined),
    hasApiKey: vi.fn().mockResolvedValue(true),
    startChatStream: vi.fn().mockResolvedValue('{"response":"hello","taxonomy_refs":[]}'),
    onChatStreamChunk: vi.fn().mockReturnValue(() => {}),
    trackEvent: vi.fn(),
  };
  return { mockApi };
});

vi.mock('@bridge', () => ({ api: mockApi }));

vi.mock('./useTaxonomyStore', () => ({
  useTaxonomyStore: {
    getState: () => ({
      accelerationist: { nodes: [] },
      safetyist: { nodes: [] },
      skeptic: { nodes: [] },
      situations: { nodes: [] },
      aiBackend: 'gemini',
      geminiModel: 'gemini-flash-lite-latest',
    }),
  },
  MODELS_BY_BACKEND: { gemini: [{ value: 'gemini-flash-lite-latest', label: 'Flash Lite' }] },
}));

vi.mock('../utils/taxonomyContext', () => ({
  formatTaxonomyContext: vi.fn().mockReturnValue('mock-taxonomy-context'),
}));

vi.mock('../utils/errorMessages', () => ({
  mapErrorToUserMessage: (err: unknown) => err instanceof Error ? err.message : String(err),
}));

vi.mock('../prompts/chat', () => ({
  chatSystemPrompt: vi.fn().mockReturnValue('system-prompt'),
  chatOpeningPrompt: vi.fn().mockReturnValue('opening-prompt'),
  chatContinuationPrompt: vi.fn().mockReturnValue('continuation-prompt'),
  CHAT_MODE_TEMPERATURE: { brainstorm: 0.9, inform: 0.3, decide: 0.5 },
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

import { useChatStore, parseChatResponse } from './useChatStore';

function makeChatSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chat-1',
    title: 'Test Chat',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    mode: 'brainstorm',
    topic: 'Test topic',
    pover: 'accelerationist',
    transcript: [],
    ...overrides,
  };
}

describe('useChatStore', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    useChatStore.setState({
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
    });
  });

  describe('loadChat', () => {
    it('sets activeChatId and activeChat from loaded session', async () => {
      const session = makeChatSession({ id: 'chat-42' });
      mockApi.loadChatSession.mockResolvedValueOnce(session);

      await useChatStore.getState().loadChat('chat-42');

      const state = useChatStore.getState();
      expect(state.activeChatId).toBe('chat-42');
      expect(state.activeChat).toEqual(session);
      expect(state.chatLoading).toBe(false);
    });

    it('clears chatGenerating when loading a new chat', async () => {
      useChatStore.setState({ chatGenerating: true });
      const session = makeChatSession({ id: 'chat-new' });
      mockApi.loadChatSession.mockResolvedValueOnce(session);

      await useChatStore.getState().loadChat('chat-new');

      expect(useChatStore.getState().chatGenerating).toBe(false);
    });

    it('sets chatModel from session', async () => {
      const session = makeChatSession({ id: 'chat-m', chat_model: 'gemini-2.5-flash' });
      mockApi.loadChatSession.mockResolvedValueOnce(session);

      await useChatStore.getState().loadChat('chat-m');

      expect(useChatStore.getState().chatModel).toBe('gemini-2.5-flash');
    });

    it('sets chatModel to null when session has no custom model', async () => {
      useChatStore.setState({ chatModel: 'old-model' });
      const session = makeChatSession({ id: 'chat-default' });
      mockApi.loadChatSession.mockResolvedValueOnce(session);

      await useChatStore.getState().loadChat('chat-default');

      expect(useChatStore.getState().chatModel).toBeNull();
    });

    it('records error and sets chatError on failure', async () => {
      mockApi.loadChatSession.mockRejectedValueOnce(new Error('not found'));

      await useChatStore.getState().loadChat('bad-id');

      const state = useChatStore.getState();
      expect(state.chatError).toContain('Failed to load chat');
      expect(state.chatLoading).toBe(false);
      expect(state.activeChatId).toBeNull();
    });
  });

  describe('createChat', () => {
    it('creates a session, saves it, and returns the id', async () => {
      mockApi.listChatSessions.mockResolvedValueOnce([]);

      const id = await useChatStore.getState().createChat('brainstorm', 'accelerationist', 'My topic');

      expect(id).toBeTruthy();
      expect(mockApi.saveChatSession).toHaveBeenCalledOnce();
      const saved = mockApi.saveChatSession.mock.calls[0][0];
      expect(saved.id).toBe(id);
      expect(saved.mode).toBe('brainstorm');
      expect(saved.pover).toBe('accelerationist');
      expect(saved.topic).toBe('My topic');
      expect(saved.transcript).toEqual([]);
    });

    it('truncates long titles', async () => {
      mockApi.listChatSessions.mockResolvedValueOnce([]);
      const longTopic = 'A'.repeat(100);

      await useChatStore.getState().createChat('inform', 'safetyist', longTopic);

      const saved = mockApi.saveChatSession.mock.calls[0][0];
      expect(saved.title.length).toBeLessThanOrEqual(60);
      expect(saved.title).toContain('...');
    });
  });

  describe('deleteChat', () => {
    it('clears activeChat if deleting the active session', async () => {
      useChatStore.setState({
        activeChatId: 'chat-del',
        activeChat: makeChatSession({ id: 'chat-del' }) as never,
        chatModel: 'some-model',
      });
      mockApi.listChatSessions.mockResolvedValueOnce([]);

      await useChatStore.getState().deleteChat('chat-del');

      const state = useChatStore.getState();
      expect(state.activeChatId).toBeNull();
      expect(state.activeChat).toBeNull();
      expect(state.chatModel).toBeNull();
    });

    it('preserves activeChat when deleting a different session', async () => {
      useChatStore.setState({
        activeChatId: 'chat-keep',
        activeChat: makeChatSession({ id: 'chat-keep' }) as never,
      });
      mockApi.listChatSessions.mockResolvedValueOnce([]);

      await useChatStore.getState().deleteChat('chat-other');

      expect(useChatStore.getState().activeChatId).toBe('chat-keep');
    });
  });

  describe('duplicate request guard (t/1453)', () => {
    it('sendMessage is a no-op when chatGenerating is already true', async () => {
      useChatStore.setState({
        activeChat: makeChatSession({ transcript: [{ id: 'e1', timestamp: '2026-01-01T00:00:00Z', speaker: 'ai', content: 'hi', taxonomy_refs: [] }] }) as never,
        chatGenerating: true,
      });

      await useChatStore.getState().sendMessage('duplicate request');

      expect(mockApi.startChatStream).not.toHaveBeenCalled();
    });

    it('generateOpening is a no-op when chatGenerating is already true', async () => {
      useChatStore.setState({
        activeChat: makeChatSession() as never,
        chatGenerating: true,
      });

      await useChatStore.getState().generateOpening();

      expect(mockApi.startChatStream).not.toHaveBeenCalled();
    });
  });

  describe('streaming (t/2251)', () => {
    it('transcript entry content equals concatenated stream chunks', async () => {
      const chunks = ['Hello', ', ', 'world', '!'];
      let chunkCb: ((chunk: string) => void) | null = null;

      mockApi.onChatStreamChunk.mockImplementationOnce((cb: (chunk: string) => void) => {
        chunkCb = cb;
        return () => { chunkCb = null; };
      });
      mockApi.startChatStream.mockImplementationOnce(async () => {
        chunks.forEach(c => chunkCb?.(c));
        return chunks.join('');
      });
      mockApi.listChatSessions.mockResolvedValueOnce([]);

      useChatStore.setState({
        activeChat: makeChatSession({
          transcript: [{ id: 'e1', timestamp: '2026-01-01T00:00:00Z', speaker: 'accelerationist', content: 'Opening', taxonomy_refs: [] }],
        }) as never,
      });

      await useChatStore.getState().sendMessage('follow-up');

      const state = useChatStore.getState();
      const lastEntry = state.activeChat!.transcript[state.activeChat!.transcript.length - 1];
      expect(lastEntry.content).toBe(chunks.join(''));
      expect(state.chatStreamingText).toBeNull();
      expect(state.chatGenerating).toBe(false);
    });

    it('chatStreamingText is cleared on error', async () => {
      mockApi.onChatStreamChunk.mockImplementationOnce((cb: (chunk: string) => void) => {
        cb('partial');
        return () => {};
      });
      mockApi.startChatStream.mockRejectedValueOnce(new Error('stream failed'));
      mockApi.listChatSessions.mockResolvedValue([]);

      useChatStore.setState({
        activeChat: makeChatSession({
          transcript: [{ id: 'e1', timestamp: '2026-01-01T00:00:00Z', speaker: 'accelerationist', content: 'Hi', taxonomy_refs: [] }],
        }) as never,
      });

      await useChatStore.getState().sendMessage('test');

      const state = useChatStore.getState();
      expect(state.chatStreamingText).toBeNull();
      expect(state.chatError).toContain('Response failed');
    });
  });

  // t/2453 — reasoning models (DeepSeek/Groq) prepend <think>…</think> before their
  // JSON; those blocks must never reach user-visible content via any fallback path.
  describe('parseChatResponse — strips reasoning <think> blocks (t/2453)', () => {
    const THINK = '<think>internal chain of thought\nspanning lines</think>';

    it('strips the think block on the JSON-parse-failure fallback', () => {
      const r = parseChatResponse(THINK + 'plain prose, not JSON');
      expect(r.response).toBe('plain prose, not JSON');
      expect(r.response).not.toMatch(/<think/i);
      expect(r.taxonomyRefs).toEqual([]);
    });

    it('parses JSON that is prefixed by a think block', () => {
      const r = parseChatResponse(THINK + '{"response":"hi","taxonomy_refs":[{"node_id":"acc-B-001","relevance":"x"}]}');
      expect(r.response).toBe('hi');
      expect(r.taxonomyRefs).toEqual([{ node_id: 'acc-B-001', relevance: 'x' }]);
    });

    it('strips the think block when parsed JSON has no response field (raw-text fallback)', () => {
      const r = parseChatResponse(THINK + '{"taxonomy_refs":[]}');
      expect(r.response).not.toMatch(/<think/i);
      expect(r.response).toBe('{"taxonomy_refs":[]}');
    });

    it('handles the <thinking> variant, case-insensitively', () => {
      expect(parseChatResponse('<THINKING>x</THINKING>done').response).toBe('done');
    });

    it('leaves think-free responses unchanged', () => {
      expect(parseChatResponse('{"response":"ok"}').response).toBe('ok');
      expect(parseChatResponse('just text').response).toBe('just text');
    });
  });

  // t/2454 — observability: emit a flight-recorder event when a <think> block is stripped,
  // so thinking-model incidents are diagnosable from a dump without a live repro.
  describe('parseChatResponse — records chat.thinking-stripped (t/2454)', () => {
    beforeEach(() => { mockRecord.mockClear(); });

    it('records chat.thinking-stripped with model + byte count when a block is stripped', () => {
      const text = '<think>reasoning</think>{"response":"hi"}';
      parseChatResponse(text, 'deepseek-r1');
      const rec = mockRecord.mock.calls.map(c => c[0]).find(r => r.type === 'chat.thinking-stripped');
      expect(rec).toBeTruthy();
      expect(rec.component).toBe('chat-store');
      expect(rec.level).toBe('debug');
      expect(rec.data.model).toBe('deepseek-r1');
      expect(rec.data.blockLength).toBe(text.length - '{"response":"hi"}'.length);
    });

    it('emits no chat.thinking-stripped record for a think-free response (no noise)', () => {
      parseChatResponse('{"response":"ok"}', 'gemini-flash');
      expect(mockRecord.mock.calls.map(c => c[0]).some(r => r.type === 'chat.thinking-stripped')).toBe(false);
    });

    it('records model as null when the model is unknown', () => {
      parseChatResponse('<think>x</think>hi');
      const rec = mockRecord.mock.calls.map(c => c[0]).find(r => r.type === 'chat.thinking-stripped');
      expect(rec.data.model).toBeNull();
    });
  });
});
