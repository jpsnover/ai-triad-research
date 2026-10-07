// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { eligibleDebateBackends } from '@lib/ai-client/modelRouter';

// t/4046 (SO condition on t/4040): threading eligibleBackends from the multi-provider setup
// into CreateDebateOptions. The constraint (e/268#2-#4) is that the test calls the SAME real
// functions the dialog calls — resolveMultiProviderModels + eligibleDebateBackends — rather
// than hand-building the expected eligible list.

const TEST_DEBATE_TIERS = { basic: { gemini: 'gemini-flash', claude: 'claude-haiku' } };

vi.mock('../../hooks/useGeminiOnboarding', () => ({
  useGeminiOnboarding: () => ({ modalProps: { open: false, onClose: () => {} }, checkAndShow: vi.fn() }),
}));

vi.mock('../../hooks/useTierInfo', () => ({
  useTierInfo: () => ({ tier: null, usage: null, loading: false, refresh: vi.fn() }),
  isFreeTier: () => false,
}));

const mockCreateDebate = vi.hoisted(() => vi.fn().mockResolvedValue('deb-1'));

vi.mock('../../hooks/useDebateStore', () => {
  const hook = () => ({ createDebate: mockCreateDebate, loadDebate: vi.fn() });
  hook.getState = () => ({ updatePhase: vi.fn(), saveDebate: vi.fn().mockResolvedValue(undefined) });
  return { useDebateStore: hook };
});

vi.mock('../../hooks/useTaxonomyStore', () => {
  const hook = () => ({ aiBackend: 'gemini', geminiModel: 'gemini-flash', situations: [] });
  hook.getState = () => ({});
  return {
    useTaxonomyStore: hook,
    MODELS_BY_BACKEND: { gemini: [{ value: 'gemini-flash', label: 'Flash' }] },
    AI_BACKENDS: [{ value: 'gemini', label: 'Gemini' }, { value: 'claude', label: 'Claude' }],
    DEBATE_TIERS: TEST_DEBATE_TIERS,
    FALLBACK_CHAINS: {},
    initAIModels: vi.fn().mockResolvedValue(undefined),
    backendForModel: () => 'gemini',
    backendForModelWithFallback: () => 'gemini',
  };
});

vi.mock('@bridge', () => ({
  api: {
    hasApiKey: vi.fn().mockResolvedValue(true),
    getAvailableBackends: vi.fn().mockResolvedValue([{ id: 'gemini', available: true }, { id: 'claude', available: true }]),
    refreshAIModels: vi.fn().mockResolvedValue(undefined),
    generateText: vi.fn().mockResolvedValue({ text: '' }),
    pickDocumentFile: vi.fn(),
    fetchUrlContent: vi.fn(),
    openDebateWindow: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../settings/GeminiOnboardingModal', () => ({
  GeminiOnboardingModal: () => null,
}));

vi.mock('../../hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ anonymous: false }),
  useUserProfile: () => null,
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const { NewDebateDialog } = await import('./NewDebateDialog');

async function enableMultiProviderAndStart() {
  render(<NewDebateDialog onClose={() => {}} />);

  fireEvent.change(screen.getByPlaceholderText('What should the AI debate?'), { target: { value: 'Does X cause Y?' } });

  fireEvent.click(screen.getByRole('button', { name: /advanced settings/i }));
  fireEvent.click(screen.getByRole('button', { name: /model & providers/i }));
  fireEvent.click(screen.getByRole('checkbox', { name: /multi-provider mode/i }));
  // Both backend chips (gemini, claude) start active by default — no further clicks needed.
  fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));

  await screen.findByRole('button', { name: /start debate/i });
  fireEvent.click(screen.getByRole('button', { name: /start debate/i }));
}

describe('NewDebateDialog — eligibleBackends threading (t/4046)', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCreateDebate.mockResolvedValue('deb-1'); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('passes the real eligibleDebateBackends result into createDebate options for a multi-provider run', async () => {
    await enableMultiProviderAndStart();

    await vi.waitFor(() => expect(mockCreateDebate).toHaveBeenCalled());

    const options = mockCreateDebate.mock.calls[0][10];
    const expected = eligibleDebateBackends('basic', ['gemini', 'claude'], { debateTiers: TEST_DEBATE_TIERS } as never);
    expect(expected).toEqual(['gemini', 'claude']); // control: the real function actually returns both
    expect(options.eligibleBackends).toEqual(expected);
  });

  it('control: without multi-provider mode, eligibleBackends is not sent', async () => {
    render(<NewDebateDialog onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('What should the AI debate?'), { target: { value: 'Does X cause Y?' } });
    fireEvent.click(screen.getByRole('button', { name: /start debate/i }));

    await vi.waitFor(() => expect(mockCreateDebate).toHaveBeenCalled());
    const options = mockCreateDebate.mock.calls[0][10];
    expect(options.eligibleBackends).toBeUndefined();
  });
});
