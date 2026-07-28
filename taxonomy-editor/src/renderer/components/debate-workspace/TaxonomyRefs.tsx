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
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { TaxonomyRefDetail, type TaxRefNode } from '../taxonomy/TaxonomyRefDetail';
import './TaxonomyRefs.css';

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
      // eslint-disable-next-line local/no-inline-style -- dynamic POV color from nodeIdToTab
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
  // Selected PLAN-view taxonomy anchor → shows its POV details inline (t/1724).
  const [selectedPlanNodeId, setSelectedPlanNodeId] = useState<string | null>(null);
  const lookupPinnedData = useTaxonomyStore(s => s.lookupPinnedData);
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
            ? <span className="debate-reasoning-toggle taxrefs-explain-copied">✓ Explain prompt copied to clipboard</span>
            : <button className="debate-reasoning-toggle" onClick={handleExplain} title="Copy an explain prompt to clipboard and open Gemini">Explain</button>
        )}
        {entry?.caveats && entry.caveats.length > 0 && (
          <button
            className="debate-reasoning-toggle taxrefs-caveats-btn"
            onClick={() => setCaveatsExpanded(e => !e)}
            title="Unresolved argument limitations identified by the judge"
          >
            Caveats ({entry.caveats.length})
          </button>
        )}
      </div>
      {caveatsExpanded && entry?.caveats && entry.caveats.length > 0 && (() => {
        const qualityCaveats = entry.caveats.filter(c => !c.startsWith('[Ungrounded]'));
        const ungroundedCaveats = entry.caveats.filter(c => c.startsWith('[Ungrounded]'));
        return (
          <div className="taxrefs-caveats-box">
            {qualityCaveats.length > 0 && (
              <>
                <div className="taxrefs-caveat-heading-amber">
                  Argument Caveats — limitations a critical reader would challenge:
                </div>
                <ul className="taxrefs-caveat-list">
                  {qualityCaveats.map((c, i) => (
                    <li key={i} className="taxrefs-caveat-li">{humanizeSpeakerIds(c)}</li>
                  ))}
                </ul>
              </>
            )}
            {ungroundedCaveats.length > 0 && (
              <>
                <div className="taxrefs-caveat-heading-indigo">
                  Ungrounded Claims — from model knowledge, not the source corpus:
                </div>
                <ul className="taxrefs-caveat-list-last">
                  {ungroundedCaveats.map((c, i) => (
                    <li key={i} className="taxrefs-caveat-li-indigo">
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
              <summary className="debate-reasoning-section-title taxrefs-section-brief">BRIEF</summary>
              <div className="debate-reasoning-section-body">
                {(briefStage.work_product as Record<string, unknown>).situation_assessment
                  ? <p className="taxrefs-brief-text">{String((briefStage.work_product as Record<string, unknown>).situation_assessment)}</p>
                  : <p className="taxrefs-brief-empty">No situation assessment captured.</p>}
              </div>
            </details>
          )}
          {planStage && (
            <details open className="debate-reasoning-section">
              <summary className="debate-reasoning-section-title taxrefs-section-plan">PLAN</summary>
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
                          <div className="taxrefs-directive-box">
                            <span className="taxrefs-directive-badge">MODERATOR DIRECTIVE</span>
                            {dr && (
                              <>
                                <div className="taxrefs-mt-4"><strong>Directive:</strong> {dr.directive}</div>
                                <div><strong>How addressed:</strong> {dr.how_addressed}</div>
                              </>
                            )}
                            {drp && !dr && <div className="taxrefs-mt-4">{String(drp)}</div>}
                          </div>
                        );
                      })()}
                      {!!wp.strategic_goal && (
                        <div className="taxrefs-goal-box">
                          {String(wp.strategic_goal)}
                        </div>
                      )}
                      {!!wp.core_thesis && (
                        <div className="taxrefs-thesis-box">
                          <span className="taxrefs-inline-label">Core Thesis: </span>
                          {String(wp.core_thesis)}
                        </div>
                      )}
                      {!!wp.framing_choices && (
                        <div className="taxrefs-framing-box">
                          <span className="taxrefs-inline-label">Framing: </span>
                          {Array.isArray(wp.framing_choices)
                            ? (wp.framing_choices as { frame: string; why: string }[]).map((fc, i) => (
                              <div key={i} className={i > 0 ? 'taxrefs-mt-4' : 'taxrefs-mt-2'}>
                                <strong>{fc.frame}</strong>
                                {fc.why && <span className="taxrefs-framing-why"> — {fc.why}</span>}
                              </div>
                            ))
                            : <span>{String(wp.framing_choices)}</span>
                          }
                        </div>
                      )}
                      {Array.isArray(wp.planned_moves) && (wp.planned_moves as unknown[]).length > 0 && (
                        <details open className="taxrefs-details"><summary className="taxrefs-summary">Planned Moves</summary>
                          {(wp.planned_moves as { move: string; target?: string; detail: string }[]).map((m, i) => (
                            <div key={i} className="taxrefs-move-item">
                              <span className="taxrefs-move-badge">{m.move}</span>
                              {m.target && <span className="taxrefs-move-target">{'→'} {m.target}</span>}
                              {m.detail && <div className="taxrefs-detail-2xs">{m.detail}</div>}
                            </div>
                          ))}
                        </details>
                      )}
                      {Array.isArray(wp.argument_structure) && (wp.argument_structure as unknown[]).length > 0 && (
                        <details open className="taxrefs-details"><summary className="taxrefs-summary">Argumentation Structure</summary>
                          {(wp.argument_structure as { point: string; evidence: string; taxonomy_anchor: string }[]).map((s, i) => (
                            <div key={i} className="taxrefs-arg-item">
                              <div className="taxrefs-arg-point">{s.point}</div>
                              {s.evidence && <div className="taxrefs-detail-2xs">{s.evidence}</div>}
                              {s.taxonomy_anchor && (
                                <div className="taxrefs-mt-2">
                                  <span className="taxrefs-anchor-label">Anchor: </span>
                                  <button
                                    onClick={() => setSelectedPlanNodeId(prev => prev === s.taxonomy_anchor ? null : s.taxonomy_anchor)}
                                    aria-expanded={selectedPlanNodeId === s.taxonomy_anchor}
                                    title="Show this POV node's details"
                                    className="taxrefs-anchor-btn"
                                  >{s.taxonomy_anchor}</button>
                                </div>
                              )}
                            </div>
                          ))}
                        </details>
                      )}
                      {!!wp.argument_sketch && (
                        <details open className="taxrefs-details"><summary className="taxrefs-summary">Argument Sketch</summary>
                          <div className="taxrefs-sketch-box">
                            {String(wp.argument_sketch)}
                          </div>
                        </details>
                      )}
                      {Array.isArray(wp.anticipated_responses) && (wp.anticipated_responses as string[]).length > 0 && (
                        <details className="taxrefs-details"><summary className="taxrefs-summary">Anticipated Responses</summary>
                          <ul className="taxrefs-anticipated-list">
                            {(wp.anticipated_responses as string[]).map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {Array.isArray(wp.anticipated_challenges) && (wp.anticipated_challenges as string[]).length > 0 && (
                        <details className="taxrefs-details"><summary className="taxrefs-summary">Anticipated Challenges</summary>
                          <ul className="taxrefs-anticipated-list">
                            {(wp.anticipated_challenges as string[]).map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {/* Inline POV detail for the clicked argument-structure anchor (t/1724).
                          Resolved entirely from the client-side taxonomy store — no fetch.
                          Rendered once at the end of the plan body so the layout above the
                          clicked item stays put. Reuses TaxonomyRefDetail (same component the
                          diagnostics Plan tab uses), so per-camp interpretations + graph
                          attributes render identically. */}
                      {selectedPlanNodeId && (() => {
                        const data = lookupPinnedData(selectedPlanNodeId);
                        const node = data && data.type !== 'conflict'
                          ? (data.node as unknown as TaxRefNode)
                          : undefined;
                        const pov = data?.type === 'pov' ? data.pov
                          : data?.type === 'situations' ? 'situations' : '';
                        return (
                          <TaxonomyRefDetail
                            nodeId={selectedPlanNodeId}
                            node={node}
                            pov={pov}
                            onClose={() => setSelectedPlanNodeId(null)}
                          />
                        );
                      })()}
                    </>
                  );
                })()}
              </div>
            </details>
          )}
          {(refs.length > 0 || polRefs.length > 0) && (
            <details className="debate-reasoning-section">
              <summary className="debate-reasoning-section-title taxrefs-section-bdi">BDI</summary>
              <div className="debate-reasoning-section-body">
                <div className="debate-taxonomy-refs taxrefs-refs-mb">
                  {[...refs].sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)).map((taxRef) => (
                    <TaxonomyPill key={taxRef.node_id} taxRef={taxRef} />
                  ))}
                  {polRefs.map((polRef, i) => {
                    const { id } = resolvePolRef(polRef);
                    return (
                      <span
                        key={`${id}-${i}`}
                        className="debate-taxonomy-pill debate-taxonomy-pill-clickable taxrefs-pol-pill"
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
                        // eslint-disable-next-line local/no-inline-style -- dynamic POV color from nodeIdToTab
                        style={{ color: colorVar }}
                        onClick={() => focusMainWindowNode(taxRef.node_id)}
                      >
                        {taxRef.node_id}
                      </button>
                      <span className="debate-reasoning-label">{label}</span>
                      <span className="debate-reasoning-weight taxrefs-anchor-label">
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
                        className="debate-reasoning-node taxrefs-node-sit"
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
