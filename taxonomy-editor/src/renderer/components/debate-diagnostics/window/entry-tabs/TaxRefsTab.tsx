// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React, { Fragment } from 'react';
import type { DebateSession } from '../../../../types/debate';
import { TaxonomyRefDetail, type TaxRefNode, type TaxRefEdge } from '../../../taxonomy/TaxonomyRefDetail';
import { truncateLabel } from '../shared/constants';
import type { OverviewTab } from '../types';

export interface TaxRefsTabProps {
  entry: DebateSession['transcript'][number];
  meta: Record<string, unknown> | undefined;
  debate: DebateSession;
  taxRefCount: number;
  nodeWeights: Map<string, { confidence?: number; priority?: number; operationality?: number; category?: string }>;
  taxNodeMap: Map<string, Record<string, unknown>>;
  allEdges: TaxRefEdge[];
  selectedTaxRefId: string | null;
  setSelectedTaxRefId: (id: string | null) => void;
  setOverviewTab: (tab: OverviewTab) => void;
}

type TaxRef = NonNullable<DebateSession['transcript'][number]['taxonomy_refs']>[number];
type RelevanceSource = { node_id: string; source: 'an' | 'topic'; an_score: number; topic_score: number; best_claim_id?: string; best_claim_text?: string; best_claim_sim?: number };
type NodeWeight = { confidence?: number; priority?: number; operationality?: number; category?: string };

function scoreColorFor(score: number | undefined): string {
  return score == null ? 'var(--text-muted)'
    : score >= 0.45 ? 'var(--success)'
    : score >= 0.30 ? 'var(--warning)'
    : 'var(--danger)';
}

function weightLabelFor(tw: NodeWeight | undefined): string | null {
  return tw?.category === 'Beliefs' ? 'Confidence'
    : tw?.category === 'Desires' ? 'Priority'
    : tw?.category === 'Intentions' ? 'Operationality' : null;
}

function weightValueFor(tw: NodeWeight | undefined): number | undefined {
  return tw?.category === 'Beliefs' ? tw.confidence
    : tw?.category === 'Desires' ? tw.priority
    : tw?.category === 'Intentions' ? tw.operationality : undefined;
}

function RelevanceWeightLine({ score, weightLabel, weightValue }: { score: number | undefined; weightLabel: string | null; weightValue: number | undefined }) {
  if (!(score != null || weightValue != null)) return null;
  return (
    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>
      ({score != null && <>Relevance {score.toFixed(2)}</>}
      {score != null && weightLabel && weightValue != null && ' ; '}
      {weightLabel && weightValue != null && <>{weightLabel} {weightLabel === 'Confidence' ? weightValue.toFixed(2) : `${weightValue}/5`}</>})
    </div>
  );
}

function TaxRefIdCell({ r, score, tw, isSelected, setSelectedTaxRefId }: { r: TaxRef; score: number | undefined; tw: NodeWeight | undefined; isSelected: boolean; setSelectedTaxRefId: (id: string | null) => void }) {
  const weightLabel = weightLabelFor(tw);
  const weightValue = weightValueFor(tw);
  return (
    <>
      <button
        onClick={() => setSelectedTaxRefId(isSelected ? null : r.node_id)}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: 'var(--accent)', fontWeight: isSelected ? 700 : 600,
          textDecoration: 'underline', fontFamily: 'inherit', fontSize: 'inherit', textAlign: 'left',
        }}
        title="Show Perspective details"
      >{r.primary ? '★ ' : ''}{r.node_id}{(r as {label?: string}).label ? `: ${(r as {label?: string}).label}` : ''}</button>
      <RelevanceWeightLine score={score} weightLabel={weightLabel} weightValue={weightValue} />
    </>
  );
}

function SourceCell({ src, isAN }: { src: RelevanceSource | undefined; isAN: boolean }) {
  return (
    <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>
      {src && (
        <span style={{
          display: 'inline-block',
          padding: '1px 5px',
          borderRadius: 3,
          fontSize: 'var(--text-2xs)',
          fontWeight: 700,
          background: isAN ? 'color-mix(in srgb, var(--success) 20%, transparent)' : 'color-mix(in srgb, var(--warning) 20%, transparent)',
          color: isAN ? 'var(--success)' : 'var(--warning)',
        }}>{isAN ? (src.best_claim_id ?? 'AN') : 'TOPIC'}</span>
      )}
    </td>
  );
}

function ScoringDetailRow({ src, isSelected, hasSourceData, setOverviewTab }: { src: RelevanceSource; isSelected: boolean; hasSourceData: boolean; setOverviewTab: (tab: OverviewTab) => void }) {
  const isAN = src.source === 'an';
  return (
    <tr style={{ borderBottom: '1px solid var(--border-color)', background: isSelected ? 'color-mix(in srgb, var(--warning) 8%, transparent)' : 'transparent' }}>
      <td colSpan={hasSourceData ? 4 : 3} style={{ padding: '0 6px 4px 20px' }}>
        <details style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Scoring detail</summary>
          <div style={{ padding: '4px 0 2px 12px', lineHeight: 1.5 }}>
            {isAN && src.best_claim_id && (
              <div>
                <strong>Best match:</strong>{' '}
                <button onClick={() => setOverviewTab('argument-network')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontFamily: 'inherit', fontSize: 'inherit' }}>{src.best_claim_id}</button>
                {src.best_claim_text && <> &ldquo;{truncateLabel(src.best_claim_text, 60)}&rdquo;</>}
                {src.best_claim_sim != null && <> (sim: {src.best_claim_sim.toFixed(2)})</>}
              </div>
            )}
            <div><strong>AN score:</strong> {src.an_score.toFixed(3)}</div>
            <div><strong>Topic floor:</strong> {(src.topic_score * 0.5).toFixed(3)} (raw: {src.topic_score.toFixed(3)} {'×'} 0.5)</div>
            <div><strong>Winner:</strong> {isAN ? 'AN score used' : 'Topic floor used — no AN match above floor'}</div>
          </div>
        </details>
      </td>
    </tr>
  );
}

function TaxRefRow({ r, hasSourceData, isSelected, src, tw, setSelectedTaxRefId, setOverviewTab }: {
  r: TaxRef;
  hasSourceData: boolean;
  isSelected: boolean;
  src: RelevanceSource | undefined;
  tw: NodeWeight | undefined;
  setSelectedTaxRefId: (id: string | null) => void;
  setOverviewTab: (tab: OverviewTab) => void;
}) {
  const score = r.relevance_score;
  const scoreColor = scoreColorFor(score);
  const isAN = src?.source === 'an';
  return (
    <Fragment>
      <tr
        style={{
          borderBottom: src ? 'none' : '1px solid var(--border-color)',
          background: isSelected ? 'color-mix(in srgb, var(--warning) 8%, transparent)' : 'transparent',
        }}
      >
        {hasSourceData && <SourceCell src={src} isAN={isAN} />}
        <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>
          <TaxRefIdCell r={r} score={score} tw={tw} isSelected={isSelected} setSelectedTaxRefId={setSelectedTaxRefId} />
        </td>
        <td style={{ padding: '4px 6px', verticalAlign: 'top', textAlign: 'center', fontWeight: 600, color: scoreColor, fontFamily: 'monospace', fontSize: '0.75rem' }}>
          {score != null ? score.toFixed(2) : '—'}
        </td>
        <td style={{ padding: '4px 6px', verticalAlign: 'top', whiteSpace: 'normal', wordBreak: 'break-word' }}>
          {r.relevance}
        </td>
      </tr>
      {/* Expandable scoring detail */}
      {src && (
        <ScoringDetailRow src={src} isSelected={isSelected} hasSourceData={hasSourceData} setOverviewTab={setOverviewTab} />
      )}
    </Fragment>
  );
}

/**
 * TaxRefsTab -- Taxonomy References tab.
 * Renders the taxonomy ref table with AN coverage and TaxonomyRefDetail.
 */
export function TaxRefsTab({ entry, meta, debate, taxRefCount, nodeWeights, taxNodeMap, allEdges, selectedTaxRefId, setSelectedTaxRefId, setOverviewTab }: TaxRefsTabProps) {
  const relevanceSources = (meta?.relevance_sources as { node_id: string; source: 'an' | 'topic'; an_score: number; topic_score: number; best_claim_id?: string; best_claim_text?: string; best_claim_sim?: number }[] | undefined);
  const sourceMap = new Map(relevanceSources?.map(s => [s.node_id, s]) ?? []);
  const hasSourceData = sourceMap.size > 0;

  const anCoverage = hasSourceData && debate?.argument_network?.nodes ? (() => {
    const anNodes = debate.argument_network.nodes;
    const claimMaxScores = new Map<string, { maxSim: number; bestNode: string }>();
    for (const src of relevanceSources!) {
      if (src.best_claim_id && src.best_claim_sim != null) {
        const existing = claimMaxScores.get(src.best_claim_id);
        if (!existing || src.best_claim_sim > existing.maxSim) {
          claimMaxScores.set(src.best_claim_id, { maxSim: src.best_claim_sim, bestNode: src.node_id });
        }
      }
    }
    const strong: { id: string; sim: number; text: string }[] = [];
    const moderate: { id: string; sim: number; text: string }[] = [];
    const weak: { id: string; sim: number; text: string }[] = [];
    for (const an of anNodes) {
      const match = claimMaxScores.get(an.id);
      const sim = match?.maxSim ?? 0;
      const item = { id: an.id, sim, text: truncateLabel(an.text, 50) };
      if (sim >= 0.5) strong.push(item);
      else if (sim >= 0.3) moderate.push(item);
      else weak.push(item);
    }
    const grounded = strong.length + moderate.length;
    return { strong, moderate, weak, total: anNodes.length, grounded };
  })() : null;

  return taxRefCount > 0 ? (
    <div style={{ flex: 1, minHeight: 200, overflowY: 'auto', padding: '8px 10px' }}>
      {/* AN Claim Coverage Strip (§6) */}
      {anCoverage && anCoverage.total > 0 && (() => {
        // Build ordered list of all AN nodes with their strength bucket for the strip
        const allAnNodes = debate?.argument_network?.nodes ?? [];
        const claimMaxScores = new Map<string, { maxSim: number; bestNode: string }>();
        for (const src of relevanceSources ?? []) {
          if (src.best_claim_id && src.best_claim_sim != null) {
            const existing = claimMaxScores.get(src.best_claim_id);
            if (!existing || src.best_claim_sim > existing.maxSim) {
              claimMaxScores.set(src.best_claim_id, { maxSim: src.best_claim_sim, bestNode: src.node_id });
            }
          }
        }
        type StrengthBucket = 'strong' | 'moderate' | 'weak' | 'uncovered';
        const stripItems: { id: string; sim: number; text: string; bucket: StrengthBucket }[] = allAnNodes.map(an => {
          const match = claimMaxScores.get(an.id);
          const sim = match?.maxSim ?? 0;
          const bucket: StrengthBucket = sim >= 0.5 ? 'strong' : sim >= 0.3 ? 'moderate' : sim > 0 ? 'weak' : 'uncovered';
          return { id: an.id, sim, text: an.text ?? '', bucket };
        });

        const squareStyle = (bucket: StrengthBucket): React.CSSProperties => {
          switch (bucket) {
            case 'strong':    return { background: 'var(--success)', outline: 'none' };
            case 'moderate':  return { background: 'color-mix(in srgb, var(--success) 40%, transparent)', outline: 'none' };
            case 'weak':      return { background: 'color-mix(in srgb, var(--success) 40%, transparent)', opacity: 0.5, outline: 'none' };
            case 'uncovered': return { background: 'var(--bg-hover)', outline: '1px solid var(--border-color)' };
          }
        };

        return (
          <div style={{ marginBottom: 10, padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border-color)', fontSize: '0.75rem' }}>
            {/* Header row: title + summary counts */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>AN Claim Coverage</span>
              {anCoverage.strong.length > 0 && (
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--success)' }}>
                  Strong ({anCoverage.strong.length})
                </span>
              )}
              {anCoverage.moderate.length > 0 && (
                <span style={{ fontSize: 'var(--text-2xs)', color: 'color-mix(in srgb, var(--success) 60%, var(--text-muted))' }}>
                  Moderate ({anCoverage.moderate.length})
                </span>
              )}
              {anCoverage.weak.length > 0 && (
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                  Weak ({anCoverage.weak.length})
                </span>
              )}
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                Uncovered ({stripItems.filter(s => s.bucket === 'uncovered').length})
              </span>
            </div>
            {/* Coverage strip: one square per AN claim */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {stripItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => setOverviewTab('argument-network')}
                  title={`${item.id} · ${item.bucket}${item.sim > 0 ? ` · sim ${item.sim.toFixed(2)}` : ''} · ${item.text.slice(0, 60)}${item.text.length > 60 ? '…' : ''}`}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    flexShrink: 0,
                    ...squareStyle(item.bucket),
                  }}
                  aria-label={`${item.id} (${item.bucket})`}
                />
              ))}
            </div>
            <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: '0.7rem' }}>
              {anCoverage.grounded}/{anCoverage.total} AN claims have taxonomy grounding
              {anCoverage.weak.length > 0 && ` — ${anCoverage.weak.length} orphaned claim${anCoverage.weak.length > 1 ? 's' : ''} (taxonomy may be missing relevant nodes)`}
            </div>
          </div>
        );
      })()}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', tableLayout: 'fixed' }}>
        <colgroup>
          {hasSourceData && <col style={{ width: '10%' }} />}
          <col style={{ width: '20%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: hasSourceData ? '62%' : '72%' }} />
        </colgroup>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
            {hasSourceData && <th style={{ padding: '4px 6px', fontWeight: 600, color: 'var(--text-muted)' }}>Source</th>}
            <th style={{ padding: '4px 6px', fontWeight: 600, color: 'var(--text-muted)' }}>Id</th>
            <th style={{ padding: '4px 6px', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>Score</th>
            <th style={{ padding: '4px 6px', fontWeight: 600, color: 'var(--text-muted)' }}>Relevance</th>
          </tr>
        </thead>
        <tbody>
          {[...entry.taxonomy_refs!].sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)).map((r, i) => (
            <TaxRefRow
              key={i}
              r={r}
              hasSourceData={hasSourceData}
              isSelected={selectedTaxRefId === r.node_id}
              src={sourceMap.get(r.node_id)}
              tw={nodeWeights.get(r.node_id)}
              setSelectedTaxRefId={setSelectedTaxRefId}
              setOverviewTab={setOverviewTab}
            />
          ))}
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
  );
}
