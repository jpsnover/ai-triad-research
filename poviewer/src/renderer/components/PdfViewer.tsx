// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { useAppStore } from '../store/useAppStore';
import {
  buildTextIndex,
  findPositionForOffset,
  type TextIndex,
  type TextItem,
} from '../utils/pdfTextMapping';
import PointBadge from './PointBadge';
import type { Source, Point, PovCamp } from '../types/types';
import type { ExcerptMappingResult } from '../types/electron';

// Configure pdf.js worker — version-locked via Vite ?url import from pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

interface Props {
  source: Source;
}

type PDFDocumentProxy = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
type PDFPageProxy = Awaited<ReturnType<PDFDocumentProxy['getPage']>>;

// === PdfTextFallback (original text view) ===

function PdfTextFallback({ source, showBanner }: { source: Source; showBanner: boolean }) {
  const povFilters = useAppStore(s => s.povFilters);
  const selectedPointId = useAppStore(s => s.selectedPointId);
  const selectPoint = useAppStore(s => s.selectPoint);

  const visiblePoints = source.points.filter(p => {
    if (p.mappings.length === 0) return true;
    return p.mappings.some(m => povFilters[m.camp]);
  });

  const text = source.snapshotText;
  const sorted = [...visiblePoints].sort((a, b) => a.startOffset - b.startOffset);

  const segments: Array<{ text: string; point: Point | null }> = [];
  let cursor = 0;

  for (const point of sorted) {
    if (point.startOffset > cursor) {
      segments.push({ text: text.slice(cursor, point.startOffset), point: null });
    }
    const start = Math.max(point.startOffset, cursor);
    if (start < point.endOffset) {
      segments.push({ text: text.slice(start, point.endOffset), point });
      cursor = point.endOffset;
    }
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), point: null });
  }

  const getHighlightColor = (point: Point): string => {
    if (point.mappings.length === 0) return 'rgba(100, 116, 139, 0.15)';
    if (point.mappings.length === 1) {
      const colorMap: Record<PovCamp, string> = {
        accelerationist: 'rgba(39, 174, 96, 0.20)',
        safetyist: 'rgba(231, 76, 60, 0.18)',
        skeptic: 'rgba(243, 156, 18, 0.20)',
        'situations': 'rgba(142, 68, 173, 0.17)',
      };
      return colorMap[point.mappings[0].camp];
    }
    return 'rgba(100, 116, 139, 0.20)';
  };

  return (
    <div className="pdf-viewer">
      {showBanner && (
        <div className="pdf-fallback-banner">
          Raw PDF not found — showing extracted text view
        </div>
      )}
      <div className="pdf-viewer-header">
        <span className="pdf-viewer-badge">PDF</span>
        <span className="pdf-viewer-info">
          Extracted text view ({source.points.length} points mapped)
        </span>
      </div>
      <div className="pdf-viewer-text">
        {segments.map((seg, i) => {
          if (!seg.point) {
            return <span key={i}>{seg.text}</span>;
          }
          const isSelected = seg.point.id === selectedPointId;
          const bg = getHighlightColor(seg.point);
          return (
            <span
              key={i}
              className={`pdf-highlight ${isSelected ? 'selected' : ''}`}
              style={{ backgroundColor: bg }}
              onClick={() => selectPoint(seg.point!.id)}
              title={`Point ${seg.point.id}`}
            >
              {seg.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// === Selection Context Menu ===

const CAMP_COLORS: Record<string, string> = {
  accelerationist: 'var(--color-acc)',
  safetyist: 'var(--color-saf)',
  skeptic: 'var(--color-skp)',
  'situations': 'var(--color-cc)',
};

interface ContextMenuProps {
  x: number;
  y: number;
  selectedText: string;
  onClose: () => void;
}

function SelectionContextMenu({ x, y, selectedText, onClose }: ContextMenuProps) {
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState<ExcerptMappingResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSearchWeb = useCallback(() => {
    const query = encodeURIComponent(selectedText);
    window.electronAPI.openExternalUrl(`https://www.google.com/search?q=${query}`);
    onClose();
  }, [selectedText, onClose]);

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const mappings = await window.electronAPI.analyzeExcerpt(selectedText);
      setResults(mappings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }, [selectedText]);

  return (
    <div
      ref={menuRef}
      className="pdf-context-menu"
      style={{ left: x, top: y }}
    >
      <div className="pdf-context-menu-header">
        &ldquo;{selectedText.length > 60 ? selectedText.slice(0, 60) + '...' : selectedText}&rdquo;
      </div>

      {!results && !analyzing && (
        <div className="pdf-context-menu-actions">
          <button className="pdf-context-btn" onClick={handleSearchWeb}>
            <span className="pdf-context-btn-icon">&#128269;</span>
            Search the Web
          </button>
          <button className="pdf-context-btn" onClick={handleAnalyze}>
            <span className="pdf-context-btn-icon">&#9881;</span>
            Analyze Excerpt
          </button>
        </div>
      )}

      {analyzing && (
        <div className="pdf-context-analyzing">
          <div className="spinner-ring" style={{ width: 16, height: 16, borderWidth: 2 }} />
          <span>Analyzing against taxonomy...</span>
        </div>
      )}

      {error && (
        <div className="pdf-context-error">{error}</div>
      )}

      {results && (
        <div className="pdf-context-results">
          {results.length === 0 ? (
            <div className="pdf-context-no-match">No taxonomy matches found</div>
          ) : (
            results.map((m, i) => (
              <div key={i} className="pdf-context-mapping">
                <div className="pdf-context-mapping-header">
                  <span
                    className="pdf-context-camp-dot"
                    style={{ background: CAMP_COLORS[m.camp] || 'var(--text-muted)' }}
                  />
                  <span className="pdf-context-camp-label">{m.camp}</span>
                  <span className={`pdf-context-alignment ${m.alignment}`}>
                    {m.alignment === 'agrees' ? '+' : '\u2212'} {m.alignment}
                  </span>
                </div>
                <div className="pdf-context-node-label">{m.nodeLabel}</div>
                <div className="pdf-context-explanation">{m.explanation}</div>
              </div>
            ))
          )}
          <div className="pdf-context-menu-actions">
            <button className="pdf-context-btn" onClick={handleSearchWeb}>
              <span className="pdf-context-btn-icon">&#128269;</span>
              Search the Web
            </button>
            <button className="pdf-context-btn pdf-context-btn-close" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// === PdfPageView (single page canvas + text layer + overlay) ===

interface PageViewProps {
  pdfDoc: PDFDocumentProxy;
  pageIndex: number;
  scale: number;
  textIndex: TextIndex;
  visiblePoints: Point[];
  selectedPointId: string | null;
  onSelectPoint: (id: string) => void;
  isVisible: boolean;
}

function PdfPageView({
  pdfDoc,
  pageIndex,
  scale,
  textIndex,
  visiblePoints,
  selectedPointId,
  onSelectPoint,
  isVisible,
}: PageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const renderTaskRef = useRef<ReturnType<PDFPageProxy['render']> | null>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const textLayerInstanceRef = useRef<TextLayer | null>(null);

  // Render canvas + text layer when visible
  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;

    async function renderPage() {
      try {
        const page = await pdfDoc.getPage(pageIndex + 1);
        if (cancelled) return;
        pageRef.current = page;

        const viewport = page.getViewport({ scale });
        setPageSize({ width: viewport.width, height: viewport.height });

        // Render canvas
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.width = viewport.width * window.devicePixelRatio;
        canvas.height = viewport.height * window.devicePixelRatio;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        const renderTask = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = renderTask;

        await renderTask.promise;
        if (cancelled) return;

        // Render text layer for selection
        const textLayerDiv = textLayerRef.current;
        if (textLayerDiv) {
          textLayerDiv.innerHTML = '';
          textLayerDiv.style.width = `${viewport.width}px`;
          textLayerDiv.style.height = `${viewport.height}px`;

          // Clean up previous text layer
          if (textLayerInstanceRef.current) {
            textLayerInstanceRef.current.cancel();
          }

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
          console.error(`Error rendering page ${pageIndex + 1}:`, err);
        }
      }
    }

    renderPage();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      if (textLayerInstanceRef.current) {
        textLayerInstanceRef.current.cancel();
        textLayerInstanceRef.current = null;
      }
    };
  }, [pdfDoc, pageIndex, scale, isVisible]);

  // Compute chip positions for this page
  const chipPositions = useMemo(() => {
    if (!pageRef.current || !rendered) return [];
    const page = pageRef.current;
    const viewport = page.getViewport({ scale });

    const positions: Array<{ point: Point; canvasX: number; canvasY: number }> = [];

    for (const point of visiblePoints) {
      const pos = findPositionForOffset(textIndex, point.startOffset);
      if (!pos || pos.pageIndex !== pageIndex) continue;

      const [canvasX, canvasY] = viewport.convertToViewportPoint(pos.x, pos.y);
      positions.push({ point, canvasX, canvasY });
    }

    return positions;
  }, [textIndex, pageIndex, visiblePoints, scale, rendered]);

  const width = pageSize?.width ?? 612 * scale;
  const height = pageSize?.height ?? 792 * scale;

  return (
    <div
      className="pdf-page-wrapper"
      style={{ width, height, position: 'relative' }}
    >
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      <div ref={textLayerRef} className="textLayer" />
      {rendered && (
        <div
          className="pdf-page-overlay"
          style={{ width, height }}
        >
          {chipPositions.map(({ point, canvasX, canvasY }) => {
            const isSelected = point.id === selectedPointId;
            return (
              <div
                key={point.id}
                className={`pdf-point-chip ${isSelected ? 'selected' : ''}`}
                data-point-id={point.id}
                style={{
                  left: `${canvasX}px`,
                  top: `${canvasY - 8}px`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectPoint(point.id);
                }}
                title={point.text.slice(0, 80)}
              >
                <PointBadge point={point} />
              </div>
            );
          })}
        </div>
      )}
      {!rendered && isVisible && (
        <div className="pdf-page-loading">Loading page {pageIndex + 1}...</div>
      )}
    </div>
  );
}

// === PdfViewer (main component) ===

export default function PdfViewer({ source }: Props) {
  const povFilters = useAppStore(s => s.povFilters);
  const selectedPointId = useAppStore(s => s.selectedPointId);
  const selectPoint = useAppStore(s => s.selectPoint);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [textIndex, setTextIndex] = useState<TextIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());

  // Visible points based on POV filters
  const visiblePoints = useMemo(() => {
    return source.points.filter(p => {
      if (p.mappings.length === 0) return true;
      return p.mappings.some(m => povFilters[m.camp]);
    });
  }, [source.points, povFilters]);

  // Sorted points for chip navigation (document order)
  const sortedVisiblePoints = useMemo(() => {
    return [...visiblePoints].sort((a, b) => a.startOffset - b.startOffset);
  }, [visiblePoints]);

  // Load PDF on mount or source change
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      setPdfDoc(null);
      setTextIndex(null);
      setUseFallback(false);

      try {
        const bytes = await window.electronAPI.getPdfBytes(source.id);
        if (cancelled) return;

        if (!bytes) {
          setUseFallback(true);
          setLoading(false);
          return;
        }

        const data = new Uint8Array(bytes);
        const doc = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages);

        // Build text index from all pages
        const pagesTextContent: Array<{ items: TextItem[] }> = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          pagesTextContent.push({
            items: content.items.filter(
              (item: Record<string, unknown>) => 'str' in item,
            ) as unknown as TextItem[],
          });
        }

        if (cancelled) return;
        const index = buildTextIndex(pagesTextContent);
        setTextIndex(index);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load PDF:', err);
          setError(err instanceof Error ? err.message : 'Failed to load PDF');
          setLoading(false);
        }
      }
    }

    loadPdf();
    return () => { cancelled = true; };
  }, [source.id]);

  // IntersectionObserver for lazy page rendering
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !pdfDoc || !textIndex) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages(prev => {
          const next = new Set(prev);
          for (const entry of entries) {
            const pageIdx = Number(entry.target.getAttribute('data-page-index'));
            if (entry.isIntersecting) {
              next.add(pageIdx);
              if (pageIdx > 0) next.add(pageIdx - 1);
              if (pageIdx < numPages - 1) next.add(pageIdx + 1);
            }
          }
          return next;
        });
      },
      {
        root: container,
        rootMargin: '200px 0px',
        threshold: 0,
      },
    );

    const sentinels = container.querySelectorAll<HTMLDivElement>('[data-page-index]');
    sentinels.forEach(el => observer.observe(el));

    return () => observer.disconnect();
  }, [pdfDoc, numPages, textIndex]);

  // Register page ref for intersection observer
  const setPageRef = useCallback((pageIndex: number, el: HTMLDivElement | null) => {
    if (el) {
      pageRefsMap.current.set(pageIndex, el);
    } else {
      pageRefsMap.current.delete(pageIndex);
    }
  }, []);

  // Text selection handler — show context menu on mouseup
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return; // No meaningful selection
    }

    const text = selection.toString().trim();
    if (text.length < 3) return; // Too short to be useful

    // Position the menu near the selection
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = scrollContainerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    setContextMenu({
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.bottom - containerRect.top + 4,
      text,
    });
  }, []);

  // === Chip Navigation ===
  const scrollToPoint = useCallback((pointId: string) => {
    selectPoint(pointId);
    // Find the chip element and scroll it into view
    const container = scrollContainerRef.current;
    if (!container) return;
    // Use a small delay to allow render
    requestAnimationFrame(() => {
      const chip = container.querySelector(`[data-point-id="${pointId}"]`);
      if (chip) {
        chip.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }, [selectPoint]);

  const handlePrevChip = useCallback(() => {
    if (sortedVisiblePoints.length === 0) return;
    const currentIdx = selectedPointId
      ? sortedVisiblePoints.findIndex(p => p.id === selectedPointId)
      : -1;
    const prevIdx = currentIdx <= 0 ? sortedVisiblePoints.length - 1 : currentIdx - 1;
    scrollToPoint(sortedVisiblePoints[prevIdx].id);
  }, [sortedVisiblePoints, selectedPointId, scrollToPoint]);

  const handleNextChip = useCallback(() => {
    if (sortedVisiblePoints.length === 0) return;
    const currentIdx = selectedPointId
      ? sortedVisiblePoints.findIndex(p => p.id === selectedPointId)
      : -1;
    const nextIdx = currentIdx >= sortedVisiblePoints.length - 1 ? 0 : currentIdx + 1;
    scrollToPoint(sortedVisiblePoints[nextIdx].id);
  }, [sortedVisiblePoints, selectedPointId, scrollToPoint]);

  // Current chip index for counter display
  const currentChipIndex = useMemo(() => {
    if (!selectedPointId) return -1;
    return sortedVisiblePoints.findIndex(p => p.id === selectedPointId);
  }, [sortedVisiblePoints, selectedPointId]);

  const handleZoomIn = useCallback(() => setScale(s => Math.min(s + 0.25, 3.0)), []);
  const handleZoomOut = useCallback(() => setScale(s => Math.max(s - 0.25, 0.5)), []);

  // Fallback: no raw PDF available
  if (useFallback) {
    return <PdfTextFallback source={source} showBanner={true} />;
  }

  // Loading state
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

  // Error state
  if (error) {
    return (
      <div className="pdf-viewer">
        <div className="pdf-viewer-header">
          <span className="pdf-viewer-badge">PDF</span>
          <span className="pdf-viewer-info">Error</span>
        </div>
        <div className="pdf-loading">
          <span style={{ color: 'var(--color-contradicts)' }}>
            Failed to load PDF: {error}
          </span>
        </div>
      </div>
    );
  }

  if (!pdfDoc || !textIndex) return null;

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer-header">
        <span className="pdf-viewer-badge">PDF</span>
        <span className="pdf-viewer-info">
          {numPages} pages &middot; {visiblePoints.length} points
        </span>
        <div className="pdf-toolbar-spacer" />

        {/* Chip navigation */}
        <button
          className="pdf-nav-btn"
          onClick={handlePrevChip}
          disabled={sortedVisiblePoints.length === 0}
          title="Previous point"
        >
          &#9650;
        </button>
        <span className="pdf-nav-counter">
          {currentChipIndex >= 0 ? `${currentChipIndex + 1}/${sortedVisiblePoints.length}` : `\u2013/${sortedVisiblePoints.length}`}
        </span>
        <button
          className="pdf-nav-btn"
          onClick={handleNextChip}
          disabled={sortedVisiblePoints.length === 0}
          title="Next point"
        >
          &#9660;
        </button>

        <span className="pdf-toolbar-divider" />

        {/* Zoom controls */}
        <button className="pdf-zoom-btn" onClick={handleZoomOut} title="Zoom out">
          &minus;
        </button>
        <span className="pdf-scale-label">{Math.round(scale * 100)}%</span>
        <button className="pdf-zoom-btn" onClick={handleZoomIn} title="Zoom in">
          +
        </button>
      </div>
      <div
        className="pdf-scroll-container"
        ref={scrollContainerRef}
        onMouseUp={handleMouseUp}
      >
        {Array.from({ length: numPages }, (_, i) => (
          <div
            key={i}
            data-page-index={i}
            ref={(el) => setPageRef(i, el)}
          >
            <PdfPageView
              pdfDoc={pdfDoc}
              pageIndex={i}
              scale={scale}
              textIndex={textIndex}
              visiblePoints={visiblePoints}
              selectedPointId={selectedPointId}
              onSelectPoint={selectPoint}
              isVisible={visiblePages.has(i)}
            />
            <div className="pdf-page-number">Page {i + 1}</div>
          </div>
        ))}

        {/* Context menu for text selection */}
        {contextMenu && (
          <SelectionContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            selectedText={contextMenu.text}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    </div>
  );
}
