// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getApiKeySummary: vi.fn().mockResolvedValue([]),
    openExternal: vi.fn().mockResolvedValue(undefined),
    validateApiKey: vi.fn().mockResolvedValue({ valid: true }),
    addApiKey: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@bridge', () => ({ api: mockApi }));
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

import { GeminiOnboardingModal } from './GeminiOnboardingModal';

describe('GeminiOnboardingModal — geminiAllowlisted (t/3499)', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders the "Gemini access provided" confirmation with no key input when allowlisted', () => {
    render(<GeminiOnboardingModal open onClose={onClose} geminiAllowlisted />);
    expect(screen.getByText('Gemini Access Provided')).toBeInTheDocument();
    expect(screen.getByText(/no personal API key needed/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('AIza...')).not.toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });

  it('Continue dismisses without saving a key', async () => {
    const user = userEvent.setup();
    render(<GeminiOnboardingModal open onClose={onClose} geminiAllowlisted />);

    await user.click(screen.getByText('Continue'));

    expect(onClose).toHaveBeenCalledWith('permanent-dismiss');
    expect(mockApi.addApiKey).not.toHaveBeenCalled();
  });

  it('renders the normal key-entry flow when not allowlisted', () => {
    render(<GeminiOnboardingModal open onClose={onClose} />);
    expect(screen.getByPlaceholderText('AIza...')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.queryByText('Gemini Access Provided')).not.toBeInTheDocument();
  });
});
