// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2036 — NewChatDialog backend dropdown regression. Before the fix this dialog
// FILTERED tier-unavailable backends out of the list entirely (worse than SettingsDialog's
// disable). These assertions lock the 3-state de-conflation: every backend renders;
// no-key is selectable "(bring your own key)"; tier-forbidden is honestly "(sign in to use)";
// and a free-tier-pool backend stays plain (usable without a key).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    hasApiKey: vi.fn().mockResolvedValue(false),
    getAvailableBackends: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('@bridge', () => ({ api: mockApi }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

vi.mock('../../hooks/useChatStore', () => ({
  useChatStore: () => ({ createChat: vi.fn().mockResolvedValue('chat-1'), loadChat: vi.fn() }),
}));

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: () => ({ aiBackend: 'gemini' as const, geminiModel: 'gemini-flash' }),
  AI_BACKENDS: [
    { value: 'gemini', label: 'Google Gemini' },
    { value: 'moonshot', label: 'Moonshot' },
    { value: 'azure', label: 'Azure OpenAI' },
  ],
  MODELS_BY_BACKEND: {
    gemini: [{ value: 'gemini-flash', label: 'Flash' }],
    moonshot: [{ value: 'kimi-k2', label: 'Kimi K2' }],
    azure: [{ value: 'gpt-4o-azure', label: 'GPT-4o (Azure)' }],
  },
}));

let mockTier: { allowedBackends: string[] } | null = null;
let mockIsFree = false;
vi.mock('../../hooks/useTierInfo', () => ({
  useTierInfo: () => ({ tier: mockTier }),
  isFreeTier: () => mockIsFree,
}));

import { NewChatDialog } from './NewChatDialog';

async function revealBackendSelect() {
  const user = userEvent.setup();
  render(<NewChatDialog onClose={vi.fn()} />);
  await user.click(screen.getByLabelText(/use a different model/i));
  // The backend select is the first combobox once the custom-model fields appear.
  return screen.getAllByRole('combobox')[0];
}

describe('NewChatDialog backend dropdown (t/2036)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTier = null;
    mockIsFree = false;
    mockApi.hasApiKey.mockResolvedValue(false);
  });

  it('renders all 3 states — no filtering-out; no-key selectable, tier-restricted honest', async () => {
    mockApi.getAvailableBackends.mockResolvedValue([
      { id: 'gemini', available: true },                            // #1
      { id: 'moonshot', available: false, reason: 'no_key' },       // #2
      { id: 'azure', available: false, reason: 'tier_restricted' }, // #3
    ]);
    const select = await revealBackendSelect();
    // #3 present (not filtered out) + honest + disabled
    const azure = await within(select).findByRole('option', { name: 'Azure OpenAI (sign in to use)' });
    expect(azure).toBeDisabled();
    // #2 selectable BYOK
    const moonshot = within(select).getByRole('option', { name: 'Moonshot (bring your own key)' });
    expect(moonshot).not.toBeDisabled();
    // #1 plain
    expect(within(select).getByRole('option', { name: 'Google Gemini' })).not.toBeDisabled();
  });

  it('free-tier-pool backend stays plain + selectable (usable without a key)', async () => {
    mockIsFree = true;
    mockTier = { allowedBackends: ['gemini'] };
    // Server reports gemini no_key (pool key isn't in keyStore), but it's free-tier usable.
    mockApi.getAvailableBackends.mockResolvedValue([{ id: 'gemini', available: false, reason: 'no_key' }]);
    const select = await revealBackendSelect();
    const gemini = within(select).getByRole('option', { name: 'Google Gemini' });
    expect(gemini).not.toBeDisabled();
    expect(gemini.textContent).toBe('Google Gemini'); // no "(bring your own key)" suffix
  });
});
