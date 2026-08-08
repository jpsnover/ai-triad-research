// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Real embedded PDF viewer for pane 3 — a trimmed port of poviewer's PdfViewer.
// Renders a source's raw PDF (canvas + selectable pdf.js text layer) with lazy,
// IntersectionObserver-driven page rendering and zoom. Phase 1 (t/2291): no
// point overlays, no excerpt analysis, no in-document search — the DocumentPane
// search/highlight features remain Markdown-only until Phase 2 re-plumbs them
// onto the text layer.

import { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './PdfViewer.css';

// Configure pdf.js worker — version-locked via Vite ?url import from pdfjs-dist
// (same-origin asset, so it runs under the existing CSP unchanged).
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

type PDFDocumentProxy = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
type PDFPageProxy = Awaited<ReturnType<PDFDocumentProxy['getPage']>>;

interface Props {
  /** Raw PDF bytes shipped from the main process over IPC. */
  data: ArrayBuffer;
}

// === PdfPageView (single page canvas + selectable text layer) ===

interface PageViewProps {
  pdfDoc: PDFDocumentProxy;
  pageIndex: number;
  scale: number;
  isVisible: boolean;
}

function PdfPageView({ pdfDoc, pageIndex, scale, isVisible }: PageViewProps) {
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

        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        const renderTask = page.render({ canvasContext: ctx, viewport, canvas });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (cancelled) return;

        // Render selectable text layer over the canvas
        const textLayerDiv = textLayerRef.current;
        if (textLayerDiv) {
          textLayerDiv.innerHTML = '';
          textLayerDiv.style.width = `${viewport.width}px`;
          textLayerDiv.style.height = `${viewport.height}px`;

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

  const width = pageSize?.width ?? 612 * scale;
  const height = pageSize?.height ?? 792 * scale;

  return (
    <div className="pdf-page-wrapper" style={{ width, height, position: 'relative' }}>
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      <div ref={textLayerRef} className="textLayer" />
      {!rendered && isVisible && (
        <div className="pdf-page-loading">Loading page {pageIndex + 1}...</div>
      )}
    </div>
  );
}

// === PdfViewer (main component) ===

export default function PdfViewer({ data }: Props) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set());

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Load the PDF document from the provided bytes
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      setPdfDoc(null);
      setVisiblePages(new Set());

      try {
        // getDocument transfers the buffer, so pass a copy to keep `data` reusable
        // across re-renders (source switches).
        const bytes = new Uint8Array(data.slice(0));
        const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setLoading(false);
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
      { root: container, rootMargin: '200px 0px', threshold: 0 },
    );

    const sentinels = container.querySelectorAll<HTMLDivElement>('[data-page-index]');
    sentinels.forEach(el => observer.observe(el));

    return () => observer.disconnect();
  }, [pdfDoc, numPages]);

  const handleZoomIn = useCallback(() => setScale(s => Math.min(s + 0.25, 3.0)), []);
  const handleZoomOut = useCallback(() => setScale(s => Math.max(s - 0.25, 0.5)), []);

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
        <button className="pdf-zoom-btn" onClick={handleZoomOut} title="Zoom out">&minus;</button>
        <span className="pdf-scale-label">{Math.round(scale * 100)}%</span>
        <button className="pdf-zoom-btn" onClick={handleZoomIn} title="Zoom in">+</button>
      </div>
      <div className="pdf-scroll-container" ref={scrollContainerRef}>
        {Array.from({ length: numPages }, (_, i) => (
          <div key={i} data-page-index={i}>
            <PdfPageView
              pdfDoc={pdfDoc}
              pageIndex={i}
              scale={scale}
              isVisible={visiblePages.has(i)}
            />
            <div className="pdf-page-number">Page {i + 1}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
