// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchHistory } from '../../hooks/useSearchHistory';
import './SearchWithHistory.css';

interface SearchWithHistoryProps {
  area: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

export function SearchWithHistory({
  area, value, onChange, placeholder, className, disabled, autoFocus, onKeyDown, onFocus, inputRef,
}: SearchWithHistoryProps) {
  const { history, addTerm, clearHistory } = useSearchHistory(area);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const internalRef = useRef<HTMLInputElement>(null);

  const ref = (inputRef ?? internalRef) as React.RefObject<HTMLInputElement>;

  const filtered = value.length > 0
    ? history.filter(t => t.toLowerCase().includes(value.toLowerCase()) && t.toLowerCase() !== value.toLowerCase())
    : history;

  const showDropdown = open && filtered.length > 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const selectItem = useCallback((term: string) => {
    onChange(term);
    addTerm(term);
    setOpen(false);
    setActiveIdx(-1);
  }, [onChange, addTerm]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showDropdown) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(i - 1, -1));
        return;
      }
      if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        selectItem(filtered[activeIdx]);
        return;
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setActiveIdx(-1);
        return;
      }
    }
    if (e.key === 'Enter' && value.trim().length >= 2) {
      addTerm(value.trim());
    }
    onKeyDown?.(e);
  }, [showDropdown, activeIdx, filtered, selectItem, value, addTerm, onKeyDown]);

  return (
    <div className="search-history-wrapper" ref={wrapperRef}>
      <input
        ref={ref}
        className={className}
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActiveIdx(-1); }}
        onFocus={() => { setOpen(true); onFocus?.(); }}
        onBlur={() => { if (value.trim().length >= 2) addTerm(value.trim()); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      {showDropdown && (
        <div className="search-history-dropdown">
          {filtered.map((term, i) => (
            <button
              key={term}
              className={`search-history-item${i === activeIdx ? ' search-history-item-active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); selectItem(term); }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              <span className="search-history-icon">&#8634;</span>
              {term}
            </button>
          ))}
          <button
            className="search-history-clear"
            onMouseDown={(e) => { e.preventDefault(); clearHistory(); setOpen(false); }}
          >Clear history</button>
        </div>
      )}
    </div>
  );
}
