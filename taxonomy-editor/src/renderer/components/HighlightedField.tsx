// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useRef, useCallback, useMemo, type ReactNode, type CSSProperties } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { buildSearchRegex } from '../utils/searchRegex';

interface HighlightedInputProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  type?: string;
  style?: CSSProperties;
}

interface HighlightedTextareaProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  rows?: number;
  style?: CSSProperties;
  /** Literal substrings to render bold in the backdrop overlay (e.g. "Encompasses:", "Excludes:"). */
  boldKeywords?: readonly string[];
}

const DEFAULT_BOLD_KEYWORDS: readonly string[] = ['Encompasses:', 'Excludes:'];

function useHighlightParts(text: string, boldKeywords: readonly string[] = []): ReactNode[] | null {
  const { findQuery, findMode, findCaseSensitive } = useTaxonomyStore();

  return useMemo(() => {
    const searchRegex = buildSearchRegex(findQuery, findMode, findCaseSensitive);

    // Collect match ranges from both the search regex and the bold-keyword list.
    type Range = { start: number; end: number; kind: 'mark' | 'bold' };
    const ranges: Range[] = [];

    if (searchRegex) {
      searchRegex.lastIndex = 0;
      let m: RegExpExecArray | null;
      let i = 0;
      while ((m = searchRegex.exec(text)) !== null && i < 100) {
        if (m[0].length > 0) {
          ranges.push({ start: m.index, end: m.index + m[0].length, kind: 'mark' });
        } else {
          searchRegex.lastIndex++;
        }
        i++;
      }
    }

    for (const kw of boldKeywords) {
      if (!kw) continue;
      let from = 0;
      while (from <= text.length) {
        const idx = text.indexOf(kw, from);
        if (idx < 0) break;
        ranges.push({ start: idx, end: idx + kw.length, kind: 'bold' });
        from = idx + kw.length;
      }
    }

    if (ranges.length === 0) return null;

    // Sort by start, drop ranges that overlap an earlier one (search-mark wins over bold if tied).
    ranges.sort((a, b) => a.start - b.start || (a.kind === b.kind ? 0 : a.kind === 'mark' ? -1 : 1));
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    ranges.forEach((r, i) => {
      if (r.start < lastIndex) return;
      if (r.start > lastIndex) parts.push(text.slice(lastIndex, r.start));
      const content = text.slice(r.start, r.end);
      parts.push(
        r.kind === 'mark'
          ? <mark key={i}>{content}</mark>
          : <strong key={i}>{content}</strong>
      );
      lastIndex = r.end;
    });
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
  }, [text, findQuery, findMode, findCaseSensitive, boldKeywords]);
}

export function HighlightedInput({ value, onChange, readOnly, disabled, type, style }: HighlightedInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const parts = useHighlightParts(value);
  const hasHighlight = parts !== null;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(e.target.value);
    },
    [onChange],
  );

  return (
    <div className="hl-field-wrap" ref={containerRef}>
      {hasHighlight && (
        <div className="hl-backdrop hl-backdrop-input" aria-hidden>
          {parts}
        </div>
      )}
      <input
        type={type || 'text'}
        className={hasHighlight ? 'hl-transparent' : ''}
        value={value}
        onChange={handleChange}
        readOnly={readOnly}
        disabled={disabled}
        style={style}
      />
    </div>
  );
}

/** Build formatted ReactNode[] for read-only display: line break before keywords + bold. */
function useFormattedParts(text: string, boldKeywords: readonly string[]): ReactNode[] {
  const { findQuery, findMode, findCaseSensitive } = useTaxonomyStore();

  return useMemo(() => {
    const searchRegex = buildSearchRegex(findQuery, findMode, findCaseSensitive);
    type Range = { start: number; end: number; kind: 'mark' | 'bold' };
    const ranges: Range[] = [];

    if (searchRegex) {
      searchRegex.lastIndex = 0;
      let m: RegExpExecArray | null;
      let i = 0;
      while ((m = searchRegex.exec(text)) !== null && i < 100) {
        if (m[0].length > 0) ranges.push({ start: m.index, end: m.index + m[0].length, kind: 'mark' });
        else searchRegex.lastIndex++;
        i++;
      }
    }

    for (const kw of boldKeywords) {
      if (!kw) continue;
      let from = 0;
      while (from <= text.length) {
        const idx = text.indexOf(kw, from);
        if (idx < 0) break;
        ranges.push({ start: idx, end: idx + kw.length, kind: 'bold' });
        from = idx + kw.length;
      }
    }

    ranges.sort((a, b) => a.start - b.start || (a.kind === b.kind ? 0 : a.kind === 'mark' ? -1 : 1));
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let key = 0;
    for (const r of ranges) {
      if (r.start < lastIndex) continue;
      if (r.start > lastIndex) parts.push(text.slice(lastIndex, r.start));
      const content = text.slice(r.start, r.end);
      if (r.kind === 'mark') {
        parts.push(<mark key={key++}>{content}</mark>);
      } else {
        // Line break before the bold keyword for visual separation
        parts.push(<br key={`br-${key}`} />);
        parts.push(<strong key={key++}>{content}</strong>);
      }
      lastIndex = r.end;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
  }, [text, findQuery, findMode, findCaseSensitive, boldKeywords]);
}

export function HighlightedTextarea({ value, onChange, readOnly, rows, style, boldKeywords = DEFAULT_BOLD_KEYWORDS }: HighlightedTextareaProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const parts = useHighlightParts(value, boldKeywords);
  const formattedParts = useFormattedParts(value, boldKeywords);
  const hasHighlight = parts !== null;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(e.target.value);
    },
    [onChange],
  );

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLTextAreaElement>) => {
      if (backdropRef.current) {
        backdropRef.current.scrollTop = e.currentTarget.scrollTop;
        backdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
      }
    },
    [],
  );

  // Read-only: render as formatted div with line breaks before keywords
  if (readOnly) {
    return (
      <div className="hl-readonly-display" style={style}>
        {formattedParts}
      </div>
    );
  }

  return (
    <div className="hl-field-wrap hl-field-wrap-textarea">
      {hasHighlight && (
        <div className="hl-backdrop hl-backdrop-textarea" ref={backdropRef} aria-hidden>
          {parts}
        </div>
      )}
      <textarea
        className={hasHighlight ? 'hl-transparent' : ''}
        value={value}
        onChange={handleChange}
        onScroll={handleScroll}
        readOnly={readOnly}
        rows={rows}
        style={style}
      />
    </div>
  );
}
