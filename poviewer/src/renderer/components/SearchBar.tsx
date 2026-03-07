// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { buildSearchRegex } from '../utils/searchRegex';
import type { SearchMode } from '../types/types';

const MODE_LABELS: Record<SearchMode, string> = {
  raw: 'Raw',
  wildcard: 'Wildcard',
  regex: 'Regex',
};

const MODES: SearchMode[] = ['raw', 'wildcard', 'regex'];

interface Props {
  /** Text to search through, used for match count */
  text: string;
}

export default function SearchBar({ text }: Props) {
  const searchQuery = useAppStore(s => s.searchQuery);
  const searchMode = useAppStore(s => s.searchMode);
  const searchCaseSensitive = useAppStore(s => s.searchCaseSensitive);
  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const setSearchMode = useAppStore(s => s.setSearchMode);
  const setSearchCaseSensitive = useAppStore(s => s.setSearchCaseSensitive);

  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+F / Cmd+F focuses the search bar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        setSearchQuery('');
        inputRef.current?.blur();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setSearchQuery]);

  const matchCount = useMemo(() => {
    if (!searchQuery || !text) return 0;
    const regex = buildSearchRegex(searchQuery, searchMode, searchCaseSensitive);
    if (!regex) return 0;
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  }, [searchQuery, searchMode, searchCaseSensitive, text]);

  return (
    <div className="search-bar">
      <input
        ref={inputRef}
        type="text"
        className="search-input"
        placeholder="Search document... (Ctrl+F)"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
      />

      <select
        className="search-mode-select"
        value={searchMode}
        onChange={e => setSearchMode(e.target.value as SearchMode)}
      >
        {MODES.map(m => (
          <option key={m} value={m}>{MODE_LABELS[m]}</option>
        ))}
      </select>

      <button
        className={`search-case-btn${searchCaseSensitive ? ' active' : ''}`}
        onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
        title="Case sensitive"
      >
        Aa
      </button>

      {searchQuery && (
        <span className="search-match-count">
          {matchCount} match{matchCount !== 1 ? 'es' : ''}
        </span>
      )}

      {searchQuery && (
        <button
          className="search-clear-btn"
          onClick={() => setSearchQuery('')}
          title="Clear search"
        >
          &times;
        </button>
      )}
    </div>
  );
}
