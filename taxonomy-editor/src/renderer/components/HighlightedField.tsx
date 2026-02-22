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
}

function useHighlightParts(text: string): ReactNode[] | null {
  const { findQuery, findMode, findCaseSensitive } = useTaxonomyStore();

  return useMemo(() => {
    const regex = buildSearchRegex(findQuery, findMode, findCaseSensitive);
    if (!regex) return null;

    regex.lastIndex = 0;
    if (!regex.test(text)) return null;

    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let i = 0;
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null && i < 100) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      parts.push(<mark key={i}>{match[0]}</mark>);
      lastIndex = regex.lastIndex;
      if (match[0].length === 0) regex.lastIndex++;
      i++;
    }
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    return parts;
  }, [text, findQuery, findMode, findCaseSensitive]);
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

export function HighlightedTextarea({ value, onChange, readOnly, rows, style }: HighlightedTextareaProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const parts = useHighlightParts(value);
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
