import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store/useStore';

export default function DocumentPane() {
  const selectedKeyPoint = useStore(s => s.selectedKeyPoint);
  const summaries = useStore(s => s.summaries);
  const snapshots = useStore(s => s.snapshots);
  const sources = useStore(s => s.sources);
  const contentRef = useRef<HTMLDivElement>(null);

  // ── Search state ──────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
            // Skip extra whitespace in original
            origPos++;
            if (origPos < snapshotText.length && /\s/.test(snapshotText[origPos])) {
              while (origPos < snapshotText.length && /\s/.test(snapshotText[origPos])) {
                origPos++;
              }
              origPos--; // back up one — the outer loop will increment
            }
          }
          origPos++;
          normPos++;
        }
        // Find the end
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

  // ── Search: clear when document changes ───────────────────────────
  useEffect(() => {
    setSearchQuery('');
    setMatchCount(0);
    setCurrentMatch(0);
  }, [selectedKeyPoint]);

  // ── Search: DOM-based highlighting ────────────────────────────────
  const highlightMatches = useCallback(() => {
    const container = contentRef.current;
    if (!container) return;

    // Remove old search highlights
    container.querySelectorAll('.search-highlight').forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        parent.normalize();
      }
    });

    if (!searchQuery || searchQuery.length < 2) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    const query = searchQuery.toLowerCase();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      textNodes.push(node);
    }

    let total = 0;
    for (const textNode of textNodes) {
      const text = textNode.textContent || '';
      const lower = text.toLowerCase();
      const indices: number[] = [];
      let start = 0;
      while (true) {
        const idx = lower.indexOf(query, start);
        if (idx === -1) break;
        indices.push(idx);
        start = idx + query.length;
      }
      if (indices.length === 0) continue;

      const frag = document.createDocumentFragment();
      let lastEnd = 0;
      for (const idx of indices) {
        if (idx > lastEnd) {
          frag.appendChild(document.createTextNode(text.slice(lastEnd, idx)));
        }
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.dataset.matchIndex = String(total);
        mark.textContent = text.slice(idx, idx + query.length);
        frag.appendChild(mark);
        total++;
        lastEnd = idx + query.length;
      }
      if (lastEnd < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastEnd)));
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }

    setMatchCount(total);
    if (total > 0) {
      setCurrentMatch(prev => (prev >= total ? 0 : prev));
    } else {
      setCurrentMatch(0);
    }
  }, [searchQuery]);

  useEffect(() => {
    // Small delay so ReactMarkdown finishes rendering
    const timer = setTimeout(highlightMatches, 50);
    return () => clearTimeout(timer);
  }, [highlightMatches, renderedContent]);

  // ── Search: scroll to current match ───────────────────────────────
  useEffect(() => {
    const container = contentRef.current;
    if (!container || matchCount === 0) return;

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
  }, [currentMatch, matchCount]);

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
    // Clean up highlights
    const container = contentRef.current;
    if (container) {
      container.querySelectorAll('.search-highlight').forEach(el => {
        const parent = el.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(el.textContent || ''), el);
          parent.normalize();
        }
      });
    }
  }, []);

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
            Click a key point to view its source document
          </div>
        </div>
      </>
    );
  }

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
                placeholder="Find in document..."
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
              {searchQuery.length >= 2 && (
                <span className="doc-search-count">
                  {matchCount > 0 ? `${currentMatch + 1} / ${matchCount}` : 'No matches'}
                </span>
              )}
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

      <div className="pane-body document-body" ref={contentRef}>
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
      </div>
    </>
  );
}
