// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OpeningActions } from './OpeningPanel';

// ── Mocks ────────────────────────────────────────────────────

const mockStore: Record<string, any> = {
  activeDebate: null,
  debateGenerating: null,
  debateError: null,
  submitUserOpening: vi.fn(),
  runOpeningStatements: vi.fn(),
};

vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: Object.assign(
    (selector: any) => selector(mockStore),
    { getState: () => mockStore },
  ),
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: any) => fn,
}));

vi.mock('../../types/debate', () => ({
  POVER_INFO: {
    accelerationist: { label: 'Accelerationist', color: 'var(--color-acc)' },
    safetyist: { label: 'Safetyist', color: 'var(--color-saf)' },
    skeptic: { label: 'Skeptic', color: 'var(--color-skp)' },
  },
}));

afterEach(() => { vi.clearAllMocks(); });

// ── OpeningActions ──────────────────────────────────────────

describe('OpeningActions', () => {
  it('renders nothing when no active debate', () => {
    mockStore.activeDebate = null;
    const { container } = render(<OpeningActions />);
    expect(container.innerHTML).toBe('');
  });

  it('shows generating hint when debate is generating', () => {
    mockStore.activeDebate = {
      active_povers: ['accelerationist', 'safetyist'],
      user_is_pover: false,
      transcript: [],
    };
    mockStore.debateGenerating = 'accelerationist';
    render(<OpeningActions />);
    expect(screen.getByText('Delivering opening statements...')).toBeInTheDocument();
  });

  it('shows user opening form when user is a pover and has not submitted', () => {
    mockStore.activeDebate = {
      active_povers: ['accelerationist', 'safetyist', 'user'],
      user_is_pover: true,
      transcript: [],
    };
    mockStore.debateGenerating = null;
    render(<OpeningActions />);
    expect(screen.getByPlaceholderText('Your opening statement...')).toBeInTheDocument();
  });

  it('shows resume button when AI povers are missing openings', () => {
    mockStore.activeDebate = {
      active_povers: ['accelerationist', 'safetyist'],
      user_is_pover: false,
      transcript: [
        { type: 'opening', speaker: 'accelerationist', id: 'o1', content: 'Opening 1', timestamp: '' },
      ],
    };
    mockStore.debateGenerating = null;
    render(<OpeningActions />);
    expect(screen.getByText('Resume Opening Statements')).toBeInTheDocument();
  });

  it('shows completion message when all openings are delivered', () => {
    mockStore.activeDebate = {
      active_povers: ['accelerationist', 'safetyist'],
      user_is_pover: false,
      transcript: [
        { type: 'opening', speaker: 'accelerationist', id: 'o1', content: 'Opening 1', timestamp: '' },
        { type: 'opening', speaker: 'safetyist', id: 'o2', content: 'Opening 2', timestamp: '' },
      ],
    };
    mockStore.debateGenerating = null;
    render(<OpeningActions />);
    expect(screen.getByText('Opening statements complete.')).toBeInTheDocument();
  });
});
