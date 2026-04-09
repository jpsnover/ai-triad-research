// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useCallback, useMemo } from 'react';
import { api } from '@bridge';
import { useDebateStore } from '../hooks/useDebateStore';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { POVER_INFO } from '../types/debate';
import type { PoverId, EntryDiagnostics, DebateDiagnostics, ArgumentNetworkNode, ArgumentNetworkEdge, QbafTimelineEntry, UnansweredClaimEntry, DriftSnapshot, MissingArgument, TaxonomySuggestion } from '../types/debate';
import { QbafClaimBadge, QbafScoreSlider, QbafEdgeIndicator } from './QbafOverlay';
import { computeQbafStrengths } from '@lib/debate';
import type { QbafNode, QbafEdge } from '@lib/debate';
import { computeCoverageMap } from '@lib/debate/coverageTracker';
import type { CoverageMap, CoverageMapEntry } from '@lib/debate/coverageTracker';

const AIF_TOOLTIPS = {
  'I-node': 'I-node (Information node) — a claim, proposition, or data point. These are the passive content of arguments: what is being asserted.',
  'CA': 'CA-node (Conflict Application) — an attack relationship. Three types: rebut (contradicts conclusion), undercut (denies the inference), undermine (attacks premise credibility). Each attack is classified by argumentation scheme (e.g., ARGUMENT_FROM_EVIDENCE, ARGUMENT_FROM_ANALOGY) with critical questions that identify how to evaluate it.',
  'RA': 'RA-node (Rule Application) — an inference scheme explaining WHY one claim supports another. The warrant is the reasoning pattern connecting evidence to conclusion.',
  'PA': 'PA-node (Preference Application) — resolves conflicts by determining which argument prevails and why, based on criteria like evidence strength or logical validity.',
};

function speakerLabel(speaker: PoverId | 'system' | 'document'): string {
  if (speaker === 'system') return 'Moderator';
  if (speaker === 'user') return 'You';
  if (speaker === 'document') return 'Document';
  return POVER_INFO[speaker as Exclude<PoverId, 'user'>]?.label || speaker;
}

function CopyButton({ targetRef }: { targetRef: React.RefObject<HTMLDivElement | null> }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        const text = targetRef.current?.innerText ?? '';
        navigator.clipboard.writeText(text).catch(() => {
          // fallback for Electron
          api.clipboardWriteText(text);
        });
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="diag-copy-btn"
      title="Copy section content to clipboard"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CollapsibleSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <div className="diag-section">
      <div className="diag-section-header-row">
        <button className="diag-section-header" onClick={() => setOpen(!open)}>
          <span>{open ? '▼' : '▶'}</span> {title}
        </button>
        {open && <CopyButton targetRef={bodyRef} />}
      </div>
      {open && <div className="diag-section-body" ref={bodyRef}>{children}</div>}
    </div>
  );
}

function QbafClaimStrengthSection({ entryId, activeDebate }: { entryId: string; activeDebate: { argument_network?: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] } } | null }) {
  const qbafEnabled = useTaxonomyStore(s => s.qbafEnabled);
  const anNodes = activeDebate?.argument_network?.nodes?.filter(
    n => n.source_entry_id === entryId
  ) ?? [];
  const anEdges = activeDebate?.argument_network?.edges ?? [];
  const scoredNodes = anNodes.filter(n => n.computed_strength != null || n.base_strength != null);

  const handleScoreChange = useCallback((nodeId: string, score: number) => {
    const debate = useDebateStore.getState().activeDebate;
    if (!debate?.argument_network) return;
    const node = debate.argument_network.nodes.find(n => n.id === nodeId);
    if (node) {
      node.base_strength = score;
      node.scoring_method = 'human';
    }
  }, []);

  if (!qbafEnabled || scoredNodes.length === 0) return null;

  return (
    <CollapsibleSection title={`QBAF Strength (${scoredNodes.length} claims)`} defaultOpen>
      {scoredNodes.map(node => {
        const computed = node.computed_strength ?? node.base_strength ?? 0;
        const base = node.base_strength ?? computed;
        const delta = computed - base;
        const incoming = anEdges.filter(e => e.target === node.id);
        const bdiLayer = node.taxonomy_refs.some(r => r.includes('-beliefs-')) ? 'Beliefs'
          : node.taxonomy_refs.some(r => r.includes('-desires-')) ? 'Desires'
          : node.taxonomy_refs.some(r => r.includes('-intentions-')) ? 'Intentions' : 'Unknown';
        const isPending = node.scoring_method === 'default_pending';

        return (
          <div key={node.id} className={`diag-qbaf-card ${isPending ? 'diag-qbaf-pending' : ''}`}>
            <div className="diag-qbaf-card-header">
              <span className="diag-an-id">{node.id}</span>
              <QbafClaimBadge node={node} />
            </div>
            <div className="diag-qbaf-claim-text">{node.text}</div>
            <div className="diag-qbaf-strength-row">
              <span className="diag-k">Base:</span> <span className="diag-v">{base.toFixed(2)}</span>
              <span className="diag-qbaf-arrow">→</span>
              <span className="diag-k">Computed:</span> <span className="diag-v">{computed.toFixed(2)}</span>
              {Math.abs(delta) > 0.01 && (
                <span className={`qbaf-delta ${delta > 0 ? 'qbaf-delta-up' : 'qbaf-delta-down'}`}>
                  ({delta > 0 ? '+' : ''}{delta.toFixed(2)})
                </span>
              )}
            </div>
            {incoming.length > 0 && (
              <div className="diag-qbaf-edges">
                {incoming.map((e, i) => {
                  const srcNode = activeDebate?.argument_network?.nodes?.find(n => n.id === e.source);
                  return (
                    <div key={i} className={`diag-qbaf-edge ${e.type === 'attacks' ? 'diag-qbaf-attack' : 'diag-qbaf-support'}`}>
                      <span>{e.type === 'attacks' ? '⚔' : '✓'} {e.source}</span>
                      {e.attack_type && <span className="diag-badge diag-badge-move">{e.attack_type}</span>}
                      {(e as any).argumentation_scheme && <span className="diag-badge" style={{ fontSize: '0.5rem', background: 'rgba(99,102,241,0.15)', color: '#6366f1', marginLeft: 2 }}>{(e as any).argumentation_scheme}</span>}
                      {e.weight != null && <QbafEdgeIndicator edge={e} />}
                      {srcNode && <span className="diag-muted" style={{ marginLeft: 4 }}>{srcNode.text.slice(0, 60)}{srcNode.text.length > 60 ? '…' : ''}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="diag-qbaf-meta">
              <span className="diag-badge diag-badge-type">{bdiLayer}</span>
              <span className="diag-muted">Scored by: {node.scoring_method === 'ai_rubric' ? 'AI rubric (v3)' : node.scoring_method === 'human' ? 'Human' : node.scoring_method === 'default_pending' ? 'Unscored (default 0.5)' : 'Unknown'}</span>
            </div>
            {isPending && (
              <div className="diag-qbaf-slider-row">
                <QbafScoreSlider node={node} onScoreChange={handleScoreChange} />
              </div>
            )}
          </div>
        );
      })}
    </CollapsibleSection>
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

      {/* Moderator Deliberation (t/160) */}
      {meta?.moderator_trace && (() => {
        const trace = meta.moderator_trace as {
          selected: string; excluded_last_speaker: string | null;
          candidates: { debater: string; computed_strength: number | null; rank: number }[];
          convergence_score: number | null; convergence_triggered: boolean;
          commitment_snapshot: Record<string, { asserted: number; conceded: number; challenged: number }>;
          selection_reason: string; focus_point: string;
        };
        return (
          <CollapsibleSection title={`Moderator — selected ${trace.selected} (${trace.selection_reason.replace(/_/g, ' ')})`} defaultOpen>
            <div className="diag-kv">
              <span className="diag-k">Selected:</span> <span className="diag-v">{trace.selected}</span>
            </div>
            {trace.excluded_last_speaker && (
              <div className="diag-kv">
                <span className="diag-k">Excluded (last speaker):</span> <span className="diag-v">{trace.excluded_last_speaker}</span>
              </div>
            )}
            <div className="diag-kv">
              <span className="diag-k">Reason:</span> <span className="diag-badge diag-badge-move">{trace.selection_reason.replace(/_/g, ' ')}</span>
            </div>
            {trace.focus_point && (
              <div className="diag-kv">
                <span className="diag-k">Focus:</span> <span className="diag-v">{trace.focus_point}</span>
              </div>
            )}
            {trace.candidates.length > 0 && (
              <div className="diag-mod-candidates">
                <span className="diag-k">Candidates:</span>
                {trace.candidates.map((c, i) => (
                  <div key={i} className="diag-mod-candidate">
                    <span className="diag-mod-rank">#{c.rank}</span>
                    <span>{c.debater}</span>
                    {c.computed_strength != null && (
                      <span className="diag-muted">strength: {c.computed_strength.toFixed(2)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {trace.convergence_score != null && (
              <div className="diag-kv">
                <span className="diag-k">Convergence:</span>
                <span className="diag-v">{(trace.convergence_score * 100).toFixed(0)}%{trace.convergence_triggered ? ' (triggered)' : ''}</span>
              </div>
            )}
            {(trace as any).recent_scheme && (
              <div className="diag-kv">
                <span className="diag-k">Recent Scheme:</span>
                <span className="diag-badge" style={{ fontSize: '0.55rem', background: 'rgba(99,102,241,0.15)', color: '#6366f1' }}>{(trace as any).recent_scheme}</span>
              </div>
            )}
            {(trace as any).metaphor_reframe_offered && (
              <div className="diag-kv" style={{ marginTop: 4 }}>
                <span className="diag-k">Metaphor Reframe:</span>
                <span className="diag-badge" style={{ fontSize: '0.55rem', background: 'rgba(234,179,8,0.15)', color: '#ca8a04' }}>
                  {(trace as any).metaphor_reframe_offered} {(trace as any).metaphor_reframe_used ? '(USED)' : '(offered, not used)'}
                </span>
              </div>
            )}
            {(trace as any).critical_questions && (
              <div style={{ fontSize: '0.7rem', marginTop: 4, padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: 4 }}>
                <div className="diag-k" style={{ marginBottom: 2 }}>Critical Questions for Moderator:</div>
                <div className="diag-muted" style={{ whiteSpace: 'pre-wrap' }}>{(trace as any).critical_questions}</div>
              </div>
            )}
            {(trace as any).argument_network_snapshot && (
              <div style={{ fontSize: '0.7rem', marginTop: 4 }}>
                <div className="diag-k">Argument Network at Decision:</div>
                <div className="diag-muted">
                  {(trace as any).argument_network_snapshot.total_claims} claims, {(trace as any).argument_network_snapshot.total_edges} edges, {(trace as any).argument_network_snapshot.unaddressed_claims} unaddressed
                </div>
                {(trace as any).argument_network_snapshot.strongest_unaddressed?.length > 0 && (
                  <div style={{ marginTop: 2 }}>
                    <span className="diag-k">Strongest unaddressed:</span>
                    {(trace as any).argument_network_snapshot.strongest_unaddressed.map((n: any, i: number) => (
                      <div key={i} className="diag-muted" style={{ paddingLeft: 8 }}>
                        {n.id} ({n.speaker}, strength {n.strength?.toFixed(2)}): {n.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {Object.keys(trace.commitment_snapshot).length > 0 && (
              <div className="diag-mod-commitments">
                <span className="diag-k">Commitments at selection:</span>
                {Object.entries(trace.commitment_snapshot).map(([debater, counts]) => (
                  <div key={debater} className="diag-mod-commit-row">
                    <span className="diag-mod-commit-name">{debater}:</span>
                    <span className="diag-muted">{counts.asserted}A {counts.conceded}C {counts.challenged}Ch</span>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleSection>
        );
      })()}

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

      {/* Claim Extraction Details — scheme classification, prompt, response */}
      {(diag as any)?.claim_extraction && (() => {
        const ce = (diag as any).claim_extraction as { prompt: string; raw_response: string; response_time_ms: number; claims_parsed: number; schemes_classified: string[] };
        return (
          <CollapsibleSection title={`Claim Extraction — ${ce.claims_parsed} claims, ${ce.schemes_classified.length} schemes (${ce.response_time_ms}ms)`}>
            {ce.schemes_classified.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <span className="diag-k">Argumentation Schemes Classified:</span>
                <div className="diag-badges" style={{ marginTop: 2 }}>
                  {ce.schemes_classified.map((s, i) => (
                    <span key={i} className="diag-badge" style={{ fontSize: '0.5rem', background: 'rgba(99,102,241,0.15)', color: '#6366f1' }}>{s}</span>
                  ))}
                </div>
              </div>
            )}
            <CollapsibleSection title="Extraction Prompt">
              <textarea readOnly className="diag-textarea" value={ce.prompt} />
            </CollapsibleSection>
            <CollapsibleSection title="Extraction Raw Response">
              <textarea readOnly className="diag-textarea" value={ce.raw_response} />
            </CollapsibleSection>
          </CollapsibleSection>
        );
      })()}

      {/* QBAF Claim Strength (D-Q3) */}
      <QbafClaimStrengthSection entryId={entryId} activeDebate={activeDebate} />

      {/* Context Usage Analysis — injected vs referenced */}
      {entry?.metadata?.injection_manifest && (
        <CollapsibleSection title="Context Usage Analysis">
          {(() => {
            const manifest = entry.metadata.injection_manifest as { povNodeIds: string[]; povPrimaryIds: string[]; situationNodeIds: string[]; vulnerabilityCount: number; policyCount: number; totalTokenEstimate: number };
            const referencedIds = new Set((entry.taxonomy_refs ?? []).map((r: { node_id: string }) => r.node_id));
            const injectedPov = manifest.povNodeIds ?? [];
            const injectedSit = manifest.situationNodeIds ?? [];
            const usedPov = injectedPov.filter(id => referencedIds.has(id));
            const usedSit = injectedSit.filter(id => referencedIds.has(id));
            const usedPrimary = (manifest.povPrimaryIds ?? []).filter(id => referencedIds.has(id));
            const unusedRefs = [...referencedIds].filter(id => !injectedPov.includes(id) && !injectedSit.includes(id));

            return (
              <div style={{ fontSize: '0.75rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <div className="diag-k">POV Nodes</div>
                    <div className="diag-v">{usedPov.length} / {injectedPov.length} used ({injectedPov.length > 0 ? Math.round(100 * usedPov.length / injectedPov.length) : 0}%)</div>
                  </div>
                  <div>
                    <div className="diag-k">Primary (★)</div>
                    <div className="diag-v">{usedPrimary.length} / {(manifest.povPrimaryIds ?? []).length} used</div>
                  </div>
                  <div>
                    <div className="diag-k">Situations</div>
                    <div className="diag-v">{usedSit.length} / {injectedSit.length} used ({injectedSit.length > 0 ? Math.round(100 * usedSit.length / injectedSit.length) : 0}%)</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <div className="diag-k">Vulnerabilities</div>
                    <div className="diag-v">{manifest.vulnerabilityCount} injected</div>
                  </div>
                  <div>
                    <div className="diag-k">Policies</div>
                    <div className="diag-v">{manifest.policyCount} injected</div>
                  </div>
                  <div>
                    <div className="diag-k">Est. Tokens</div>
                    <div className="diag-v">~{manifest.totalTokenEstimate?.toLocaleString()}</div>
                  </div>
                </div>
                {unusedRefs.length > 0 && (
                  <div style={{ color: 'var(--warning)', marginTop: 4 }}>
                    {unusedRefs.length} referenced node(s) not in injected context — hallucinated refs?
                  </div>
                )}
              </div>
            );
          })()}
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

const TIMELINE_SPEAKER_COLORS: Record<string, string> = {
  prometheus: '#27AE60',
  sentinel: '#E74C3C',
  cassandra: '#F1C40F',
};
const TIMELINE_W = 560;
const TIMELINE_H = 200;
const TIMELINE_PAD = { top: 20, right: 20, bottom: 30, left: 40 };

function StrengthTimeline({ timeline, nodes, onSelectClaim }: {
  timeline: QbafTimelineEntry[];
  nodes: ArgumentNetworkNode[];
  onSelectClaim?: (nodeId: string) => void;
}) {
  const [hoveredClaim, setHoveredClaim] = useState<string | null>(null);
  const qbafEnabled = useTaxonomyStore(s => s.qbafEnabled);
  if (!qbafEnabled || timeline.length === 0) return null;

  // Collect all claim IDs that appear in the timeline
  const claimIds = useMemo(() => {
    const ids = new Set<string>();
    for (const snap of timeline) for (const id of Object.keys(snap.strengths)) ids.add(id);
    return [...ids];
  }, [timeline]);

  const maxTurn = Math.max(...timeline.map(t => t.turn));
  const plotW = TIMELINE_W - TIMELINE_PAD.left - TIMELINE_PAD.right;
  const plotH = TIMELINE_H - TIMELINE_PAD.top - TIMELINE_PAD.bottom;
  const xScale = (turn: number) => TIMELINE_PAD.left + (turn / Math.max(1, maxTurn)) * plotW;
  const yScale = (val: number) => TIMELINE_PAD.top + (1 - val) * plotH;

  return (
    <CollapsibleSection title={`Strength Timeline (${claimIds.length} claims, ${timeline.length} snapshots)`} defaultOpen>
      <svg viewBox={`0 0 ${TIMELINE_W} ${TIMELINE_H}`} className="diag-timeline-svg">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1.0].map(v => (
          <g key={v}>
            <line x1={TIMELINE_PAD.left} y1={yScale(v)} x2={TIMELINE_W - TIMELINE_PAD.right} y2={yScale(v)} stroke="var(--border)" strokeWidth={0.5} opacity={0.4} />
            <text x={TIMELINE_PAD.left - 4} y={yScale(v) + 3} textAnchor="end" fill="var(--text-muted)" fontSize={8}>{v.toFixed(1)}</text>
          </g>
        ))}
        {/* X-axis labels */}
        {timeline.map(snap => (
          <text key={snap.turn} x={xScale(snap.turn)} y={TIMELINE_H - 5} textAnchor="middle" fill="var(--text-muted)" fontSize={8}>
            T{snap.turn}
          </text>
        ))}

        {/* Lines per claim */}
        {claimIds.map(claimId => {
          const node = nodes.find(n => n.id === claimId);
          const speaker = node?.speaker ?? 'system';
          const color = TIMELINE_SPEAKER_COLORS[speaker] ?? '#64748b';
          const points = timeline
            .filter(s => s.strengths[claimId] != null)
            .map(s => `${xScale(s.turn)},${yScale(s.strengths[claimId])}`);
          if (points.length < 2) return null;
          const isHovered = hoveredClaim === claimId;

          return (
            <g key={claimId}>
              <polyline
                points={points.join(' ')}
                fill="none"
                stroke={color}
                strokeWidth={isHovered ? 2.5 : 1.2}
                opacity={hoveredClaim && !isHovered ? 0.15 : 0.8}
                style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                onMouseEnter={() => setHoveredClaim(claimId)}
                onMouseLeave={() => setHoveredClaim(null)}
                onClick={() => onSelectClaim?.(claimId)}
              />
              {/* Endpoint dot */}
              {points.length > 0 && (() => {
                const last = timeline.filter(s => s.strengths[claimId] != null).at(-1);
                if (!last) return null;
                return (
                  <circle
                    cx={xScale(last.turn)}
                    cy={yScale(last.strengths[claimId])}
                    r={isHovered ? 4 : 2.5}
                    fill={color}
                    opacity={hoveredClaim && !isHovered ? 0.15 : 1}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredClaim(claimId)}
                    onMouseLeave={() => setHoveredClaim(null)}
                    onClick={() => onSelectClaim?.(claimId)}
                  />
                );
              })()}
            </g>
          );
        })}
      </svg>

      {/* Hovered claim tooltip */}
      {hoveredClaim && (() => {
        const node = nodes.find(n => n.id === hoveredClaim);
        const lastSnap = timeline.filter(s => s.strengths[hoveredClaim] != null).at(-1);
        const firstSnap = timeline.find(s => s.strengths[hoveredClaim] != null);
        if (!node || !lastSnap || !firstSnap) return null;
        const startVal = firstSnap.strengths[hoveredClaim];
        const endVal = lastSnap.strengths[hoveredClaim];
        const delta = endVal - startVal;
        return (
          <div className="diag-timeline-tooltip">
            <strong>{hoveredClaim}</strong> ({speakerLabel(node.speaker as PoverId)}):
            {' '}{startVal.toFixed(2)} → {endVal.toFixed(2)}
            {Math.abs(delta) > 0.01 && (
              <span className={delta > 0 ? 'qbaf-delta-up' : 'qbaf-delta-down'}>
                {' '}({delta > 0 ? '+' : ''}{delta.toFixed(2)})
              </span>
            )}
            <div className="diag-muted" style={{ fontSize: '0.6rem' }}>{node.text.slice(0, 100)}{node.text.length > 100 ? '…' : ''}</div>
          </div>
        );
      })()}

      {/* Legend */}
      <div className="diag-timeline-legend">
        {Object.entries(TIMELINE_SPEAKER_COLORS).map(([speaker, color]) => (
          <span key={speaker} className="diag-timeline-legend-item">
            <span style={{ display: 'inline-block', width: 10, height: 3, background: color, marginRight: 4 }} />
            {speakerLabel(speaker as PoverId)}
          </span>
        ))}
      </div>
    </CollapsibleSection>
  );
}

/** What-If Mode (D-Q6): counterfactual strength propagation via DF-QuAD. */
function WhatIfSection({ nodes, edges }: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] }) {
  const qbafEnabled = useTaxonomyStore(s => s.qbafEnabled);
  const [active, setActive] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  // Original strengths from the debate data
  const originalStrengths = useMemo(() => {
    const map: Record<string, number> = {};
    for (const n of nodes) {
      if (n.computed_strength != null) map[n.id] = n.computed_strength;
      else if (n.base_strength != null) map[n.id] = n.base_strength;
    }
    return map;
  }, [nodes]);

  // Counterfactual: re-run DF-QuAD with overridden base_strengths
  const whatIfStrengths = useMemo(() => {
    if (!active || Object.keys(overrides).length === 0) return null;

    const qbafNodes: QbafNode[] = nodes
      .filter(n => n.base_strength != null)
      .map(n => ({
        id: n.id,
        base_strength: overrides[n.id] ?? n.base_strength ?? 0.5,
      }));
    const qbafEdges: QbafEdge[] = edges
      .filter(e => e.weight != null)
      .map(e => ({
        source: e.source,
        target: e.target,
        type: e.type,
        weight: e.weight!,
        attack_type: e.attack_type,
      }));

    if (qbafNodes.length === 0) return null;
    const result = computeQbafStrengths(qbafNodes, qbafEdges);
    const map: Record<string, number> = {};
    for (const [id, val] of result.strengths) map[id] = val;
    return map;
  }, [active, overrides, nodes, edges]);

  const scoredNodes = nodes.filter(n => n.base_strength != null);
  if (!qbafEnabled || scoredNodes.length === 0) return null;

  const handleSliderChange = (nodeId: string, value: number) => {
    setOverrides(prev => ({ ...prev, [nodeId]: value }));
  };

  const handleReset = () => {
    setOverrides({});
  };

  const hasOverrides = Object.keys(overrides).length > 0;

  return (
    <CollapsibleSection title={`What-If Mode — counterfactual strength propagation${active ? ' (active)' : ''}`} defaultOpen={active}>
      <div className="whatif-header">
        <button
          className={`btn btn-sm whatif-toggle ${active ? 'whatif-toggle-active' : ''}`}
          onClick={() => { setActive(!active); if (active) setOverrides({}); }}
        >
          {active ? 'Disable What-If' : 'Enable What-If'}
        </button>
        {active && hasOverrides && (
          <button className="btn btn-sm whatif-reset" onClick={handleReset}>
            Reset
          </button>
        )}
        {active && hasOverrides && whatIfStrengths && (
          <span className="whatif-status">
            {Object.keys(overrides).length} override{Object.keys(overrides).length !== 1 ? 's' : ''} applied
          </span>
        )}
      </div>

      {active && (
        <div className="whatif-node-list">
          {scoredNodes.map(n => {
            const origBase = n.base_strength ?? 0.5;
            const currentBase = overrides[n.id] ?? origBase;
            const isOverridden = overrides[n.id] != null;
            const origComputed = originalStrengths[n.id] ?? origBase;
            const whatIfComputed = whatIfStrengths?.[n.id] ?? origComputed;
            const delta = whatIfStrengths ? whatIfComputed - origComputed : 0;

            return (
              <div key={n.id} className={`whatif-node ${isOverridden ? 'whatif-node-modified' : ''}`}>
                <div className="whatif-node-header">
                  <span className="diag-an-id">{n.id}</span>
                  <span className="diag-an-speaker">({speakerLabel(n.speaker)})</span>
                  {isOverridden && (
                    <button
                      className="whatif-node-reset-btn"
                      onClick={() => setOverrides(prev => { const next = { ...prev }; delete next[n.id]; return next; })}
                      title="Reset this node"
                    >
                      x
                    </button>
                  )}
                </div>
                <div className="whatif-node-text">{n.text.slice(0, 100)}{n.text.length > 100 ? '...' : ''}</div>
                <div className="whatif-slider-row">
                  <span className="diag-k">Base:</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={currentBase}
                    onChange={e => handleSliderChange(n.id, Number(e.target.value))}
                    className="whatif-slider"
                    title={`Base strength: ${currentBase.toFixed(2)} (original: ${origBase.toFixed(2)})`}
                  />
                  <span className="whatif-slider-value">{currentBase.toFixed(2)}</span>
                  {isOverridden && (
                    <span className="whatif-orig-value">(was {origBase.toFixed(2)})</span>
                  )}
                </div>
                {whatIfStrengths && (
                  <div className="whatif-result-row">
                    <span className="diag-k">Computed:</span>
                    <span className="diag-v">{origComputed.toFixed(2)}</span>
                    <span className="diag-qbaf-arrow">{'\u2192'}</span>
                    <span className={`whatif-new-value ${Math.abs(delta) > 0.01 ? (delta > 0 ? 'whatif-up' : 'whatif-down') : ''}`}>
                      {whatIfComputed.toFixed(2)}
                    </span>
                    {Math.abs(delta) > 0.01 && (
                      <span className={`whatif-delta ${delta > 0 ? 'whatif-delta-up' : 'whatif-delta-down'}`}>
                        {delta > 0 ? '\u2191' : '\u2193'} {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleSection>
  );
}

/** Document Coverage section (CT-3/CT-4): shows per-claim coverage status sorted uncovered-first.
 *  Click-to-steer (CT-4): uncovered/partial claims are clickable — injects a steering question into the debate. */
function DocumentCoverageSection({ coverageMap, onSteerToClaim }: { coverageMap: CoverageMap; onSteerToClaim?: (claimText: string) => void }) {
  const { stats, coverage, documentClaims } = coverageMap;
  const claimTextById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of documentClaims) m.set(c.id, c.text);
    return m;
  }, [documentClaims]);

  // Sort: uncovered first, then partially_covered, then covered
  const sortedCoverage = useMemo(() => {
    const order: Record<string, number> = { uncovered: 0, partially_covered: 1, covered: 2 };
    return [...coverage].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [coverage]);

  const statusIcon = (status: string) => {
    if (status === 'covered') return <span className="coverage-status-icon coverage-status-covered" title="Covered">&#9679;</span>;
    if (status === 'partially_covered') return <span className="coverage-status-icon coverage-status-partial" title="Partially covered">&#9681;</span>;
    return <span className="coverage-status-icon coverage-status-uncovered" title="Uncovered">&#9675;</span>;
  };

  return (
    <CollapsibleSection title={`Document Coverage — ${stats.coveredCount + stats.partiallyCoveredCount}/${stats.totalClaims} claims (${Math.round(stats.coveragePercentage)}%)`} defaultOpen>
      <div className="coverage-summary-row">
        <span className="coverage-stat coverage-stat-covered">{stats.coveredCount} covered</span>
        <span className="coverage-stat coverage-stat-partial">{stats.partiallyCoveredCount} partial</span>
        <span className="coverage-stat coverage-stat-uncovered">{stats.uncoveredCount} uncovered</span>
      </div>
      <div className="coverage-claim-list">
        {sortedCoverage.map(entry => {
          const claimText = claimTextById.get(entry.claimId) ?? entry.claimId;
          const isClickable = onSteerToClaim && entry.status !== 'covered';
          return (
          <div
            key={entry.claimId}
            className={`coverage-claim-row coverage-claim-${entry.status}${isClickable ? ' coverage-claim-steerable' : ''}`}
            onClick={isClickable ? () => onSteerToClaim(claimText) : undefined}
            title={isClickable ? 'Click to steer the debate toward this claim' : undefined}
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSteerToClaim(claimText); } } : undefined}
          >
            <div className="coverage-claim-header">
              {statusIcon(entry.status)}
              <span className="coverage-claim-id">{entry.claimId}</span>
              {isClickable && <span className="coverage-steer-hint">click to steer</span>}
              <span className="coverage-claim-score">{(entry.similarity * 100).toFixed(0)}%</span>
            </div>
            <div className="coverage-claim-text">{claimText}</div>
            {entry.matchedAnNodes.length > 0 && (
              <div className="coverage-matched-nodes">
                <span className="diag-muted">Matched AN:</span>
                {entry.matchedAnNodes.map(nodeId => (
                  <span key={nodeId} className="diag-badge" style={{ fontSize: '0.55rem' }}>{nodeId}</span>
                ))}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}

function OverviewView() {
  const { activeDebate, askQuestion, debateGenerating } = useDebateStore();
  if (!activeDebate) return null;

  const an = activeDebate.argument_network;
  const commitments = activeDebate.commitments;
  const diag = activeDebate.diagnostics;
  const timeline = activeDebate.qbaf_timeline;

  // Coverage map (CT-3) — computed when document_analysis has claims
  const coverageMap = useMemo<CoverageMap | null>(() => {
    if (!activeDebate?.document_analysis?.i_nodes?.length) return null;
    const anNodes = activeDebate.argument_network?.nodes ?? [];
    if (anNodes.length === 0) return null;
    const documentClaims = activeDebate.document_analysis.i_nodes.map(n => ({ id: n.id, text: n.text }));
    try {
      return computeCoverageMap(anNodes, documentClaims);
    } catch {
      return null;
    }
  }, [activeDebate?.argument_network?.nodes, activeDebate?.document_analysis?.i_nodes]);

  return (
    <div className="diag-overview">
      {/* Strength Timeline (D-Q5) */}
      {timeline && timeline.length > 0 && an && (
        <StrengthTimeline timeline={timeline} nodes={an.nodes} />
      )}

      {/* Document Coverage (CT-3/CT-4) — click-to-steer injects a question about uncovered claims */}
      {coverageMap && <DocumentCoverageSection coverageMap={coverageMap} onSteerToClaim={debateGenerating ? undefined : (claimText) => {
        askQuestion(`What is your perspective on the claim that ${claimText}?`);
      }} />}

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
                  <QbafClaimBadge node={{ ...n, base_strength: n.base_strength ?? 0.5 }} />
                  {(() => {
                    const base = n.base_strength ?? 0.5;
                    const computed = n.computed_strength ?? base;
                    const delta = computed - base;
                    return Math.abs(delta) > 0.01 ? (
                      <span className={`qbaf-delta ${delta > 0 ? 'qbaf-delta-up' : 'qbaf-delta-down'}`} style={{ fontSize: '0.55rem' }}>
                        ({delta > 0 ? '+' : ''}{delta.toFixed(2)})
                      </span>
                    ) : null;
                  })()}
                </div>
                {n.verification_status && (
                  <span className={`diag-badge diag-verification-${n.verification_status}`} title={n.verification_evidence || n.verification_status}>
                    {n.verification_status === 'verified' ? 'V' : n.verification_status === 'disputed' ? 'X' : '?'}
                  </span>
                )}
                <div style={{ paddingLeft: 8, fontSize: '0.7rem' }}>
                  {n.text}
                  {n.verification_evidence && n.verification_status === 'disputed' && (
                    <div style={{ color: '#ef4444', fontSize: '0.6rem', marginTop: 2 }}>Evidence: {n.verification_evidence}</div>
                  )}
                </div>
                {attacks.map(a => (
                  <div key={a.id} className="diag-an-edge diag-an-attack">
                    <span className="diag-badge" style={{ fontSize: '0.5rem', background: 'rgba(239,68,68,0.15)', color: '#ef4444', cursor: 'default' }} title={AIF_TOOLTIPS['CA']}>CA</span>
                    ← {a.source} <strong>{a.attack_type}</strong>{a.scheme ? ` via ${a.scheme}` : ''}
                    {(a as any).argumentation_scheme && <span className="diag-badge" style={{ fontSize: '0.5rem', background: 'rgba(99,102,241,0.15)', color: '#6366f1', marginLeft: 4 }}>{(a as any).argumentation_scheme}</span>}
                    {a.weight != null && <QbafEdgeIndicator edge={a} />}
                    {a.warrant && <div style={{ paddingLeft: 16, color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.65rem' }}>Warrant: {a.warrant}</div>}
                  </div>
                ))}
                {supports.map(s => (
                  <div key={s.id} className="diag-an-edge diag-an-support">
                    <span className="diag-badge" style={{ fontSize: '0.5rem', background: 'rgba(34,197,94,0.15)', color: '#22c55e', cursor: 'default' }} title={AIF_TOOLTIPS['RA']}>RA</span>
                    ← {s.source} supports
                    {s.weight != null && <QbafEdgeIndicator edge={s} />}
                    {s.warrant && <div style={{ paddingLeft: 16, color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.65rem' }}>Warrant: {s.warrant}</div>}
                  </div>
                ))}
              </div>
            );
          })}
        </CollapsibleSection>
        );
      })()}

      {/* What-If Mode (D-Q6) */}
      {an && an.nodes.length > 0 && (
        <WhatIfSection nodes={an.nodes} edges={an.edges} />
      )}

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

      {/* Moderator Deliberations — aggregate moderator_trace from system entries */}
      {(() => {
        const modEntries = activeDebate.transcript
          .filter(e => (e.metadata as Record<string, unknown>)?.moderator_trace)
          .map(e => ({
            id: e.id,
            trace: (e.metadata as Record<string, unknown>).moderator_trace as {
              selected: string; focus_point: string; addressing?: string;
              agreement_detected?: boolean; recent_scheme?: string | null;
              convergence_score?: number | null; convergence_triggered?: boolean;
              argument_network_snapshot?: { total_claims: number; total_edges: number; unaddressed_claims: number } | null;
            },
          }));
        if (modEntries.length === 0) return null;

        // Count selections per debater
        const selectionCounts: Record<string, number> = {};
        let convergenceValues: number[] = [];
        modEntries.forEach(({ trace }) => {
          selectionCounts[trace.selected] = (selectionCounts[trace.selected] || 0) + 1;
          if (trace.convergence_score != null) convergenceValues.push(trace.convergence_score);
        });
        const latestTrace = modEntries[modEntries.length - 1].trace;
        const avgConvergence = convergenceValues.length > 0
          ? convergenceValues.reduce((a, b) => a + b, 0) / convergenceValues.length
          : null;

        return (
          <CollapsibleSection title={`Moderator Deliberations — ${modEntries.length} rounds`} defaultOpen>
            <div className="diag-kv">
              <span className="diag-k">Speaker selection:</span>
              <div className="diag-badges">
                {Object.entries(selectionCounts).sort((a, b) => b[1] - a[1]).map(([s, c]) => (
                  <span key={s} className="diag-badge diag-badge-move">{speakerLabel(s as PoverId)} ({c})</span>
                ))}
              </div>
            </div>
            {avgConvergence != null && (
              <div className="diag-kv">
                <span className="diag-k">Avg convergence:</span>
                <span className="diag-v">{(avgConvergence * 100).toFixed(0)}%</span>
                {latestTrace.convergence_triggered && <span className="diag-badge" style={{ fontSize: '0.55rem', background: 'rgba(34,197,94,0.15)', color: '#22c55e', marginLeft: 4 }}>triggered</span>}
              </div>
            )}
            {latestTrace.focus_point && (
              <div className="diag-kv">
                <span className="diag-k">Current focus:</span>
                <span className="diag-v">{latestTrace.focus_point}</span>
              </div>
            )}
            {latestTrace.argument_network_snapshot && (
              <div className="diag-kv">
                <span className="diag-k">AN snapshot:</span>
                <span className="diag-v">
                  {latestTrace.argument_network_snapshot.total_claims} claims, {latestTrace.argument_network_snapshot.total_edges} edges, {latestTrace.argument_network_snapshot.unaddressed_claims} unaddressed
                </span>
              </div>
            )}
            <div style={{ marginTop: 6, fontSize: '0.65rem' }}>
              {modEntries.slice(-5).reverse().map(({ id, trace }) => (
                <div key={id} className="diag-mod-round" style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 2 }}>
                  <span className="diag-badge diag-badge-move" style={{ fontSize: '0.5rem', minWidth: 50 }}>{speakerLabel(trace.selected as PoverId)}</span>
                  <span className="diag-muted" style={{ flex: 1 }}>{trace.focus_point}</span>
                  {trace.recent_scheme && <span className="diag-badge" style={{ fontSize: '0.5rem', background: 'rgba(99,102,241,0.15)', color: '#6366f1' }}>{trace.recent_scheme}</span>}
                  {trace.convergence_score != null && <span className="diag-muted">{(trace.convergence_score * 100).toFixed(0)}%</span>}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        );
      })()}

      {/* Unanswered Claims Ledger */}
      {activeDebate.unanswered_claims_ledger && activeDebate.unanswered_claims_ledger.length > 0 && (
        <CollapsibleSection title={`Unanswered Claims — ${activeDebate.unanswered_claims_ledger.filter(c => !c.addressed_round).length} open`}>
          {activeDebate.unanswered_claims_ledger.map(claim => (
            <div key={claim.claim_id} className={`diag-ledger-entry ${claim.addressed_round ? 'diag-ledger-addressed' : ''}`}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span className="diag-an-id">{claim.claim_id}</span>
                <span className="diag-an-speaker">({speakerLabel(claim.speaker as PoverId)})</span>
                <span className="diag-badge" style={{ fontSize: '0.5rem', background: claim.addressed_round ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: claim.addressed_round ? '#22c55e' : '#ef4444' }}>
                  {claim.addressed_round ? `addressed R${claim.addressed_round}` : `since R${claim.first_unanswered_round}`}
                </span>
              </div>
              <div style={{ paddingLeft: 8, fontSize: '0.65rem' }}>{claim.claim_text}</div>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Missing Arguments */}
      {activeDebate.missing_arguments && activeDebate.missing_arguments.length > 0 && (
        <CollapsibleSection title={`Missing Arguments — ${activeDebate.missing_arguments.length} identified`}>
          {activeDebate.missing_arguments.map((arg, i) => (
            <div key={i} className="diag-missing-arg">
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span className="diag-badge diag-badge-move" style={{ fontSize: '0.5rem' }}>{arg.side}</span>
                <span className="diag-badge" style={{ fontSize: '0.5rem', background: 'rgba(99,102,241,0.15)', color: '#6366f1' }}>{arg.bdi_layer}</span>
              </div>
              <div style={{ fontSize: '0.7rem', marginTop: 2 }}>{arg.argument}</div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{arg.why_strong}</div>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Position Drift (Sycophancy Guard) */}
      {activeDebate.position_drift && activeDebate.position_drift.length > 0 && (() => {
        const drift = activeDebate.position_drift!;
        const speakers = [...new Set(drift.map(d => d.speaker))];
        return (
          <CollapsibleSection title={`Position Drift — ${drift.length} snapshots`}>
            {speakers.map(speaker => {
              const speakerDrift = drift.filter(d => d.speaker === speaker);
              const latest = speakerDrift[speakerDrift.length - 1];
              const first = speakerDrift[0];
              const selfDelta = latest.self_similarity - first.self_similarity;
              return (
                <div key={speaker} className="diag-drift-speaker">
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <strong>{speakerLabel(speaker as PoverId)}</strong>
                    <span className="diag-muted">self-sim: {latest.self_similarity.toFixed(3)}</span>
                    <span className={`diag-badge ${selfDelta < -0.05 ? 'diag-drift-warning' : ''}`} style={{ fontSize: '0.5rem' }}>
                      {selfDelta > 0 ? '+' : ''}{selfDelta.toFixed(3)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, fontSize: '0.6rem', paddingLeft: 8 }}>
                    {Object.entries(latest.opponent_similarities).map(([opp, sim]) => (
                      <span key={opp}>→ {speakerLabel(opp as PoverId)}: {sim.toFixed(3)}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </CollapsibleSection>
        );
      })()}

      {/* Taxonomy Suggestions */}
      {activeDebate.taxonomy_suggestions && activeDebate.taxonomy_suggestions.length > 0 && (
        <CollapsibleSection title={`Taxonomy Suggestions — ${activeDebate.taxonomy_suggestions.length} revisions`} defaultOpen>
          {activeDebate.taxonomy_suggestions.map((sug, i) => (
            <div key={i} className="diag-taxo-suggestion">
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="diag-an-id">{sug.node_id}</span>
                <strong style={{ fontSize: '0.7rem' }}>{sug.node_label}</strong>
                <span className="diag-badge diag-badge-move" style={{ fontSize: '0.5rem' }}>{sug.node_pov}</span>
                <span className={`diag-badge diag-suggestion-${sug.suggestion_type}`} style={{ fontSize: '0.5rem' }}>{sug.suggestion_type}</span>
              </div>
              {sug.current_description && (
                <div className="diag-taxo-before">
                  <span className="diag-k">Before:</span>
                  <div className="diag-taxo-desc">{sug.current_description}</div>
                </div>
              )}
              <div className="diag-taxo-after">
                <span className="diag-k">After:</span>
                <div className="diag-taxo-desc diag-taxo-desc-proposed">{sug.proposed_description}</div>
              </div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 4 }}>
                {sug.rationale}
              </div>
              {sug.evidence_claim_ids && sug.evidence_claim_ids.length > 0 && (
                <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Evidence: {sug.evidence_claim_ids.join(', ')}
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
              await api.openDiagnosticsWindow();
              useDebateStore.getState().setDiagPopoutOpen(true);
              const debate = useDebateStore.getState().activeDebate;
              const entry = useDebateStore.getState().selectedDiagEntry;
              setTimeout(() => {
                api.sendDiagnosticsState({ debate, selectedEntry: entry });
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
