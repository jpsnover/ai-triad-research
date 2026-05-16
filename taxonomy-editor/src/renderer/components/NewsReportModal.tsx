// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useCallback, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDebateStore } from '../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';

function ArticleContent({ markdown }: { markdown: string }) {
  // Prompt output: line 1 = headline, line 2 = subhead, rest = body with ## sections
  const lines = markdown.split('\n');
  const headline = lines[0]?.replace(/^#\s*/, '') || '';
  const subhead = lines[1]?.trim() || '';
  // Body starts after the first blank line following subhead, or line 3
  const bodyStart = lines.findIndex((l, i) => i > 1 && l.trim() === '') + 1 || 2;
  const body = lines.slice(bodyStart).join('\n').trim();

  return (
    <div className="markdown-body" style={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
      {headline && <h1 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 4 }}>{headline}</h1>}
      {subhead && <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 16 }}>{subhead}</p>}
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => (
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginTop: 20, marginBottom: 8 }}>{children}</h2>
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

  // Trigger generation on mount if no article yet
  useEffect(() => {
    if (!newsReport && !newsReportLoading && !newsReportError) {
      void generateNewsReport();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <div style={{
        width: 700, height: '80vh',
        minWidth: 400, minHeight: 300,
        maxWidth: '95vw', maxHeight: '95vh',
        resize: 'both', overflow: 'hidden',
        background: 'var(--bg-primary)', borderRadius: 12,
        border: '1px solid var(--border-color)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
        pointerEvents: 'auto',
        transform: `translate(${pos.x}px, ${pos.y}px)`,
      }}>
        {/* Header */}
        <div
          onMouseDown={onMouseDown}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
            cursor: dragRef.current ? 'grabbing' : 'grab',
            userSelect: 'none',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '1rem', flex: 1 }}>News Report</h3>
          <button
            className="btn"
            style={{ fontSize: '0.7rem', padding: '3px 10px' }}
            onClick={handleCopy}
            disabled={!newsReport}
            title="Copy raw markdown to clipboard"
          >
            {copyFeedback ? 'Copied!' : 'Copy'}
          </button>
          <button
            className="btn"
            style={{ fontSize: '0.7rem', padding: '3px 10px' }}
            onClick={handleExport}
            disabled={!newsReport}
            title="Download as markdown file"
          >
            Export
          </button>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}
          >&times;</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          {newsReportLoading && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: 12 }}>&#8987;</div>
              <div style={{ fontSize: '0.85rem' }}>Generating news report...</div>
            </div>
          )}

          {newsReportError && !newsReportLoading && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: '0.85rem', color: '#ef4444', marginBottom: 16 }}>
                {newsReportError}
              </div>
              <button
                className="btn btn-primary"
                style={{ fontSize: '0.8rem', padding: '6px 18px' }}
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
