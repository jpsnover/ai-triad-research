// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1694 — StatementCard now ALWAYS renders markdown and mounts CommentOverlay
// as an in-place highlight layer (removing the old !hasHighlights gate that
// flipped a commented statement to raw plaintext). These are integration tests:
// react-markdown and CommentOverlay run for real so we can prove (1) registering
// a comment no longer suppresses markdown formatting (UAT-Q2 regression — fails
// on the old gated code), (2) the memoized markdown subtree survives a
// comment-only re-render so the overlay's injected spans aren't clobbered
// (HLD t/1683#1 Decision 2), and (3) a rendered-text offset captured over inline
// markdown round-trips to a correct highlight (the offset path indexOf-on-raw
// silently missed).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { Comment } from '@lib/debate/comments';
import { renderedOffsetOf } from './utils';

// ── Mocks (react-markdown, remark-gfm, CommentHighlights, ./utils stay REAL) ──

let commentState: Record<string, unknown>;
const focusComment = vi.fn();
const setSidebarOpen = vi.fn();
const toggleSidebar = vi.fn();

vi.mock('../../hooks/useCommentStore', () => ({
  COMMENT_TYPE_META: {
    research: { label: 'Research', color: '#6366f1', icon: '🔬' },
  },
  useCommentStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    (selector ? selector(commentState) : commentState),
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

const setEntryDisplayTier = vi.fn();
const debateState = {
  activeDebate: { transcript: [], speaker_models: {} },
  responseLength: 'detailed',
  setEntryDisplayTier,
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
vi.mock('../../hooks/useFeatureFlags', () => ({ useFlag: () => false }));

// ./utils is real, so stub the store/bridge it loads at import time.
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

// ── Fixtures ─────────────────────────────────────────────

// A leading paragraph keeps `## Header` off line 1, so stripLeadingHeadings (which
// only strips headings at the very start) leaves it intact — otherwise the h2 we
// assert on would be silently removed.
const CONTENT = [
  'This opening line sets the context for the statement.',
  '',
  '## Key Header',
  '',
  'Here is some **bold** emphasis to anchor a comment on.',
  '',
  '- first point',
  '- second point',
].join('\n');

function makeEntry(over: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: 'e1',
    timestamp: '2026-01-01T00:00:00Z',
    type: 'statement',
    speaker: 'accelerationist',
    content: CONTENT,
    taxonomy_refs: [],
    display_tier: 'detailed',
    ...over,
  };
}

function makeComment(over: Partial<Comment> & { textRange: Comment['textRange'] }): Comment {
  return {
    id: 'c1',
    debateId: 'd1',
    type: 'research',
    source: 'human',
    author: 'Alice',
    body: 'a note',
    replies: [],
    resolved: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function setComments(comments: Comment[]) {
  commentState = {
    commentsFile: { _schema_version: '1', debateId: 'd1', comments },
    filters: { types: new Set(), authors: new Set(), searchText: '', showResolved: true },
    focusedCommentId: null,
    focusComment,
    setSidebarOpen,
    toggleSidebar,
  };
}

function content(root: HTMLElement): HTMLElement {
  return root.querySelector('.debate-statement-content') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  setComments([]);
  // jsdom lacks matchMedia; StatementCard's tier-change effect reads it.
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  }
});

describe('StatementCard — markdown + CommentOverlay integration (t/1694)', () => {
  it('renders full markdown formatting even WHEN a comment is registered (UAT-Q2, fails on the old gate)', () => {
    setComments([
      makeComment({ textRange: { entryId: 'e1', tier: 'detailed', startOffset: 0, endOffset: 4, selectedText: 'bold' } }),
    ]);
    const { container: root } = render(<StatementCard entry={makeEntry()} />);
    const el = content(root);

    // Markdown rendered to real elements — NOT literal markdown syntax.
    expect(el.querySelector('h2')?.textContent).toBe('Key Header');
    expect(el.querySelector('strong')?.textContent).toBe('bold');
    expect(el.querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
    expect(el.textContent).not.toContain('## Key Header');
    expect(el.textContent).not.toContain('**bold**');

    // ...AND the comment highlight is painted over the rendered text.
    const hl = el.querySelector('[data-comment-highlight]');
    expect(hl).toBeTruthy();
    expect(hl?.textContent).toBe('bold');
    // Formatting under the highlight is preserved (span nested inside <strong>).
    expect(hl?.closest('strong')).toBeTruthy();
  });

  it('keeps the first comment highlight after a comment-only re-render (reconciliation-survival, Decision 2)', () => {
    setComments([
      makeComment({ id: 'c1', textRange: { entryId: 'e1', tier: 'detailed', startOffset: 0, endOffset: 4, selectedText: 'bold' } }),
    ]);
    const entry = makeEntry();
    const { container: root, rerender } = render(<StatementCard entry={entry} />);
    expect(content(root).querySelector('[data-comment-highlight="c1"]')?.textContent).toBe('bold');

    // Comment-only change: add a 2nd comment, content untouched, and re-render.
    setComments([
      makeComment({ id: 'c1', textRange: { entryId: 'e1', tier: 'detailed', startOffset: 0, endOffset: 4, selectedText: 'bold' } }),
      makeComment({ id: 'c2', textRange: { entryId: 'e1', tier: 'detailed', startOffset: 0, endOffset: 8, selectedText: 'emphasis' } }),
    ]);
    expect(() => rerender(<StatementCard entry={entry} />)).not.toThrow();

    const el = content(root);
    // The memoized markdown subtree wasn't clobbered — 1st highlight survives,
    // the 2nd is now painted, and the markdown structure is intact.
    expect(el.querySelector('[data-comment-highlight="c1"]')?.textContent).toBe('bold');
    expect(el.querySelector('[data-comment-highlight="c2"]')?.textContent).toBe('emphasis');
    expect(el.querySelector('h2')?.textContent).toBe('Key Header');
    expect(el.querySelector('strong')?.textContent).toBe('bold');
  });

  it('round-trips a rendered-text offset over inline markdown to a correct highlight (selection capture)', () => {
    // Old path (indexOf on the RAW markdown source) can't find rendered text that
    // spans inline syntax — this is the offset-0 fallback bug the fix removes.
    expect(CONTENT.indexOf('some bold emphasis')).toBe(-1);

    // Render with no comments, then capture a rendered-text offset the way
    // DebateWorkspace's context-menu handler does (via the shared helper).
    const entry = makeEntry();
    const { container: root, rerender } = render(<StatementCard entry={entry} />);
    const el = content(root);
    const para = Array.from(el.querySelectorAll('p')).find(p => p.textContent?.startsWith('Here is some'))!;
    const leadTextNode = para.firstChild as Text; // "Here is some "
    const startInNode = leadTextNode.data.indexOf('some'); // 8
    const startOffset = renderedOffsetOf(el, leadTextNode, startInNode);
    const selectedText = 'some bold emphasis';

    // Anchor a comment with that rendered-space offset and re-render.
    setComments([
      makeComment({ id: 'c-sel', textRange: { entryId: 'e1', tier: 'detailed', startOffset, endOffset: startOffset + selectedText.length, selectedText } }),
    ]);
    rerender(<StatementCard entry={entry} />);

    const spans = Array.from(content(root).querySelectorAll('[data-comment-highlight]'));
    // The selection spans a <strong> boundary → ≥2 spans, one shared comment id,
    // together covering exactly the selected rendered text.
    expect(spans.length).toBeGreaterThanOrEqual(2);
    expect(new Set(spans.map(s => s.getAttribute('data-comment-highlight')))).toEqual(new Set(['c-sel']));
    expect(spans.map(s => s.textContent).join('')).toBe(selectedText);
    // The <strong> is preserved and its text carries a highlight.
    const strong = content(root).querySelector('strong');
    expect(strong?.textContent).toBe('bold');
    expect(strong?.querySelector('[data-comment-highlight="c-sel"]')?.textContent).toBe('bold');
  });
});
