// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Standalone diagnostics window — always-on-top popout that receives
 * state updates from the main window via IPC.
 */

import { useState, useEffect } from 'react';
import { POVER_INFO } from '../types/debate';
import type { PoverId, DebateSession, EntryDiagnostics, ArgumentNetworkNode, ArgumentNetworkEdge, CommitmentStore } from '../types/debate';

function speakerLabel(speaker: string): string {
  if (speaker === 'system') return 'Moderator';
  if (speaker === 'user') return 'You';
  return POVER_INFO[speaker as Exclude<PoverId, 'user'>]?.label || speaker;
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ background: 'none', border: 'none', color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', padding: '4px 0', width: '100%', textAlign: 'left' }}
      >
        {open ? '▼' : '▶'} {title}
      </button>
      {open && <div style={{ paddingLeft: 16, fontSize: '0.75rem' }}>{children}</div>}
    </div>
  );
}

function ResizablePre({ text }: { text: string }) {
  return (
    <textarea
      readOnly
      value={text}
      style={{
        width: '100%',
        minHeight: 60,
        maxHeight: 400,
        resize: 'vertical',
        fontFamily: 'monospace',
        fontSize: '0.65rem',
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

export function DiagnosticsWindow() {
  const [debate, setDebate] = useState<DebateSession | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);

  useEffect(() => {
    const unsub = window.electronAPI.onDiagnosticsStateUpdate((state) => {
      const s = state as { debate: DebateSession | null; selectedEntry: string | null };
      setDebate(s.debate);
      setSelectedEntry(s.selectedEntry);
    });
    return unsub;
  }, []);

  const entry = selectedEntry ? debate?.transcript.find(e => e.id === selectedEntry) : null;
  const diag: EntryDiagnostics | undefined = selectedEntry ? debate?.diagnostics?.entries[selectedEntry] : undefined;
  const meta = entry?.metadata as Record<string, unknown> | undefined;
  const an = debate?.argument_network;
  const commitments = debate?.commitments;

  return (
    <div style={{ padding: 12, height: '100vh', overflow: 'auto', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: '1rem', color: '#f59e0b' }}>Debate Diagnostics</h2>
      {!debate && <p style={{ color: 'var(--text-muted)' }}>Waiting for debate data from main window...</p>}

      {debate && !selectedEntry && (
        <>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
            Click a transcript entry in the main window to inspect it here. Showing overview.
          </p>

          {/* Argument Network */}
          {an && an.nodes.length > 0 && (
            <Section title={`Argument Network (${an.nodes.length} claims, ${an.edges.length} edges)`} defaultOpen>
              {an.nodes.map(n => {
                const attacks = an.edges.filter(e => e.target === n.id && e.type === 'attacks');
                return (
                  <div key={n.id} style={{ margin: '4px 0', paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
                    <div><strong style={{ color: 'var(--accent)' }}>{n.id}</strong> <span style={{ color: 'var(--text-muted)' }}>({speakerLabel(n.speaker)})</span> {n.text}</div>
                    {attacks.map(a => (
                      <div key={a.id} style={{ paddingLeft: 16, color: '#ef4444', fontSize: '0.7rem' }}>
                        ← {a.source} {a.attack_type}{a.scheme ? ` via ${a.scheme}` : ''}{a.warrant ? ` — ${a.warrant}` : ''}
                      </div>
                    ))}
                  </div>
                );
              })}
            </Section>
          )}

          {/* Commitments */}
          {commitments && Object.keys(commitments).length > 0 && (
            <Section title="Commitment Stores" defaultOpen>
              {Object.entries(commitments).map(([pov, store]) => (
                <div key={pov} style={{ margin: '4px 0' }}>
                  <strong>{speakerLabel(pov)}</strong>: Asserted {store.asserted.length} | Conceded {store.conceded.length} | Challenged {store.challenged.length}
                </div>
              ))}
            </Section>
          )}

          {/* Transcript list for selection */}
          <Section title={`Transcript (${debate.transcript.length} entries)`} defaultOpen>
            {debate.transcript.map(e => (
              <div
                key={e.id}
                onClick={() => setSelectedEntry(e.id)}
                style={{ padding: '3px 6px', cursor: 'pointer', borderRadius: 4, margin: '2px 0', background: 'var(--bg-primary)', fontSize: '0.7rem' }}
              >
                <strong>{speakerLabel(e.speaker)}</strong> [{e.type}] {e.content.slice(0, 80)}...
              </div>
            ))}
          </Section>
        </>
      )}

      {entry && (
        <>
          <button onClick={() => setSelectedEntry(null)} style={{ fontSize: '0.7rem', marginBottom: 8, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', color: 'var(--text-primary)' }}>
            ← Back to Overview
          </button>
          <div style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: '0.85rem' }}>{speakerLabel(entry.speaker)}</strong>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>{entry.type}</span>
          </div>

          {diag?.model && (
            <Section title={`Model & Timing — ${diag.model} (${diag.response_time_ms ? (diag.response_time_ms / 1000).toFixed(1) + 's' : '?'})`} defaultOpen>
              <div>Model: {diag.model}</div>
              {diag.response_time_ms && <div>Response: {(diag.response_time_ms / 1000).toFixed(1)}s</div>}
            </Section>
          )}

          {meta?.move_types && (
            <Section title={`Dialectical Moves — ${(meta.move_types as string[]).join(', ')}`} defaultOpen>
              {(meta.move_types as string[]).map((m, i) => (
                <span key={i} style={{ display: 'inline-block', margin: '2px 4px 2px 0', padding: '1px 6px', borderRadius: 3, background: 'rgba(59,130,246,0.2)', color: '#3b82f6', fontSize: '0.7rem', fontWeight: 600 }}>{m}</span>
              ))}
              {meta.disagreement_type && <div style={{ marginTop: 4 }}>Type: <strong>{meta.disagreement_type as string}</strong></div>}
            </Section>
          )}

          {diag?.extracted_claims && (
            <Section title={`Extracted Claims (${diag.extracted_claims.accepted.length} accepted, ${diag.extracted_claims.rejected.length} rejected)`} defaultOpen>
              {diag.extracted_claims.accepted.map((c, i) => (
                <div key={i} style={{ margin: '3px 0' }}>
                  <span style={{ color: '#22c55e' }}>✓ {c.id}</span> <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{c.overlap_pct}%</span> {c.text}
                </div>
              ))}
              {diag.extracted_claims.rejected.map((c, i) => (
                <div key={i} style={{ margin: '3px 0' }}>
                  <span style={{ color: '#ef4444' }}>✗</span> <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{c.overlap_pct}%</span> {c.text}
                  <div style={{ color: '#f59e0b', fontSize: '0.65rem', paddingLeft: 16 }}>{c.reason}</div>
                </div>
              ))}
            </Section>
          )}

          {diag?.taxonomy_context && (
            <Section title="Taxonomy Context (BDI)">
              <ResizablePre text={diag.taxonomy_context} />
            </Section>
          )}

          {diag?.commitment_context && (
            <Section title="Commitments Injected">
              <ResizablePre text={diag.commitment_context} />
            </Section>
          )}

          {diag?.edge_tensions && (
            <Section title="Edge Tensions">
              <ResizablePre text={diag.edge_tensions} />
            </Section>
          )}

          {diag?.argument_network_context && (
            <Section title="Argument Network Context">
              <ResizablePre text={diag.argument_network_context} />
            </Section>
          )}

          {entry.taxonomy_refs.length > 0 && (
            <Section title={`Taxonomy Refs (${entry.taxonomy_refs.length})`}>
              {entry.taxonomy_refs.map((r, i) => (
                <div key={i} style={{ margin: '2px 0' }}><strong style={{ color: 'var(--accent)' }}>{r.node_id}</strong> {r.relevance?.slice(0, 100)}</div>
              ))}
            </Section>
          )}

          {diag?.prompt && (
            <Section title="Full Prompt Sent to AI">
              <ResizablePre text={diag.prompt} />
            </Section>
          )}

          {diag?.raw_response && (
            <Section title="Raw AI Response">
              <ResizablePre text={diag.raw_response} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
