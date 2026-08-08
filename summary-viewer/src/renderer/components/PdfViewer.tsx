// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Real embedded PDF viewer for pane 3 — a trimmed port of poviewer's PdfViewer.
// Renders a source's raw PDF (canvas + selectable pdf.js text layer) with lazy,
// IntersectionObserver-driven page rendering and zoom.
//
// Phase 2 (t/2292) adds in-document search/highlight over the pdf.js text layer:
//   - Find (raw / wildcard / regex) with count + next/prev navigation
//   - Similar (embedding) search across page-text chunks
//   - Verbatim key-point highlighting + auto scroll-to
// Match COUNTING/ordering uses a per-page plain-text index extracted up front
// (getTextContent), so counts are accurate across not-yet-rendered pages; visual
// HIGHLIGHTING happens on each page's rendered text layer (co-located with the
// page render to avoid cross-component timing races). Reuses summary-viewer's
// existing .doc-search-* / .search-highlight / .similar-highlight styles.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { buildSearchRegex, type SearchMode } from '../utils/searchRegex';
import { cosineSimilarity } from '../utils/similarity';
import './PdfViewer.css';

// Configure pdf.js worker — version-locked via Vite ?url import from pdfjs-dist
// (same-origin asset, so it runs under the existing CSP unchanged).
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

type PDFDocumentProxy = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
type PDFPageProxy = Awaited<ReturnType<PDFDocumentProxy['getPage']>>;

interface Props {
  /** Raw PDF bytes shipped from the main process over IPC. */
  data: ArrayBuffer;
  /** Verbatim key-point quote to auto-highlight + scroll to, if any. */
  verbatim?: string | null;
}

interface SimilarResult {
  pageIndex: number;
  snippet: string;
  score: number;
}

// ── Highlight helpers (scoped to a page's text-layer container) ──────────────

/** Remove any search/similar highlight marks inside a container, restoring text. */
function clearHighlights(container: HTMLElement): void {
  container.querySelectorAll('mark.search-highlight').forEach(el => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent || ''), el);
      parent.normalize();
    }
  });
  container.querySelectorAll('.similar-highlight').forEach(el => {
    el.classList.remove('similar-highlight', 'similar-highlight--active');
  });
}

/**
 * Wrap regex matches inside a container's text nodes with
 * <mark class="search-highlight"> (data-match-index set in document order).
 * Returns the number of matches wrapped. Mirrors DocumentPane's Markdown-DOM
 * highlighter but scoped to a single page's `.textLayer`.
 */
function highlightWithRegex(container: HTMLElement, regex: RegExp): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) textNodes.push(node);

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
      if (start > lastEnd) frag.appendChild(document.createTextNode(text.slice(lastEnd, start)));
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.dataset.matchIndex = String(total);
      mark.textContent = text.slice(start, end);
      frag.appendChild(mark);
      total++;
      lastEnd = end;
    }
    if (lastEnd < text.length) frag.appendChild(document.createTextNode(text.slice(lastEnd)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
  return total;
}

// === PdfPageView (single page canvas + selectable text layer) ===

interface PageViewProps {
  pdfDoc: PDFDocumentProxy;
  pageIndex: number;
  scale: number;
  isVisible: boolean;
  /** Active Find regex; the page highlights its own text layer when set. */
  searchRegex: RegExp | null;
}

function PdfPageView({ pdfDoc, pageIndex, scale, isVisible, searchRegex }: PageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const renderTaskRef = useRef<ReturnType<PDFPageProxy['render']> | null>(null);
  const textLayerInstanceRef = useRef<TextLayer | null>(null);

  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;

    async function renderPage() {
      try {
        setRendered(false);
        const page = await pdfDoc.getPage(pageIndex + 1);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        setPageSize({ width: viewport.width, height: viewport.height });

        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.width = viewport.width * window.devicePixelRatio;
        canvas.height = viewport.height * window.devicePixelRatio;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

        if (renderTaskRef.current) renderTaskRef.current.cancel();

        const renderTask = page.render({ canvasContext: ctx, viewport, canvas });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (cancelled) return;

        const textLayerDiv = textLayerRef.current;
        if (textLayerDiv) {
          textLayerDiv.innerHTML = '';
          textLayerDiv.style.width = `${viewport.width}px`;
          textLayerDiv.style.height = `${viewport.height}px`;

          if (textLayerInstanceRef.current) textLayerInstanceRef.current.cancel();

          const textContent = await page.getTextContent();
          if (cancelled) return;

          const textLayer = new TextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport,
          });
          textLayerInstanceRef.current = textLayer;
          await textLayer.render();
        }

        if (!cancelled) setRendered(true);
      } catch (err: unknown) {
        if (err instanceof Error && err.message !== 'Rendering cancelled') {
          getGlobalRecorder()?.record({
            type: 'system.error',
            component: 'pdf-viewer',
            level: 'error',
            message: `Error rendering page ${pageIndex + 1}`,
            error: { name: err.name, message: err.message },
          });
          console.error(`[PdfViewer] Error rendering page ${pageIndex + 1}:`, err);
        }
        /* telemetry — silent by design (rendering cancelled) */
      }
    }

    renderPage();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }
      if (textLayerInstanceRef.current) { textLayerInstanceRef.current.cancel(); textLayerInstanceRef.current = null; }
    };
  }, [pdfDoc, pageIndex, scale, isVisible]);

  // Highlight this page's own text layer whenever it (re)renders or the Find
  // regex changes. Co-locating with render avoids racing the lazy text layer.
  useEffect(() => {
    const el = textLayerRef.current;
    if (!el) return;
    clearHighlights(el);
    if (rendered && searchRegex) highlightWithRegex(el, searchRegex);
  }, [rendered, searchRegex]);

  const width = pageSize?.width ?? 612 * scale;
  const height = pageSize?.height ?? 792 * scale;

  return (
    <div className="pdf-page-wrapper" data-page-index={pageIndex} style={{ width, height, position: 'relative' }}>
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      <div ref={textLayerRef} className="textLayer" />
      {!rendered && isVisible && (
        <div className="pdf-page-loading">Loading page {pageIndex + 1}...</div>
      )}
    </div>
  );
}

// === PdfViewer (main component) ===

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export default function PdfViewer({ data, verbatim }: Props) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set());

  // Per-page extracted plain text (for accurate cross-page match counting).
  const pageTextsRef = useRef<string[]>([]);
  const [pageTextsReady, setPageTextsReady] = useState(false);

  // ── Search state ────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('raw');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Similar (embedding) state ───────────────────────────────────
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarResults, setSimilarResults] = useState<SimilarResult[]>([]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Find regex (null for similar/empty)
  const searchRegex = useMemo(() => {
    if (searchMode === 'similar' || searchQuery.length < 2) return null;
    return buildSearchRegex(searchQuery, searchMode, caseSensitive);
  }, [searchQuery, searchMode, caseSensitive]);

  // Per-page Find match counts (for accurate global count + global→page mapping)
  const perPageCounts = useMemo(() => {
    if (!searchRegex || !pageTextsReady) return [];
    return pageTextsRef.current.map(text => {
      const re = new RegExp(searchRegex.source, searchRegex.flags);
      let n = 0, m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        n++;
        if (n > 5000) break;
      }
      return n;
    });
  }, [searchRegex, pageTextsReady]);

  // ── Load the PDF + build the per-page text index ────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      setPdfDoc(null);
      setVisiblePages(new Set());
      setPageTextsReady(false);
      pageTextsRef.current = [];

      try {
        const bytes = new Uint8Array(data.slice(0));
        const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setLoading(false);

        // Extract page text in the background for search indexing.
        const texts: string[] = new Array(doc.numPages).fill('');
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          texts[i - 1] = content.items
            .map((it: Record<string, unknown>) => ('str' in it ? String(it.str) : ''))
            .join('');
        }
        if (cancelled) return;
        pageTextsRef.current = texts;
        setPageTextsReady(true);
      } catch (err) {
        if (!cancelled) {
          getGlobalRecorder()?.record({
            type: 'system.error',
            component: 'pdf-viewer',
            level: 'error',
            message: 'Failed to load PDF',
            error: { name: (err as Error).name ?? 'Error', message: String(err) },
          });
          console.error('[PdfViewer] Failed to load PDF:', err);
          setError(err instanceof Error ? err.message : 'Failed to load PDF');
          setLoading(false);
        }
        /* telemetry — silent by design (cancelled) */
      }
    }

    loadPdf();
    return () => { cancelled = true; };
  }, [data]);

  // Lazily render pages as they scroll into view (+ neighbours)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !pdfDoc) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages(prev => {
          const next = new Set(prev);
          for (const entry of entries) {
            const pageIdx = Number(entry.target.getAttribute('data-page-sentinel'));
            if (entry.isIntersecting) {
              next.add(pageIdx);
              if (pageIdx > 0) next.add(pageIdx - 1);
              if (pageIdx < numPages - 1) next.add(pageIdx + 1);
            }
          }
          return next;
        });
      },
      { root: container, rootMargin: '200px 0px', threshold: 0 },
    );

    const sentinels = container.querySelectorAll<HTMLDivElement>('[data-page-sentinel]');
    sentinels.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [pdfDoc, numPages]);

  // ── Find: reset count/current when the query or index changes ───
  useEffect(() => {
    if (!searchRegex) {
      if (searchMode !== 'similar') { setMatchCount(0); setCurrentMatch(0); }
      return;
    }
    const total = perPageCounts.reduce((a, b) => a + b, 0);
    setMatchCount(total);
    setCurrentMatch(0);
  }, [searchRegex, perPageCounts, searchMode]);

  /** Map a global match ordinal to its (pageIndex, localIndex). */
  const locateMatch = useCallback((ordinal: number): { pageIndex: number; localIndex: number } | null => {
    let acc = 0;
    for (let p = 0; p < perPageCounts.length; p++) {
      if (ordinal < acc + perPageCounts[p]) return { pageIndex: p, localIndex: ordinal - acc };
      acc += perPageCounts[p];
    }
    return null;
  }, [perPageCounts]);

  const scrollPageIntoView = useCallback((pageIndex: number) => {
    const container = scrollContainerRef.current;
    const wrapper = container?.querySelector<HTMLElement>(`.pdf-page-wrapper[data-page-index="${pageIndex}"]`);
    wrapper?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // ── Find: navigate to the active match (scroll page in, mark active) ──
  useEffect(() => {
    if (!searchRegex || matchCount === 0) return;
    const target = locateMatch(currentMatch);
    if (!target) return;

    let cancelled = false;
    (async () => {
      // Ensure the target page is scheduled to render
      setVisiblePages(prev => (prev.has(target.pageIndex) ? prev : new Set(prev).add(target.pageIndex)));
      scrollPageIntoView(target.pageIndex);

      // Wait for the page's text layer to render + get highlighted
      const container = scrollContainerRef.current;
      for (let i = 0; i < 25 && !cancelled; i++) {
        const wrapper = container?.querySelector<HTMLElement>(`.pdf-page-wrapper[data-page-index="${target.pageIndex}"]`);
        const marks = wrapper?.querySelectorAll<HTMLElement>('mark.search-highlight');
        if (marks && marks.length > target.localIndex) {
          container?.querySelectorAll('mark.search-highlight--active')
            .forEach(el => el.classList.remove('search-highlight--active'));
          const active = marks[target.localIndex];
          active.classList.add('search-highlight--active');
          active.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        await sleep(120);
      }
    })();

    return () => { cancelled = true; };
  }, [currentMatch, matchCount, searchRegex, locateMatch, scrollPageIntoView]);

  // ── Similar: embed page-text chunks, rank, present as chips ─────
  const runSimilarSearch = useCallback(async (query: string) => {
    if (query.length < 3 || !pageTextsReady) { setSimilarResults([]); setMatchCount(0); return; }
    setSimilarLoading(true);
    try {
      // Chunk each page into ~sentence groups (≥40 chars), tagged with page.
      const chunks: Array<{ pageIndex: number; text: string }> = [];
      pageTextsRef.current.forEach((pageText, pageIndex) => {
        const sentences = pageText.split(/(?<=[.!?])\s+/);
        let buf = '';
        for (const s of sentences) {
          buf = buf ? `${buf} ${s}` : s;
          if (buf.length >= 200) { chunks.push({ pageIndex, text: buf.trim() }); buf = ''; }
        }
        if (buf.trim().length >= 40) chunks.push({ pageIndex, text: buf.trim() });
      });
      if (chunks.length === 0) { setSimilarResults([]); setMatchCount(0); setSimilarLoading(false); return; }

      const vectors = await window.electronAPI.computeEmbeddings([query, ...chunks.map(c => c.text)]);
      const queryVec = vectors[0];
      const scored = chunks.map((c, i) => ({
        pageIndex: c.pageIndex,
        snippet: c.text.slice(0, 120),
        score: cosineSimilarity(queryVec, vectors[i + 1]),
      }));
      const matches = scored.filter(s => s.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, 20);
      setSimilarResults(matches);
      setMatchCount(matches.length);
      setCurrentMatch(0);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'pdf-viewer',
        level: 'error',
        message: 'PDF similar search failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      console.error('[PdfViewer] Similar search failed:', err);
      setSimilarResults([]);
      setMatchCount(0);
    } finally {
      setSimilarLoading(false);
    }
  }, [pageTextsReady]);

  // ── Similar: scroll to + highlight the selected result's page ───
  useEffect(() => {
    if (searchMode !== 'similar' || similarResults.length === 0) return;
    const result = similarResults[currentMatch];
    if (!result) return;

    let cancelled = false;
    (async () => {
      setVisiblePages(prev => (prev.has(result.pageIndex) ? prev : new Set(prev).add(result.pageIndex)));
      scrollPageIntoView(result.pageIndex);

      const container = scrollContainerRef.current;
      for (let i = 0; i < 25 && !cancelled; i++) {
        const wrapper = container?.querySelector<HTMLElement>(`.pdf-page-wrapper[data-page-index="${result.pageIndex}"]`);
        const spans = wrapper?.querySelectorAll<HTMLElement>('.textLayer span');
        if (spans && spans.length > 0) {
          container?.querySelectorAll('.similar-highlight')
            .forEach(el => el.classList.remove('similar-highlight', 'similar-highlight--active'));
          // Highlight spans whose text appears in the matched snippet.
          const needle = result.snippet.toLowerCase();
          let first: HTMLElement | null = null;
          spans.forEach(sp => {
            const t = (sp.textContent || '').trim().toLowerCase();
            if (t.length >= 3 && needle.includes(t)) {
              sp.classList.add('similar-highlight');
              if (!first) first = sp;
            }
          });
          (first ?? spans[0]).scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        await sleep(120);
      }
    })();

    return () => { cancelled = true; };
  }, [currentMatch, similarResults, searchMode, scrollPageIntoView]);

  // ── Verbatim: auto-seed a literal find when a key point is selected ─
  useEffect(() => {
    if (!verbatim || !pageTextsReady) return;
    // Seed a literal (raw) find with the verbatim quote and open the bar so the
    // user sees why the view jumped. Trim very long verbatims to a findable head.
    const q = verbatim.trim().slice(0, 60);
    if (q.length < 3) return;
    setSearchMode('raw');
    setSearchQuery(q);
    setSearchOpen(true);
  }, [verbatim, pageTextsReady]);

  // Trigger similar search (debounced) when in similar mode with a query
  useEffect(() => {
    if (searchMode !== 'similar') { setSimilarResults([]); return; }
    const t = setTimeout(() => runSimilarSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchMode, searchQuery, runSimilarSearch]);

  // ── Navigation + toolbar handlers ───────────────────────────────
  const goNext = useCallback(() => { if (matchCount) setCurrentMatch(p => (p + 1) % matchCount); }, [matchCount]);
  const goPrev = useCallback(() => { if (matchCount) setCurrentMatch(p => (p - 1 + matchCount) % matchCount); }, [matchCount]);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setMatchCount(0);
    setCurrentMatch(0);
    setSimilarResults([]);
    const container = scrollContainerRef.current;
    container?.querySelectorAll<HTMLElement>('.textLayer').forEach(clearHighlights);
  }, []);

  const handleZoomIn = useCallback(() => setScale(s => Math.min(s + 0.25, 3.0)), []);
  const handleZoomOut = useCallback(() => setScale(s => Math.max(s - 0.25, 0.5)), []);

  // Ctrl/Cmd+F opens the search bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (e.key === 'Escape' && searchOpen) closeSearch();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen, closeSearch]);

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

  if (loading) {
    return (
      <div className="pdf-viewer">
        <div className="pdf-viewer-header">
          <span className="pdf-viewer-badge">PDF</span>
          <span className="pdf-viewer-info">Loading PDF...</span>
        </div>
        <div className="pdf-loading">
          <div className="spinner-ring" />
          <span>Rendering PDF document...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pdf-viewer">
        <div className="pdf-viewer-header">
          <span className="pdf-viewer-badge">PDF</span>
          <span className="pdf-viewer-info">Error</span>
        </div>
        <div className="pdf-loading">
          <span style={{ color: 'var(--color-saf)' }}>Failed to load PDF: {error}</span>
        </div>
      </div>
    );
  }

  if (!pdfDoc) return null;

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer-header">
        <span className="pdf-viewer-badge">PDF</span>
        <span className="pdf-viewer-info">{numPages} pages</span>
        <div className="pdf-toolbar-spacer" />

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
                  if (e.key === 'Enter') { e.shiftKey ? goPrev() : goNext(); }
                  if (e.key === 'Escape') closeSearch();
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
              <span className="doc-search-count">{matchStatusText()}</span>
              <button className="doc-search-nav" onClick={goPrev} disabled={matchCount === 0} title="Previous (Shift+Enter)">&#x25B2;</button>
              <button className="doc-search-nav" onClick={goNext} disabled={matchCount === 0} title="Next (Enter)">&#x25BC;</button>
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

        <span className="pdf-toolbar-divider" />
        <button className="pdf-zoom-btn" onClick={handleZoomOut} title="Zoom out">&minus;</button>
        <span className="pdf-scale-label">{Math.round(scale * 100)}%</span>
        <button className="pdf-zoom-btn" onClick={handleZoomIn} title="Zoom in">+</button>
      </div>

      <div className="pdf-scroll-container" ref={scrollContainerRef}>
        {Array.from({ length: numPages }, (_, i) => (
          <div key={i} data-page-sentinel={i}>
            <PdfPageView
              pdfDoc={pdfDoc}
              pageIndex={i}
              scale={scale}
              isVisible={visiblePages.has(i)}
              searchRegex={searchMode === 'similar' ? null : searchRegex}
            />
            <div className="pdf-page-number">Page {i + 1}</div>
          </div>
        ))}
      </div>

      {searchMode === 'similar' && similarResults.length > 0 && (
        <div className="similar-results-bar">
          {similarResults.map((s, i) => (
            <button
              key={i}
              className={`similar-result-chip${i === currentMatch ? ' active' : ''}`}
              onClick={() => setCurrentMatch(i)}
              title={`p.${s.pageIndex + 1}: ${s.snippet}`}
            >
              {(s.score * 100).toFixed(0)}%
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
