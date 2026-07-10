// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// t/1479: handleStart() must thread the locally-computed `freeTier` into the
// Gemini onboarding check so free-tier/anonymous sessions (which use the server
// key, not BYOK) are never prompted for a Gemini key. This guards the *wiring* —
// the hook's own free-tier short-circuit is covered in t/1478's scope.

// A never-resolving promise blocks handleStart's create path right after the
// onboarding check, so we assert the call without driving createDebate et al.
const checkAndShow = vi.fn(() => new Promise<boolean>(() => {}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tierValue: any;

vi.mock('../../hooks/useGeminiOnboarding', () => ({
  useGeminiOnboarding: () => ({ modalProps: { open: false, onClose: () => {} }, checkAndShow }),
}));

vi.mock('../../hooks/useTierInfo', () => ({
  useTierInfo: () => ({ tier: tierValue, usage: null, loading: false, refresh: vi.fn() }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  isFreeTier: (t: any) => t?.level === 'free',
}));

vi.mock('../../hooks/useDebateStore', () => {
  const hook = () => ({ createDebate: vi.fn().mockResolvedValue('deb-1'), loadDebate: vi.fn() });
  hook.getState = () => ({ updatePhase: vi.fn(), saveDebate: vi.fn().mockResolvedValue(undefined) });
  return { useDebateStore: hook };
});

vi.mock('../../hooks/useTaxonomyStore', () => {
  const hook = () => ({ aiBackend: 'gemini', geminiModel: 'gemini-flash', situations: [] });
  hook.getState = () => ({});
  return {
    useTaxonomyStore: hook,
    MODELS_BY_BACKEND: { gemini: [{ value: 'gemini-flash', label: 'Flash' }] },
    AI_BACKENDS: [{ value: 'gemini', label: 'Gemini' }],
    DEBATE_TIERS: [],
    FALLBACK_CHAINS: {},
    initAIModels: vi.fn().mockResolvedValue(undefined),
    backendForModel: () => 'gemini',
  };
});

vi.mock('@bridge', () => ({
  api: {
    hasApiKey: vi.fn().mockResolvedValue(true),
    getAvailableBackends: vi.fn().mockResolvedValue([]),
    refreshAIModels: vi.fn().mockResolvedValue(undefined),
    generateText: vi.fn().mockResolvedValue({ text: '' }),
    pickDocumentFile: vi.fn(),
    fetchUrlContent: vi.fn(),
    openDebateWindow: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../settings/GeminiOnboardingModal', () => ({
  GeminiOnboardingModal: ({ open }: { open: boolean }) => (open ? <div data-testid="gemini-modal" /> : null),
  shouldShowGeminiOnboarding: () => true,
  clearSessionDismiss: () => {},
}));

vi.mock('../../lib/clientConfig', () => ({
  getClientConfig: () => ({
    debate: { defaultConfrontationRounds: 2, defaultArgumentationRounds: 2, defaultConcludingRounds: 1 },
  }),
}));

const freeTier = {
  level: 'free',
  pinnedModel: 'gemini-flash',
  allowedBackends: ['gemini'],
  limits: { requestsPerMinute: 5, tokensPerDay: 100_000 },
};
const byokTier = {
  level: 'byok',
  pinnedModel: null,
  allowedBackends: ['gemini'],
  limits: { requestsPerMinute: 60, tokensPerDay: 1_000_000 },
};

const { NewDebateDialog } = await import('./NewDebateDialog');

async function fillTopicAndStart() {
  const topic = await screen.findByPlaceholderText(/what should we debate/i);
  fireEvent.change(topic, { target: { value: 'Should we pause frontier training?' } });
  const startBtn = screen.getByRole('button', { name: /start debate/i });
  await waitFor(() => expect(startBtn).not.toBeDisabled());
  fireEvent.click(startBtn);
}

describe('NewDebateDialog — free-tier Gemini onboarding (t/1479)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('passes freeTier=true into the onboarding check on a free-tier session (no BYOK prompt)', async () => {
    tierValue = freeTier;
    render(<NewDebateDialog onClose={() => {}} />);
    await fillTopicAndStart();

    await waitFor(() => expect(checkAndShow).toHaveBeenCalledWith({ freeTier: true }));
    expect(screen.queryByTestId('gemini-modal')).not.toBeInTheDocument();
  });

  it('passes freeTier=false on a non-free (BYOK) session so the check still runs', async () => {
    tierValue = byokTier;
    render(<NewDebateDialog onClose={() => {}} />);
    await fillTopicAndStart();

    await waitFor(() => expect(checkAndShow).toHaveBeenCalledWith({ freeTier: false }));
  });
});
