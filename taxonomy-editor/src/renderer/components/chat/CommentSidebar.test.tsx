// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mocks ────────────────────────────────────────────────

const mockToggleSidebar = vi.fn();
const mockResolveComment = vi.fn();
const mockUnresolveComment = vi.fn();
const mockDeleteComment = vi.fn();
const mockAddReply = vi.fn();
const mockFocusComment = vi.fn();
const mockToggleFilterType = vi.fn();
const mockToggleFilterAuthor = vi.fn();
const mockSetFilterSearch = vi.fn();
const mockSetFilterShowResolved = vi.fn();
const mockClearFilters = vi.fn();

let mockCommentStoreState: Record<string, unknown> = {};

vi.mock('../../hooks/useCommentStore', () => ({
  useCommentStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      commentsFile: null,
      toggleSidebar: mockToggleSidebar,
      resolveComment: mockResolveComment,
      unresolveComment: mockUnresolveComment,
      deleteComment: mockDeleteComment,
      addReply: mockAddReply,
      focusedCommentId: null,
      focusComment: mockFocusComment,
      getFilteredComments: () => [],
      filters: { types: new Set(), authors: new Set(), searchText: '', showResolved: true },
      toggleFilterType: mockToggleFilterType,
      toggleFilterAuthor: mockToggleFilterAuthor,
      setFilterSearch: mockSetFilterSearch,
      setFilterShowResolved: mockSetFilterShowResolved,
      clearFilters: mockClearFilters,
      activeFilterCount: () => 0,
      getUniqueAuthors: () => [],
      ...mockCommentStoreState,
    };
    return selector ? selector(state) : state;
  },
  COMMENT_TYPE_META: {
    research: { label: 'Research', color: '#6366f1', icon: 'R' },
    agree: { label: 'Agree', color: '#22c55e', icon: 'A' },
    disagree: { label: 'Disagree', color: '#ef4444', icon: 'D' },
    question: { label: 'Question', color: '#3b82f6', icon: '?' },
    follow_up: { label: 'Follow-Up', color: '#8b5cf6', icon: 'F' },
    changed_opinion: { label: 'Changed Opinion', color: '#f59e0b', icon: 'C' },
    factual_error: { label: 'Factual Error', color: '#dc2626', icon: '!' },
    insight: { label: 'Insight', color: '#14b8a6', icon: 'I' },
    fact_supported: { label: 'Fact Supported', color: '#16a34a', icon: 'S' },
    fact_not_supported: { label: 'Fact Not Supported', color: '#b91c1c', icon: 'N' },
  },
  COMMENT_TYPES: ['research', 'agree', 'disagree', 'question', 'follow_up', 'changed_opinion', 'factual_error', 'insight', 'fact_supported', 'fact_not_supported'],
}));

vi.mock('../../hooks/useUsernameStore', () => ({
  useUsernameStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector({ username: 'testuser' }),
    { getState: () => ({ ensureUsername: vi.fn().mockResolvedValue('testuser') }) },
  ),
}));

import { CommentSidebar } from './CommentSidebar';

function makeComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    type: 'research',
    body: 'This needs further research.',
    author: 'testuser',
    createdAt: new Date().toISOString(),
    resolved: false,
    textRange: { selectedText: 'AI alignment is critical', startOffset: 0, endOffset: 24 },
    replies: [],
    source: 'manual',
    ...overrides,
  };
}

describe('CommentSidebar', () => {
  beforeEach(() => {
    mockCommentStoreState = {};
    vi.clearAllMocks();
  });

  it('returns null when commentsFile is null', () => {
    mockCommentStoreState = { commentsFile: null };
    const { container } = render(<CommentSidebar />);
    expect(container.innerHTML).toBe('');
  });

  it('renders sidebar with header and close button', () => {
    mockCommentStoreState = {
      commentsFile: { _schema_version: '1', debateId: 'd1', comments: [] },
    };
    render(<CommentSidebar />);
    expect(screen.getByText(/Comments/)).toBeInTheDocument();
    expect(screen.getByTitle('Close')).toBeInTheDocument();
  });

  it('shows empty state when there are no comments', () => {
    mockCommentStoreState = {
      commentsFile: { _schema_version: '1', debateId: 'd1', comments: [] },
    };
    render(<CommentSidebar />);
    expect(screen.getByText(/No comments yet/)).toBeInTheDocument();
  });

  it('renders comment cards when comments exist', () => {
    const comment = makeComment();
    mockCommentStoreState = {
      commentsFile: { _schema_version: '1', debateId: 'd1', comments: [comment] },
      getFilteredComments: () => [comment],
    };
    render(<CommentSidebar />);
    expect(screen.getByText('This needs further research.')).toBeInTheDocument();
    expect(screen.getByText('testuser')).toBeInTheDocument();
  });

  it('calls toggleSidebar when close button is clicked', async () => {
    mockCommentStoreState = {
      commentsFile: { _schema_version: '1', debateId: 'd1', comments: [] },
    };
    render(<CommentSidebar />);
    await userEvent.click(screen.getByTitle('Close'));
    expect(mockToggleSidebar).toHaveBeenCalled();
  });

  it('shows Resolve button for unresolved comments', () => {
    const comment = makeComment();
    mockCommentStoreState = {
      commentsFile: { _schema_version: '1', debateId: 'd1', comments: [comment] },
      getFilteredComments: () => [comment],
    };
    render(<CommentSidebar />);
    expect(screen.getByTitle('Resolve')).toBeInTheDocument();
  });

  it('shows Reopen button for resolved comments', () => {
    const comment = makeComment({ resolved: true });
    mockCommentStoreState = {
      commentsFile: { _schema_version: '1', debateId: 'd1', comments: [comment] },
      getFilteredComments: () => [comment],
    };
    render(<CommentSidebar />);
    expect(screen.getByTitle('Reopen')).toBeInTheDocument();
  });

  it('shows Delete button only for comments authored by current user', () => {
    const ownComment = makeComment({ id: 'c1', author: 'testuser' });
    const otherComment = makeComment({ id: 'c2', author: 'otheruser', body: 'Other comment' });
    mockCommentStoreState = {
      commentsFile: { _schema_version: '1', debateId: 'd1', comments: [ownComment, otherComment] },
      getFilteredComments: () => [ownComment, otherComment],
    };
    render(<CommentSidebar />);
    const deleteButtons = screen.getAllByTitle('Delete');
    expect(deleteButtons).toHaveLength(1);
  });

  it('shows filter-mismatch empty state when all comments are filtered out', () => {
    const comment = makeComment();
    mockCommentStoreState = {
      commentsFile: { _schema_version: '1', debateId: 'd1', comments: [comment] },
      getFilteredComments: () => [],
    };
    render(<CommentSidebar />);
    expect(screen.getByText(/No comments match/)).toBeInTheDocument();
  });

  it('renders search input in filter bar', () => {
    mockCommentStoreState = {
      commentsFile: { _schema_version: '1', debateId: 'd1', comments: [] },
    };
    render(<CommentSidebar />);
    expect(screen.getByPlaceholderText('Search comments...')).toBeInTheDocument();
  });
});
