// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import type { EntryDiagnostics, ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../../types/debate';
import { Highlight, Section, CopyButton } from '../helpers';

interface EvidenceWP {
  facts?: {
    claim: string;
    claim_label: string;
    doc_id: string;
    specificity: string;
    temporal_bound?: string | null;
    linked_taxonomy_nodes: string[];
  }[];
  keyPoints?: {
    stance: string;
    point: string;
    doc_id: string;
    pov: string;
    verbatim?: string;
  }[];
  nodesCovered?: string[];
  totalCandidates?: number;
}

interface ExtractionTrace {
  candidates_proposed: number;
  candidates_accepted: number;
  candidates_rejected: number;
  rejection_reasons: Record<string, number>;
  an_node_count_before: number;
  an_node_count_after: number;
  an_nodes_added_ids: string[];
}

interface ArgumentNetwork {
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
}

export interface EvidenceTabProps {
  entry: { id: string; type: string; content?: unknown; metadata?: unknown; taxonomy_refs?: unknown[]; policy_refs?: unknown[]; speaker: string };
  diag: EntryDiagnostics | undefined;
  an: ArgumentNetwork | undefined;
  searchQuery?: string;
}

export function EvidenceTab({ entry, diag, an, searchQuery }: EvidenceTabProps) {
  const evidenceStage = diag?.stage_diagnostics?.find(s => s.stage === 'evidence');
  const evidenceWP = evidenceStage?.work_product as EvidenceWP | undefined;
  const extTrace = diag?.extraction_trace as ExtractionTrace | undefined;

  return (
    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
      {!evidenceStage && !extTrace ? (
        <div style={{ padding: '12px 8px', color: 'var(--text-muted)', fontSize: '0.72rem', textAlign: 'center' }}>
          {entry.type === 'opening'
            ? 'Evidence retrieval does not run for opening statements — openings establish positions without source grounding.'
            : 'No evidence data available for this turn.'}
        </div>
      ) : (<>
        {/* -- 1. Evidence Summary -- */}
        {evidenceStage && (
          <details open>
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', marginBottom: 6 }}>Source Evidence Retrieved</summary>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
              <span>{evidenceStage.model}</span>
              <span>{(evidenceStage.response_time_ms / 1000).toFixed(1)}s</span>
              {evidenceWP?.nodesCovered && <span>Nodes covered: {evidenceWP.nodesCovered.join(', ')}</span>}
              {evidenceWP?.totalCandidates != null && <span>({evidenceWP.totalCandidates} candidates screened)</span>}
            </div>
            {evidenceStage.parse_error && (
              <div style={{ padding: '4px 6px', marginBottom: 6, background: 'color-mix(in srgb, var(--danger) 10%, transparent)', borderLeft: '3px solid var(--danger)', borderRadius: 3, fontSize: 'var(--text-2xs)', color: 'var(--danger)' }}>
                <strong>Parse error:</strong> {evidenceStage.parse_error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              {[
                { label: 'Facts', value: String(evidenceWP?.facts?.length ?? 0) },
                { label: 'Key Points', value: String(evidenceWP?.keyPoints?.length ?? 0) },
                { label: 'Nodes Covered', value: String(evidenceWP?.nodesCovered?.length ?? 0) },
                { label: 'Total Candidates', value: String(evidenceWP?.totalCandidates ?? 0) },
                ...((evidenceWP as Record<string, unknown>)?.evidence_utilization ? [{
                  label: 'Citation Rate',
                  value: `${((evidenceWP as Record<string, unknown>).evidence_utilization as { utilization_rate: number }).utilization_rate}%`,
                }] : []),
              ].map(card => (
                <div key={card.label} style={{
                  flex: '1 1 90px', padding: '6px 10px', borderRadius: 4,
                  background: 'var(--bg-subtle)', border: '1px solid var(--border)', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 2 }}>{card.label}</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'monospace' }}>{card.value}</div>
                </div>
              ))}
            </div>
          </details>
        )}
        {/* -- 2. Source Facts -- */}
        {evidenceWP?.facts && evidenceWP.facts.length > 0 && (
          <details open style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', marginBottom: 6 }}>
              Source Facts ({evidenceWP.facts.length})
            </summary>
            {evidenceWP.facts.map((fact, fi) => {
              const specColor = fact.specificity === 'precise' ? 'var(--success)' : fact.specificity === 'qualified' ? 'var(--warning)' : 'var(--text-muted)';
              return (
                <div key={fi} style={{
                  marginBottom: 6, padding: '6px 8px', borderRadius: 4,
                  borderLeft: '3px solid var(--text-secondary)', background: 'var(--bg-subtle)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{
                      fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 5px', borderRadius: 3,
                      color: specColor, background: `${specColor}18`,
                    }}>{fact.specificity?.toUpperCase() ?? 'FACT'}</span>
                    <a
                      href={`https://scholar.google.com/scholar?q=${encodeURIComponent(fact.doc_id.replace(/-/g, ' ').replace(/\d{4}$/, ''))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}
                      title={`Search for: ${fact.doc_id}`}
                    >
                      {fact.doc_id}
                    </a>
                    {fact.temporal_bound && (
                      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginLeft: 'auto' }}>{fact.temporal_bound}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 'var(--text-2xs)', lineHeight: 1.35 }}>{fact.claim}</div>
                  {fact.linked_taxonomy_nodes?.length > 0 && (
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                      {fact.linked_taxonomy_nodes.join(', ')}
                    </div>
                  )}
                </div>
              );
            })}
          </details>
        )}
        {/* -- 3. Key Points -- */}
        {evidenceWP?.keyPoints && evidenceWP.keyPoints.length > 0 && (
          <details open style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', marginBottom: 6 }}>
              Key Points ({evidenceWP.keyPoints.length})
            </summary>
            {evidenceWP.keyPoints.map((kp, ki) => {
              const stanceColor = kp.stance === 'support' || kp.stance === 'agree' ? 'var(--success)'
                : kp.stance === 'oppose' || kp.stance === 'disagree' ? 'var(--danger)' : 'var(--warning)';
              return (
                <div key={ki} style={{
                  marginBottom: 6, padding: '6px 8px', borderRadius: 4,
                  borderLeft: `3px solid ${stanceColor}`, background: 'var(--bg-subtle)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{
                      fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 5px', borderRadius: 3,
                      color: stanceColor, background: `${stanceColor}18`,
                    }}>{kp.stance?.toUpperCase() ?? 'POINT'}</span>
                    <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{kp.pov}</span>
                    <a
                      href={`https://scholar.google.com/scholar?q=${encodeURIComponent(kp.doc_id.replace(/-/g, ' ').replace(/\d{4}$/, ''))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}
                      title={`Search for: ${kp.doc_id}`}
                    >
                      {kp.doc_id}
                    </a>
                  </div>
                  <div style={{ fontSize: 'var(--text-2xs)', lineHeight: 1.35 }}>{kp.point}</div>
                  {kp.verbatim && (
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2, borderLeft: '2px solid var(--border)', paddingLeft: 6 }}>
                      &ldquo;{kp.verbatim}&rdquo;
                    </div>
                  )}
                </div>
              );
            })}
          </details>
        )}
        {/* -- 4. Raw Evidence Block -- */}
        {evidenceStage && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
              Raw Evidence Block <CopyButton text={evidenceStage.raw_response} />
            </summary>
            <pre style={{ fontSize: 'var(--text-2xs)', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{evidenceStage.raw_response}</pre>
          </details>
        )}
        {/* -- 5. Cited Evidence (what the debater actually referenced) -- */}
        {(() => {
          const eu = (evidenceWP as Record<string, unknown>)?.evidence_utilization as {
            total_docs?: number; cited_docs?: Array<{ doc_id: string; title?: string; match_type: string }>; utilization_rate?: number;
          } | undefined;
          if (!eu?.cited_docs || eu.total_docs === 0) return null;
          const matchColors: Record<string, string> = { exact_id: 'var(--success)', slug: 'var(--text-secondary)', title_exact: 'var(--text-secondary)', title_partial: 'var(--warning)', markdown_link: 'var(--success)' };
          return (
            <details open style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', marginBottom: 6 }}>
                Cited Evidence ({eu.cited_docs.length}/{eu.total_docs} sources, {eu.utilization_rate}%)
              </summary>
              {eu.cited_docs.length === 0 ? (
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--danger)', padding: '4px 6px', background: 'color-mix(in srgb, var(--danger) 8%, transparent)', borderRadius: 3 }}>
                  Debater did not cite any source documents from the evidence brief.
                </div>
              ) : (
                eu.cited_docs.map((cd, i) => (
                  <div key={i} style={{ marginBottom: 4, padding: '4px 8px', borderRadius: 4, borderLeft: `3px solid ${matchColors[cd.match_type] ?? 'var(--text-muted)'}`, background: 'var(--bg-subtle)', fontSize: 'var(--text-2xs)' }}>
                    <span style={{ fontWeight: 600 }}>{cd.title ?? cd.doc_id}</span>
                    <span style={{ fontSize: 'var(--text-2xs)', marginLeft: 6, padding: '0 4px', borderRadius: 3, color: matchColors[cd.match_type] ?? 'var(--text-muted)', background: `color-mix(in srgb, ${matchColors[cd.match_type] ?? 'var(--text-muted)'} 10%, transparent)` }}>
                      {cd.match_type.replace('_', ' ')}
                    </span>
                  </div>
                ))
              )}
            </details>
          );
        })()}
        {/* -- 6. Citation Pipeline (full chain per source) -- */}
        {(() => {
          const pipeline = (evidenceWP as Record<string, unknown>)?.citation_pipeline as Array<{
            doc_id: string; resolved_title: string; resolved_url: string | null;
            url_type: string; provenance_label: string | null;
            cited: boolean; match_type: string | null; linkified: boolean;
          }> | undefined;
          if (!pipeline || pipeline.length === 0) return null;
          const urlTypeColors: Record<string, string> = {
            doi: 'var(--success)', arxiv: 'var(--success)', ssrn: 'var(--success)', direct: 'var(--text-secondary)',
            scholar_fallback: 'var(--warning)', google_fallback: 'var(--warning)', none: 'var(--danger)',
          };
          return (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', marginBottom: 6 }}>
                Citation Pipeline ({pipeline.filter(p => p.cited).length}/{pipeline.length} cited, {pipeline.filter(p => p.linkified).length} linkified)
              </summary>
              <table style={{ width: '100%', fontSize: 'var(--text-2xs)', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th style={{ textAlign: 'left', padding: '2px 4px' }}>Source</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px' }}>Title</th>
                    <th style={{ textAlign: 'center', padding: '2px 4px' }}>URL Type</th>
                    <th style={{ textAlign: 'center', padding: '2px 4px' }}>Cited</th>
                    <th style={{ textAlign: 'center', padding: '2px 4px' }}>Match</th>
                    <th style={{ textAlign: 'center', padding: '2px 4px' }}>Linked</th>
                  </tr>
                </thead>
                <tbody>
                  {pipeline.map((p, pi) => (
                    <tr key={pi} style={{
                      borderBottom: '1px solid var(--border)',
                      background: p.cited ? 'color-mix(in srgb, var(--success) 5%, transparent)' : 'transparent',
                    }}>
                      <td style={{ padding: '3px 4px', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.resolved_url ? (
                          <a href={p.resolved_url} target="_blank" rel="noopener noreferrer"
                            style={{ color: 'var(--text-secondary)', textDecoration: 'none' }} title={p.doc_id}>
                            {p.doc_id.length > 25 ? p.doc_id.slice(0, 22) + '…' : p.doc_id}
                          </a>
                        ) : (
                          <span title={p.doc_id}>{p.doc_id.length > 25 ? p.doc_id.slice(0, 22) + '…' : p.doc_id}</span>
                        )}
                      </td>
                      <td style={{ padding: '3px 4px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={p.resolved_title}>
                        {p.resolved_title !== p.doc_id ? p.resolved_title.slice(0, 35) : '—'}
                      </td>
                      <td style={{ textAlign: 'center', padding: '3px 4px' }}>
                        <span style={{
                          fontSize: 'var(--text-2xs)', padding: '0 4px', borderRadius: 3, fontWeight: 600,
                          color: urlTypeColors[p.url_type] ?? 'var(--text-muted)',
                          background: `color-mix(in srgb, ${urlTypeColors[p.url_type] ?? 'var(--text-muted)'} 10%, transparent)`,
                        }}>{p.url_type}</span>
                      </td>
                      <td style={{ textAlign: 'center', padding: '3px 4px' }}>
                        {p.cited ? '✓' : '—'}
                      </td>
                      <td style={{ textAlign: 'center', padding: '3px 4px' }}>
                        {p.match_type ? (
                          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                            {p.match_type.replace('_', ' ')}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'center', padding: '3px 4px' }}>
                        {p.linkified ? '🔗' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pipeline.some(p => p.provenance_label) && (
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 4 }}>
                  Provenance: {pipeline.filter(p => p.provenance_label).map(p => `${p.doc_id} → ${p.provenance_label}`).join(', ')}
                </div>
              )}
            </details>
          );
        })()}
        {/* -- 7. Ungrounded Claims (from model knowledge, not corpus) -- */}
        {(() => {
          const uc = (evidenceWP as Record<string, unknown>)?.ungrounded_claims as
            Array<{ claim: string; reason: string }> | undefined;
          if (!uc || uc.length === 0) return null;
          return (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', marginBottom: 6, color: 'var(--text-secondary)' }}>
                Ungrounded Claims ({uc.length})
              </summary>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 6 }}>
                These factual assertions appear in the statement but don&apos;t match any source in the evidence block or corpus. They likely come from the model&apos;s training data.
              </div>
              {uc.map((c, ci) => (
                <div key={ci} style={{
                  marginBottom: 4, padding: '4px 8px', borderRadius: 4,
                  borderLeft: '3px solid var(--text-secondary)', background: 'color-mix(in srgb, var(--text-secondary) 6%, transparent)',
                  fontSize: 'var(--text-2xs)',
                }}>
                  <div>{c.claim}</div>
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{c.reason}</div>
                </div>
              ))}
            </details>
          );
        })()}
        {/* -- Extraction Funnel (post-turn) -- */}
        {extTrace && extTrace.candidates_proposed > 0 && (
          <details open style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', marginBottom: 6 }}>Extraction Funnel</summary>
            {(() => {
              const max = extTrace.candidates_proposed;
              const bars: [string, number, string][] = [
                ['Candidates', extTrace.candidates_proposed, 'var(--text-secondary)'],
                ['Accepted', extTrace.candidates_accepted, 'var(--success)'],
                ['Rejected', extTrace.candidates_rejected, 'var(--danger)'],
              ];
              return (
                <div style={{ marginBottom: 6 }}>
                  {bars.map(([label, count, color]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 'var(--text-2xs)' }}>
                      <span style={{ width: 70, textAlign: 'right', color: 'var(--text-muted)' }}>{label}</span>
                      <div style={{ flex: 1, height: 12, borderRadius: 3, background: 'var(--bg-primary)' }}>
                        <div style={{
                          width: `${max > 0 ? Math.round(count / max * 100) : 0}%`,
                          height: '100%', borderRadius: 3, background: color,
                          minWidth: count > 0 ? 4 : 0,
                        }} />
                      </div>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600, minWidth: 30 }}>{count}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>
                        {max > 0 ? `${Math.round(count / max * 100)}%` : ''}
                      </span>
                    </div>
                  ))}
                  {extTrace.rejection_reasons && Object.keys(extTrace.rejection_reasons).length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4, paddingLeft: 78 }}>
                      {Object.entries(extTrace.rejection_reasons).map(([reason, count]) => (
                        <span key={reason} style={{
                          fontSize: 'var(--text-2xs)', padding: '1px 6px', borderRadius: 10,
                          background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', fontWeight: 600,
                        }}>{reason} ({count})</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </details>
        )}
        {/* -- AN Delta (post-turn) -- */}
        {extTrace && (
          <details open style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', marginBottom: 6 }}>AN Delta</summary>
            {(() => {
              const addedEdges = an?.edges.filter(e =>
                extTrace.an_nodes_added_ids.includes(e.source) || extTrace.an_nodes_added_ids.includes(e.target)
              ) ?? [];
              const attackEdges = addedEdges.filter(e => e.type === 'attacks').length;
              const supportEdges = addedEdges.length - attackEdges;
              const sColors: Record<string, string> = { decisive: 'var(--success)', substantial: 'var(--text-secondary)', tangential: 'var(--text-muted)' };
              return (<>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 'var(--text-2xs)', marginBottom: 8 }}>
                  <div style={{ flex: '1 1 120px', padding: '5px 8px', borderRadius: 4, background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>Nodes Added</div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700 }}>{extTrace.an_nodes_added_ids.length}</div>
                    {extTrace.an_nodes_added_ids.length > 0 && (
                      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)', marginTop: 2, wordBreak: 'break-all' }}>
                        {extTrace.an_nodes_added_ids.join(', ')}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: '1 1 120px', padding: '5px 8px', borderRadius: 4, background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>Edges Added</div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700 }}>{addedEdges.length}</div>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                      <span style={{ color: 'var(--success)' }}>{supportEdges} support</span>{' / '}
                      <span style={{ color: 'var(--danger)' }}>{attackEdges} attack</span>
                    </div>
                  </div>
                  <div style={{ flex: '1 1 120px', padding: '5px 8px', borderRadius: 4, background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>Network Size</div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                      {extTrace.an_node_count_before} → {extTrace.an_node_count_after}
                    </div>
                  </div>
                </div>
                {addedEdges.length > 0 && (
                  <div style={{ fontSize: 'var(--text-2xs)' }}>
                    {addedEdges.map((edge, ei) => {
                      const sourceNode = an?.nodes.find(n => n.id === edge.source);
                      const targetNode = an?.nodes.find(n => n.id === edge.target);
                      const edgeColor = edge.type === 'attacks' ? 'var(--danger)' : 'var(--success)';
                      const edgeLabel = edge.type === 'attacks'
                        ? (edge.attack_type ? `attacks (${edge.attack_type})` : 'attacks')
                        : 'supports';
                      return (
                        <div key={ei} style={{ margin: '3px 0', paddingLeft: 10, borderLeft: `2px solid ${edgeColor}` }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{edge.source}</span>
                            <span style={{ color: edgeColor, fontWeight: 600 }}>{edgeLabel}</span>
                            <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{edge.target}</span>
                            {edge.strength && (
                              <span style={{ padding: '0 3px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, background: `color-mix(in srgb, ${sColors[edge.strength] ?? 'var(--text-muted)'} 10%, transparent)`, color: sColors[edge.strength] ?? 'var(--text-muted)' }}>
                                {edge.strength}
                              </span>
                            )}
                            {edge.argumentation_scheme && (
                              <span style={{ padding: '0 3px', borderRadius: 3, fontSize: 'var(--text-2xs)', background: 'color-mix(in srgb, var(--text-secondary) 12%, transparent)', color: 'var(--text-secondary)' }}>
                                {edge.argumentation_scheme}
                              </span>
                            )}
                          </div>
                          {(sourceNode || targetNode) && (
                            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 1 }}>
                              {sourceNode && <span title={sourceNode.attribution_text_genus || undefined}>{sourceNode.text.length > 60 ? sourceNode.text.slice(0, 60) + '…' : sourceNode.text}</span>}
                              {sourceNode && targetNode && <span> → </span>}
                              {targetNode && <span title={targetNode.attribution_text_genus || undefined}>{targetNode.text.length > 60 ? targetNode.text.slice(0, 60) + '…' : targetNode.text}</span>}
                            </div>
                          )}
                          {edge.warrant && (
                            <details style={{ marginTop: 2 }}>
                              <summary style={{ cursor: 'pointer', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>Warrant</summary>
                              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 1, paddingLeft: 4, borderLeft: '1px solid var(--border)' }}>
                                {edge.warrant}
                              </div>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>);
            })()}
          </details>
        )}
      </>)}
    </div>
  );
}
