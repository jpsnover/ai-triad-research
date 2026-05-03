// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Standalone diagnostics window — always-on-top popout that receives
 * state updates from the main window via IPC.
 */

import { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from 'react';
import { api } from '@bridge';
import { POVER_INFO } from '../types/debate';
import type { PoverId, DebateSession, EntryDiagnostics, ArgumentNetworkNode, ArgumentNetworkEdge, CommitmentStore, TurnValidationTrail, TurnValidation, TurnAttempt } from '../types/debate';
import { computeQbafStrengths } from '@lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '@lib/debate/qbaf';
import { getMoveName, MOVE_EDGE_MAP } from '@lib/debate/helpers';
import type { MoveAnnotation } from '@lib/debate/helpers';
import { ExtractionTimelinePanel } from './ExtractionTimelinePanel';
import { ConvergenceSignalsPanel } from './ConvergenceSignalsPanel';
import { TaxonomyRefDetail, type TaxRefNode, type TaxRefEdge } from './TaxonomyRefDetail';
import { DiagnosticsChatSidebar } from './DiagnosticsChatSidebar';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import type { NavigateCommand } from './DiagnosticsChatSidebar';
import { TaxonomyGapPanel } from './TaxonomyGapPanel';
import { GroundingPanel } from './GroundingPanel';
import { PovProgressionView } from './PovProgression/PovProgressionView';

const DiagSearchContext = createContext('');

const AIF_TOOLTIPS: Record<string, string> = {
  'I-node': 'I-node (Information node) — a claim, proposition, or data point. These are the passive content of arguments: what is being asserted.',
  'CA-node': 'CA-node (Conflict Application) — an attack relationship. Three types: rebut (contradicts conclusion), undercut (denies the inference), undermine (attacks premise credibility).',
  'RA-node': 'RA-node (Rule Application) — an inference scheme explaining WHY one claim supports another. The warrant is the reasoning pattern connecting evidence to conclusion.',
  'PA-node': 'PA-node (Preference Application) — resolves conflicts by determining which argument prevails and why, based on criteria like evidence strength or logical validity.',
};

function AifBadge({ type, label }: { type: 'I-node' | 'CA-node' | 'RA-node' | 'PA-node'; label?: string }) {
  const [showTip, setShowTip] = useState(false);
  const colors: Record<string, { bg: string; fg: string }> = {
    'I-node': { bg: 'rgba(59,130,246,0.15)', fg: '#3b82f6' },
    'CA-node': { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444' },
    'RA-node': { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e' },
    'PA-node': { bg: 'rgba(139,92,246,0.15)', fg: '#8b5cf6' },
  };
  const c = colors[type] || colors['I-node'];
  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <span style={{ background: c.bg, color: c.fg, padding: '1px 5px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 700, marginRight: 4, cursor: 'default' }}>
        {label || type}
      </span>
      {showTip && (
        <span style={{
          position: 'absolute', left: 0, top: '100%', marginTop: 4, zIndex: 1000,
          background: '#1a1a2e', color: '#e0e0e0', padding: '6px 10px', borderRadius: 6,
          fontSize: '0.7rem', lineHeight: 1.4, width: 320, whiteSpace: 'normal',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', border: '1px solid #333',
        }}>
          {AIF_TOOLTIPS[type]}
        </span>
      )}
    </span>
  );
}

function speakerLabel(speaker: string): string {
  if (speaker === 'system') return 'Moderator';
  if (speaker === 'user') return 'You';
  return POVER_INFO[speaker as Exclude<PoverId, 'user'>]?.label || speaker;
}

function TrafficLight({ pass, label, tip }: { pass: boolean; label: string; tip: string }) {
  return (
    <span
      title={tip}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 6px', borderRadius: 10,
        background: pass ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
        color: pass ? '#16a34a' : '#dc2626',
        fontSize: '0.7rem', fontWeight: 600,
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />
      {label}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: TurnValidation['outcome'] }) {
  const palette: Record<TurnValidation['outcome'], { bg: string; fg: string; text: string }> = {
    pass:              { bg: 'rgba(34,197,94,0.15)',  fg: '#16a34a', text: 'PASS' },
    accept_with_flag:  { bg: 'rgba(234,179,8,0.18)',  fg: '#b45309', text: 'ACCEPT (flagged)' },
    retry:             { bg: 'rgba(239,68,68,0.15)',  fg: '#dc2626', text: 'RETRY' },
    skipped:           { bg: 'rgba(148,163,184,0.18)', fg: '#475569', text: 'SKIPPED' },
  };
  const c = palette[outcome] ?? palette.pass;
  return (
    <span style={{
      background: c.bg, color: c.fg, fontWeight: 700, fontSize: '0.7rem',
      padding: '2px 8px', borderRadius: 10, letterSpacing: 0.5,
    }}>{c.text}</span>
  );
}

function TurnValidationAttemptRow({ a }: { a: TurnAttempt }) {
  const [open, setOpen] = useState(false);
  const v = a.validation;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, marginBottom: 6 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          cursor: 'pointer', padding: '6px 8px', display: 'flex',
          alignItems: 'center', gap: 8, fontSize: '0.75rem',
        }}
      >
        <span style={{ color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
        <strong>Attempt {a.attempt}{a.attempt === 0 ? ' (original)' : ''}</strong>
        <OutcomeBadge outcome={v.outcome} />
        <span style={{ color: 'var(--text-muted)' }}>score {v.score.toFixed(2)}</span>
        <span style={{ color: 'var(--text-muted)' }}>{(a.response_time_ms / 1000).toFixed(1)}s</span>
        {v.judge_used && <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>judge: {v.judge_model}</span>}
      </div>
      {open && (
        <div style={{ padding: '4px 10px 10px', fontSize: '0.72rem' }}>
          {v.repairHints.length > 0 && (
            <>
              <div style={{ fontWeight: 600, marginTop: 4 }}>Repair hints</div>
              <ul style={{ margin: '2px 0 6px 16px', padding: 0 }}>
                {v.repairHints.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </>
          )}
          {v.clarifies_taxonomy.length > 0 && (
            <>
              <div style={{ fontWeight: 600, marginTop: 4 }}>Taxonomy clarification hints</div>
              <ul style={{ margin: '2px 0 6px 16px', padding: 0 }}>
                {v.clarifies_taxonomy.map((h, i) => (
                  <li key={i}>
                    <strong>{h.action}</strong>
                    {h.node_id ? ` ${h.node_id}` : h.label ? ` "${h.label}"` : ''}
                    {h.rationale ? ` — ${h.rationale}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          {a.prompt_delta && (
            <>
              <div style={{ fontWeight: 600, marginTop: 4 }}>Repair prompt delta</div>
              <pre style={{
                whiteSpace: 'pre-wrap', background: 'var(--bg-subtle)',
                padding: 6, borderRadius: 3, maxHeight: 200, overflow: 'auto',
                fontSize: '0.7rem',
              }}>{a.prompt_delta}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TurnValidationSection({ trail }: { trail: TurnValidationTrail }) {
  const f = trail.final;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <OutcomeBadge outcome={f.outcome} />
        <span style={{ fontSize: '0.8rem' }}>score <strong>{f.score.toFixed(2)}</strong></span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {trail.attempts.length} attempt{trail.attempts.length === 1 ? '' : 's'}
        </span>
        {f.judge_used && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>judge: {f.judge_model}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <TrafficLight pass={f.dimensions.schema.pass}      label="schema"      tip={f.dimensions.schema.issues.join('\n') || 'OK'} />
        <TrafficLight pass={f.dimensions.grounding.pass}   label="grounding"   tip={f.dimensions.grounding.issues.join('\n') || 'OK'} />
        <TrafficLight pass={f.dimensions.advancement.pass} label="advancement" tip={f.dimensions.advancement.signals.join('\n') || 'OK'} />
        <TrafficLight pass={f.dimensions.clarifies.pass}   label="clarifies"   tip={f.dimensions.clarifies.signals.join('\n') || 'no taxonomy hints'} />
      </div>
      {f.repairHints.length > 0 && (
        <div style={{ fontSize: '0.75rem', marginBottom: 8 }}>
          <strong>Final repair hints</strong>
          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
            {f.repairHints.map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </div>
      )}
      <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Attempts</div>
      {trail.attempts.map((a, i) => <TurnValidationAttemptRow key={i} a={a} />)}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        api.clipboardWriteText(text);
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

function Section({ title, children, defaultOpen = false, copyText }: { title: string; children: React.ReactNode; defaultOpen?: boolean; copyText?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const sq = useContext(DiagSearchContext);
  const sectionMatches = sq && copyText ? countMatches(copyText, sq) : 0;
  // Auto-open sections with search matches
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

const POV_NODE_COLOR: Record<string, string> = {
  'acc-': 'var(--color-acc)',
  'saf-': 'var(--color-saf)',
  'skp-': 'var(--color-skp)',
  'sit-': 'var(--color-sit)',
  'cc-': 'var(--color-sit)',
};
function edgeNodeColor(id: string) {
  for (const [prefix, color] of Object.entries(POV_NODE_COLOR)) {
    if (id.startsWith(prefix)) return color;
  }
  return 'var(--text-muted)';
}

type EdgeUsed = { source: string; target: string; type: string; confidence: number };

function EdgesUsedGrouped({ edges, allEdges, taxNodeMap, nodeLabels }: {
  edges: EdgeUsed[];
  allEdges: TaxRefEdge[];
  taxNodeMap: Map<string, Record<string, unknown>>;
  nodeLabels: Map<string, string>;
}) {
  const [selectedIdx, setSelectedIdx] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const groups = new Map<string, EdgeUsed[]>();
    for (const e of edges) {
      const arr = groups.get(e.type);
      if (arr) arr.push(e); else groups.set(e.type, [e]);
    }
    for (const arr of groups.values()) arr.sort((a, b) => b.confidence - a.confidence);
    return groups;
  }, [edges]);

  // Look up full edge from allEdges
  const selectedEdge = useMemo(() => {
    if (!selectedIdx) return null;
    const [src, tgt, typ] = selectedIdx.split('|');
    return allEdges.find(e => e.source === src && e.target === tgt && e.type === typ) ?? null;
  }, [selectedIdx, allEdges]);

  const selectedUsed = useMemo(() => {
    if (!selectedIdx) return null;
    const [src, tgt, typ] = selectedIdx.split('|');
    return edges.find(e => e.source === src && e.target === tgt && e.type === typ) ?? null;
  }, [selectedIdx, edges]);

  return (
    <div style={{ display: 'flex', gap: 8, minHeight: 200 }}>
      {/* Left: edge list */}
      <div style={{ flex: '1 1 45%', maxHeight: 400, overflowY: 'auto' }}>
        {Array.from(grouped.entries()).map(([type, edgeList]) => (
          <EdgesUsedGroup key={type} edgeType={type} edges={edgeList} selectedIdx={selectedIdx} onSelect={setSelectedIdx} nodeLabels={nodeLabels} />
        ))}
      </div>
      {/* Right: edge detail */}
      <div style={{ flex: '1 1 55%', maxHeight: 400, overflowY: 'auto', borderLeft: '1px solid var(--border)', paddingLeft: 10 }}>
        {selectedEdge ? (
          <EdgesUsedDetail edge={selectedEdge} taxNodeMap={taxNodeMap} nodeLabels={nodeLabels} />
        ) : selectedUsed ? (
          <EdgesUsedDetail edge={{ ...selectedUsed, bidirectional: false, rationale: '', status: '', weight: undefined, strength: undefined, notes: undefined }} taxNodeMap={taxNodeMap} nodeLabels={nodeLabels} />
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '20px 8px', textAlign: 'center' }}>Select an edge to view details</div>
        )}
      </div>
    </div>
  );
}

function EdgesUsedGroup({ edgeType, edges, selectedIdx, onSelect, nodeLabels }: {
  edgeType: string;
  edges: EdgeUsed[];
  selectedIdx: string | null;
  onSelect: (idx: string | null) => void;
  nodeLabels: Map<string, string>;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="related-edge-group">
      <div className="related-edge-group-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="related-edge-group-toggle">{collapsed ? '\u25B6' : '\u25BC'}</span>
        <span className="related-edge-type-name">{edgeType.replace(/_/g, ' ')}</span>
        <span className="related-edge-type-count">{edges.length}</span>
      </div>
      {!collapsed && edges.map((e, i) => {
        const key = `${e.source}|${e.target}|${e.type}`;
        const isSelected = selectedIdx === key;
        const srcLabel = nodeLabels.get(e.source);
        const tgtLabel = nodeLabels.get(e.target);
        return (
          <div
            key={i}
            className={`related-edge-card${isSelected ? ' related-edge-selected' : ''}`}
            onClick={() => onSelect(isSelected ? null : key)}
            style={{ cursor: 'pointer' }}
          >
            <div className="related-edge-header">
              <span className="related-edge-label-primary" style={{ color: edgeNodeColor(e.source) }}>
                {srcLabel ? truncateLabel(srcLabel, 20) : e.source}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.62rem', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.03em' }}>{edgeType.replace(/_/g, ' ')}</span>
              <span className="related-edge-label-primary" style={{ color: edgeNodeColor(e.target) }}>
                {tgtLabel ? truncateLabel(tgtLabel, 20) : e.target}
              </span>
            </div>
            <div className="related-edge-sub">
              <span className="related-edge-id">{e.source} &rarr; {e.target}</span>
              <span className="related-wc-tag">c{Math.round(e.confidence * 100)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function truncateLabel(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + '\u2026' : s;
}

function EdgesUsedDetail({ edge, taxNodeMap, nodeLabels }: {
  edge: TaxRefEdge;
  taxNodeMap: Map<string, Record<string, unknown>>;
  nodeLabels: Map<string, string>;
}) {
  const srcNode = taxNodeMap.get(edge.source) as TaxRefNode | undefined;
  const tgtNode = taxNodeMap.get(edge.target) as TaxRefNode | undefined;
  const srcLabel = nodeLabels.get(edge.source) ?? edge.source;
  const tgtLabel = nodeLabels.get(edge.target) ?? edge.target;
  const pct = Math.round(edge.confidence * 100);

  return (
    <div style={{ fontSize: '0.78rem' }}>
      {/* Edge type banner */}
      <div className="edge-detail-type-banner">
        <span className="edge-detail-type-name">{edge.type.replace(/_/g, ' ')}</span>
        {edge.bidirectional && <span className="edge-detail-bidir" title="Bidirectional">&harr;</span>}
      </div>

      {/* Source → Target */}
      <div className="edge-detail-endpoints">
        <div className="edge-detail-endpoint">
          <div className="edge-detail-endpoint-role">SOURCE</div>
          <div className="edge-detail-endpoint-label" style={{ color: edgeNodeColor(edge.source) }}>{srcLabel}</div>
          <div className="edge-detail-endpoint-id">{edge.source}</div>
        </div>
        <div className="edge-detail-arrow">{edge.bidirectional ? '\u2194' : '\u2192'}</div>
        <div className="edge-detail-endpoint">
          <div className="edge-detail-endpoint-role">TARGET</div>
          <div className="edge-detail-endpoint-label" style={{ color: edgeNodeColor(edge.target) }}>{tgtLabel}</div>
          <div className="edge-detail-endpoint-id">{edge.target}</div>
        </div>
      </div>

      {/* Source & Target descriptions */}
      {(srcNode?.description || tgtNode?.description) && (
        <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
          {srcNode?.description && (
            <div style={{ flex: 1, padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.04em' }}>Source Description</div>
              <div style={{ fontSize: '0.75rem', lineHeight: 1.5 }}>{srcNode.description}</div>
            </div>
          )}
          {tgtNode?.description && (
            <div style={{ flex: 1, padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.04em' }}>Target Description</div>
              <div style={{ fontSize: '0.75rem', lineHeight: 1.5 }}>{tgtNode.description}</div>
            </div>
          )}
        </div>
      )}

      {/* Rationale */}
      {edge.rationale && (
        <div className="edge-detail-section">
          <div className="edge-detail-section-label">RATIONALE</div>
          <div style={{ fontSize: '0.78rem', lineHeight: 1.55 }}>{edge.rationale}</div>
        </div>
      )}

      {/* Confidence & Strength */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', margin: '10px 0', fontSize: '0.78rem' }}>
        <span>Confidence: {pct}%</span>
        {edge.strength && <span>Strength: {edge.strength}</span>}
      </div>

      {/* Status */}
      {edge.status && edge.status !== 'approved' && (
        <span className={`edge-detail-status-badge status-${edge.status}`}>
          {edge.status === 'rejected' ? '\u2717 ' : '\u25CF '}{edge.status}
        </span>
      )}
      {edge.status === 'approved' && (
        <span style={{ color: '#22c55e', fontWeight: 600, fontSize: '0.75rem' }}>{'\u2713'} Approved</span>
      )}

      {/* Notes */}
      {edge.notes && (
        <div className="edge-detail-section" style={{ marginTop: 10 }}>
          <div className="edge-detail-section-label">Notes</div>
          <div style={{ fontSize: '0.75rem' }}>{edge.notes}</div>
        </div>
      )}
    </div>
  );
}

function CommitmentsPanel({ commitments, nodes, onGoToNode }: {
  commitments: Record<string, CommitmentStore>;
  nodes: ArgumentNetworkNode[];
  onGoToNode: (nodeId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, string | null>>({});
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; text: string; nodeId: string | null } | null>(null);

  const toggle = (pov: string, category: string) => {
    setExpanded(prev => ({
      ...prev,
      [pov]: prev[pov] === category ? null : category,
    }));
  };

  // Map commitment text → AN node ID via exact or substring match
  const textToNodeId = useMemo(() => {
    const m = new Map<string, string>();
    for (const item of nodes) {
      m.set(item.text, item.id);
    }
    return m;
  }, [nodes]);

  const findNodeId = (commitmentText: string): string | null => {
    // Exact match first
    if (textToNodeId.has(commitmentText)) return textToNodeId.get(commitmentText)!;
    // Substring match — commitment text may be a prefix/substring of the node text
    for (const [nodeText, nodeId] of textToNodeId) {
      if (nodeText.includes(commitmentText) || commitmentText.includes(nodeText)) return nodeId;
    }
    return null;
  };

  const handleContextMenu = (e: React.MouseEvent, text: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, text, nodeId: findNodeId(text) });
  };

  useEffect(() => {
    if (!ctxMenu) return;
    const dismiss = () => setCtxMenu(null);
    window.addEventListener('click', dismiss);
    return () => window.removeEventListener('click', dismiss);
  }, [ctxMenu]);

  const categories = [
    { key: 'asserted', label: 'Asserted', color: '#3b82f6' },
    { key: 'conceded', label: 'Conceded', color: '#f59e0b' },
    { key: 'challenged', label: 'Challenged', color: '#ef4444' },
  ] as const;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }}>
      {Object.entries(commitments).map(([pov, store]) => (
        <div key={pov} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <strong style={{ fontSize: '0.8rem' }}>{speakerLabel(pov)}</strong>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 2 }}>
            {categories.map(cat => {
              const items = store[cat.key];
              const isOpen = expanded[pov] === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => items.length > 0 && toggle(pov, cat.key)}
                  style={{
                    padding: '2px 8px', borderRadius: 10, border: 'none',
                    fontSize: '0.65rem', fontWeight: 600, cursor: items.length > 0 ? 'pointer' : 'default',
                    background: isOpen ? cat.color : `${cat.color}18`,
                    color: isOpen ? '#fff' : cat.color,
                    opacity: items.length === 0 ? 0.4 : 1,
                  }}
                >
                  {cat.label} {items.length}
                </button>
              );
            })}
          </div>
          {expanded[pov] && (() => {
            const cat = categories.find(c => c.key === expanded[pov])!;
            const items = store[cat.key];
            if (items.length === 0) return null;
            return (
              <div style={{
                margin: '2px 0 4px 8px', padding: '4px 8px', borderRadius: 4,
                borderLeft: `3px solid ${cat.color}`,
                background: `${cat.color}08`, fontSize: '0.7rem',
              }}>
                {items.map((item, i) => {
                  const nodeId = findNodeId(item);
                  return (
                    <div
                      key={i}
                      onContextMenu={(e) => handleContextMenu(e, item)}
                      style={{ padding: '2px 0', borderBottom: i < items.length - 1 ? '1px solid var(--border-subtle)' : 'none', cursor: 'context-menu' }}
                    >
                      {nodeId && (
                        <span style={{
                          padding: '0 4px', borderRadius: 3, marginRight: 4,
                          background: 'rgba(59,130,246,0.12)', color: '#3b82f6',
                          fontSize: '0.6rem', fontWeight: 700, fontFamily: 'var(--font-mono)',
                        }}>{nodeId}</span>
                      )}
                      {item}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      ))}
      {ctxMenu && (
        <div style={{
          position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999,
          background: 'var(--bg-primary)', border: '1px solid var(--border)',
          borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          padding: '4px 0', minWidth: 140, fontSize: '0.72rem',
        }}>
          <button
            onClick={() => { navigator.clipboard.writeText(ctxMenu.text); setCtxMenu(null); }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '5px 12px', border: 'none', background: 'transparent',
              color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.72rem',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.1)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >Copy</button>
          {ctxMenu.nodeId && (
            <button
              onClick={() => { onGoToNode(ctxMenu.nodeId!); setCtxMenu(null); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '5px 12px', border: 'none', background: 'transparent',
                color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.72rem',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >Go to {ctxMenu.nodeId}</button>
          )}
        </div>
      )}
    </div>
  );
}

function HelpContent() {
  return (
    <div style={{ fontSize: '0.8rem', lineHeight: 1.6, maxWidth: 650 }}>
      <h3 style={{ color: '#f59e0b', marginTop: 0 }}>Argument Interchange Format (AIF)</h3>
      <p>
        The AIF is a formal ontology for representing argumentation, established by
        Chesnevar et al. (2006). It provides a shared vocabulary for describing how
        arguments are constructed, how they relate to each other, and how conflicts
        between them are resolved.
      </p>
      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        Reference: Chesnevar, C., McGinnis, J., Modgil, S., Rahwan, I., Reed, C., Simari, G., South, M., Vreeswijk, G., & Willmott, S. (2006).
        "Towards an Argument Interchange Format." <em>The Knowledge Engineering Review</em>, 21(4), 293-316.
        [<a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://jmvidal.cse.sc.edu/library/chesnevar06a.pdf'); }} style={{ color: '#f59e0b' }}>PDF</a>]
      </p>
      <p>The core building blocks are:</p>
      <ul>
        <li><strong>I-nodes (Information nodes)</strong> — claims, propositions, or data points.
          These are the passive content of arguments: "Scaling compute is sufficient for AGI"
          or "Current AI systems exhibit bias." In this tool, each <strong>AN-</strong> entry
          in the Argument Network is an I-node.</li>
        <li><strong>RA-nodes (Rule Application)</strong> — inference schemes that explain WHY
          one claim supports another. When you see a <span style={{ color: '#22c55e' }}>support</span> edge
          with a <em>warrant</em>, that warrant is the RA-node: the reasoning pattern connecting
          evidence to conclusion.</li>
        <li><strong>CA-nodes (Conflict Application)</strong> — attack relationships between claims.
          Three types:
          <ul>
            <li><strong style={{ color: '#ef4444' }}>Rebut</strong> — directly contradicts the conclusion
              ("No, scaling is NOT sufficient")</li>
            <li><strong style={{ color: '#ef4444' }}>Undercut</strong> — accepts the evidence but denies the
              inference ("The evidence is real but doesn't prove what you claim")</li>
            <li><strong style={{ color: '#ef4444' }}>Undermine</strong> — attacks the credibility of the
              premise itself ("That study was flawed")</li>
          </ul>
        </li>
        <li><strong>PA-nodes (Preference Application)</strong> — resolve conflicts by determining
          which argument prevails. In this tool, these appear in the synthesis as
          <em>Preference Verdicts</em> with criteria like empirical evidence strength or
          logical validity.</li>
      </ul>

      <h3 style={{ color: '#f59e0b' }}>The Argument Network</h3>
      <p>
        The Argument Network is built incrementally during the debate. After each debater
        speaks, the tool extracts 1-4 key claims from their statement and maps how those
        claims relate to prior claims.
      </p>
      <p>Reading the network:</p>
      <ul>
        <li><strong>AN-1, AN-2, ...</strong> — claim identifiers, in order of appearance</li>
        <li><strong>(Prometheus), (Sentinel), (Cassandra)</strong> — who made the claim</li>
        <li><span style={{ color: '#ef4444' }}>← AN-6 rebut via REFRAME</span> — claim AN-6 attacks
          this claim. "rebut" is the attack type; "REFRAME" is the dialectical scheme
          (the argumentative strategy used)</li>
        <li><span style={{ color: '#22c55e' }}>← AN-3 supports</span> — claim AN-3 provides evidence
          or reasoning for this claim</li>
        <li><strong>Warrant</strong> — the reasoning link explaining WHY the support or attack
          relationship holds. This is the AIF S-node made visible.</li>
      </ul>

      <h3 style={{ color: '#f59e0b' }}>Dialectical Schemes</h3>
      <table style={{ fontSize: '0.75rem', borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>Scheme</th>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>AIF Type</th>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style={{ padding: '3px 8px' }}>CONCEDE</td><td>Support (RA)</td><td>Accept opponent's point</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>DISTINGUISH</td><td>Undercut (CA)</td><td>Accept evidence, deny it applies here</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>REFRAME</td><td>Scheme shift</td><td>Shift the interpretive frame</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>COUNTEREXAMPLE</td><td>Rebut (CA)</td><td>Specific case contradicting the claim</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>REDUCE</td><td>Rebut (CA)</td><td>Show the logic leads to absurdity</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>ESCALATE</td><td>Scheme shift</td><td>Connect to a broader principle</td></tr>
        </tbody>
      </table>

      <h3 style={{ color: '#f59e0b' }}>Commitment Stores</h3>
      <p>
        Each debater has a commitment store tracking what they've <strong>asserted</strong> (claimed
        to be true), <strong>conceded</strong> (accepted from an opponent), and <strong>challenged</strong> (questioned
        or attacked). Contradictions between assertions and concessions are flagged.
        Commitments are injected into each debater's prompt to enforce consistency.
      </p>

      <h3 style={{ color: '#f59e0b' }}>Methodology: AIF-Informed, Not AIF-Formal</h3>
      <p>
        This tool adopts AIF <strong>vocabulary</strong> (I-nodes, CA-nodes, RA-nodes,
        attack types, schemes, warrants) but deliberately does not implement the full
        formal <strong>bipartite graph</strong> that AIF specifies. In a fully
        AIF-compliant system, I-nodes never connect directly — every support and attack
        relationship passes through an intermediate S-node (scheme node) that carries
        the reasoning pattern. Our system stores scheme, warrant, and attack type as
        properties on the edge connecting two I-nodes.
      </p>

      <h4 style={{ color: '#f59e0b', fontSize: '0.8rem' }}>Why not the full bipartite graph?</h4>

      <p><strong>LLM extraction reliability.</strong> Claims are extracted from debate
        statements by a background AI call after each turn. Asking the LLM to produce
        bipartite JSON (I-node &rarr; S-node &rarr; I-node triples) significantly increases
        the structured-output complexity and error rate. The current flat format (I-node
        &rarr; I-node with typed edges) is validated at 40% word-overlap against the
        original statement text. Adding intermediate nodes would roughly triple the
        output surface for hallucination and parse failures, without improving the
        information captured.</p>

      <p><strong>No consumer requires it.</strong> The moderator's cross-respond selection,
        commitment tracking, synthesis argument maps, and harvest pipeline all work on
        the flat I-node + typed-edge model. S-node content (scheme, warrant, critical
        questions) is captured — it's just stored on the edge rather than as a separate
        node. Every query the system needs to answer ("what claims has Prometheus
        made?", "what attacks are unaddressed?", "which rebuts used COUNTEREXAMPLE?")
        is answerable from the current structure.</p>

      <p><strong>Visualization simplicity.</strong> Most argument visualization tools
        (Argdown, Kialo, Dialectica) hide S-nodes from users because the bipartite
        indirection makes graphs harder to read. Our diagnostics panel displays
        I-nodes directly with their attack/support relationships — adding
        intermediate S-nodes would double the visual elements without improving
        comprehension.</p>

      <p><strong>Extraction architecture.</strong> Claims are extracted by an independent
        "analyst" AI call, separate from the debater that produced the statement.
        This separation matters: the debater knows what it intended to argue, but
        self-assessment is biased (debaters overclaim the strength of their own
        attacks). The independent extractor provides a second opinion on relationship
        types. A bipartite graph would not change this architecture but would make
        the extractor's job harder.</p>

      <h4 style={{ color: '#f59e0b', fontSize: '0.8rem' }}>What we preserve from AIF</h4>
      <table style={{ fontSize: '0.75rem', borderCollapse: 'collapse', width: '100%', marginBottom: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>AIF Concept</th>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>How We Implement It</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style={{ padding: '3px 8px' }}>I-nodes (claims)</td><td>AN-1, AN-2, ... in argument_network.nodes</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>CA-nodes (conflict)</td><td>attack_type (rebut/undercut/undermine) on edges</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>RA-nodes (inference)</td><td>warrant + scheme on support edges</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>PA-nodes (preference)</td><td>Synthesis preferences (prevails, criterion, rationale)</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>Schemes</td><td>COUNTEREXAMPLE, DISTINGUISH, etc. on edges</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>Commitment stores</td><td>Per-debater asserted/conceded/challenged</td></tr>
          <tr><td style={{ padding: '3px 8px' }}>Locutions</td><td>Transcript entry types (statement, question, probing)</td></tr>
        </tbody>
      </table>

      <p>
        The guiding principle is <strong>vocabulary over formalism</strong>: use AIF's
        analytical distinctions to improve debate quality and transparency, but keep
        the data in simple JSON structures that LLMs can reliably produce and the UI
        can directly render. If external AIF tool interoperability becomes a
        requirement, a bipartite export layer can be added without changing the
        internal representation.
      </p>

      <h3 style={{ color: '#f59e0b' }}>Methods and Algorithms</h3>
      <p>
        The debate engine uses a <strong>neural-symbolic architecture</strong>: LLMs generate
        content and make soft judgments while symbolic components (QBAF propagation, BFS graph
        traversal, deterministic validation, move-edge classification) provide structure,
        verification, and explanation.
      </p>
      <p>Key algorithms and methods:</p>
      <ul>
        <li><strong>QBAF (Quantitative Bipolar Argumentation Frameworks)</strong> — DF-QuAD gradual
          semantics propagate argument strength through attack/support networks. BDI-aware base
          score calibration handles the asymmetry between empirical and normative claims.</li>
        <li><strong>FIRE (Confidence-gated Iterative Extraction)</strong> — Replaces single-shot
          claim extraction with per-claim confidence assessment and iterative refinement.
          Addresses specificity collapse, warrant deficit, and claim clustering.</li>
        <li><strong>4-Stage Turn Pipeline (BRIEF → PLAN → DRAFT → CITE)</strong> — Each turn is
          decomposed into four stages with per-stage temperatures and deterministic JSON
          chaining between stages.</li>
        <li><strong>Adaptive Staging</strong> — Seven convergence diagnostics (computed
          deterministically from the argument network) track debate health and trigger
          phase transitions (thesis-antithesis → exploration → synthesis).</li>
        <li><strong>Dialectic Traces</strong> — Deterministic BFS traversal through the argument
          network produces human-readable narrative chains explaining why a position prevailed.</li>
        <li><strong>13-Scheme Taxonomy</strong> — Derived from Walton's argumentation schemes,
          each with scheme-specific critical questions that guide moderator steering.</li>
        <li><strong>14-Move Moderator Intervention</strong> — Six families (procedural through
          synthesis) governed by a neural-symbolic trigger architecture: the LLM recommends,
          the engine validates against deterministic constraints.</li>
      </ul>
      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        Full methodology: see <code>docs/academic-paper-draft.md</code> in the project repository
        for the complete technical paper describing all algorithms, evaluation results, and
        theoretical grounding. Additional detail in <code>docs/debate-engine-design.md</code>,{' '}
        <code>docs/document-processing-pipeline.md</code>, and <code>docs/design/adaptive-debate-staging.md</code>.
      </p>

      <h3 style={{ color: '#f59e0b' }}>Per-Entry Diagnostics</h3>
      <p>
        Click any transcript entry to see its internals: the full prompt sent to the AI,
        the raw response, which claims were extracted (with validation scores), the taxonomy
        context injected, and what commitments were active at that point.
      </p>
    </div>
  );
}

/** Highlight search matches within text. Uses DiagSearchContext if query not provided. */
function Highlight({ text, query: queryProp }: { text: string; query?: string }) {
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

function SearchBar({ query, setQuery, matchCount, inputRef }: { query: string; setQuery: (q: string) => void; matchCount: number; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [domCount, setDomCount] = useState(0);

  // Reset index when query changes
  useEffect(() => { setCurrentIdx(0); }, [query]);

  // After React commits, count marks and highlight the current one
  useEffect(() => {
    if (!query) { setDomCount(0); return; }
    const raf = requestAnimationFrame(() => {
      const marks = document.querySelectorAll('mark[data-search-match]');
      setDomCount(marks.length);
      // Reset all to default yellow
      marks.forEach(m => {
        (m as HTMLElement).style.background = '#f59e0b';
        (m as HTMLElement).classList.remove('search-active-match');
      });
      // Highlight and scroll to current
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

/** Count occurrences of query in text (case-insensitive) */
function countMatches(text: string, query: string): number {
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

function ResizablePre({ text, tall = false }: { text: string; tall?: boolean }) {
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

interface ModeratorTraceData {
  selected?: string; focus_point?: string; selection_reason?: string;
  excluded_last_speaker?: string | null; recent_scheme?: string | null;
  convergence_score?: number | null; convergence_triggered?: boolean;
  candidates?: { debater: string; computed_strength: number | null; claim_count?: number; scored_count?: number; rank: number }[];
  commitment_snapshot?: Record<string, { asserted: number; conceded: number; challenged: number }>;
  selection_prompt?: string; selection_response?: string;
  // Active moderator fields
  health_score?: number; health_components?: Record<string, number>; health_trend?: number;
  intervention_recommended?: boolean; intervention_move?: string | null;
  intervention_validated?: boolean; intervention_suppressed_reason?: string | null;
  intervention_target?: string | null;
  trigger_reasoning?: string | null; trigger_evidence?: Record<string, unknown> | null;
  budget_remaining?: number; budget_total?: number;
  cooldown_rounds_left?: number; burden_per_debater?: Record<string, number>;
}

const DEBATER_COLORS: Record<string, string> = {
  prometheus: '#f97316', sentinel: '#3b82f6', cassandra: '#a855f7',
};
function debaterColor(name: string): string {
  return DEBATER_COLORS[name.toLowerCase()] ?? '#888';
}

function TensionsListDetail({ content }: { content: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [rationaleExpanded, setRationaleExpanded] = useState(false);

  const { accelerationist, safetyist, skeptic, edgesFile } = useTaxonomyStore();

  const nodeLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const pov of [accelerationist, safetyist, skeptic]) {
      if (!pov?.nodes) continue;
      for (const n of pov.nodes) map.set(n.id, n.label);
    }
    return map;
  }, [accelerationist, safetyist, skeptic]);

  const edgeRationale = useMemo(() => {
    const map = new Map<string, string>();
    if (!edgesFile?.edges) return map;
    for (const e of edgesFile.edges) {
      map.set(`${e.source}|${e.target}|${e.type}`, e.rationale);
      if (e.bidirectional) map.set(`${e.target}|${e.source}|${e.type}`, e.rationale);
    }
    return map;
  }, [edgesFile]);

  const tensions = useMemo(() => {
    const re = /^(\S+)\s+(TENSION_WITH|CONTRADICTS|SUPPORTS)\s+(\S+)\s+\(confidence:\s*([\d.]+)\)/gm;
    const items: { source: string; relation: string; target: string; confidence: number; raw: string }[] = [];
    let m;
    while ((m = re.exec(content)) !== null) {
      items.push({ source: m[1], relation: m[2], target: m[3], confidence: parseFloat(m[4]), raw: m[0] });
    }
    return items;
  }, [content]);

  if (tensions.length === 0) {
    return <pre style={{ fontSize: '0.68rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflow: 'auto', margin: '4px 0 8px', padding: '6px 8px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>{content}</pre>;
  }

  const sel = selected != null ? tensions[selected] : null;
  const relationColor = (r: string) => r === 'CONTRADICTS' ? '#ef4444' : r === 'TENSION_WITH' ? '#f59e0b' : '#22c55e';
  const relationIcon = (r: string) => r === 'TENSION_WITH' ? '⟷' : r === 'CONTRADICTS' ? '✕' : '✓';
  const sourcePov = (id: string) => id.startsWith('acc-') ? 'acc' : id.startsWith('saf-') ? 'saf' : id.startsWith('skp-') ? 'skp' : id.startsWith('cc-') ? 'cc' : '';
  const povColor = (id: string) => {
    const p = sourcePov(id);
    return p === 'acc' ? '#f97316' : p === 'saf' ? '#3b82f6' : p === 'skp' ? '#a855f7' : p === 'cc' ? '#22c55e' : '#888';
  };

  const selRationale = sel ? edgeRationale.get(`${sel.source}|${sel.target}|${sel.relation}`) : undefined;
  const RATIONALE_TRUNCATE = 200;

  return (
    <div style={{ display: 'flex', gap: 8, margin: '4px 0 8px' }}>
      <div style={{ flex: '1 1 45%', maxHeight: 340, overflow: 'auto', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
        {tensions.map((t, i) => (
          <div key={i} onClick={() => { setSelected(i); setRationaleExpanded(false); }} style={{
            padding: '4px 8px', cursor: 'pointer', fontSize: '0.66rem',
            background: selected === i ? 'rgba(249,115,22,0.12)' : 'transparent',
            borderLeft: selected === i ? '3px solid #f97316' : '3px solid transparent',
            borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ color: povColor(t.source), fontWeight: 600 }}>{t.source}</span>
            <span style={{ color: relationColor(t.relation), fontSize: '0.58rem', fontWeight: 700, margin: '0 4px' }}>
              {relationIcon(t.relation)}
            </span>
            <span style={{ color: povColor(t.target), fontWeight: 600 }}>{t.target}</span>
            <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: '0.58rem' }}>{t.confidence.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: '1 1 55%', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-primary)', fontSize: '0.7rem', minHeight: 80, overflow: 'auto' }}>
        {sel ? (
          <>
            {/* Header: relation badge + arrow icon */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
              <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 4, background: `${relationColor(sel.relation)}18`, color: relationColor(sel.relation), fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase' }}>
                {sel.relation.replace(/_/g, ' ')}
              </span>
              <span style={{ marginLeft: 8, color: relationColor(sel.relation), fontSize: '0.8rem' }}>
                {relationIcon(sel.relation)}
              </span>
            </div>

            {/* Source ←→ Target side-by-side */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 12px 8px', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.6rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: 2 }}>Source</div>
                <div style={{ fontWeight: 600, color: povColor(sel.source), fontSize: '0.78rem', lineHeight: 1.3 }}>
                  {nodeLabel.get(sel.source) || sel.source}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 2 }}>{sel.source}</div>
              </div>
              <div style={{ color: relationColor(sel.relation), fontSize: '1rem', fontWeight: 700, flexShrink: 0, padding: '0 4px' }}>
                {relationIcon(sel.relation)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.6rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: 2 }}>Target</div>
                <div style={{ fontWeight: 600, color: povColor(sel.target), fontSize: '0.78rem', lineHeight: 1.3 }}>
                  {nodeLabel.get(sel.target) || sel.target}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 2 }}>{sel.target}</div>
              </div>
            </div>

            {/* Rationale */}
            {selRationale && (
              <div style={{ padding: '8px 12px 12px' }}>
                <div style={{ fontSize: '0.6rem', color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, marginBottom: 6 }}>Rationale</div>
                <div style={{ borderLeft: '3px solid #3b82f6', paddingLeft: 10, fontSize: '0.72rem', color: 'var(--text-primary)', lineHeight: 1.5, background: 'var(--bg-secondary)', borderRadius: '0 4px 4px 0', padding: '8px 10px 8px 12px' }}>
                  {!rationaleExpanded && selRationale.length > RATIONALE_TRUNCATE
                    ? selRationale.slice(0, RATIONALE_TRUNCATE) + '...'
                    : selRationale}
                </div>
                {selRationale.length > RATIONALE_TRUNCATE && (
                  <div
                    onClick={() => setRationaleExpanded(!rationaleExpanded)}
                    style={{ fontSize: '0.62rem', color: '#3b82f6', cursor: 'pointer', marginTop: 4 }}
                  >
                    {rationaleExpanded ? 'Show less' : 'Show more'}
                  </div>
                )}
              </div>
            )}

            {/* Confidence footer */}
            <div style={{ padding: '4px 12px 8px', fontSize: '0.62rem', color: 'var(--text-muted)' }}>
              Confidence: {sel.confidence.toFixed(2)}
            </div>
          </>
        ) : (
          <div style={{ padding: '8px 10px', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.65rem' }}>Select a tension to see details</div>
        )}
      </div>
    </div>
  );
}

function DebateExchangeRich({ content }: { content: string }) {
  const segments = useMemo(() => {
    const speakerRe = /^(Prometheus|Sentinel|Cassandra)\s*(\[[^\]]*\])?:\s*/gm;
    const matches: { index: number; end: number; speaker: string; tag?: string }[] = [];
    let m;
    while ((m = speakerRe.exec(content)) !== null) {
      matches.push({ index: m.index, end: m.index + m[0].length, speaker: m[1], tag: m[2]?.replace(/[[\]]/g, '') });
    }
    if (matches.length === 0) return [{ text: content } as { speaker?: string; tag?: string; text: string }];
    const parts: { speaker?: string; tag?: string; text: string }[] = [];
    if (matches[0].index > 0) {
      const preamble = content.slice(0, matches[0].index).trim();
      if (preamble) parts.push({ text: preamble });
    }
    for (let i = 0; i < matches.length; i++) {
      const textEnd = i + 1 < matches.length ? matches[i + 1].index : content.length;
      parts.push({ speaker: matches[i].speaker, tag: matches[i].tag, text: content.slice(matches[i].end, textEnd).trim() });
    }
    return parts;
  }, [content]);

  if (segments.length <= 1 && !segments[0]?.speaker) {
    return <pre style={{ fontSize: '0.68rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflow: 'auto', margin: '4px 0 8px', padding: '6px 8px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>{content}</pre>;
  }

  return (
    <div style={{ maxHeight: 300, overflow: 'auto', margin: '4px 0 8px', padding: '6px 8px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>
      {segments.map((seg, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          {seg.speaker && (
            <div style={{ marginBottom: 3 }}>
              <span style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontSize: '0.72rem',
                color: '#fff', background: debaterColor(seg.speaker),
              }}>
                {seg.speaker}
              </span>
              {seg.tag && (
                <span style={{ marginLeft: 6, fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{seg.tag}</span>
              )}
            </div>
          )}
          <div style={{ fontSize: '0.68rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-primary)', lineHeight: 1.45 }}>
            {seg.text}
          </div>
        </div>
      ))}
    </div>
  );
}

function ModeratorTab({ trace }: { trace: ModeratorTraceData }) {
  const sectionStyle: React.CSSProperties = { marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border)' };
  const headingStyle: React.CSSProperties = { fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#f97316', marginBottom: 6 };

  // Parse the selection prompt into labeled sections
  const promptSections = useMemo(() => {
    if (!trace.selection_prompt) return [];
    const sections: { title: string; content: string }[] = [];
    const text = trace.selection_prompt;

    // Split on markdown-style headings (=== or ##)
    const headingRe = /(?:^|\n)(?:={3,}\s*(.+?)\s*={3,}|##\s*(.+?))\s*\n/g;
    let lastIdx = 0;
    let lastTitle = 'System Prompt';
    let match;
    while ((match = headingRe.exec(text)) !== null) {
      const preceding = text.slice(lastIdx, match.index).trim();
      if (preceding) sections.push({ title: lastTitle, content: preceding });
      lastTitle = (match[1] || match[2]).replace(/\s*\(.*?\)\s*$/, '');
      lastIdx = match.index + match[0].length;
    }
    const remaining = text.slice(lastIdx).trim();
    if (remaining) sections.push({ title: lastTitle, content: remaining });
    return sections;
  }, [trace.selection_prompt]);

  return (
    <>
      {/* Decision summary */}
      <div style={sectionStyle}>
        <div style={headingStyle}>Decision</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.75rem', alignItems: 'center' }}>
          {trace.selected && (
            <div><strong>Selected:</strong> <span style={{ color: '#f97316', fontWeight: 700 }}>{trace.selected}</span></div>
          )}
          {trace.selection_reason && (
            <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(249,115,22,0.15)', color: '#f97316', fontSize: '0.62rem', fontWeight: 600 }}>
              {trace.selection_reason.replace(/_/g, ' ')}
            </span>
          )}
          {trace.excluded_last_speaker && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>excluded: {trace.excluded_last_speaker}</div>
          )}
        </div>
        {trace.focus_point && (
          <div style={{ marginTop: 6, fontSize: '0.75rem' }}>
            <strong>Focus:</strong> {trace.focus_point}
          </div>
        )}
      </div>

      {/* Candidates */}
      {trace.candidates && trace.candidates.length > 0 && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Candidate Ranking</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {trace.candidates.map((c, i) => (
              <div key={i} style={{
                padding: '6px 10px', borderRadius: 6, fontSize: '0.72rem',
                background: c.debater === trace.selected ? 'rgba(249,115,22,0.12)' : 'transparent',
                border: `1px solid ${c.debater === trace.selected ? '#f97316' : 'var(--border)'}`,
                fontWeight: c.debater === trace.selected ? 700 : 400,
              }}>
                <div>#{c.rank} {c.debater}</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {c.claim_count != null && <span>{c.claim_count} claim{c.claim_count !== 1 ? 's' : ''} in AN</span>}
                  {c.computed_strength != null && (
                    <span
                      title="QBAF post-propagation acceptability: average computed strength across this debater's claims after attack/support edges are applied. Higher = arguments are holding up well under challenge."
                      style={{ marginLeft: 6, cursor: 'help', borderBottom: '1px dotted var(--text-muted)' }}
                    >
                      QBAF: {c.computed_strength.toFixed(3)} ({c.scored_count ?? '?'} scored)
                    </span>
                  )}
                  {c.computed_strength == null && (c.claim_count ?? 0) > 0 && (
                    <span
                      title="QBAF strength propagation has not run yet. Strengths will appear after the debate engine computes post-propagation acceptability scores."
                      style={{ marginLeft: 6, fontStyle: 'italic', cursor: 'help' }}
                    >
                      (no QBAF scores yet)
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Convergence + Commitments */}
      {(trace.convergence_score != null || trace.commitment_snapshot) && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Debate State</div>
          {trace.convergence_score != null && (
            <div style={{ fontSize: '0.72rem', marginBottom: 4 }}>
              <strong
                title={'Convergence measures how much the debaters are moving toward agreement on the current issue.\n\nThree weighted signals:\n• Cross-speaker support ratio (40%): Of all cross-speaker edges in the argument network, what fraction are supports vs. attacks? More support edges = higher convergence.\n• Concession rate (35%): How many claims on this issue have been conceded? More concessions = debaters yielding ground.\n• Stance alignment (25%): How many speaker pairs have at least one mutual support edge? Measures breadth of agreement across all participants.\n\nScore range: 0% (pure opposition) → 50% (baseline/unknown) → 100% (full agreement).\nWhen convergence exceeds the threshold, the moderator may suggest exploring a new topic.'}
                style={{ cursor: 'help', borderBottom: '1px dotted var(--text-muted)' }}
              >Convergence:</strong> {(trace.convergence_score * 100).toFixed(0)}%
              {trace.convergence_triggered && <span style={{ color: '#22c55e', marginLeft: 6, fontWeight: 700 }}>TRIGGERED</span>}
            </div>
          )}
          {trace.commitment_snapshot && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.7rem' }}>
              {Object.entries(trace.commitment_snapshot).map(([name, c]) => (
                <div key={name} style={{ padding: '4px 8px', borderRadius: 4, background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{name}</div>
                  <div style={{ display: 'flex', gap: 8, fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                    <span>{c.asserted} asserted</span>
                    <span>{c.conceded} conceded</span>
                    <span>{c.challenged} challenged</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active Moderator State */}
      {(trace.health_score != null || trace.intervention_recommended || trace.budget_remaining != null) && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Active Moderator</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.72rem', marginBottom: 6 }}>
            {trace.health_score != null && (
              <div>
                <strong
                  title={'Composite debate health score (0.0–1.0). Weighted average of 5 components:\n• Engagement ×0.25 — are debaters substantively engaging with each other\'s claims?\n• Novelty ×0.25 — are debaters introducing new ideas rather than recycling?\n• Responsiveness ×0.20 — are debaters taking concession opportunities when warranted?\n• Coverage ×0.15 — what fraction of relevant taxonomy nodes have been cited?\n• Balance ×0.15 — are all debaters getting roughly equal speaking time?\n\nComputed over a sliding window of the last 3 convergence signals.\nGreen (≥0.70): healthy debate. Amber (0.40–0.69): degrading. Red (<0.40): intervention likely needed.\nWhen a component drops below its SLI floor for 2+ consecutive turns, the moderator auto-triggers an intervention.'}
                  style={{ cursor: 'help', borderBottom: '1px dotted var(--text-muted)' }}
                >Health:</strong>{' '}
                <span style={{ color: trace.health_score >= 0.7 ? '#22c55e' : trace.health_score >= 0.4 ? '#f59e0b' : '#ef4444', fontWeight: 700 }}>
                  {trace.health_score.toFixed(2)}
                </span>
              </div>
            )}
            {trace.budget_remaining != null && trace.budget_total != null && (
              <div>
                <strong
                  title={'Intervention budget — how many moderator interventions remain.\n\nBudget = ceil(exploration_rounds / 2.5). For a 20-round debate with ~17 exploration rounds, budget ≈ 7.\nEach intervention (except COMMIT) consumes 1 budget unit.\nWhen budget reaches 0, no further interventions can fire (except off-budget COMMIT moves in synthesis phase).\nThis prevents the moderator from over-intervening and dominating the debate.'}
                  style={{ cursor: 'help', borderBottom: '1px dotted var(--text-muted)' }}
                >Budget:</strong> {trace.budget_remaining}/{trace.budget_total}
              </div>
            )}
            {trace.cooldown_rounds_left != null && (
              <div>
                <strong
                  title={'Cooldown — minimum rounds that must pass before the next intervention.\n\nAfter an intervention fires, the moderator enforces a 1-round gap before acting again.\nExempt from cooldown: Reconciliation (ACKNOWLEDGE, REVOICE), Elicitation (PIN, PROBE, CHALLENGE), and COMMIT.\n\n"ready" = cooldown expired, moderator can intervene if triggered.\n"N round(s)" = must wait N more rounds before the next intervention.'}
                  style={{ cursor: 'help', borderBottom: '1px dotted var(--text-muted)' }}
                >Cooldown:</strong> {trace.cooldown_rounds_left > 0 ? `${trace.cooldown_rounds_left} round(s)` : 'ready'}
              </div>
            )}
          </div>
          {trace.health_components && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: '0.62rem', marginBottom: 6 }}>
              {Object.entries(trace.health_components).map(([k, v]) => {
                const tooltips: Record<string, string> = {
                  engagement: 'Engagement (weight: 0.25, SLI floor: 0.25)\n\nMeasures how substantively debaters engage with each other\'s claims.\nComputed as the average engagement_depth.ratio from the last 3 convergence signals.\nengagement_depth.ratio = fraction of prior claims that were directly addressed.\n\nLow engagement means debaters are talking past each other — triggers elicitation interventions (PIN, PROBE, CHALLENGE).',
                  novelty: 'Novelty (weight: 0.25, SLI floor: 0.25)\n\nMeasures whether debaters are introducing new ideas vs. recycling old arguments.\nComputed as: 1 − avg(recycling_rate.avg_self_overlap) over the last 3 signals.\navg_self_overlap compares each statement to the speaker\'s own prior statements via cosine similarity.\n\nLow novelty means the debate is going in circles — triggers elicitation interventions.',
                  responsiveness: 'Responsiveness (weight: 0.20, SLI floor: 0.15)\n\nMeasures whether debaters take concession opportunities when warranted.\nComputed from convergence signals: of turns where a concession opportunity existed, what fraction were "taken" vs. "missed"?\nIf no concession opportunities arose, defaults to 1.0 (no penalty).\n\nLow responsiveness means debaters are ignoring valid challenges — triggers elicitation interventions.',
                  coverage: 'Coverage (weight: 0.15, SLI floor: 0.20)\n\nMeasures what fraction of relevant taxonomy nodes have been cited in the debate.\nComputed as: min(cited_node_count / relevant_node_count, 1.0).\nIf no relevant nodes exist, defaults to 1.0.\n\nLow coverage means the debate is ignoring important perspectives from the taxonomy — triggers procedural interventions (REDIRECT, BALANCE, SEQUENCE).',
                  balance: 'Balance (weight: 0.15, SLI floor: 0.30)\n\nMeasures whether all debaters are getting roughly equal speaking time.\nComputed as: 1 − (max_turns − min_turns) / total_turns.\n1.0 = perfectly balanced; 0.0 = one debater completely dominated.\n\nLow balance means one debater is being sidelined — triggers procedural interventions (BALANCE, REDIRECT).',
                };
                return (
                  <span key={k} title={tooltips[k] || k} style={{ padding: '1px 5px', borderRadius: 3, background: 'var(--bg-primary)', border: '1px solid var(--border)', cursor: 'help' }}>
                    {k}: {(v as number).toFixed(2)}
                  </span>
                );
              })}
            </div>
          )}
          {trace.burden_per_debater && Object.keys(trace.burden_per_debater).length > 0 && (
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 6 }}>
              <strong
                title={'Burden — cumulative intervention load per debater.\n\nEach intervention adds a burden weight based on its family:\n• Elicitation (PIN, PROBE, CHALLENGE): 1.0 — most disruptive\n• Synthesis (COMPRESS, COMMIT): 0.8\n• Repair (CLARIFY, CHECK, SUMMARIZE): 0.75\n• Reflection (META-REFLECT): 0.6\n• Procedural (REDIRECT, BALANCE, SEQUENCE): 0.5\n• Reconciliation (ACKNOWLEDGE, REVOICE): 0.25 — least disruptive\n\nBurden cap: if a debater\'s burden exceeds 1.5× the average burden, high-burden moves (weight > 0.5) against that debater are suppressed.\nThis prevents the moderator from repeatedly targeting the same debater.'}
                style={{ cursor: 'help', borderBottom: '1px dotted var(--text-muted)' }}
              >Burden:</strong>{' '}
              {Object.entries(trace.burden_per_debater).map(([d, b]) => `${d}: ${(b as number).toFixed(2)}`).join(', ')}
            </div>
          )}
          {trace.intervention_recommended && (
            <div style={{ marginTop: 4, padding: '6px 8px', borderRadius: 4, background: trace.intervention_validated ? 'rgba(139,92,246,0.1)' : 'rgba(239,68,68,0.08)', border: `1px solid ${trace.intervention_validated ? '#8b5cf6' : '#ef4444'}` }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: trace.intervention_validated ? '#8b5cf6' : '#ef4444' }}>
                {trace.intervention_validated ? 'Intervention Fired' : 'Intervention Suppressed'}
                {trace.intervention_move && `: ${trace.intervention_move}`}
                {trace.intervention_target && ` → ${trace.intervention_target}`}
              </div>
              {trace.intervention_suppressed_reason && !trace.intervention_validated && (
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Reason: {trace.intervention_suppressed_reason.replace(/_/g, ' ')}
                </div>
              )}
              {trace.trigger_reasoning && (
                <div style={{ fontSize: '0.65rem', marginTop: 4 }}>
                  <strong>Trigger:</strong> {trace.trigger_reasoning}
                </div>
              )}
              {trace.trigger_evidence && (
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Signal: {String((trace.trigger_evidence as Record<string, unknown>).signal_name ?? 'unknown')}
                  {!!(trace.trigger_evidence as Record<string, unknown>).observed_behavior && (
                    <span> — {String((trace.trigger_evidence as Record<string, unknown>).observed_behavior)}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Selection prompt sections */}
      {promptSections.length > 0 && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Context Sent to Moderator</div>
          {promptSections.map((s, i) => {
            const isTensions = /KNOWN TENSIONS/i.test(s.title);
            const isExchange = /RECENT DEBATE EXCHANGE/i.test(s.title);
            return (
              <details key={i} style={{ marginBottom: 4 }} open={i < 2}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', color: 'var(--text-primary)', padding: '3px 0' }}>
                  {s.title}
                  <span style={{ marginLeft: 6, fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                    {s.content.length > 500 ? `${(s.content.length / 1024).toFixed(1)}KB` : `${s.content.length} chars`}
                  </span>
                </summary>
                {isTensions ? <TensionsListDetail content={s.content} />
                  : isExchange ? <DebateExchangeRich content={s.content} />
                  : <pre style={{ fontSize: '0.68rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflow: 'auto', margin: '4px 0 8px', padding: '6px 8px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>{s.content}</pre>
                }
              </details>
            );
          })}
        </div>
      )}

      {/* Raw AI response */}
      {trace.selection_response && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Moderator Response</div>
          <pre style={{ fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto', margin: 0, padding: '6px 8px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>
            {trace.selection_response}
          </pre>
        </div>
      )}
    </>
  );
}

function subScoreTip(key: string, val: number): string {
  const band = val >= 0.7 ? 'Strong' : val >= 0.4 ? 'Moderate' : 'Weak';
  const base: Record<string, string> = {
    evidence_quality: `Evidence Quality: ${val.toFixed(2)} (${band})\n\nHow well-supported is this claim by cited evidence?\n\nScoring: AI assigns 0.5 for all Belief claims (human adjusts later via slider). Beliefs have low AI reliability (Q-0 calibration r = -0.12 to 0.20).\n≥0.7 = strong evidence cited\n0.4–0.69 = partial or indirect evidence\n<0.4 = unsupported or speculative`,
    source_reliability: `Source Reliability: ${val.toFixed(2)} (${band})\n\nHow credible and authoritative are the sources cited?\n\nScoring: AI assigns 0.5 for all Belief claims (human adjusts later via slider). Beliefs have low AI reliability (Q-0 calibration r = -0.12 to 0.20).\n≥0.7 = authoritative, peer-reviewed, or official sources\n0.4–0.69 = mixed or secondary sources\n<0.4 = no sources or unreliable ones`,
    falsifiability: `Falsifiability: ${val.toFixed(2)} (${band})\n\nCan this claim be tested or disproven with observable evidence?\n\nScoring: AI assigns 0.5 for all Belief claims (human adjusts later via slider). Beliefs have low AI reliability (Q-0 calibration r = -0.12 to 0.20).\n≥0.7 = clearly testable with specific criteria\n0.4–0.69 = partially testable\n<0.4 = unfalsifiable or purely theoretical`,
    values_grounding: `Values Grounding: ${val.toFixed(2)} (${band})\n\nIs this value claim explicitly grounded in stated values or principles?\n\nScoring: AI rates 0–1 independently for Desire claims (Q-0 calibration r = 0.65). base_strength = average of all 3 Desire sub-scores.\n≥0.7 = explicitly ties to named values, ethical frameworks, or stated principles\n0.4–0.69 = implicitly value-laden but not explicitly grounded\n<0.4 = value claim without clear normative basis`,
    tradeoff_acknowledgment: `Tradeoff Acknowledgment: ${val.toFixed(2)} (${band})\n\nDoes the claim acknowledge competing tradeoffs or costs?\n\nScoring: AI rates 0–1 independently for Desire claims (Q-0 calibration r = 0.65). base_strength = average of all 3 Desire sub-scores.\n≥0.7 = explicitly names costs, risks, or competing values\n0.4–0.69 = mentions tradeoffs in passing\n<0.4 = presents the position as cost-free or ignores downsides`,
    precedent_citation: `Precedent Citation: ${val.toFixed(2)} (${band})\n\nDoes the claim cite relevant precedent, norms, or established practice?\n\nScoring: AI rates 0–1 independently for Desire claims (Q-0 calibration r = 0.65). base_strength = average of all 3 Desire sub-scores.\n≥0.7 = cites specific precedents, case law, or established norms\n0.4–0.69 = references general precedent without specifics\n<0.4 = no precedent cited, purely aspirational`,
    mechanism_specificity: `Mechanism Specificity: ${val.toFixed(2)} (${band})\n\nHow specific is the proposed mechanism, action, or implementation path?\n\nScoring: AI rates 0–1 independently for Intention claims (Q-0 calibration r = 0.71). base_strength = average of all 3 Intention sub-scores.\n≥0.7 = concrete steps, named actors, defined timelines\n0.4–0.69 = general approach without implementation detail\n<0.4 = vague aspiration with no actionable mechanism`,
    scope_bounding: `Scope Bounding: ${val.toFixed(2)} (${band})\n\nAre the boundaries, limitations, and applicability conditions defined?\n\nScoring: AI rates 0–1 independently for Intention claims (Q-0 calibration r = 0.71). base_strength = average of all 3 Intention sub-scores.\n≥0.7 = explicitly defines where the proposal applies and where it doesn't\n0.4–0.69 = some boundaries mentioned but incomplete\n<0.4 = unbounded claim with no defined limits`,
    failure_mode_addressing: `Failure Mode Addressing: ${val.toFixed(2)} (${band})\n\nDoes the claim address what could go wrong or how failures would be handled?\n\nScoring: AI rates 0–1 independently for Intention claims (Q-0 calibration r = 0.71). base_strength = average of all 3 Intention sub-scores.\n≥0.7 = explicitly names failure scenarios and mitigations\n0.4–0.69 = acknowledges risk without specific mitigation\n<0.4 = no consideration of failure modes`,
  };
  return base[key] || key;
}

const SUB_SCORE_TIPS: Record<string, string> = {
  evidence_quality: 'How well-supported is this claim by cited evidence?',
  source_reliability: 'How credible and authoritative are the sources cited?',
  falsifiability: 'Can this claim be tested or disproven with observable evidence?',
  values_grounding: 'Is this value claim explicitly grounded in stated values or principles?',
  tradeoff_acknowledgment: 'Does the claim acknowledge competing tradeoffs or costs?',
  precedent_citation: 'Does the claim cite relevant precedent, norms, or established practice?',
  mechanism_specificity: 'How specific is the proposed mechanism, action, or implementation path?',
  scope_bounding: 'Are the boundaries, limitations, and applicability conditions defined?',
  failure_mode_addressing: 'Does it address what could go wrong or how failures would be handled?',
};

const BELIEF_KEYS = new Set(['evidence_quality', 'source_reliability', 'falsifiability']);

function SubScoreRow({ node, onUpdateSubScore }: { node: ArgumentNetworkNode; onUpdateSubScore: (nodeId: string, key: string, value: number) => void }) {
  if (!node.bdi_sub_scores) return null;
  const isBelief = node.bdi_category === 'belief';

  return (
    <div style={{ paddingLeft: 18, marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {Object.entries(node.bdi_sub_scores).filter(([, v]) => v != null).map(([key, val]) => {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const v = val as number;
        const c = v >= 0.7 ? '#22c55e' : v >= 0.4 ? '#f59e0b' : '#ef4444';
        const editable = isBelief && BELIEF_KEYS.has(key);

        if (!editable) {
          return (
            <span key={key} title={subScoreTip(key, v)} style={{ fontSize: '0.58rem', padding: '1px 5px', borderRadius: 3, background: `${c}15`, color: c, fontWeight: 600, cursor: 'help' }}>
              {label}: {v.toFixed(2)}
            </span>
          );
        }

        return (
          <span key={key} title={subScoreTip(key, v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.58rem', fontWeight: 600 }}>
            <span style={{ color: c }}>{label}:</span>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={v}
              onChange={(e) => onUpdateSubScore(node.id, key, parseFloat(e.target.value))}
              style={{ width: 48, height: 10, accentColor: c, cursor: 'pointer' }}
            />
            <span style={{ color: c, minWidth: 26 }}>{v.toFixed(2)}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Expandable I-node row — edges + warrants always visible, expand shows debater attribution + claim text */
const ATTACK_TYPE_WEIGHTS: Record<string, number> = { rebut: 1.0, undercut: 1.1, undermine: 1.2 };

function INodeRow({ node, attacks, supports, allNodes, isSource, computedStrength, statementId, strengthMap, onGotoEntry, stmtIdByEntry, focused, onUpdateSubScore }: {
  node: ArgumentNetworkNode;
  attacks: ArgumentNetworkEdge[];
  supports: ArgumentNetworkEdge[];
  allNodes: ArgumentNetworkNode[];
  isSource: boolean;
  computedStrength?: number;
  statementId?: string;
  strengthMap?: Map<string, number>;
  onGotoEntry?: (entryId: string) => void;
  stmtIdByEntry?: Map<string, string>;
  focused?: boolean;
  onUpdateSubScore: (nodeId: string, key: string, value: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const responded = attacks.length > 0 || supports.length > 0;
  const hasChildren = attacks.length > 0 || supports.length > 0;
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focused]);

  return (
    <div ref={rowRef} style={{ margin: '6px 0', paddingBottom: 6, borderBottom: '1px solid var(--border)', outline: focused ? '2px solid #f59e0b' : 'none', borderRadius: focused ? 4 : 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: '0.7rem', lineHeight: 1, marginTop: 2, flexShrink: 0 }}
          >
            {expanded ? '\u25BC' : '\u25B6'}
          </button>
        ) : (
          <span style={{ width: 10, flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <strong title={`Argument Network node ${node.id.replace('AN-', '')}${statementId ? `, extracted from debate statement ${statementId}` : ''}`} style={{ color: 'var(--accent)', fontSize: '0.7rem' }}><Highlight text={node.id} /></strong>
          {statementId && (
            <span
              title={`Claim extracted from debate turn ${statementId} by ${speakerLabel(node.speaker)}${onGotoEntry ? ' — click to go to statement' : ''}`}
              onClick={onGotoEntry && node.source_entry_id ? (e) => { e.stopPropagation(); onGotoEntry(node.source_entry_id); } : undefined}
              style={{
                fontSize: '0.7rem',
                cursor: onGotoEntry && node.source_entry_id ? 'pointer' : 'default',
                textDecoration: onGotoEntry && node.source_entry_id ? 'underline' : 'none',
              }}
            >{statementId}</span>
          )}
          {(() => {
            const label = speakerLabel(node.speaker);
            const desc: Record<string, string> = {
              Prometheus: 'Prometheus — accelerationist, advocates rapid AI development',
              Sentinel: 'Sentinel — safetyist, prioritizes AI safety and alignment',
              Cassandra: 'Cassandra — skeptic, questions assumptions from all sides',
              Moderator: 'Moderator — neutral facilitator',
            };
            return <span title={desc[label] ?? label} style={{ fontSize: '0.7rem' }}>{label}</span>;
          })()}
          {node.bdi_category && (() => {
            const bdiLabel = node.bdi_category === 'belief' ? 'Belief' : node.bdi_category === 'desire' ? 'Desire' : 'Intention';
            return (
              <span title={`${bdiLabel} (confidence: ${node.bdi_confidence?.toFixed(2) ?? '?'})`} style={{ fontSize: '0.7rem' }}>{bdiLabel}</span>
            );
          })()}
          {!responded && !isSource && <span style={{ color: '#f59e0b', fontSize: '0.7rem' }}>[unaddressed]</span>}
          {(() => {
            const base = node.base_strength ?? 0.5;
            const computed = computedStrength ?? node.computed_strength ?? base;
            const band = computed >= 0.8 ? 'Strong' : computed >= 0.5 ? 'Moderate' : computed >= 0.3 ? 'Weak' : 'Very Weak';
            const bandColor = computed >= 0.8 ? '#22c55e' : computed >= 0.5 ? '#3b82f6' : computed >= 0.3 ? '#f59e0b' : '#ef4444';
            const delta = computed - base;
            return (
              <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${bandColor}22`, color: bandColor }} title={`Strength: ${computed.toFixed(2)} (base: ${base.toFixed(2)}, delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`}>
                {band} {computed.toFixed(2)}
                {Math.abs(delta) > 0.01 && <span style={{ color: delta > 0 ? '#22c55e' : '#ef4444', marginLeft: 3 }}>{delta > 0 ? '+' : ''}{delta.toFixed(2)}</span>}
              </span>
            );
          })()}
          {hasChildren && <span title={`${attacks.length + supports.length} attack/support relationship${attacks.length + supports.length !== 1 ? 's' : ''} connected to this claim`} style={{ color: 'var(--text-muted)', fontSize: '0.7rem', cursor: 'help' }}>{attacks.length + supports.length} edge{attacks.length + supports.length !== 1 ? 's' : ''}</span>}
        </div>
      </div>
      <div style={{ paddingLeft: 18, marginTop: 2 }}><Highlight text={node.text} /></div>
      {node.bdi_sub_scores && <SubScoreRow node={node} onUpdateSubScore={onUpdateSubScore} />}

      {/* Edges — shown when expanded */}
      {hasChildren && expanded && (
        <div style={{ paddingLeft: 18, marginTop: 4 }}>
          {attacks.map(a => {
            const sourceNode = allNodes.find(n => n.id === a.source);
            const srcStr = strengthMap?.get(a.source);
            const atkMult = ATTACK_TYPE_WEIGHTS[a.attack_type ?? 'rebut'] ?? 1.0;
            const hasWeight = a.weight != null;
            const edgeWeight = a.weight ?? 0.5;
            const contribution = srcStr != null ? srcStr * edgeWeight * atkMult : undefined;
            return (
              <div key={a.id} style={{ marginTop: 4, fontSize: '0.7rem', paddingLeft: 8, borderLeft: '2px solid rgba(239,68,68,0.3)' }}>
                <div>
                  <AifBadge type="CA-node" />
                  {'\u2190'} {a.source} <strong>{a.attack_type}</strong>{a.scheme ? <span style={{ color: 'var(--text-muted)' }}> via {a.scheme}</span> : ''}
                  {contribution != null && (
                    <span title={`Attack contribution = (source strength (${srcStr.toFixed(2)}) × edge weight (${edgeWeight.toFixed(1)}${hasWeight ? '' : ' — default, no AI weight'})) × attack type multiplier (${a.attack_type}: ${atkMult.toFixed(1)}).\nRebut=1.0, Undercut=1.1 (denies inference), Undermine=1.2 (attacks premise).`} style={{ marginLeft: 8, fontSize: '0.62rem', color: '#ef4444', fontFamily: 'monospace', cursor: 'help', opacity: hasWeight ? 1 : 0.5 }}>
                      −{contribution.toFixed(2)} <span style={{ color: 'var(--text-muted)' }}>({srcStr.toFixed(2)}×{edgeWeight.toFixed(1)}{hasWeight ? '' : '?'}×{atkMult.toFixed(1)})</span>
                    </span>
                  )}
                  {onGotoEntry && sourceNode?.source_entry_id && (
                    <button
                      onClick={(ev) => { ev.stopPropagation(); onGotoEntry(sourceNode.source_entry_id); }}
                      title={`Go to ${stmtIdByEntry?.get(sourceNode.source_entry_id) || sourceNode.source_entry_id}`}
                      style={{ marginLeft: 6, padding: '0 4px', fontSize: '0.55rem', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 3, background: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 600 }}
                    >{stmtIdByEntry?.get(sourceNode.source_entry_id) || 'goto'}</button>
                  )}
                </div>
                {a.warrant && <div style={{ paddingLeft: 8, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>Warrant: <Highlight text={a.warrant} /></div>}
                {/* Expanded: show debater attribution + full claim text */}
                {expanded && sourceNode && (
                  <div style={{ paddingLeft: 8, marginTop: 3, padding: '4px 8px', background: 'rgba(239,68,68,0.05)', borderRadius: 3 }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Debater:</span> <strong style={{ fontSize: '0.7rem' }}>{speakerLabel(sourceNode.speaker)}</strong>
                    {onGotoEntry && sourceNode.source_entry_id && (
                      <button
                        onClick={() => onGotoEntry(sourceNode.source_entry_id)}
                        title={`Go to ${stmtIdByEntry?.get(sourceNode.source_entry_id) || sourceNode.source_entry_id}`}
                        style={{ marginLeft: 6, padding: '0 4px', fontSize: '0.55rem', border: '1px solid rgba(249,115,22,0.4)', borderRadius: 3, background: 'none', color: '#f97316', cursor: 'pointer', fontWeight: 600 }}
                      >{stmtIdByEntry?.get(sourceNode.source_entry_id) || 'goto'}</button>
                    )}
                    <div style={{ fontSize: '0.7rem', marginTop: 2 }}><Highlight text={sourceNode.text} /></div>
                  </div>
                )}
              </div>
            );
          })}
          {supports.map(s => {
            const sourceNode = allNodes.find(n => n.id === s.source);
            const srcStrS = strengthMap?.get(s.source);
            const hasWeightS = s.weight != null;
            const edgeWeightS = s.weight ?? 0.5;
            const contributionS = srcStrS != null ? srcStrS * edgeWeightS : undefined;
            return (
              <div key={s.id} style={{ marginTop: 4, fontSize: '0.7rem', paddingLeft: 8, borderLeft: '2px solid rgba(34,197,94,0.3)' }}>
                <div>
                  <AifBadge type="RA-node" />
                  {'\u2190'} {s.source} <strong>supports</strong>{s.scheme ? <span style={{ color: 'var(--text-muted)' }}> via {s.scheme}</span> : ''}
                  {contributionS != null && (
                    <span title={`Support contribution = source strength (${srcStrS.toFixed(2)}) × edge weight (${edgeWeightS.toFixed(1)}${hasWeightS ? '' : ' — default, no AI weight'}). No type multiplier for supports — all support relationships are weighted equally.`} style={{ marginLeft: 8, fontSize: '0.62rem', color: '#22c55e', fontFamily: 'monospace', cursor: 'help', opacity: hasWeightS ? 1 : 0.5 }}>
                      +{contributionS.toFixed(2)} <span style={{ color: 'var(--text-muted)' }}>({srcStrS.toFixed(2)}×{edgeWeightS.toFixed(1)}{hasWeightS ? '' : '?'})</span>
                    </span>
                  )}
                  {onGotoEntry && sourceNode?.source_entry_id && (
                    <button
                      onClick={(ev) => { ev.stopPropagation(); onGotoEntry(sourceNode.source_entry_id); }}
                      title={`Go to ${stmtIdByEntry?.get(sourceNode.source_entry_id) || sourceNode.source_entry_id}`}
                      style={{ marginLeft: 6, padding: '0 4px', fontSize: '0.55rem', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 3, background: 'none', color: '#22c55e', cursor: 'pointer', fontWeight: 600 }}
                    >{stmtIdByEntry?.get(sourceNode.source_entry_id) || 'goto'}</button>
                  )}
                </div>
                {s.warrant && <div style={{ paddingLeft: 8, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>Warrant: {s.warrant}</div>}
                {/* Expanded: show debater attribution + full claim text */}
                {expanded && sourceNode && (
                  <div style={{ paddingLeft: 8, marginTop: 3, padding: '4px 8px', background: 'rgba(34,197,94,0.05)', borderRadius: 3 }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Debater:</span> <strong style={{ fontSize: '0.7rem' }}>{speakerLabel(sourceNode.speaker)}</strong>
                    {onGotoEntry && sourceNode.source_entry_id && (
                      <button
                        onClick={() => onGotoEntry(sourceNode.source_entry_id)}
                        title={`Go to ${stmtIdByEntry?.get(sourceNode.source_entry_id) || sourceNode.source_entry_id}`}
                        style={{ marginLeft: 6, padding: '0 4px', fontSize: '0.55rem', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 3, background: 'none', color: '#22c55e', cursor: 'pointer', fontWeight: 600 }}
                      >{stmtIdByEntry?.get(sourceNode.source_entry_id) || 'goto'}</button>
                    )}
                    <div style={{ fontSize: '0.7rem', marginTop: 2 }}><Highlight text={sourceNode.text} /></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DiagnosticsWindow({ initialData }: { initialData?: Record<string, unknown> } = {}) {
  const [debate, setDebate] = useState<DebateSession | null>(() => {
    // If opened with initial data (e.g. from CLI file viewer), use it immediately
    if (initialData) {
      const d = initialData as { debate?: DebateSession; selectedEntry?: string };
      return (d.debate as DebateSession) ?? (initialData as unknown as DebateSession);
    }
    return null;
  });
  // Start with no entry selected — default to Arg Net overview
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [localOverride, setLocalOverride] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  type EntryTab = 'tax-refs' | 'tax-context' | 'prompt' | 'response' | 'details' | 'claims' | 'brief' | 'plan' | 'draft' | 'cite' | 'moderator';
  const [entryTab, setEntryTab] = useState<EntryTab>('details');
  const tabContentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { tabContentRef.current?.focus(); }, [entryTab]);
  type OverviewTab = 'extraction' | 'argument-network' | 'commitments' | 'transcript' | 'convergence' | 'reflections' | 'gaps' | 'grounding' | 'adaptive' | 'pov-progression';
  const [overviewTab, setOverviewTab] = useState<OverviewTab>('argument-network');
  const [transcriptSpeakerFilter, setTranscriptSpeakerFilter] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [taxNodeMap, setTaxNodeMap] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [policyMap, setPolicyMap] = useState<Map<string, { id: string; action: string; source_povs: string[]; member_count: number }>>(new Map());
  const [allEdges, setAllEdges] = useState<TaxRefEdge[]>([]);
  const [selectedTaxRefId, setSelectedTaxRefId] = useState<string | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [textCopyMenu, setTextCopyMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  // Node labels for POV Progression inline view
  const [nodeLabels, setNodeLabels] = useState<Map<string, string>>(new Map());
  // Reset detail panels whenever the selected transcript entry changes
  useEffect(() => { setSelectedTaxRefId(null); setSelectedPolicyId(null); }, [selectedEntry]);

  // Dismiss text copy context menu on click-outside or Escape
  useEffect(() => {
    if (!textCopyMenu) return;
    const dismiss = () => setTextCopyMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', onKey); };
  }, [textCopyMenu]);

  const handleUpdateSubScore = useCallback((nodeId: string, key: string, value: number) => {
    setDebate(prev => {
      if (!prev?.argument_network) return prev;
      const nodes = prev.argument_network.nodes.map(n => {
        if (n.id !== nodeId || !n.bdi_sub_scores) return n;
        const updated = { ...n.bdi_sub_scores, [key]: value };
        const vals = Object.values(updated).filter((v): v is number => v != null);
        const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : n.base_strength;
        return { ...n, bdi_sub_scores: updated, base_strength: avg };
      });
      return { ...prev, argument_network: { ...prev.argument_network, nodes } };
    });
  }, []);

  const handleChatNavigate = useCallback((cmd: NavigateCommand) => {
    if (cmd.entry !== undefined) {
      if (cmd.entry === null) {
        setSelectedEntry(null);
        setLocalOverride(true);
      } else {
        setSelectedEntry(cmd.entry);
        setLocalOverride(true);
      }
    }
    if (cmd.tab) setEntryTab(cmd.tab as EntryTab);
    if (cmd.overviewTab) setOverviewTab(cmd.overviewTab as OverviewTab);
  }, []);

  // Load POV/situations taxonomy files once so we can resolve taxonomy_refs by id
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const files = await Promise.all([
          api.loadTaxonomyFile('accelerationist').catch(() => null),
          api.loadTaxonomyFile('safetyist').catch(() => null),
          api.loadTaxonomyFile('skeptic').catch(() => null),
          api.loadTaxonomyFile('situations').catch(() => null),
        ]);
        if (cancelled) return;
        const m = new Map<string, Record<string, unknown>>();
        for (const f of files) {
          const nodes = (f as { nodes?: Record<string, unknown>[] } | null)?.nodes;
          if (!Array.isArray(nodes)) continue;
          for (const n of nodes) {
            const id = (n as { id?: string }).id;
            if (typeof id === 'string') m.set(id, n);
          }
        }
        setTaxNodeMap(m);
        // Build nodeLabels for PovProgressionView
        const labels = new Map<string, string>();
        for (const [id, n] of m) {
          const label = (n as { label?: string }).label;
          if (typeof label === 'string') labels.set(id, label);
        }
        setNodeLabels(labels);
      } catch {
        // non-fatal — table still renders without detail panel lookup
      }
      try {
        const registryRaw = await api.loadPolicyRegistry() as { policies?: { id: string; action: string; source_povs: string[]; member_count: number }[] } | null;
        const policies = registryRaw?.policies;
        if (!cancelled && Array.isArray(policies)) {
          const pm = new Map<string, { id: string; action: string; source_povs: string[]; member_count: number }>();
          for (const p of policies) pm.set(p.id, p);
          setPolicyMap(pm);
        }
      } catch {
        // non-fatal
      }
      try {
        const raw = await api.loadEdges() as { edges?: TaxRefEdge[] } | null;
        if (cancelled) return;
        if (raw && Array.isArray(raw.edges)) setAllEdges(raw.edges);
      } catch {
        // non-fatal
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Apply theme — the diagnostics popout doesn't go through MainApp which normally sets data-theme
  useEffect(() => {
    const root = document.documentElement;
    if (!root.getAttribute('data-theme')) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  }, []);

  useEffect(() => {
    const unsub = api.onDiagnosticsStateUpdate((state) => {
      const s = state as { debate: DebateSession | null; selectedEntry: string | null };
      setDebate(s.debate);
      // Only sync selectedEntry from main window if the user hasn't locally navigated
      if (!localOverride) {
        setSelectedEntry(s.selectedEntry);
      }
    });
    return unsub;
  }, [localOverride]);

  const entry = selectedEntry ? debate?.transcript.find(e => e.id === selectedEntry) : null;
  const diag: EntryDiagnostics | undefined = selectedEntry ? debate?.diagnostics?.entries[selectedEntry] : undefined;
  const turnValTrail: TurnValidationTrail | undefined = selectedEntry ? debate?.turn_validations?.[selectedEntry] : undefined;
  const meta = entry?.metadata as Record<string, unknown> | undefined;

  // For system entries without diagnostics, proxy the moderator_trace from
  // the next debater entry so the moderator deliberation is visible.
  const proxiedModeratorTrace = useMemo(() => {
    if (!entry || entry.speaker !== 'system' || meta?.moderator_trace) return null;
    if (!debate?.transcript) return null;
    const idx = debate.transcript.findIndex(e => e.id === entry.id);
    if (idx < 0) return null;
    for (let i = idx + 1; i < debate.transcript.length; i++) {
      const next = debate.transcript[i];
      const nextMeta = next.metadata as Record<string, unknown> | undefined;
      if (nextMeta?.moderator_trace) return nextMeta.moderator_trace as Record<string, unknown>;
      if (next.type === 'statement' || next.type === 'opening') break;
    }
    return null;
  }, [entry, debate?.transcript, meta]);
  const an = debate?.argument_network;
  const commitments = debate?.commitments;

  // Effective overview tab — falls back to 'transcript' if the selected tab has no data
  const effectiveOverviewTab: OverviewTab = useMemo(() => {
    if (!debate) return overviewTab;
    const hasAn = !!(an && an.nodes.length > 0);
    const hasCommitments = !!(commitments && Object.keys(commitments).length > 0);
    const tabVisibility: Record<OverviewTab, boolean> = {
      'argument-network': hasAn,
      'commitments': hasCommitments,
      'transcript': true,
      'extraction': true,
      'convergence': !!(debate.convergence_signals && debate.convergence_signals.length > 0),
      'reflections': debate.transcript.some(e => e.type === 'reflection'),
      'gaps': !!(debate.taxonomy_gap_analysis || (debate.gap_injections && debate.gap_injections.length > 0) || (debate.cross_cutting_proposals && debate.cross_cutting_proposals.length > 0)),
      'grounding': debate.transcript.some(e => e.taxonomy_refs && e.taxonomy_refs.length > 0),
      'adaptive': !!(debate as unknown as Record<string, unknown>).adaptive_staging_diagnostics,
      'pov-progression': true,
    };
    return tabVisibility[overviewTab] ? overviewTab : 'transcript';
  }, [overviewTab, debate, an, commitments]);

  const sq = searchQuery.trim();

  // Compute total match count across all visible text
  const matchCount = useMemo(() => {
    if (!sq || !debate) return 0;
    let count = 0;
    // AN nodes
    if (an) {
      for (const n of an.nodes) count += countMatches(n.id, sq) + countMatches(n.text, sq) + countMatches(n.speaker, sq);
      for (const e of an.edges) count += countMatches(e.source, sq) + countMatches(e.warrant || '', sq) + countMatches(e.scheme || '', sq);
    }
    // Transcript entries
    for (const e of debate.transcript) count += countMatches(e.content, sq);
    // Selected entry diagnostics
    if (diag) {
      count += countMatches(diag.prompt || '', sq);
      count += countMatches(diag.raw_response || '', sq);
      count += countMatches(diag.taxonomy_context || '', sq);
      count += countMatches(diag.commitment_context || '', sq);
      if (diag.extracted_claims) {
        for (const c of diag.extracted_claims.accepted) count += countMatches(c.text, sq);
        for (const c of diag.extracted_claims.rejected) count += countMatches(c.text, sq);
      }
      // Pipeline stage work products (brief, plan, draft, cite)
      const stages = (diag as unknown as Record<string, unknown>).stage_diagnostics as { work_product?: Record<string, unknown> }[] | undefined;
      if (stages) {
        for (const stage of stages) {
          const wp = stage.work_product;
          if (!wp) continue;
          for (const val of Object.values(wp)) {
            if (typeof val === 'string') count += countMatches(val, sq);
            else if (Array.isArray(val)) {
              for (const item of val) {
                if (typeof item === 'string') count += countMatches(item, sq);
                else if (item && typeof item === 'object') {
                  for (const v of Object.values(item as Record<string, unknown>)) {
                    if (typeof v === 'string') count += countMatches(v, sq);
                  }
                }
              }
            }
          }
        }
      }
    }
    return count;
  }, [sq, debate, an, diag]);

  // Keyboard navigation: Ctrl+F = search, Left/Right = tabs, Up/Down/P/N = prev/next statement
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (entry) {
          const ENTRY_TABS: EntryTab[] = ['details', 'moderator', 'brief', 'plan', 'draft', 'cite', 'claims', 'tax-refs', 'tax-context', 'prompt', 'response'];
          const idx = ENTRY_TABS.indexOf(entryTab);
          const next = idx + dir;
          if (next >= 0 && next < ENTRY_TABS.length) setEntryTab(ENTRY_TABS[next]);
        } else if (debate) {
          const OVERVIEW_TABS: OverviewTab[] = ['argument-network', 'commitments', 'transcript', 'extraction', 'convergence', 'reflections', 'gaps', 'grounding', 'adaptive', 'pov-progression'];
          const visible = OVERVIEW_TABS.filter(id => {
            if (id === 'argument-network') return !!(an && an.nodes.length > 0);
            if (id === 'commitments') return !!(commitments && Object.keys(commitments).length > 0);
            if (id === 'convergence') return !!(debate.convergence_signals && debate.convergence_signals.length > 0);
            if (id === 'reflections') return debate.transcript.some(e => e.type === 'reflection');
            if (id === 'gaps') return !!(debate.taxonomy_gap_analysis || (debate.gap_injections && debate.gap_injections.length > 0) || (debate.cross_cutting_proposals && debate.cross_cutting_proposals.length > 0));
            if (id === 'grounding') return debate.transcript.some(e => e.taxonomy_refs && e.taxonomy_refs.length > 0);
            return true;
          });
          const idx = visible.indexOf(overviewTab);
          const next = idx + dir;
          if (next >= 0 && next < visible.length) setOverviewTab(visible[next]);
        }
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
          e.key === 'p' || e.key === 'P' || e.key === 'n' || e.key === 'N') {
        if (!debate) return;
        e.preventDefault();
        const dir = (e.key === 'ArrowDown' || e.key === 'n' || e.key === 'N') ? 1 : -1;

        // Navigate I-nodes when in argument network overview
        if (!entry && effectiveOverviewTab === 'argument-network' && an && an.nodes.length > 0) {
          const nodeIds = an.nodes.map(n => n.id);
          const curIdx = focusedNodeId ? nodeIds.indexOf(focusedNodeId) : -1;
          if (curIdx < 0) {
            setFocusedNodeId(nodeIds[dir === 1 ? 0 : nodeIds.length - 1]);
          } else {
            const nextIdx = curIdx + dir;
            if (nextIdx >= 0 && nextIdx < nodeIds.length) setFocusedNodeId(nodeIds[nextIdx]);
          }
          return;
        }

        if (!entry) {
          if (dir === 1 && debate.transcript.length > 0) {
            setSelectedEntry(debate.transcript[0].id);
            setLocalOverride(true);
          }
          return;
        }
        const curIdx = debate.transcript.findIndex(t => t.id === entry.id);
        const nextIdx = curIdx + dir;
        if (nextIdx >= 0 && nextIdx < debate.transcript.length) {
          setSelectedEntry(debate.transcript[nextIdx].id);
          setLocalOverride(true);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [debate, entry, entryTab, overviewTab, effectiveOverviewTab, an, commitments, focusedNodeId]);

  return (
    <DiagSearchContext.Provider value={sq}>
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
    <div style={{ padding: 12, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: '1rem', color: '#f59e0b', whiteSpace: 'nowrap' }}>Debate Diagnostics</h2>
        {debate && (
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260, userSelect: 'all', fontFamily: 'monospace' }} title={`${debate.title} — ${debate.id}`}>
            {debate.title}
          </span>
        )}
        {debate && !showHelp && <SearchBar query={searchQuery} setQuery={setSearchQuery} matchCount={matchCount} inputRef={searchInputRef} />}
        {(!debate || showHelp) && <div style={{ flex: 1 }} />}
        <button
          onClick={() => setShowHelp(!showHelp)}
          style={{ background: showHelp ? '#f59e0b' : 'none', color: showHelp ? '#000' : '#f59e0b', border: '1px solid #f59e0b', borderRadius: 4, padding: '2px 10px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
        >
          {showHelp ? 'Close Help' : 'Help'}
        </button>
      </div>
      {showHelp && <HelpContent />}
      {!debate && !showHelp && <p style={{ color: 'var(--text-muted)' }}>Waiting for debate data from main window...</p>}

      {debate && (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

          {/* Vertical tab sidebar — always visible when debate loaded */}
          {(() => {
            const hasAn = !!(an && an.nodes.length > 0);
            const hasCommitments = !!(commitments && Object.keys(commitments).length > 0);
            const plateau = debate.extraction_summary?.plateau_detected === true;
            const tabs: { id: OverviewTab; label: string; badge?: string; visible: boolean }[] = [
              { id: 'argument-network', label: 'Arg Net', visible: hasAn },
              { id: 'commitments', label: 'Commitments', visible: hasCommitments },
              { id: 'transcript', label: `Transcript (${debate.transcript.length})`, visible: true },
              { id: 'extraction', label: 'Extraction', badge: plateau ? '⚠' : undefined, visible: true },
              { id: 'convergence', label: `Convergence (${debate.convergence_signals?.length ?? 0})`, visible: !!(debate.convergence_signals && debate.convergence_signals.length > 0) },
              { id: 'reflections', label: 'Reflections', visible: debate.transcript.some(e => e.type === 'reflection') },
              { id: 'gaps', label: 'Gaps', visible: !!(debate.taxonomy_gap_analysis || (debate.gap_injections && debate.gap_injections.length > 0) || (debate.cross_cutting_proposals && debate.cross_cutting_proposals.length > 0)) },
              { id: 'grounding', label: `Grounding (${debate.transcript.reduce((n, e) => n + (e.taxonomy_refs?.length ? 1 : 0), 0)})`, visible: debate.transcript.some(e => e.taxonomy_refs && e.taxonomy_refs.length > 0) },
              { id: 'adaptive', label: 'Adaptive', visible: !!(debate as unknown as Record<string, unknown>).adaptive_staging_diagnostics },
              { id: 'pov-progression', label: 'POV Progression', visible: true },
            ];
            return (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 2,
                borderRight: '1px solid var(--border)', paddingRight: 8, marginRight: 8,
                minWidth: 120, maxWidth: 150, overflowY: 'auto', flexShrink: 0,
              }}>
                {tabs.filter(t => t.visible).map(t => (
                  <div key={t.id}>
                    <button
                      onClick={() => { setOverviewTab(t.id); setSelectedEntry(null); setLocalOverride(true); }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '4px 8px', fontSize: '0.7rem', fontWeight: 600,
                        borderRadius: 4, cursor: 'pointer',
                        border: 'none',
                        background: t.id === effectiveOverviewTab ? '#f59e0b' : 'transparent',
                        color: t.id === effectiveOverviewTab ? '#000' : 'var(--text-primary)',
                      }}
                    >
                      {t.label}{t.badge ? ` ${t.badge}` : ''}
                    </button>
                    {/* Transcript child items — nested entries when Transcript tab is active */}
                    {t.id === 'transcript' && effectiveOverviewTab === 'transcript' && (
                      <div style={{ marginLeft: 8, marginTop: 2, maxHeight: 300, overflowY: 'auto' }}>
                        {debate.transcript.map((e, i) => {
                          const stmtId = `S${i + 1}`;
                          return (
                            <button
                              key={e.id}
                              onClick={() => { setSelectedEntry(e.id); setLocalOverride(true); }}
                              style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                padding: '2px 6px', fontSize: '0.6rem',
                                border: 'none', borderRadius: 3, cursor: 'pointer',
                                background: selectedEntry === e.id ? 'rgba(249,115,22,0.12)' : 'transparent',
                                color: 'var(--text-primary)',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              }}
                              title={`${speakerLabel(e.speaker)} [${e.type}]: ${e.content.slice(0, 80)}`}
                            >
                              <span style={{ color: '#f97316', fontWeight: 700, marginRight: 4 }}>{stmtId}</span>
                              {speakerLabel(e.speaker)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Content area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>

          {/* Overview content — shown when no entry is selected */}
          {!selectedEntry && <>

          {/* Extraction Timeline — diagnoses AN-plateau failures */}
          {effectiveOverviewTab === 'extraction' && (
            <ExtractionTimelinePanel debate={debate} />
          )}

          {/* Convergence Signals — per-turn diagnostic signals */}
          {effectiveOverviewTab === 'convergence' && (
            <ConvergenceSignalsPanel debate={debate} />
          )}

          {/* Taxonomy Gaps — post-debate coverage analysis */}
          {effectiveOverviewTab === 'gaps' && (
            <TaxonomyGapPanel debate={debate} />
          )}

          {/* Taxonomy Grounding — which POV nodes are referenced and why */}
          {effectiveOverviewTab === 'grounding' && (
            <GroundingPanel debate={debate} />
          )}

          {/* Adaptive Staging — signal telemetry, phase transitions, GC events */}
          {effectiveOverviewTab === 'adaptive' && (() => {
            const diag = (debate as unknown as Record<string, unknown>).adaptive_staging_diagnostics as {
              phases: { phase: string; rounds: number[]; exit_reason: string }[];
              regressions: { from_round: number; crux_id: string; threshold_after: number }[];
              total_predicate_evaluations: number;
              confidence_deferrals: number;
              vetoes_fired: number;
              forces_fired: number;
              network_size_peak: number;
              gc_events: { round: number; before: number; after: number; pruned: number }[];
              signal_telemetry: {
                round: number; phase: string;
                signals: Record<string, number>;
                composite: { saturation_score: number | null; convergence_score: number | null };
                confidence: { extraction: number; stability: number; global: number };
                predicate_result: { action: string; reason: string; veto_active: boolean; force_active: boolean; confidence_deferred: boolean };
                network_size: number; elapsed_ms: number;
              }[];
            } | undefined;
            if (!diag) return <div style={{ color: 'var(--text-secondary)', padding: 16 }}>No adaptive staging data available.</div>;

            const downloadSignals = () => {
              const blob = new Blob([JSON.stringify(diag, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `adaptive-signals-${debate.id.slice(0, 8)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            };

            return (
              <div style={{ fontSize: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>Adaptive Staging Diagnostics</span>
                  <button onClick={downloadSignals} style={{ fontSize: '0.7rem', padding: '2px 8px', cursor: 'pointer', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)' }}>
                    Download Signals JSON
                  </button>
                </div>

                {/* Summary stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 }}>
                  {[
                    { label: 'Predicate evals', value: diag.total_predicate_evaluations },
                    { label: 'Confidence deferrals', value: diag.confidence_deferrals },
                    { label: 'Vetoes', value: diag.vetoes_fired },
                    { label: 'Forces', value: diag.forces_fired },
                    { label: 'Peak network', value: diag.network_size_peak },
                    { label: 'GC events', value: diag.gc_events.length },
                    { label: 'Regressions', value: diag.regressions.length },
                    { label: 'Phases', value: diag.phases.length },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: 4, textAlign: 'center' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{s.value}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Phase timeline */}
                {diag.phases.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Phase Timeline</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ textAlign: 'left', padding: 4 }}>Phase</th>
                          <th style={{ textAlign: 'left', padding: 4 }}>Rounds</th>
                          <th style={{ textAlign: 'left', padding: 4 }}>Exit Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diag.phases.map((p, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: 4, fontWeight: 600, color: p.phase === 'thesis-antithesis' ? '#60a5fa' : p.phase === 'exploration' ? '#f59e0b' : '#34d399' }}>{p.phase}</td>
                            <td style={{ padding: 4 }}>{p.rounds.length > 0 ? `${p.rounds[0]}–${p.rounds[p.rounds.length - 1]}` : '—'}</td>
                            <td style={{ padding: 4, color: 'var(--text-secondary)' }}>{p.exit_reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Signal telemetry table */}
                {diag.signal_telemetry.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Signal Telemetry (per round)</div>
                    <div style={{ overflowX: 'auto', maxHeight: 300, overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem', whiteSpace: 'nowrap' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-primary)' }}>
                            <th style={{ padding: '2px 4px' }}>Rd</th>
                            <th style={{ padding: '2px 4px' }}>Phase</th>
                            <th style={{ padding: '2px 4px' }}>Sat</th>
                            <th style={{ padding: '2px 4px' }}>Conv</th>
                            <th style={{ padding: '2px 4px' }}>Conf</th>
                            <th style={{ padding: '2px 4px' }}>Net</th>
                            <th style={{ padding: '2px 4px' }}>Action</th>
                            <th style={{ padding: '2px 4px' }}>Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diag.signal_telemetry.map((t, i) => (
                            <tr key={i} style={{
                              borderBottom: '1px solid var(--border)',
                              background: t.predicate_result.action !== 'stay' ? 'rgba(245, 158, 11, 0.1)' : undefined,
                            }}>
                              <td style={{ padding: '2px 4px' }}>{t.round}</td>
                              <td style={{ padding: '2px 4px', color: t.phase === 'thesis-antithesis' ? '#60a5fa' : t.phase === 'exploration' ? '#f59e0b' : '#34d399' }}>{t.phase.slice(0, 5)}</td>
                              <td style={{ padding: '2px 4px' }}>{t.composite.saturation_score?.toFixed(2) ?? '—'}</td>
                              <td style={{ padding: '2px 4px' }}>{t.composite.convergence_score?.toFixed(2) ?? '—'}</td>
                              <td style={{ padding: '2px 4px', color: t.confidence.global < 0.4 ? '#ef4444' : undefined }}>{t.confidence.global.toFixed(2)}</td>
                              <td style={{ padding: '2px 4px' }}>{t.network_size}</td>
                              <td style={{ padding: '2px 4px', fontWeight: t.predicate_result.action !== 'stay' ? 700 : 400 }}>{t.predicate_result.action}</td>
                              <td style={{ padding: '2px 4px', color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.predicate_result.reason}>{t.predicate_result.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Regressions */}
                {diag.regressions.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Regressions</div>
                    {diag.regressions.map((r, i) => (
                      <div key={i} style={{ padding: '4px 8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 4, marginBottom: 4, fontSize: '0.7rem' }}>
                        Round {r.from_round}: crux {r.crux_id}, threshold ratcheted to {(r.threshold_after * 100).toFixed(0)}%
                      </div>
                    ))}
                  </div>
                )}

                {/* GC Events */}
                {diag.gc_events.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Network GC Events</div>
                    {diag.gc_events.map((g, i) => (
                      <div key={i} style={{ padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: 4, marginBottom: 4, fontSize: '0.7rem' }}>
                        Round {g.round}: {g.before} → {g.after} nodes ({g.pruned} pruned)
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Reflections — taxonomy edits proposed by debaters */}
          {effectiveOverviewTab === 'reflections' && (() => {
            const reflectionEntries = debate.transcript.filter(e => e.type === 'reflection');
            const allResults = reflectionEntries.flatMap(e => {
              const meta = e.metadata as Record<string, unknown> | undefined;
              return (meta?.reflection_results as Array<{
                pover: string; label: string; reflection_summary: string;
                edits: Array<{
                  edit_type: string; node_id: string | null; category: string;
                  current_label: string | null; proposed_label: string;
                  current_description: string | null; proposed_description: string;
                  rationale: string; confidence?: string; evidence_entries?: string[];
                  status: string;
                }>;
              }>) || [];
            });
            const confColors: Record<string, string> = { high: '#22c55e', medium: '#f59e0b', low: '#ef4444' };
            const editTypeColors: Record<string, string> = { revise: '#3b82f6', add: '#22c55e', qualify: '#f59e0b', deprecate: '#ef4444' };
            const totalEdits = allResults.reduce((s, r) => s + r.edits.length, 0);
            const approved = allResults.reduce((s, r) => s + r.edits.filter(e => e.status === 'approved').length, 0);
            return (
              <div style={{ fontSize: '0.75rem' }}>
                <div style={{ marginBottom: 8, color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                  {allResults.length} debater{allResults.length !== 1 ? 's' : ''} reflected, {totalEdits} edit{totalEdits !== 1 ? 's' : ''} proposed{approved > 0 ? `, ${approved} applied` : ''}
                </div>
                {allResults.map((r, ri) => {
                  const poverInfo = Object.values(POVER_INFO).find(p => p.pov === r.pover);
                  const color = poverInfo?.color || '#888';
                  return (
                    <div key={ri} style={{ marginBottom: 16 }}>
                      <div style={{
                        fontWeight: 700, fontSize: '0.8rem', color,
                        borderBottom: `2px solid ${color}`, paddingBottom: 4, marginBottom: 6,
                      }}>
                        {r.label}
                        <span style={{ fontWeight: 400, fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 8 }}>
                          {r.edits.length} edit{r.edits.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {r.reflection_summary && (
                        <div style={{
                          padding: '6px 10px', marginBottom: 8, fontSize: '0.72rem', lineHeight: 1.5,
                          background: `${color}10`, borderLeft: `3px solid ${color}`,
                          borderRadius: '0 4px 4px 0',
                        }}>
                          {r.reflection_summary}
                        </div>
                      )}
                      {r.edits.map((edit, ei) => (
                        <div key={ei} style={{
                          padding: '8px 10px', marginBottom: 6, borderRadius: 6,
                          border: `1px solid ${edit.status === 'approved' ? '#22c55e44' : 'var(--border)'}`,
                          opacity: edit.status === 'dismissed' ? 0.5 : 1,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <span style={{
                              padding: '1px 5px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 700,
                              background: `${editTypeColors[edit.edit_type] || '#888'}22`,
                              color: editTypeColors[edit.edit_type] || '#888',
                            }}>
                              {edit.edit_type.toUpperCase()}
                            </span>
                            {edit.node_id && <code style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{edit.node_id}</code>}
                            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{edit.category}</span>
                            {edit.confidence && (
                              <span style={{
                                padding: '1px 4px', borderRadius: 3, fontSize: '0.58rem', fontWeight: 700,
                                border: `1px solid ${confColors[edit.confidence] || '#888'}44`,
                                color: confColors[edit.confidence] || '#888',
                              }}>
                                {edit.confidence}
                              </span>
                            )}
                            {edit.status !== 'pending' && (
                              <span style={{
                                marginLeft: 'auto', fontSize: '0.6rem', fontWeight: 600,
                                color: edit.status === 'approved' ? '#22c55e' : 'var(--text-muted)',
                              }}>
                                {edit.status === 'approved' ? 'Applied' : 'Dismissed'}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.72rem', marginBottom: 3 }}>
                            {edit.current_label ? (
                              <>
                                <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{edit.current_label}</span>
                                {' → '}
                                <span style={{ fontWeight: 600 }}>{edit.proposed_label}</span>
                              </>
                            ) : (
                              <span style={{ fontWeight: 600 }}>{edit.proposed_label}</span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 2 }}>
                            {edit.rationale}
                          </div>
                          {edit.evidence_entries && edit.evidence_entries.length > 0 && (
                            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                              Evidence: {edit.evidence_entries.map((ev: string, evi: number) => (
                                <code key={evi} style={{ padding: '0 3px', marginRight: 2, borderRadius: 2, background: 'var(--bg-secondary)', fontSize: '0.62rem' }}>{ev}</code>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
                {allResults.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)' }}>
                    No reflections recorded yet.
                  </div>
                )}
              </div>
            );
          })()}

          {/* Argument Network with inline Moderator Deliberations */}
          {effectiveOverviewTab === 'argument-network' && an && an.nodes.length > 0 && (() => {
            const caCount = an.edges.filter(e => e.type === 'attacks').length;
            const raCount = an.edges.filter(e => e.type === 'supports').length;
            // Statement-ID map — matches S{round} from the main transcript view.
            const stmtIdByEntry = new Map<string, string>();
            debate.transcript.forEach((e, i) => stmtIdByEntry.set(e.id, `S${i + 1}`));

            // Compute QBAF strengths from edges
            const qbafNodes: QbafNode[] = an.nodes.map(n => ({ id: n.id, base_strength: n.base_strength ?? 0.5 }));
            const qbafEdges: QbafEdge[] = an.edges.map(e => ({
              source: e.source, target: e.target,
              type: e.type as 'attacks' | 'supports',
              weight: e.weight ?? 0.5,
              attack_type: e.attack_type,
            }));
            const qbafResult = computeQbafStrengths(qbafNodes, qbafEdges);
            const strengthMap = qbafResult.strengths;

            // Build moderator trace lookup: entry ID → trace
            const modTraceByEntryId = new Map<string, {
              selected: string; focus_point: string; addressing?: string;
              excluded_last_speaker?: string | null;
              selection_reason?: string;
              recent_scheme?: string | null;
              convergence_score?: number | null; convergence_triggered?: boolean;
              candidates?: { debater: string; computed_strength: number | null; rank: number }[];
              argument_network_snapshot?: { total_claims: number; total_edges: number; unaddressed_claims: number } | null;
            }>();
            debate.transcript.forEach(e => {
              const meta = e.metadata as Record<string, unknown> | undefined;
              if (meta?.moderator_trace) {
                modTraceByEntryId.set(e.id, meta.moderator_trace as any);
              }
            });

            // Group AN nodes by source_entry_id to interleave with moderator traces
            const entryGroups: { entryId: string; nodes: typeof an.nodes; trace: ReturnType<typeof modTraceByEntryId.get> }[] = [];
            const seenEntries = new Set<string>();
            for (const n of an.nodes) {
              const eid = n.source_entry_id;
              if (!seenEntries.has(eid)) {
                seenEntries.add(eid);
                entryGroups.push({
                  entryId: eid,
                  nodes: an.nodes.filter(x => x.source_entry_id === eid),
                  trace: modTraceByEntryId.get(eid),
                });
              }
            }

            // Also show moderator traces for entries that produced no AN nodes
            debate.transcript.forEach(e => {
              const meta = e.metadata as Record<string, unknown> | undefined;
              if (meta?.moderator_trace && !seenEntries.has(e.id)) {
                entryGroups.push({ entryId: e.id, nodes: [], trace: meta.moderator_trace as any });
              }
            });

            const modCount = [...modTraceByEntryId.values()].length;

            return (
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                  {an.nodes.length} I-nodes · {caCount} CA · {raCount} RA{modCount > 0 ? ` · ${modCount} moderator decisions` : ''}
                </div>
                {entryGroups.map(({ entryId, nodes: groupNodes, trace }) => (
                  <div key={entryId}>
                    {/* Moderator deliberation banner */}
                    {trace && (
                      <div style={{
                        margin: '8px 0 4px', padding: '6px 10px', borderRadius: 6,
                        background: 'rgba(249,115,22,0.08)', borderLeft: '3px solid #f97316',
                        fontSize: '0.65rem',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, color: '#f97316', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Moderator</span>
                          <span style={{ fontWeight: 600 }}>→ {speakerLabel(trace.selected)}</span>
                          {trace.selection_reason && (
                            <span style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(249,115,22,0.15)', color: '#f97316', fontSize: '0.55rem', fontWeight: 600 }}>
                              {trace.selection_reason.replace(/_/g, ' ')}
                            </span>
                          )}
                          {trace.recent_scheme && (
                            <span style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(99,102,241,0.15)', color: '#6366f1', fontSize: '0.55rem', fontWeight: 600 }}>
                              {trace.recent_scheme}
                            </span>
                          )}
                          {trace.convergence_score != null && (
                            <span style={{ color: 'var(--text-muted)' }}>
                              conv: {(trace.convergence_score * 100).toFixed(0)}%
                              {trace.convergence_triggered && <span style={{ color: '#22c55e', marginLeft: 3, fontWeight: 700 }}>triggered</span>}
                            </span>
                          )}
                        </div>
                        <div style={{ marginTop: 3, color: 'var(--text-muted)' }}>
                          <strong>Focus:</strong> <Highlight text={trace.focus_point} />
                        </div>
                        {trace.candidates && trace.candidates.length > 0 && (
                          <div style={{ marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {trace.candidates.map((c, i) => (
                              <span key={i} style={{
                                fontSize: '0.55rem',
                                opacity: c.debater === trace.selected ? 1 : 0.6,
                                fontWeight: c.debater === trace.selected ? 700 : 400,
                              }}>
                                #{c.rank} {speakerLabel(c.debater)}
                                {c.computed_strength != null && ` (${c.computed_strength.toFixed(2)})`}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {/* AN nodes from this entry */}
                    {groupNodes.map(n => {
                      const attacks = an.edges.filter(e => e.target === n.id && e.type === 'attacks');
                      const supports = an.edges.filter(e => e.target === n.id && e.type === 'supports');
                      const isSource = an.edges.some(e => e.source === n.id);
                      return (
                        <INodeRow
                          key={n.id}
                          node={n}
                          attacks={attacks}
                          supports={supports}
                          allNodes={an.nodes}
                          isSource={isSource}
                          computedStrength={strengthMap.get(n.id)}
                          strengthMap={strengthMap}
                          statementId={stmtIdByEntry.get(n.source_entry_id)}
                          onGotoEntry={(eid) => { setOverviewTab('transcript'); setSelectedEntry(eid); setLocalOverride(true); }}
                          stmtIdByEntry={stmtIdByEntry}
                          focused={focusedNodeId === n.id}
                          onUpdateSubScore={handleUpdateSubScore}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Commitments */}
          {effectiveOverviewTab === 'commitments' && commitments && Object.keys(commitments).length > 0 && (
            <CommitmentsPanel
              commitments={commitments}
              nodes={an?.nodes ?? []}
              onGoToNode={(nodeId) => { setOverviewTab('argument-network'); setFocusedNodeId(nodeId); }}
            />
          )}

          {/* POV Progression — inline view (replaces separate popout) */}
          {effectiveOverviewTab === 'pov-progression' && (
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <PovProgressionView session={debate} nodeLabels={nodeLabels} />
            </div>
          )}

          {/* Transcript list for selection */}
          {effectiveOverviewTab === 'transcript' && (() => {
            const speakers = Array.from(new Set(debate.transcript.map(e => e.speaker)));
            const filteredTranscript = transcriptSpeakerFilter
              ? debate.transcript.map((e, i) => ({ e, i })).filter(({ e }) => e.speaker === transcriptSpeakerFilter)
              : debate.transcript.map((e, i) => ({ e, i }));
            return (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', gap: 4, padding: '4px 6px', flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
                <button
                  onClick={() => setTranscriptSpeakerFilter(null)}
                  style={{
                    padding: '2px 8px', fontSize: '0.6rem', fontWeight: 600, borderRadius: 4, cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: !transcriptSpeakerFilter ? '#f59e0b' : 'transparent',
                    color: !transcriptSpeakerFilter ? '#000' : 'var(--text-secondary)',
                  }}
                >All ({debate.transcript.length})</button>
                {speakers.map(s => {
                  const count = debate.transcript.filter(e => e.speaker === s).length;
                  const active = transcriptSpeakerFilter === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setTranscriptSpeakerFilter(active ? null : s)}
                      style={{
                        padding: '2px 8px', fontSize: '0.6rem', fontWeight: 600, borderRadius: 4, cursor: 'pointer',
                        border: '1px solid var(--border)',
                        background: active ? '#f59e0b' : 'transparent',
                        color: active ? '#000' : 'var(--text-secondary)',
                      }}
                    >{speakerLabel(s)} ({count})</button>
                  );
                })}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {filteredTranscript.map(({ e, i }) => {
              const stmtId = `S${i + 1}`;
              const eMeta = e.metadata as Record<string, unknown> | undefined;
              const modT = eMeta?.moderator_trace as {
                selected?: string; focus_point?: string; selection_reason?: string;
                convergence_score?: number | null; convergence_triggered?: boolean;
                intervention_recommended?: boolean; intervention_move?: string | null;
                intervention_validated?: boolean; health_score?: number;
              } | undefined;
              const eDiag = debate.diagnostics?.entries[e.id];
              const hasStages = eDiag?.stage_diagnostics && eDiag.stage_diagnostics.length > 0;
              return (
                <div
                  key={e.id}
                  onClick={() => { setSelectedEntry(e.id); setLocalOverride(true); }}
                  style={{ padding: '4px 6px', cursor: 'pointer', borderRadius: 4, margin: '2px 0', background: selectedEntry === e.id ? 'rgba(249,115,22,0.08)' : 'var(--bg-primary)', borderLeft: selectedEntry === e.id ? '3px solid #f97316' : '3px solid transparent', fontSize: '0.7rem' }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span
                      title={`Statement ${stmtId}`}
                      style={{
                        padding: '1px 6px', borderRadius: 8,
                        background: 'rgba(249,115,22,0.12)', color: '#f97316',
                        fontSize: '0.6rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                        flexShrink: 0,
                      }}
                    >{stmtId}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong>{speakerLabel(e.speaker)}</strong> [{e.type}] <Highlight text={e.content.slice(0, 80)} />...
                    </span>
                    {hasStages && <span title="4-stage pipeline" style={{ fontSize: '0.5rem', color: '#3b82f6', opacity: 0.7 }}>B/P/D/C</span>}
                  </div>
                  {modT && (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2, paddingLeft: 36, flexWrap: 'wrap' }}>
                      <span style={{ padding: '0 4px', borderRadius: 3, background: 'rgba(139,92,246,0.12)', color: '#8b5cf6', fontSize: '0.55rem', fontWeight: 600 }}>MOD</span>
                      {modT.focus_point && <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={modT.focus_point}>{modT.focus_point}</span>}
                      {modT.selection_reason && modT.selection_reason !== 'moderator_ai_selection' && (
                        <span style={{ padding: '0 3px', borderRadius: 2, background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: '0.5rem' }}>{modT.selection_reason === 'turn_alternation_override' ? 'override' : modT.selection_reason}</span>
                      )}
                      {modT.intervention_move && (
                        <span style={{ padding: '0 4px', borderRadius: 3, background: modT.intervention_validated ? 'rgba(139,92,246,0.2)' : 'rgba(239,68,68,0.15)', color: modT.intervention_validated ? '#8b5cf6' : '#ef4444', fontSize: '0.5rem', fontWeight: 600 }}>{modT.intervention_move}{modT.intervention_validated ? '' : ' (suppressed)'}</span>
                      )}
                      {modT.convergence_score != null && <span style={{ fontSize: '0.5rem', color: 'var(--text-muted)' }}>conv:{(modT.convergence_score * 100).toFixed(0)}%</span>}
                      {modT.health_score != null && <span style={{ fontSize: '0.5rem', color: 'var(--text-muted)' }}>H:{modT.health_score.toFixed(2)}</span>}
                    </div>
                  )}
                </div>
              );
            })}
            </div>
            </div>
            );
          })()}
          </>}

          {/* Entry detail — shown when a transcript entry is selected */}
          {selectedEntry && entry && (() => {
            const entryIdx = debate.transcript.findIndex(e => e.id === entry.id);
            const totalEntries = debate.transcript.length;
            const stmtId = entryIdx >= 0 ? `S${entryIdx + 1}` : '';
            const goToIdx = (i: number) => {
              if (i < 0 || i >= totalEntries) return;
              setSelectedEntry(debate.transcript[i].id);
              setLocalOverride(true);
            };
            const navBtnStyle = (disabled: boolean): React.CSSProperties => ({
              padding: '2px 8px', fontSize: '0.7rem', fontWeight: 600,
              borderRadius: 4, border: '1px solid var(--border)',
              background: disabled ? 'transparent' : 'rgba(249,115,22,0.1)',
              color: disabled ? 'var(--text-muted)' : '#f97316',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            });
            return (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                {stmtId && (
              <span
                title={`Statement ${stmtId}`}
                style={{
                  padding: '1px 7px', borderRadius: 10,
                  background: 'rgba(249,115,22,0.12)', color: '#f97316',
                  fontSize: '0.7rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                }}
              >{stmtId}</span>
            )}
            <strong style={{ fontSize: '0.85rem' }}>{speakerLabel(entry.speaker)}</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{entry.type}</span>
            {!diag && !proxiedModeratorTrace && entry.type !== 'intervention' && <span style={{ color: '#f59e0b', fontSize: '0.65rem' }}>(no diagnostic capture — turn was generated before diagnostics was always-on)</span>}
            <span style={{ flex: 1 }} />
            <button
              onClick={() => goToIdx(entryIdx - 1)}
              disabled={entryIdx <= 0}
              title="Previous statement"
              style={navBtnStyle(entryIdx <= 0)}
            >◀ Prev</button>
            <button
              onClick={() => goToIdx(entryIdx + 1)}
              disabled={entryIdx >= totalEntries - 1}
              title="Next statement"
              style={navBtnStyle(entryIdx >= totalEntries - 1)}
            >Next ▶</button>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
              {entryIdx + 1} / {totalEntries}
            </span>
          </div>

          {/* ── Proxied moderator trace for system entries ── */}
          {proxiedModeratorTrace && (() => {
            const t = proxiedModeratorTrace as {
              selected?: string; focus_point?: string; selection_reason?: string;
              excluded_last_speaker?: string | null; recent_scheme?: string | null;
              convergence_score?: number | null; convergence_triggered?: boolean;
              candidates?: { debater: string; computed_strength: number | null; rank: number }[];
              argument_network_snapshot?: { total_claims: number; total_edges: number; unaddressed_claims: number } | null;
              commitment_snapshot?: Record<string, { asserted: number; conceded: number; challenged: number }>;
            };
            return (
              <div style={{
                margin: '0 0 10px', padding: '8px 12px', borderRadius: 6,
                background: 'rgba(249,115,22,0.08)', borderLeft: '3px solid #f97316',
                fontSize: '0.72rem',
              }}>
                <div style={{ fontWeight: 700, color: '#f97316', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  Moderator Deliberation
                </div>
                {t.selected && (
                  <div style={{ marginBottom: 3 }}>
                    <strong>Selected:</strong> {t.selected}
                    {t.selection_reason && <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: 'rgba(249,115,22,0.15)', color: '#f97316', fontSize: '0.6rem', fontWeight: 600 }}>{t.selection_reason.replace(/_/g, ' ')}</span>}
                    {t.excluded_last_speaker && <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: '0.65rem' }}>(excluded last speaker: {t.excluded_last_speaker})</span>}
                  </div>
                )}
                {t.focus_point && <div style={{ marginBottom: 3 }}><strong>Focus:</strong> {t.focus_point}</div>}
                {t.candidates && t.candidates.length > 0 && (
                  <div style={{ marginBottom: 3 }}>
                    <strong>Candidates:</strong>{' '}
                    {t.candidates.map((c, i) => (
                      <span key={i} style={{ marginRight: 8, fontWeight: c.debater === t.selected ? 700 : 400, opacity: c.debater === t.selected ? 1 : 0.7 }}
                        title={[
                          `CANDIDATE RANKING — ${c.debater}`,
                          ``,
                          `QBAF Score: ${c.computed_strength != null ? c.computed_strength.toFixed(2) : 'n/a (no scored claims)'}`,
                          `Claims in argument network: ${c.claim_count ?? '?'}`,
                          `Claims with QBAF scores: ${c.scored_count ?? '?'}`,
                          ``,
                          `The QBAF score is the average computed_strength across all`,
                          `of this debater's claims in the argument network.`,
                          ``,
                          `computed_strength uses Quantitative Bipolar Argumentation`,
                          `Framework (QBAF) propagation: each claim starts with a`,
                          `base_strength (0-1), then attack/support edges from other`,
                          `claims raise or lower it. The final score reflects how well`,
                          `a claim survives challenges and gains support.`,
                          ``,
                          `Interpretation:`,
                          `  0.0-0.3  Weak — claims are heavily attacked or unsupported`,
                          `  0.3-0.5  Below average — more attacks than support`,
                          `  0.5       Neutral — balanced or unengaged`,
                          `  0.5-0.7  Above average — net support from other claims`,
                          `  0.7-1.0  Strong — well-supported, surviving challenges`,
                          ``,
                          `Lower-ranked candidates are selected first, as they have`,
                          `weaker argumentation positions and greater need to respond.`,
                        ].join('\n')}
                      >
                        #{c.rank} {c.debater}{c.computed_strength != null ? ` (QBAF: ${c.computed_strength.toFixed(2)})` : ''}
                      </span>
                    ))}
                  </div>
                )}
                {t.convergence_score != null && (
                  <div style={{ marginBottom: 3 }}>
                    <strong>Convergence:</strong> {(t.convergence_score * 100).toFixed(0)}%
                    {t.convergence_triggered && <span style={{ color: '#22c55e', marginLeft: 4, fontWeight: 700 }}>triggered</span>}
                  </div>
                )}
                {t.recent_scheme && <div style={{ marginBottom: 3 }}><strong>Recent scheme:</strong> {t.recent_scheme}</div>}
                {t.argument_network_snapshot && (
                  <div style={{ marginBottom: 3 }}>
                    <strong>AN snapshot:</strong> {t.argument_network_snapshot.total_claims} claims, {t.argument_network_snapshot.total_edges} edges, {t.argument_network_snapshot.unaddressed_claims} unaddressed
                  </div>
                )}
                {t.commitment_snapshot && (
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    {Object.entries(t.commitment_snapshot).map(([name, c]) => (
                      <span key={name} style={{ marginRight: 10 }}>{name}: {c.asserted}A {c.conceded}C {c.challenged}Ch</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Tabbed view: Taxonomy Refs | Taxonomy Context | Full Prompt | Raw Response ── */}
          {(() => {
            const taxRefCount = entry.taxonomy_refs?.length ?? 0;
            const taxContext = diag?.taxonomy_context ?? '';
            const prompt = diag?.prompt ?? '';
            const response = diag?.raw_response ?? '';
            const hasClaims = !!(
              diag?.extracted_claims ||
              (meta?.my_claims && (meta.my_claims as unknown[]).length > 0)
            );
            const hasPrecedingIntervention = (() => {
              if (!debate?.transcript || entryIdx <= 0) return false;
              for (let i = entryIdx - 1; i >= 0; i--) {
                const t = debate.transcript[i];
                if (t.type === 'intervention' && t.speaker === 'moderator') return true;
                if (t.type === 'statement' || t.type === 'opening') return false;
              }
              return false;
            })();
            const hasSuppressedIntervention = !!(
              (meta?.moderator_trace as Record<string, unknown> | undefined)?.intervention_recommended
              && !(meta?.moderator_trace as Record<string, unknown> | undefined)?.intervention_validated
            );
            const hasDetails = !!(
              hasPrecedingIntervention || hasSuppressedIntervention ||
              (meta?.key_assumptions && (meta.key_assumptions as unknown[]).length > 0) ||
              (meta?.policy_refs as string[])?.length || (entry.policy_refs?.length ?? 0) > 0 ||
              diag?.model ||
              diag?.commitment_context ||
              diag?.edge_tensions ||
              diag?.argument_network_context ||
              (meta?.move_types && (meta.move_types as unknown[]).length > 0)
            );
            const claimsCopy = [
              ...(diag?.extracted_claims ? [...diag.extracted_claims.accepted.map(c => `✓ ${c.id} (${c.overlap_pct}%): ${c.text}`), ...diag.extracted_claims.rejected.map(c => `✗ (${c.overlap_pct}%): ${c.text} — ${c.reason}`)] : []),
              ...((meta?.my_claims as { claim: string; targets: string[] }[])?.map((c, i) => `${i + 1}. ${c.claim}${c.targets?.length > 0 ? ` → ${c.targets.join(', ')}` : ''}`) ?? []),
            ].join('\n');
            const stages = diag?.stage_diagnostics;
            const briefStage = stages?.find(s => s.stage === 'brief');
            const planStage = stages?.find(s => s.stage === 'plan');
            const draftStage = stages?.find(s => s.stage === 'draft');
            const citeStage = stages?.find(s => s.stage === 'cite');

            // Find preceding moderator intervention for this entry
            const precedingIntervention = (() => {
              if (!debate?.transcript || entryIdx <= 0) return null;
              for (let i = entryIdx - 1; i >= 0; i--) {
                const t = debate.transcript[i];
                if (t.type === 'intervention' && t.speaker === 'moderator') return t;
                if (t.type === 'statement' || t.type === 'opening') break;
              }
              return null;
            })();
            const citeWorkProduct = citeStage?.work_product as Record<string, unknown> | undefined;
            const pinResponse = citeWorkProduct?.pin_response as {
              position?: string; condition?: string; brief_reason?: string;
            } | undefined;
            const interventionResponseField = (() => {
              if (!precedingIntervention || !citeWorkProduct) return null;
              const intMove = (precedingIntervention.intervention_metadata as { move?: string } | undefined)?.move;
              const fieldMap: Record<string, string> = {
                PIN: 'pin_response', PROBE: 'probe_response', CHALLENGE: 'challenge_response',
                CLARIFY: 'clarification', CHECK: 'check_response', REVOICE: 'revoice_response',
                'META-REFLECT': 'reflection', COMPRESS: 'compressed_thesis', COMMIT: 'commitment',
              };
              const field = intMove ? fieldMap[intMove] : undefined;
              return field ? (citeWorkProduct[field] as Record<string, unknown> | string | undefined) : null;
            })();

            const modTrace = (meta?.moderator_trace ?? proxiedModeratorTrace) as {
              selected?: string; focus_point?: string; selection_reason?: string;
              excluded_last_speaker?: string | null; recent_scheme?: string | null;
              convergence_score?: number | null; convergence_triggered?: boolean;
              candidates?: { debater: string; computed_strength: number | null; rank: number }[];
              commitment_snapshot?: Record<string, { asserted: number; conceded: number; challenged: number }>;
              selection_prompt?: string; selection_response?: string;
              intervention_recommended?: boolean; intervention_move?: string | null;
              intervention_validated?: boolean; intervention_suppressed_reason?: string | null;
              intervention_target?: string | null; trigger_reasoning?: string | null;
            } | null;
            const suppressedIntervention = modTrace?.intervention_recommended && !modTrace.intervention_validated
              ? modTrace : null;
            const hasModTab = !!modTrace;

            const tabs: { id: EntryTab; label: string; count?: number; has: boolean; copy: string }[] = [
              { id: 'moderator', label: 'Moderator-Pre', has: hasModTab, copy: modTrace?.selection_prompt ?? '' },
              { id: 'details', label: 'Overview', has: hasDetails, copy: '' },
              { id: 'brief', label: 'Brief', has: !!briefStage, copy: JSON.stringify(briefStage?.work_product, null, 2) ?? '' },
              { id: 'plan', label: 'Plan', has: !!planStage, copy: JSON.stringify(planStage?.work_product, null, 2) ?? '' },
              { id: 'draft', label: 'Draft', has: !!(draftStage || entry.content), copy: draftStage ? (JSON.stringify(draftStage?.work_product, null, 2) ?? '') : entry.content },
              { id: 'cite', label: 'Cite', has: !!citeStage, copy: JSON.stringify(citeStage?.work_product, null, 2) ?? '' },
              { id: 'claims', label: 'Claims', has: hasClaims, copy: claimsCopy },
              { id: 'tax-refs', label: 'Taxonomy Refs', count: taxRefCount, has: taxRefCount > 0, copy: entry.taxonomy_refs?.map(r => `${r.node_id}: ${r.relevance}`).join('\n') ?? '' },
              { id: 'tax-context', label: 'Taxonomy Context', has: taxContext.length > 0, copy: taxContext },
              { id: 'prompt', label: 'Full Prompt Sent to AI', has: prompt.length > 0, copy: prompt },
              { id: 'response', label: 'Raw AI Response', has: response.length > 0, copy: response },
            ];
            // If the current tab has no data, auto-select the first tab that does.
            const activeTab = tabs.find(t => t.id === entryTab)?.has
              ? entryTab
              : (tabs.find(t => t.has)?.id ?? 'details');
            const active = tabs.find(t => t.id === activeTab)!;
            const handleCopy = () => { if (active.copy) navigator.clipboard?.writeText(active.copy).catch(() => {}); };

            const textAreaStyle: React.CSSProperties = {
              width: '100%',
              flex: 1,
              height: '100%',
              minHeight: 300,
              resize: 'none',
              fontFamily: 'monospace',
              fontSize: '0.78rem',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
              borderBottomLeftRadius: 6,
              borderBottomRightRadius: 6,
              padding: '10px 12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              boxSizing: 'border-box',
              userSelect: 'text',
            };

            const tabBtnStyle = (t: typeof tabs[0]): React.CSSProperties => ({
              padding: '6px 12px',
              fontSize: '0.75rem',
              fontWeight: 600,
              border: '1px solid var(--border)',
              borderBottom: t.id === activeTab ? '1px solid var(--bg-primary)' : '1px solid var(--border)',
              background: t.id === activeTab ? 'var(--bg-primary)' : 'transparent',
              color: t.has ? (t.id === activeTab ? '#f97316' : 'var(--text-primary)') : 'var(--text-muted)',
              cursor: t.has ? 'pointer' : 'not-allowed',
              opacity: t.has ? 1 : 0.5,
              borderRadius: '6px 6px 0 0',
              marginRight: 2,
              marginBottom: -1,
              position: 'relative',
              zIndex: t.id === activeTab ? 2 : 1,
            });

            return (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: '8px 0 0', minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', borderBottom: '1px solid var(--border)' }}>
                  {tabs.map(t => (
                    <button
                      key={t.id}
                      onClick={() => t.has && setEntryTab(t.id)}
                      disabled={!t.has}
                      style={tabBtnStyle(t)}
                      title={t.has ? t.label : `${t.label} (no data)`}
                    >
                      {t.label}
                      {t.count != null && <span style={{ marginLeft: 4, color: 'var(--text-muted)', fontWeight: 400 }}>({t.count})</span>}
                    </button>
                  ))}
                  <div style={{ flex: 1 }} />
                  {active.has && active.id !== 'tax-refs' && (
                    <button
                      onClick={handleCopy}
                      style={{ fontSize: '0.75rem', padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', marginBottom: 4 }}
                      title="Copy tab content"
                    >Copy</button>
                  )}
                </div>
                <div ref={tabContentRef} tabIndex={0} onContextMenu={(e) => {
                  const sel = window.getSelection()?.toString();
                  if (sel && sel.trim().length > 0) {
                    e.preventDefault();
                    setTextCopyMenu({ x: e.clientX, y: e.clientY, text: sel });
                  }
                }} style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  overflowY: 'auto',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderTop: 'none',
                  borderRadius: '0 6px 6px 6px',
                  padding: activeTab === 'tax-refs' ? '8px 10px' : 0,
                  outline: 'none',
                  userSelect: 'text',
                }}>
                  {activeTab === 'tax-refs' && (
                    taxRefCount > 0 ? (
                      <div style={{ flex: 1, minHeight: 200, overflowY: 'auto', padding: '8px 10px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', tableLayout: 'fixed' }}>
                          <colgroup>
                            <col style={{ width: '180px' }} />
                            <col />
                          </colgroup>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                              <th style={{ padding: '4px 6px', fontWeight: 600, color: 'var(--text-muted)' }}>Id</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600, color: 'var(--text-muted)' }}>Relevance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.taxonomy_refs!.map((r, i) => {
                              const isSelected = selectedTaxRefId === r.node_id;
                              return (
                                <tr
                                  key={i}
                                  style={{
                                    borderBottom: '1px solid var(--border)',
                                    background: isSelected ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
                                  }}
                                >
                                  <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>
                                    <button
                                      onClick={() => setSelectedTaxRefId(isSelected ? null : r.node_id)}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        padding: 0,
                                        cursor: 'pointer',
                                        color: 'var(--accent)',
                                        fontWeight: isSelected ? 700 : 600,
                                        textDecoration: 'underline',
                                        fontFamily: 'inherit',
                                        fontSize: 'inherit',
                                        textAlign: 'left',
                                      }}
                                      title="Show POV details"
                                    >{r.node_id}</button>
                                  </td>
                                  <td style={{ padding: '4px 6px', verticalAlign: 'top', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                    {r.relevance}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {selectedTaxRefId && (() => {
                          const node = taxNodeMap.get(selectedTaxRefId) as TaxRefNode | undefined;
                          const povOfId = selectedTaxRefId.startsWith('acc-') ? 'accelerationist'
                            : selectedTaxRefId.startsWith('saf-') ? 'safetyist'
                            : selectedTaxRefId.startsWith('skp-') ? 'skeptic'
                            : selectedTaxRefId.startsWith('sit-') ? 'situations' : '';
                          const nodeEdges = allEdges.filter(e => e.source === selectedTaxRefId || e.target === selectedTaxRefId);
                          return (
                            <TaxonomyRefDetail
                              nodeId={selectedTaxRefId}
                              node={node}
                              pov={povOfId}
                              onClose={() => setSelectedTaxRefId(null)}
                              edges={nodeEdges}
                            />
                          );
                        })()}
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '8px 10px' }}>No taxonomy refs for this entry.</div>
                    )
                  )}
                  {activeTab === 'tax-context' && (
                    taxContext ? (
                      <pre style={{ ...textAreaStyle, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: '8px 10px', margin: 0 }}><Highlight text={taxContext} /></pre>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '12px' }}>No taxonomy context captured for this entry.</div>
                    )
                  )}
                  {activeTab === 'prompt' && (
                    prompt ? (
                      <pre style={{ ...textAreaStyle, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: '8px 10px', margin: 0 }}><Highlight text={prompt} /></pre>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '12px' }}>No prompt captured for this entry.</div>
                    )
                  )}
                  {activeTab === 'response' && (
                    response ? (
                      <pre style={{ ...textAreaStyle, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: '8px 10px', margin: 0 }}><Highlight text={response} /></pre>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '12px' }}>No raw response captured for this entry.</div>
                    )
                  )}
                  {activeTab === 'details' && (
                    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
                      {precedingIntervention && (() => {
                        const intMeta = precedingIntervention.intervention_metadata as {
                          family?: string; move?: string; force?: string; target_debater?: string;
                          trigger_reason?: string;
                        } | undefined;
                        const targetPoverId = intMeta?.target_debater;
                        const targetLabel = targetPoverId
                          ? (POVER_INFO[targetPoverId as Exclude<PoverId, 'user'>]?.label ?? targetPoverId)
                          : null;
                        const speakerIsTarget = targetLabel
                          ? targetLabel === speakerLabel(entry.speaker)
                          : true;
                        const moveLabel = intMeta?.move ?? 'directive';
                        const familyLabel = intMeta?.family ?? '';
                        const directiveText = typeof precedingIntervention.content === 'string'
                          ? precedingIntervention.content
                          : JSON.stringify(precedingIntervention.content);

                        const hasResponse = !!interventionResponseField;
                        const responseObj = typeof interventionResponseField === 'object' ? interventionResponseField as Record<string, unknown> : null;
                        const responseStr = typeof interventionResponseField === 'string' ? interventionResponseField : null;

                        const complianceColor = hasResponse ? '#22c55e'
                          : !speakerIsTarget ? '#6366f1'
                          : '#ef4444';
                        const complianceIcon = hasResponse ? '✓'
                          : !speakerIsTarget ? '→'
                          : '✗';

                        const formatResponseSummary = () => {
                          if (responseStr) return responseStr;
                          if (!responseObj) return null;
                          const pos = responseObj.position as string | undefined;
                          const reason = responseObj.brief_reason as string ?? responseObj.explanation as string ?? responseObj.conclusion as string ?? '';
                          const cond = responseObj.condition as string | undefined;
                          if (pos) {
                            const posLabel = pos === 'agree' ? 'Agreed' : pos === 'disagree' ? 'Disagreed' : pos === 'conditional' ? 'Conditional' : pos;
                            return `${posLabel}${reason ? `: ${reason}` : ''}${cond && pos !== 'agree' ? ` (Condition: ${cond})` : ''}`;
                          }
                          const typ = responseObj.type as string | undefined;
                          if (typ) return `${typ}${reason ? `: ${reason}` : ''}`;
                          const term = responseObj.term as string | undefined;
                          if (term) return `"${term}": ${responseObj.definition ?? ''}${responseObj.example ? ` (e.g., ${responseObj.example})` : ''}`;
                          const ev = responseObj.evidence as string | undefined;
                          if (ev) return `Evidence: ${ev}`;
                          return JSON.stringify(responseObj);
                        };

                        return (
                          <div style={{
                            marginBottom: 12, padding: '10px 12px', borderRadius: 6,
                            background: 'rgba(168,85,247,0.08)', borderLeft: '3px solid #a855f7',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                              <span style={{ fontWeight: 700, color: '#a855f7', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Moderator Directive
                              </span>
                              <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(168,85,247,0.15)', color: '#a855f7', fontSize: '0.6rem', fontWeight: 600 }}>
                                {moveLabel}{familyLabel ? ` · ${familyLabel}` : ''}
                              </span>
                              {targetLabel && (
                                <span style={{ fontSize: '0.65rem', color: !speakerIsTarget ? '#6366f1' : 'var(--text-muted)', fontWeight: !speakerIsTarget ? 600 : 400 }}>
                                  directed at {targetLabel}{!speakerIsTarget ? ` (not ${speakerLabel(entry.speaker)})` : ''}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 8, fontStyle: 'italic' }}>
                              &ldquo;{directiveText}&rdquo;
                            </div>
                            <div style={{
                              display: 'flex', alignItems: 'flex-start', gap: 8,
                              padding: '6px 10px', borderRadius: 4,
                              background: `${complianceColor}12`,
                              border: `1px solid ${complianceColor}30`,
                            }}>
                              <span style={{
                                width: 8, height: 8, borderRadius: '50%',
                                background: complianceColor,
                                flexShrink: 0, marginTop: 4,
                              }} />
                              <div>
                                {hasResponse && (
                                  <>
                                    <span style={{ fontWeight: 700, fontSize: '0.72rem', color: complianceColor }}>
                                      {complianceIcon} Responded
                                    </span>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginTop: 2 }}>
                                      {formatResponseSummary()}
                                    </div>
                                  </>
                                )}
                                {!hasResponse && !speakerIsTarget && (
                                  <>
                                    <span style={{ fontWeight: 700, fontSize: '0.72rem', color: complianceColor }}>
                                      {complianceIcon} Not targeted
                                    </span>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                      This directive was aimed at {targetLabel}, but {speakerLabel(entry.speaker)} was selected to speak. {speakerLabel(entry.speaker)} was not required to respond.
                                    </div>
                                  </>
                                )}
                                {!hasResponse && speakerIsTarget && (
                                  <>
                                    <span style={{ fontWeight: 700, fontSize: '0.72rem', color: complianceColor }}>
                                      {complianceIcon} No response
                                    </span>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                      The debater did not provide an explicit response to this directive.
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                      {suppressedIntervention && (
                        <div style={{
                          marginBottom: 10, padding: '8px 10px', borderRadius: 6,
                          background: 'rgba(245, 158, 11, 0.08)',
                          border: '1px solid rgba(245, 158, 11, 0.25)',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f59e0b' }}>
                              ⚠ Suppressed Intervention
                            </span>
                            {suppressedIntervention.intervention_move && (
                              <span style={{
                                padding: '1px 6px', borderRadius: 3, fontSize: '0.65rem', fontWeight: 600,
                                background: 'rgba(245, 158, 11, 0.18)', color: '#d97706',
                              }}>
                                {suppressedIntervention.intervention_move}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginBottom: 4 }}>
                            The moderator recommended a <strong>{suppressedIntervention.intervention_move ?? 'intervention'}</strong>
                            {suppressedIntervention.intervention_target && (
                              <> directed at <strong>{speakerLabel(suppressedIntervention.intervention_target)}</strong></>
                            )}
                            , but it was blocked by the engine.
                          </div>
                          {suppressedIntervention.intervention_suppressed_reason && (
                            <div style={{
                              fontSize: '0.65rem', color: '#d97706', padding: '3px 8px', borderRadius: 4,
                              background: 'rgba(245, 158, 11, 0.1)', display: 'inline-block',
                            }}>
                              Reason: {suppressedIntervention.intervention_suppressed_reason.replace(/_/g, ' ')}
                            </div>
                          )}
                          {suppressedIntervention.trigger_reasoning && (
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
                              {suppressedIntervention.trigger_reasoning}
                            </div>
                          )}
                        </div>
                      )}
                      {meta?.move_types && (
                        <Section title={`Dialectical Moves — ${(meta.move_types as (string | MoveAnnotation)[]).map(m => getMoveName(m)).join(', ')}`} defaultOpen copyText={`Moves: ${(meta.move_types as (string | MoveAnnotation)[]).map(m => getMoveName(m)).join(', ')}${meta.disagreement_type ? `\nType: ${meta.disagreement_type}` : ''}`}>
                          {(meta.move_types as (string | MoveAnnotation)[]).map((m, i) => {
                            const name = getMoveName(m);
                            const ann = typeof m === 'object' ? m as MoveAnnotation : null;
                            const edgeInfo = MOVE_EDGE_MAP[name.toUpperCase()] || MOVE_EDGE_MAP[name];
                            const cat = edgeInfo?.edgeType || 'neutral';
                            const catColor = cat === 'attack' ? '#ef4444' : cat === 'support' ? '#22c55e' : '#888';
                            return (
                              <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: `2px solid ${catColor}44` }}>
                                <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, background: 'rgba(59,130,246,0.2)', color: '#3b82f6', fontSize: '0.7rem', fontWeight: 600 }}>{name}</span>
                                <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: `${catColor}18`, color: catColor, fontSize: '0.6rem', fontWeight: 600, textTransform: 'capitalize' }}>{cat}</span>
                                {ann?.target && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--text-muted)' }}>→ {ann.target}</span>}
                                {ann?.detail && <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginTop: 2 }}>{ann.detail}</div>}
                              </div>
                            );
                          })}
                          {meta.disagreement_type && <div style={{ marginTop: 4 }}>Type: <strong>{meta.disagreement_type as string}</strong></div>}
                        </Section>
                      )}

                      {turnValTrail && (
                        <Section
                          title={`Turn Validation — ${turnValTrail.final.outcome} (score ${turnValTrail.final.score.toFixed(2)}, ${turnValTrail.attempts.length} attempt${turnValTrail.attempts.length === 1 ? '' : 's'})`}
                          defaultOpen
                        >
                          <TurnValidationSection trail={turnValTrail} />
                        </Section>
                      )}

                      {diag?.commitment_context && (
                        <Section title="Commitments Injected" defaultOpen copyText={diag.commitment_context}>
                          <ResizablePre tall text={diag.commitment_context} />
                        </Section>
                      )}

                      {(diag as Record<string, unknown>)?.edges_used && ((diag as Record<string, unknown>).edges_used as { source: string; target: string; type: string; confidence: number }[]).length > 0 && (
                        <Section title={`Edges Used (${((diag as Record<string, unknown>).edges_used as unknown[]).length})`} defaultOpen copyText={((diag as Record<string, unknown>).edges_used as { source: string; target: string; type: string; confidence: number }[]).map(e => `${e.source} ${e.type} ${e.target} (${e.confidence.toFixed(2)})`).join('\n')}>
                          <EdgesUsedGrouped edges={(diag as Record<string, unknown>).edges_used as { source: string; target: string; type: string; confidence: number }[]} allEdges={allEdges} taxNodeMap={taxNodeMap} nodeLabels={nodeLabels} />
                        </Section>
                      )}

                      {meta?.key_assumptions && (meta.key_assumptions as { assumption: string; if_wrong: string }[]).length > 0 && (
                        <Section title={`Key Assumptions (${(meta.key_assumptions as unknown[]).length})`} defaultOpen copyText={(meta.key_assumptions as { assumption: string; if_wrong: string }[]).map(a => `Assumes: ${a.assumption}\nIf wrong: ${a.if_wrong}`).join('\n\n')}>
                          {(meta.key_assumptions as { assumption: string; if_wrong: string }[]).map((a, i) => (
                            <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>
                              <div><strong>Assumes:</strong> {a.assumption}</div>
                              <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>If wrong: {a.if_wrong}</div>
                            </div>
                          ))}
                        </Section>
                      )}

                      {((meta?.policy_refs as string[])?.length > 0 || (entry.policy_refs?.length ?? 0) > 0) && (
                        <Section title={`Policy Refs (${((meta?.policy_refs as string[]) || entry.policy_refs || []).length})`} defaultOpen copyText={((meta?.policy_refs as string[]) || entry.policy_refs || []).join(', ')}>
                          <ul style={{ margin: '4px 0', paddingLeft: 0, listStyle: 'none' }}>
                            {((meta?.policy_refs as string[]) || entry.policy_refs || []).map((p, i) => {
                              const pol = policyMap.get(p);
                              return (
                                <li key={i} style={{ margin: '3px 0', display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                  <span style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 3, background: 'rgba(139,92,246,0.15)', color: '#8b5cf6', fontSize: '0.65rem', fontWeight: 600, fontFamily: 'monospace' }}>{p}</span>
                                  {pol ? (
                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-primary)' }}>
                                      {pol.action}
                                      <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                                        ({pol.source_povs.join(', ')}{pol.member_count > 0 ? ` · ${pol.member_count} members` : ''})
                                      </span>
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>not in registry</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </Section>
                      )}

                      {diag?.edge_tensions && (
                        <Section title="Edge Tensions" defaultOpen copyText={diag.edge_tensions}>
                          <ResizablePre tall text={diag.edge_tensions} />
                        </Section>
                      )}

                      {diag?.argument_network_context && (
                        <Section title="Argument Network Context" defaultOpen copyText={diag.argument_network_context}>
                          <ResizablePre tall text={diag.argument_network_context} />
                        </Section>
                      )}

                      {diag?.model && (
                        <Section title={`Model & Timing — ${diag.model} (${diag.response_time_ms ? (diag.response_time_ms / 1000).toFixed(1) + 's' : '?'})`} defaultOpen copyText={`Model: ${diag.model}\nResponse: ${diag.response_time_ms ? (diag.response_time_ms / 1000).toFixed(1) + 's' : '?'}`}>
                          <div>Model: {diag.model}</div>
                          {diag.response_time_ms && <div>Response: {(diag.response_time_ms / 1000).toFixed(1)}s</div>}
                        </Section>
                      )}

                      {entry.content && entry.type === 'opening' && (
                        <Section title="Statement" defaultOpen copyText={entry.content}>
                          <div style={{ fontSize: '0.75rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                            <Highlight text={entry.content} />
                          </div>
                        </Section>
                      )}
                    </div>
                  )}
                  {activeTab === 'moderator' && modTrace && (
                    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
                      <ModeratorTab trace={modTrace} />
                    </div>
                  )}
                  {activeTab === 'brief' && briefStage && (
                    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(59,130,246,0.2)', color: '#3b82f6', fontWeight: 600 }}>BRIEF</span>
                        <span>{briefStage.model}</span>
                        <span>temp={briefStage.temperature}</span>
                        <span>{(briefStage.response_time_ms / 1000).toFixed(1)}s</span>
                      </div>
                      {!!(briefStage.work_product as Record<string, unknown>).situation_assessment && (
                        <div style={{ padding: 8, margin: '6px 0', borderLeft: '3px solid rgba(59,130,246,0.4)', background: 'rgba(59,130,246,0.05)', fontSize: '0.78rem' }}>
                          <Highlight text={String((briefStage.work_product as Record<string, unknown>).situation_assessment)} />
                        </div>
                      )}
                      {Array.isArray((briefStage.work_product as Record<string, unknown>).key_claims_to_address) && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Key Claims to Address</summary>
                          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
                            {((briefStage.work_product as Record<string, unknown>).key_claims_to_address as { claim: string; speaker: string; an_id?: string }[]).map((c, i) => (
                              <li key={i}><strong>{c.speaker}</strong>{c.an_id ? ` (${c.an_id})` : ''}: <Highlight text={c.claim} /></li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {Array.isArray((briefStage.work_product as Record<string, unknown>).strongest_angles) && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Strongest Angles</summary>
                          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
                            {((briefStage.work_product as Record<string, unknown>).strongest_angles as { angle: string; why: string }[]).map((a, i) => (
                              <li key={i}><strong>{a.angle}</strong>: <Highlight text={a.why} /></li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {Array.isArray((briefStage.work_product as Record<string, unknown>).key_tensions) && ((briefStage.work_product as Record<string, unknown>).key_tensions as { tension: string; opportunity: string }[]).length > 0 && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Key Tensions</summary>
                          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
                            {((briefStage.work_product as Record<string, unknown>).key_tensions as { tension: string; opportunity: string }[]).map((t, i) => (
                              <li key={i}><strong>{t.tension}</strong>: <Highlight text={t.opportunity} /></li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {Array.isArray((briefStage.work_product as Record<string, unknown>).relevant_taxonomy_nodes) && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Relevant Taxonomy Nodes</summary>
                          <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse' }}>
                            <tbody>
                              {((briefStage.work_product as Record<string, unknown>).relevant_taxonomy_nodes as { node_id: string; why: string }[]).map((n, i) => {
                                const isSelected = selectedTaxRefId === n.node_id;
                                return (
                                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: isSelected ? 'rgba(245, 158, 11, 0.08)' : 'transparent' }}>
                                    <td style={{ padding: '3px 6px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                                      <button
                                        onClick={() => setSelectedTaxRefId(isSelected ? null : n.node_id)}
                                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontWeight: isSelected ? 700 : 600, textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'inherit', textAlign: 'left' }}
                                        title="Show node details"
                                      >{n.node_id}</button>
                                    </td>
                                    <td style={{ padding: '3px 6px', verticalAlign: 'top' }}><Highlight text={n.why} /></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {selectedTaxRefId && ((briefStage.work_product as Record<string, unknown>).relevant_taxonomy_nodes as { node_id: string }[]).some(n => n.node_id === selectedTaxRefId) && (() => {
                            const node = taxNodeMap.get(selectedTaxRefId) as TaxRefNode | undefined;
                            const povOfId = selectedTaxRefId.startsWith('acc-') ? 'accelerationist'
                              : selectedTaxRefId.startsWith('saf-') ? 'safetyist'
                              : selectedTaxRefId.startsWith('skp-') ? 'skeptic'
                              : selectedTaxRefId.startsWith('sit-') ? 'situations' : '';
                            const nodeEdges = allEdges.filter(e => e.source === selectedTaxRefId || e.target === selectedTaxRefId);
                            return (
                              <TaxonomyRefDetail
                                nodeId={selectedTaxRefId}
                                node={node}
                                pov={povOfId}
                                onClose={() => setSelectedTaxRefId(null)}
                                edges={nodeEdges}
                              />
                            );
                          })()}
                        </details>
                      )}
                      {Array.isArray((briefStage.work_product as Record<string, unknown>).edge_tensions) && ((briefStage.work_product as Record<string, unknown>).edge_tensions as { edge: string; relevance: string }[]).length > 0 && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Edge Tensions</summary>
                          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
                            {((briefStage.work_product as Record<string, unknown>).edge_tensions as { edge: string; relevance: string }[]).map((t, i) => (
                              <li key={i}><strong>{t.edge}</strong>: <Highlight text={t.relevance} /></li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {!!(briefStage.work_product as Record<string, unknown>).phase_considerations && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>
                          <Highlight text={String((briefStage.work_product as Record<string, unknown>).phase_considerations)} />
                        </div>
                      )}
                      <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Prompt</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{briefStage.prompt}</pre>
                      </details>
                      <details><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Response</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{briefStage.raw_response}</pre>
                      </details>
                    </div>
                  )}
                  {activeTab === 'plan' && planStage && (
                    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(168,85,247,0.2)', color: '#a855f7', fontWeight: 600 }}>PLAN</span>
                        <span>{planStage.model}</span>
                        <span>temp={planStage.temperature}</span>
                        <span>{(planStage.response_time_ms / 1000).toFixed(1)}s</span>
                      </div>
                      {!!(planStage.work_product as Record<string, unknown>).strategic_goal && (
                        <div style={{ padding: 8, margin: '6px 0', borderLeft: '3px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.05)', fontSize: '0.78rem', fontWeight: 600 }}>
                          <Highlight text={String((planStage.work_product as Record<string, unknown>).strategic_goal)} />
                        </div>
                      )}
                      {!!(planStage.work_product as Record<string, unknown>).directive_response_plan && (
                        <div style={{ padding: 8, margin: '6px 0', borderLeft: '3px solid rgba(245,158,11,0.6)', background: 'rgba(245,158,11,0.08)', borderRadius: 4, fontSize: '0.75rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(245,158,11,0.2)', color: '#d97706', fontWeight: 600, fontSize: '0.68rem' }}>MODERATOR DIRECTIVE</span>
                          </div>
                          <Highlight text={String((planStage.work_product as Record<string, unknown>).directive_response_plan)} />
                        </div>
                      )}
                      {Array.isArray((planStage.work_product as Record<string, unknown>).planned_moves) && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Planned Moves</summary>
                          {((planStage.work_product as Record<string, unknown>).planned_moves as { move: string; target?: string; detail: string }[]).map((m, i) => (
                            <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid rgba(168,85,247,0.3)' }}>
                              <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, background: 'rgba(168,85,247,0.2)', color: '#a855f7', fontSize: '0.7rem', fontWeight: 600 }}>{m.move}</span>
                              {m.target && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--text-muted)' }}>{'\u2192'} {m.target}</span>}
                              {m.detail && <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginTop: 2 }}><Highlight text={m.detail} /></div>}
                            </div>
                          ))}
                        </details>
                      )}
                      {!!(planStage.work_product as Record<string, unknown>).core_thesis && (
                        <div style={{ padding: 8, margin: '6px 0', borderLeft: '3px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.05)', fontSize: '0.78rem' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.7rem' }}>Core Thesis: </span>
                          <Highlight text={String((planStage.work_product as Record<string, unknown>).core_thesis)} />
                        </div>
                      )}
                      {!!(planStage.work_product as Record<string, unknown>).framing_choices && (
                        <div style={{ padding: 8, margin: '6px 0', borderLeft: '3px solid rgba(168,85,247,0.3)', fontSize: '0.72rem' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.7rem' }}>Framing: </span>
                          <Highlight text={String((planStage.work_product as Record<string, unknown>).framing_choices)} />
                        </div>
                      )}
                      {!!(planStage.work_product as Record<string, unknown>).argument_sketch && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Argument Sketch</summary>
                          <div style={{ fontSize: '0.72rem', padding: 6, background: 'rgba(128,128,128,0.05)', borderRadius: 4 }}>
                            <Highlight text={String((planStage.work_product as Record<string, unknown>).argument_sketch)} />
                          </div>
                        </details>
                      )}
                      {Array.isArray((planStage.work_product as Record<string, unknown>).anticipated_responses) && ((planStage.work_product as Record<string, unknown>).anticipated_responses as string[]).length > 0 && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Anticipated Responses</summary>
                          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
                            {((planStage.work_product as Record<string, unknown>).anticipated_responses as string[]).map((r, i) => (
                              <li key={i}><Highlight text={r} /></li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {Array.isArray((planStage.work_product as Record<string, unknown>).anticipated_challenges) && ((planStage.work_product as Record<string, unknown>).anticipated_challenges as string[]).length > 0 && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Anticipated Challenges</summary>
                          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
                            {((planStage.work_product as Record<string, unknown>).anticipated_challenges as string[]).map((r, i) => (
                              <li key={i}><Highlight text={r} /></li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Prompt</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{planStage.prompt}</pre>
                      </details>
                      <details><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Response</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{planStage.raw_response}</pre>
                      </details>
                    </div>
                  )}
                  {activeTab === 'draft' && (draftStage || entry.content) && (
                    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
                      {draftStage && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(34,197,94,0.2)', color: '#22c55e', fontWeight: 600 }}>DRAFT</span>
                          <span>{draftStage.model}</span>
                          <span>temp={draftStage.temperature}</span>
                          <span>{(draftStage.response_time_ms / 1000).toFixed(1)}s</span>
                        </div>
                      )}
                      {!draftStage && diag && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(34,197,94,0.2)', color: '#22c55e', fontWeight: 600 }}>STATEMENT</span>
                          <span>{diag.model}</span>
                          {diag.response_time_ms && <span>{(diag.response_time_ms / 1000).toFixed(1)}s</span>}
                        </div>
                      )}
                      {!draftStage && entry.content && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Statement</summary>
                          <div style={{ fontSize: '0.75rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                            <Highlight text={entry.content} />
                          </div>
                        </details>
                      )}
                      {/* Fact-check evidence detail — shows web search evidence, queries, and citations */}
                      {entry.type === 'fact-check' && (() => {
                        const fcMeta = (entry.metadata as Record<string, unknown>)?.fact_check as Record<string, unknown> | undefined;
                        if (!fcMeta) return null;
                        const verdict = fcMeta.verdict as string | undefined;
                        const explanation = fcMeta.explanation as string | undefined;
                        const checkedText = fcMeta.checked_text as string | undefined;
                        const webEvidence = fcMeta.web_search_evidence as string | undefined;
                        const webQueries = Array.isArray(fcMeta.web_search_queries) ? fcMeta.web_search_queries as string[] : [];
                        const webCitations = Array.isArray(fcMeta.web_search_citations) ? fcMeta.web_search_citations as Array<{ url?: string; title?: string; startIndex?: number; endIndex?: number }> : [];
                        const targetAnId = fcMeta.target_an_id as string | undefined;
                        const isAuto = !!targetAnId;
                        return (<>
                          <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Verdict</summary>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: '0.7rem' }}>
                              <span style={{
                                padding: '1px 8px', borderRadius: 4, fontWeight: 600, color: '#fff',
                                background: verdict === 'verified' || verdict === 'supported' ? '#16a34a' : verdict === 'disputed' || verdict === 'false' ? '#dc2626' : '#6b7280',
                              }}>{verdict ?? 'unknown'}</span>
                              <span style={{ color: 'var(--text-muted)' }}>{isAuto ? 'auto-verified' : 'user-initiated'}</span>
                              {targetAnId && <span style={{ color: 'var(--text-muted)' }}>AN: {targetAnId}</span>}
                            </div>
                            {checkedText && (
                              <div style={{ fontSize: '0.7rem', padding: '4px 8px', background: 'rgba(249,115,22,0.08)', borderRadius: 4, borderLeft: '3px solid #f97316', marginBottom: 6 }}>
                                {checkedText}
                              </div>
                            )}
                            {explanation && (
                              <div style={{ fontSize: '0.7rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{explanation}</div>
                            )}
                          </details>
                          {webQueries.length > 0 && (() => {
                            const isDomains = webQueries.every(q => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(q.trim()));
                            const searchText = checkedText || '';
                            const allSameQuery = !isDomains;
                            return (
                              <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>
                                {isDomains ? `Web Sources (${webQueries.length})` : `Search Queries (${webQueries.length})`}
                              </summary>
                                {isDomains && searchText && (
                                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 4, fontStyle: 'italic' }}>
                                    Query: &quot;{searchText.length > 100 ? searchText.slice(0, 97) + '...' : searchText}&quot;
                                  </div>
                                )}
                                <ul style={{ fontSize: '0.68rem', margin: '4px 0', paddingLeft: 16, listStyle: 'none' }}>
                                  {webQueries.map((q, qi) => {
                                    const trimmed = q.trim();
                                    const looksLikeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(trimmed);
                                    const searchUrl = looksLikeDomain
                                      ? `https://www.google.com/search?q=${encodeURIComponent(searchText + ' site:' + trimmed)}`
                                      : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
                                    return (
                                      <li key={qi} style={{ marginBottom: 2 }}>
                                        <a
                                          href={searchUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
                                          title={looksLikeDomain ? `Search "${searchText}" on ${trimmed}` : `Search Google for "${trimmed}"`}
                                        >
                                          {trimmed}
                                        </a>
                                        {!allSameQuery && !looksLikeDomain && (
                                          <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: '0.6rem' }}>(query)</span>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </details>
                            );
                          })()}
                          {webEvidence && (
                            <details><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Web Evidence</summary>
                              <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto', background: 'var(--bg-secondary)', padding: 8, borderRadius: 4 }}>{webEvidence}</pre>
                            </details>
                          )}
                          {webCitations.length > 0 && (
                            <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Citations ({webCitations.length})</summary>
                              <div style={{ fontSize: '0.65rem' }}>
                                {webCitations.map((c, ci) => (
                                  <div key={ci} style={{ margin: '2px 0', paddingLeft: 8, borderLeft: '2px solid rgba(34,197,94,0.3)' }}>
                                    {c.title && <div style={{ fontWeight: 600 }}>{c.title}</div>}
                                    {c.url && <div style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>{c.url}</div>}
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </>);
                      })()}
                      {draftStage && Array.isArray((draftStage.work_product as Record<string, unknown>).claim_sketches) && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Claim Sketches</summary>
                          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
                            {((draftStage.work_product as Record<string, unknown>).claim_sketches as { claim: string; targets: string[] }[]).map((c, i) => (
                              <li key={i}>{c.claim}{c.targets?.length > 0 ? ` \u2192 ${c.targets.join(', ')}` : ''}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {draftStage && Array.isArray((draftStage.work_product as Record<string, unknown>).key_assumptions) && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Key Assumptions</summary>
                          {((draftStage.work_product as Record<string, unknown>).key_assumptions as { assumption: string; if_wrong: string }[]).map((a, i) => (
                            <div key={i} style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid rgba(34,197,94,0.3)' }}>
                              <div><strong>Assumption:</strong> {a.assumption}</div>
                              <div style={{ color: 'var(--text-muted)' }}><strong>If wrong:</strong> {a.if_wrong}</div>
                            </div>
                          ))}
                        </details>
                      )}
                      {draftStage && !!(draftStage.work_product as Record<string, unknown>).disagreement_type && (
                        <div style={{ fontSize: '0.72rem', marginTop: 6 }}>
                          <strong>Disagreement type:</strong> <Highlight text={String((draftStage.work_product as Record<string, unknown>).disagreement_type)} />
                        </div>
                      )}
                      {draftStage && !!(draftStage.work_product as Record<string, unknown>).statement && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Statement</summary>
                          <div style={{ fontSize: '0.75rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                            <Highlight text={String((draftStage.work_product as Record<string, unknown>).statement)} />
                          </div>
                        </details>
                      )}
                      {draftStage && (<>
                      <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Prompt</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{draftStage.prompt}</pre>
                      </details>
                      <details><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Response</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{draftStage.raw_response}</pre>
                      </details>
                      </>)}
                    </div>
                  )}
                  {activeTab === 'cite' && citeStage && (
                    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(251,146,60,0.2)', color: '#fb923c', fontWeight: 600 }}>CITE</span>
                        <span>{citeStage.model}</span>
                        <span>temp={citeStage.temperature}</span>
                        <span>{(citeStage.response_time_ms / 1000).toFixed(1)}s</span>
                        {typeof (citeStage.work_product as Record<string, unknown>).grounding_confidence === 'number' && (
                          <span style={{ padding: '1px 6px', borderRadius: 3, background: (citeStage.work_product as Record<string, unknown>).grounding_confidence as number >= 0.7 ? 'rgba(34,197,94,0.2)' : 'rgba(251,146,60,0.2)', fontSize: '0.65rem' }}>
                            confidence: {((citeStage.work_product as Record<string, unknown>).grounding_confidence as number).toFixed(2)}
                          </span>
                        )}
                      </div>
                      {Array.isArray((citeStage.work_product as Record<string, unknown>).taxonomy_refs) && (() => {
                        const briefNodes = new Set(
                          Array.isArray((briefStage?.work_product as Record<string, unknown> | undefined)?.relevant_taxonomy_nodes)
                            ? ((briefStage!.work_product as Record<string, unknown>).relevant_taxonomy_nodes as { node_id: string }[]).map(n => n.node_id)
                            : [],
                        );
                        return (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Taxonomy References</summary>
                          <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse' }}>
                            <tbody>
                              {((citeStage.work_product as Record<string, unknown>).taxonomy_refs as { node_id: string; relevance: string }[]).map((r, i) => {
                                const isSelected = selectedTaxRefId === r.node_id;
                                const isNew = !briefNodes.has(r.node_id);
                                return (
                                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: isSelected ? 'rgba(245, 158, 11, 0.08)' : 'transparent' }}>
                                    <td style={{ padding: '3px 6px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                                      <button
                                        onClick={() => setSelectedTaxRefId(isSelected ? null : r.node_id)}
                                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontWeight: isSelected ? 700 : 600, textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'inherit', textAlign: 'left' }}
                                        title="Show node details"
                                      >{r.node_id}</button>
                                      {isNew && (
                                        <span title="New: not in Brief's relevant taxonomy nodes" style={{ marginLeft: 3, color: '#22c55e', fontWeight: 700, fontSize: '0.8em' }}>+</span>
                                      )}
                                    </td>
                                    <td style={{ padding: '3px 6px', verticalAlign: 'top' }}><Highlight text={r.relevance} /></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {selectedTaxRefId && ((citeStage.work_product as Record<string, unknown>).taxonomy_refs as { node_id: string }[]).some(r => r.node_id === selectedTaxRefId) && (() => {
                            const node = taxNodeMap.get(selectedTaxRefId) as TaxRefNode | undefined;
                            const povOfId = selectedTaxRefId.startsWith('acc-') ? 'accelerationist'
                              : selectedTaxRefId.startsWith('saf-') ? 'safetyist'
                              : selectedTaxRefId.startsWith('skp-') ? 'skeptic'
                              : selectedTaxRefId.startsWith('sit-') ? 'situations' : '';
                            const nodeEdges = allEdges.filter(e => e.source === selectedTaxRefId || e.target === selectedTaxRefId);
                            return (
                              <TaxonomyRefDetail
                                nodeId={selectedTaxRefId}
                                node={node}
                                pov={povOfId}
                                onClose={() => setSelectedTaxRefId(null)}
                                edges={nodeEdges}
                              />
                            );
                          })()}
                        </details>
                        );
                      })()}
                      {Array.isArray((citeStage.work_product as Record<string, unknown>).move_annotations) && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Move Annotations</summary>
                          {((citeStage.work_product as Record<string, unknown>).move_annotations as { move: string; target?: string; detail: string }[]).map((m, i) => (
                            <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid rgba(251,146,60,0.3)' }}>
                              <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, background: 'rgba(251,146,60,0.2)', color: '#fb923c', fontSize: '0.7rem', fontWeight: 600 }}>{m.move}</span>
                              {m.target && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--text-muted)' }}>{'\u2192'} {m.target}</span>}
                              {m.detail && <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginTop: 2 }}><Highlight text={m.detail} /></div>}
                            </div>
                          ))}
                        </details>
                      )}
                      {Array.isArray((citeStage.work_product as Record<string, unknown>).policy_refs) && ((citeStage.work_product as Record<string, unknown>).policy_refs as string[]).length > 0 && (
                        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Policy References</summary>
                          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16, listStyle: 'none' }}>
                            {((citeStage.work_product as Record<string, unknown>).policy_refs as string[]).map((p, i) => {
                              const isSelected = selectedPolicyId === p;
                              return (
                                <li key={i} style={{ margin: '2px 0' }}>
                                  <button
                                    onClick={() => setSelectedPolicyId(isSelected ? null : p)}
                                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#8b5cf6', fontWeight: isSelected ? 700 : 600, textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'inherit' }}
                                    title="Show policy details"
                                  >{p}</button>
                                </li>
                              );
                            })}
                          </ul>
                          {selectedPolicyId && (() => {
                            const pol = policyMap.get(selectedPolicyId);
                            return (
                              <div style={{ margin: '6px 0', padding: '8px 10px', borderRadius: 6, background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#8b5cf6', fontSize: '0.72rem' }}>{selectedPolicyId}</span>
                                  <button onClick={() => setSelectedPolicyId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem' }}>×</button>
                                </div>
                                {pol ? (<>
                                  <div style={{ fontSize: '0.75rem', lineHeight: 1.5, marginBottom: 4 }}>{pol.action}</div>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                                    POVs: {pol.source_povs.join(', ')} · {pol.member_count} member{pol.member_count !== 1 ? 's' : ''}
                                  </div>
                                </>) : (
                                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Policy not found in registry</div>
                                )}
                              </div>
                            );
                          })()}
                        </details>
                      )}
                      <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Prompt</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{citeStage.prompt}</pre>
                      </details>
                      <details><summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Raw Response</summary>
                        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{citeStage.raw_response}</pre>
                      </details>
                    </div>
                  )}
                  {activeTab === 'claims' && (
                    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
                      {meta?.my_claims && (meta.my_claims as { claim: string; targets: string[] }[]).length > 0 && (
                        <Section title={`Claim Sketches (${(meta.my_claims as unknown[]).length})`} copyText={(meta.my_claims as { claim: string; targets: string[] }[]).map((c, i) => `${i + 1}. ${c.claim}${c.targets?.length > 0 ? ` → ${c.targets.join(', ')}` : ''}`).join('\n')}>
                          {(meta.my_claims as { claim: string; targets: string[] }[]).map((c, i) => (
                            <div key={i} style={{ margin: '3px 0', fontSize: '0.7rem' }}>
                              <span style={{ color: '#3b82f6' }}>{i + 1}.</span> <Highlight text={c.claim} />
                              {c.targets?.length > 0 && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>→ {c.targets.join(', ')}</span>}
                            </div>
                          ))}
                        </Section>
                      )}

                      {diag?.extracted_claims && (
                        <Section title={`Extracted Claims (${diag.extracted_claims.accepted.length} accepted, ${diag.extracted_claims.rejected.length} rejected)`} defaultOpen copyText={[...diag.extracted_claims.accepted.map(c => `✓ ${c.id} (${c.overlap_pct}%): ${c.text}`), ...diag.extracted_claims.rejected.map(c => `✗ (${c.overlap_pct}%): ${c.text} — ${c.reason}`)].join('\n')}>
                          {diag.extracted_claims.accepted.map((c, i) => {
                            const outEdges = an?.edges.filter(e => e.source === c.id) ?? [];
                            const edgeSummary = outEdges.map(edge => {
                              const label = edge.type === 'attacks'
                                ? (edge.attack_type ? `attacks(${edge.attack_type})` : 'attacks')
                                : 'supports';
                              return `${label} ${edge.target}`;
                            }).join(', ');
                            return (
                              <details key={i} style={{ margin: '4px 0' }}>
                                <summary style={{ cursor: 'pointer' }}>
                                  <span style={{ color: '#22c55e' }}>✓ {c.id}</span> <span data-tooltip={`Word Overlap: ${c.overlap_pct}%\n\nMeasures grounding of claim in the debater's statement.\nFormula: shared words ≥4 chars / total claim words ≥4 chars × 100.\n\nThreshold: < 10-15% = rejected as not grounded.\n${c.overlap_pct}% = ${c.overlap_pct < 50 ? 'moderate' : 'strong'} lexical grounding.`} style={{ color: 'var(--text-muted)', fontSize: '0.65rem', cursor: 'help' }}>{c.overlap_pct}%</span> <Highlight text={c.text} />
                                  {outEdges.length > 0 && (
                                    <span style={{ fontSize: '0.6rem', marginLeft: 6, color: 'var(--text-muted)' }}>
                                      [{edgeSummary}]
                                    </span>
                                  )}
                                </summary>
                                {outEdges.length > 0 && (
                                  <div style={{ paddingLeft: 20, marginTop: 4, marginBottom: 4 }}>
                                    {outEdges.map((edge, ei) => {
                                      const targetNode = an?.nodes.find(n => n.id === edge.target);
                                      const edgeLabel = edge.type === 'attacks'
                                        ? (edge.attack_type ? `attacks (${edge.attack_type})` : 'attacks')
                                        : 'supports';
                                      return (
                                        <div key={ei} style={{ fontSize: '0.65rem', margin: '3px 0', paddingLeft: 10, borderLeft: `2px solid ${edge.type === 'attacks' ? '#ef4444' : '#22c55e'}` }}>
                                          <div>
                                            <span style={{ color: edge.type === 'attacks' ? '#ef4444' : '#22c55e', fontWeight: 600 }}>{edgeLabel}</span>
                                            {edge.argumentation_scheme && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>[{edge.argumentation_scheme}]</span>}
                                          </div>
                                          {targetNode && (
                                            <div style={{ color: 'var(--text-muted)', marginTop: 1 }}>
                                              <span style={{ fontWeight: 600 }}>{targetNode.id}</span> ({POVER_INFO[targetNode.speaker as keyof typeof POVER_INFO]?.label ?? targetNode.speaker}): {targetNode.text}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </details>
                            );
                          })}
                          {diag.extracted_claims.rejected.map((c, i) => (
                            <div key={i} style={{ margin: '3px 0' }}>
                              <span style={{ color: '#ef4444' }}>✗</span> <span data-tooltip={`Word Overlap: ${c.overlap_pct}%\n\nMeasures grounding of claim in the debater's statement.\nFormula: shared words ≥4 chars / total claim words ≥4 chars × 100.\n\nRejected: ${c.reason === 'low_overlap' ? 'overlap too low (not grounded)' : c.reason === 'duplicate_claim' ? 'duplicate (too similar to existing AN node)' : c.reason}.`} style={{ color: 'var(--text-muted)', fontSize: '0.65rem', cursor: 'help' }}>{c.overlap_pct}%</span> <Highlight text={c.text} />
                              <div style={{ color: '#f59e0b', fontSize: '0.65rem', paddingLeft: 16 }}>{c.reason}</div>
                            </div>
                          ))}
                        </Section>
                      )}
                    </div>
                  )}
                </div>
                {textCopyMenu && (
                  <div
                    onMouseDown={e => e.stopPropagation()}
                    style={{
                      position: 'fixed', left: textCopyMenu.x, top: textCopyMenu.y, zIndex: 9999,
                      background: 'var(--bg-primary)', border: '1px solid var(--border)',
                      borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                      padding: '4px 0', minWidth: 120, fontSize: '0.72rem',
                    }}
                  >
                    <button
                      onClick={() => { navigator.clipboard.writeText(textCopyMenu.text); setTextCopyMenu(null); }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '5px 12px', border: 'none', background: 'transparent',
                        color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.72rem',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.1)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >Copy</button>
                    <button
                      onClick={() => {
                        if (tabContentRef.current) {
                          const range = document.createRange();
                          range.selectNodeContents(tabContentRef.current);
                          const sel = window.getSelection();
                          sel?.removeAllRanges();
                          sel?.addRange(range);
                        }
                        setTextCopyMenu(null);
                      }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '5px 12px', border: 'none', background: 'transparent',
                        color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.72rem',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.1)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >Select All</button>
                  </div>
                )}
              </div>
            );
          })()}

            </div>
            );
          })()}

          </div>{/* end content area */}
        </div>
      )}
    </div>
      <DiagnosticsChatSidebar
        debate={debate}
        selectedEntry={selectedEntry}
        currentTab={entryTab}
        onNavigate={handleChatNavigate}
      />
    </div>
    </DiagSearchContext.Provider>
  );
}
