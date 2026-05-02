// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo, useState } from 'react';
import { useCommentStore, COMMENT_TYPE_META } from '../hooks/useCommentStore';
import type { Comment, DetailTier } from '@lib/debate/comments';

interface CommentHighlightsProps {
  /** The plain text content to render with highlights */
  text: string;
  entryId: string;
  activeTier: DetailTier;
}

interface Segment {
  start: number;
  end: number;
  text: string;
  comments: Comment[];
}

/**
 * Render text with colored underline highlights where comments are anchored.
 * Falls back to plain text when no matching comments exist.
 * Respects active filters — hidden comments produce no highlights.
 */
export function CommentHighlightedText({ text, entryId, activeTier }: CommentHighlightsProps) {
  const commentsFile = useCommentStore(s => s.commentsFile);
  const filters = useCommentStore(s => s.filters);
  const focusedCommentId = useCommentStore(s => s.focusedCommentId);
  const focusComment = useCommentStore(s => s.focusComment);
  const setSidebarOpen = useCommentStore(s => s.setSidebarOpen);
  const [hoveredComment, setHoveredComment] = useState<Comment | null>(null);

  // Get filtered comments for this entry that match the current tier
  const matchingComments = useMemo(() => {
    if (!commentsFile) return [];
    let comments = commentsFile.comments.filter(
      c => c.textRange.entryId === entryId && c.textRange.tier === activeTier,
    );
    // Apply filters so hidden comments don't produce highlights
    const { types, authors, searchText, showResolved } = filters;
    if (!showResolved) comments = comments.filter(c => !c.resolved);
    if (types.size > 0) comments = comments.filter(c => types.has(c.type));
    if (authors.size > 0) comments = comments.filter(c => authors.has(c.author));
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      comments = comments.filter(c =>
        c.body.toLowerCase().includes(q)
        || c.textRange.selectedText.toLowerCase().includes(q)
        || c.author.toLowerCase().includes(q),
      );
    }
    return comments;
  }, [commentsFile, entryId, activeTier, filters]);

  // Comments on a different tier — show as entry badge
  const crossTierCount = useMemo(() => {
    if (!commentsFile) return 0;
    return commentsFile.comments.filter(
      c => c.textRange.entryId === entryId && c.textRange.tier !== activeTier,
    ).length;
  }, [commentsFile, entryId, activeTier]);

  const segments = useMemo(() => {
    if (matchingComments.length === 0) return null;
    return buildSegments(text, matchingComments);
  }, [text, matchingComments]);

  if (!segments && crossTierCount === 0) return null;

  const handleHighlightClick = (comment: Comment) => {
    // Navigate to comment in sidebar (t/235)
    focusComment(comment.id);
    setSidebarOpen(true);
    // Scroll to the card in the sidebar
    requestAnimationFrame(() => {
      const card = document.querySelector(`[data-comment-card="${comment.id}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  return (
    <>
      {crossTierCount > 0 && (
        <span
          className="comment-cross-tier-badge"
          title={`${crossTierCount} comment(s) on a different summary tier`}
        >
          {crossTierCount}
        </span>
      )}
      {segments && (
        <div className="comment-highlighted-text">
          {segments.map((seg, i) => {
            if (seg.comments.length === 0) {
              return <span key={i}>{seg.text}</span>;
            }
            const topComment = seg.comments[0];
            const meta = COMMENT_TYPE_META[topComment.type];
            const isResolved = seg.comments.every(c => c.resolved);
            const stackHeight = Math.min(seg.comments.length, 3);
            const isFocused = seg.comments.some(c => c.id === focusedCommentId);
            return (
              <span
                key={i}
                data-comment-highlight={topComment.id}
                className={`comment-highlight${isResolved ? ' comment-highlight-resolved' : ''}${isFocused ? ' comment-highlight-focused' : ''}`}
                style={{
                  borderBottomColor: meta.color,
                  borderBottomWidth: stackHeight,
                }}
                onClick={() => handleHighlightClick(topComment)}
                onMouseEnter={() => setHoveredComment(topComment)}
                onMouseLeave={() => setHoveredComment(null)}
              >
                {seg.text}
                {hoveredComment?.id === topComment.id && (
                  <CommentTooltip comments={seg.comments} />
                )}
              </span>
            );
          })}
        </div>
      )}
    </>
  );
}

function CommentTooltip({ comments }: { comments: Comment[] }) {
  return (
    <div className="comment-tooltip">
      {comments.slice(0, 3).map(c => {
        const meta = COMMENT_TYPE_META[c.type];
        return (
          <div key={c.id} className="comment-tooltip-item">
            <span className="comment-tooltip-badge" style={{ background: meta.color }}>
              {meta.icon} {meta.label}
            </span>
            <span className="comment-tooltip-author">{c.author}</span>
            <span className="comment-tooltip-preview">
              {c.body.length > 60 ? c.body.slice(0, 57) + '...' : c.body}
            </span>
          </div>
        );
      })}
      {comments.length > 3 && (
        <div className="comment-tooltip-more">+{comments.length - 3} more</div>
      )}
    </div>
  );
}

/** Build non-overlapping text segments with their associated comments */
function buildSegments(text: string, comments: Comment[]): Segment[] {
  if (comments.length === 0) return [{ start: 0, end: text.length, text, comments: [] }];

  // Collect all boundary points
  const boundaries = new Set<number>();
  boundaries.add(0);
  boundaries.add(text.length);
  for (const c of comments) {
    const start = Math.max(0, Math.min(c.textRange.startOffset, text.length));
    const end = Math.max(0, Math.min(c.textRange.endOffset, text.length));
    boundaries.add(start);
    boundaries.add(end);
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    const segText = text.slice(start, end);
    const segComments = comments.filter(c => {
      const cStart = Math.max(0, Math.min(c.textRange.startOffset, text.length));
      const cEnd = Math.max(0, Math.min(c.textRange.endOffset, text.length));
      return cStart <= start && cEnd >= end;
    });
    segments.push({ start, end, text: segText, comments: segComments });
  }
  return segments;
}

/**
 * Count comments per entry for display badges.
 * Used when the transcript renders in Markdown mode (can't inline highlights).
 */
export function useEntryCommentCount(entryId: string): number {
  const commentsFile = useCommentStore(s => s.commentsFile);
  return useMemo(() => {
    if (!commentsFile) return 0;
    return commentsFile.comments.filter(c => c.textRange.entryId === entryId).length;
  }, [commentsFile, entryId]);
}
