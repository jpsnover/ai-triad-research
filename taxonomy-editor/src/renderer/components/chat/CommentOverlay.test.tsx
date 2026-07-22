// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1693: CommentOverlay decorates an already-rendered markdown container with
// comment highlights, resolving each comment's range by locating its stored
// `selectedText` in the rendered text. These tests cover the fixed anchoring
// rule (HLD t/1683#1) — cross-boundary span wrapping, graceful degradation on
// unresolved text, duplicate-occurrence disambiguation, and the preserved
// click/hover/badge UX.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Comment, DetailTier } from '@lib/debate/comments';

// ── Mocks ────────────────────────────────────────────────

let storeState: Record<string, unknown>;
const focusComment = vi.fn();
const setSidebarOpen = vi.fn();

vi.mock('../../hooks/useCommentStore', () => ({
  COMMENT_TYPE_META: {
    research: { label: 'Research', color: '#6366f1', icon: '🔬' },
    agree: { label: 'Agree', color: '#22c55e', icon: '✓' },
  },
  useCommentStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    (selector ? selector(storeState) : storeState),
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

import { CommentOverlay } from './CommentHighlights';

// ── Helpers ──────────────────────────────────────────────

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

function setStore(comments: Comment[]) {
  storeState = {
    commentsFile: { _schema_version: '1', debateId: 'd1', comments },
    filters: { types: new Set(), authors: new Set(), searchText: '', showResolved: true },
    focusedCommentId: null,
    focusComment,
    setSidebarOpen,
  };
}

function Harness({ html, entryId = 'e1', tier = 'detailed' as DetailTier }: { html: string; entryId?: string; tier?: DetailTier }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      <div data-testid="container" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
      <CommentOverlay containerRef={ref} entryId={entryId} activeTier={tier} />
    </>
  );
}

function container(): HTMLElement {
  return screen.getByTestId('container');
}

function highlights(): NodeListOf<HTMLElement> {
  return container().querySelectorAll<HTMLElement>('[data-comment-highlight]');
}

// ── Tests ────────────────────────────────────────────────

describe('CommentOverlay', () => {
  beforeEach(() => {
    focusComment.mockClear();
    setSidebarOpen.mockClear();
    setStore([]);
  });

  it('wraps a range spanning a <strong> boundary into ≥2 spans sharing one comment id (AC#2)', () => {
    setStore([
      makeComment({
        id: 'cmt-bold',
        textRange: { entryId: 'e1', tier: 'detailed', startOffset: 0, endOffset: 11, selectedText: 'Alpha bravo' },
      }),
    ]);
    render(<Harness html="<p>Alpha <strong>bravo</strong> charlie</p>" />);

    const spans = highlights();
    expect(spans.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(Array.from(spans).map(s => s.getAttribute('data-comment-highlight')));
    expect(ids).toEqual(new Set(['cmt-bold']));
    // Formatting preserved: the <strong> element still exists.
    expect(container().querySelector('strong')?.textContent).toBe('bravo');
  });

  it('renders no highlight and leaves markdown untouched when selectedText is unresolved (AC#3)', () => {
    const before = '<p>Some formatted <em>text</em> here</p>';
    setStore([
      makeComment({
        id: 'cmt-missing',
        textRange: { entryId: 'e1', tier: 'detailed', startOffset: 0, endOffset: 18, selectedText: 'nonexistent phrase' },
      }),
    ]);
    expect(() => render(<Harness html={before} />)).not.toThrow();

    expect(highlights().length).toBe(0);
    expect(container().innerHTML).toBe(before);
  });

  it('disambiguates duplicate selectedText by choosing the occurrence closest to startOffset (AC#4)', () => {
    // rendered text: "foo bar baz foo bar baz" — "bar" at offsets 4 and 16.
    setStore([
      makeComment({
        id: 'cmt-dup',
        textRange: { entryId: 'e1', tier: 'detailed', startOffset: 15, endOffset: 18, selectedText: 'bar' },
      }),
    ]);
    render(<Harness html="<p>foo bar baz foo bar baz</p>" />);

    const spans = highlights();
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe('bar');
    // startOffset 15 → second occurrence (16); the text before the span is 16 chars.
    expect(spans[0].previousSibling?.textContent).toBe('foo bar baz foo ');
  });

  it('picks the first occurrence when startOffset is nearest to it (AC#4, mirror)', () => {
    setStore([
      makeComment({
        id: 'cmt-dup2',
        textRange: { entryId: 'e1', tier: 'detailed', startOffset: 3, endOffset: 6, selectedText: 'bar' },
      }),
    ]);
    render(<Harness html="<p>foo bar baz foo bar baz</p>" />);

    const spans = highlights();
    expect(spans.length).toBe(1);
    expect(spans[0].previousSibling?.textContent).toBe('foo ');
  });

  it('wraps a highlight that crosses a remarkColorizePov span, preserving the POV coloring (TL request)', () => {
    // remarkColorizePov emits <span class="pov-name pov-acc">Accelerationist</span>.
    setStore([
      makeComment({
        id: 'cmt-pov',
        textRange: { entryId: 'e1', tier: 'detailed', startOffset: 0, endOffset: 26, selectedText: 'The Accelerationist argues' },
      }),
    ]);
    render(<Harness html={'<p>The <span class="pov-name pov-acc">Accelerationist</span> argues loudly</p>'} />);

    const spans = highlights();
    expect(spans.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(Array.from(spans).map(s => s.getAttribute('data-comment-highlight')));
    expect(ids).toEqual(new Set(['cmt-pov']));
    // POV colorization survives — the pov-name span and its color class are intact.
    const pov = container().querySelector('.pov-name.pov-acc');
    expect(pov).toBeTruthy();
    expect(pov?.textContent).toBe('Accelerationist');
  });

  it('opens the sidebar and focuses the comment on highlight click (AC#5)', () => {
    setStore([
      makeComment({
        id: 'cmt-click',
        textRange: { entryId: 'e1', tier: 'detailed', startOffset: 0, endOffset: 5, selectedText: 'Hello' },
      }),
    ]);
    render(<Harness html="<p>Hello world</p>" />);

    const span = highlights()[0];
    expect(span).toBeTruthy();
    fireEvent.click(span);
    expect(focusComment).toHaveBeenCalledWith('cmt-click');
    expect(setSidebarOpen).toHaveBeenCalledWith(true);
  });

  it('shows a tooltip with the comment body on hover (AC#5)', () => {
    setStore([
      makeComment({
        id: 'cmt-hover',
        body: 'This needs a citation',
        textRange: { entryId: 'e1', tier: 'detailed', startOffset: 0, endOffset: 5, selectedText: 'Hello' },
      }),
    ]);
    render(<Harness html="<p>Hello world</p>" />);

    fireEvent.mouseOver(highlights()[0]);
    expect(screen.getByText('This needs a citation')).toBeInTheDocument();
  });

  it('applies stacked styling and resolved class when overlapping comments share text (AC#5)', () => {
    setStore([
      makeComment({
        id: 'cmt-a',
        resolved: true,
        textRange: { entryId: 'e1', tier: 'detailed', startOffset: 0, endOffset: 11, selectedText: 'Hello world' },
      }),
      makeComment({
        id: 'cmt-b',
        resolved: true,
        textRange: { entryId: 'e1', tier: 'detailed', startOffset: 0, endOffset: 5, selectedText: 'Hello' },
      }),
    ]);
    render(<Harness html="<p>Hello world</p>" />);

    // "Hello" is covered by both comments → stackHeight 2; " world" by one.
    const overlap = Array.from(highlights()).find(s => s.textContent === 'Hello');
    expect(overlap).toBeTruthy();
    expect(overlap?.style.borderBottomWidth).toBe('2px');
    expect(overlap?.className).toContain('comment-highlight-resolved');
  });

  it('renders a cross-tier badge for comments on a different tier (AC#5)', () => {
    setStore([
      makeComment({
        id: 'cmt-other-tier',
        textRange: { entryId: 'e1', tier: 'brief', startOffset: 0, endOffset: 5, selectedText: 'Hello' },
      }),
    ]);
    render(<Harness html="<p>Hello world</p>" tier="detailed" />);

    // No inline highlight (different tier), but a badge shows the count.
    expect(highlights().length).toBe(0);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('re-resolves highlights when the container content mutates', async () => {
    setStore([
      makeComment({
        id: 'cmt-mut',
        textRange: { entryId: 'e1', tier: 'detailed', startOffset: 0, endOffset: 6, selectedText: 'target' },
      }),
    ]);
    render(<Harness html="<p>no match here</p>" />);
    expect(highlights().length).toBe(0);

    // Simulate a markdown re-render inserting the commented text.
    container().querySelector('p')!.textContent = 'target appears now';
    // MutationObserver callback fires on a microtask.
    await Promise.resolve();
    await Promise.resolve();
    expect(highlights().length).toBe(1);
    expect(highlights()[0].textContent).toBe('target');
  });
});
