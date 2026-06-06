// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
