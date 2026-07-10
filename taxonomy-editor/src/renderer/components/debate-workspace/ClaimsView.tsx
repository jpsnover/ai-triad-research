// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import type { ArgumentNetworkNode, ArgumentNetworkEdge, TranscriptEntry } from '../../types/debate';
import { computeQbafStrengths } from '@lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '@lib/debate/qbaf';
import { speakerLabel, STRENGTH_BAND, getNodeLabel } from './utils';

const ATTACK_TYPE_WEIGHTS: Record<string, number> = { rebut: 1.0, undercut: 1.05, undermine: 1.1 };

export function ClaimNodeRow({ node, attacks, supports, allNodes, strengthMap, showFormal }: {
  node: ArgumentNetworkNode;
  attacks: ArgumentNetworkEdge[];
  supports: ArgumentNetworkEdge[];
  allNodes: ArgumentNetworkNode[];
  strengthMap: Map<string, number>;
  showFormal?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasEdges = attacks.length > 0 || supports.length > 0;
  const base = node.base_strength ?? 0.5;
  const computed = strengthMap.get(node.id) ?? node.computed_strength ?? base;
  const delta = computed - base;
  const band = STRENGTH_BAND(computed);

  const bandColor = computed >= 0.8 ? '#22c55e' : computed >= 0.5 ? '#3b82f6' : computed >= 0.3 ? '#f59e0b' : '#ef4444';
  const attr = node.claim_taxonomy_attribution;
  const bdiLabel = node.bdi_category === 'belief' ? 'Belief' : node.bdi_category === 'desire' ? 'Desire' : node.bdi_category === 'intention' ? 'Intention' : '';
  const truncText = node.text.length > 80 ? node.text.slice(0, 80) + '…' : node.text;

  return (
    <div style={{ margin: '4px 0', paddingBottom: 4, borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        {hasEdges ? (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, lineHeight: 1, marginTop: 2, flexShrink: 0 }}
          >{expanded ? '▼' : '▶'}</button>
        ) : <span style={{ width: 10, flexShrink: 0 }} />}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: node.political_salience ? '84px 72px 180px 200px 60px 80px' : '84px 72px 180px 200px 60px 1fr', gap: '4px', alignItems: 'center' }}>
          {/* Col 1: AN ID */}
          <strong
            style={{ color: 'var(--accent)' }}
            title={`Argument Network node ${node.id}\nSpeaker: ${speakerLabel(node.speaker)}\n${bdiLabel ? `Category: ${bdiLabel}` : ''}${node.bdi_confidence != null ? ` (confidence: ${node.bdi_confidence.toFixed(2)})` : ''}\nStrength: ${computed.toFixed(2)} (base: ${base.toFixed(2)}, delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)})\n${attacks.length} attack${attacks.length !== 1 ? 's' : ''}, ${supports.length} support${supports.length !== 1 ? 's' : ''}\n\n${truncText}`}
          >{node.id}</strong>
          {/* Col 2: BDI category */}
          <span title={bdiLabel && node.bdi_confidence != null ? `${bdiLabel} (confidence: ${node.bdi_confidence.toFixed(2)})` : bdiLabel || undefined}>{bdiLabel}</span>
          {/* Col 3: Attribution */}
          <span>
            {attr && (() => {
              if (attr.unattributed_reason) {
                const reasonLabel = attr.unattributed_reason === 'novel_argument' ? 'novel' : 'no embedding';
                const reasonTip = attr.unattributed_reason === 'novel_argument'
                  ? 'Unattributed: claim is a novel argument not closely matching any taxonomy node (best similarity < 0.35)'
                  : 'Unattributed: missing embedding — cannot compute similarity';
                return <span style={{ fontWeight: 700, padding: '1px 5px', borderRadius: 3, color: 'var(--text-secondary)' }} title={reasonTip}><span style={{ color: '#ef4444', fontSize: '0.9rem', marginRight: 3 }}>●</span>{reasonLabel}</span>;
              }
              const conf = attr.attribution_confidence;
              const confColor = conf >= 0.7 ? '#22c55e' : conf >= 0.5 ? '#3b82f6' : '#f59e0b';
              const secCount = attr.secondary_refs?.length ?? 0;
              const attrTip = `Attributed to ${attr.primary_ref} (confidence: ${conf.toFixed(2)})\n${getNodeLabel(attr.primary_ref)}${secCount > 0 ? `\n\n${secCount} secondary ref${secCount !== 1 ? 's' : ''}: ${attr.secondary_refs!.map((s: { node_id: string; similarity: number }) => `${s.node_id} (${s.similarity.toFixed(2)})`).join(', ')}` : ''}`;
              return <span style={{ fontWeight: 700, padding: '1px 5px', borderRadius: 3, color: 'var(--text-secondary)' }} title={attrTip}><span style={{ color: confColor, fontSize: '0.9rem', marginRight: 3 }}>●</span>{attr.primary_ref} {conf.toFixed(2)}</span>;
            })()}
          </span>
          {/* Col 4: Strength */}
          <span style={{ fontWeight: 700, padding: '1px 5px', borderRadius: 3, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }} title={`Strength: ${computed.toFixed(2)} (base: ${base.toFixed(2)}, delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`}>
            <span style={{ color: bandColor, fontSize: '0.9rem', marginRight: 3 }}>●</span>{band.label} {computed.toFixed(2)}
            {Math.abs(delta) > 0.01 && <span style={{ color: 'var(--text-muted)', marginLeft: 3 }}>{delta > 0 ? '+' : ''}{delta.toFixed(2)}</span>}
          </span>
          {/* Col 5: Edge count */}
          <span style={{ color: 'var(--text-muted)' }} title={hasEdges ? `${attacks.length} attack${attacks.length !== 1 ? 's' : ''} and ${supports.length} support${supports.length !== 1 ? 's' : ''} connected to this claim` : undefined}>
            {hasEdges ? `${attacks.length + supports.length} edge${attacks.length + supports.length !== 1 ? 's' : ''}` : ''}
          </span>
          {/* Col 6: Political salience (policymaker debates only) */}
          {node.political_salience && (
            <span style={{ fontWeight: 700, fontSize: '0.75rem', padding: '1px 6px', borderRadius: 3 }}>
              <span style={{ marginRight: 3 }}>
                {node.political_salience === 'high' ? '🔴' : node.political_salience === 'medium' ? '🟡' : '⚪'}
              </span>
              {node.political_salience}
            </span>
          )}
        </div>
      </div>
      <div style={{ paddingLeft: 18, marginTop: 2 }}>{showFormal && node.attribution_text_genus ? node.attribution_text_genus : node.text}</div>
      {expanded && (
        <div style={{ paddingLeft: 18, marginTop: 4 }}>
          {attacks.map(e => {
            const src = allNodes.find(n => n.id === e.source);
            const srcStr = strengthMap.get(e.source);
            const atkMult = ATTACK_TYPE_WEIGHTS[e.attack_type ?? 'rebut'] ?? 1.0;
            const edgeWeight = e.weight ?? 0.5;
            const hasWeight = e.weight != null;
            const contribution = srcStr != null ? srcStr * edgeWeight * atkMult : undefined;
            return (
              <div key={`a-${e.source}`} style={{ color: '#ef4444', marginBottom: 2 }}>
                ← <strong title={src ? `${src.id} by ${speakerLabel(src.speaker)}\n${src.text}` : e.source}>{e.source}</strong>{' '}
                <span title={`Attack type: ${e.attack_type ?? 'rebut'} (multiplier: ${atkMult.toFixed(1)})\nEdge weight: ${edgeWeight.toFixed(2)}${hasWeight ? '' : ' (default — no AI weight)'}${contribution != null ? `\nContribution: −${contribution.toFixed(2)} (${(srcStr ?? 0).toFixed(2)} × ${edgeWeight.toFixed(1)} × ${atkMult.toFixed(1)})` : ''}`}>
                  {e.attack_type ?? 'rebut'}
                </span>{' '}
                ({speakerLabel(src?.speaker ?? 'system')}): {src?.text?.slice(0, 100)}{(src?.text?.length ?? 0) > 100 ? '…' : ''}
              </div>
            );
          })}
          {supports.map(e => {
            const src = allNodes.find(n => n.id === e.source);
            const srcStr = strengthMap.get(e.source);
            const edgeWeight = e.weight ?? 0.5;
            const hasWeight = e.weight != null;
            const contribution = srcStr != null ? srcStr * edgeWeight : undefined;
            return (
              <div key={`s-${e.source}`} style={{ color: '#22c55e', marginBottom: 2 }}>
                ← <strong title={src ? `${src.id} by ${speakerLabel(src.speaker)}\n${src.text}` : e.source}>{e.source}</strong>{' '}
                <span title={`Support\nEdge weight: ${edgeWeight.toFixed(2)}${hasWeight ? '' : ' (default — no AI weight)'}${contribution != null ? `\nContribution: +${contribution.toFixed(2)} (${(srcStr ?? 0).toFixed(2)} × ${edgeWeight.toFixed(1)})` : ''}`}>
                  support
                </span>{' '}
                ({speakerLabel(src?.speaker ?? 'system')}): {src?.text?.slice(0, 100)}{(src?.text?.length ?? 0) > 100 ? '…' : ''}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const CLAIMS_STYLE_KEY = 'debate-claims-style';

export function ClaimsView({ entryId, debate }: { entryId?: string; debate: { argument_network?: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] }; transcript: TranscriptEntry[] } }) {
  const [showFormal, setShowFormal] = useState(() => {
    try { return sessionStorage.getItem(CLAIMS_STYLE_KEY) === 'formal'; } catch { /* telemetry — silent by design */ return false; }
  });
  const toggleStyle = () => {
    const next = !showFormal;
    setShowFormal(next);
    try { sessionStorage.setItem(CLAIMS_STYLE_KEY, next ? 'formal' : 'plain'); } catch { /* telemetry — silent by design */ }
  };

  const an = debate.argument_network;
  if (!an || an.nodes.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '4px 0' }}>No argument network yet</div>;

  const entryNodes = entryId ? an.nodes.filter(n => n.source_entry_id === entryId) : an.nodes;
  if (entryNodes.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '4px 0' }}>No claims extracted for this statement</div>;
  const hasFormalText = entryNodes.some(n => !!n.attribution_text_genus);

  const qbafNodes: QbafNode[] = an.nodes.map(n => ({ id: n.id, base_strength: n.base_strength ?? 0.5 }));
  const qbafEdges: QbafEdge[] = an.edges.map(e => ({
    source: e.source, target: e.target,
    type: e.type as 'attacks' | 'supports',
    weight: e.weight ?? 0.5,
    attack_type: e.attack_type,
  }));
  const { strengths: strengthMap } = computeQbafStrengths(qbafNodes, qbafEdges);

  const caCount = an.edges.filter(e => entryNodes.some(n => n.id === e.target) && e.type === 'attacks').length;
  const raCount = an.edges.filter(e => entryNodes.some(n => n.id === e.target) && e.type === 'supports').length;

  // Political salience histogram (policymaker debates only)
  const salienceCounts = (() => {
    const high = entryNodes.filter(n => n.political_salience === 'high').length;
    const medium = entryNodes.filter(n => n.political_salience === 'medium').length;
    const low = entryNodes.filter(n => n.political_salience === 'low').length;
    return (high + medium + low > 0) ? { high, medium, low } : null;
  })();

  return (
    <div className="claims-view" style={{ fontSize: '0.8rem' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{entryNodes.length} claim{entryNodes.length !== 1 ? 's' : ''} · {caCount} attack{caCount !== 1 ? 's' : ''} · {raCount} support{raCount !== 1 ? 's' : ''}</span>
        {hasFormalText && (
          <button
            onClick={toggleStyle}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1px 6px', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', cursor: 'pointer' }}
            title={showFormal ? 'Show plain text' : 'Show formal/DOLCE text'}
          >{showFormal ? 'Formal' : 'Plain'}</button>
        )}
      </div>
      {salienceCounts && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>Salience:</span>
          <span>🔴 {salienceCounts.high} high</span>
          <span>🟡 {salienceCounts.medium} med</span>
          <span>⚪ {salienceCounts.low} low</span>
        </div>
      )}
      {entryNodes.map(node => {
        const attacks = an.edges.filter(e => e.target === node.id && e.type === 'attacks');
        const supports = an.edges.filter(e => e.target === node.id && e.type === 'supports');
        return <ClaimNodeRow key={node.id} node={node} attacks={attacks} supports={supports} allNodes={an.nodes} strengthMap={strengthMap} showFormal={showFormal} />;
      })}
    </div>
  );
}
