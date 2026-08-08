// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useCallback, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import './NewsReportModal.css';

/** Fix markdown links broken by newlines inside `[text](url)` — AI models often wrap long URLs. */
function fixMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]*)\]\(\s*([\s\S]*?)\s*\)/g, (_match, linkText, url) => {
    const cleanUrl = url.replace(/\s+/g, '');
    return `[${linkText}](${cleanUrl})`;
  });
}

function ArticleContent({ markdown }: { markdown: string }) {
  // Prompt output: line 1 = headline, line 2 = subhead, rest = body with ## sections
  const fixed = fixMarkdownLinks(markdown);
  const lines = fixed.split('\n');
  const headline = lines[0]?.replace(/^#\s*/, '') || '';
  const subhead = lines[1]?.trim() || '';
  // Body starts after the first blank line following subhead, or line 3
  const bodyStart = lines.findIndex((l, i) => i > 1 && l.trim() === '') + 1 || 2;
  const body = lines.slice(bodyStart).join('\n').trim();

  return (
    <div className="markdown-body news-report-modal-body">
      {headline && <h1 className="news-report-modal-headline">{headline}</h1>}
      {subhead && <p className="news-report-modal-subhead">{subhead}</p>}
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => (
            <h2 className="news-report-modal-h2">{children}</h2>
          ),
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}

export function NewsReportModal({ onClose }: { onClose: () => void }) {
  const { activeDebate, newsReport, newsReportLoading, newsReportError, generateNewsReport } = useDebateStore(
    useShallow(s => ({
      activeDebate: s.activeDebate,
      newsReport: s.newsReport,
      newsReportLoading: s.newsReportLoading,
      newsReportError: s.newsReportError,
      generateNewsReport: s.generateNewsReport,
    }))
  );

  const [copyFeedback, setCopyFeedback] = useState(false);

  // Drag state
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  }, [pos.x, pos.y]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
      });
    };
    const onMouseUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Trigger generation on mount if no article yet.
  // A useRef guard survives React 19 Strict Mode's dev double-invoke: the two
  // mount effects run synchronously before the async generateNewsReport() sets
  // newsReportLoading in the store, so the store-state guard reads false both
  // times and both fire (t/2296). The ref is set synchronously on first fire.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    if (!newsReport && !newsReportLoading && !newsReportError) {
      startedRef.current = true;
      void generateNewsReport();
    }
  }, []);

  const handleCopy = async () => {
    if (!newsReport) return;
    await navigator.clipboard.writeText(newsReport);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  const handleExport = () => {
    if (!newsReport || !activeDebate) return;
    const blob = new Blob([newsReport], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeDebate.id}-news-report.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="news-report-modal-overlay">
      <div
        className="news-report-modal-window"
        /* eslint-disable-next-line local/no-inline-style -- drag position is computed from pointer movement state */
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      >
        {/* Header */}
        <div
          onMouseDown={onMouseDown}
          className="news-report-modal-header"
          /* eslint-disable-next-line local/no-inline-style -- cursor reflects live drag ref, not a static value */
          style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
        >
          <h3 className="news-report-modal-title">News Report</h3>
          <button
            className="btn news-report-modal-header-btn"
            onClick={handleCopy}
            disabled={!newsReport}
            title="Copy raw markdown to clipboard"
          >
            {copyFeedback ? 'Copied!' : 'Copy'}
          </button>
          <button
            className="btn news-report-modal-header-btn"
            onClick={handleExport}
            disabled={!newsReport}
            title="Download as markdown file"
          >
            Export
          </button>
          <button
            onClick={onClose}
            className="news-report-modal-close-btn"
          >&times;</button>
        </div>

        {/* Content */}
        <div className="news-report-modal-content">
          {newsReportLoading && (
            <div className="news-report-modal-loading">
              <div className="news-report-modal-loading-icon">&#8987;</div>
              <div className="news-report-modal-loading-text">Generating news report...</div>
            </div>
          )}

          {newsReportError && !newsReportLoading && (
            <div className="news-report-modal-error">
              <div className="news-report-modal-error-text">
                {newsReportError}
              </div>
              <button
                className="btn btn-primary news-report-modal-retry-btn"
                onClick={() => void generateNewsReport()}
              >
                Retry
              </button>
            </div>
          )}

          {newsReport && !newsReportLoading && (
            <ArticleContent markdown={newsReport} />
          )}
        </div>
      </div>
    </div>
  );
}
