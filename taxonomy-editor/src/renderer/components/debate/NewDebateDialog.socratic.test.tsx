// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AI_POVERS } from '@lib/debate/types';

// t/2519: NewDebateDialog socratic protocol UX — auto-select 1 POV on preset
// selection, radio-lock + dim in Screen B voices section, "You" disabled.

vi.mock('../../hooks/useGeminiOnboarding', () => ({
  useGeminiOnboarding: () => ({ modalProps: { open: false, onClose: () => {} }, checkAndShow: vi.fn() }),
}));

vi.mock('../../hooks/useTierInfo', () => ({
  useTierInfo: () => ({ tier: null, usage: null, loading: false, refresh: vi.fn() }),
  isFreeTier: () => false,
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
    backendForModelWithFallback: () => 'gemini',
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
  GeminiOnboardingModal: () => null,
}));

vi.mock('../../hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ anonymous: false }),
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

function openScreenBVoices() {
  fireEvent.click(screen.getByRole('button', { name: /change voices/i }));
}

describe('NewDebateDialog — socratic single-POV UX (t/2519)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('selecting socratic preset auto-selects exactly 1 POV and clears "You"', () => {
    render(<NewDebateDialog onClose={() => {}} />);

    // All AI_POVERS shown by default
    const chipList = screen.getByRole('list', { name: /selected debaters/i });
    expect(within(chipList).getAllByRole('listitem')).toHaveLength(AI_POVERS.length);

    fireEvent.click(screen.getByText('Socratic'));

    // Exactly 1 chip; no "You" listitem
    expect(within(chipList).getAllByRole('listitem')).toHaveLength(1);
    expect(within(chipList).queryByText(/you/i)).not.toBeInTheDocument();
  });

  it('Screen B voices section radio-locks when socratic: clicking a debater replaces selection', () => {
    render(<NewDebateDialog onClose={() => {}} />);
    fireEvent.click(screen.getByText('Socratic'));
    openScreenBVoices();

    // Exactly 1 AI_POVER checkbox is checked (the auto-selected one)
    const allBoxes = screen.getAllByRole('checkbox');
    const checked = allBoxes.filter(cb => (cb as HTMLInputElement).checked);
    expect(checked).toHaveLength(1);

    // Click a different (unchecked, non-disabled) debater checkbox
    const switchTarget = allBoxes.find(
      cb => !(cb as HTMLInputElement).checked && !(cb as HTMLInputElement).disabled,
    );
    expect(switchTarget).toBeDefined();
    fireEvent.click(switchTarget!);

    // Still exactly 1 checked — the clicked one replaced the previous
    const nowChecked = screen.getAllByRole('checkbox').filter(cb => (cb as HTMLInputElement).checked);
    expect(nowChecked).toHaveLength(1);
    expect(nowChecked[0]).toBe(switchTarget);
  });

  it('"You" checkbox is disabled in Screen B when socratic protocol active', () => {
    render(<NewDebateDialog onClose={() => {}} />);
    fireEvent.click(screen.getByText('Socratic'));
    openScreenBVoices();

    const youCheckbox = screen.getByRole('checkbox', { name: /you/i });
    expect(youCheckbox).toBeDisabled();
    expect(youCheckbox).not.toBeChecked();
  });

  it('handleReset to socratic basePreset produces exactly 1 checked POV and disabled "You"', () => {
    render(<NewDebateDialog onClose={() => {}} />);
    fireEvent.click(screen.getByText('Socratic'));
    openScreenBVoices();

    fireEvent.click(screen.getByRole('button', { name: /reset to preset/i }));

    const allBoxes = screen.getAllByRole('checkbox');
    const checkedEnabled = allBoxes.filter(
      cb => (cb as HTMLInputElement).checked && !(cb as HTMLInputElement).disabled,
    );
    expect(checkedEnabled).toHaveLength(1);

    const youCheckbox = screen.getByRole('checkbox', { name: /you/i });
    expect(youCheckbox).not.toBeChecked();
    expect(youCheckbox).toBeDisabled();
  });
});
