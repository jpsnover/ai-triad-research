// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import type { EntryDiagnostics, ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../../types/debate';
import { Highlight, Section, CopyButton } from '../helpers';
import './EvidenceTab.css';

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

type EvidenceStageDiag = NonNullable<EntryDiagnostics['stage_diagnostics']>[number];

// -- 1. Evidence Summary --
function buildSummaryCards(evidenceWP: EvidenceWP | undefined): { label: string; value: string }[] {
  return [
    { label: 'Facts', value: String(evidenceWP?.facts?.length ?? 0) },
    { label: 'Key Points', value: String(evidenceWP?.keyPoints?.length ?? 0) },
    { label: 'Nodes Covered', value: String(evidenceWP?.nodesCovered?.length ?? 0) },
    { label: 'Total Candidates', value: String(evidenceWP?.totalCandidates ?? 0) },
    ...((evidenceWP as Record<string, unknown>)?.evidence_utilization ? [{
      label: 'Citation Rate',
      value: `${((evidenceWP as Record<string, unknown>).evidence_utilization as { utilization_rate: number }).utilization_rate}%`,
    }] : []),
  ];
}

function SummaryMetaRow({ evidenceStage, evidenceWP }: {
  evidenceStage: EvidenceStageDiag;
  evidenceWP: EvidenceWP | undefined;
}) {
  return (
    <div className="evid-meta-row">
      <span>{evidenceStage.model}</span>
      <span>{(evidenceStage.response_time_ms / 1000).toFixed(1)}s</span>
      {evidenceWP?.nodesCovered && <span>Nodes covered: {evidenceWP.nodesCovered.join(', ')}</span>}
      {evidenceWP?.totalCandidates != null && <span>({evidenceWP.totalCandidates} candidates screened)</span>}
    </div>
  );
}

function EvidenceSummarySection({ evidenceStage, evidenceWP }: {
  evidenceStage: EvidenceStageDiag | undefined;
  evidenceWP: EvidenceWP | undefined;
}) {
  if (!evidenceStage) return null;
  return (
    <details open>
      <summary className="evid-summary">Source Evidence Retrieved</summary>
      <SummaryMetaRow evidenceStage={evidenceStage} evidenceWP={evidenceWP} />
      {evidenceStage.parse_error && (
        <div className="evid-parse-error">
          <strong>Parse error:</strong> {evidenceStage.parse_error}
        </div>
      )}
      <div className="evid-cards-row">
        {buildSummaryCards(evidenceWP).map(card => (
          <div key={card.label} className="evid-card">
            <div className="evid-card-label">{card.label}</div>
            <div className="evid-card-value">{card.value}</div>
          </div>
        ))}
      </div>
    </details>
  );
}

// -- 2. Source Facts --
function SourceFactsSection({ evidenceWP }: { evidenceWP: EvidenceWP | undefined }) {
  if (!evidenceWP?.facts || evidenceWP.facts.length === 0) return null;
  return (
    <details open className="evid-details-mt">
      <summary className="evid-summary">
        Source Facts ({evidenceWP.facts.length})
      </summary>
      {evidenceWP.facts.map((fact, fi) => {
        const specColor = fact.specificity === 'precise' ? 'var(--success)' : fact.specificity === 'qualified' ? 'var(--warning)' : 'var(--text-muted)';
        return (
          <div key={fi} className="evid-fact">
            <div className="evid-row-center-gap6">
              {/* eslint-disable-next-line local/no-inline-style -- dynamic specColor swatch */}
              <span style={{
                fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 5px', borderRadius: 3,
                color: specColor, background: `${specColor}18`,
              }}>{fact.specificity?.toUpperCase() ?? 'FACT'}</span>
              <a
                href={`https://scholar.google.com/scholar?q=${encodeURIComponent(fact.doc_id.replace(/-/g, ' ').replace(/\d{4}$/, ''))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="evid-doc-link"
                title={`Search for: ${fact.doc_id}`}
              >
                {fact.doc_id}
              </a>
              {fact.temporal_bound && (
                <span className="evid-temporal">{fact.temporal_bound}</span>
              )}
            </div>
            <div className="evid-claim">{fact.claim}</div>
            {fact.linked_taxonomy_nodes?.length > 0 && (
              <div className="evid-linked-nodes">
                {fact.linked_taxonomy_nodes.join(', ')}
              </div>
            )}
          </div>
        );
      })}
    </details>
  );
}

// -- 3. Key Points --
function KeyPointsSection({ evidenceWP }: { evidenceWP: EvidenceWP | undefined }) {
  if (!evidenceWP?.keyPoints || evidenceWP.keyPoints.length === 0) return null;
  return (
    <details open className="evid-details-mt">
      <summary className="evid-summary">
        Key Points ({evidenceWP.keyPoints.length})
      </summary>
      {evidenceWP.keyPoints.map((kp, ki) => {
        const stanceColor = kp.stance === 'support' || kp.stance === 'agree' ? 'var(--success)'
          : kp.stance === 'oppose' || kp.stance === 'disagree' ? 'var(--danger)' : 'var(--warning)';
        return (
          // eslint-disable-next-line local/no-inline-style -- dynamic stanceColor border
          <div key={ki} style={{
            marginBottom: 6, padding: '6px 8px', borderRadius: 4,
            borderLeft: `3px solid ${stanceColor}`, background: 'var(--bg-secondary)',
          }}>
            <div className="evid-row-center-gap6">
              {/* eslint-disable-next-line local/no-inline-style -- dynamic stanceColor swatch */}
              <span style={{
                fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 5px', borderRadius: 3,
                color: stanceColor, background: `${stanceColor}18`,
              }}>{kp.stance?.toUpperCase() ?? 'POINT'}</span>
              <span className="evid-muted-2xs">{kp.pov}</span>
              <a
                href={`https://scholar.google.com/scholar?q=${encodeURIComponent(kp.doc_id.replace(/-/g, ' ').replace(/\d{4}$/, ''))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="evid-doc-link"
                title={`Search for: ${kp.doc_id}`}
              >
                {kp.doc_id}
              </a>
            </div>
            <div className="evid-claim">{kp.point}</div>
            {kp.verbatim && (
              <div className="evid-verbatim">
                &ldquo;{kp.verbatim}&rdquo;
              </div>
            )}
          </div>
        );
      })}
    </details>
  );
}

// -- 4. Raw Evidence Block --
function RawEvidenceSection({ evidenceStage }: { evidenceStage: EvidenceStageDiag | undefined }) {
  if (!evidenceStage) return null;
  return (
    <details className="evid-details-mt">
      <summary className="evid-summary-muted">
        Raw Evidence Block <CopyButton text={evidenceStage.raw_response} />
      </summary>
      <pre className="evid-raw-pre">{evidenceStage.raw_response}</pre>
    </details>
  );
}

// -- 5. Cited Evidence (what the debater actually referenced) --
function CitedEvidenceSection({ evidenceWP }: { evidenceWP: EvidenceWP | undefined }) {
  const eu = (evidenceWP as Record<string, unknown>)?.evidence_utilization as {
    total_docs?: number; cited_docs?: Array<{ doc_id: string; title?: string; match_type: string }>; utilization_rate?: number;
  } | undefined;
  if (!eu?.cited_docs || eu.total_docs === 0) return null;
  const matchColors: Record<string, string> = { exact_id: 'var(--success)', slug: 'var(--text-secondary)', title_exact: 'var(--text-secondary)', title_partial: 'var(--warning)', markdown_link: 'var(--success)' };
  return (
    <details open className="evid-details-mt">
      <summary className="evid-summary">
        Cited Evidence ({eu.cited_docs.length}/{eu.total_docs} sources, {eu.utilization_rate}%)
      </summary>
      {eu.cited_docs.length === 0 ? (
        <div className="evid-empty-cite">
          Debater did not cite any source documents from the evidence brief.
        </div>
      ) : (
        eu.cited_docs.map((cd, i) => (
          // eslint-disable-next-line local/no-inline-style -- dynamic matchColors border
          <div key={i} style={{ marginBottom: 4, padding: '4px 8px', borderRadius: 4, borderLeft: `3px solid ${matchColors[cd.match_type] ?? 'var(--text-muted)'}`, background: 'var(--bg-secondary)', fontSize: 'var(--text-2xs)' }}>
            <span className="evid-bold600">{cd.title ?? cd.doc_id}</span>
            {/* eslint-disable-next-line local/no-inline-style -- dynamic matchColors chip */}
            <span style={{ fontSize: 'var(--text-2xs)', marginLeft: 6, padding: '0 4px', borderRadius: 3, color: matchColors[cd.match_type] ?? 'var(--text-muted)', background: `color-mix(in srgb, ${matchColors[cd.match_type] ?? 'var(--text-muted)'} 10%, transparent)` }}>
              {cd.match_type.replace('_', ' ')}
            </span>
          </div>
        ))
      )}
    </details>
  );
}

// -- 6. Citation Pipeline (full chain per source) --
function CitationPipelineSection({ evidenceWP }: { evidenceWP: EvidenceWP | undefined }) {
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
    <details className="evid-details-mt">
      <summary className="evid-summary">
        Citation Pipeline ({pipeline.filter(p => p.cited).length}/{pipeline.length} cited, {pipeline.filter(p => p.linkified).length} linkified)
      </summary>
      <table className="evid-table">
        <thead>
          <tr className="evid-thead-row">
            <th className="evid-th-left">Source</th>
            <th className="evid-th-left">Title</th>
            <th className="evid-th-center">URL Type</th>
            <th className="evid-th-center">Cited</th>
            <th className="evid-th-center">Match</th>
            <th className="evid-th-center">Linked</th>
          </tr>
        </thead>
        <tbody>
          {pipeline.map((p, pi) => (
            // eslint-disable-next-line local/no-inline-style -- dynamic cited-row highlight
            <tr key={pi} style={{
              borderBottom: '1px solid var(--border-color)',
              background: p.cited ? 'color-mix(in srgb, var(--success) 5%, transparent)' : 'transparent',
            }}>
              <td className="evid-td-source">
                {p.resolved_url ? (
                  <a href={p.resolved_url} target="_blank" rel="noopener noreferrer"
                    className="evid-cite-link" title={p.doc_id}>
                    {p.doc_id.length > 25 ? p.doc_id.slice(0, 22) + '…' : p.doc_id}
                  </a>
                ) : (
                  <span title={p.doc_id}>{p.doc_id.length > 25 ? p.doc_id.slice(0, 22) + '…' : p.doc_id}</span>
                )}
              </td>
              <td className="evid-td-title"
                title={p.resolved_title}>
                {p.resolved_title !== p.doc_id ? p.resolved_title.slice(0, 35) : '—'}
              </td>
              <td className="evid-td-center">
                {/* eslint-disable-next-line local/no-inline-style -- dynamic urlTypeColors chip */}
                <span style={{
                  fontSize: 'var(--text-2xs)', padding: '0 4px', borderRadius: 3, fontWeight: 600,
                  color: urlTypeColors[p.url_type] ?? 'var(--text-muted)',
                  background: `color-mix(in srgb, ${urlTypeColors[p.url_type] ?? 'var(--text-muted)'} 10%, transparent)`,
                }}>{p.url_type}</span>
              </td>
              <td className="evid-td-center">
                {p.cited ? '✓' : '—'}
              </td>
              <td className="evid-td-center">
                {p.match_type ? (
                  <span className="evid-muted-2xs">
                    {p.match_type.replace('_', ' ')}
                  </span>
                ) : '—'}
              </td>
              <td className="evid-td-center">
                {p.linkified ? '🔗' : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pipeline.some(p => p.provenance_label) && (
        <div className="evid-provenance">
          Provenance: {pipeline.filter(p => p.provenance_label).map(p => `${p.doc_id} → ${p.provenance_label}`).join(', ')}
        </div>
      )}
    </details>
  );
}

// -- 7. Ungrounded Claims (from model knowledge, not corpus) --
function UngroundedClaimsSection({ evidenceWP }: { evidenceWP: EvidenceWP | undefined }) {
  const uc = (evidenceWP as Record<string, unknown>)?.ungrounded_claims as
    Array<{ claim: string; reason: string }> | undefined;
  if (!uc || uc.length === 0) return null;
  return (
    <details className="evid-details-mt">
      <summary className="evid-summary-secondary">
        Ungrounded Claims ({uc.length})
      </summary>
      <div className="evid-ungrounded-note">
        These factual assertions appear in the statement but don&apos;t match any source in the evidence block or corpus. They likely come from the model&apos;s training data.
      </div>
      {uc.map((c, ci) => (
        <div key={ci} className="evid-ungrounded-item">
          <div>{c.claim}</div>
          <div className="evid-linked-nodes">{c.reason}</div>
        </div>
      ))}
    </details>
  );
}

// -- Extraction Funnel (post-turn) --
function ExtractionFunnelSection({ extTrace }: { extTrace: ExtractionTrace | undefined }) {
  if (!extTrace || extTrace.candidates_proposed <= 0) return null;
  const max = extTrace.candidates_proposed;
  const bars: [string, number, string][] = [
    ['Candidates', extTrace.candidates_proposed, 'var(--text-secondary)'],
    ['Accepted', extTrace.candidates_accepted, 'var(--success)'],
    ['Rejected', extTrace.candidates_rejected, 'var(--danger)'],
  ];
  return (
    <details open className="evid-details-mt">
      <summary className="evid-summary">Extraction Funnel</summary>
      <div className="evid-funnel-wrap">
        {bars.map(([label, count, color]) => (
          <div key={label} className="evid-funnel-row">
            <span className="evid-funnel-label">{label}</span>
            <div className="evid-funnel-track">
              {/* eslint-disable-next-line local/no-inline-style -- dynamic bar width/color */}
              <div style={{
                width: `${max > 0 ? Math.round(count / max * 100) : 0}%`,
                height: '100%', borderRadius: 3, background: color,
                minWidth: count > 0 ? 4 : 0,
              }} />
            </div>
            <span className="evid-funnel-count">{count}</span>
            <span className="evid-muted-2xs">
              {max > 0 ? `${Math.round(count / max * 100)}%` : ''}
            </span>
          </div>
        ))}
        {extTrace.rejection_reasons && Object.keys(extTrace.rejection_reasons).length > 0 && (
          <div className="evid-reasons-row">
            {Object.entries(extTrace.rejection_reasons).map(([reason, count]) => (
              <span key={reason} className="evid-reason-chip">{reason} ({count})</span>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function ANDeltaEdgeNodeText({ sourceNode, targetNode }: {
  sourceNode: ArgumentNetworkNode | undefined;
  targetNode: ArgumentNetworkNode | undefined;
}) {
  if (!sourceNode && !targetNode) return null;
  return (
    <div className="evid-edge-text">
      {sourceNode && <span title={sourceNode.attribution_text_genus || undefined}>{sourceNode.text.length > 60 ? sourceNode.text.slice(0, 60) + '…' : sourceNode.text}</span>}
      {sourceNode && targetNode && <span> → </span>}
      {targetNode && <span title={targetNode.attribution_text_genus || undefined}>{targetNode.text.length > 60 ? targetNode.text.slice(0, 60) + '…' : targetNode.text}</span>}
    </div>
  );
}

function ANDeltaEdgeRow({ edge, an, sColors }: {
  edge: ArgumentNetworkEdge;
  an: ArgumentNetwork | undefined;
  sColors: Record<string, string>;
}) {
  const sourceNode = an?.nodes.find(n => n.id === edge.source);
  const targetNode = an?.nodes.find(n => n.id === edge.target);
  const edgeColor = edge.type === 'attacks' ? 'var(--danger)' : 'var(--success)';
  const edgeLabel = edge.type === 'attacks'
    ? (edge.attack_type ? `attacks (${edge.attack_type})` : 'attacks')
    : 'supports';
  return (
    // eslint-disable-next-line local/no-inline-style -- dynamic edgeColor border
    <div style={{ margin: '3px 0', paddingLeft: 10, borderLeft: `2px solid ${edgeColor}` }}>
      <div className="evid-edge-header">
        <span className="evid-edge-node">{edge.source}</span>
        {/* eslint-disable-next-line local/no-inline-style -- dynamic edgeColor label */}
        <span style={{ color: edgeColor, fontWeight: 600 }}>{edgeLabel}</span>
        <span className="evid-edge-node">{edge.target}</span>
        {edge.strength && (
          // eslint-disable-next-line local/no-inline-style -- dynamic sColors strength chip
          <span style={{ padding: '0 3px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, background: `color-mix(in srgb, ${sColors[edge.strength] ?? 'var(--text-muted)'} 10%, transparent)`, color: sColors[edge.strength] ?? 'var(--text-muted)' }}>
            {edge.strength}
          </span>
        )}
        {edge.argumentation_scheme && (
          <span className="evid-scheme-chip">
            {edge.argumentation_scheme}
          </span>
        )}
      </div>
      <ANDeltaEdgeNodeText sourceNode={sourceNode} targetNode={targetNode} />
      {edge.warrant && (
        <details className="evid-mt2">
          <summary className="evid-summary-muted">Warrant</summary>
          <div className="evid-warrant">
            {edge.warrant}
          </div>
        </details>
      )}
    </div>
  );
}

// -- AN Delta (post-turn) --
function ANDeltaSection({ extTrace, an }: {
  extTrace: ExtractionTrace | undefined;
  an: ArgumentNetwork | undefined;
}) {
  if (!extTrace) return null;
  const addedEdges = an?.edges.filter(e =>
    extTrace.an_nodes_added_ids.includes(e.source) || extTrace.an_nodes_added_ids.includes(e.target)
  ) ?? [];
  const attackEdges = addedEdges.filter(e => e.type === 'attacks').length;
  const supportEdges = addedEdges.length - attackEdges;
  const sColors: Record<string, string> = { decisive: 'var(--success)', substantial: 'var(--text-secondary)', tangential: 'var(--text-muted)' };
  return (
    <details open className="evid-details-mt">
      <summary className="evid-summary">AN Delta</summary>
      <div className="evid-delta-cards">
        <div className="evid-delta-card">
          <div className="evid-muted-2xs">Nodes Added</div>
          <div className="evid-mono700">{extTrace.an_nodes_added_ids.length}</div>
          {extTrace.an_nodes_added_ids.length > 0 && (
            <div className="evid-nodes-added">
              {extTrace.an_nodes_added_ids.join(', ')}
            </div>
          )}
        </div>
        <div className="evid-delta-card">
          <div className="evid-muted-2xs">Edges Added</div>
          <div className="evid-mono700">{addedEdges.length}</div>
          <div className="evid-edges-sub">
            <span className="evid-success">{supportEdges} support</span>{' / '}
            <span className="evid-danger">{attackEdges} attack</span>
          </div>
        </div>
        <div className="evid-delta-card">
          <div className="evid-muted-2xs">Network Size</div>
          <div className="evid-mono700">
            {extTrace.an_node_count_before} → {extTrace.an_node_count_after}
          </div>
        </div>
      </div>
      {addedEdges.length > 0 && (
        <div className="evid-edges-list">
          {addedEdges.map((edge, ei) => (
            <ANDeltaEdgeRow key={ei} edge={edge} an={an} sColors={sColors} />
          ))}
        </div>
      )}
    </details>
  );
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
    <div className="evid-root">
      {!evidenceStage && !extTrace ? (
        <div className="evid-empty">
          {entry.type === 'opening'
            ? 'Evidence retrieval does not run for opening statements — openings establish positions without source grounding.'
            : 'No evidence data available for this turn.'}
        </div>
      ) : (<>
        <EvidenceSummarySection evidenceStage={evidenceStage} evidenceWP={evidenceWP} />
        <SourceFactsSection evidenceWP={evidenceWP} />
        <KeyPointsSection evidenceWP={evidenceWP} />
        <RawEvidenceSection evidenceStage={evidenceStage} />
        <CitedEvidenceSection evidenceWP={evidenceWP} />
        <CitationPipelineSection evidenceWP={evidenceWP} />
        <UngroundedClaimsSection evidenceWP={evidenceWP} />
        <ExtractionFunnelSection extTrace={extTrace} />
        <ANDeltaSection extTrace={extTrace} an={an} />
      </>)}
    </div>
  );
}
