// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useCommentStore, COMMENT_TYPE_META } from '../../hooks/useCommentStore';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
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
        c.body?.toLowerCase().includes(q)
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
                // eslint-disable-next-line local/no-inline-style -- dynamic comment-type color + stack height
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

// ── CommentOverlay (render-then-overlay, HLD t/1683#1) ────

const HIGHLIGHT_ATTR = 'data-comment-highlight';

interface CommentOverlayProps {
  /** Ref to the already-rendered markdown container to decorate. */
  containerRef: RefObject<HTMLElement | null>;
  entryId: string;
  activeTier: DetailTier;
}

interface NodeSpan {
  node: Text;
  start: number;
  end: number;
}

interface RenderedMap {
  text: string;
  nodes: NodeSpan[];
}

interface RangeSegment {
  start: number;
  end: number;
  comments: Comment[];
}

/**
 * Decorates an already-rendered markdown container with comment highlights,
 * resolving each comment's range by locating its stored `selectedText` in the
 * rendered text (never re-rendering the text itself). Preserves markdown
 * formatting; if a comment's `selectedText` can't be resolved, it renders no
 * highlight and leaves the container untouched (graceful degradation).
 *
 * Consumer contract: the markdown container must be a reconciliation-stable
 * subtree (a memoized Markdown element keyed on content) so comment-only
 * re-renders don't diff the nodes this overlay wraps (HLD t/1683#1, Decision 2).
 */
export function CommentOverlay({ containerRef, entryId, activeTier }: CommentOverlayProps) {
  const commentsFile = useCommentStore(s => s.commentsFile);
  const filters = useCommentStore(s => s.filters);
  const focusedCommentId = useCommentStore(s => s.focusedCommentId);
  const focusComment = useCommentStore(s => s.focusComment);
  const setSidebarOpen = useCommentStore(s => s.setSidebarOpen);
  const [hovered, setHovered] = useState<{ comments: Comment[]; x: number; y: number } | null>(null);

  const matchingComments = useMemo(
    () => filterMatchingComments(commentsFile, entryId, activeTier, filters),
    [commentsFile, entryId, activeTier, filters],
  );

  const crossTierCount = useMemo(() => {
    if (!commentsFile) return 0;
    return commentsFile.comments.filter(
      c => c.textRange.entryId === entryId && c.textRange.tier !== activeTier,
    ).length;
  }, [commentsFile, entryId, activeTier]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const commentById = new Map(matchingComments.map(c => [c.id, c]));
    let applying = false;
    // Re-resolve when the container re-renders (tier / content change). Declared
    // before `decorate` so the closure can disconnect/reconnect it; assigned below.
    let observer: MutationObserver;

    const decorate = () => {
      applying = true;
      observer.disconnect();
      try {
        sweepHighlights(container);
        if (matchingComments.length > 0) applyHighlights(container, matchingComments, focusedCommentId);
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'comment-overlay',
          level: 'error',
          message: 'comment highlight decoration failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      } finally {
        observer.observe(container, { childList: true, subtree: true, characterData: true });
        applying = false;
      }
    };

    observer = new MutationObserver(() => { if (!applying) decorate(); });

    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.(`[${HIGHLIGHT_ATTR}]`);
      const id = el?.getAttribute(HIGHLIGHT_ATTR);
      if (!id) return;
      focusComment(id);
      setSidebarOpen(true);
      requestAnimationFrame(() => {
        const card = document.querySelector(`[data-comment-card="${id}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    };
    const onOver = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.(`[${HIGHLIGHT_ATTR}]`) as HTMLElement | null;
      if (!el) return;
      const ids = (el.dataset.commentIds ?? '').split(',').filter(Boolean);
      const comments = ids.map(i => commentById.get(i)).filter((c): c is Comment => !!c);
      if (comments.length === 0) return;
      const rect = el.getBoundingClientRect();
      setHovered({ comments, x: rect.left, y: rect.bottom });
    };
    const onOut = (e: MouseEvent) => {
      const related = e.relatedTarget as Element | null;
      if (related?.closest?.(`[${HIGHLIGHT_ATTR}]`)) return;
      setHovered(null);
    };

    container.addEventListener('click', onClick);
    container.addEventListener('mouseover', onOver);
    container.addEventListener('mouseout', onOut);

    decorate();

    return () => {
      observer.disconnect();
      container.removeEventListener('click', onClick);
      container.removeEventListener('mouseover', onOver);
      container.removeEventListener('mouseout', onOut);
      // `container` was captured non-null at effect start; sweep is safe even if
      // it's since been detached (querySelectorAll/normalize tolerate detachment).
      sweepHighlights(container);
      setHovered(null);
    };
  }, [containerRef, entryId, activeTier, matchingComments, focusedCommentId, focusComment, setSidebarOpen]);

  if (crossTierCount === 0 && matchingComments.length === 0) return null;

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
      {hovered && createPortal(
        <div
          className="comment-tooltip-portal"
          // eslint-disable-next-line local/no-inline-style -- dynamic fixed position from getBoundingClientRect; can't be a static token class
          style={{ position: 'fixed', left: hovered.x, top: hovered.y, zIndex: 1000, pointerEvents: 'none' }}
        >
          <CommentTooltip comments={hovered.comments} />
        </div>,
        document.body,
      )}
    </>
  );
}

/** Shared filter logic: comments for this entry+tier that pass active filters. */
function filterMatchingComments(
  commentsFile: ReturnType<typeof useCommentStore.getState>['commentsFile'],
  entryId: string,
  activeTier: DetailTier,
  filters: ReturnType<typeof useCommentStore.getState>['filters'],
): Comment[] {
  if (!commentsFile) return [];
  let comments = commentsFile.comments.filter(
    c => c.textRange.entryId === entryId && c.textRange.tier === activeTier,
  );
  const { types, authors, searchText, showResolved } = filters;
  if (!showResolved) comments = comments.filter(c => !c.resolved);
  if (types.size > 0) comments = comments.filter(c => types.has(c.type));
  if (authors.size > 0) comments = comments.filter(c => authors.has(c.author));
  if (searchText.trim()) {
    const q = searchText.trim().toLowerCase();
    comments = comments.filter(c =>
      c.body?.toLowerCase().includes(q)
      || c.textRange.selectedText.toLowerCase().includes(q)
      || c.author.toLowerCase().includes(q),
    );
  }
  return comments;
}

/** Walk the container's text nodes into a flat rendered-text string + offset map. */
function buildRenderedMap(container: HTMLElement): RenderedMap {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: NodeSpan[] = [];
  let text = '';
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const tn = n as Text;
    const val = tn.nodeValue ?? '';
    if (val.length === 0) continue;
    nodes.push({ node: tn, start: text.length, end: text.length + val.length });
    text += val;
  }
  return { text, nodes };
}

/**
 * Locate `selectedText` in the rendered text. When it occurs multiple times,
 * pick the occurrence whose start is closest to the stored `hintOffset`.
 */
function resolveRange(text: string, selectedText: string, hintOffset: number): [number, number] | null {
  if (!selectedText) return null;
  let best = -1;
  let bestDist = Infinity;
  let idx = text.indexOf(selectedText);
  while (idx !== -1) {
    const dist = Math.abs(idx - hintOffset);
    if (dist < bestDist) { best = idx; bestDist = dist; }
    idx = text.indexOf(selectedText, idx + 1);
  }
  if (best === -1) return null;
  return [best, best + selectedText.length];
}

/** Non-overlapping segments over resolved rendered-space ranges (stacks overlaps). */
function buildResolvedSegments(resolved: Array<{ comment: Comment; start: number; end: number }>): RangeSegment[] {
  const boundaries = new Set<number>();
  for (const r of resolved) { boundaries.add(r.start); boundaries.add(r.end); }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);
  const segments: RangeSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end <= start) continue;
    const comments = resolved.filter(r => r.start <= start && r.end >= end).map(r => r.comment);
    if (comments.length > 0) segments.push({ start, end, comments });
  }
  return segments;
}

/** Isolate [localStart, localEnd) of a text node into its own wrapping <span>. */
function wrapSubRange(node: Text, localStart: number, localEnd: number): HTMLSpanElement | null {
  if (localEnd <= localStart) return null;
  let target = node;
  if (localEnd < target.length) target.splitText(localEnd);
  if (localStart > 0) target = target.splitText(localStart);
  const parent = target.parentNode;
  if (!parent) return null;
  const span = document.createElement('span');
  parent.insertBefore(span, target);
  span.appendChild(target);
  return span;
}

/** Apply resolved+segmented highlights as interactive spans over the container. */
function applyHighlights(container: HTMLElement, comments: Comment[], focusedCommentId: string | null): void {
  const map = buildRenderedMap(container);
  if (map.nodes.length === 0) return;

  const resolved: Array<{ comment: Comment; start: number; end: number }> = [];
  for (const c of comments) {
    const range = resolveRange(map.text, c.textRange.selectedText, c.textRange.startOffset);
    if (range) resolved.push({ comment: c, start: range[0], end: range[1] });
  }
  if (resolved.length === 0) return;

  const segments = buildResolvedSegments(resolved);
  if (segments.length === 0) return;

  // Collect wrap ops against the ORIGINAL nodes, then apply per node right-to-left
  // so splitText on later offsets never shifts earlier ones. A segment crossing a
  // <strong>/<em>/anchor boundary spans multiple nodes → multiple spans, one id.
  const ops: Array<{ node: Text; localStart: number; localEnd: number; seg: RangeSegment }> = [];
  for (const seg of segments) {
    for (const ns of map.nodes) {
      const s = Math.max(seg.start, ns.start);
      const e = Math.min(seg.end, ns.end);
      if (e > s) ops.push({ node: ns.node, localStart: s - ns.start, localEnd: e - ns.start, seg });
    }
  }
  const byNode = new Map<Text, typeof ops>();
  for (const op of ops) {
    const arr = byNode.get(op.node);
    if (arr) arr.push(op); else byNode.set(op.node, [op]);
  }
  for (const nodeOps of byNode.values()) {
    nodeOps.sort((a, b) => b.localStart - a.localStart);
    for (const op of nodeOps) {
      const span = wrapSubRange(op.node, op.localStart, op.localEnd);
      if (span) styleHighlightSpan(span, op.seg, focusedCommentId);
    }
  }
}

/** Paint one highlight span with stack/resolved/focused styling + comment ids. */
function styleHighlightSpan(span: HTMLSpanElement, seg: RangeSegment, focusedCommentId: string | null): void {
  const top = seg.comments[0];
  const meta = COMMENT_TYPE_META[top.type];
  const resolvedAll = seg.comments.every(c => c.resolved);
  const isFocused = seg.comments.some(c => c.id === focusedCommentId);
  const stackHeight = Math.min(seg.comments.length, 3);
  span.setAttribute(HIGHLIGHT_ATTR, top.id);
  span.dataset.commentIds = seg.comments.map(c => c.id).join(',');
  span.className = `comment-highlight${resolvedAll ? ' comment-highlight-resolved' : ''}${isFocused ? ' comment-highlight-focused' : ''}`;
  span.style.borderBottomColor = meta.color;
  span.style.borderBottomWidth = `${stackHeight}px`;
}

/** Unwrap every highlight span we injected, restoring the original text nodes. */
function sweepHighlights(container: HTMLElement): void {
  const spans = container.querySelectorAll(`[${HIGHLIGHT_ATTR}]`);
  spans.forEach(span => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  });
  container.normalize();
}

function CommentTooltip({ comments }: { comments: Comment[] }) {
  return (
    <div className="comment-tooltip">
      {comments.slice(0, 3).map(c => {
        const meta = COMMENT_TYPE_META[c.type];
        return (
          <div key={c.id} className="comment-tooltip-item">
            <span
              className="comment-tooltip-badge"
              // eslint-disable-next-line local/no-inline-style -- dynamic comment-type color
              style={{ background: meta.color }}
            >
              {meta.icon} {meta.label}
            </span>
            <span className="comment-tooltip-author">{c.author}</span>
            <span className="comment-tooltip-preview">
              {(c.body ?? '').length > 60 ? (c.body ?? '').slice(0, 57) + '...' : (c.body ?? '')}
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

/**
 * Returns true when CommentHighlightedText will render highlighted segments
 * for this entry+tier (after applying filters). Used by the parent to hide
 * the markdown-rendered text and avoid duplication.
 */
export function useHasCommentHighlights(entryId: string, activeTier: DetailTier): boolean {
  const commentsFile = useCommentStore(s => s.commentsFile);
  const filters = useCommentStore(s => s.filters);
  return useMemo(() => {
    if (!commentsFile) return false;
    let comments = commentsFile.comments.filter(
      c => c.textRange.entryId === entryId && c.textRange.tier === activeTier,
    );
    const { types, authors, searchText, showResolved } = filters;
    if (!showResolved) comments = comments.filter(c => !c.resolved);
    if (types.size > 0) comments = comments.filter(c => types.has(c.type));
    if (authors.size > 0) comments = comments.filter(c => authors.has(c.author));
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      comments = comments.filter(c =>
        c.body?.toLowerCase().includes(q)
        || c.textRange.selectedText.toLowerCase().includes(q)
        || c.author.toLowerCase().includes(q),
      );
    }
    return comments.length > 0;
  }, [commentsFile, entryId, activeTier, filters]);
}
