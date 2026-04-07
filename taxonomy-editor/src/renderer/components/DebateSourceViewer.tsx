// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { api } from '@bridge';

type SearchMode = 'raw' | 'wildcard' | 'similar';

interface DebateSourceViewerProps {
  content: string;
  sourceType: 'document' | 'url';
  sourceRef: string;
}

/** Split text into sentences (rough but effective) */
function splitSentences(text: string): { text: string; start: number }[] {
  const results: { text: string; start: number }[] = [];
  // Split on sentence-ending punctuation followed by whitespace
  const regex = /[^.!?\n]+[.!?\n]+[\s]*/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const s = match[0].trim();
    if (s.length > 10) { // skip very short fragments
      results.push({ text: s, start: match.index });
    }
  }
  return results;
}

/** Simple wildcard to regex conversion */
function wildcardToRegex(pattern: string): RegExp | null {
  try {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(escaped, 'gi');
  } catch {
    return null;
  }
}

interface SearchMatch {
  index: number; // character index in content
  length: number;
  sentence?: string; // for similar mode
  score?: number;
}

export function DebateSourceViewer({ content, sourceType, sourceRef }: DebateSourceViewerProps) {
  const [viewMode, setViewMode] = useState<'web' | 'text'>(sourceType === 'url' ? 'web' : 'text');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('raw');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [similarLoading, setSimilarLoading] = useState(false);
  const contentRef = useRef<HTMLPreElement>(null);

  // Raw and wildcard search — synchronous
  const textMatches = useMemo(() => {
    if (!query || mode === 'similar') return [];
    const results: SearchMatch[] = [];
    let regex: RegExp | null = null;

    if (mode === 'raw') {
      try {
        regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      } catch { return []; }
    } else {
      regex = wildcardToRegex(query);
    }
    if (!regex) return [];

    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null && results.length < 500) {
      results.push({ index: m.index, length: m[0].length });
      if (m[0].length === 0) regex.lastIndex++;
    }
    return results;
  }, [query, mode, content]);

  // Update matches for raw/wildcard
  useEffect(() => {
    if (mode !== 'similar') {
      setMatches(textMatches);
      setActiveMatchIdx(0);
    }
  }, [textMatches, mode]);

  // Similar search — async via embeddings
  const runSimilarSearch = useCallback(async () => {
    if (!query.trim() || mode !== 'similar') return;
    setSimilarLoading(true);

    try {
      const sentences = splitSentences(content);
      if (sentences.length === 0) {
        setMatches([]);
        setSimilarLoading(false);
        return;
      }

      const texts = sentences.map(s => s.text);
      const ids = sentences.map((_, i) => `s${i}`);

      // Compute embeddings for all sentences + the query
      const [{ vectors }, { vector: queryVec }] = await Promise.all([
        api.computeEmbeddings(texts, ids),
        api.computeQueryEmbedding(query),
      ]);

      // Cosine similarity
      const dot = (a: number[], b: number[]) => {
        let sum = 0;
        for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
        return sum;
      };
      const norm = (a: number[]) => Math.sqrt(dot(a, a));
      const qNorm = norm(queryVec);

      const scored = sentences.map((s, i) => {
        const sim = qNorm > 0 ? dot(vectors[i], queryVec) / (norm(vectors[i]) * qNorm) : 0;
        return { ...s, score: sim, idx: i };
      });

      // Sort by similarity, take top 20 with score > 0.3
      scored.sort((a, b) => b.score - a.score);
      const top = scored.filter(s => s.score > 0.3).slice(0, 20);

      setMatches(top.map(s => ({
        index: s.start,
        length: s.text.length,
        sentence: s.text,
        score: s.score,
      })));
      setActiveMatchIdx(0);
    } catch (err) {
      console.error('[DebateSourceViewer] Similar search error:', err);
      setMatches([]);
    }
    setSimilarLoading(false);
  }, [query, mode, content]);

  // Trigger similar search on Enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'similar') {
        runSimilarSearch();
      } else if (matches.length > 0) {
        // Navigate to next match
        const next = (activeMatchIdx + 1) % matches.length;
        setActiveMatchIdx(next);
        scrollToMatch(next);
      }
    }
  };

  const scrollToMatch = (idx: number) => {
    const el = contentRef.current?.querySelector(`[data-match-idx="${idx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  useEffect(() => {
    if (matches.length > 0) scrollToMatch(activeMatchIdx);
  }, [activeMatchIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render content with highlights
  const highlightedContent = useMemo(() => {
    if (matches.length === 0 || !query) return content;

    // Sort matches by index
    const sorted = [...matches].sort((a, b) => a.index - b.index);
    const parts: (string | { text: string; matchIdx: number })[] = [];
    let lastEnd = 0;

    for (let i = 0; i < sorted.length; i++) {
      const m = sorted[i];
      if (m.index > lastEnd) {
        parts.push(content.slice(lastEnd, m.index));
      }
      // Find original index in matches array
      const origIdx = matches.indexOf(m);
      parts.push({ text: content.slice(m.index, m.index + m.length), matchIdx: origIdx });
      lastEnd = m.index + m.length;
    }
    if (lastEnd < content.length) {
      parts.push(content.slice(lastEnd));
    }
    return parts;
  }, [content, matches, query]);

  return (
    <div className="debate-source-viewer">
      {/* Search bar — shown in text mode or always for documents */}
      {viewMode === 'text' && (
        <div className="debate-source-search">
          <input
            className="debate-source-search-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode === 'similar' ? 'Describe what you\'re looking for...' : 'Search document...'}
          />
          <select
            className="debate-source-search-mode"
            value={mode}
            onChange={(e) => { setMode(e.target.value as SearchMode); setMatches([]); setActiveMatchIdx(0); }}
          >
            <option value="raw">Raw</option>
            <option value="wildcard">Wildcard</option>
            <option value="similar">Similar</option>
          </select>
          {mode === 'similar' && (
            <button className="btn btn-sm" onClick={runSimilarSearch} disabled={similarLoading || !query.trim()}>
              {similarLoading ? 'Searching...' : 'Search'}
            </button>
          )}
          {matches.length > 0 && (
            <>
              <span className="debate-source-search-count">
                {activeMatchIdx + 1}/{matches.length}
              </span>
              <button className="btn btn-sm" onClick={() => { setActiveMatchIdx(i => (i > 0 ? i - 1 : matches.length - 1)); }} title="Previous">&uarr;</button>
              <button className="btn btn-sm" onClick={() => { setActiveMatchIdx(i => (i < matches.length - 1 ? i + 1 : 0)); }} title="Next">&darr;</button>
            </>
          )}
          {sourceType === 'url' && (
            <button className="btn btn-sm" onClick={() => setViewMode('web')} title="Show web page">Web</button>
          )}
        </div>
      )}

      {/* View toggle bar for web mode */}
      {viewMode === 'web' && (
        <div className="debate-source-search">
          <span className="debate-source-search-count" style={{ flex: 1 }}>Showing rendered web page</span>
          <button className="btn btn-sm" onClick={() => setViewMode('text')} title="Show searchable text">Text + Search</button>
        </div>
      )}

      {/* Similar mode results list */}
      {viewMode === 'text' && mode === 'similar' && matches.length > 0 && (
        <div className="debate-source-similar-results">
          {matches.map((m, i) => (
            <div
              key={i}
              className={`debate-source-similar-item${i === activeMatchIdx ? ' active' : ''}`}
              onClick={() => { setActiveMatchIdx(i); scrollToMatch(i); }}
            >
              <span className="debate-source-similar-score">{Math.round((m.score || 0) * 100)}%</span>
              <span className="debate-source-similar-text">{m.sentence}</span>
            </div>
          ))}
        </div>
      )}

      {/* Content area */}
      {viewMode === 'web' ? (
        import.meta.env.VITE_TARGET === 'web'
          ? <iframe src={sourceRef} className="webview-frame" sandbox="allow-scripts allow-same-origin" />
          : <webview src={sourceRef} className="webview-frame" />
      ) : (
        <pre className="debate-source-content" ref={contentRef}>
          {typeof highlightedContent === 'string' ? (
            highlightedContent
          ) : (
            (highlightedContent as (string | { text: string; matchIdx: number })[]).map((part, i) =>
              typeof part === 'string' ? (
                part
              ) : (
                <mark
                  key={i}
                  className={`debate-source-highlight${part.matchIdx === activeMatchIdx ? ' active' : ''}`}
                  data-match-idx={part.matchIdx}
                >
                  {part.text}
                </mark>
              )
            )
          )}
        </pre>
      )}
    </div>
  );
}
