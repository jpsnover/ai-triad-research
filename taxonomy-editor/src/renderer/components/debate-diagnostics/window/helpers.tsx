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
    'I-node': { bg: 'rgba(59,130,246,0.15)', fg: '#3b82f6' },
    'CA-node': { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444' },
    'RA-node': { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e' },
    'PA-node': { bg: 'rgba(168,85,247,0.15)', fg: '#a855f7' },
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
        fontSize: '0.6rem',
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
        fontSize: '0.7rem', color: pass ? '#22c55e' : '#ef4444',
      }}
    >
      <span style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: pass ? '#22c55e' : '#ef4444',
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
        background: 'none', border: '1px solid var(--border)', borderRadius: 3,
        color: copied ? '#22c55e' : 'var(--text-muted)', cursor: 'pointer',
        fontSize: '0.6rem', padding: '1px 6px', marginLeft: 6, flexShrink: 0,
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

export function Section({ title, children, defaultOpen = false, copyText }: { title: string; children: React.ReactNode; defaultOpen?: boolean; copyText?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const sq = useContext(DiagSearchContext);
  const sectionMatches = sq && copyText ? countMatches(copyText, sq) : 0;
  const effectiveOpen = open || (sectionMatches > 0);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button
          onClick={() => setOpen(!open)}
          style={{ background: 'none', border: 'none', color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', padding: '4px 0', flex: 1, textAlign: 'left' }}
        >
          {effectiveOpen ? '▼' : '▶'} {title}
          {sectionMatches > 0 && (
            <span style={{ marginLeft: 6, fontSize: '0.6rem', padding: '1px 5px', borderRadius: 3, background: 'rgba(245,158,11,0.2)', color: '#f59e0b', fontWeight: 700 }}>
              {sectionMatches} match{sectionMatches !== 1 ? 'es' : ''}
            </span>
          )}
        </button>
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
  return <>{parts.map((p, i) => p.match ? <mark key={i} data-search-match="" style={{ background: '#f59e0b', color: '#000', borderRadius: 2, padding: '0 1px' }}>{p.text}</mark> : p.text)}</>;
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
        (m as HTMLElement).style.background = '#f59e0b';
        (m as HTMLElement).classList.remove('search-active-match');
      });
      if (currentIdx >= 0 && currentIdx < marks.length) {
        const el = marks[currentIdx] as HTMLElement;
        el.style.background = '#f97316';
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
          border: '1px solid var(--border)', borderRadius: 4,
        }}
      />
      {query && (
        <>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {domCount > 0 ? `${currentIdx + 1}/${domCount}` : '0 matches'}
          </span>
          <button onClick={goPrev} title="Previous match (Shift+Enter)"
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 5px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.7rem', lineHeight: 1 }}>
            ▲
          </button>
          <button onClick={goNext} title="Next match (Enter)"
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 5px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.7rem', lineHeight: 1 }}>
            ▼
          </button>
          <button
            onClick={() => setQuery('')}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.65rem' }}
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
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: '6px 8px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    />
  );
}
