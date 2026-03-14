// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store/useStore';
import { buildSearchRegex, type SearchMode } from '../utils/searchRegex';
import { cosineSimilarity } from '../utils/similarity';

export default function DocumentPane() {
  const selectedKeyPoint = useStore(s => s.selectedKeyPoint);
  const summaries = useStore(s => s.summaries);
  const snapshots = useStore(s => s.snapshots);
  const sources = useStore(s => s.sources);
  const documentSearchText = useStore(s => s.documentSearchText);
  const contentRef = useRef<HTMLDivElement>(null);

  // ── Search state ──────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('raw');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Similar search state ──────────────────────────────────────────
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarSections, setSimilarSections] = useState<Array<{
    index: number; text: string; score: number; el: HTMLElement;
  }>>([]);

  const keyPointData = useMemo(() => {
    if (!selectedKeyPoint) return null;
    const summary = summaries[selectedKeyPoint.docId];
    if (!summary?.pov_summaries?.[selectedKeyPoint.pov]) return null;
    const kp = summary.pov_summaries[selectedKeyPoint.pov].key_points[selectedKeyPoint.index];
    return kp || null;
  }, [selectedKeyPoint, summaries]);

  const snapshotText = selectedKeyPoint ? snapshots[selectedKeyPoint.docId] || '' : '';
  const source = selectedKeyPoint ? sources.find(s => s.id === selectedKeyPoint.docId) : null;

  // Find and highlight the verbatim quote in the snapshot
  const renderedContent = useMemo(() => {
    if (!snapshotText) return null;
    if (!keyPointData?.verbatim) return { before: snapshotText, match: '', after: '' };

    const verbatim = keyPointData.verbatim;
    // Try exact match first
    let matchIdx = snapshotText.indexOf(verbatim);

    // Try with normalized whitespace if exact match fails
    if (matchIdx === -1) {
      const normalizedSnapshot = snapshotText.replace(/\s+/g, ' ');
      const normalizedVerbatim = verbatim.replace(/\s+/g, ' ');
      const normalizedIdx = normalizedSnapshot.indexOf(normalizedVerbatim);

      if (normalizedIdx !== -1) {
        // Map back to original positions by counting characters
        let origPos = 0;
        let normPos = 0;
        while (normPos < normalizedIdx && origPos < snapshotText.length) {
          if (/\s/.test(snapshotText[origPos])) {
            origPos++;
            if (origPos < snapshotText.length && /\s/.test(snapshotText[origPos])) {
              while (origPos < snapshotText.length && /\s/.test(snapshotText[origPos])) {
                origPos++;
              }
              origPos--;
            }
          }
          origPos++;
          normPos++;
        }
        let endNormPos = normalizedIdx + normalizedVerbatim.length;
        let endOrigPos = origPos;
        while (normPos < endNormPos && endOrigPos < snapshotText.length) {
          if (/\s/.test(snapshotText[endOrigPos])) {
            endOrigPos++;
            if (endOrigPos < snapshotText.length && /\s/.test(snapshotText[endOrigPos])) {
              while (endOrigPos < snapshotText.length && /\s/.test(snapshotText[endOrigPos])) {
                endOrigPos++;
              }
              endOrigPos--;
            }
          }
          endOrigPos++;
          normPos++;
        }
        return {
          before: snapshotText.slice(0, origPos),
          match: snapshotText.slice(origPos, endOrigPos),
          after: snapshotText.slice(endOrigPos),
        };
      }

      // Try substring match (first 80 chars of verbatim)
      const snippet = verbatim.slice(0, 80);
      matchIdx = snapshotText.indexOf(snippet);
      if (matchIdx !== -1) {
        return {
          before: snapshotText.slice(0, matchIdx),
          match: snapshotText.slice(matchIdx, matchIdx + verbatim.length),
          after: snapshotText.slice(matchIdx + verbatim.length),
        };
      }

      return { before: snapshotText, match: '', after: '' };
    }

    return {
      before: snapshotText.slice(0, matchIdx),
      match: snapshotText.slice(matchIdx, matchIdx + verbatim.length),
      after: snapshotText.slice(matchIdx + verbatim.length),
    };
  }, [snapshotText, keyPointData]);

  // Scroll to highlighted match
  useEffect(() => {
    if (!renderedContent?.match) return;
    const timer = setTimeout(() => {
      const mark = contentRef.current?.querySelector('.highlight-match');
      if (mark) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [renderedContent, selectedKeyPoint]);

  // ── Search: clear when document changes, or auto-populate from claim/concept click
  const prevDocRef = useRef(selectedKeyPoint?.docId);
  useEffect(() => {
    const docChanged = selectedKeyPoint?.docId !== prevDocRef.current;
    prevDocRef.current = selectedKeyPoint?.docId;

    if (documentSearchText) {
      setSearchQuery(documentSearchText);
      setSearchOpen(true);
      setCurrentMatch(0);
      // Auto-search from claims should use raw mode
      setSearchMode('raw');
    } else if (docChanged) {
      setSearchQuery('');
      setMatchCount(0);
      setCurrentMatch(0);
      setSimilarSections([]);
    }
  }, [selectedKeyPoint, documentSearchText]);

  // ── Search helpers ───────────────────────────────────────────────
  /** Count how many times `query` appears (case-insensitive) in the container text nodes */
  const countTextMatches = useCallback((container: HTMLElement, query: string): number => {
    const q = query.toLowerCase();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let count = 0;
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const lower = (node.textContent || '').toLowerCase();
      let start = 0;
      while (true) {
        const idx = lower.indexOf(q, start);
        if (idx === -1) break;
        count++;
        start = idx + q.length;
      }
    }
    return count;
  }, []);

  /**
   * For auto-search (claims/concepts), find the best phrase that actually
   * appears in the document. Tries the full text first, then progressively
   * shorter word windows, then individual distinctive words.
   */
  const resolveSearchQuery = useCallback((fullText: string, container: HTMLElement): string => {
    const q = fullText.trim();
    if (countTextMatches(container, q) > 0) return q;

    const words = q.split(/\s+/);
    for (let windowSize = Math.min(4, words.length - 1); windowSize >= 2; windowSize--) {
      for (let i = 0; i <= words.length - windowSize; i++) {
        const phrase = words.slice(i, i + windowSize).join(' ');
        if (countTextMatches(container, phrase) > 0) return phrase;
      }
    }

    const stopWords = new Set(['which', 'their', 'there', 'would', 'could', 'should', 'about', 'these', 'those', 'being', 'between', 'through', 'during', 'before', 'after', 'other', 'because', 'while', 'where', 'since']);
    const distinctive = words
      .filter(w => w.length >= 6 && !stopWords.has(w.toLowerCase().replace(/[^a-z]/g, '')))
      .sort((a, b) => b.length - a.length);
    for (const word of distinctive) {
      if (countTextMatches(container, word) > 0) return word;
    }

    return q;
  }, [countTextMatches]);

  // ── Regex-based highlight (for raw / wildcard / regex modes) ─────
  const highlightWithRegex = useCallback((container: HTMLElement, regex: RegExp): number => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      textNodes.push(node);
    }

    let total = 0;
    for (const textNode of textNodes) {
      const text = textNode.textContent || '';
      regex.lastIndex = 0;
      const indices: Array<{ start: number; end: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        if (m[0].length === 0) { regex.lastIndex++; continue; }
        indices.push({ start: m.index, end: m.index + m[0].length });
        if (indices.length > 500) break;
      }
      if (indices.length === 0) continue;

      const frag = document.createDocumentFragment();
      let lastEnd = 0;
      for (const { start, end } of indices) {
        if (start > lastEnd) {
          frag.appendChild(document.createTextNode(text.slice(lastEnd, start)));
        }
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.dataset.matchIndex = String(total);
        mark.textContent = text.slice(start, end);
        frag.appendChild(mark);
        total++;
        lastEnd = end;
      }
      if (lastEnd < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastEnd)));
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }

    return total;
  }, []);

  // ── Clear all highlights ─────────────────────────────────────────
  const clearHighlights = useCallback((container: HTMLElement) => {
    container.querySelectorAll('.search-highlight, .similar-highlight').forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        parent.normalize();
      }
    });
  }, []);

  // ── Similar search: embedding-based ──────────────────────────────
  const runSimilarSearch = useCallback(async (query: string, container: HTMLElement) => {
    if (!query || query.length < 3) {
      setMatchCount(0);
      setSimilarSections([]);
      return;
    }

    setSimilarLoading(true);
    clearHighlights(container);

    try {
      // Collect paragraph-level text nodes from the rendered document
      const paragraphs: Array<{ text: string; el: HTMLElement }> = [];
      const blockEls = container.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote');
      blockEls.forEach(el => {
        const text = (el.textContent || '').trim();
        if (text.length >= 20) {
          paragraphs.push({ text, el: el as HTMLElement });
        }
      });

      if (paragraphs.length === 0) {
        setMatchCount(0);
        setSimilarSections([]);
        setSimilarLoading(false);
        return;
      }

      // Compute embeddings: query + all paragraphs
      const allTexts = [query, ...paragraphs.map(p => p.text)];
      const vectors = await window.electronAPI.computeEmbeddings(allTexts);
      const queryVec = vectors[0];

      // Score each paragraph
      const scored = paragraphs.map((p, i) => ({
        index: i,
        text: p.text,
        score: cosineSimilarity(queryVec, vectors[i + 1]),
        el: p.el,
      }));

      // Keep top matches above threshold
      const threshold = 0.5;
      const matches = scored
        .filter(s => s.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

      setSimilarSections(matches);
      setMatchCount(matches.length);
      setCurrentMatch(0);

      // Highlight matched paragraphs
      for (let i = 0; i < matches.length; i++) {
        const el = matches[i].el;
        el.classList.add('similar-highlight');
        el.dataset.matchIndex = String(i);
        el.dataset.similarScore = matches[i].score.toFixed(2);
      }

      // Scroll to best match
      if (matches.length > 0) {
        matches[0].el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (err) {
      console.error('[DocumentPane] Similar search failed:', err);
      setMatchCount(0);
      setSimilarSections([]);
    } finally {
      setSimilarLoading(false);
    }
  }, [clearHighlights]);

  // ── Search: DOM-based highlighting ────────────────────────────────
  const highlightMatches = useCallback(() => {
    const container = contentRef.current;
    if (!container) return;

    clearHighlights(container);
    setSimilarSections([]);

    if (!searchQuery || searchQuery.length < 2) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    if (searchMode === 'similar') {
      runSimilarSearch(searchQuery, container);
      return;
    }

    // For auto-search from claims/concepts, find the best matching phrase
    let effectiveQuery = searchQuery;
    if (documentSearchText && searchQuery === documentSearchText && searchMode === 'raw') {
      effectiveQuery = resolveSearchQuery(searchQuery, container);
      if (effectiveQuery !== searchQuery) {
        setSearchQuery(effectiveQuery);
        return; // will re-run with updated query
      }
    }

    const regex = buildSearchRegex(effectiveQuery, searchMode, caseSensitive);
    if (!regex) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    const total = highlightWithRegex(container, regex);

    setMatchCount(total);
    if (total > 0) {
      setCurrentMatch(prev => (prev >= total ? 0 : prev));
    } else {
      setCurrentMatch(0);
    }
  }, [searchQuery, searchMode, caseSensitive, documentSearchText, resolveSearchQuery, clearHighlights, highlightWithRegex, runSimilarSearch]);

  useEffect(() => {
    // Small delay so ReactMarkdown finishes rendering
    const timer = setTimeout(highlightMatches, 50);
    return () => clearTimeout(timer);
  }, [highlightMatches, renderedContent]);

  // ── Search: scroll to current match ───────────────────────────────
  useEffect(() => {
    const container = contentRef.current;
    if (!container || matchCount === 0) return;

    if (searchMode === 'similar') {
      // For similar mode, scroll to the current similar section
      container.querySelectorAll('.similar-highlight').forEach(el => {
        el.classList.remove('similar-highlight--active');
      });
      const active = container.querySelector(
        `.similar-highlight[data-match-index="${currentMatch}"]`
      );
      if (active) {
        active.classList.add('similar-highlight--active');
        active.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      container.querySelectorAll('.search-highlight').forEach(el => {
        el.classList.remove('search-highlight--active');
      });
      const active = container.querySelector(
        `.search-highlight[data-match-index="${currentMatch}"]`
      );
      if (active) {
        active.classList.add('search-highlight--active');
        active.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentMatch, matchCount, searchMode]);

  // ── Search: navigation helpers ────────────────────────────────────
  const goNextMatch = useCallback(() => {
    if (matchCount === 0) return;
    setCurrentMatch(prev => (prev + 1) % matchCount);
  }, [matchCount]);

  const goPrevMatch = useCallback(() => {
    if (matchCount === 0) return;
    setCurrentMatch(prev => (prev - 1 + matchCount) % matchCount);
  }, [matchCount]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setMatchCount(0);
    setCurrentMatch(0);
    setSimilarSections([]);
    const container = contentRef.current;
    if (container) {
      clearHighlights(container);
    }
  }, [clearHighlights]);

  // ── Context menu ───────────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    const text = selection?.toString() || '';
    if (!text) return; // only show menu when text is selected
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, text });
  }, []);

  const handleCopyFromMenu = useCallback(() => {
    if (ctxMenu?.text) {
      navigator.clipboard.writeText(ctxMenu.text);
    }
    setCtxMenu(null);
  }, [ctxMenu]);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [ctxMenu]);

  // ── Keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (e.key === 'Escape' && searchOpen) {
        closeSearch();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen, closeSearch]);

  if (!selectedKeyPoint) {
    return (
      <>
        <div className="pane-header">
          <h2>Document</h2>
        </div>
        <div className="pane-body">
          <div className="empty-state">
            Click a key point, claim, or concept to view its source document
          </div>
        </div>
      </>
    );
  }

  const matchStatusText = () => {
    if (searchMode === 'similar') {
      if (similarLoading) return 'Searching...';
      if (matchCount > 0) return `${currentMatch + 1} / ${matchCount}`;
      if (searchQuery.length >= 3) return 'No matches';
      return '';
    }
    if (searchQuery.length < 2) return '';
    return matchCount > 0 ? `${currentMatch + 1} / ${matchCount}` : 'No matches';
  };

  return (
    <>
      <div className="pane-header">
        <h2>{source?.title || selectedKeyPoint.docId}</h2>
        <div className="doc-search-controls">
          {searchOpen ? (
            <div className="doc-search-bar">
              <input
                ref={searchInputRef}
                type="text"
                className="doc-search-input"
                placeholder={searchMode === 'similar' ? 'Semantic search...' : 'Find in document...'}
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setCurrentMatch(0); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.shiftKey ? goPrevMatch() : goNextMatch();
                  }
                  if (e.key === 'Escape') {
                    closeSearch();
                  }
                }}
              />
              <select
                className="doc-search-mode"
                value={searchMode}
                onChange={e => { setSearchMode(e.target.value as SearchMode); setCurrentMatch(0); }}
                title="Search mode"
              >
                <option value="raw">Raw</option>
                <option value="wildcard">Wildcard</option>
                <option value="regex">Regex</option>
                <option value="similar">Similar</option>
              </select>
              {searchMode !== 'similar' && (
                <button
                  className={`doc-search-case${caseSensitive ? ' active' : ''}`}
                  onClick={() => setCaseSensitive(v => !v)}
                  title="Case sensitive"
                >
                  Aa
                </button>
              )}
              <span className="doc-search-count">
                {matchStatusText()}
              </span>
              <button className="doc-search-nav" onClick={goPrevMatch} disabled={matchCount === 0} title="Previous (Shift+Enter)">&#x25B2;</button>
              <button className="doc-search-nav" onClick={goNextMatch} disabled={matchCount === 0} title="Next (Enter)">&#x25BC;</button>
              <button className="doc-search-close" onClick={closeSearch} title="Close (Esc)">&times;</button>
            </div>
          ) : (
            <button
              className="doc-search-toggle"
              onClick={() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); }}
              title="Find in document (Ctrl+F)"
            >
              &#x1F50D;
            </button>
          )}
        </div>
      </div>

      {keyPointData && (
        <div className="excerpt-banner">
          <div className="excerpt-banner-label">Excerpt Context</div>
          <div className="excerpt-banner-context">{keyPointData.excerpt_context}</div>
          {keyPointData.verbatim && !renderedContent?.match && (
            <div className="excerpt-banner-quote">
              &ldquo;{keyPointData.verbatim}&rdquo;
            </div>
          )}
        </div>
      )}

      <div
        className="pane-body document-body"
        ref={contentRef}
        onContextMenu={handleContextMenu}
      >
        {!snapshotText && (
          <div className="empty-state">No snapshot available for this source</div>
        )}

        {renderedContent && (
          <div className="snapshot-text">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{renderedContent.before}</ReactMarkdown>
            {renderedContent.match && (
              <mark className="highlight-match">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{renderedContent.match}</ReactMarkdown>
              </mark>
            )}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{renderedContent.after}</ReactMarkdown>
          </div>
        )}

        {ctxMenu && (
          <div
            ref={ctxMenuRef}
            className="doc-context-menu"
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
          >
            <button className="doc-context-menu-item" onClick={handleCopyFromMenu}>
              Copy
            </button>
          </div>
        )}
      </div>

      {searchMode === 'similar' && similarSections.length > 0 && (
        <div className="similar-results-bar">
          {similarSections.map((s, i) => (
            <button
              key={i}
              className={`similar-result-chip${i === currentMatch ? ' active' : ''}`}
              onClick={() => setCurrentMatch(i)}
              title={s.text.slice(0, 80)}
            >
              {(s.score * 100).toFixed(0)}%
            </button>
          ))}
        </div>
      )}
    </>
  );
}
