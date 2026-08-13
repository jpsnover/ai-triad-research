// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React, { Fragment } from 'react';
import type { DebateSession, TurnValidationTrail } from '../../../../types/debate';
import { humanizeSpeakerIds } from '../../../../utils/humanizeSpeakers';
import { Highlight } from '../helpers';
import { classifyHintTarget, HINT_TARGET_STYLE, ArtifactBlock } from '../shared';
import { TaxonomyRefDetail, type TaxRefNode, type TaxRefEdge } from '../../../taxonomy/TaxonomyRefDetail';
import './BriefTab.css';

// Shared turn-score color ramp (used in both the header and footer of the detailed validation box).
function turnScoreColor(turnScore: number): string {
  return turnScore >= 0.7 ? 'var(--success)' : turnScore >= 0.5 ? 'var(--warning)' : 'var(--danger)';
}

// --- Per-metric grounding badges (each guards its own null case) ---
function ScoreBadge({ sc }: { sc: number | null | undefined }) {
  if (sc == null) return null;
  const scColor = sc >= 0.45 ? 'var(--success)' : sc >= 0.30 ? 'var(--warning)' : 'var(--danger)';
  return (
    // eslint-disable-next-line local/no-inline-style -- dynamic scColor
    <span style={{ fontWeight: 600, color: scColor, marginLeft: 6 }}>{sc.toFixed(2)}</span>
  );
}

function ConfBadge({ conf }: { conf: number | undefined }) {
  if (conf == null) return null;
  return (
    // eslint-disable-next-line local/no-inline-style -- dynamic conf coloring
    <span style={{ marginLeft: 4, fontWeight: 600, color: conf >= 0.70 ? 'var(--success)' : conf >= 0.50 ? 'var(--text-secondary)' : 'var(--warning)', background: conf < 0.50 ? 'color-mix(in srgb, var(--warning) 15%, transparent)' : undefined, padding: conf < 0.50 ? '0 3px' : undefined, borderRadius: 2 }}>conf:{conf.toFixed(2)}</span>
  );
}

function PrioBadge({ prio }: { prio: number | undefined }) {
  if (prio == null) return null;
  return (
    // eslint-disable-next-line local/no-inline-style -- dynamic prio coloring
    <span style={{ marginLeft: 4, fontWeight: 600, color: prio >= 4 ? 'var(--text-secondary)' : 'var(--text-muted)' }}>P{prio}/5</span>
  );
}

function OperBadge({ oper }: { oper: number | undefined }) {
  if (oper == null) return null;
  return (
    // eslint-disable-next-line local/no-inline-style -- dynamic oper coloring
    <span style={{ marginLeft: 4, fontWeight: 600, color: oper >= 4 ? 'var(--text-secondary)' : 'var(--text-muted)' }}>op:{oper}/5</span>
  );
}

interface GroundingItemProps {
  g: { node_id: string; why: string };
  baseColor: string;
  entry: DebateSession['transcript'][number];
  nodeWeights: Map<string, { confidence?: number; priority?: number; operationality?: number; category?: string }>;
  taxNodeMap: Map<string, Record<string, unknown>>;
  selectedTaxRefId: string | null;
  setSelectedTaxRefId: (id: string | null) => void;
}

// One POV grounding row — line 1: id + label + scores; line 2: justification/applicability.
function GroundingItem({ g, baseColor, entry, nodeWeights, taxNodeMap, selectedTaxRefId, setSelectedTaxRefId }: GroundingItemProps) {
  const ref = entry.taxonomy_refs?.find(r => r.node_id === g.node_id);
  const sc = ref?.relevance_score;
  const tw = nodeWeights.get(g.node_id);
  const conf = (g as Record<string, unknown>).confidence as number | undefined ?? tw?.confidence;
  const prio = (g as Record<string, unknown>).priority as number | undefined ?? tw?.priority;
  const oper = (g as Record<string, unknown>).operationality as number | undefined ?? tw?.operationality;
  const label = (taxNodeMap.get(g.node_id) as { label?: string } | undefined)?.label;
  return (
    // eslint-disable-next-line local/no-inline-style -- dynamic baseColor
    <li style={{ fontSize: 'var(--text-2xs)', color: baseColor, marginBottom: 3 }}>
      <div>
        <button onClick={() => setSelectedTaxRefId(selectedTaxRefId === g.node_id ? null : g.node_id)} className="brief-taxref-btn">{g.node_id}</button>
        {label && <span className="brief-grounding-label">{label}</span>}
        <ScoreBadge sc={sc} />
        <ConfBadge conf={conf} />
        <PrioBadge prio={prio} />
        <OperBadge oper={oper} />
      </div>
      {g.why && <div className="brief-grounding-why">{g.why}</div>}
    </li>
  );
}

// --- Document Claims to Engage table ---
function DocumentClaimsSection({ workProduct, renderGrounding }: {
  workProduct: Record<string, unknown>;
  renderGrounding: (grounding: { node_id: string; why: string }[], baseColor: string) => React.ReactNode;
}) {
  const claims = workProduct.document_claims_to_engage as { d_id: string; claim: string; stance: string; why: string; grounding?: { node_id: string; why: string }[] }[] | undefined;
  if (!(Array.isArray(claims) && claims.length > 0)) return null;
  return (
    <details open><summary className="brief-summary">Document Claims to Engage</summary>
      <table className="brief-table">
        <thead>
          <tr className="brief-thead-row">
            <th className="brief-th brief-th-w60">D-ID</th>
            <th className="brief-th brief-th-w70">Stance</th>
            <th className="brief-th">Claim &amp; Rationale</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((dc, i) => {
            const stanceColor = dc.stance === 'accept' ? 'var(--success)' : dc.stance === 'challenge' ? 'var(--danger)' : 'var(--warning)';
            return (
              <Fragment key={i}>
                {/* eslint-disable-next-line local/no-inline-style -- dynamic borderBottom */}
                <tr style={{ borderBottom: Array.isArray(dc.grounding) && dc.grounding.length > 0 ? 'none' : '1px solid var(--border-color)' }}>
                  <td className="brief-td-did">{dc.d_id}</td>
                  {/* eslint-disable-next-line local/no-inline-style -- dynamic stanceColor */}
                  <td style={{ padding: '3px 6px', verticalAlign: 'top', fontWeight: 600, color: stanceColor, textTransform: 'uppercase', fontSize: 'var(--text-2xs)' }}>{dc.stance}</td>
                  <td className="brief-td">
                    <Highlight text={dc.claim} />
                    <div className="brief-td-why"><Highlight text={dc.why} /></div>
                  </td>
                </tr>
                {Array.isArray(dc.grounding) && dc.grounding.length > 0 && (
                  <tr className="brief-tr-border">
                    <td colSpan={3} className="brief-td-grounding">
                      {renderGrounding(dc.grounding, 'var(--text-muted)')}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

// --- Validation score box (detailed process-reward breakdown when dims present) ---
function DetailedValidationScore({ turnScore, dims, judgeUsed }: {
  turnScore: number;
  dims: TurnValidationTrail['final']['dimensions'];
  judgeUsed: boolean;
}) {
  const stageA =
    0.4 * (dims.schema.pass ? 1 : 0) +
    0.3 * (dims.grounding.pass ? 1 : 0) +
    0.2 * (dims.advancement.pass ? 1 : 0) +
    0.1 * (dims.clarifies.pass ? 1 : 0);
  const judgeQ = stageA > 0
    ? Math.max(0, Math.min(1, (turnScore - 0.4 * stageA) / 0.6))
    : 0.7;
  const mono = { fontFamily: 'monospace', fontSize: 'var(--text-2xs)' } as const;
  const dimColor = (pass: boolean) => pass ? 'var(--success)' : 'var(--danger)';
  return (
    <div className="brief-valbox">
      <div className="brief-valbox-title">
        Validation Score:{' '}
        {/* eslint-disable-next-line local/no-inline-style -- mono spread + dynamic score color */}
        <span style={{ ...mono, color: turnScoreColor(turnScore) }}>
          {turnScore.toFixed(2)}
        </span>
      </div>
      <div className="brief-valdims">
        {/* eslint-disable-next-line local/no-inline-style -- dynamic dimColor + mono var */}
        <span><span style={{ color: dimColor(dims.schema.pass) }}>{'●'}</span> schema {'×'}0.4 = <strong style={mono}>{(0.4 * (dims.schema.pass ? 1 : 0)).toFixed(2)}</strong></span>
        {/* eslint-disable-next-line local/no-inline-style -- dynamic dimColor + mono var */}
        <span><span style={{ color: dimColor(dims.grounding.pass) }}>{'●'}</span> grounding {'×'}0.3 = <strong style={mono}>{(0.3 * (dims.grounding.pass ? 1 : 0)).toFixed(2)}</strong></span>
        {/* eslint-disable-next-line local/no-inline-style -- dynamic dimColor + mono var */}
        <span><span style={{ color: dimColor(dims.advancement.pass) }}>{'●'}</span> advancement {'×'}0.2 = <strong style={mono}>{(0.2 * (dims.advancement.pass ? 1 : 0)).toFixed(2)}</strong></span>
        {/* eslint-disable-next-line local/no-inline-style -- dynamic dimColor + mono var */}
        <span><span style={{ color: dimColor(dims.clarifies.pass) }}>{'●'}</span> clarifies {'×'}0.1 = <strong style={mono}>{(0.1 * (dims.clarifies.pass ? 1 : 0)).toFixed(2)}</strong></span>
      </div>
      <div className="brief-valfooter">
        {/* eslint-disable-next-line local/no-inline-style -- mono var */}
        <span>Stage A: <strong style={mono}>{stageA.toFixed(2)}</strong> <span className="brief-muted">{'×'}0.4 = {(0.4 * stageA).toFixed(2)}</span></span>
        {/* eslint-disable-next-line local/no-inline-style -- mono var */}
        <span>Judge: <strong style={mono}>{judgeQ.toFixed(2)}</strong>{!judgeUsed && <span className="brief-muted"> (default)</span>} <span className="brief-muted">{'×'}0.6 = {(0.6 * judgeQ).toFixed(2)}</span></span>
        {/* eslint-disable-next-line local/no-inline-style -- mono spread + dynamic score color */}
        <span>Total: <strong style={{ ...mono, color: turnScoreColor(turnScore) }}>{turnScore.toFixed(2)}</strong></span>
      </div>
    </div>
  );
}

function SimpleValidationScore({ valData }: { valData: { pass: boolean; hints: string[] } | undefined }) {
  return (
    <div className="brief-valscore">
      Validation Score:{' '}
      {valData ? (
        // eslint-disable-next-line local/no-inline-style -- dynamic pass/fail color
        <span style={{ color: valData.pass ? 'var(--success)' : 'var(--danger)' }}>
          {valData.pass ? 'Pass' : 'Fail'}
        </span>
      ) : (
        <span className="brief-muted">{'—'}</span>
      )}
    </div>
  );
}

function ValidationScoreSection({ turnScore, dims, judgeUsed, valData }: {
  turnScore: number | undefined;
  dims: TurnValidationTrail['final']['dimensions'] | undefined;
  judgeUsed: boolean;
  valData: { pass: boolean; hints: string[] } | undefined;
}) {
  if (turnScore != null && dims) {
    return <DetailedValidationScore turnScore={turnScore} dims={dims} judgeUsed={judgeUsed} />;
  }
  return <SimpleValidationScore valData={valData} />;
}

// --- Per-turn attempt sections ---
function BriefAttemptsSection({ briefAttempts, turnValTrail }: {
  briefAttempts: any[];
  turnValTrail: TurnValidationTrail | undefined;
}) {
  if (!(briefAttempts.length > 0)) return null;
  return (
    <>
      {briefAttempts.map((attempt, ai) => {
        const isFinal = ai === briefAttempts.length - 1;
        const valData = (attempt as Record<string, unknown>).stage_validation as { pass: boolean; hints: string[] } | undefined;
        const hints = valData?.hints ?? [];
        const turnScore = isFinal ? turnValTrail?.final.process_reward : undefined;
        const dims = isFinal ? turnValTrail?.final.dimensions : undefined;
        const judgeUsed = isFinal ? turnValTrail?.final.judge_used ?? false : false;
        return (
          <div key={ai}>
            {/* Turn header */}
            <div className="brief-turn-header">
              <div className="brief-turn-rule" />
              <span>Turn {ai + 1}</span>
              <div className="brief-turn-rule" />
            </div>
            <ArtifactBlock label="Raw Prompt" text={attempt.prompt} />
            <ArtifactBlock label="Raw Response" text={attempt.raw_response} />
            {/* Validation Score */}
            <ValidationScoreSection turnScore={turnScore} dims={dims} judgeUsed={judgeUsed} valData={valData} />
            {/* Validation Feedback */}
            {hints.length > 0 && (
              <details open className="brief-feedback">
                <summary className="brief-feedback-summary">Validation Feedback</summary>
                <ul className="brief-feedback-list">
                  {hints.map((h, hi) => {
                    const target = classifyHintTarget(h);
                    const ts = HINT_TARGET_STYLE[target];
                    return (
                      <li key={hi} className="brief-mb3">
                        {/* eslint-disable-next-line local/no-inline-style -- dynamic hint-target color/bg */}
                        <span style={{
                          display: 'inline-block', fontSize: 'var(--text-2xs)', fontWeight: 700,
                          color: ts.color, background: ts.bg, padding: '1px 5px',
                          borderRadius: 3, marginRight: 5, verticalAlign: 'middle',
                        }}>{ts.label}</span>
                        {humanizeSpeakerIds(h)}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </div>
        );
      })}
    </>
  );
}

export interface BriefTabProps {
  entry: DebateSession['transcript'][number];
  briefStage: any;
  briefAttempts: any[];
  turnValTrail: TurnValidationTrail | undefined;
  nodeWeights: Map<string, { confidence?: number; priority?: number; operationality?: number; category?: string }>;
  taxNodeMap: Map<string, Record<string, unknown>>;
  allEdges: TaxRefEdge[];
  selectedTaxRefId: string | null;
  setSelectedTaxRefId: (id: string | null) => void;
}

export function BriefTab(props: BriefTabProps) {
  const { entry, briefStage, briefAttempts, turnValTrail, nodeWeights, taxNodeMap, allEdges, selectedTaxRefId, setSelectedTaxRefId } = props;
  // Shared renderer for POV grounding items — line 1: id + label + scores; line 2: justification/applicability.
  const renderGrounding = (grounding: { node_id: string; why: string }[], baseColor: string) => (
    <ul className="brief-grounding-list">
      {grounding.map((g, gi) => (
        <GroundingItem
          key={gi}
          g={g}
          baseColor={baseColor}
          entry={entry}
          nodeWeights={nodeWeights}
          taxNodeMap={taxNodeMap}
          selectedTaxRefId={selectedTaxRefId}
          setSelectedTaxRefId={setSelectedTaxRefId}
        />
      ))}
    </ul>
  );
  return (
    <div className="brief-container">
      {/* -- Top section: header + content from final brief -- */}
      <div className="brief-header">
        <span className="brief-badge">BRIEF</span>
        <span>{briefStage.model}</span>
        <span>temp={briefStage.temperature}</span>
        <span>{(briefStage.response_time_ms / 1000).toFixed(1)}s</span>
      </div>
      {briefStage.parse_error && (
        <div className="brief-parse-error">
          <strong>Parse error:</strong> {briefStage.parse_error}
        </div>
      )}
      {/* Moderator Directive (if present) */}
      {(() => {
        const wp = briefStage.work_product as Record<string, unknown>;
        const drp = wp.directive_response_plan as string | undefined;
        const dr = wp.directive_response as { directive: string; how_addressed: string } | undefined;
        if (!drp && !dr) return null;
        return (
          <div className="brief-directive">
            <div className="brief-directive-header">
              <span className="brief-directive-badge">MODERATOR DIRECTIVE</span>
            </div>
            {dr && (
              <>
                <div className="brief-mb4"><strong>Directive:</strong> <Highlight text={dr.directive} /></div>
                <div><strong>How addressed:</strong> <Highlight text={dr.how_addressed} /></div>
              </>
            )}
            {drp && !dr && <Highlight text={String(drp)} />}
          </div>
        );
      })()}
      {/* Core BRIEF statement (situation assessment) */}
      {!!(briefStage.work_product as Record<string, unknown>).situation_assessment && (
        <div className="brief-situation">
          <Highlight text={String((briefStage.work_product as Record<string, unknown>).situation_assessment)} />
        </div>
      )}
      {/* Key Claims to Address */}
      {Array.isArray((briefStage.work_product as Record<string, unknown>).key_claims_to_address) && (
        <details open><summary className="brief-summary">Key Claims to Address</summary>
          <ul className="brief-list">
            {((briefStage.work_product as Record<string, unknown>).key_claims_to_address as { claim: string; speaker: string; an_id?: string; grounding?: { node_id: string; why: string }[] }[]).map((c, i) => (
              <li key={i}>
                <strong>{c.speaker}</strong>{c.an_id ? ` (${c.an_id})` : ''}: <Highlight text={c.claim} />
                {Array.isArray(c.grounding) && c.grounding.length > 0 && renderGrounding(c.grounding, 'var(--focus-ring)')}
              </li>
            ))}
          </ul>
        </details>
      )}
      {/* Strongest Angles */}
      {Array.isArray((briefStage.work_product as Record<string, unknown>).strongest_angles) && (
        <details open><summary className="brief-summary">Strongest Angles</summary>
          <ul className="brief-list">
            {((briefStage.work_product as Record<string, unknown>).strongest_angles as { angle: string; why: string; grounding?: { node_id: string; why: string }[] }[]).map((a, i) => (
              <li key={i}>
                <strong>{a.angle}</strong>: <Highlight text={a.why} />
                {Array.isArray(a.grounding) && a.grounding.length > 0 && renderGrounding(a.grounding, 'var(--focus-ring)')}
              </li>
            ))}
          </ul>
        </details>
      )}
      {/* Edge Tensions */}
      {Array.isArray((briefStage.work_product as Record<string, unknown>).edge_tensions) && ((briefStage.work_product as Record<string, unknown>).edge_tensions as { edge: string; relevance: string }[]).length > 0 && (
        <details open><summary className="brief-summary">Edge Tensions</summary>
          <ul className="brief-list">
            {((briefStage.work_product as Record<string, unknown>).edge_tensions as { edge: string; relevance: string }[]).map((t, i) => (
              <li key={i}><strong>{t.edge}</strong>: <Highlight text={t.relevance} /></li>
            ))}
          </ul>
        </details>
      )}
      {/* Key Tensions */}
      {Array.isArray((briefStage.work_product as Record<string, unknown>).key_tensions) && ((briefStage.work_product as Record<string, unknown>).key_tensions as { tension: string; opportunity: string }[]).length > 0 && (
        <details open><summary className="brief-summary">Key Tensions</summary>
          <ul className="brief-list">
            {((briefStage.work_product as Record<string, unknown>).key_tensions as { tension: string; opportunity: string }[]).map((t, i) => (
              <li key={i}><strong>{t.tension}</strong>: <Highlight text={t.opportunity} /></li>
            ))}
          </ul>
        </details>
      )}
      {/* Document Claims to Engage */}
      <DocumentClaimsSection workProduct={briefStage.work_product as Record<string, unknown>} renderGrounding={renderGrounding} />
      {/* Relevant Taxonomy Nodes (old schema fallback) */}
      {Array.isArray((briefStage.work_product as Record<string, unknown>).relevant_taxonomy_nodes) && !(() => {
        const wp = briefStage.work_product as Record<string, unknown>;
        const hasNested = (arr: unknown) => Array.isArray(arr) && (arr as { grounding?: unknown[] }[]).some(x => Array.isArray(x.grounding) && x.grounding.length > 0);
        return hasNested(wp.key_claims_to_address) || hasNested(wp.strongest_angles) || hasNested(wp.document_claims_to_engage);
      })() && (
        <details open><summary className="brief-summary">Relevant Taxonomy Nodes</summary>
          <table className="brief-table">
            <tbody>
              {((briefStage.work_product as Record<string, unknown>).relevant_taxonomy_nodes as { node_id: string; why: string }[]).map((n, i) => {
                const isSelected = selectedTaxRefId === n.node_id;
                const matchedRef = entry.taxonomy_refs?.find(r => r.node_id === n.node_id);
                const briefScore = matchedRef?.relevance_score;
                const briefScoreColor = briefScore == null ? 'var(--text-muted)'
                  : briefScore >= 0.45 ? 'var(--success)'
                  : briefScore >= 0.30 ? 'var(--warning)'
                  : 'var(--danger)';
                return (
                  // eslint-disable-next-line local/no-inline-style -- dynamic selected background
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-color)', background: isSelected ? 'color-mix(in srgb, var(--warning) 8%, transparent)' : 'transparent' }}>
                    <td className="brief-td-nowrap">
                      <button
                        onClick={() => setSelectedTaxRefId(isSelected ? null : n.node_id)}
                        // eslint-disable-next-line local/no-inline-style -- dynamic fontWeight when selected
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--focus-ring)', fontWeight: isSelected ? 700 : 600, textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'inherit', textAlign: 'left' }}
                        title="Show node details"
                      >{n.node_id}</button>
                    </td>
                    {/* eslint-disable-next-line local/no-inline-style -- dynamic briefScoreColor */}
                    <td style={{ padding: '3px 6px', verticalAlign: 'top', textAlign: 'center', fontWeight: 600, color: briefScoreColor, fontFamily: 'monospace', width: '40px' }}>
                      {briefScore != null ? briefScore.toFixed(2) : '—'}
                    </td>
                    <td className="brief-td"><Highlight text={n.why} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}
      {/* Phase Considerations */}
      {!!(briefStage.work_product as Record<string, unknown>).phase_considerations && (
        <div className="brief-phase">
          <Highlight text={String((briefStage.work_product as Record<string, unknown>).phase_considerations)} />
        </div>
      )}
      {/* -- Per-turn sections -- */}
      <BriefAttemptsSection briefAttempts={briefAttempts} turnValTrail={turnValTrail} />
      {/* TaxonomyRefDetail */}
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
  );
}
