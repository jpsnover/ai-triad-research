// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import type { DebateSession, TurnValidationTrail } from '../../../../types/debate';
import { humanizeSpeakerIds } from '../../../../utils/humanizeSpeakers';
import { TaxonomyRefDetail, type TaxRefNode, type TaxRefEdge } from '../../../taxonomy/TaxonomyRefDetail';
import { Highlight, CopyButton } from '../helpers';
import { classifyHintTarget, HINT_TARGET_STYLE } from '../shared';
import './CiteTab.css';

export interface CiteTabProps {
  entry: DebateSession['transcript'][number];
  debate: DebateSession;
  citeStage: any;
  citeAttempts: any[];
  briefStage: any;
  turnValTrail: TurnValidationTrail | undefined;
  taxNodeMap: Map<string, Record<string, unknown>>;
  allEdges: TaxRefEdge[];
  policyMap: Map<string, { id: string; action: string; source_povs: string[]; member_count: number }>;
  selectedTaxRefId: string | null;
  setSelectedTaxRefId: (id: string | null) => void;
  selectedPolicyId: string | null;
  setSelectedPolicyId: (id: string | null) => void;
}

export function CiteTab(props: CiteTabProps) {
  const { entry, debate, citeStage, citeAttempts, briefStage, turnValTrail, taxNodeMap, allEdges, policyMap, selectedTaxRefId, setSelectedTaxRefId, selectedPolicyId, setSelectedPolicyId } = props;
  return (
    <div className="cit-root">
      {/* -- Top section: header + content from final cite -- */}
      <div className="cit-header">
        <span className="cit-badge">CITE</span>
        <span>{citeStage.model}</span>
        <span>temp={citeStage.temperature}</span>
        <span>{(citeStage.response_time_ms / 1000).toFixed(1)}s</span>
        {typeof (citeStage.work_product as Record<string, unknown>).grounding_confidence === 'number' && (
          // eslint-disable-next-line local/no-inline-style -- confidence-threshold-driven background
          <span style={{ padding: '1px 6px', borderRadius: 3, background: (citeStage.work_product as Record<string, unknown>).grounding_confidence as number >= 0.7 ? 'color-mix(in srgb, var(--success) 20%, transparent)' : 'color-mix(in srgb, var(--warning) 20%, transparent)', fontSize: 'var(--text-2xs)' }}>
            confidence: {((citeStage.work_product as Record<string, unknown>).grounding_confidence as number).toFixed(2)}
          </span>
        )}
      </div>
      {citeStage.parse_error && (
        <div className="cit-parse-error">
          <strong>Parse error:</strong> {citeStage.parse_error}
        </div>
      )}
      {/* Moderator Directive (if present) */}
      {(() => {
        const wp = citeStage.work_product as Record<string, unknown>;
        const drp = wp.directive_response_plan as string | undefined;
        const dr = wp.directive_response as { directive: string; how_addressed: string } | undefined;
        if (!drp && !dr) return null;
        return (
          <div className="cit-directive">
            <div className="cit-directive-head">
              <span className="cit-badge-2xs">MODERATOR DIRECTIVE</span>
            </div>
            {dr && (
              <>
                <div className="cit-mb4"><strong>Directive:</strong> <Highlight text={dr.directive} /></div>
                <div><strong>How addressed:</strong> <Highlight text={dr.how_addressed} /></div>
              </>
            )}
            {drp && !dr && <Highlight text={String(drp)} />}
          </div>
        );
      })()}
      {/* Taxonomy References */}
      {Array.isArray((citeStage.work_product as Record<string, unknown>).taxonomy_refs) && (() => {
        const citeManifest = (entry.metadata as Record<string, unknown>)?.injection_manifest as {
          lineage_boost?: { boostedNodeIds?: string[]; promotedNodeIds?: string[]; traditions?: string[] };
        } | undefined;
        const lb = citeManifest?.lineage_boost;
        const boostedSet = new Set(lb?.boostedNodeIds ?? []);
        const promotedSet = new Set(lb?.promotedNodeIds ?? []);
        const boostTraditions = lb?.traditions
          ?? debate.topic.critique?.lineage_frame?.flatMap((f: { traditions?: string[] }) => f.traditions ?? [])
          ?? [];
        const frameLabels = debate.topic.critique?.lineage_frame?.map((f: { label: string }) => f.label) ?? boostTraditions;
        const briefNodes = new Set((() => {
          const wp = briefStage?.work_product as Record<string, unknown> | undefined;
          if (!wp) return [] as string[];
          const fromGrounding = (arr: unknown): string[] => {
            if (!Array.isArray(arr)) return [];
            return (arr as { grounding?: { node_id: string }[] }[]).flatMap(x => Array.isArray(x.grounding) ? x.grounding.map(g => g.node_id) : []);
          };
          const nested = [
            ...fromGrounding(wp.key_claims_to_address),
            ...fromGrounding(wp.strongest_angles),
            ...fromGrounding(wp.document_claims_to_engage),
          ];
          if (nested.length > 0) return nested;
          return Array.isArray(wp.relevant_taxonomy_nodes)
            ? (wp.relevant_taxonomy_nodes as { node_id: string }[]).map(n => n.node_id)
            : [];
        })());
        return (
        <details open><summary className="cit-summary">
          Taxonomy References
          {boostedSet.size > 0 && (
            <span className="cit-boost-note">
              {boostedSet.size} lineage-boosted{promotedSet.size > 0 ? `, ${promotedSet.size} promoted` : ''}
              {frameLabels.length > 0 && <> · {frameLabels.join(', ')}</>}
            </span>
          )}
        </summary>
          <table className="cit-table">
            <colgroup>
              <col className="cit-col-180" />
              <col />
            </colgroup>
            <tbody>
              {((citeStage.work_product as Record<string, unknown>).taxonomy_refs as { node_id: string; relevance: string; relevance_score?: number; primary?: boolean }[]).map((r, i) => {
                const isSelected = selectedTaxRefId === r.node_id;
                const isNew = !briefNodes.has(r.node_id);
                const nodeLabel = (taxNodeMap.get(r.node_id) as TaxRefNode | undefined)?.label;
                return (
                  // eslint-disable-next-line local/no-inline-style -- selection-driven background
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: isSelected ? 'color-mix(in srgb, var(--warning) 8%, transparent)' : 'transparent' }}>
                    <td className="cit-td-node">
                      <div>
                        <button
                          onClick={() => setSelectedTaxRefId(isSelected ? null : r.node_id)}
                          // eslint-disable-next-line local/no-inline-style -- selection-driven fontWeight
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontWeight: isSelected ? 700 : 600, textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'inherit', textAlign: 'left' }}
                          title="Show node details"
                        >{r.primary ? '★ ' : ''}{r.node_id}</button>
                        {isNew && (
                          <span title="New: not in Brief's relevant taxonomy nodes" className="cit-new-badge">+</span>
                        )}
                        {promotedSet.has(r.node_id) ? (
                          <span
                            title={`Promoted into context by lineage boost — would not appear without boost${boostTraditions.length > 0 ? ` (${boostTraditions.join(', ')})` : ''}`}
                            className="cit-promoted-badge"
                          >L{'↑'}</span>
                        ) : boostedSet.has(r.node_id) ? (
                          <span
                            title={`Relevance score boosted by lineage matching${boostTraditions.length > 0 ? ` (${boostTraditions.join(', ')})` : ''}`}
                            className="cit-boosted-badge"
                          >L</span>
                        ) : null}
                      </div>
                      {nodeLabel && (
                        <div className="cit-node-label" title={nodeLabel}>
                          {nodeLabel}
                        </div>
                      )}
                    </td>
                    <td className="cit-td-top"><Highlight text={r.relevance} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {selectedTaxRefId && ((citeStage.work_product as Record<string, unknown>).taxonomy_refs as { node_id: string }[]).some(r => r.node_id === selectedTaxRefId) && (() => {
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
        </details>
        );
      })()}
      {/* Move Annotations */}
      {Array.isArray((citeStage.work_product as Record<string, unknown>).move_annotations) && (
        <details open><summary className="cit-summary">Move Annotations</summary>
          {((citeStage.work_product as Record<string, unknown>).move_annotations as { move: string; target?: string; detail: string }[]).map((m, i) => (
            <div key={i} className="cit-move-row">
              <span className="cit-move-badge">{m.move}</span>
              {m.target && <span className="cit-move-target">{'→'} {m.target}</span>}
              {m.detail && <div className="cit-move-detail"><Highlight text={m.detail} /></div>}
            </div>
          ))}
        </details>
      )}
      {/* Policy References */}
      {(() => {
        const rawCitePolRefs = (citeStage.work_product as Record<string, unknown>).policy_refs;
        if (!Array.isArray(rawCitePolRefs) || rawCitePolRefs.length === 0) return null;
        const citePolIds = (rawCitePolRefs as (string | { policy_id: string; relevance?: string })[]).map(p => typeof p === 'string' ? p : p.policy_id);
        return (
        <details open><summary className="cit-summary">Policy References</summary>
          <table className="cit-table">
            <colgroup>
              <col className="cit-col-120" />
              <col />
            </colgroup>
            <tbody>
              {citePolIds.map((p, i) => {
                const isSelected = selectedPolicyId === p;
                const pol = policyMap.get(p);
                return (
                  // eslint-disable-next-line local/no-inline-style -- selection-driven background
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: isSelected ? 'color-mix(in srgb, var(--text-secondary) 8%, transparent)' : 'transparent' }}>
                    <td className="cit-td-pol">
                      <button
                        onClick={() => setSelectedPolicyId(isSelected ? null : p)}
                        // eslint-disable-next-line local/no-inline-style -- selection-driven fontWeight
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: isSelected ? 700 : 600, textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'inherit', textAlign: 'left' }}
                        title="Show policy details"
                      >{p}</button>
                    </td>
                    <td className="cit-td-action">
                      {pol?.action ?? <span className="cit-muted-italic">{'—'}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {selectedPolicyId && (() => {
            const pol = policyMap.get(selectedPolicyId);
            return (
              <div className="cit-pol-detail">
                <div className="cit-pol-detail-head">
                  <span className="cit-pol-id">{selectedPolicyId}</span>
                  <button onClick={() => setSelectedPolicyId(null)} className="cit-close-btn">{'×'}</button>
                </div>
                {pol ? (<>
                  <div className="cit-pol-action">{pol.action}</div>
                  <div className="cit-2xs-muted">
                    POVs: {pol.source_povs.join(', ')} · {pol.member_count} member{pol.member_count !== 1 ? 's' : ''}
                  </div>
                </>) : (
                  <div className="cit-notfound">Policy not found in registry</div>
                )}
              </div>
            );
          })()}
        </details>
        );
      })()}
      {/* Intellectual Lineage */}
      {(() => {
        const frame = debate.topic.critique?.lineage_frame;
        if (!frame || frame.length === 0) return null;
        const lbManifest = (entry.metadata as Record<string, unknown>)?.injection_manifest as {
          lineage_boost?: { boosted?: number; promoted?: number; promotedNodeIds?: string[] };
        } | undefined;
        const lb = lbManifest?.lineage_boost;
        return (
          <details open><summary className="cit-summary">
            Intellectual Lineage ({frame.length})
            {lb && <span className="cit-boost-active">boost active</span>}
          </summary>
            {frame.map((f: { cluster_id: string; label?: string; percentage: number; traditions?: string[] }, i: number) => (
              <div key={i} className="cit-move-row">
                <div className="cit-flex-gap6">
                  <span className="cit-frame-label">{f.label ?? f.cluster_id}</span>
                  <span className="cit-pct">{(f.percentage * 100).toFixed(0)}%</span>
                </div>
                {f.traditions && f.traditions.length > 0 && (
                  <div className="cit-traditions">
                    {f.traditions.join(', ')}
                  </div>
                )}
              </div>
            ))}
            {lb && (
              <div className="cit-boost-summary">
                Boosted: {lb.boosted ?? 0} nodes · Promoted: {lb.promoted ?? 0} nodes
              </div>
            )}
          </details>
        );
      })()}
      {/* -- Per-turn sections -- */}
      {citeAttempts.length > 0 && citeAttempts.map((attempt, ai) => {
        const isFinal = ai === citeAttempts.length - 1;
        const valData = (attempt as Record<string, unknown>).stage_validation as { pass: boolean; hints: string[] } | undefined;
        const hints = valData?.hints ?? [];
        const turnScore = isFinal ? turnValTrail?.final.process_reward : undefined;
        const dims = isFinal ? turnValTrail?.final.dimensions : undefined;
        const judgeUsed = isFinal ? turnValTrail?.final.judge_used ?? false : false;
        return (
          <div key={ai}>
            {/* Turn header */}
            <div className="cit-turn-header">
              <div className="cit-hr-line" />
              <span>Turn {ai + 1}</span>
              <div className="cit-hr-line" />
            </div>
            {/* Raw Prompt */}
            <details>
              <summary className="cit-raw-summary">
                Raw Prompt <CopyButton text={attempt.prompt} />
              </summary>
              <pre className="cit-raw-pre">{attempt.prompt}</pre>
            </details>
            {/* Raw Response */}
            <details>
              <summary className="cit-raw-summary">
                Raw Response <CopyButton text={attempt.raw_response} />
              </summary>
              <pre className="cit-raw-pre">{attempt.raw_response}</pre>
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
                const mono = { fontFamily: 'monospace', fontSize: 'var(--text-2xs)' } as const;
                const dimColor = (pass: boolean) => pass ? 'var(--success)' : 'var(--danger)';
                return (
                  <div className="cit-valscore-box">
                    <div className="cit-valscore-title">
                      Validation Score:{' '}
                      {/* eslint-disable-next-line local/no-inline-style -- score-threshold-driven color */}
                      <span style={{ ...mono, color: turnScore >= 0.7 ? 'var(--success)' : turnScore >= 0.5 ? 'var(--warning)' : 'var(--danger)' }}>
                        {turnScore.toFixed(2)}
                      </span>
                    </div>
                    <div className="cit-dims-row">
                      {/* eslint-disable-next-line local/no-inline-style -- dimension-pass-driven color */}
                      <span><span style={{ color: dimColor(dims.schema.pass) }}>{'●'}</span> schema {'×'}0.4 = <strong className="cit-mono">{(0.4 * (dims.schema.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      {/* eslint-disable-next-line local/no-inline-style -- dimension-pass-driven color */}
                      <span><span style={{ color: dimColor(dims.grounding.pass) }}>{'●'}</span> grounding {'×'}0.3 = <strong className="cit-mono">{(0.3 * (dims.grounding.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      {/* eslint-disable-next-line local/no-inline-style -- dimension-pass-driven color */}
                      <span><span style={{ color: dimColor(dims.advancement.pass) }}>{'●'}</span> advancement {'×'}0.2 = <strong className="cit-mono">{(0.2 * (dims.advancement.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      {/* eslint-disable-next-line local/no-inline-style -- dimension-pass-driven color */}
                      <span><span style={{ color: dimColor(dims.clarifies.pass) }}>{'●'}</span> clarifies {'×'}0.1 = <strong className="cit-mono">{(0.1 * (dims.clarifies.pass ? 1 : 0)).toFixed(2)}</strong></span>
                    </div>
                    <div className="cit-breakdown">
                      <span>Stage A: <strong className="cit-mono">{stageA.toFixed(2)}</strong> <span className="cit-muted">{'×'}0.4 = {(0.4 * stageA).toFixed(2)}</span></span>
                      <span>Judge: <strong className="cit-mono">{judgeQ.toFixed(2)}</strong>{!judgeUsed && <span className="cit-muted"> (default)</span>} <span className="cit-muted">{'×'}0.6 = {(0.6 * judgeQ).toFixed(2)}</span></span>
                      {/* eslint-disable-next-line local/no-inline-style -- score-threshold-driven color */}
                      <span>Total: <strong style={{ ...mono, color: turnScore >= 0.7 ? 'var(--success)' : turnScore >= 0.5 ? 'var(--warning)' : 'var(--danger)' }}>{turnScore.toFixed(2)}</strong></span>
                    </div>
                  </div>
                );
              }
              return (
                <div className="cit-fallback-val">
                  Validation Score:{' '}
                  {valData ? (
                    // eslint-disable-next-line local/no-inline-style -- pass-driven color
                    <span style={{ color: valData.pass ? 'var(--success)' : 'var(--danger)' }}>
                      {valData.pass ? 'Pass' : 'Fail'}
                    </span>
                  ) : (
                    <span className="cit-muted">{'—'}</span>
                  )}
                </div>
              );
            })()}
            {/* Validation Feedback */}
            {hints.length > 0 && (
              <details open className="cit-feedback">
                <summary className="cit-summary-plain">Validation Feedback</summary>
                <ul className="cit-feedback-list">
                  {hints.map((h, hi) => {
                    const target = classifyHintTarget(h);
                    const ts = HINT_TARGET_STYLE[target];
                    return (
                      <li key={hi} className="cit-mb3">
                        {/* eslint-disable-next-line local/no-inline-style -- hint-target-driven color/background */}
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
    </div>
  );
}
