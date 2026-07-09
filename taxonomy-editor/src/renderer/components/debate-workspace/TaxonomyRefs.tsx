// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { TOAST_DURATION_FEEDBACK } from '../../constants';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TaxonomyRef, TranscriptEntry } from '../../types/debate';
import type { CoverageMap, StrengthWeightedCoverage } from '@lib/debate/coverageTracker';
import { humanizeSpeakerIds } from '../../utils/humanizeSpeakers';
import {
  nodeIdToTab, getNodeLabel, getNodeWeight, focusMainWindowNode,
  handleExplainEntry, fixMarkdownLinks, resolvePolRef, getPolicyAction,
} from './utils';
import type { PolicyRefEntry } from './utils';

export function CoverageBadge({ coverageMap, strengthWeighted }: { coverageMap: CoverageMap; strengthWeighted?: StrengthWeightedCoverage | null }) {
  const { stats } = coverageMap;
  const pct = Math.round(stats.coveragePercentage);
  const colorClass = pct > 75 ? 'coverage-badge-green' : pct >= 40 ? 'coverage-badge-yellow' : 'coverage-badge-red';
  const covered = stats.coveredCount + stats.partiallyCoveredCount;
  const swPct = strengthWeighted ? Math.round(strengthWeighted.strength_weighted_coverage) : null;
  const titleParts = [
    `TAXONOMY GROUNDING`,
    `Measures how many of this debate's claims are grounded in taxonomy nodes.`,
    ``,
    `Current: ${covered}/${stats.totalClaims} claims grounded (${pct}%)`,
    `  ${stats.coveredCount} fully grounded (claim maps to 1+ taxonomy nodes)`,
    `  ${stats.partiallyCoveredCount} partially grounded (weak or indirect mapping)`,
    `  ${stats.uncoveredCount} ungrounded (no taxonomy connection)`,
  ];
  if (swPct !== null) {
    titleParts.push(``);
    titleParts.push(`Strength-weighted: ${swPct}%`);
    titleParts.push(`Weights each claim by its QBAF argumentation strength,`);
    titleParts.push(`so strongly-supported claims count more than weak ones.`);
  }
  titleParts.push(``);
  titleParts.push(`Color bands: green >75% | yellow 40-75% | red <40%`);
  titleParts.push(`Higher grounding = debate is well-anchored in the taxonomy.`);

  return (
    <span className={`coverage-badge ${colorClass}`} title={titleParts.join('\n')}>
      Grounding: {covered}/{stats.totalClaims} ({pct}%){swPct !== null && swPct !== pct ? ` · str: ${swPct}%` : ''}
    </span>
  );
}

export function TaxonomyPill({ taxRef }: { taxRef: TaxonomyRef }) {
  const { colorVar } = nodeIdToTab(taxRef.node_id);
  const label = getNodeLabel(taxRef.node_id);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    focusMainWindowNode(taxRef.node_id);
  };

  const scoreLabel = taxRef.relevance_score != null
    ? ` (${taxRef.relevance_score.toFixed(2)})`
    : '';
  const primaryMarker = taxRef.primary ? '★ ' : '';

  return (
    <span
      className={`debate-taxonomy-pill debate-taxonomy-pill-clickable${taxRef.primary ? ' debate-taxonomy-pill-primary' : ''}`}
      style={{ borderColor: colorVar, color: colorVar }}
      title={`${primaryMarker}${label}${scoreLabel}\n${taxRef.relevance}`}
      onClick={handleClick}
    >
      {primaryMarker}{taxRef.node_id}{scoreLabel}
    </span>
  );
}


export function TaxonomyRefsSection({ refs, policyRefs, metaPolicyRefs, entry, stageDiagnostics, forceExpanded }: {
  refs: TaxonomyRef[];
  policyRefs?: PolicyRefEntry[];
  metaPolicyRefs?: PolicyRefEntry[];
  entry?: TranscriptEntry;
  stageDiagnostics?: { stage: string; raw_response: string; work_product: Record<string, unknown> }[];
  forceExpanded?: boolean;
}) {
  const [caveatsExpanded, setCaveatsExpanded] = useState(false);
  const [explainCopied, setExplainCopied] = useState(false);
  const polRefs = metaPolicyRefs || policyRefs || [];

  const handleExplain = () => {
    if (!entry) return;
    handleExplainEntry(entry);
    setExplainCopied(true);
    setTimeout(() => setExplainCopied(false), TOAST_DURATION_FEEDBACK);
  };

  const briefStage = stageDiagnostics?.find(s => s.stage === 'brief');
  const planStage = stageDiagnostics?.find(s => s.stage === 'plan');
  const hasDiagSections = !!(briefStage || planStage);
  const hasReasoning = refs.length > 0 || polRefs.length > 0 || hasDiagSections;

  if (!hasReasoning && !entry) return null;

  return (
    <div className="debate-taxonomy-refs-section">
      <div className="debate-taxonomy-refs">
        {entry && entry.speaker !== 'system' && entry.type !== 'fact-check' && (
          explainCopied
            ? <span className="debate-reasoning-toggle" style={{ color: '#22c55e', cursor: 'default' }}>✓ Explain prompt copied to clipboard</span>
            : <button className="debate-reasoning-toggle" onClick={handleExplain} title="Copy an explain prompt to clipboard and open Gemini">Explain</button>
        )}
        {entry?.caveats && entry.caveats.length > 0 && (
          <button
            className="debate-reasoning-toggle"
            onClick={() => setCaveatsExpanded(e => !e)}
            title="Unresolved argument limitations identified by the judge"
            style={{ color: '#d97706' }}
          >
            Caveats ({entry.caveats.length})
          </button>
        )}
      </div>
      {caveatsExpanded && entry?.caveats && entry.caveats.length > 0 && (() => {
        const qualityCaveats = entry.caveats.filter(c => !c.startsWith('[Ungrounded]'));
        const ungroundedCaveats = entry.caveats.filter(c => c.startsWith('[Ungrounded]'));
        return (
          <div style={{
            margin: '4px 0 8px', padding: '8px 12px', borderRadius: 6,
            background: 'rgba(217,119,6,0.08)', borderLeft: '3px solid #d97706',
            fontSize: '0.75rem', lineHeight: 1.5,
          }}>
            {qualityCaveats.length > 0 && (
              <>
                <div style={{ fontWeight: 600, color: '#d97706', marginBottom: 4, fontSize: '0.7rem' }}>
                  Argument Caveats — limitations a critical reader would challenge:
                </div>
                <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                  {qualityCaveats.map((c, i) => (
                    <li key={i} style={{ marginBottom: 3 }}>{humanizeSpeakerIds(c)}</li>
                  ))}
                </ul>
              </>
            )}
            {ungroundedCaveats.length > 0 && (
              <>
                <div style={{ fontWeight: 600, color: '#6366f1', marginBottom: 4, fontSize: '0.7rem' }}>
                  Ungrounded Claims — from model knowledge, not the source corpus:
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {ungroundedCaveats.map((c, i) => (
                    <li key={i} style={{ marginBottom: 3, color: '#6366f1' }}>
                      {humanizeSpeakerIds(c.replace('[Ungrounded] ', ''))}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        );
      })()}
      {forceExpanded && (
        <div className="debate-reasoning-list">
          {briefStage && (
            <details open className="debate-reasoning-section">
              <summary className="debate-reasoning-section-title" style={{ color: '#3b82f6' }}>BRIEF</summary>
              <div className="debate-reasoning-section-body">
                {(briefStage.work_product as Record<string, unknown>).situation_assessment
                  ? <p style={{ margin: '4px 0', fontSize: '0.78rem' }}>{String((briefStage.work_product as Record<string, unknown>).situation_assessment)}</p>
                  : <p style={{ margin: '4px 0', fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No situation assessment captured.</p>}
              </div>
            </details>
          )}
          {planStage && (
            <details open className="debate-reasoning-section">
              <summary className="debate-reasoning-section-title" style={{ color: '#a855f7' }}>PLAN</summary>
              <div className="debate-reasoning-section-body">
                {(() => {
                  const wp = planStage.work_product as Record<string, unknown>;
                  if (!wp || Object.keys(wp).length === 0) {
                    return <Markdown remarkPlugins={[remarkGfm]}>{fixMarkdownLinks(planStage.raw_response)}</Markdown>;
                  }
                  return (
                    <>
                      {(() => {
                        const drp = wp.directive_response_plan as string | undefined;
                        const dr = wp.directive_response as { directive: string; how_addressed: string } | undefined;
                        if (!drp && !dr) return null;
                        return (
                          <div style={{ padding: 6, margin: '4px 0', borderLeft: '3px solid rgba(245,158,11,0.6)', background: 'rgba(245,158,11,0.08)', borderRadius: 4, fontSize: '0.72rem' }}>
                            <span style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(245,158,11,0.2)', color: '#d97706', fontWeight: 600, fontSize: 'var(--text-2xs)' }}>MODERATOR DIRECTIVE</span>
                            {dr && (
                              <>
                                <div style={{ marginTop: 4 }}><strong>Directive:</strong> {dr.directive}</div>
                                <div><strong>How addressed:</strong> {dr.how_addressed}</div>
                              </>
                            )}
                            {drp && !dr && <div style={{ marginTop: 4 }}>{String(drp)}</div>}
                          </div>
                        );
                      })()}
                      {!!wp.strategic_goal && (
                        <div style={{ padding: 6, margin: '4px 0', borderLeft: '3px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.05)', fontSize: '0.75rem', fontWeight: 600 }}>
                          {String(wp.strategic_goal)}
                        </div>
                      )}
                      {!!wp.core_thesis && (
                        <div style={{ padding: 6, margin: '4px 0', borderLeft: '3px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.05)', fontSize: '0.72rem' }}>
                          <span style={{ fontWeight: 600, fontSize: 'var(--text-2xs)' }}>Core Thesis: </span>
                          {String(wp.core_thesis)}
                        </div>
                      )}
                      {!!wp.framing_choices && (
                        <div style={{ padding: 6, margin: '4px 0', borderLeft: '3px solid rgba(168,85,247,0.3)', fontSize: '0.7rem' }}>
                          <span style={{ fontWeight: 600, fontSize: 'var(--text-2xs)' }}>Framing: </span>
                          {Array.isArray(wp.framing_choices)
                            ? (wp.framing_choices as { frame: string; why: string }[]).map((fc, i) => (
                              <div key={i} style={{ marginTop: i > 0 ? 4 : 2 }}>
                                <strong>{fc.frame}</strong>
                                {fc.why && <span style={{ opacity: 0.7 }}> — {fc.why}</span>}
                              </div>
                            ))
                            : <span>{String(wp.framing_choices)}</span>
                          }
                        </div>
                      )}
                      {Array.isArray(wp.planned_moves) && (wp.planned_moves as unknown[]).length > 0 && (
                        <details open style={{ margin: '4px 0' }}><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.7rem' }}>Planned Moves</summary>
                          {(wp.planned_moves as { move: string; target?: string; detail: string }[]).map((m, i) => (
                            <div key={i} style={{ margin: '3px 0', paddingLeft: 6, borderLeft: '2px solid rgba(168,85,247,0.3)' }}>
                              <span style={{ display: 'inline-block', padding: '1px 5px', borderRadius: 3, background: 'rgba(168,85,247,0.2)', color: '#a855f7', fontSize: 'var(--text-2xs)', fontWeight: 600 }}>{m.move}</span>
                              {m.target && <span style={{ marginLeft: 4, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{'→'} {m.target}</span>}
                              {m.detail && <div style={{ fontSize: 'var(--text-2xs)', marginTop: 1 }}>{m.detail}</div>}
                            </div>
                          ))}
                        </details>
                      )}
                      {Array.isArray(wp.argument_structure) && (wp.argument_structure as unknown[]).length > 0 && (
                        <details open style={{ margin: '4px 0' }}><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.7rem' }}>Argumentation Structure</summary>
                          {(wp.argument_structure as { point: string; evidence: string; taxonomy_anchor: string }[]).map((s, i) => (
                            <div key={i} style={{ margin: '3px 0', padding: '4px 6px', borderLeft: '2px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.03)', borderRadius: '0 4px 4px 0' }}>
                              <div style={{ fontSize: '0.7rem', fontWeight: 600 }}>{s.point}</div>
                              {s.evidence && <div style={{ fontSize: 'var(--text-2xs)', marginTop: 1 }}>{s.evidence}</div>}
                              {s.taxonomy_anchor && (
                                <div style={{ marginTop: 2 }}>
                                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>Anchor: </span>
                                  <button
                                    onClick={() => focusMainWindowNode(s.taxonomy_anchor)}
                                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'var(--text-2xs)' }}
                                  >{s.taxonomy_anchor}</button>
                                </div>
                              )}
                            </div>
                          ))}
                        </details>
                      )}
                      {!!wp.argument_sketch && (
                        <details open style={{ margin: '4px 0' }}><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.7rem' }}>Argument Sketch</summary>
                          <div style={{ fontSize: '0.7rem', padding: 4, background: 'rgba(128,128,128,0.05)', borderRadius: 4 }}>
                            {String(wp.argument_sketch)}
                          </div>
                        </details>
                      )}
                      {Array.isArray(wp.anticipated_responses) && (wp.anticipated_responses as string[]).length > 0 && (
                        <details style={{ margin: '4px 0' }}><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.7rem' }}>Anticipated Responses</summary>
                          <ul style={{ fontSize: '0.7rem', margin: '2px 0', paddingLeft: 14 }}>
                            {(wp.anticipated_responses as string[]).map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {Array.isArray(wp.anticipated_challenges) && (wp.anticipated_challenges as string[]).length > 0 && (
                        <details style={{ margin: '4px 0' }}><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.7rem' }}>Anticipated Challenges</summary>
                          <ul style={{ fontSize: '0.7rem', margin: '2px 0', paddingLeft: 14 }}>
                            {(wp.anticipated_challenges as string[]).map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  );
                })()}
              </div>
            </details>
          )}
          {(refs.length > 0 || polRefs.length > 0) && (
            <details className="debate-reasoning-section">
              <summary className="debate-reasoning-section-title" style={{ color: '#f59e0b' }}>BDI</summary>
              <div className="debate-reasoning-section-body">
                <div className="debate-taxonomy-refs" style={{ marginBottom: 6 }}>
                  {[...refs].sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)).map((taxRef) => (
                    <TaxonomyPill key={taxRef.node_id} taxRef={taxRef} />
                  ))}
                  {polRefs.map((polRef, i) => {
                    const { id } = resolvePolRef(polRef);
                    return (
                      <span
                        key={`${id}-${i}`}
                        className="debate-taxonomy-pill debate-taxonomy-pill-clickable"
                        style={{ borderColor: 'var(--color-sit)', color: 'var(--color-sit)' }}
                        title={getPolicyAction(id)}
                        onClick={(e) => { e.stopPropagation(); focusMainWindowNode(id); }}
                      >
                        {id}
                      </span>
                    );
                  })}
                </div>
                {[...refs].sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)).map((taxRef) => {
                  const label = getNodeLabel(taxRef.node_id);
                  const { colorVar } = nodeIdToTab(taxRef.node_id);
                  const tw = getNodeWeight(taxRef.node_id);
                  const weightLabel = tw?.category === 'Beliefs' ? 'Confidence'
                    : tw?.category === 'Desires' ? 'Priority'
                    : tw?.category === 'Intentions' ? 'Operationality' : null;
                  const weightValue = tw?.category === 'Beliefs' ? tw.confidence
                    : tw?.category === 'Desires' ? tw.priority
                    : tw?.category === 'Intentions' ? tw.operationality : undefined;
                  return (
                    <div key={taxRef.node_id} className="debate-reasoning-item">
                      <button
                        className="debate-reasoning-node"
                        style={{ color: colorVar }}
                        onClick={() => focusMainWindowNode(taxRef.node_id)}
                      >
                        {taxRef.node_id}
                      </button>
                      <span className="debate-reasoning-label">{label}</span>
                      <span className="debate-reasoning-weight" style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                        ({taxRef.relevance_score != null && <>Relevance {taxRef.relevance_score.toFixed(2)}</>}
                        {taxRef.relevance_score != null && weightLabel && weightValue != null && ' ; '}
                        {weightLabel && weightValue != null && <>{weightLabel} {weightLabel === 'Confidence' ? weightValue.toFixed(2) : `${weightValue}/5`}</>})
                      </span>
                      <span className="debate-reasoning-text">{taxRef.relevance}</span>
                    </div>
                  );
                })}
                {polRefs.map((polRef, i) => {
                  const { id, relevance } = resolvePolRef(polRef);
                  return (
                    <div key={`${id}-${i}`} className="debate-reasoning-item">
                      <button
                        className="debate-reasoning-node"
                        style={{ color: 'var(--color-sit)' }}
                        onClick={() => focusMainWindowNode(id)}
                      >
                        {id}
                      </button>
                      <span className="debate-reasoning-label">{getPolicyAction(id)}</span>
                      <span className="debate-reasoning-text">{relevance ?? "Policy action referenced by this debater's argument"}</span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
