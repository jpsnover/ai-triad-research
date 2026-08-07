// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2240 — debate prose was the one AI-markdown surface with no measure cap
// (`max-width: none`), while chat capped the same kind of text at 68ch. CSS
// can't read a feature flag, so the gate is a `debate-redesign` class on the
// card root; these tests pin that class to the flag rather than the 68ch value
// itself, which lives in StatementCard.css and isn't applied under jsdom.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock('remark-gfm', () => ({ default: {} }));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

const debateState = {
  activeDebate: { transcript: [], speaker_models: {} },
  responseLength: 'detailed',
  setEntryDisplayTier: vi.fn(),
  askQuestion: vi.fn(),
  debateGenerating: null,
  diagnosticsEnabled: false,
  toggleDiagnostics: vi.fn(),
  selectDiagEntry: vi.fn(),
  deleteTranscriptEntries: vi.fn(),
};

vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: Object.assign(
    (selector: (s: typeof debateState) => unknown) => selector(debateState),
    { getState: () => debateState },
  ),
}));

vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: unknown) => fn }));

const mockFlags: Record<string, boolean> = {};
vi.mock('../../hooks/useFeatureFlags', () => ({
  useFlag: (name: string) => mockFlags[name] ?? false,
}));

vi.mock('../../hooks/useCommentStore', () => ({
  COMMENT_TYPE_META: {},
  useCommentStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      commentsFile: null,
      filters: { types: new Set(), authors: new Set(), searchText: '', showResolved: true },
      focusedCommentId: null,
      focusComment: vi.fn(),
      setSidebarOpen: vi.fn(),
      toggleSidebar: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector({}),
    { getState: () => ({ policyRegistry: null }) },
  ),
}));
vi.mock('@bridge', () => ({
  api: { focusNodeInMainWindow: vi.fn(), clipboardWriteText: vi.fn(), openExternal: vi.fn() },
}));

vi.mock('./ClaimsView', () => ({ ClaimsView: () => <div data-testid="claims-view" /> }));
vi.mock('./VocabularyPanel', () => ({ LineageTermsView: () => null, VocabTermsView: () => null }));
vi.mock('./TaxonomyRefs', () => ({ TaxonomyRefsSection: () => <div data-testid="taxonomy-refs" /> }));
vi.mock('../../utils/lineageMatcher', () => ({ lineageMarkdownComponents: {}, extractLineageNames: () => [] }));
vi.mock('../../utils/vocabularyAnnotations', () => ({ getDebateMarkdownComponents: () => ({}) }));

import { StatementCard } from './StatementCard';
import type { TranscriptEntry } from '@lib/debate/types';

function makeEntry(over: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: 'e1',
    timestamp: '2026-01-01T00:00:00Z',
    type: 'statement',
    speaker: 'accelerationist',
    content: 'Some statement prose.',
    taxonomy_refs: [],
    display_tier: 'detailed',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete mockFlags.DEBATE_CHAT_REDESIGN;
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  }
});

describe('StatementCard prose measure (t/2240)', () => {
  it('leaves the card unscoped when the flag is off, so max-width stays none', () => {
    const { container } = render(<StatementCard entry={makeEntry()} />);
    expect(container.querySelector('.debate-statement')?.classList.contains('debate-redesign')).toBe(false);
  });

  it('scopes the card for the 68ch measure when the flag is on', () => {
    mockFlags.DEBATE_CHAT_REDESIGN = true;
    const { container } = render(<StatementCard entry={makeEntry()} />);
    expect(container.querySelector('.debate-statement')?.classList.contains('debate-redesign')).toBe(true);
  });

  it('keeps the speaker and type classes intact alongside the scope class', () => {
    mockFlags.DEBATE_CHAT_REDESIGN = true;
    const { container } = render(<StatementCard entry={makeEntry()} />);
    const card = container.querySelector('.debate-statement') as HTMLElement;
    expect(card.classList.contains('debate-speaker-accelerationist')).toBe(true);
    expect(card.classList.contains('debate-type-statement')).toBe(true);
  });
});
