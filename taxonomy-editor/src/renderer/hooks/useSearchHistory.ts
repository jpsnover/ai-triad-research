// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useCallback, useRef } from 'react';

const STORAGE_PREFIX = 'search-history:';
const MAX_ENTRIES = 20;
const MIN_TERM_LENGTH = 2;

function loadHistory(area: string): string[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${area}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch { /* telemetry — silent by design */ return []; }
}

function saveHistory(area: string, terms: string[]): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${area}`, JSON.stringify(terms.slice(0, MAX_ENTRIES)));
  } catch { /* telemetry — silent by design */ }
}

export function useSearchHistory(area: string) {
  const [history, setHistory] = useState(() => loadHistory(area));
  const areaRef = useRef(area);
  areaRef.current = area;

  const addTerm = useCallback((term: string) => {
    const trimmed = term.trim();
    if (trimmed.length < MIN_TERM_LENGTH) return;
    setHistory(prev => {
      const deduped = prev.filter(t => t.toLowerCase() !== trimmed.toLowerCase());
      const next = [trimmed, ...deduped].slice(0, MAX_ENTRIES);
      saveHistory(areaRef.current, next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try { localStorage.removeItem(`${STORAGE_PREFIX}${areaRef.current}`); } catch { /* telemetry — silent by design */ }
  }, []);

  return { history, addTerm, clearHistory };
}
