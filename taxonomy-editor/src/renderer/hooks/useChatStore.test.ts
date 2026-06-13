// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockApi } = vi.hoisted(() => {
  const mockApi = {
    listChatSessions: vi.fn().mockResolvedValue([]),
    loadChatSession: vi.fn(),
    saveChatSession: vi.fn().mockResolvedValue(undefined),
    deleteChatSession: vi.fn().mockResolvedValue(undefined),
    generateText: vi.fn().mockResolvedValue({ text: '{"response":"hello","taxonomy_refs":[]}' }),
    onGenerateTextProgress: vi.fn().mockReturnValue(() => {}),
    setDebateTemperature: vi.fn().mockResolvedValue(undefined),
    hasApiKey: vi.fn().mockResolvedValue(true),
    startChatStream: vi.fn().mockResolvedValue('streamed-text'),
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
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

import { useChatStore } from './useChatStore';

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
      chatProgress: null,
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
});
