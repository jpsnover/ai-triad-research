// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import type { DebateSession, TurnValidationTrail } from '../../../../types/debate';
import { humanizeSpeakerIds } from '../../../../utils/humanizeSpeakers';
import { TaxonomyRefDetail, type TaxRefNode, type TaxRefEdge } from '../../../taxonomy/TaxonomyRefDetail';
import { Highlight, CopyButton } from '../helpers';
import { classifyHintTarget, HINT_TARGET_STYLE } from '../shared';

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
    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
      {/* -- Top section: header + content from final cite -- */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        <span style={{ padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--warning) 20%, transparent)', color: 'var(--warning)', fontWeight: 600 }}>CITE</span>
        <span>{citeStage.model}</span>
        <span>temp={citeStage.temperature}</span>
        <span>{(citeStage.response_time_ms / 1000).toFixed(1)}s</span>
        {typeof (citeStage.work_product as Record<string, unknown>).grounding_confidence === 'number' && (
          <span style={{ padding: '1px 6px', borderRadius: 3, background: (citeStage.work_product as Record<string, unknown>).grounding_confidence as number >= 0.7 ? 'color-mix(in srgb, var(--success) 20%, transparent)' : 'color-mix(in srgb, var(--warning) 20%, transparent)', fontSize: 'var(--text-2xs)' }}>
            confidence: {((citeStage.work_product as Record<string, unknown>).grounding_confidence as number).toFixed(2)}
          </span>
        )}
      </div>
      {citeStage.parse_error && (
        <div style={{ padding: '6px 8px', margin: '6px 0', background: 'rgba(220,38,38,0.1)', borderLeft: '3px solid var(--danger)', borderRadius: 4, fontSize: '0.72rem', color: 'var(--danger)' }}>
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
          <div style={{ padding: 8, margin: '6px 0', borderLeft: '3px solid color-mix(in srgb, var(--warning) 60%, transparent)', background: 'color-mix(in srgb, var(--warning) 8%, transparent)', borderRadius: 4, fontSize: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--warning) 20%, transparent)', color: 'var(--warning)', fontWeight: 600, fontSize: 'var(--text-2xs)' }}>MODERATOR DIRECTIVE</span>
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
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>
          Taxonomy References
          {boostedSet.size > 0 && (
            <span style={{ marginLeft: 6, fontWeight: 400, fontSize: 'var(--text-2xs)', color: 'var(--warning)' }}>
              {boostedSet.size} lineage-boosted{promotedSet.size > 0 ? `, ${promotedSet.size} promoted` : ''}
              {frameLabels.length > 0 && <> · {frameLabels.join(', ')}</>}
            </span>
          )}
        </summary>
          <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 180 }} />
              <col />
            </colgroup>
            <tbody>
              {((citeStage.work_product as Record<string, unknown>).taxonomy_refs as { node_id: string; relevance: string; relevance_score?: number; primary?: boolean }[]).map((r, i) => {
                const isSelected = selectedTaxRefId === r.node_id;
                const isNew = !briefNodes.has(r.node_id);
                const nodeLabel = (taxNodeMap.get(r.node_id) as TaxRefNode | undefined)?.label;
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: isSelected ? 'color-mix(in srgb, var(--warning) 8%, transparent)' : 'transparent' }}>
                    <td style={{ padding: '3px 6px', verticalAlign: 'top', overflow: 'hidden' }}>
                      <div>
                        <button
                          onClick={() => setSelectedTaxRefId(isSelected ? null : r.node_id)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontWeight: isSelected ? 700 : 600, textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'inherit', textAlign: 'left' }}
                          title="Show node details"
                        >{r.primary ? '★ ' : ''}{r.node_id}</button>
                        {isNew && (
                          <span title="New: not in Brief's relevant taxonomy nodes" style={{ marginLeft: 3, color: 'var(--success)', fontWeight: 700, fontSize: '0.8em' }}>+</span>
                        )}
                        {promotedSet.has(r.node_id) ? (
                          <span
                            title={`Promoted into context by lineage boost — would not appear without boost${boostTraditions.length > 0 ? ` (${boostTraditions.join(', ')})` : ''}`}
                            style={{ marginLeft: 3, display: 'inline-block', padding: '0 4px', borderRadius: 2, background: 'color-mix(in srgb, var(--warning) 25%, transparent)', color: 'var(--warning)', fontWeight: 700, fontSize: '0.65em', lineHeight: '1.4' }}
                          >L{'↑'}</span>
                        ) : boostedSet.has(r.node_id) ? (
                          <span
                            title={`Relevance score boosted by lineage matching${boostTraditions.length > 0 ? ` (${boostTraditions.join(', ')})` : ''}`}
                            style={{ marginLeft: 3, display: 'inline-block', padding: '0 3px', borderRadius: 2, background: 'color-mix(in srgb, var(--warning) 12%, transparent)', color: 'var(--warning)', fontWeight: 600, fontSize: '0.65em', lineHeight: '1.4' }}
                          >L</span>
                        ) : null}
                      </div>
                      {nodeLabel && (
                        <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }} title={nodeLabel}>
                          {nodeLabel}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '3px 6px', verticalAlign: 'top' }}><Highlight text={r.relevance} /></td>
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
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Move Annotations</summary>
          {((citeStage.work_product as Record<string, unknown>).move_annotations as { move: string; target?: string; detail: string }[]).map((m, i) => (
            <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid color-mix(in srgb, var(--warning) 30%, transparent)' }}>
              <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--warning) 20%, transparent)', color: 'var(--warning)', fontSize: '0.7rem', fontWeight: 600 }}>{m.move}</span>
              {m.target && <span style={{ marginLeft: 6, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{'→'} {m.target}</span>}
              {m.detail && <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginTop: 2 }}><Highlight text={m.detail} /></div>}
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
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Policy References</summary>
          <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 120 }} />
              <col />
            </colgroup>
            <tbody>
              {citePolIds.map((p, i) => {
                const isSelected = selectedPolicyId === p;
                const pol = policyMap.get(p);
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: isSelected ? 'color-mix(in srgb, var(--text-secondary) 8%, transparent)' : 'transparent' }}>
                    <td style={{ padding: '3px 6px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      <button
                        onClick={() => setSelectedPolicyId(isSelected ? null : p)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: isSelected ? 700 : 600, textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'inherit', textAlign: 'left' }}
                        title="Show policy details"
                      >{p}</button>
                    </td>
                    <td style={{ padding: '3px 6px', verticalAlign: 'top', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pol?.action ?? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{'—'}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {selectedPolicyId && (() => {
            const pol = policyMap.get(selectedPolicyId);
            return (
              <div style={{ margin: '6px 0', padding: '8px 10px', borderRadius: 6, background: 'color-mix(in srgb, var(--text-secondary) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--text-secondary) 20%, transparent)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-secondary)', fontSize: '0.72rem' }}>{selectedPolicyId}</span>
                  <button onClick={() => setSelectedPolicyId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{'×'}</button>
                </div>
                {pol ? (<>
                  <div style={{ fontSize: '0.75rem', lineHeight: 1.5, marginBottom: 4 }}>{pol.action}</div>
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                    POVs: {pol.source_povs.join(', ')} · {pol.member_count} member{pol.member_count !== 1 ? 's' : ''}
                  </div>
                </>) : (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Policy not found in registry</div>
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
          <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>
            Intellectual Lineage ({frame.length})
            {lb && <span style={{ marginLeft: 6, fontSize: 'var(--text-2xs)', color: 'var(--success)', fontWeight: 400 }}>boost active</span>}
          </summary>
            {frame.map((f: { cluster_id: string; label?: string; percentage: number; traditions?: string[] }, i: number) => (
              <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid color-mix(in srgb, var(--warning) 30%, transparent)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>{f.label ?? f.cluster_id}</span>
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--warning)' }}>{(f.percentage * 100).toFixed(0)}%</span>
                </div>
                {f.traditions && f.traditions.length > 0 && (
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 1 }}>
                    {f.traditions.join(', ')}
                  </div>
                )}
              </div>
            ))}
            {lb && (
              <div style={{ marginTop: 4, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
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
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 6px',
              fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontWeight: 600,
            }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span>Turn {ai + 1}</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
            {/* Raw Prompt */}
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                Raw Prompt <CopyButton text={attempt.prompt} />
              </summary>
              <pre style={{ fontSize: 'var(--text-2xs)', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{attempt.prompt}</pre>
            </details>
            {/* Raw Response */}
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                Raw Response <CopyButton text={attempt.raw_response} />
              </summary>
              <pre style={{ fontSize: 'var(--text-2xs)', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{attempt.raw_response}</pre>
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
                  <div style={{
                    marginTop: 6, background: 'var(--bg-subtle)', borderRadius: 4,
                    padding: '5px 8px', fontSize: '0.7rem',
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      Validation Score:{' '}
                      <span style={{ ...mono, color: turnScore >= 0.7 ? 'var(--success)' : turnScore >= 0.5 ? 'var(--warning)' : 'var(--danger)' }}>
                        {turnScore.toFixed(2)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: 'var(--text-2xs)' }}>
                      <span><span style={{ color: dimColor(dims.schema.pass) }}>{'●'}</span> schema {'×'}0.4 = <strong style={mono}>{(0.4 * (dims.schema.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      <span><span style={{ color: dimColor(dims.grounding.pass) }}>{'●'}</span> grounding {'×'}0.3 = <strong style={mono}>{(0.3 * (dims.grounding.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      <span><span style={{ color: dimColor(dims.advancement.pass) }}>{'●'}</span> advancement {'×'}0.2 = <strong style={mono}>{(0.2 * (dims.advancement.pass ? 1 : 0)).toFixed(2)}</strong></span>
                      <span><span style={{ color: dimColor(dims.clarifies.pass) }}>{'●'}</span> clarifies {'×'}0.1 = <strong style={mono}>{(0.1 * (dims.clarifies.pass ? 1 : 0)).toFixed(2)}</strong></span>
                    </div>
                    <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 3, fontSize: 'var(--text-2xs)', display: 'flex', gap: 12 }}>
                      <span>Stage A: <strong style={mono}>{stageA.toFixed(2)}</strong> <span style={{ color: 'var(--text-muted)' }}>{'×'}0.4 = {(0.4 * stageA).toFixed(2)}</span></span>
                      <span>Judge: <strong style={mono}>{judgeQ.toFixed(2)}</strong>{!judgeUsed && <span style={{ color: 'var(--text-muted)' }}> (default)</span>} <span style={{ color: 'var(--text-muted)' }}>{'×'}0.6 = {(0.6 * judgeQ).toFixed(2)}</span></span>
                      <span>Total: <strong style={{ ...mono, color: turnScore >= 0.7 ? 'var(--success)' : turnScore >= 0.5 ? 'var(--warning)' : 'var(--danger)' }}>{turnScore.toFixed(2)}</strong></span>
                    </div>
                  </div>
                );
              }
              return (
                <div style={{ marginTop: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                  Validation Score:{' '}
                  {valData ? (
                    <span style={{ color: valData.pass ? 'var(--success)' : 'var(--danger)' }}>
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
