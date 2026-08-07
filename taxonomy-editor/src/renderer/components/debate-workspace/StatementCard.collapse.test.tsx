// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2241 — per-turn collapse toggle, gated on DEBATE_CHAT_REDESIGN. The tier
// system re-summarizes content but never hides it, so skimming past turns
// already read required scrolling the full body. These tests pin both arms of
// the flag: off = the card renders exactly as before (no chevron), on = a
// keyboard-reachable chevron collapses the card to its identity row.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

// Controllable flag mock — every flag defaults off, matching production.
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

// ── Fixtures ─────────────────────────────────────────────────

function makeEntry(over: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: 'e1',
    timestamp: '2026-01-01T00:00:00Z',
    type: 'statement',
    speaker: 'accelerationist',
    content: 'One two three four five.',
    taxonomy_refs: [],
    display_tier: 'detailed',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete mockFlags.DEBATE_CHAT_REDESIGN;
  // jsdom lacks matchMedia; StatementCard's tier-change effect reads it.
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  }
});

// ── Flag off ─────────────────────────────────────────────────

describe('StatementCard collapse — flag off', () => {
  it('renders no collapse control and leaves the body visible', () => {
    const { container } = render(<StatementCard entry={makeEntry()} />);

    expect(screen.queryByRole('button', { name: /collapse this turn/i })).toBeNull();
    expect(container.querySelector('.debate-statement-body')).toBeTruthy();
    expect(container.querySelector('.debate-statement-collapsed')).toBeNull();
  });
});

// ── Flag on ──────────────────────────────────────────────────

describe('StatementCard collapse — flag on (t/2241)', () => {
  beforeEach(() => { mockFlags.DEBATE_CHAT_REDESIGN = true; });

  it('renders an expanded card with a collapse control by default', () => {
    const { container } = render(<StatementCard entry={makeEntry()} />);

    const btn = screen.getByRole('button', { name: /collapse this turn/i });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.debate-statement-body')).toBeTruthy();
  });

  it('collapses to the identity row on click, hiding the body', async () => {
    const user = userEvent.setup();
    const { container } = render(<StatementCard entry={makeEntry()} />);

    await user.click(screen.getByRole('button', { name: /collapse this turn/i }));

    expect(container.querySelector('.debate-statement-body')).toBeNull();
    expect(container.querySelector('.debate-statement-collapsed')).toBeTruthy();
    // Speaker identity survives so a collapsed card is still scannable.
    expect(container.querySelector('.debate-statement-speaker')?.textContent).toBe('Accelerationist');
  });

  it('shows a word count while collapsed so long turns stay distinguishable', async () => {
    const user = userEvent.setup();
    render(<StatementCard entry={makeEntry()} />);

    await user.click(screen.getByRole('button', { name: /collapse this turn/i }));

    expect(screen.getByText('collapsed · 5 words')).toBeInTheDocument();
  });

  it('expands again on a second activation', async () => {
    const user = userEvent.setup();
    const { container } = render(<StatementCard entry={makeEntry()} />);

    await user.click(screen.getByRole('button', { name: /collapse this turn/i }));
    await user.click(screen.getByRole('button', { name: /expand this turn/i }));

    expect(container.querySelector('.debate-statement-body')).toBeTruthy();
    expect(container.querySelector('.debate-statement-collapsed')).toBeNull();
  });

  it('toggles from the keyboard (AC: Enter/Space on the chevron)', async () => {
    const user = userEvent.setup();
    const { container } = render(<StatementCard entry={makeEntry()} />);

    await user.tab();
    expect(screen.getByRole('button', { name: /collapse this turn/i })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(container.querySelector('.debate-statement-body')).toBeNull();

    await user.keyboard(' ');
    expect(container.querySelector('.debate-statement-body')).toBeTruthy();
  });

  it('keeps collapse independent per card', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <StatementCard entry={makeEntry({ id: 'e1' })} />
        <StatementCard entry={makeEntry({ id: 'e2', speaker: 'skeptic' })} />
      </>,
    );

    const [first] = screen.getAllByRole('button', { name: /collapse this turn/i });
    await user.click(first);

    const cards = container.querySelectorAll('.debate-statement');
    expect(cards[0].classList.contains('debate-statement-collapsed')).toBe(true);
    expect(cards[1].classList.contains('debate-statement-collapsed')).toBe(false);
  });
});
