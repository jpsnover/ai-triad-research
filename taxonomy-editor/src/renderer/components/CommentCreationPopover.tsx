// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect } from 'react';
import { useCommentStore, COMMENT_TYPES, COMMENT_TYPE_META } from '../hooks/useCommentStore';
import { useUsernameStore } from '../hooks/useUsernameStore';
import type { CommentType, TextRange, DetailTier } from '@lib/debate/comments';

export interface CommentPopoverState {
  x: number;
  y: number;
  selectedText: string;
  entryId: string;
  tier: DetailTier;
  startOffset: number;
  endOffset: number;
}

interface CommentCreationPopoverProps {
  popover: CommentPopoverState;
  onClose: () => void;
}

export function CommentCreationPopover({ popover, onClose }: CommentCreationPopoverProps) {
  const [selectedType, setSelectedType] = useState<CommentType>('insight');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const addComment = useCommentStore(s => s.addComment);

  useEffect(() => {
    requestAnimationFrame(() => bodyRef.current?.focus());
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    // Delay to avoid catching the click that opened the popover
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleClickOutside);
      clearTimeout(timer);
    };
  }, [onClose]);

  const handleSubmit = async () => {
    if (!body.trim()) {
      setError('Comment body cannot be empty');
      return;
    }

    const username = await useUsernameStore.getState().ensureUsername();
    if (!username) return; // User cancelled username prompt

    setSubmitting(true);
    try {
      const textRange: TextRange = {
        entryId: popover.entryId,
        tier: popover.tier,
        startOffset: popover.startOffset,
        endOffset: popover.endOffset,
        selectedText: popover.selectedText,
      };
      await addComment({
        type: selectedType,
        author: username,
        textRange,
        body: body.trim(),
      });
      onClose();
    } catch {
      setError('Failed to save comment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Position the popover so it doesn't overflow the viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(popover.x, window.innerWidth - 340),
    top: Math.min(popover.y + 8, window.innerHeight - 350),
    zIndex: 1000,
  };

  const truncatedQuote = popover.selectedText.length > 80
    ? popover.selectedText.slice(0, 77) + '...'
    : popover.selectedText;

  return (
    <div ref={panelRef} className="comment-creation-popover" style={style}>
      <div className="comment-popover-header">
        <span className="comment-popover-title">Add Comment</span>
        <button className="comment-popover-close" onClick={onClose} title="Cancel (Esc)">&times;</button>
      </div>

      <div className="comment-popover-quote">
        &ldquo;{truncatedQuote}&rdquo;
      </div>

      <div className="comment-popover-types">
        {COMMENT_TYPES.map(type => {
          const meta = COMMENT_TYPE_META[type];
          return (
            <button
              key={type}
              className={`comment-type-pill${selectedType === type ? ' comment-type-pill-active' : ''}`}
              style={selectedType === type ? { borderColor: meta.color, background: meta.color + '18' } : undefined}
              onClick={() => setSelectedType(type)}
              title={meta.label}
            >
              <span className="comment-type-icon">{meta.icon}</span>
              <span className="comment-type-label">{meta.label}</span>
            </button>
          );
        })}
      </div>

      <textarea
        ref={bodyRef}
        className="comment-popover-body"
        value={body}
        onChange={(e) => { setBody(e.target.value); if (error) setError(null); }}
        onKeyDown={handleKeyDown}
        placeholder="Write your comment..."
        rows={3}
      />

      {error && <div className="comment-popover-error">{error}</div>}

      <div className="comment-popover-actions">
        <span className="comment-popover-hint">Ctrl+Enter to submit</span>
        <button className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Saving...' : 'Comment'}
        </button>
      </div>
    </div>
  );
}
