// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback, useContext, createContext, type RefObject } from 'react';
import { api } from '@bridge';
import { POVER_INFO } from '../../../types/debate';
import { AIF_TOOLTIPS } from './shared/constants';

export const DiagSearchContext = createContext('');

export function speakerLabel(speaker: string): string {
  const info = Object.values(POVER_INFO).find(p => p.pov === speaker);
  if (info) return info.label;
  if (speaker === 'system') return 'System';
  if (speaker === 'moderator') return 'Moderator';
  if (speaker === 'user') return 'User';
  return speaker;
}

export function AifBadge({ type, label }: { type: 'I-node' | 'CA-node' | 'RA-node' | 'PA-node'; label?: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    'I-node': { bg: 'var(--bg-hover)', fg: 'var(--text-secondary)' },
    'CA-node': { bg: 'var(--bg-hover)', fg: 'var(--text-secondary)' },
    'RA-node': { bg: 'var(--bg-hover)', fg: 'var(--text-secondary)' },
    'PA-node': { bg: 'var(--bg-hover)', fg: 'var(--text-secondary)' },
  };
  const c = colors[type] || colors['I-node'];
  return (
    <span
      title={AIF_TOOLTIPS[type] || type}
      style={{
        display: 'inline-block',
        padding: '1px 5px',
        borderRadius: 3,
        background: c.bg,
        color: c.fg,
        fontSize: 'var(--text-2xs)',
        fontWeight: 700,
        cursor: 'help',
        letterSpacing: '0.03em',
      }}
    >
      {label || type}
    </span>
  );
}

export function TrafficLight({ pass, label, tooltip }: { pass: boolean; label: string; tooltip?: string }) {
  return (
    <span
      title={tooltip}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: '0.7rem', color: pass ? 'var(--success)' : 'var(--danger)',
      }}
    >
      <span style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: pass ? 'var(--success)' : 'var(--danger)',
      }} />
      {label}
    </span>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void api.clipboardWriteText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{
        background: 'none', border: '1px solid var(--border-color)', borderRadius: 3,
        color: copied ? 'var(--success)' : 'var(--text-muted)', cursor: 'pointer',
        fontSize: 'var(--text-2xs)', padding: '1px 6px', marginLeft: 6, flexShrink: 0,
      }}
      title="Copy section content to clipboard"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function countMatches(text: string, query: string): number {
  if (!query || !text) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let count = 0;
  let idx = t.indexOf(q);
  while (idx >= 0) {
    count++;
    idx = t.indexOf(q, idx + q.length);
  }
  return count;
}

export function Section({ title, children, defaultOpen = false, copyText, titleSuffix }: { title: string; children: React.ReactNode; defaultOpen?: boolean; copyText?: string; titleSuffix?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const sq = useContext(DiagSearchContext);
  const sectionMatches = sq && copyText ? countMatches(copyText, sq) : 0;
  const effectiveOpen = open || (sectionMatches > 0);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button
          onClick={() => setOpen(!open)}
          style={{ background: 'none', border: 'none', color: 'var(--text-primary)', fontWeight: 600, fontSize: 'var(--text-sm)', cursor: 'pointer', padding: '4px 0', flex: 1, textAlign: 'left' }}
        >
          {effectiveOpen ? '▼' : '▶'} {title}
          {sectionMatches > 0 && (
            <span style={{ marginLeft: 6, fontSize: 'var(--text-2xs)', padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--warning) 20%, transparent)', color: 'var(--warning)', fontWeight: 700 }}>
              {sectionMatches} match{sectionMatches !== 1 ? 'es' : ''}
            </span>
          )}
        </button>
        {titleSuffix && <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 4 }}>{titleSuffix}</span>}
        {copyText && effectiveOpen && <CopyButton text={copyText} />}
      </div>
      {effectiveOpen && <div style={{ paddingLeft: 16, fontSize: '0.75rem' }}>{children}</div>}
    </div>
  );
}

export function Highlight({ text, query: queryProp }: { text: string; query?: string }) {
  const ctxQuery = useContext(DiagSearchContext);
  const query = queryProp ?? ctxQuery;
  if (!query || !text) return <>{text}</>;
  const parts: { text: string; match: boolean }[] = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let lastIdx = 0;
  let idx = lower.indexOf(q);
  while (idx >= 0) {
    if (idx > lastIdx) parts.push({ text: text.slice(lastIdx, idx), match: false });
    parts.push({ text: text.slice(idx, idx + q.length), match: true });
    lastIdx = idx + q.length;
    idx = lower.indexOf(q, lastIdx);
  }
  if (lastIdx < text.length) parts.push({ text: text.slice(lastIdx), match: false });
  return <>{parts.map((p, i) => p.match ? <mark key={i} data-search-match="" style={{ background: 'var(--warning)', color: 'var(--text-primary)', borderRadius: 2, padding: '0 1px' }}>{p.text}</mark> : p.text)}</>;
}

export function SearchBar({ query, setQuery, matchCount, inputRef }: { query: string; setQuery: (q: string) => void; matchCount: number; inputRef?: RefObject<HTMLInputElement | null> }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [domCount, setDomCount] = useState(0);

  useEffect(() => { setCurrentIdx(0); }, [query]);

  useEffect(() => {
    if (!query) { setDomCount(0); return; }
    const raf = requestAnimationFrame(() => {
      const marks = document.querySelectorAll('mark[data-search-match]');
      setDomCount(marks.length);
      marks.forEach(m => {
        (m as HTMLElement).style.background = 'var(--warning)';
        (m as HTMLElement).classList.remove('search-active-match');
      });
      if (currentIdx >= 0 && currentIdx < marks.length) {
        const el = marks[currentIdx] as HTMLElement;
        el.style.background = 'color-mix(in srgb, var(--warning) 70%, var(--text-primary))';
        el.classList.add('search-active-match');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    return () => cancelAnimationFrame(raf);
  });

  const goNext = useCallback(() => {
    setCurrentIdx(prev => {
      const marks = document.querySelectorAll('mark[data-search-match]').length;
      return marks === 0 ? 0 : (prev + 1) % marks;
    });
  }, []);

  const goPrev = useCallback(() => {
    setCurrentIdx(prev => {
      const marks = document.querySelectorAll('mark[data-search-match]').length;
      return marks === 0 ? 0 : (prev - 1 + marks) % marks;
    });
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Search diagnostics... (Ctrl+F)"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? goPrev() : goNext(); }
          if (e.key === 'Escape') { e.preventDefault(); setQuery(''); }
        }}
        style={{
          flex: 1, padding: '4px 8px', fontSize: '0.75rem',
          background: 'var(--bg-primary)', color: 'var(--text-primary)',
          border: '1px solid var(--border-color)', borderRadius: 4,
        }}
      />
      {query && (
        <>
          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {domCount > 0 ? `${currentIdx + 1}/${domCount}` : '0 matches'}
          </span>
          <button onClick={goPrev} title="Previous match (Shift+Enter)"
            style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 4, padding: '2px 5px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.7rem', lineHeight: 1 }}>
            ▲
          </button>
          <button onClick={goNext} title="Next match (Enter)"
            style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 4, padding: '2px 5px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.7rem', lineHeight: 1 }}>
            ▼
          </button>
          <button
            onClick={() => setQuery('')}
            style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}
          >
            Clear
          </button>
        </>
      )}
    </div>
  );
}

export function ResizablePre({ text, tall = false }: { text: string; tall?: boolean }) {
  return (
    <textarea
      readOnly
      value={text}
      style={{
        width: '100%',
        minHeight: tall ? 200 : 60,
        maxHeight: 800,
        resize: 'vertical',
        fontFamily: 'monospace',
        fontSize: tall ? '0.75rem' : '0.65rem',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: 4,
        padding: '6px 8px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    />
  );
}
