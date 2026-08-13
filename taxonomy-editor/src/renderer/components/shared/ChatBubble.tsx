// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import './ChatBubble.css';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkColorizePov } from '../../utils/colorizePovPlugin';

/** Canonical remark plugin set shared across all chat surfaces. */
export const CHAT_REMARK_PLUGINS = [remarkGfm, remarkColorizePov];

/**
 * Shared bubble container for a completed chat turn.
 *
 * - When `className` is provided, inline bubble styles are suppressed so the
 *   caller's CSS classes own the layout (e.g. ChatWorkspace's CSS-class surface).
 * - When `isError` is true, renders the error-bubble variant regardless of other props.
 * - `footer` is rendered below children (e.g. a navigation action link).
 */
export function MessageBubble({ role, children, footer, isError, className, style }: {
  role: 'user' | 'assistant';
  children: React.ReactNode;
  footer?: React.ReactNode;
  isError?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (isError) {
    return (
      <div className="chat-bubble-error">
        <div className="chat-bubble-error-label">
          <span aria-hidden="true">⚠</span>
          <span>Error</span>
        </div>
        {children}
      </div>
    );
  }

  const defaultStyle: React.CSSProperties = className ? {} : {
    alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
    maxWidth: '90%',
    padding: '6px 10px',
    borderRadius: 8,
    fontSize: '0.75rem',
    lineHeight: 1.4,
    background: role === 'user'
      ? 'color-mix(in srgb, var(--warning) 15%, transparent)'
      : 'var(--bg-tertiary, rgba(255,255,255,0.05))',
    color: 'var(--text-primary, var(--border-color))',
    border: role === 'user'
      ? '1px solid color-mix(in srgb, var(--warning) 30%, transparent)'
      : '1px solid var(--border-color)',
    userSelect: 'text',
    cursor: 'text',
  };

  return (
    <div className={className} style={{ ...defaultStyle, ...style }}>
      {children}
      {footer}
    </div>
  );
}

/**
 * Thinking-phase indicator: shown when the AI is processing but has not yet
 * emitted any streaming content.
 *
 * - With no `children`: renders `activity || 'Thinking...'` with inline styles.
 * - With `children`: renders them instead (callers supply their own DOM structure,
 *   e.g. `.chat-generating-dots` with animation spans).
 * - When `className` is provided, inline styles are suppressed.
 */
export function ThinkingIndicator({ activity, className, style, children }: {
  activity?: string | null;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const defaultStyle: React.CSSProperties = className ? {} : {
    alignSelf: 'flex-start',
    padding: '6px 10px',
    borderRadius: 8,
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  };

  return (
    <div className={className} style={{ ...defaultStyle, ...style }}>
      {children ?? (activity || 'Thinking...')}
    </div>
  );
}

/**
 * Streaming bubble: shown while the AI is actively streaming output.
 * Renders Markdown using the canonical plugin set.
 * When `className` is provided, inline bubble styles are suppressed.
 */
export function StreamingBubble({ content, mdClassName, className, style }: {
  content: string;
  mdClassName?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const defaultStyle: React.CSSProperties = className ? {} : {
    alignSelf: 'flex-start',
    maxWidth: '90%',
    padding: '6px 10px',
    borderRadius: 8,
    fontSize: '0.75rem',
    lineHeight: 1.4,
    background: 'var(--bg-tertiary, rgba(255,255,255,0.05))',
    color: 'var(--text-primary, var(--border-color))',
    border: '1px solid var(--border-color)',
    userSelect: 'text',
    cursor: 'text',
  };

  return (
    <div className={className} style={{ ...defaultStyle, ...style }}>
      <div className={mdClassName}>
        <Markdown remarkPlugins={CHAT_REMARK_PLUGINS}>{content}</Markdown>
      </div>
    </div>
  );
}
