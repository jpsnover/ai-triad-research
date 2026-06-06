// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React, { Fragment } from 'react';
import type { DebateSession, TurnValidationTrail } from '../../../../types/debate';
import { humanizeSpeakerIds } from '../../../../utils/humanizeSpeakers';
import { Highlight, CopyButton } from '../helpers';
import { classifyHintTarget, HINT_TARGET_STYLE } from '../shared';
import { TaxonomyRefDetail, type TaxRefNode, type TaxRefEdge } from '../../../TaxonomyRefDetail';

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
  return (
    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
      {/* -- Top section: header + content from final brief -- */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(59,130,246,0.2)', color: '#3b82f6', fontWeight: 600 }}>BRIEF</span>
        <span>{briefStage.model}</span>
        <span>temp={briefStage.temperature}</span>
        <span>{(briefStage.response_time_ms / 1000).toFixed(1)}s</span>
      </div>
      {briefStage.parse_error && (
        <div style={{ padding: '6px 8px', margin: '6px 0', background: 'rgba(220,38,38,0.1)', borderLeft: '3px solid #dc2626', borderRadius: 4, fontSize: '0.72rem', color: '#dc2626' }}>
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
          <div style={{ padding: 8, margin: '6px 0', borderLeft: '3px solid rgba(245,158,11,0.6)', background: 'rgba(245,158,11,0.08)', borderRadius: 4, fontSize: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(245,158,11,0.2)', color: '#d97706', fontWeight: 600, fontSize: '0.68rem' }}>MODERATOR DIRECTIVE</span>
            </div>
            {dr && (
              <>
                <div style={{ marginBottom: 4 }}><strong>Directive:</strong> <Highlight text={dr.directive} /></div>
                <div><strong>How addressed:</strong> <Highlight text={dr.how_addressed} /></div>
              </>
            )}
            {drp && !dr && <Highlight text={String(drp)} />}
          </div>
        );
      })()}
      {/* Core BRIEF statement (situation assessment) */}
      {!!(briefStage.work_product as Record<string, unknown>).situation_assessment && (
        <div style={{ padding: 8, margin: '6px 0', borderLeft: '3px solid rgba(59,130,246,0.4)', background: 'rgba(59,130,246,0.05)', fontSize: '0.78rem' }}>
          <Highlight text={String((briefStage.work_product as Record<string, unknown>).situation_assessment)} />
        </div>
      )}
      {/* Key Claims to Address */}
      {Array.isArray((briefStage.work_product as Record<string, unknown>).key_claims_to_address) && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Key Claims to Address</summary>
          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
            {((briefStage.work_product as Record<string, unknown>).key_claims_to_address as { claim: string; speaker: string; an_id?: string; grounding?: { node_id: string; why: string }[] }[]).map((c, i) => (
              <li key={i}>
                <strong>{c.speaker}</strong>{c.an_id ? ` (${c.an_id})` : ''}: <Highlight text={c.claim} />
                {Array.isArray(c.grounding) && c.grounding.length > 0 && (
                  <ul style={{ margin: '2px 0 4px', paddingLeft: 14, listStyle: 'none' }}>
                    {c.grounding.map((g, gi) => {
                      const ref = entry.taxonomy_refs?.find(r => r.node_id === g.node_id);
                      const sc = ref?.relevance_score;
                      const scColor = sc == null ? 'var(--text-muted)' : sc >= 0.45 ? '#16a34a' : sc >= 0.30 ? '#d97706' : '#dc2626';
                      const tw = nodeWeights.get(g.node_id);
                      const conf = (g as Record<string, unknown>).confidence as number | undefined ?? tw?.confidence;
                      const prio = (g as Record<string, unknown>).priority as number | undefined ?? tw?.priority;
                      const oper = (g as Record<string, unknown>).operationality as number | undefined ?? tw?.operationality;
                      return (
                        <li key={gi} style={{ fontSize: '0.65rem', color: 'var(--accent)' }}>
                          <button onClick={() => setSelectedTaxRefId(selectedTaxRefId === g.node_id ? null : g.node_id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'inherit' }}>{g.node_id}</button>
                          {sc != null && <span style={{ fontWeight: 600, color: scColor, marginLeft: 4 }}>{sc.toFixed(2)}</span>}
                          {conf != null && <span style={{ marginLeft: 4, fontWeight: 600, color: conf >= 0.70 ? '#16a34a' : conf >= 0.50 ? '#2563eb' : '#d97706', background: conf < 0.50 ? '#fef3c7' : undefined, padding: conf < 0.50 ? '0 3px' : undefined, borderRadius: 2 }}>conf:{conf.toFixed(2)}</span>}
                          {prio != null && <span style={{ marginLeft: 4, fontWeight: 600, color: prio >= 4 ? '#7c3aed' : '#6b7280' }}>P{prio}/5</span>}
                          {oper != null && <span style={{ marginLeft: 4, fontWeight: 600, color: oper >= 4 ? '#0d9488' : '#6b7280' }}>op:{oper}/5</span>}
                          {g.why && <span style={{ marginLeft: 4 }}>{g.why}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {/* Strongest Angles */}
      {Array.isArray((briefStage.work_product as Record<string, unknown>).strongest_angles) && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Strongest Angles</summary>
          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
            {((briefStage.work_product as Record<string, unknown>).strongest_angles as { angle: string; why: string; grounding?: { node_id: string; why: string }[] }[]).map((a, i) => (
              <li key={i}>
                <strong>{a.angle}</strong>: <Highlight text={a.why} />
                {Array.isArray(a.grounding) && a.grounding.length > 0 && (
                  <ul style={{ margin: '2px 0 4px', paddingLeft: 14, listStyle: 'none' }}>
                    {a.grounding.map((g, gi) => {
                      const ref = entry.taxonomy_refs?.find(r => r.node_id === g.node_id);
                      const sc = ref?.relevance_score;
                      const scColor = sc == null ? 'var(--text-muted)' : sc >= 0.45 ? '#16a34a' : sc >= 0.30 ? '#d97706' : '#dc2626';
                      const tw = nodeWeights.get(g.node_id);
                      const conf = (g as Record<string, unknown>).confidence as number | undefined ?? tw?.confidence;
                      const prio = (g as Record<string, unknown>).priority as number | undefined ?? tw?.priority;
                      const oper = (g as Record<string, unknown>).operationality as number | undefined ?? tw?.operationality;
                      return (
                        <li key={gi} style={{ fontSize: '0.65rem', color: 'var(--accent)' }}>
                          <button onClick={() => setSelectedTaxRefId(selectedTaxRefId === g.node_id ? null : g.node_id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'inherit' }}>{g.node_id}</button>
                          {sc != null && <span style={{ fontWeight: 600, color: scColor, marginLeft: 4 }}>{sc.toFixed(2)}</span>}
                          {conf != null && <span style={{ marginLeft: 4, fontWeight: 600, color: conf >= 0.70 ? '#16a34a' : conf >= 0.50 ? '#2563eb' : '#d97706', background: conf < 0.50 ? '#fef3c7' : undefined, padding: conf < 0.50 ? '0 3px' : undefined, borderRadius: 2 }}>conf:{conf.toFixed(2)}</span>}
                          {prio != null && <span style={{ marginLeft: 4, fontWeight: 600, color: prio >= 4 ? '#7c3aed' : '#6b7280' }}>P{prio}/5</span>}
                          {oper != null && <span style={{ marginLeft: 4, fontWeight: 600, color: oper >= 4 ? '#0d9488' : '#6b7280' }}>op:{oper}/5</span>}
                          {g.why && <span style={{ marginLeft: 4 }}>{g.why}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {/* Edge Tensions */}
      {Array.isArray((briefStage.work_product as Record<string, unknown>).edge_tensions) && ((briefStage.work_product as Record<string, unknown>).edge_tensions as { edge: string; relevance: string }[]).length > 0 && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Edge Tensions</summary>
          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
            {((briefStage.work_product as Record<string, unknown>).edge_tensions as { edge: string; relevance: string }[]).map((t, i) => (
              <li key={i}><strong>{t.edge}</strong>: <Highlight text={t.relevance} /></li>
            ))}
          </ul>
        </details>
      )}
      {/* Key Tensions */}
      {Array.isArray((briefStage.work_product as Record<string, unknown>).key_tensions) && ((briefStage.work_product as Record<string, unknown>).key_tensions as { tension: string; opportunity: string }[]).length > 0 && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Key Tensions</summary>
          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
            {((briefStage.work_product as Record<string, unknown>).key_tensions as { tension: string; opportunity: string }[]).map((t, i) => (
              <li key={i}><strong>{t.tension}</strong>: <Highlight text={t.opportunity} /></li>
            ))}
          </ul>
        </details>
      )}
      {/* Document Claims to Engage */}
      {Array.isArray((briefStage.work_product as Record<string, unknown>).document_claims_to_engage) && ((briefStage.work_product as Record<string, unknown>).document_claims_to_engage as { d_id: string; claim: string; stance: string; why: string; grounding?: { node_id: string; why: string }[] }[]).length > 0 && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Document Claims to Engage</summary>
          <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                <th style={{ padding: '3px 6px', fontWeight: 600, color: 'var(--text-muted)', width: '60px' }}>D-ID</th>
                <th style={{ padding: '3px 6px', fontWeight: 600, color: 'var(--text-muted)', width: '70px' }}>Stance</th>
                <th style={{ padding: '3px 6px', fontWeight: 600, color: 'var(--text-muted)' }}>Claim &amp; Rationale</th>
              </tr>
            </thead>
            <tbody>
              {((briefStage.work_product as Record<string, unknown>).document_claims_to_engage as { d_id: string; claim: string; stance: string; why: string; grounding?: { node_id: string; why: string }[] }[]).map((dc, i) => {
                const stanceColor = dc.stance === 'accept' ? '#16a34a' : dc.stance === 'challenge' ? '#dc2626' : '#d97706';
                return (
                  <Fragment key={i}>
                    <tr style={{ borderBottom: Array.isArray(dc.grounding) && dc.grounding.length > 0 ? 'none' : '1px solid var(--border)' }}>
                      <td style={{ padding: '3px 6px', verticalAlign: 'top', fontFamily: 'monospace', fontWeight: 600, color: 'var(--accent)' }}>{dc.d_id}</td>
                      <td style={{ padding: '3px 6px', verticalAlign: 'top', fontWeight: 600, color: stanceColor, textTransform: 'uppercase', fontSize: '0.65rem' }}>{dc.stance}</td>
                      <td style={{ padding: '3px 6px', verticalAlign: 'top' }}>
                        <Highlight text={dc.claim} />
                        <div style={{ marginTop: 2, color: 'var(--text-muted)', fontSize: '0.65rem' }}><Highlight text={dc.why} /></div>
                      </td>
                    </tr>
                    {Array.isArray(dc.grounding) && dc.grounding.length > 0 && (
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <td colSpan={3} style={{ padding: '0 6px 3px 20px' }}>
                          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                            {dc.grounding.map((g, gi) => {
                              const ref = entry.taxonomy_refs?.find(r => r.node_id === g.node_id);
                              const sc = ref?.relevance_score;
                              const scColor = sc == null ? 'var(--text-muted)' : sc >= 0.45 ? '#16a34a' : sc >= 0.30 ? '#d97706' : '#dc2626';
                              const tw = nodeWeights.get(g.node_id);
                              const conf = (g as Record<string, unknown>).confidence as number | undefined ?? tw?.confidence;
                              const prio = (g as Record<string, unknown>).priority as number | undefined ?? tw?.priority;
                              const oper = (g as Record<string, unknown>).operationality as number | undefined ?? tw?.operationality;
                              return (
                                <li key={gi} style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                  <button onClick={() => setSelectedTaxRefId(selectedTaxRefId === g.node_id ? null : g.node_id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'inherit' }}>{g.node_id}</button>
                                  {sc != null && <span style={{ fontWeight: 600, color: scColor, marginLeft: 4 }}>{sc.toFixed(2)}</span>}
                                  {conf != null && <span style={{ marginLeft: 4, fontWeight: 600, color: conf >= 0.70 ? '#16a34a' : conf >= 0.50 ? '#2563eb' : '#d97706', background: conf < 0.50 ? '#fef3c7' : undefined, padding: conf < 0.50 ? '0 3px' : undefined, borderRadius: 2 }}>conf:{conf.toFixed(2)}</span>}
                                  {prio != null && <span style={{ marginLeft: 4, fontWeight: 600, color: prio >= 4 ? '#7c3aed' : '#6b7280' }}>P{prio}/5</span>}
                                  {oper != null && <span style={{ marginLeft: 4, fontWeight: 600, color: oper >= 4 ? '#0d9488' : '#6b7280' }}>op:{oper}/5</span>}
                                  {g.why && <span style={{ marginLeft: 4 }}>{g.why}</span>}
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </details>
      )}
      {/* Relevant Taxonomy Nodes (old schema fallback) */}
      {Array.isArray((briefStage.work_product as Record<string, unknown>).relevant_taxonomy_nodes) && !(() => {
        const wp = briefStage.work_product as Record<string, unknown>;
        const hasNested = (arr: unknown) => Array.isArray(arr) && (arr as { grounding?: unknown[] }[]).some(x => Array.isArray(x.grounding) && x.grounding.length > 0);
        return hasNested(wp.key_claims_to_address) || hasNested(wp.strongest_angles) || hasNested(wp.document_claims_to_engage);
      })() && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Relevant Taxonomy Nodes</summary>
          <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse' }}>
            <tbody>
              {((briefStage.work_product as Record<string, unknown>).relevant_taxonomy_nodes as { node_id: string; why: string }[]).map((n, i) => {
                const isSelected = selectedTaxRefId === n.node_id;
                const matchedRef = entry.taxonomy_refs?.find(r => r.node_id === n.node_id);
                const briefScore = matchedRef?.relevance_score;
                const briefScoreColor = briefScore == null ? 'var(--text-muted)'
                  : briefScore >= 0.45 ? '#16a34a'
                  : briefScore >= 0.30 ? '#d97706'
                  : '#dc2626';
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: isSelected ? 'rgba(245, 158, 11, 0.08)' : 'transparent' }}>
                    <td style={{ padding: '3px 6px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      <button
                        onClick={() => setSelectedTaxRefId(isSelected ? null : n.node_id)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontWeight: isSelected ? 700 : 600, textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'inherit', textAlign: 'left' }}
                        title="Show node details"
                      >{n.node_id}</button>
                    </td>
                    <td style={{ padding: '3px 6px', verticalAlign: 'top', textAlign: 'center', fontWeight: 600, color: briefScoreColor, fontFamily: 'monospace', width: '40px' }}>
                      {briefScore != null ? briefScore.toFixed(2) : '—'}
                    </td>
                    <td style={{ padding: '3px 6px', verticalAlign: 'top' }}><Highlight text={n.why} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}
      {/* Phase Considerations */}
      {!!(briefStage.work_product as Record<string, unknown>).phase_considerations && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>
          <Highlight text={String((briefStage.work_product as Record<string, unknown>).phase_considerations)} />
        </div>
      )}
      {/* -- Per-turn sections -- */}
      {briefAttempts.length > 0 && briefAttempts.map((attempt, ai) => {
        const isFinal = ai === briefAttempts.length - 1;
        const valData = (attempt as Record<string, unknown>).stage_validation as { pass: boolean; hints: string[] } | undefined;
        const hints = valData?.hints ?? [];
        const turnScore = isFinal ? turnValTrail?.final.process_reward : undefined;
        const dims = isFinal ? turnValTrail?.final.dimensions : undefined;
        const judgeUsed = isFinal ? turnValTrail?.final.judge_used ?? false : false;
        return (
          <div key={ai}>
            {/* Turn header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 6px',
              fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600,
            }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span>Turn {ai + 1}</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
            {/* Raw Prompt */}
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                Raw Prompt <CopyButton text={attempt.prompt} />
              </summary>
              <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{attempt.prompt}</pre>
            </details>
            {/* Raw Response */}
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                Raw Response <CopyButton text={attempt.raw_response} />
              </summary>
              <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{attempt.raw_response}</pre>
            </details>
            {/* Validation Score */}
            {(() => {
              if (turnScore != null && dims) {
                const stageA =
                  0.4 * (dims.schema.pass ? 1 : 0) +
                  0.3 * (dims.grounding.pass ? 1 : 0) +
                  0.2 * (dims.advancement.pass ? 1 : 0) +
                  0.1 * (dims.clarifies.pass ? 1 : 0);
                const judgeQ = stageA > 0
                  ? Math.max(0, Math.min(1, (turnScore - 0.4 * stageA) / 0.6))
                  : 0.7;
                const mono = { fontFamily: 'monospace', fontSize: '0.68rem' } as const;
                const dimColor = (pass: boolean) => pass ? '#16a34a' : '#dc2626';
                return (
                  <div style={{
                    marginTop: 6, background: 'var(--bg-subtle)', borderRadius: 4,
                    padding: '5px 8px', fontSize: '0.7rem',
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      Validation Score:{' '}
                      <span style={{ ...mono, color: turnScore >= 0.7 ? '#16a34a' : turnScore >= 0.5 ? '#d97706' : '#dc2626' }}>
                        {turnScore.toFixed(2)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: '0.66rem' }}>
                      <span><span style={{ color: dimColor(dims.schema.pass) }}>{'●'}</span> schema {'×'}0.4 = <strong style={mono}>{(0.4 * (dims.schema.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      <span><span style={{ color: dimColor(dims.grounding.pass) }}>{'●'}</span> grounding {'×'}0.3 = <strong style={mono}>{(0.3 * (dims.grounding.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      <span><span style={{ color: dimColor(dims.advancement.pass) }}>{'●'}</span> advancement {'×'}0.2 = <strong style={mono}>{(0.2 * (dims.advancement.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      <span><span style={{ color: dimColor(dims.clarifies.pass) }}>{'●'}</span> clarifies {'×'}0.1 = <strong style={mono}>{(0.1 * (dims.clarifies.pass ? 1 : 0)).toFixed(2)}</strong></span>
                    </div>
                    <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 3, fontSize: '0.66rem', display: 'flex', gap: 12 }}>
                      <span>Stage A: <strong style={mono}>{stageA.toFixed(2)}</strong> <span style={{ color: 'var(--text-muted)' }}>{'×'}0.4 = {(0.4 * stageA).toFixed(2)}</span></span>
                      <span>Judge: <strong style={mono}>{judgeQ.toFixed(2)}</strong>{!judgeUsed && <span style={{ color: 'var(--text-muted)' }}> (default)</span>} <span style={{ color: 'var(--text-muted)' }}>{'×'}0.6 = {(0.6 * judgeQ).toFixed(2)}</span></span>
                      <span>Total: <strong style={{ ...mono, color: turnScore >= 0.7 ? '#16a34a' : turnScore >= 0.5 ? '#d97706' : '#dc2626' }}>{turnScore.toFixed(2)}</strong></span>
                    </div>
                  </div>
                );
              }
              return (
                <div style={{ marginTop: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                  Validation Score:{' '}
                  {valData ? (
                    <span style={{ color: valData.pass ? '#16a34a' : '#dc2626' }}>
                      {valData.pass ? 'Pass' : 'Fail'}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>{'—'}</span>
                  )}
                </div>
              );
            })()}
            {/* Validation Feedback */}
            {hints.length > 0 && (
              <details open style={{ marginTop: 4, fontSize: '0.72rem' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Validation Feedback</summary>
                <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: '0.7rem' }}>
                  {hints.map((h, hi) => {
                    const target = classifyHintTarget(h);
                    const ts = HINT_TARGET_STYLE[target];
                    return (
                      <li key={hi} style={{ marginBottom: 3 }}>
                        <span style={{
                          display: 'inline-block', fontSize: '0.6rem', fontWeight: 700,
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
