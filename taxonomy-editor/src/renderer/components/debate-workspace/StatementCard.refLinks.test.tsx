// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1776 — StatementCard linkifies ID-token refs (node/sit/pol) in transcript text
// via remarkLinkifyRefs + the RefLinkSpan md-component, and clicking one sets the
// store's selectedRef (→ DetailPane). Integration tests: real react-markdown, real
// remark plugin + scanRefs, real CommentOverlay — so they also prove ref-links and
// comment highlights COEXIST (the render-time arbitration TL asked for, t/1776#4).

import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { Comment } from '@lib/debate/comments';
import type { EntityRef } from '@lib/entities/types';

// ── Mocks (react-markdown, remark plugins, CommentHighlights, scanRefs stay REAL) ──

let commentState: Record<string, unknown>;
const setSelectedRef = vi.fn();

vi.mock('../../hooks/useCommentStore', () => ({
  COMMENT_TYPE_META: { research: { label: 'Research', color: '#6366f1', icon: '🔬' } },
  useCommentStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    (selector ? selector(commentState) : commentState),
}));

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

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
  setSelectedRef,
};

vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: Object.assign(
    (selector: (s: typeof debateState) => unknown) => selector(debateState),
    { getState: () => debateState },
  ),
}));

vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: unknown) => fn }));
vi.mock('../../hooks/useFeatureFlags', () => ({ useFlag: () => false }));
vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector({}),
    { getState: () => ({ policyRegistry: null }) },
  ),
}));
vi.mock('@bridge', () => ({
  api: { focusNodeInMainWindow: vi.fn(), clipboardWriteText: vi.fn(), openExternal: vi.fn() },
}));
vi.mock('./ClaimsView', () => ({ ClaimsView: () => <div /> }));
vi.mock('./VocabularyPanel', () => ({ LineageTermsView: () => null, VocabTermsView: () => null }));
vi.mock('./TaxonomyRefs', () => ({ TaxonomyRefsSection: () => <div /> }));
vi.mock('../../utils/lineageMatcher', () => ({ lineageMarkdownComponents: {}, extractLineageNames: () => [] }));
vi.mock('../../utils/vocabularyAnnotations', () => ({ getDebateMarkdownComponents: () => ({}) }));

import { StatementCard } from './StatementCard';
import type { TranscriptEntry } from '@lib/debate/types';

// Content carries a linkable node id, a linkable org-* id (the LINKABLE_KINDS widening
// in t/1882 §4.1 made entity/org/term ID tokens clickable too), and some bold text to
// anchor a comment on for the coexistence test.
const CONTENT = 'The Accelerationist cites acc-beliefs-001 and org-001; here is some bold ground.';

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
    id: 'c1', debateId: 'd1', type: 'research', source: 'human', author: 'Alice',
    body: 'a note', replies: [], resolved: false,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function setComments(comments: Comment[]) {
  commentState = {
    commentsFile: { _schema_version: '1', debateId: 'd1', comments },
    filters: { types: new Set(), authors: new Set(), searchText: '', showResolved: true },
    focusedCommentId: null,
    focusComment: vi.fn(),
    setSidebarOpen: vi.fn(),
    toggleSidebar: vi.fn(),
  };
}

function content(root: HTMLElement): HTMLElement {
  return root.querySelector('.debate-statement-content') as HTMLElement;
}

function refLinks(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(content(root).querySelectorAll<HTMLButtonElement>('button.ref-link'));
}

beforeEach(() => {
  vi.clearAllMocks();
  setComments([]);
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  }
});

describe('StatementCard — ID-token ref links (t/1776)', () => {
  it('renders node and org-* ID tokens as .ref-link buttons (widened LINKABLE_KINDS, t/1882)', () => {
    const { container: root } = render(<StatementCard entry={makeEntry()} />);
    const links = refLinks(root);
    // Both linkify now that entity/org/term joined LINKABLE_KINDS (t/1882 §4.1); the
    // display text stays the raw source token, in source order.
    expect(links.map(b => b.textContent)).toEqual(['acc-beliefs-001', 'org-001']);
  });

  it('clicking a ref link sets the store selectedRef to the parsed EntityRef', () => {
    const { container: root } = render(<StatementCard entry={makeEntry()} />);
    fireEvent.click(refLinks(root)[0]);
    expect(setSelectedRef).toHaveBeenCalledTimes(1);
    expect(setSelectedRef).toHaveBeenCalledWith({ kind: 'node', id: 'acc-beliefs-001' } as EntityRef);
  });

  it('ref links and comment highlights coexist in the same statement', () => {
    setComments([
      makeComment({ textRange: { entryId: 'e1', tier: 'detailed', startOffset: 0, endOffset: 4, selectedText: 'bold' } }),
    ]);
    const { container: root } = render(<StatementCard entry={makeEntry()} />);
    const el = content(root);
    // Both decorations present, no crash: a ref-link button AND a comment highlight span.
    expect(el.querySelector('button.ref-link')?.textContent).toBe('acc-beliefs-001');
    expect(el.querySelector('[data-comment-highlight]')?.textContent).toBe('bold');
  });
});
