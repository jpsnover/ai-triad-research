// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useCallback, useEffect } from 'react';
import { api } from '@bridge';

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

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
] as const;

function getRuntime(): string {
  const target = import.meta.env.VITE_TARGET;
  if (target === 'web') return 'Container';
  if (typeof window !== 'undefined' && (window as any).electronAPI) return 'Electron';
  return 'Browser';
}

type HelpTab = 'about' | 'overview' | 'documentation' | 'methods' | 'shortcuts';

const TABS: { id: HelpTab; label: string }[] = [
  { id: 'about', label: 'About' },
  { id: 'overview', label: 'Overview' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'methods', label: 'Methods' },
  { id: 'shortcuts', label: 'Shortcuts' },
];

interface HelpDialogProps {
  onClose: () => void;
}

export function HelpDialog({ onClose }: HelpDialogProps) {
  const [activeTab, setActiveTab] = useState<HelpTab>('about');
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
    <div className="dialog-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="dialog help-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: size.w, height: size.h, display: 'flex', flexDirection: 'column',
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
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

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
          </div>
        )}

        {activeTab === 'overview' && (
          <div className="help-section">
            <p>
              This editor manages the AI Triad taxonomy across three perspectives
              (Accelerationist, Safetyist, Skeptic), situations shared
              across perspectives, and documented conflicts between positions.
            </p>
            <h4>Tabs</h4>
            <p>
              <strong>Accelerationist / Safetyist / Skeptic</strong> — Each perspective
              has nodes organized into three BDI categories: Desires, Intentions, and Beliefs.
            </p>
            <p>
              <strong>Situations</strong> — Concepts that span all three perspectives.
              Each node includes how each perspective interprets the concept.
            </p>
            <p>
              <strong>Conflicts</strong> — Documented disagreements between perspectives,
              with source instances and analyst notes.
            </p>
            <h4>Features</h4>
            <p><strong>Pin</strong> — Pin any item to compare it side-by-side with the active item.</p>
            <p><strong>Search</strong> — Full-text search with raw, wildcard, and regex modes. Scope by POV and/or category.</p>
            <p><strong>Resize</strong> — Drag the border between the list and detail panels to resize.</p>
          </div>
        )}

        {activeTab === 'documentation' && (
          <div className="help-section">
            {DOCS.map((doc) => (
              <p key={doc.path} style={{ margin: '6px 0' }}>
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); api.openExternal(`${REPO_URL}/blob/main/${doc.path}`); }}
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
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://aaai.org/papers/8-12874-discontinuity-free-decision-support-with-quantitative-argumentation-debates/'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Rago et al. (2016)</a>
                {' '}Built on: <a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://www.sciencedirect.com/science/article/pii/000437029400041X'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Dung (1995)</a>
              </li>
              <li><strong>BDI Framework</strong> — Belief-Desire-Intention agent characterization separating empirical claims, normative commitments, and strategic reasoning.
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Rao & Georgeff (1995)</a>;
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://press.uchicago.edu/ucp/books/book/distributed/I/bo3629095.html'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Bratman (1987)</a>
              </li>
              <li><strong>AIF</strong> — Argument Interchange Format vocabulary for typed attack/support relationships and scheme classification.
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://dl.acm.org/doi/10.1017/S0269888906001044'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Chesñevar et al. (2006)</a>
              </li>
              <li><strong>FIRE</strong> — Confidence-gated Iterative Extraction replacing single-shot claim extraction with per-claim verification.
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://arxiv.org/abs/2411.00784'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>arXiv:2411.00784</a>
              </li>
              <li><strong>4-Stage Pipeline</strong> — Each debate turn: BRIEF → PLAN → DRAFT → CITE with per-stage temperatures</li>
              <li><strong>Adaptive Staging</strong> — Seven convergence diagnostics trigger phase transitions (thesis-antithesis → exploration → synthesis)</li>
              <li><strong>13-Scheme Taxonomy</strong> — Derived from Walton's argumentation schemes with scheme-specific critical questions.
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://www.cambridge.org/core/books/argumentation-schemes/9AE7E4E6ABDE690565442B2BD516A8B6'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>Walton, Reed & Macagno (2008)</a>
              </li>
              <li><strong>14-Move Moderator</strong> — Six intervention families governed by pragma-dialectical theory; LLM recommends, engine validates against deterministic constraints.
                {' '}<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://www.cambridge.org/us/catalogue/catalogue.asp?isbn=9780521537728'); }} style={{ color: 'var(--accent)', fontSize: '0.85em' }}>van Eemeren & Grootendorst (2004)</a>
              </li>
              <li><strong>Dialectic Traces</strong> — BFS traversal of the argument network producing human-readable narrative chains</li>
            </ul>
          </div>
        )}

        {activeTab === 'shortcuts' && (
          <div className="help-section">
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
                <tr><td className="help-key">Escape</td><td>Close search / dialogs</td></tr>
              </tbody>
            </table>
          </div>
        )}

          </div>
        </div>

        <div className="dialog-actions">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>

        {/* Resize handles: right edge, bottom edge, and corner */}
        <div onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setCentered(false);
          const start = { x: e.clientX, w: size.w };
          const onMove = (ev: MouseEvent) => setSize(s => ({ ...s, w: Math.max(400, start.w + (ev.clientX - start.x)) }));
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
        }} style={{ position: 'absolute', right: 0, top: 0, width: 6, height: '100%', cursor: 'ew-resize' }} />
        <div onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setCentered(false);
          const start = { y: e.clientY, h: size.h };
          const onMove = (ev: MouseEvent) => setSize(s => ({ ...s, h: Math.max(300, start.h + (ev.clientY - start.y)) }));
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
        }} style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: 6, cursor: 'ns-resize' }} />
        <div
          onMouseDown={onResizeStart}
          style={{
            position: 'absolute', right: 0, bottom: 0, width: 16, height: 16,
            cursor: 'nwse-resize', opacity: 0.4,
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
