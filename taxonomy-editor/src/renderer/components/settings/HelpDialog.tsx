// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { api } from '@bridge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ossData from '../../data/oss-licenses.json';
import { SupportCaseForm } from '../support/SupportCaseForm';
import { MyCases } from '../support/MyCases';
import { useSupportStore } from '../../hooks/useSupportStore';

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;
declare const __CHANGELOG_MD__: string;

const REPO_URL = 'https://github.com/jpsnover/ai-triad-research';

const DOCS = [
  { title: 'Architecture Overview', path: 'docs/architecture-overview.md',
    desc: 'Two-repo split, Electron apps, AI backends, and data model' },
  { title: 'Debate Engine Design', path: 'docs/debate-engine-design.md',
    desc: 'Three-agent BDI debate system, QBAF scoring, and moderator' },
  { title: 'Debate System Overview', path: 'docs/debate-system-overview.md',
    desc: 'High-level overview of the multi-agent debate system' },
  { title: 'Theory of Success', path: 'docs/theory-of-success.md',
    desc: 'What success looks like for debate, step-by-step execution, weaknesses' },
  { title: 'Taxonomy & Ontology Guide', path: 'docs/taxonomy-ontology-guide.md',
    desc: 'How the taxonomy is structured — BDI categories, POVs, situations' },
  { title: 'Document Processing Pipeline', path: 'docs/document-processing-pipeline.md',
    desc: 'How documents are ingested, chunked, and claims extracted' },
  { title: 'FIRE Extraction', path: 'docs/fire-extraction.md',
    desc: 'Confidence-gated iterative claim extraction details' },
  { title: 'Rhetorical Strategies', path: 'docs/rhetorical-strategies.md',
    desc: 'The argumentation strategies debaters employ' },
  { title: 'Epistemic Types', path: 'docs/epistemic-types.md',
    desc: 'Types of knowledge claims and their evaluation criteria' },
  { title: 'Emotional Registers', path: 'docs/emotional-registers.md',
    desc: 'Character voice and register design for debate personas' },
  { title: 'Computational Dialectics Comparison', path: 'docs/computational-dialectics-comparison.md',
    desc: 'How this system compares to other argumentation tools' },
  { title: 'Adaptive Debate Staging', path: 'docs/design/adaptive-debate-staging.md',
    desc: 'Convergence diagnostics and phase transition design' },
  { title: 'Full Methodology Paper', path: 'docs/academic-paper-draft.md',
    desc: 'Complete technical paper with algorithms, evaluation, and theoretical grounding' },
  { title: 'Epistemic Infrastructure Framing', path: 'research/comp-linguist/epistemic-infrastructure-framing.md',
    desc: 'The AI Rosetta Stone as epistemic infrastructure for multi-perspective policy analysis' },
  { title: 'Troubleshooting', path: 'docs/troubleshooting.md',
    desc: 'Known issues and their workarounds' },
] as const;

function getRuntime(): string {
  const target = import.meta.env.VITE_TARGET;
  if (target === 'web') return 'Container';
  if (typeof window !== 'undefined' && (window as any).electronAPI) return 'Electron';
  return 'Browser';
}

const isWeb = import.meta.env.VITE_TARGET === 'web';

export type HelpTab = 'tour' | 'about' | 'overview' | 'documentation' | 'methods' | 'shortcuts' | 'sbom' | 'licenses' | 'changelog' | 'my-cases';

const TABS: { id: HelpTab; label: string }[] = [
  { id: 'tour', label: 'Welcome Tour' },
  { id: 'about', label: 'About' },
  { id: 'changelog', label: "What's New" },
  { id: 'overview', label: 'Overview' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'methods', label: 'Methods' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'sbom', label: 'SBOM' },
  { id: 'licenses', label: 'Licenses' },
  ...(isWeb ? [{ id: 'my-cases' as const, label: 'My Cases' }] : []),
];

type SortCol = 'name' | 'version' | 'license';
type SortDir = 'asc' | 'desc';

const sbomSummary = (ossData as { summary: { name: string; version: string; license: string }[] }).summary;

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(s => parseInt(s, 10) || 0);
  const pb = b.split('.').map(s => parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function SbomPanel() {
  const [filter, setFilter] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const filtered = useMemo(() => {
    const rows = sbomSummary.map((row, originalIndex) => ({ ...row, originalIndex }));
    const lc = filter.toLowerCase();
    const matching = lc ? rows.filter(r =>
      r.name.toLowerCase().includes(lc) ||
      r.version.toLowerCase().includes(lc) ||
      r.license.toLowerCase().includes(lc)
    ) : rows;
    matching.sort((a, b) => {
      let cmp: number;
      if (sortCol === 'version') {
        cmp = compareSemver(a.version, b.version);
      } else {
        cmp = a[sortCol].localeCompare(b[sortCol], undefined, { sensitivity: 'base' });
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return matching;
  }, [filter, sortCol, sortDir]);

  const handleSort = useCallback((col: SortCol) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }, [sortCol]);

  const handleRowClick = useCallback((displayIdx: number, e: React.MouseEvent) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedIdx !== null) {
        const start = Math.min(lastClickedIdx, displayIdx);
        const end = Math.max(lastClickedIdx, displayIdx);
        for (let i = start; i <= end; i++) next.add(i);
      } else if (e.ctrlKey || e.metaKey) {
        if (next.has(displayIdx)) next.delete(displayIdx); else next.add(displayIdx);
      } else {
        next.clear();
        next.add(displayIdx);
      }
      return next;
    });
    setLastClickedIdx(displayIdx);
  }, [lastClickedIdx]);

  const rowsToTsv = useCallback((rows: typeof filtered) => {
    const header = 'Package\tVersion\tLicense';
    const lines = rows.map(r => `${r.name}\t${r.version}\t${r.license}`);
    return header + '\n' + lines.join('\n');
  }, []);

  const showCopyFeedback = useCallback((msg: string) => {
    setCopyFeedback(msg);
    setTimeout(() => setCopyFeedback(null), 2000);
  }, []);

  const handleCopyAll = useCallback(() => {
    void navigator.clipboard.writeText(rowsToTsv(filtered)).then(
      () => showCopyFeedback(`Copied ${filtered.length} rows`),
      () => showCopyFeedback('Copy failed'),
    );
  }, [filtered, rowsToTsv, showCopyFeedback]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedRows.size > 0) {
        const rows = [...selectedRows].sort((a, b) => a - b).map(i => filtered[i]).filter(Boolean);
        if (rows.length === 0) return;
        e.preventDefault();
        void navigator.clipboard.writeText(rowsToTsv(rows)).then(
          () => showCopyFeedback(`Copied ${rows.length} row${rows.length !== 1 ? 's' : ''}`),
          () => showCopyFeedback('Copy failed'),
        );
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedRows, filtered, rowsToTsv, showCopyFeedback]);

  useEffect(() => { setSelectedRows(new Set()); setLastClickedIdx(null); }, [filter, sortCol, sortDir]);

  const sortArrow = (col: SortCol) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="help-section" style={{ fontSize: '0.85rem' }}>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
        {filter
          ? `${filtered.length} of ${sbomSummary.length} packages`
          : `${sbomSummary.length} packages`
        }
      </p>
      <input
        type="text"
        placeholder="Filter packages..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        style={{
          width: '100%', padding: '6px 10px', marginBottom: 10, borderRadius: 6,
          border: '1px solid var(--border)', background: 'var(--bg-secondary)',
          color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box',
        }}
      />
      <div style={{ overflowY: 'auto', maxHeight: 320, border: '1px solid var(--border)', borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1 }}>
              <th
                onClick={() => handleSort('name')}
                style={{ textAlign: 'left', padding: '6px 8px', cursor: 'pointer', userSelect: 'none', borderBottom: '1px solid var(--border)', fontWeight: 700 }}
              >Package{sortArrow('name')}</th>
              <th
                onClick={() => handleSort('version')}
                style={{ textAlign: 'left', padding: '6px 8px', cursor: 'pointer', userSelect: 'none', borderBottom: '1px solid var(--border)', fontWeight: 700, whiteSpace: 'nowrap' }}
              >Version{sortArrow('version')}</th>
              <th
                onClick={() => handleSort('license')}
                style={{ textAlign: 'left', padding: '6px 8px', cursor: 'pointer', userSelect: 'none', borderBottom: '1px solid var(--border)', fontWeight: 700 }}
              >License{sortArrow('license')}</th>
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {filtered.map((row, i) => (
              <tr
                key={row.originalIndex}
                onClick={(e) => handleRowClick(i, e)}
                style={{
                  cursor: 'pointer',
                  background: selectedRows.has(i) ? 'rgba(var(--accent-rgb, 59,130,246), 0.15)' : i % 2 === 0 ? 'transparent' : 'rgba(128,128,128,0.04)',
                }}
              >
                <td style={{ padding: '3px 8px', fontFamily: 'monospace', fontSize: '0.78rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{row.name}</td>
                <td style={{ padding: '3px 8px', fontFamily: 'monospace', fontSize: '0.78rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{row.version}</td>
                <td
                  style={{ padding: '3px 8px', borderBottom: '1px solid var(--border)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={row.license}
                >{row.license}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)' }}>No packages match &ldquo;{filter}&rdquo;</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <button className="btn btn-sm btn-ghost" onClick={handleCopyAll} title="Copy filtered rows as tab-separated text">
          Copy All as TSV
        </button>
        {copyFeedback && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{copyFeedback}</span>}
      </div>
    </div>
  );
}

interface LicenseGroup {
  packages: { name: string; version: string }[];
  licenseType: string;
  licenseText: string;
}
const licenseGroups = (ossData as { groups: LicenseGroup[] }).groups;

function LicensesPanel() {
  const [filter, setFilter] = useState('');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const filtered = useMemo(() => {
    if (!filter) return licenseGroups;
    const lc = filter.toLowerCase();
    return licenseGroups.filter(g =>
      g.packages.some(p => p.name.toLowerCase().includes(lc)) ||
      g.licenseType.toLowerCase().includes(lc)
    );
  }, [filter]);

  const totalPackages = licenseGroups.reduce((s, g) => s + g.packages.length, 0);

  return (
    <div className="help-section" style={{ fontSize: '0.85rem' }}>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
        {totalPackages} open-source packages used in this application.
      </p>
      <input
        type="text"
        placeholder="Filter packages..."
        value={filter}
        onChange={e => { setFilter(e.target.value); setExpandedIdx(null); }}
        style={{
          width: '100%', padding: '6px 10px', marginBottom: 10, borderRadius: 6,
          border: '1px solid var(--border)', background: 'var(--bg-secondary)',
          color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {filtered.map((group, idx) => (
          <div key={idx}>
            <div
              onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              style={{
                padding: '5px 8px', borderRadius: 4, cursor: 'pointer',
                background: expandedIdx === idx ? 'rgba(var(--accent-rgb, 59,130,246), 0.08)' : 'transparent',
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginRight: 6 }}>
                {expandedIdx === idx ? '\u25BC' : '\u25B6'}
              </span>
              <span style={{ fontWeight: 600 }}>
                {group.packages.map(p => p.name).join(', ')}
              </span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.8rem' }}>
                {group.licenseType}
              </span>
            </div>
            {expandedIdx === idx && (
              <div style={{
                margin: '4px 0 8px 20px', padding: 10, borderRadius: 6,
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              }}>
                <table style={{ fontSize: '0.8rem', marginBottom: 8, borderCollapse: 'collapse' }}>
                  <tbody>
                    {group.packages.map(p => (
                      <tr key={p.name}>
                        <td style={{ paddingRight: 12, fontWeight: 600 }}>{p.name}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{p.version}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <pre style={{
                  fontSize: '0.72rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  maxHeight: 300, overflowY: 'auto', margin: 0, padding: 8, borderRadius: 4,
                  background: 'var(--bg-primary)', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                }}>
                  {group.licenseText}
                </pre>
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <p style={{ color: 'var(--text-muted)', padding: 8 }}>No packages match "{filter}"</p>
        )}
      </div>
    </div>
  );
}

function ChangelogPanel() {
  return (
    <div className="help-section help-changelog">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: '0.8rem', padding: '2px 8px', borderRadius: 4, background: 'var(--accent)', color: '#fff' }}>
          v{__APP_VERSION__}
        </span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Current version</span>
      </div>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{__CHANGELOG_MD__}</ReactMarkdown>
    </div>
  );
}

interface HelpDialogProps {
  onClose: () => void;
  initialTab?: HelpTab;
}

export function HelpDialog({ onClose, initialTab }: HelpDialogProps) {
  const [activeTab, setActiveTab] = useState<HelpTab>(initialTab ?? 'tour');
  const [showSupportForm, setShowSupportForm] = useState(false);
  const { unreadCount, fetchCases: fetchSupportCases } = useSupportStore();
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 700, h: 480 });
  const [centered, setCentered] = useState(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizing = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  // Center on first render
  useEffect(() => {
    if (centered) {
      setPos({ x: (window.innerWidth - size.w) / 2, y: (window.innerHeight - size.h) / 2 });
    }
  }, [centered, size.w, size.h]);

  // Fetch support cases on mount for unread badge (web only)
  useEffect(() => {
    if (isWeb) void fetchSupportCases();
  }, [fetchSupportCases]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, table, ul, p')) return;
    e.preventDefault();
    setCentered(false);
    dragging.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      setPos({
        x: dragging.current.origX + (ev.clientX - dragging.current.startX),
        y: dragging.current.origY + (ev.clientY - dragging.current.startY),
      });
    };
    const onUp = () => { dragging.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCentered(false);
    resizing.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      setSize({
        w: Math.max(400, resizing.current.origW + (ev.clientX - resizing.current.startX)),
        h: Math.max(300, resizing.current.origH + (ev.clientY - resizing.current.startY)),
      });
    };
    const onUp = () => { resizing.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [size]);

  const buildDate = new Date(__BUILD_DATE__);
  const formattedDate = buildDate.toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  }) + ' ' + buildDate.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="dialog help-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: size.w, height: size.h, maxWidth: 'none', maxHeight: 'none',
          display: 'flex', flexDirection: 'column', overflow: 'visible',
          position: 'fixed', left: pos.x, top: pos.y, margin: 0,
        }}
      >
        <h3 style={{ margin: '0 0 12px', cursor: 'move', userSelect: 'none' }} onMouseDown={onDragStart}>Taxonomy Editor Help</h3>

        <div style={{ display: 'flex', gap: 0, flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderRight: '1px solid var(--border)', paddingRight: 12, marginRight: 12 }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  padding: '6px 14px', fontSize: '0.8rem', fontWeight: 600,
                  cursor: 'pointer', border: 'none', borderLeft: t.id === activeTab ? '2px solid var(--accent)' : '2px solid transparent',
                  background: t.id === activeTab ? 'rgba(var(--accent-rgb, 59,130,246), 0.08)' : 'transparent',
                  color: t.id === activeTab ? 'var(--accent)' : 'var(--text-secondary)',
                  textAlign: 'left', borderRadius: 4, whiteSpace: 'nowrap',
                }}
              >
                {t.label}
                {t.id === 'my-cases' && unreadCount > 0 && (
                  <span style={{
                    marginLeft: 6, padding: '0 5px', borderRadius: 8, fontSize: '0.68rem',
                    fontWeight: 700, background: 'var(--color-error, #ef4444)', color: '#fff',
                    lineHeight: '16px', display: 'inline-block', minWidth: 16, textAlign: 'center',
                  }}>
                    {unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {activeTab === 'tour' && (
          <div className="help-section" style={{ fontSize: '0.85em', lineHeight: 1.6 }}>
            <p>
              New to the Taxonomy Editor? The Welcome Tour walks you through the main features — browsing the taxonomy, running AI debates, chatting with perspectives, and setting up your API key.
            </p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={() => {
                try { localStorage.removeItem('taxonomy-editor-onboarding-dismissed'); } catch { /* telemetry — silent by design */ }
                window.dispatchEvent(new Event('show-onboarding-tour'));
                onClose();
              }}
            >
              Launch Welcome Tour
            </button>
          </div>
        )}

        {activeTab === 'about' && (
          <div className="help-section help-about">
            <table className="help-shortcuts">
              <tbody>
                <tr><td className="help-key">Version</td><td>{__APP_VERSION__}</td></tr>
                <tr><td className="help-key">Built</td><td>{formattedDate}</td></tr>
                <tr><td className="help-key">Runtime</td><td>{getRuntime()}</td></tr>
              </tbody>
            </table>
            <p style={{ marginTop: 12, fontSize: '0.85em', color: 'var(--text-secondary)' }}>
              AI Triad Research — multi-perspective research platform for AI policy/safety literature.
              Berkman Klein Center, 2026.
            </p>
            <p style={{ marginTop: 8, fontSize: '0.8em', color: 'var(--text-muted)' }}>
              Built with Electron 35, React 19, TypeScript, Vite, and Zustand.
              AI backends: Google Gemini, Anthropic Claude, Groq, OpenAI, DeepSeek, Ollama.
            </p>
          </div>
        )}

        {activeTab === 'overview' && (
          <div className="help-section" style={{ fontSize: '0.85em', lineHeight: 1.6 }}>
            <p>
              This editor manages the AI Triad taxonomy across three perspectives
              (Accelerationist, Safetyist, Skeptic), situations shared
              across perspectives, and documented conflicts between positions.
            </p>

            <h4>Main Tabs</h4>
            <p><strong>Accelerationist / Safetyist / Skeptic</strong> — Each perspective has nodes organized into BDI categories (Beliefs, Desires, Intentions).</p>
            <p><strong>Situations</strong> — Cross-cutting concepts showing how each perspective interprets the same issue.</p>
            <p><strong>Conflicts</strong> — Documented disagreements with source instances and analyst notes.</p>
            <p><strong>Cruxes</strong> — Core disagreements distilled from debate rounds and cross-perspective analysis.</p>
            <p><strong>Summaries</strong> — Document summaries from the ingestion pipeline (Electron only).</p>
            <p><strong>Validation</strong> — Data integrity checks for the taxonomy, surfacing missing fields, orphan nodes, and schema violations.</p>
            <p><strong>Debate</strong> — Multi-agent debates between Accelerationist, Safetyist, and Skeptic characters using a BDI agent architecture. Debates progress through clarification, argumentation rounds, synthesis, and harvest.</p>
            <p><strong>Chat</strong> — POVer Chat with brainstorm, inform, and decide conversation modes for free-form AI-assisted exploration.</p>

            <h4>Toolbar Panels</h4>
            <p><strong>Search</strong> — Full-text search with raw, wildcard, regex, and semantic modes. Scope by perspective and/or BDI category.</p>
            <p><strong>Intellectual Lineage</strong> — Trace the intellectual heritage and influences behind taxonomy nodes.</p>
            <p><strong>Edge Browser</strong> — Browse AIF-aligned typed edges (attack, support, inference) between nodes across the full taxonomy graph.</p>
            <p><strong>Policy Alignment</strong> — Map taxonomy nodes to policy actions from the shared policy registry.</p>
            <p><strong>Policy Dashboard</strong> — Aggregate view of policy action coverage and alignment across perspectives.</p>
            <p><strong>Possible Fallacies</strong> — Identify potential logical fallacies in node claims and debate arguments.</p>
            <p><strong>Vocabulary</strong> — Browse the controlled vocabulary used across the taxonomy.</p>
            <p><strong>Calibration</strong> — Review and calibrate confidence scores and QBAF base scores.</p>
            <p><strong>Console</strong> — Development console for inspecting state and debugging (admin only).</p>
            <p><strong>Prompts</strong> — Inspect AI prompt templates and view prompt diffs between versions.</p>

            <h4>AI &amp; Backends</h4>
            <p>
              Six AI backends are supported: Google Gemini, Anthropic Claude, Groq, OpenAI, DeepSeek, and Ollama (local).
              Models are configured in <code>ai-models.json</code> with per-backend defaults, debate tier assignments, and fallback chains.
              Models without a configured API key are auto-disabled in debate setup.
            </p>
            <p><strong>Fact-checking</strong> — Debate claims can be verified using Gemini's integrated web search (google_search tool).</p>
            <p><strong>Key Sharing</strong> — Share API keys between devices via AES-256-GCM encrypted QR codes (Settings).</p>

            <h4>Diagnostics &amp; Observability</h4>
            <p><strong>Flight Recorder</strong> — Always-on ring buffer capturing system events, errors, and debate telemetry. Dump manually with Ctrl+Alt+D or via named pipe.</p>
            <p><strong>Diagnostics Window</strong> — Detachable window showing debate convergence signals, verification status, document coverage, and real-time debate state.</p>
            <p><strong>Debate Chat</strong> — AI-powered diagnostic sidebar for interrogating debate state (Ctrl+Shift+D to toggle).</p>
            <p><strong>Analytics Dashboard</strong> — Usage analytics and session metrics.</p>

            <h4>General</h4>
            <p><strong>Pin</strong> — Pin any item to compare it side-by-side with the active item.</p>
            <p><strong>Resize</strong> — Drag the border between the list and detail panels to resize.</p>
            <p><strong>Themes</strong> — Light, Dark, BKC, Harvard, and System (auto) color schemes.</p>
            <p><strong>Zoom</strong> — Ctrl+= / Ctrl+- / Ctrl+0 to zoom in, out, or reset.</p>
          </div>
        )}

        {activeTab === 'documentation' && (
          <div className="help-section">
            {DOCS.map((doc) => (
              <p key={doc.path} style={{ margin: '6px 0' }}>
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); void api.openExternal(`${REPO_URL}/blob/main/${doc.path}`); }}
                  style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  <strong>{doc.title}</strong>
                </a>
                {' — '}{doc.desc}
              </p>
            ))}
          </div>
        )}

        {activeTab === 'methods' && (
          <div className="help-section">
            <p>
              The system uses a <strong>neural-symbolic architecture</strong>: LLMs generate
              content while symbolic components provide structure, verification, and explanation.
            </p>
            <ul style={{ fontSize: '0.85em', lineHeight: 1.6 }}>
              <li><strong>QBAF</strong> — Quantitative Bipolar Argumentation Frameworks with DF-QuAD gradual semantics and BDI-aware base score calibration.
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal('https://aaai.org/papers/8-12874-discontinuity-free-decision-support-with-quantitative-argumentation-debates/'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Rago et al. (2016)</a>
                {' '}Built on: <a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal('https://www.sciencedirect.com/science/article/pii/000437029400041X'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Dung (1995)</a>
              </li>
              <li><strong>BDI Framework</strong> — Belief-Desire-Intention agent characterization separating empirical claims, normative commitments, and strategic reasoning.
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal('https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Rao & Georgeff (1995)</a>;
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal('https://press.uchicago.edu/ucp/books/book/distributed/I/bo3629095.html'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Bratman (1987)</a>
              </li>
              <li><strong>AIF</strong> — Argument Interchange Format vocabulary for typed attack/support relationships and scheme classification.
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal('https://dl.acm.org/doi/10.1017/S0269888906001044'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Chesñevar et al. (2006)</a>
              </li>
              <li><strong>FIRE</strong> — Confidence-gated Iterative Extraction replacing single-shot claim extraction with per-claim verification.
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal('https://arxiv.org/abs/2411.00784'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>arXiv:2411.00784</a>
              </li>
              <li><strong>4-Stage Pipeline</strong> — Each debate turn: BRIEF → PLAN → DRAFT → CITE with per-stage temperatures</li>
              <li><strong>Adaptive Staging</strong> — Seven convergence diagnostics trigger phase transitions (confrontation → argumentation → concluding)</li>
              <li><strong>13-Scheme Taxonomy</strong> — Derived from Walton's argumentation schemes with scheme-specific critical questions.
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal('https://www.cambridge.org/core/books/argumentation-schemes/9AE7E4E6ABDE690565442B2BD516A8B6'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Walton, Reed & Macagno (2008)</a>
              </li>
              <li><strong>14-Move Moderator</strong> — Six intervention families governed by pragma-dialectical theory; LLM recommends, engine validates against deterministic constraints.
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal('https://www.cambridge.org/us/catalogue/catalogue.asp?isbn=9780521537728'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>van Eemeren & Grootendorst (2004)</a>
              </li>
              <li><strong>Dialectic Traces</strong> — BFS traversal of the argument network producing human-readable narrative chains</li>
              <li><strong>DOLCE</strong> — Descriptive Ontology for Linguistic and Cognitive Engineering; foundational ontology informing the taxonomy's upper-level categories and cross-cutting situation semantics.
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal('https://arxiv.org/pdf/2308.01597'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Borgo et al. (2023)</a>
              </li>
              <li><strong>Emotional Register</strong> — Lexicon-based per-statement affect detection (urgency, fear, hope, outrage, empathy) with phase-appropriateness scoring, operationalizing the &ldquo;Emotional Appeal&rdquo; dimension of computational argument-quality assessment.
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal('https://aclanthology.org/E17-1017/'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Wachsmuth et al. (2017)</a>
              </li>
            </ul>
          </div>
        )}

        {activeTab === 'shortcuts' && (
          <div className="help-section">
            <h4 style={{ marginTop: 0 }}>General</h4>
            <table className="help-shortcuts">
              <tbody>
                <tr><td className="help-key">Ctrl + F</td><td>Open / close search</td></tr>
                <tr><td className="help-key">Ctrl + S</td><td>Save changes</td></tr>
                <tr><td className="help-key">Ctrl + =</td><td>Zoom in</td></tr>
                <tr><td className="help-key">Ctrl + -</td><td>Zoom out</td></tr>
                <tr><td className="help-key">Ctrl + 0</td><td>Reset zoom</td></tr>
                <tr><td className="help-key">Arrow Up/Down</td><td>Navigate items in list</td></tr>
                <tr><td className="help-key">Enter</td><td>Next search result</td></tr>
                <tr><td className="help-key">Shift + Enter</td><td>Previous search result</td></tr>
                <tr><td className="help-key">Escape</td><td>Close search / dialogs / navigate back</td></tr>
              </tbody>
            </table>
            <h4>Diagnostics &amp; Debug</h4>
            <table className="help-shortcuts">
              <tbody>
                <tr><td className="help-key">Ctrl + Shift + S</td><td>Capture screenshot (Electron only)</td></tr>
                <tr><td className="help-key">Ctrl + Alt + D</td><td>Dump flight recorder to disk</td></tr>
                <tr><td className="help-key">Ctrl + Shift + D</td><td>Toggle Debate Chat sidebar</td></tr>
                <tr><td className="help-key">Ctrl + L</td><td>Clear diagnostics chat (when input focused)</td></tr>
              </tbody>
            </table>
            <h4>Chat &amp; Comments</h4>
            <table className="help-shortcuts">
              <tbody>
                <tr><td className="help-key">Enter</td><td>Send message (chat / debate chat)</td></tr>
                <tr><td className="help-key">Ctrl + Enter</td><td>Submit comment</td></tr>
                <tr><td className="help-key">Arrow Up/Down</td><td>Browse prompt history (debate chat)</td></tr>
                <tr><td className="help-key">Tab</td><td>Autocomplete slash commands (debate chat)</td></tr>
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'sbom' && <SbomPanel />}

        {activeTab === 'licenses' && <LicensesPanel />}

        {activeTab === 'changelog' && <ChangelogPanel />}

        {activeTab === 'my-cases' && <MyCases />}

          </div>
        </div>

        <div className="dialog-actions">
          {isWeb && (
            <button className="btn btn-ghost" onClick={() => setShowSupportForm(true)}>Report a Problem</button>
          )}
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
        {showSupportForm && <SupportCaseForm onClose={() => setShowSupportForm(false)} />}

        {/* Resize handles: right edge, bottom edge, and corner */}
        <div onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setCentered(false);
          const start = { x: e.clientX, w: size.w };
          const onMove = (ev: MouseEvent) => setSize(s => ({ ...s, w: Math.max(400, start.w + (ev.clientX - start.x)) }));
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
        }} style={{ position: 'absolute', right: -4, top: 0, width: 14, height: '100%', cursor: 'ew-resize', zIndex: 10 }} />
        <div onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setCentered(false);
          const start = { y: e.clientY, h: size.h };
          const onMove = (ev: MouseEvent) => setSize(s => ({ ...s, h: Math.max(300, start.h + (ev.clientY - start.y)) }));
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
        }} style={{ position: 'absolute', bottom: -4, left: 0, width: '100%', height: 14, cursor: 'ns-resize', zIndex: 10 }} />
        <div
          onMouseDown={onResizeStart}
          style={{
            position: 'absolute', right: -4, bottom: -4, width: 20, height: 20,
            cursor: 'nwse-resize', opacity: 0.4, zIndex: 11,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: 'block' }}>
            <path d="M14 14L8 14M14 14L14 8M14 14L5 5" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </div>
      </div>
    </div>
  );
}
