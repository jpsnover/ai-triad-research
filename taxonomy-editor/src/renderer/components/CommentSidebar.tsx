// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback } from 'react';
import { useCommentStore, COMMENT_TYPE_META, COMMENT_TYPES } from '../hooks/useCommentStore';
import { useUsernameStore } from '../hooks/useUsernameStore';
import type { Comment, CommentReply, CommentType } from '@lib/debate/comments';

export function CommentSidebar() {
  const {
    commentsFile, resolveComment, unresolveComment, deleteComment, addReply,
    toggleSidebar, getFilteredComments, focusedCommentId, focusComment,
    filters, toggleFilterType, toggleFilterAuthor, setFilterSearch,
    setFilterShowResolved, clearFilters, activeFilterCount, getUniqueAuthors,
  } = useCommentStore();
  const username = useUsernameStore(s => s.username);

  if (!commentsFile) return null;

  const totalCount = commentsFile.comments?.length ?? 0;
  const filteredComments = getFilteredComments();
  const comments = [...filteredComments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const filterCount = activeFilterCount();
  const authors = getUniqueAuthors();

  const handleNavigateToHighlight = useCallback((comment: Comment) => {
    focusComment(comment.id);
    // Scroll to the highlight in the transcript
    const el = document.querySelector(`[data-comment-highlight="${comment.id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusComment]);

  return (
    <div className="comment-sidebar">
      <div className="comment-sidebar-header">
        <span className="comment-sidebar-title">
          Comments ({filterCount > 0 ? `${comments.length}/${totalCount}` : totalCount})
        </span>
        <button className="comment-sidebar-close" onClick={toggleSidebar} title="Close">&times;</button>
      </div>

      {/* Filter bar (t/234) */}
      <CommentFilterBar
        filters={filters}
        authors={authors}
        filterCount={filterCount}
        onToggleType={toggleFilterType}
        onToggleAuthor={toggleFilterAuthor}
        onSearchChange={setFilterSearch}
        onToggleResolved={() => setFilterShowResolved(!filters.showResolved)}
        onClear={clearFilters}
      />

      <div className="comment-sidebar-list">
        {comments.length === 0 && totalCount > 0 && (
          <div className="comment-sidebar-empty">
            No comments match the current filters.
          </div>
        )}
        {comments.length === 0 && totalCount === 0 && (
          <div className="comment-sidebar-empty">
            No comments yet. Right-click selected text to add one.
          </div>
        )}
        {comments.map(comment => (
          <CommentCard
            key={comment.id}
            comment={comment}
            currentUser={username}
            focused={focusedCommentId === comment.id}
            onResolve={() => resolveComment(comment.id)}
            onUnresolve={() => unresolveComment(comment.id)}
            onDelete={() => deleteComment(comment.id)}
            onNavigate={() => handleNavigateToHighlight(comment)}
            onReply={async (body) => {
              const user = await useUsernameStore.getState().ensureUsername();
              if (!user) return;
              await addReply(comment.id, { author: user, body });
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Filter bar (t/234) ──

function CommentFilterBar({
  filters,
  authors,
  filterCount,
  onToggleType,
  onToggleAuthor,
  onSearchChange,
  onToggleResolved,
  onClear,
}: {
  filters: { types: Set<CommentType>; authors: Set<string>; searchText: string; showResolved: boolean };
  authors: string[];
  filterCount: number;
  onToggleType: (type: CommentType) => void;
  onToggleAuthor: (author: string) => void;
  onSearchChange: (text: string) => void;
  onToggleResolved: () => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="comment-filter-bar">
      <div className="comment-filter-top">
        <input
          className="comment-filter-search"
          type="text"
          placeholder="Search comments..."
          value={filters.searchText}
          onChange={e => onSearchChange(e.target.value)}
        />
        <button
          className={`comment-filter-toggle${expanded ? ' active' : ''}`}
          onClick={() => setExpanded(!expanded)}
          title="Toggle filters"
        >
          Filters{filterCount > 0 ? ` (${filterCount})` : ''}
        </button>
        {filterCount > 0 && (
          <button className="comment-filter-clear" onClick={onClear} title="Clear all filters">
            &times;
          </button>
        )}
      </div>

      {expanded && (
        <div className="comment-filter-panel">
          {/* Type filter */}
          <div className="comment-filter-group">
            <span className="comment-filter-group-label">Type</span>
            <div className="comment-filter-pills">
              {COMMENT_TYPES.map(type => {
                const meta = COMMENT_TYPE_META[type];
                const active = filters.types.size === 0 || filters.types.has(type);
                return (
                  <button
                    key={type}
                    className={`comment-filter-pill${active ? ' active' : ''}`}
                    style={active ? { background: meta.color, color: '#fff' } : {}}
                    onClick={() => onToggleType(type)}
                    title={meta.label}
                  >
                    {meta.icon} {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Author filter */}
          {authors.length > 0 && (
            <div className="comment-filter-group">
              <span className="comment-filter-group-label">Author</span>
              <div className="comment-filter-pills">
                {authors.map(author => {
                  const active = filters.authors.size === 0 || filters.authors.has(author);
                  return (
                    <button
                      key={author}
                      className={`comment-filter-pill${active ? ' active' : ''}`}
                      onClick={() => onToggleAuthor(author)}
                    >
                      {author}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Resolved toggle */}
          <div className="comment-filter-group">
            <label className="comment-filter-checkbox">
              <input
                type="checkbox"
                checked={filters.showResolved}
                onChange={onToggleResolved}
              />
              Show resolved comments
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Comment card ──

function CommentCard({
  comment,
  currentUser,
  focused,
  onResolve,
  onUnresolve,
  onDelete,
  onNavigate,
  onReply,
}: {
  comment: Comment;
  currentUser: string | null;
  focused: boolean;
  onResolve: () => void;
  onUnresolve: () => void;
  onDelete: () => void;
  onNavigate: () => void;
  onReply: (body: string) => Promise<void>;
}) {
  const meta = COMMENT_TYPE_META[comment.type];
  const [showReplies, setShowReplies] = useState(comment.replies.length > 0);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Auto-scroll into view when focused via transcript click (t/235)
  useEffect(() => {
    if (focused && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focused]);

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setReplying(true);
    try {
      await onReply(replyText.trim());
      setReplyText('');
    } finally {
      setReplying(false);
    }
  };

  const isOwn = currentUser != null && comment.author === currentUser;
  const timeAgo = formatTimeAgo(comment.createdAt);

  return (
    <div
      ref={cardRef}
      data-comment-card={comment.id}
      className={`comment-card${comment.resolved ? ' comment-card-resolved' : ''}${focused ? ' comment-card-focused' : ''}`}
    >
      <div className="comment-card-header">
        <span className="comment-type-badge" style={{ background: meta.color }}>
          {meta.icon} {meta.label}
        </span>
        <span className="comment-card-meta">
          <span className="comment-card-author">{comment.author}</span>
          <span className="comment-card-time" title={comment.createdAt}>{timeAgo}</span>
        </span>
      </div>

      <blockquote className="comment-card-quote" onClick={onNavigate} title="Click to scroll to text">
        &ldquo;{comment.textRange.selectedText.length > 120
          ? comment.textRange.selectedText.slice(0, 117) + '...'
          : comment.textRange.selectedText}&rdquo;
      </blockquote>

      <div className="comment-card-body">{comment.body}</div>

      <div className="comment-card-actions">
        {comment.resolved ? (
          <button className="comment-action-btn" onClick={onUnresolve} title="Reopen">Reopen</button>
        ) : (
          <button className="comment-action-btn" onClick={onResolve} title="Resolve">Resolve</button>
        )}
        <button
          className="comment-action-btn"
          onClick={() => { setShowReplies(true); requestAnimationFrame(() => replyRef.current?.focus()); }}
        >
          Reply
        </button>
        {isOwn && (
          <button className="comment-action-btn comment-action-delete" onClick={onDelete} title="Delete">
            Delete
          </button>
        )}
        {comment.source === 'auto' && (
          <span className="comment-auto-badge">auto</span>
        )}
      </div>

      {showReplies && comment.replies.length > 0 && (
        <div className="comment-replies">
          {comment.replies.map(reply => (
            <ReplyCard key={reply.id} reply={reply} />
          ))}
        </div>
      )}

      {showReplies && (
        <div className="comment-reply-input">
          <textarea
            ref={replyRef}
            className="comment-reply-textarea"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleReply();
              }
            }}
            placeholder="Write a reply..."
            rows={2}
          />
          <button
            className="btn btn-sm btn-primary"
            onClick={handleReply}
            disabled={replying || !replyText.trim()}
          >
            {replying ? '...' : 'Reply'}
          </button>
        </div>
      )}
    </div>
  );
}

function ReplyCard({ reply }: { reply: CommentReply }) {
  return (
    <div className="comment-reply-card">
      <span className="comment-reply-author">{reply.author}</span>
      <span className="comment-reply-time" title={reply.createdAt}>{formatTimeAgo(reply.createdAt)}</span>
      <div className="comment-reply-body">{reply.body}</div>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
