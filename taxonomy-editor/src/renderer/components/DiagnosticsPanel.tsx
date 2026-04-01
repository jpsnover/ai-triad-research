// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useCallback } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { POVER_INFO } from '../types/debate';
import type { PoverId, EntryDiagnostics, DebateDiagnostics } from '../types/debate';

const AIF_TOOLTIPS = {
  'I-node': 'I-node (Information node) — a claim, proposition, or data point. These are the passive content of arguments: what is being asserted.',
  'CA': 'CA-node (Conflict Application) — an attack relationship. Three types: rebut (contradicts conclusion), undercut (denies the inference), undermine (attacks premise credibility).',
  'RA': 'RA-node (Rule Application) — an inference scheme explaining WHY one claim supports another. The warrant is the reasoning pattern connecting evidence to conclusion.',
  'PA': 'PA-node (Preference Application) — resolves conflicts by determining which argument prevails and why, based on criteria like evidence strength or logical validity.',
};

function speakerLabel(speaker: PoverId | 'system' | 'document'): string {
  if (speaker === 'system') return 'Moderator';
  if (speaker === 'user') return 'You';
  if (speaker === 'document') return 'Document';
  return POVER_INFO[speaker as Exclude<PoverId, 'user'>]?.label || speaker;
}

function CollapsibleSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="diag-section">
      <button className="diag-section-header" onClick={() => setOpen(!open)}>
        <span>{open ? '▼' : '▶'}</span> {title}
      </button>
      {open && <div className="diag-section-body">{children}</div>}
    </div>
  );
}

function EntryView({ entryId }: { entryId: string }) {
  const { activeDebate } = useDebateStore();
  if (!activeDebate) return null;

  const entry = activeDebate.transcript.find(e => e.id === entryId);
  if (!entry) return <div className="diag-empty">Entry not found</div>;

  const diag: EntryDiagnostics | undefined = activeDebate.diagnostics?.entries[entryId];
  const meta = entry.metadata as Record<string, unknown> | undefined;

  return (
    <div className="diag-entry-view">
      <div className="diag-entry-header">
        <span className="diag-entry-speaker">{speakerLabel(entry.speaker)}</span>
        <span className="diag-entry-type">{entry.type}</span>
      </div>

      {/* Model & Timing */}
      {diag?.model && (
        <CollapsibleSection title={`Model & Timing — ${diag.model} (${diag.response_time_ms ? (diag.response_time_ms / 1000).toFixed(1) + 's' : '?'})`} defaultOpen>
          <div className="diag-kv">
            <span className="diag-k">Model:</span> <span className="diag-v">{diag.model}</span>
          </div>
          {diag.response_time_ms && (
            <div className="diag-kv">
              <span className="diag-k">Response time:</span> <span className="diag-v">{(diag.response_time_ms / 1000).toFixed(1)}s</span>
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Dialectical Moves */}
      {meta?.move_types && (
        <CollapsibleSection title={`Dialectical Moves — ${(meta.move_types as string[]).join(', ')}`} defaultOpen>
          <div className="diag-badges">
            {(meta.move_types as string[]).map((m, i) => (
              <span key={i} className="diag-badge diag-badge-move">{m}</span>
            ))}
          </div>
          {meta.disagreement_type && (
            <div className="diag-kv" style={{ marginTop: 4 }}>
              <span className="diag-k">Disagreement type:</span>
              <span className="diag-badge diag-badge-type">{meta.disagreement_type as string}</span>
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Key Assumptions */}
      {meta?.key_assumptions && (meta.key_assumptions as { assumption: string; if_wrong: string }[]).length > 0 && (
        <CollapsibleSection title={`Key Assumptions (${(meta.key_assumptions as unknown[]).length})`}>
          {(meta.key_assumptions as { assumption: string; if_wrong: string }[]).map((a, i) => (
            <div key={i} className="diag-assumption">
              <div><strong>Assumes:</strong> {a.assumption}</div>
              <div className="diag-muted">If wrong: {a.if_wrong}</div>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Extracted Claims */}
      {diag?.extracted_claims && (
        <CollapsibleSection title={`Extracted Claims (${diag.extracted_claims.accepted.length} accepted, ${diag.extracted_claims.rejected.length} rejected)`} defaultOpen>
          {diag.extracted_claims.accepted.map((c, i) => (
            <div key={i} className="diag-claim diag-claim-accepted">
              <span className="diag-claim-status">✓ {c.id}</span>
              <span className="diag-claim-overlap">{c.overlap_pct}%</span>
              <span className="diag-claim-text">{c.text}</span>
            </div>
          ))}
          {diag.extracted_claims.rejected.map((c, i) => (
            <div key={i} className="diag-claim diag-claim-rejected">
              <span className="diag-claim-status">✗</span>
              <span className="diag-claim-overlap">{c.overlap_pct}%</span>
              <span className="diag-claim-text">{c.text}</span>
              <span className="diag-claim-reason">{c.reason}</span>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Taxonomy Context */}
      {diag?.taxonomy_context && (
        <CollapsibleSection title="Taxonomy Context (BDI)">
          <textarea readOnly className="diag-textarea" value={diag.taxonomy_context} />
        </CollapsibleSection>
      )}

      {/* Commitment Context */}
      {diag?.commitment_context && (
        <CollapsibleSection title="Commitments Injected">
          <textarea readOnly className="diag-textarea" value={diag.commitment_context} />
        </CollapsibleSection>
      )}

      {/* Edge Tensions (moderator only) */}
      {diag?.edge_tensions && (
        <CollapsibleSection title="Edge Tensions Considered">
          <textarea readOnly className="diag-textarea" value={diag.edge_tensions} />
        </CollapsibleSection>
      )}

      {/* AN Context (moderator only) */}
      {diag?.argument_network_context && (
        <CollapsibleSection title="Argument Network State">
          <textarea readOnly className="diag-textarea" value={diag.argument_network_context} />
        </CollapsibleSection>
      )}

      {/* Taxonomy Refs */}
      {entry.taxonomy_refs.length > 0 && (
        <CollapsibleSection title={`Taxonomy Refs (${entry.taxonomy_refs.length})`}>
          {entry.taxonomy_refs.map((r, i) => (
            <div key={i} className="diag-ref">
              <span className="diag-ref-id">{r.node_id}</span>
              <span className="diag-ref-rel">{r.relevance?.slice(0, 100)}</span>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Key Assumptions */}
      {meta?.key_assumptions && (meta.key_assumptions as { assumption: string; if_wrong: string }[]).length > 0 && (
        <CollapsibleSection title={`Key Assumptions (${(meta.key_assumptions as unknown[]).length})`}>
          {(meta.key_assumptions as { assumption: string; if_wrong: string }[]).map((a, i) => (
            <div key={i} className="diag-assumption">
              <div><strong>Assumes:</strong> {a.assumption}</div>
              <div className="diag-muted">If wrong: {a.if_wrong}</div>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Claim Sketches */}
      {meta?.my_claims && (meta.my_claims as { claim: string; targets: string[] }[]).length > 0 && (
        <CollapsibleSection title={`Claim Sketches (${(meta.my_claims as unknown[]).length})`}>
          {(meta.my_claims as { claim: string; targets: string[] }[]).map((c, i) => (
            <div key={i} style={{ margin: '2px 0', fontSize: '0.7rem' }}>
              <span style={{ color: '#3b82f6' }}>{i + 1}.</span> {c.claim}
              {c.targets?.length > 0 && <span className="diag-muted" style={{ marginLeft: 6 }}>→ {c.targets.join(', ')}</span>}
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Policy Refs */}
      {((meta?.policy_refs as string[])?.length > 0 || (entry.policy_refs?.length ?? 0) > 0) && (
        <CollapsibleSection title={`Policy Refs (${((meta?.policy_refs as string[]) || entry.policy_refs || []).length})`}>
          <div className="diag-badges">
            {((meta?.policy_refs as string[]) || entry.policy_refs || []).map((p, i) => (
              <span key={i} className="diag-badge" style={{ background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }}>{p}</span>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Full Prompt */}
      {diag?.prompt && (
        <CollapsibleSection title="Full Prompt Sent to AI">
          <textarea readOnly className="diag-textarea" value={diag.prompt} />
        </CollapsibleSection>
      )}

      {/* Raw Response */}
      {diag?.raw_response && (
        <CollapsibleSection title="Raw AI Response">
          <textarea readOnly className="diag-textarea" value={diag.raw_response} />
        </CollapsibleSection>
      )}

      {!diag && !meta?.move_types && entry.taxonomy_refs.length === 0 && (
        <div className="diag-empty">No diagnostic data captured for this entry. Enable diagnostics mode before running the debate.</div>
      )}
    </div>
  );
}

function OverviewView() {
  const { activeDebate } = useDebateStore();
  if (!activeDebate) return null;

  const an = activeDebate.argument_network;
  const commitments = activeDebate.commitments;
  const diag = activeDebate.diagnostics;

  return (
    <div className="diag-overview">
      {/* Argument Network */}
      {an && an.nodes.length > 0 && (() => {
        const caCount = an.edges.filter(e => e.type === 'attacks').length;
        const raCount = an.edges.filter(e => e.type === 'supports').length;
        return (
        <CollapsibleSection title={`Argument Network — ${an.nodes.length} I-nodes, ${caCount} CA-nodes, ${raCount} RA-nodes`} defaultOpen>
          {an.nodes.map(n => {
            const attacks = an.edges.filter(e => e.target === n.id && e.type === 'attacks');
            const supports = an.edges.filter(e => e.target === n.id && e.type === 'supports');
            const responded = attacks.length > 0 || supports.length > 0;
            const isSource = an.edges.some(e => e.source === n.id);
            return (
              <div key={n.id} className="diag-an-node">
                <div className="diag-an-claim">
                  <span className="diag-badge diag-badge-move" style={{ fontSize: '0.55rem', cursor: 'default' }} title={AIF_TOOLTIPS['I-node']}>I-node</span>
                  <span className="diag-an-id">{n.id}</span>
                  <span className="diag-an-speaker">({speakerLabel(n.speaker)})</span>
                  {!responded && !isSource && <span style={{ color: '#f59e0b', fontSize: '0.6rem' }}>[unaddressed]</span>}
                </div>
                <div style={{ paddingLeft: 8, fontSize: '0.7rem' }}>{n.text}</div>
                {attacks.map(a => (
                  <div key={a.id} className="diag-an-edge diag-an-attack">
                    <span className="diag-badge" style={{ fontSize: '0.5rem', background: 'rgba(239,68,68,0.15)', color: '#ef4444', cursor: 'default' }} title={AIF_TOOLTIPS['CA']}>CA</span>
                    ← {a.source} <strong>{a.attack_type}</strong>{a.scheme ? ` via ${a.scheme}` : ''}
                    {a.warrant && <div style={{ paddingLeft: 16, color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.65rem' }}>Warrant: {a.warrant}</div>}
                  </div>
                ))}
                {supports.map(s => (
                  <div key={s.id} className="diag-an-edge diag-an-support">
                    <span className="diag-badge" style={{ fontSize: '0.5rem', background: 'rgba(34,197,94,0.15)', color: '#22c55e', cursor: 'default' }} title={AIF_TOOLTIPS['RA']}>RA</span>
                    ← {s.source} supports
                    {s.warrant && <div style={{ paddingLeft: 16, color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.65rem' }}>Warrant: {s.warrant}</div>}
                  </div>
                ))}
              </div>
            );
          })}
        </CollapsibleSection>
        );
      })()}

      {/* Commitment Stores */}
      {commitments && Object.keys(commitments).length > 0 && (
        <CollapsibleSection title="Commitment Stores" defaultOpen>
          {Object.entries(commitments).map(([poverId, store]) => (
            <div key={poverId} className="diag-commit-store">
              <strong>{speakerLabel(poverId as PoverId)}</strong>
              <div className="diag-commit-counts">
                Asserted: {store.asserted.length} | Conceded: {store.conceded.length} | Challenged: {store.challenged.length}
              </div>
              {store.conceded.length > 0 && (
                <div className="diag-commit-list">
                  <span className="diag-muted">Conceded:</span>
                  {store.conceded.map((c, i) => <div key={i} className="diag-commit-item">• {c}</div>)}
                </div>
              )}
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Overview Stats */}
      {diag && (
        <CollapsibleSection title="Session Statistics" defaultOpen>
          <div className="diag-kv"><span className="diag-k">AI calls:</span> <span className="diag-v">{diag.overview.total_ai_calls}</span></div>
          <div className="diag-kv"><span className="diag-k">Total response time:</span> <span className="diag-v">{(diag.overview.total_response_time_ms / 1000).toFixed(1)}s</span></div>
          <div className="diag-kv"><span className="diag-k">Claims accepted:</span> <span className="diag-v">{diag.overview.claims_accepted}</span></div>
          <div className="diag-kv"><span className="diag-k">Claims rejected:</span> <span className="diag-v">{diag.overview.claims_rejected}</span></div>
          {Object.keys(diag.overview.move_type_counts).length > 0 && (
            <div style={{ marginTop: 6 }}>
              <span className="diag-k">Move types:</span>
              <div className="diag-badges">
                {Object.entries(diag.overview.move_type_counts).sort((a, b) => b[1] - a[1]).map(([m, c]) => (
                  <span key={m} className="diag-badge diag-badge-move">{m} ({c})</span>
                ))}
              </div>
            </div>
          )}
        </CollapsibleSection>
      )}

      {!an?.nodes.length && !commitments && !diag && (
        <div className="diag-empty">No diagnostic data available. Enable diagnostics and run a debate to see the argument network, commitments, and statistics.</div>
      )}
    </div>
  );
}

export function DiagnosticsPanel() {
  const { selectedDiagEntry, selectDiagEntry } = useDebateStore();
  const [height, setHeight] = useState(() => {
    try { return parseInt(localStorage.getItem('diag-panel-height') || '250', 10); } catch { return 250; }
  });
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = height;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startY.current - ev.clientY; // dragging up increases height
      const newH = Math.max(100, Math.min(window.innerHeight * 0.7, startH.current + delta));
      setHeight(newH);
    };
    const onMouseUp = () => {
      dragging.current = false;
      try { localStorage.setItem('diag-panel-height', String(height)); } catch { /* ignore */ }
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [height]);

  return (
    <div className="diagnostics-panel-wrapper">
      <div className="diagnostics-resize-handle" onMouseDown={onMouseDown} />
      <div className="diagnostics-panel" style={{ height }}>
        <div className="diagnostics-panel-header">
          <h3>Diagnostics</h3>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {selectedDiagEntry && (
              <button className="btn btn-sm" onClick={() => selectDiagEntry(null)} style={{ fontSize: '0.65rem' }}>
                Overview
              </button>
            )}
            <button className="btn btn-sm" onClick={async () => {
              await window.electronAPI.openDiagnosticsWindow();
              useDebateStore.getState().setDiagPopoutOpen(true);
              const debate = useDebateStore.getState().activeDebate;
              const entry = useDebateStore.getState().selectedDiagEntry;
              setTimeout(() => {
                window.electronAPI.sendDiagnosticsState({ debate, selectedEntry: entry });
              }, 1000);
            }} style={{ fontSize: '0.65rem' }} title="Open in separate window">
              Popout
            </button>
          </div>
        </div>
        <div className="diagnostics-panel-body">
          {selectedDiagEntry ? (
            <EntryView entryId={selectedDiagEntry} />
          ) : (
            <OverviewView />
          )}
        </div>
      </div>
    </div>
  );
}
