// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useDebateStore } from '../../../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { useFlag } from '../../../hooks/useFeatureFlags';
import type { SpeakerId, ArgumentNetworkNode, ArgumentNetworkEdge, QbafTimelineEntry } from '../../../types/debate';
import { QbafClaimBadge, QbafEdgeIndicator } from '../../taxonomy/QbafOverlay';
import { computeCoverageMap, computeStrengthWeightedCoverage } from '@lib/debate/coverageTracker';
import type { CoverageMap, StrengthWeightedCoverage } from '@lib/debate/coverageTracker';
import type { TopicScope, TopicScopeRiskLevel } from '@lib/debate/types';
import { CollapsibleSection, speakerLabel } from './helpers';
import { WhatIfSection } from './WhatIfSection';
import { DocumentCoverageSection } from './DocumentCoverageSection';
import { VerificationSection } from './VerificationSection';
import { useDescriptionMode, DescriptionToggle } from '../../shared/DescriptionToggle';
import { useTaxonomyStore } from '../../../hooks/useTaxonomyStore';
import { generatePlainPreview } from '../../../utils/regeneratePlainDescription';

const AIF_TOOLTIPS = {
  'I-node': 'I-node (Information node) — a claim, proposition, or data point. These are the passive content of arguments: what is being asserted.',
  'CA': 'CA-node (Conflict Application) — an attack relationship. Three types: rebut (contradicts conclusion), undercut (denies the inference), undermine (attacks premise credibility). Each attack is classified by argumentation scheme (e.g., ARGUMENT_FROM_EVIDENCE, ARGUMENT_FROM_ANALOGY) with critical questions that identify how to evaluate it.',
  'RA': 'RA-node (Rule Application) — an inference scheme explaining WHY one claim supports another. The warrant is the reasoning pattern connecting evidence to conclusion.',
  'PA': 'PA-node (Preference Application) — resolves conflicts by determining which argument prevails and why, based on criteria like evidence strength or logical validity.',
};

const TIMELINE_SPEAKER_COLORS: Record<string, string> = {
  accelerationist: 'var(--color-acc)',
  safetyist: 'var(--color-saf)',
  skeptic: 'var(--color-skp)',
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
  const qbafEnabled = useFlag('release-qbaf-analysis');
  if (!qbafEnabled || timeline.length === 0) return null;

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
          const color = TIMELINE_SPEAKER_COLORS[speaker] ?? 'var(--text-muted)';
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
        const startVal = firstSnap.strengths[hoveredClaim] ?? 0;
        const endVal = lastSnap.strengths[hoveredClaim] ?? 0;
        const delta = endVal - startVal;
        return (
          <div className="diag-timeline-tooltip">
            <strong>{hoveredClaim}</strong> ({speakerLabel(node.speaker as SpeakerId)}):
            {' '}{startVal.toFixed(2)} → {endVal.toFixed(2)}
            {Math.abs(delta) > 0.01 && (
              <span className={delta > 0 ? 'qbaf-delta-up' : 'qbaf-delta-down'}>
                {' '}({delta > 0 ? '+' : ''}{delta.toFixed(2)})
              </span>
            )}
            <div className="diag-muted" style={{ fontSize: 'var(--text-2xs)' }} title={node.attribution_text_genus || undefined}>{node.text.slice(0, 100)}{node.text.length > 100 ? '…' : ''}</div>
          </div>
        );
      })()}

      {/* Legend */}
      <div className="diag-timeline-legend">
        {Object.entries(TIMELINE_SPEAKER_COLORS).map(([speaker, color]) => (
          <span key={speaker} className="diag-timeline-legend-item">
            <span style={{ display: 'inline-block', width: 10, height: 3, background: color, marginRight: 4 }} />
            {speakerLabel(speaker as SpeakerId)}
          </span>
        ))}
      </div>
    </CollapsibleSection>
  );
}

const RISK_COLORS: Record<TopicScopeRiskLevel, string> = {
  low: 'var(--success)', medium: 'var(--warning)', high: 'var(--danger)', catastrophic: 'var(--danger)', unspecified: 'var(--text-muted)',
};

function TopicScopePanel({ scope }: { scope: TopicScope }) {
  return (
    <CollapsibleSection title="Topic Scope" defaultOpen>
      <div className="diag-kv">
        <span className="diag-k">Core proposition:</span>
        <span className="diag-v">{scope.core_proposition}</span>
      </div>

      {scope.domain && (
        <div className="diag-kv">
          <span className="diag-k">Domain:</span>
          <span className="diag-v">{scope.domain}</span>
          {scope.product_type && <span className="diag-badge diag-badge-move" style={{ fontSize: 'var(--text-2xs)', marginLeft: 4 }}>{scope.product_type}</span>}
          {scope.time_horizon && <span className="diag-muted" style={{ fontSize: 'var(--text-2xs)', marginLeft: 4 }}>({scope.time_horizon})</span>}
        </div>
      )}

      <div className="diag-kv" style={{ gap: 6 }}>
        <span className="diag-badge" style={{ fontSize: 'var(--text-2xs)', background: `${RISK_COLORS[scope.risk_level]}20`, color: RISK_COLORS[scope.risk_level] }}>
          risk: {scope.risk_level}
        </span>
        <span className="diag-badge" style={{ fontSize: 'var(--text-2xs)', background: scope.constraint_confidence === 'explicit' ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'color-mix(in srgb, var(--warning) 15%, transparent)', color: scope.constraint_confidence === 'explicit' ? 'var(--success)' : 'var(--warning)' }}>
          {scope.constraint_confidence}
        </span>
      </div>

      {scope.relevant_disciplines.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <span className="diag-k" style={{ fontSize: 'var(--text-2xs)' }}>Disciplines:</span>
          <div className="diag-badges">
            {scope.relevant_disciplines.map(d => (
              <span key={d} className="diag-badge diag-badge-move" style={{ fontSize: 'var(--text-2xs)' }}>{d}</span>
            ))}
          </div>
        </div>
      )}

      {scope.key_tensions.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <span className="diag-k" style={{ fontSize: 'var(--text-2xs)' }}>Key tensions:</span>
          <ol style={{ margin: '2px 0 0 16px', padding: 0, fontSize: 'var(--text-2xs)' }}>
            {scope.key_tensions.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        </div>
      )}

      {scope.off_scope_topics.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <span className="diag-k" style={{ fontSize: 'var(--text-2xs)' }}>Off-scope:</span>
          <div className="diag-badges">
            {scope.off_scope_topics.map(t => (
              <span key={t} className="diag-badge" style={{ fontSize: 'var(--text-2xs)', background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)' }}>{t}</span>
            ))}
          </div>
        </div>
      )}

      {scope.drift_signatures.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <span className="diag-k" style={{ fontSize: 'var(--text-2xs)' }}>Drift signatures:</span>
          <ul style={{ margin: '2px 0 0 16px', padding: 0, fontSize: 'var(--text-2xs)', listStyle: 'disc' }}>
            {scope.drift_signatures.map((d, i) => <li key={i} style={{ color: 'var(--warning)' }}>{d}</li>)}
          </ul>
        </div>
      )}

      {scope.example_ceiling && (
        <div className="diag-kv" style={{ marginTop: 4 }}>
          <span className="diag-k">Example ceiling:</span>
          <span className="diag-v" style={{ fontSize: 'var(--text-2xs)' }}>{scope.example_ceiling}</span>
        </div>
      )}

      {scope.explicit_qualifiers.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <span className="diag-k" style={{ fontSize: 'var(--text-2xs)' }}>Qualifiers:</span>
          <div className="diag-badges">
            {scope.explicit_qualifiers.map(q => (
              <span key={q} className="diag-badge diag-badge-move" style={{ fontSize: 'var(--text-2xs)' }}>{q}</span>
            ))}
          </div>
        </div>
      )}

      {scope.excluded_scenarios.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <span className="diag-k" style={{ fontSize: 'var(--text-2xs)' }}>Excluded scenarios:</span>
          <ul style={{ margin: '2px 0 0 16px', padding: 0, fontSize: 'var(--text-2xs)', listStyle: 'disc' }}>
            {scope.excluded_scenarios.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      {scope.on_scope_evidence.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <span className="diag-k" style={{ fontSize: 'var(--text-2xs)' }}>On-scope evidence:</span>
          <ul style={{ margin: '2px 0 0 16px', padding: 0, fontSize: 'var(--text-2xs)', listStyle: 'disc' }}>
            {scope.on_scope_evidence.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}
    </CollapsibleSection>
  );
}

function PanelArgumentNetwork({ an }: { an: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] } }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const caCount = an.edges.filter(e => e.type === 'attacks').length;
  const raCount = an.edges.filter(e => e.type === 'supports').length;

  const allExpanded = expandedIds.size === an.nodes.length && an.nodes.length > 0;
  const toggleAll = () => {
    if (allExpanded) {
      setExpandedIds(new Set());
    } else {
      setExpandedIds(new Set(an.nodes.map(n => n.id)));
    }
  };
  const toggleNode = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <CollapsibleSection title={`Argument Network — ${an.nodes.length} I-nodes, ${caCount} CA-nodes, ${raCount} RA-nodes`} defaultOpen>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <button
          onClick={toggleAll}
          style={{ fontSize: 'var(--text-2xs)', padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer' }}
        >
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>
      {an.nodes.map(n => {
        const attacks = an.edges.filter(e => e.target === n.id && e.type === 'attacks');
        const supports = an.edges.filter(e => e.target === n.id && e.type === 'supports');
        const responded = attacks.length > 0 || supports.length > 0;
        const isSource = an.edges.some(e => e.source === n.id);
        const expanded = expandedIds.has(n.id);
        return (
          <div key={n.id} className="diag-an-node">
            <div className="diag-an-claim" style={{ cursor: 'pointer' }} onClick={() => toggleNode(n.id)}>
              <span style={{ fontSize: 'var(--text-2xs)', marginRight: 2, userSelect: 'none' }}>{expanded ? '▼' : '▶'}</span>
              <span className="diag-badge diag-badge-move" style={{ fontSize: 'var(--text-2xs)', cursor: 'default' }} title={AIF_TOOLTIPS['I-node']}>I-node</span>
              <span className="diag-an-id">{n.id}</span>
              <span className="diag-an-speaker">({speakerLabel(n.speaker)})</span>
              {!responded && !isSource && <span style={{ color: 'var(--warning)', fontSize: 'var(--text-2xs)' }}>[unaddressed]</span>}
              <QbafClaimBadge node={{ ...n, base_strength: n.base_strength ?? 0.5 }} />
              {(() => {
                const base = n.base_strength ?? 0.5;
                const computed = n.computed_strength ?? base;
                const delta = computed - base;
                return Math.abs(delta) > 0.01 ? (
                  <span className={`qbaf-delta ${delta > 0 ? 'qbaf-delta-up' : 'qbaf-delta-down'}`} style={{ fontSize: 'var(--text-2xs)' }}>
                    ({delta > 0 ? '+' : ''}{delta.toFixed(2)})
                  </span>
                ) : null;
              })()}
              {n.verification_status && (
                <span className={`diag-badge diag-verification-${n.verification_status}`} title={n.verification_evidence || n.verification_status}>
                  {n.verification_status === 'supported' ? 'V' : n.verification_status === 'disputed' ? 'X' : '?'}
                </span>
              )}
            </div>
            {expanded && (
              <>
                <div style={{ paddingLeft: 8, fontSize: '0.7rem' }}>
                  {n.text}
                  {n.verification_evidence && n.verification_status === 'disputed' && (
                    <div style={{ color: 'var(--danger)', fontSize: 'var(--text-2xs)', marginTop: 2 }}>Evidence: {n.verification_evidence}</div>
                  )}
                </div>
                {attacks.map(a => (
                  <div key={a.id} className="diag-an-edge diag-an-attack">
                    <span className="diag-badge" style={{ fontSize: 'var(--text-2xs)', background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)', cursor: 'default' }} title={AIF_TOOLTIPS['CA']}>CA</span>
                    ← {a.source} <strong>{a.attack_type}</strong>{a.scheme ? ` via ${a.scheme}` : ''}
                    {a.argumentation_scheme && <span className="diag-badge" style={{ fontSize: 'var(--text-2xs)', background: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)', color: 'var(--text-secondary)', marginLeft: 4 }}>{a.argumentation_scheme}</span>}
                    {a.weight != null && <QbafEdgeIndicator edge={a} />}
                    {a.warrant && <div style={{ paddingLeft: 16, color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 'var(--text-2xs)' }}>Warrant: {a.warrant}</div>}
                  </div>
                ))}
                {supports.map(s => (
                  <div key={s.id} className="diag-an-edge diag-an-support">
                    <span className="diag-badge" style={{ fontSize: 'var(--text-2xs)', background: 'color-mix(in srgb, var(--success) 15%, transparent)', color: 'var(--success)', cursor: 'default' }} title={AIF_TOOLTIPS['RA']}>RA</span>
                    ← {s.source} supports
                    {s.weight != null && <QbafEdgeIndicator edge={s} />}
                    {s.warrant && <div style={{ paddingLeft: 16, color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 'var(--text-2xs)' }}>Warrant: {s.warrant}</div>}
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })}
    </CollapsibleSection>
  );
}

export function OverviewView() {
  const { activeDebate, askQuestion, debateGenerating } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, askQuestion: s.askQuestion, debateGenerating: s.debateGenerating }))
  );
  if (!activeDebate) return null;

  const an = activeDebate.argument_network;
  const commitments = activeDebate.commitments;
  const diag = activeDebate.diagnostics;
  const timeline = activeDebate.qbaf_timeline;

  const coverageMap = useMemo<CoverageMap | null>(() => {
    if (!activeDebate?.document_analysis?.i_nodes?.length) return null;
    const anNodes = activeDebate.argument_network?.nodes ?? [];
    if (anNodes.length === 0) return null;
    const documentClaims = activeDebate.document_analysis.i_nodes.map(n => ({ id: n.id, text: n.text }));
    try {
      return computeCoverageMap(anNodes, documentClaims);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'diagnostics-panel',
        level: 'warn',
        message: 'Coverage map computation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return null;
    }
  }, [activeDebate?.argument_network?.nodes, activeDebate?.document_analysis?.i_nodes]);

  const strengthWeighted = useMemo<StrengthWeightedCoverage | null>(() => {
    if (!coverageMap || !an || an.nodes.length === 0) return null;
    try {
      return computeStrengthWeightedCoverage(coverageMap, an.nodes, an.edges);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'diagnostics-panel',
        level: 'warn',
        message: 'Strength-weighted coverage computation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return null;
    }
  }, [coverageMap, an]);

  const topicScope = activeDebate.topic?.scope as TopicScope | undefined;

  const [descMode, setDescMode] = useDescriptionMode();
  const taxState = useTaxonomyStore(useShallow(s => ({
    accelerationist: s.accelerationist, safetyist: s.safetyist, skeptic: s.skeptic, situations: s.situations,
  })));

  const [plainPreviews, setPlainPreviews] = useState<Record<string, string | null>>({});
  const [previewLoading, setPreviewLoading] = useState<Record<string, boolean>>({});
  const inflightRef = useRef<Set<string>>(new Set());

  const lookupPlainDescription = useCallback((nodeId: string, pov: string): string | null => {
    const povKey = pov as keyof typeof taxState;
    const file = taxState[povKey];
    if (!file?.nodes) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = (file.nodes as any[]).find((n: any) => n.id === nodeId);
    return node?.plain_description ?? null;
  }, [taxState]);

  const suggestions = activeDebate.taxonomy_suggestions;
  useEffect(() => {
    if (descMode !== 'plain' || !suggestions?.length) return;
    for (let i = 0; i < suggestions.length; i++) {
      const sug = suggestions[i];
      const key = `after-${sug.node_id}-${i}`;
      if (inflightRef.current.has(key) || plainPreviews[key] !== undefined) continue;
      inflightRef.current.add(key);
      setPreviewLoading(prev => ({ ...prev, [key]: true }));
      void generatePlainPreview(sug.proposed_description ?? '').then(text => {
        setPlainPreviews(prev => ({ ...prev, [key]: text }));
        setPreviewLoading(prev => ({ ...prev, [key]: false }));
      });
    }
  }, [descMode, suggestions, plainPreviews]);

  return (
    <div className="diag-overview">
      {/* Topic Scope (10.2) */}
      {topicScope && <TopicScopePanel scope={topicScope} />}

      {/* Strength Timeline (D-Q5) */}
      {timeline && timeline.length > 0 && an && (
        <StrengthTimeline timeline={timeline} nodes={an.nodes} />
      )}

      {/* Document Coverage (CT-3/CT-4) — click-to-steer injects a question about uncovered claims */}
      {coverageMap && <DocumentCoverageSection coverageMap={coverageMap} strengthWeighted={strengthWeighted} onSteerToClaim={debateGenerating ? undefined : (claimText) => {
        void askQuestion(`What is your perspective on the claim that ${claimText}?`);
      }} />}

      {/* Argument Network */}
      {an && an.nodes.length > 0 && <PanelArgumentNetwork an={an} />}

      {/* What-If Mode (D-Q6) */}
      {an && an.nodes.length > 0 && (
        <WhatIfSection nodes={an.nodes} edges={an.edges} />
      )}

      {/* Commitment Stores */}
      {commitments && Object.keys(commitments).length > 0 && (
        <CollapsibleSection title="Commitment Stores" defaultOpen>
          {Object.entries(commitments).map(([poverId, store]) => (
            <div key={poverId} className="diag-commit-store">
              <strong>{speakerLabel(poverId as SpeakerId)}</strong>
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

      {/* Active Moderator State */}
      {activeDebate.moderator_state && (() => {
        const ms = activeDebate.moderator_state;
        const latestHealth = ms.health_history.length > 0 ? ms.health_history[ms.health_history.length - 1] : null;
        const familyColors: Record<string, string> = {
          procedural: 'var(--color-saf)', elicitation: 'var(--warning)', repair: 'var(--danger)',
          reconciliation: 'var(--success)', reflection: 'var(--text-secondary)', synthesis: 'var(--text-secondary)',
        };
        const maxBurden = Math.max(...Object.values(ms.burden_per_debater), 0.01);

        return (
          <CollapsibleSection title={`Active Moderator — ${ms.interventions_fired} interventions, budget ${ms.budget_remaining}/${ms.budget_total}`} defaultOpen>
            {/* Budget gauge */}
            <div className="diag-kv">
              <span className="diag-k">Budget:</span>
              <span className="diag-v">{ms.budget_remaining}/{ms.budget_total} remaining</span>
            </div>
            <div style={{ height: 6, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden', margin: '2px 0 6px' }}>
              <div style={{
                width: `${ms.budget_total > 0 ? ((ms.budget_total - ms.budget_remaining) / ms.budget_total * 100) : 0}%`,
                height: '100%',
                background: ms.budget_remaining <= 1 ? 'var(--danger)' : ms.budget_remaining <= 2 ? 'var(--warning)' : 'var(--success)',
                transition: 'width 0.2s',
              }} />
            </div>

            {/* Health score */}
            {latestHealth && (
              <>
                <div className="diag-kv">
                  <span className="diag-k">Health:</span>
                  <span className="diag-v" style={{ color: latestHealth.value >= 0.7 ? 'var(--success)' : latestHealth.value >= 0.4 ? 'var(--warning)' : 'var(--danger)' }}>
                    {(latestHealth.value ?? 0).toFixed(2)}
                  </span>
                  {ms.consecutive_decline > 0 && <span className="diag-badge" style={{ fontSize: 'var(--text-2xs)', background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)', marginLeft: 4 }}>{ms.consecutive_decline} decline{ms.consecutive_decline > 1 ? 's' : ''}</span>}
                  {ms.consecutive_rise >= 2 && <span className="diag-badge" style={{ fontSize: 'var(--text-2xs)', background: 'color-mix(in srgb, var(--success) 15%, transparent)', color: 'var(--success)', marginLeft: 4 }}>{ms.consecutive_rise} rises</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, margin: '4px 0 8px', fontSize: 'var(--text-2xs)' }}>
                  {(['engagement', 'novelty', 'responsiveness', 'coverage', 'balance'] as const).map(comp => (
                    <div key={comp} style={{ textAlign: 'center' }}>
                      <div className="diag-k" style={{ fontSize: 'var(--text-2xs)' }}>{comp.slice(0, 3).toUpperCase()}</div>
                      <div style={{ color: latestHealth.components[comp] >= 0.5 ? 'var(--success)' : latestHealth.components[comp] >= 0.25 ? 'var(--warning)' : 'var(--danger)', fontWeight: 600 }}>
                        {(latestHealth.components[comp] ?? 0).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Burden distribution */}
            {Object.keys(ms.burden_per_debater).length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <span className="diag-k" style={{ fontSize: 'var(--text-2xs)' }}>Burden (avg {(ms.avg_burden ?? 0).toFixed(2)}):</span>
                {Object.entries(ms.burden_per_debater).map(([debater, burden]) => (
                  <div key={debater} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
                    <span style={{ fontSize: 'var(--text-2xs)', width: 60, textAlign: 'right' }}>{speakerLabel(debater as SpeakerId)}</span>
                    <div style={{ flex: 1, height: 4, background: 'var(--bg-secondary)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${(burden / maxBurden * 100)}%`, height: '100%', background: burden > ms.avg_burden * 1.5 ? 'var(--danger)' : 'var(--color-saf)', transition: 'width 0.2s' }} />
                    </div>
                    <span style={{ fontSize: 'var(--text-2xs)', width: 30 }}>{(burden ?? 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Cooldown & state */}
            <div style={{ display: 'flex', gap: 12, fontSize: 'var(--text-2xs)', marginBottom: 6 }}>
              <span><span className="diag-k">Cooldown:</span> {ms.rounds_since_last_intervention >= ms.required_gap ? <span style={{ color: 'var(--success)' }}>ready</span> : <span style={{ color: 'var(--warning)' }}>{ms.required_gap - ms.rounds_since_last_intervention}r left</span>}</span>
              <span><span className="diag-k">Gap:</span> {ms.required_gap}</span>
              {ms.cooldown_blocked_count > 0 && <span><span className="diag-k">Blocked:</span> {ms.cooldown_blocked_count}x</span>}
            </div>

            {/* Intervention history */}
            {ms.intervention_history.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <span className="diag-k" style={{ fontSize: 'var(--text-2xs)' }}>Interventions:</span>
                {ms.intervention_history.map((h, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '2px 0', fontSize: 'var(--text-2xs)' }}>
                    <span className="diag-muted" style={{ width: 24 }}>R{h.round}</span>
                    <span className="diag-badge" style={{ fontSize: 'var(--text-2xs)', background: `${familyColors[h.family] ?? 'var(--text-muted)'}30`, color: familyColors[h.family] ?? 'var(--text-muted)' }}>{h.move}</span>
                    <span style={{ fontSize: 'var(--text-2xs)' }}>{'→'} {speakerLabel(h.target as SpeakerId)}</span>
                    <span className="diag-muted" style={{ fontSize: 'var(--text-2xs)' }}>({(h.burden ?? 0).toFixed(1)})</span>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleSection>
        );
      })()}

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
              intervention_recommended?: boolean; intervention_move?: string | null; intervention_validated?: boolean;
              health_score?: number; budget_remaining?: number;
              argument_network_snapshot?: { total_claims: number; total_edges: number; unaddressed_claims: number } | null;
            },
          }));
        if (modEntries.length === 0) return null;

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
                  <span key={s} className="diag-badge diag-badge-move">{speakerLabel(s as SpeakerId)} ({c})</span>
                ))}
              </div>
            </div>
            {avgConvergence != null && (
              <div className="diag-kv">
                <span className="diag-k">Avg convergence:</span>
                <span className="diag-v">{(avgConvergence * 100).toFixed(0)}%</span>
                {latestTrace.convergence_triggered && <span className="diag-badge" style={{ fontSize: 'var(--text-2xs)', background: 'color-mix(in srgb, var(--success) 15%, transparent)', color: 'var(--success)', marginLeft: 4 }}>triggered</span>}
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
            <div style={{ marginTop: 6, fontSize: 'var(--text-2xs)' }}>
              {modEntries.slice(-5).reverse().map(({ id, trace }) => (
                <div key={id} className="diag-mod-round" style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 2 }}>
                  <span className="diag-badge diag-badge-move" style={{ fontSize: 'var(--text-2xs)', minWidth: 50 }}>{speakerLabel(trace.selected as SpeakerId)}</span>
                  <span className="diag-muted" style={{ flex: 1 }}>{trace.focus_point}</span>
                  {trace.intervention_move && <span className="diag-badge" style={{ fontSize: 'var(--text-2xs)', background: trace.intervention_validated ? 'color-mix(in srgb, var(--text-secondary) 20%, transparent)' : 'color-mix(in srgb, var(--danger) 15%, transparent)', color: trace.intervention_validated ? 'var(--text-secondary)' : 'var(--danger)' }}>{trace.intervention_move}{trace.intervention_validated ? '' : ' (suppressed)'}</span>}
                  {trace.health_score != null && <span className="diag-muted" style={{ fontSize: 'var(--text-2xs)' }}>H:{trace.health_score.toFixed(2)}</span>}
                  {trace.recent_scheme && <span className="diag-badge" style={{ fontSize: 'var(--text-2xs)', background: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)', color: 'var(--text-secondary)' }}>{trace.recent_scheme}</span>}
                  {trace.convergence_score != null && <span className="diag-muted">{(trace.convergence_score * 100).toFixed(0)}%</span>}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        );
      })()}

      {/* Drift Detection Trace (10.6) — moderator drift patterns */}
      {(() => {
        const driftEntries = activeDebate.transcript
          .filter(e => {
            const trace = (e.metadata as Record<string, unknown>)?.moderator_trace as Record<string, unknown> | undefined;
            return trace?.drift_detected === true;
          })
          .map(e => {
            const trace = (e.metadata as Record<string, unknown>).moderator_trace as Record<string, unknown>;
            const round = trace.debate_phase ? undefined : (e.metadata as Record<string, unknown>)?.round as number | undefined;
            return {
              id: e.id,
              round,
              reasoning: trace.drift_reasoning as string | null,
              intervention_move: trace.intervention_move as string | null,
              intervention_validated: trace.intervention_validated as boolean | undefined,
              selected: trace.selected as string | undefined,
            };
          });
        if (driftEntries.length === 0) return null;
        const redirected = driftEntries.filter(d => d.intervention_validated && d.intervention_move && ['REDIRECT', 'CHALLENGE', 'CLARIFY', 'CHECK'].includes(d.intervention_move));
        return (
          <CollapsibleSection title={`Drift Detection — ${driftEntries.length} detected, ${redirected.length} intervened`}>
            {driftEntries.map(d => (
              <div key={d.id} style={{ marginBottom: 6, fontSize: 'var(--text-2xs)' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  {d.round != null && <span className="diag-muted">R{d.round}</span>}
                  {d.selected && <span>{speakerLabel(d.selected as SpeakerId)}</span>}
                  <span className="diag-badge" style={{
                    fontSize: 'var(--text-2xs)',
                    background: d.intervention_validated ? 'color-mix(in srgb, var(--danger) 15%, transparent)' : 'color-mix(in srgb, var(--warning) 15%, transparent)',
                    color: d.intervention_validated ? 'var(--danger)' : 'var(--warning)',
                  }}>
                    {d.intervention_validated && d.intervention_move ? d.intervention_move : 'drift noted'}
                  </span>
                </div>
                {d.reasoning && (
                  <div style={{ marginLeft: 8, color: 'var(--text-muted)', fontStyle: 'italic' }}>{d.reasoning}</div>
                )}
              </div>
            ))}
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
                <span className="diag-an-speaker">({speakerLabel(claim.speaker as SpeakerId)})</span>
                <span className="diag-badge" style={{ fontSize: 'var(--text-2xs)', background: claim.addressed_round ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'color-mix(in srgb, var(--danger) 15%, transparent)', color: claim.addressed_round ? 'var(--success)' : 'var(--danger)' }}>
                  {claim.addressed_round ? `addressed R${claim.addressed_round}` : `since R${claim.first_unanswered_round}`}
                </span>
              </div>
              <div style={{ paddingLeft: 8, fontSize: 'var(--text-2xs)' }}>{claim.claim_text}</div>
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
                <span className="diag-badge diag-badge-move" style={{ fontSize: 'var(--text-2xs)' }}>{arg.side}</span>
                <span className="diag-badge" style={{ fontSize: 'var(--text-2xs)', background: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)', color: 'var(--text-secondary)' }}>{arg.bdi_layer}</span>
              </div>
              <div style={{ fontSize: '0.7rem', marginTop: 2 }}>{arg.argument}</div>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>{arg.why_strong}</div>
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
              const selfDelta = (latest.self_similarity ?? 0) - (first.self_similarity ?? 0);
              return (
                <div key={speaker} className="diag-drift-speaker">
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <strong>{speakerLabel(speaker as SpeakerId)}</strong>
                    <span className="diag-muted">self-sim: {(latest.self_similarity ?? 0).toFixed(3)}</span>
                    <span className={`diag-badge ${selfDelta < -0.05 ? 'diag-drift-warning' : ''}`} style={{ fontSize: 'var(--text-2xs)' }}>
                      {selfDelta > 0 ? '+' : ''}{selfDelta.toFixed(3)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, fontSize: 'var(--text-2xs)', paddingLeft: 8 }}>
                    {Object.entries(latest.opponent_similarities).map(([opp, sim]) => (
                      <span key={opp}>→ {speakerLabel(opp as SpeakerId)}: {(sim ?? 0).toFixed(3)}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </CollapsibleSection>
        );
      })()}

      {/* Exclusion Guard Summary */}
      {(() => {
        const entries = diag?.entries;
        if (!entries || Object.keys(entries).length === 0) return null;

        let claimsChecked = 0;
        let claimViolations: { claim_id: string; claim_text: string; node_id: string; similarity_main: number; similarity_exclusion: number }[] = [];
        let draftsChecked = 0;
        let driftWarnings: { debater: string; node_id: string; similarity: number; draft_excerpt: string }[] = [];
        let hasAnyData = false;

        for (const entry of Object.values(entries)) {
          const extTrace = entry.extraction_trace;
          if (extTrace) {
            hasAnyData = true;
            if (extTrace.exclusion_guard) {
              claimsChecked += extTrace.exclusion_guard.checked;
              if (extTrace.exclusion_guard.violations?.length) claimViolations = claimViolations.concat(extTrace.exclusion_guard.violations);
            }
            if (extTrace.exclusion_violations?.length) {
              claimViolations = claimViolations.concat(extTrace.exclusion_violations);
            }
          }

          if (entry.scope_drift_check) {
            hasAnyData = true;
            draftsChecked += entry.scope_drift_check.refs_checked;
            if (entry.scope_drift_check.warnings?.length) driftWarnings = driftWarnings.concat(entry.scope_drift_check.warnings);
          }
          if (entry.scope_drift_warnings?.length) {
            hasAnyData = true;
            driftWarnings = driftWarnings.concat(entry.scope_drift_warnings);
          }
        }

        if (!hasAnyData) {
          return (
            <CollapsibleSection title="Exclusion Guard">
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                Exclusion guard data not available for this debate
              </div>
            </CollapsibleSection>
          );
        }

        const allClear = claimViolations.length === 0 && driftWarnings.length === 0;

        return (
          <CollapsibleSection title={`Exclusion Guard${!allClear ? ` — ${claimViolations.length + driftWarnings.length} issues` : ''}`}>
            {allClear ? (
              <div style={{
                padding: '6px 8px',
                borderRadius: 4,
                background: 'color-mix(in srgb, var(--success) 8%, transparent)',
                borderLeft: '3px solid var(--success)',
                fontSize: '0.72rem',
                color: 'var(--success)',
                fontWeight: 600,
              }}>
                All statements within scope — no exclusion violations or drift warnings
              </div>
            ) : (
              <div style={{ fontSize: '0.72rem' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span style={{
                    padding: '3px 6px',
                    borderRadius: 3,
                    background: claimViolations.length > 0 ? 'color-mix(in srgb, var(--danger) 10%, transparent)' : 'color-mix(in srgb, var(--success) 8%, transparent)',
                    color: claimViolations.length > 0 ? 'var(--danger)' : 'var(--success)',
                    fontWeight: 600,
                    fontSize: 'var(--text-2xs)',
                  }}>
                    {claimsChecked} claims checked, {claimViolations.length} violation{claimViolations.length !== 1 ? 's' : ''}
                  </span>
                  <span style={{
                    padding: '3px 6px',
                    borderRadius: 3,
                    background: driftWarnings.length > 0 ? 'color-mix(in srgb, var(--warning) 10%, transparent)' : 'color-mix(in srgb, var(--success) 8%, transparent)',
                    color: driftWarnings.length > 0 ? 'var(--warning)' : 'var(--success)',
                    fontWeight: 600,
                    fontSize: 'var(--text-2xs)',
                  }}>
                    {draftsChecked} drafts checked, {driftWarnings.length} drift warning{driftWarnings.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {claimViolations.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div className="diag-k" style={{ fontSize: 'var(--text-2xs)', color: 'var(--danger)', marginBottom: 3 }}>Exclusion Violations ({claimViolations.length})</div>
                    {claimViolations.slice(0, 10).map((v, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6, fontSize: 'var(--text-2xs)', marginLeft: 8, marginBottom: 2 }}>
                        <span style={{ fontWeight: 600, color: 'var(--danger)' }}>{v.claim_id}</span>
                        <span style={{ color: 'var(--text-muted)' }}>→</span>
                        <span>{v.node_id}</span>
                        <span className="diag-muted" style={{ fontSize: 'var(--text-2xs)' }}>
                          (main: {v.similarity_main.toFixed(2)}, excl: {v.similarity_exclusion.toFixed(2)})
                        </span>
                      </div>
                    ))}
                    {claimViolations.length > 10 && (
                      <div className="diag-muted" style={{ fontSize: 'var(--text-2xs)', marginLeft: 8 }}>…and {claimViolations.length - 10} more</div>
                    )}
                  </div>
                )}
                {driftWarnings.length > 0 && (
                  <div>
                    <div className="diag-k" style={{ fontSize: 'var(--text-2xs)', color: 'var(--warning)', marginBottom: 3 }}>Scope Drift Warnings ({driftWarnings.length})</div>
                    {driftWarnings.slice(0, 10).map((w, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6, fontSize: 'var(--text-2xs)', marginLeft: 8, marginBottom: 2 }}>
                        <span style={{ fontWeight: 600, color: 'var(--warning)' }}>{w.debater}</span>
                        <span style={{ color: 'var(--text-muted)' }}>→</span>
                        <span>{w.node_id}</span>
                        <span className="diag-muted" style={{ fontSize: 'var(--text-2xs)' }}>
                          (sim: {w.similarity.toFixed(2)})
                        </span>
                      </div>
                    ))}
                    {driftWarnings.length > 10 && (
                      <div className="diag-muted" style={{ fontSize: 'var(--text-2xs)', marginLeft: 8 }}>…and {driftWarnings.length - 10} more</div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="diag-muted" style={{ fontSize: 'var(--text-2xs)', marginTop: 6 }}>
              {claimsChecked} claims checked, {claimViolations.length} violation{claimViolations.length !== 1 ? 's' : ''} | {draftsChecked} drafts checked, {driftWarnings.length} drift warning{driftWarnings.length !== 1 ? 's' : ''}
            </div>
          </CollapsibleSection>
        );
      })()}

      {/* Taxonomy Suggestions */}
      {activeDebate.taxonomy_suggestions && activeDebate.taxonomy_suggestions.length > 0 && (
        <CollapsibleSection title={`Taxonomy Suggestions — ${activeDebate.taxonomy_suggestions.length} revisions`} defaultOpen>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
            <DescriptionToggle mode={descMode} onToggle={setDescMode} hasPlainDescription />
          </div>
          {activeDebate.taxonomy_suggestions.map((sug, i) => {
            const afterKey = `after-${sug.node_id}-${i}`;
            let beforeText = sug.current_description;
            let afterText = sug.proposed_description;
            let beforeGenerating = false;
            let afterGenerating = false;

            if (descMode === 'plain') {
              const storedPlain = lookupPlainDescription(sug.node_id, sug.node_pov);
              if (storedPlain) {
                beforeText = storedPlain;
              } else if (sug.current_description) {
                beforeGenerating = true;
              }

              if (plainPreviews[afterKey] !== undefined) {
                afterText = plainPreviews[afterKey] ?? sug.proposed_description;
              } else {
                afterGenerating = true;
              }
            }

            return (
            <div key={i} className="diag-taxo-suggestion">
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="diag-an-id">{sug.node_id}</span>
                <strong style={{ fontSize: '0.7rem' }}>{sug.node_label}</strong>
                <span className="diag-badge diag-badge-move" style={{ fontSize: 'var(--text-2xs)' }}>{sug.node_pov}</span>
                <span className={`diag-badge diag-suggestion-${sug.suggestion_type}`} style={{ fontSize: 'var(--text-2xs)' }}>{sug.suggestion_type}</span>
              </div>
              {beforeText && (
                <div className="diag-taxo-before">
                  <span className="diag-k">Before:</span>
                  <div className={`diag-taxo-desc${beforeGenerating ? ' plain-description-generating' : ''}`}>{beforeText}</div>
                </div>
              )}
              <div className="diag-taxo-after">
                <span className="diag-k">After:</span>
                <div className={`diag-taxo-desc diag-taxo-desc-proposed${afterGenerating ? ' plain-description-generating' : ''}`}>{afterText}</div>
              </div>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 4 }}>
                {sug.rationale}
              </div>
              {sug.evidence_claim_ids && sug.evidence_claim_ids.length > 0 && (
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                  Evidence: {sug.evidence_claim_ids.join(', ')}
                </div>
              )}
            </div>
            );
          })}
        </CollapsibleSection>
      )}

      {/* Fact-Check Verification */}
      <VerificationSection
        transcript={activeDebate.transcript ?? []}
        anNodes={an?.nodes ?? []}
      />

      {/* Overview Stats */}
      {diag && (
        <CollapsibleSection title="Session Statistics" defaultOpen>
          <div className="diag-kv"><span className="diag-k">Statements:</span> <span className="diag-v">{activeDebate.transcript.filter(e => e.type === 'statement' || e.type === 'opening').length} ({activeDebate.transcript.length} total entries)</span></div>
          <div className="diag-kv"><span className="diag-k">AI calls:</span> <span className="diag-v">{diag.overview.total_ai_calls}</span></div>
          <div className="diag-kv"><span className="diag-k">Total response time:</span> <span className="diag-v">{((diag.overview.total_response_time_ms ?? 0) / 1000).toFixed(1)}s</span></div>
          <div className="diag-kv"><span className="diag-k">Claims accepted:</span> <span className="diag-v">{diag.overview.claims_accepted}</span></div>
          <div className="diag-kv"><span className="diag-k">Claims rejected:</span> <span className="diag-v">{diag.overview.claims_rejected}</span></div>
          {(diag.overview.total_input_tokens != null || diag.overview.total_output_tokens != null) && (
            <div className="diag-kv">
              <span className="diag-k">Total tokens:</span>
              <span className="diag-v">
                {diag.overview.total_input_tokens != null ? diag.overview.total_input_tokens.toLocaleString() : '—'} in
                {' / '}
                {diag.overview.total_output_tokens != null ? diag.overview.total_output_tokens.toLocaleString() : '—'} out
                {diag.overview.total_input_tokens != null && diag.overview.total_output_tokens != null && (
                  <> ({(diag.overview.total_input_tokens + diag.overview.total_output_tokens).toLocaleString()} total)</>
                )}
              </span>
            </div>
          )}
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
