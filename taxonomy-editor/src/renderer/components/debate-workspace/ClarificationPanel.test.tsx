// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState, useRef, useEffect } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClarificationCard, TopicScoreComparison } from './ClarificationPanel';
import type { TranscriptEntry } from '../../types/debate';

// ── Mocks ────────────────────────────────────────────────────

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock('remark-gfm', () => ({ default: {} }));

vi.mock('./utils', () => ({
  speakerLabel: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
  fixMarkdownLinks: (s: string) => s,
}));

const mockStore: Record<string, any> = {
  activeDebate: null,
  debateGenerating: null,
  debateError: null,
  runClarification: vi.fn(),
  submitClarificationAnswers: vi.fn(),
  runOpeningStatements: vi.fn(),
  updateRefinedTopic: vi.fn(),
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

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: (selector: any) => selector({
    getLabelForId: (id: string) => `Label ${id}`,
  }),
}));

vi.mock('../../utils/lineageMatcher', () => ({
  lineageMarkdownComponents: {},
}));

vi.mock('./TopicCritique', () => ({
  TopicCritiqueCard: () => <div data-testid="topic-critique" />,
  DIMENSION_LABELS: {},
  RATING_COLORS: {},
}));

afterEach(() => { vi.clearAllMocks(); });

// ── ClarificationCard ──────────────────────────────────────

describe('ClarificationCard', () => {
  it('renders structured questions when present in metadata', () => {
    const entry = {
      id: 'clar-1',
      speaker: 'system' as const,
      type: 'clarification' as const,
      content: 'Clarification questions',
      timestamp: new Date().toISOString(),
      metadata: {
        questions: [
          { question: 'What is the scope?', options: ['Narrow', 'Broad'] },
          { question: 'What is the timeframe?' },
        ],
      },
    } as unknown as TranscriptEntry;

    render(<ClarificationCard entry={entry} />);
    expect(screen.getByText('What is the scope?')).toBeInTheDocument();
    expect(screen.getByText('What is the timeframe?')).toBeInTheDocument();
  });

  it('renders plain markdown when no structured questions', () => {
    const entry = {
      id: 'clar-2',
      speaker: 'system' as const,
      type: 'clarification' as const,
      content: 'Please clarify your position.',
      timestamp: new Date().toISOString(),
    } as unknown as TranscriptEntry;

    render(<ClarificationCard entry={entry} />);
    expect(screen.getByText('Please clarify your position.')).toBeInTheDocument();
  });
});

// ── TopicScoreComparison ────────────────────────────────────

describe('TopicScoreComparison', () => {
  it('renders nothing when no active debate', () => {
    mockStore.activeDebate = null;
    const { container } = render(<TopicScoreComparison />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when no critiques exist', () => {
    mockStore.activeDebate = {
      topic: { original: 'Test', final: 'Test', refined: null },
      transcript: [],
    };
    const { container } = render(<TopicScoreComparison />);
    expect(container.innerHTML).toBe('');
  });
});

// ── Overflow menu keyboard accessibility (t/1457) ─────────

function OverflowMenuHarness({ collapsedCount }: { collapsedCount: number }) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target as Node) &&
          overflowTriggerRef.current && !overflowTriggerRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
        overflowTriggerRef.current?.focus();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOverflowOpen(false); overflowTriggerRef.current?.focus(); }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('keydown', handleEscape); };
  }, [overflowOpen]);

  if (collapsedCount <= 0) return null;

  return (
    <div>
      <button
        ref={overflowTriggerRef}
        data-testid="overflow-trigger"
        onClick={() => {
          const opening = !overflowOpen;
          setOverflowOpen(opening);
          if (opening) setTimeout(() => overflowMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(), 0);
        }}
        aria-haspopup="true"
        aria-expanded={overflowOpen}
        aria-label="More actions"
      >
        ⋯
      </button>
      {overflowOpen && (
        <div data-testid="overflow-menu" ref={overflowMenuRef} role="menu">
          {collapsedCount >= 1 && (
            <button role="menuitem" onClick={() => setOverflowOpen(false)}>Explore First</button>
          )}
          {collapsedCount >= 2 && (
            <button role="menuitem" onClick={() => setOverflowOpen(false)}>Refine Topic</button>
          )}
        </div>
      )}
      <button data-testid="outside-button">Outside</button>
    </div>
  );
}

describe('Overflow menu keyboard accessibility', () => {
  it('closes on Escape and returns focus to trigger', async () => {
    const user = userEvent.setup();
    render(<OverflowMenuHarness collapsedCount={2} />);

    const trigger = screen.getByTestId('overflow-trigger');
    await user.click(trigger);
    expect(screen.getByTestId('overflow-menu')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('overflow-menu')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('closes on click outside and returns focus to trigger', async () => {
    const user = userEvent.setup();
    render(<OverflowMenuHarness collapsedCount={1} />);

    const trigger = screen.getByTestId('overflow-trigger');
    await user.click(trigger);
    expect(screen.getByTestId('overflow-menu')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside-button'));

    expect(screen.queryByTestId('overflow-menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('has correct ARIA attributes on trigger and menu', async () => {
    const user = userEvent.setup();
    render(<OverflowMenuHarness collapsedCount={2} />);

    const trigger = screen.getByTestId('overflow-trigger');
    expect(trigger).toHaveAttribute('aria-haspopup', 'true');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-label', 'More actions');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const menu = screen.getByTestId('overflow-menu');
    expect(menu).toHaveAttribute('role', 'menu');
    const items = menu.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(2);
  });

  it('focuses first menu item on open', async () => {
    const user = userEvent.setup();
    render(<OverflowMenuHarness collapsedCount={2} />);

    await user.click(screen.getByTestId('overflow-trigger'));

    await vi.waitFor(() => {
      expect(screen.getByText('Explore First')).toHaveFocus();
    });
  });
});
