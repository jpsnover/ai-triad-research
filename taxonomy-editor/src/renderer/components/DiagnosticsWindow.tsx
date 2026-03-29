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

      <h3 style={{ color: '#f59e0b' }}>Per-Entry Diagnostics</h3>
      <p>
        Click any transcript entry to see its internals: the full prompt sent to the AI,
        the raw response, which claims were extracted (with validation scores), the taxonomy
        context injected, and what commitments were active at that point.
      </p>
    </div>
  );
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

export function DiagnosticsWindow() {
  const [debate, setDebate] = useState<DebateSession | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: '1rem', color: '#f59e0b', flex: 1 }}>Debate Diagnostics</h2>
        <button
          onClick={() => setShowHelp(!showHelp)}
          style={{ background: showHelp ? '#f59e0b' : 'none', color: showHelp ? '#000' : '#f59e0b', border: '1px solid #f59e0b', borderRadius: 4, padding: '2px 10px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
        >
          {showHelp ? 'Close Help' : 'Help'}
        </button>
      </div>
      {showHelp && <HelpContent />}
      {!debate && !showHelp && <p style={{ color: 'var(--text-muted)' }}>Waiting for debate data from main window...</p>}

      {debate && !selectedEntry && (
        <>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
            Click a transcript entry in the main window to inspect it here. Showing overview.
          </p>

          {/* Argument Network */}
          {an && an.nodes.length > 0 && (() => {
            const caCount = an.edges.filter(e => e.type === 'attacks').length;
            const raCount = an.edges.filter(e => e.type === 'supports').length;
            return (
              <Section title={`Argument Network — ${an.nodes.length} I-nodes, ${caCount} CA-nodes (attacks), ${raCount} RA-nodes (supports)`} defaultOpen>
                {an.nodes.map(n => {
                  const attacks = an.edges.filter(e => e.target === n.id && e.type === 'attacks');
                  const supports = an.edges.filter(e => e.target === n.id && e.type === 'supports');
                  const responded = attacks.length > 0 || supports.length > 0;
                  const isSource = an.edges.some(e => e.source === n.id);
                  return (
                    <div key={n.id} style={{ margin: '6px 0', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                      <div>
                        <span style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6', padding: '1px 5px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 700, marginRight: 4 }}>I-node</span>
                        <strong style={{ color: 'var(--accent)' }}>{n.id}</strong>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>({speakerLabel(n.speaker)})</span>
                        {!responded && !isSource && <span style={{ color: '#f59e0b', fontSize: '0.65rem', marginLeft: 6 }}>[unaddressed]</span>}
                      </div>
                      <div style={{ paddingLeft: 8, marginTop: 2 }}>{n.text}</div>
                      {attacks.map(a => (
                        <div key={a.id} style={{ paddingLeft: 16, marginTop: 2, fontSize: '0.7rem' }}>
                          <span style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '1px 5px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 700, marginRight: 4 }}>CA-node</span>
                          ← {a.source} <strong>{a.attack_type}</strong>{a.scheme ? <span style={{ color: 'var(--text-muted)' }}> via {a.scheme}</span> : ''}
                          {a.warrant && <div style={{ paddingLeft: 20, color: 'var(--text-muted)', fontStyle: 'italic' }}>Warrant: {a.warrant}</div>}
                        </div>
                      ))}
                      {supports.map(s => (
                        <div key={s.id} style={{ paddingLeft: 16, marginTop: 2, fontSize: '0.7rem' }}>
                          <span style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', padding: '1px 5px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 700, marginRight: 4 }}>RA-node</span>
                          ← {s.source} <strong>supports</strong>
                          {s.warrant && <div style={{ paddingLeft: 20, color: 'var(--text-muted)', fontStyle: 'italic' }}>Warrant: {s.warrant}</div>}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </Section>
            );
          })()}

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
              <ResizablePre tall text={diag.taxonomy_context} />
            </Section>
          )}

          {diag?.commitment_context && (
            <Section title="Commitments Injected">
              <ResizablePre tall text={diag.commitment_context} />
            </Section>
          )}

          {diag?.edge_tensions && (
            <Section title="Edge Tensions">
              <ResizablePre tall text={diag.edge_tensions} />
            </Section>
          )}

          {diag?.argument_network_context && (
            <Section title="Argument Network Context">
              <ResizablePre tall text={diag.argument_network_context} />
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
              <ResizablePre tall text={diag.prompt} />
            </Section>
          )}

          {diag?.raw_response && (
            <Section title="Raw AI Response">
              <ResizablePre tall text={diag.raw_response} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
