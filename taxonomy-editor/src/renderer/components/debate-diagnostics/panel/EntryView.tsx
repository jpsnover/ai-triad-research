// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback, useMemo } from 'react';
import { useDebateStore } from '../../../hooks/useDebateStore';
import { useTaxonomyStore } from '../../../hooks/useTaxonomyStore';
import { useFlag } from '../../../hooks/useFeatureFlags';
import { POVER_INFO } from '../../../types/debate';
import type { SpeakerId, EntryDiagnostics, ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../types/debate';
import { QbafClaimBadge, QbafScoreSlider, QbafEdgeIndicator } from '../../taxonomy/QbafOverlay';
import { getMoveName } from '@lib/debate/helpers';
import type { MoveAnnotation } from '@lib/debate/helpers';
import { api } from '@bridge';
import { CollapsibleSection, speakerLabel } from './helpers';

function QbafClaimStrengthSection({ entryId, activeDebate }: { entryId: string; activeDebate: { argument_network?: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] } } | null }) {
  const qbafEnabled = useFlag('release-qbaf-analysis');
  const anNodes = activeDebate?.argument_network?.nodes?.filter(
    n => n.source_entry_id === entryId
  ) ?? [];
  const anEdges = activeDebate?.argument_network?.edges ?? [];
  const scoredNodes = anNodes.filter(n => n.computed_strength != null || n.base_strength != null);

  const handleScoreChange = useCallback((nodeId: string, score: number) => {
    const debate = useDebateStore.getState().activeDebate;
    if (!debate?.argument_network) return;
    const node = debate.argument_network.nodes.find(n => n.id === nodeId);
    if (node) {
      node.base_strength = score;
      node.scoring_method = 'human';
    }
  }, []);

  if (!qbafEnabled || scoredNodes.length === 0) return null;

  return (
    <CollapsibleSection title={`QBAF Strength (${scoredNodes.length} claims)`} defaultOpen>
      {scoredNodes.map(node => {
        const computed = node.computed_strength ?? node.base_strength ?? 0;
        const base = node.base_strength ?? computed;
        const delta = computed - base;
        const incoming = anEdges.filter(e => e.target === node.id);
        const bdiLayer = node.taxonomy_refs.some(r => r.includes('-beliefs-')) ? 'Beliefs'
          : node.taxonomy_refs.some(r => r.includes('-desires-')) ? 'Desires'
          : node.taxonomy_refs.some(r => r.includes('-intentions-')) ? 'Intentions' : 'Unknown';
        const isPending = node.scoring_method === 'unscored';

        return (
          <div key={node.id} className={`diag-qbaf-card ${isPending ? 'diag-qbaf-pending' : ''}`}>
            <div className="diag-qbaf-card-header">
              <span className="diag-an-id">{node.id}</span>
              <QbafClaimBadge node={node} />
            </div>
            <div className="diag-qbaf-claim-text">{node.text}</div>
            {node.attribution_text_genus && <div className="claim-attribution-text"><span className="claim-attribution-label">Attribution:</span>{node.attribution_text_genus}</div>}
            <div className="diag-qbaf-strength-row">
              <span className="diag-k">Intrinsic:</span> <span className="diag-v">{base.toFixed(2)}</span>
              <span className="diag-qbaf-arrow">→</span>
              <span className="diag-k">Dialectical:</span> <span className="diag-v">{computed.toFixed(2)}</span>
              {Math.abs(delta) > 0.01 && (
                <span className={`qbaf-delta ${delta > 0 ? 'qbaf-delta-up' : 'qbaf-delta-down'}`}>
                  ({delta > 0 ? '+' : ''}{delta.toFixed(2)})
                </span>
              )}
            </div>
            {incoming.length > 0 && (
              <div className="diag-qbaf-edges">
                {incoming.map((e, i) => {
                  const srcNode = activeDebate?.argument_network?.nodes?.find(n => n.id === e.source);
                  return (
                    <div key={i} className={`diag-qbaf-edge ${e.type === 'attacks' ? 'diag-qbaf-attack' : 'diag-qbaf-support'}`}>
                      <span>{e.type === 'attacks' ? '⚔' : '✓'} {e.source}</span>
                      {e.attack_type && <span className="diag-badge diag-badge-move">{e.attack_type}</span>}
                      {e.argumentation_scheme && <span className="diag-badge" style={{ fontSize: '0.5rem', background: 'rgba(99,102,241,0.15)', color: '#6366f1', marginLeft: 2 }}>{e.argumentation_scheme}</span>}
                      {e.weight != null && <QbafEdgeIndicator edge={e} />}
                      {srcNode && <span className="diag-muted" style={{ marginLeft: 4 }}>{srcNode.text.slice(0, 60)}{srcNode.text.length > 60 ? '…' : ''}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {node.bdi_sub_scores && (
              <div className="diag-qbaf-subscores-row">
                {Object.entries(node.bdi_sub_scores)
                  .filter(([, v]) => v != null)
                  .map(([key, val]) => (
                    <span key={key} className="diag-qbaf-subscore">
                      <span className="diag-k">{({
                        evidence_quality: 'Evidence', source_reliability: 'Source', falsifiability: 'Falsifiable',
                        values_grounding: 'Values', tradeoff_acknowledgment: 'Tradeoffs', precedent_citation: 'Precedent',
                        mechanism_specificity: 'Mechanism', scope_bounding: 'Scope', failure_mode_addressing: 'Failure modes',
                      } as Record<string, string>)[key] ?? key}:</span>
                      <span className="diag-v">{((val as number) ?? 0).toFixed(2)}</span>
                    </span>
                  ))}
              </div>
            )}
            <div className="diag-qbaf-meta">
              <span className="diag-badge diag-badge-type">{bdiLayer}{node.bdi_confidence != null && node.bdi_confidence < 0.5 ? '*' : ''}</span>
              <span className="diag-muted">Scored by: {node.scoring_method === 'bdi_criteria' ? 'BDI Criteria (v3)' : node.scoring_method === 'human' ? 'Human' : node.scoring_method === 'fact_check' ? 'Fact-check verification' : node.scoring_method === 'unscored' ? 'Unscored (default 0.5)' : 'Unknown'}</span>
              {node.bdi_confidence != null && node.bdi_confidence < 0.5 && (
                <span className="diag-muted" title="Scoring reliability is low for Beliefs claims (Q-0 calibration r &lt; 0.2)"> (low scoring reliability)</span>
              )}
            </div>
            {isPending && (
              <div className="diag-qbaf-slider-row">
                <QbafScoreSlider node={node} onScoreChange={handleScoreChange} />
              </div>
            )}
          </div>
        );
      })}
    </CollapsibleSection>
  );
}

export function EntryView({ entryId }: { entryId: string }) {
  const activeDebate = useDebateStore(s => s.activeDebate);
  if (!activeDebate) return null;

  const entry = activeDebate.transcript.find(e => e.id === entryId);
  if (!entry) return <div className="diag-empty">Entry not found</div>;

  const diag: EntryDiagnostics | undefined = activeDebate.diagnostics?.entries[entryId];
  const meta = entry.metadata as Record<string, unknown> | undefined;

  return (
    <div className="diag-entry-view">
      <div className="diag-entry-header">
        <span className="diag-entry-speaker">{speakerLabel(entry.speaker)}</span>
        <span className="diag-entry-type">{entry.type}</span>
        <button
          onClick={() => { void api.clipboardWriteText(entryId); }}
          style={{ fontSize: '0.5rem', color: 'var(--text-muted)', fontFamily: 'monospace', background: 'none', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 4px', cursor: 'pointer', opacity: 0.7 }}
          title={`Copy turn_id for flight recorder correlation: ${entryId}`}
        >{entryId.slice(0, 8)}</button>
        {diag?.topic_alignment && (() => {
          const ta = diag.topic_alignment;
          const sft = (meta?.injection_manifest as Record<string, unknown> | undefined)?.scope_filter_trace as
            { demoted?: { nodeId: string }[] } | undefined;
          const demotedIds = new Set((sft?.demoted ?? []).map(d => d.nodeId));
          const hasDemotedRef = (entry.taxonomy_refs ?? []).some(r => demotedIds.has(r.node_id));
          const modTrace = meta?.moderator_trace as Record<string, unknown> | undefined;
          const modDrift = modTrace?.drift_detected === true;
          const intMeta = entry.intervention_metadata;
          const modRedirect = modDrift && intMeta && ['REDIRECT', 'CHALLENGE'].includes(intMeta.move);
          let state: 'green' | 'amber' | 'red';
          let label: string;
          let tip: string;
          if (!ta.topic_aligned || modRedirect) {
            state = 'red'; label = modRedirect ? 'drift redirect' : 'off-scope'; tip = modRedirect ? `Moderator ${intMeta!.move} for drift` : 'Topic alignment failed after all retries';
          } else if (ta.repaired) {
            state = 'amber'; label = 'repaired'; tip = 'Off-scope draft repaired on retry';
          } else if (modDrift || hasDemotedRef) {
            state = 'amber'; label = 'drift noted'; tip = modDrift ? 'Moderator flagged drift concern' : 'References demoted taxonomy node';
          } else {
            state = 'green'; label = 'on-scope'; tip = 'All topic alignment checks passed';
          }
          const colors = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444' };
          const bgs = { green: 'rgba(34,197,94,0.15)', amber: 'rgba(245,158,11,0.15)', red: 'rgba(239,68,68,0.15)' };
          return (
            <span className="diag-badge" title={tip} style={{
              fontSize: '0.5rem', cursor: 'help',
              background: bgs[state], color: colors[state],
            }}>{label}</span>
          );
        })()}
        {diag?.entailment_repairs && diag.entailment_repairs.some(r => r.verdict !== 'entailed') && (() => {
          const repaired = diag.entailment_repairs!.filter(r => r.verdict !== 'entailed');
          return (
            <span className="diag-badge" title={`${repaired.length} claim${repaired.length !== 1 ? 's' : ''} repaired by entailment verification`} style={{
              fontSize: '0.5rem', cursor: 'help',
              background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
            }}>{repaired.length} repaired</span>
          );
        })()}
      </div>

      {/* Model & Timing */}
      {diag?.model && (
        <CollapsibleSection title={`Model & Timing — ${diag.model} (${diag.response_time_ms ? ((diag.response_time_ms ?? 0) / 1000).toFixed(1) + 's' : '?'})`} defaultOpen>
          <div className="diag-kv">
            <span className="diag-k">Model:</span> <span className="diag-v">{diag.model}</span>
          </div>
          {diag.response_time_ms && (
            <div className="diag-kv">
              <span className="diag-k">Response time:</span> <span className="diag-v">{((diag.response_time_ms ?? 0) / 1000).toFixed(1)}s</span>
            </div>
          )}
          {(diag.input_tokens != null || diag.output_tokens != null) && (
            <div className="diag-kv">
              <span className="diag-k">Tokens:</span>
              <span className="diag-v">
                {diag.input_tokens != null ? diag.input_tokens.toLocaleString() : '—'} in
                {' / '}
                {diag.output_tokens != null ? diag.output_tokens.toLocaleString() : '—'} out
              </span>
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Moderator Intervention Metadata */}
      {entry.type === 'intervention' && entry.intervention_metadata && (() => {
        const im = entry.intervention_metadata;
        const familyColors: Record<string, string> = {
          procedural: '#3b82f6', elicitation: '#f59e0b', repair: '#ef4444',
          reconciliation: '#22c55e', reflection: '#8b5cf6', synthesis: '#06b6d4',
        };
        return (
          <CollapsibleSection title={`Intervention — ${im.move} [${im.family}]`} defaultOpen>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              <span className="diag-badge" style={{ background: `${familyColors[im.family] ?? '#6b7280'}30`, color: familyColors[im.family] ?? '#6b7280' }}>{im.family}</span>
              <span className="diag-badge diag-badge-move">{im.move}</span>
              <span className="diag-badge diag-badge-type">{im.force}</span>
            </div>
            <div className="diag-kv">
              <span className="diag-k">Target:</span> <span className="diag-v">{speakerLabel(im.target_debater as SpeakerId)}</span>
            </div>
            <div className="diag-kv">
              <span className="diag-k">Burden:</span> <span className="diag-v">{(im.burden ?? 0).toFixed(2)}</span>
            </div>
            <div className="diag-kv">
              <span className="diag-k">Trigger:</span> <span className="diag-v">{im.trigger_reason}</span>
            </div>
            {im.prerequisite_applied && (
              <div className="diag-kv">
                <span className="diag-k">Prerequisite:</span> <span className="diag-badge" style={{ fontSize: '0.55rem', background: 'rgba(234,179,8,0.15)', color: '#ca8a04' }}>{im.prerequisite_applied}</span>
              </div>
            )}
            {im.source_evidence?.claim && (
              <div className="diag-kv">
                <span className="diag-k">Source claim:</span> <span className="diag-v">{im.source_evidence.claim}</span>
              </div>
            )}
            {im.original_claim_text && (
              <div style={{ marginTop: 4, padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: 4, fontSize: '0.7rem', fontStyle: 'italic' }}>
                {im.original_claim_text}
              </div>
            )}
          </CollapsibleSection>
        );
      })()}

      {/* Moderator Deliberation (t/160) */}
      {meta?.moderator_trace && (() => {
        const trace = meta.moderator_trace as {
          selected: string; excluded_last_speaker: string | null;
          candidates: { debater: string; computed_strength: number | null; rank: number }[];
          convergence_score: number | null; convergence_triggered: boolean;
          commitment_snapshot: Record<string, { asserted: number; conceded: number; challenged: number }>;
          selection_reason: string; focus_point: string;
          recent_scheme?: string;
          metaphor_reframe_offered?: string;
          metaphor_reframe_used?: boolean;
          critical_questions?: string;
          argument_network_snapshot?: {
            total_claims: number; total_edges: number; unaddressed_claims: number;
            strongest_unaddressed?: { id: string; speaker: string; strength?: number; text: string }[];
          };
        };
        return (
          <CollapsibleSection title={`Moderator — selected ${trace.selected} (${trace.selection_reason.replace(/_/g, ' ')})`} defaultOpen>
            <div className="diag-kv">
              <span className="diag-k">Selected:</span> <span className="diag-v">{trace.selected}</span>
            </div>
            {trace.excluded_last_speaker && (
              <div className="diag-kv">
                <span className="diag-k">Excluded (last speaker):</span> <span className="diag-v">{trace.excluded_last_speaker}</span>
              </div>
            )}
            <div className="diag-kv">
              <span className="diag-k">Reason:</span> <span className="diag-badge diag-badge-move">{trace.selection_reason.replace(/_/g, ' ')}</span>
            </div>
            {trace.focus_point && (
              <div className="diag-kv">
                <span className="diag-k">Focus:</span> <span className="diag-v">{trace.focus_point}</span>
              </div>
            )}
            {trace.candidates.length > 0 && (
              <div className="diag-mod-candidates">
                <span className="diag-k">Candidates:</span>
                {trace.candidates.map((c, i) => (
                  <div key={i} className="diag-mod-candidate">
                    <span className="diag-mod-rank">#{c.rank}</span>
                    <span>{c.debater}</span>
                    {c.computed_strength != null && (
                      <span className="diag-muted">strength: {c.computed_strength.toFixed(2)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {trace.convergence_score != null && (
              <div className="diag-kv">
                <span className="diag-k">Convergence:</span>
                <span className="diag-v">{(trace.convergence_score * 100).toFixed(0)}%{trace.convergence_triggered ? ' (triggered)' : ''}</span>
              </div>
            )}
            {trace.recent_scheme && (
              <div className="diag-kv">
                <span className="diag-k">Recent Scheme:</span>
                <span className="diag-badge" style={{ fontSize: '0.55rem', background: 'rgba(99,102,241,0.15)', color: '#6366f1' }}>{trace.recent_scheme}</span>
              </div>
            )}
            {trace.metaphor_reframe_offered && (
              <div className="diag-kv" style={{ marginTop: 4 }}>
                <span className="diag-k">Metaphor Reframe:</span>
                <span className="diag-badge" style={{ fontSize: '0.55rem', background: 'rgba(234,179,8,0.15)', color: '#ca8a04' }}>
                  {trace.metaphor_reframe_offered} {trace.metaphor_reframe_used ? '(USED)' : '(offered, not used)'}
                </span>
              </div>
            )}
            {trace.critical_questions && (
              <div style={{ fontSize: '0.7rem', marginTop: 4, padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: 4 }}>
                <div className="diag-k" style={{ marginBottom: 2 }}>Critical Questions for Moderator:</div>
                <div className="diag-muted" style={{ whiteSpace: 'pre-wrap' }}>{trace.critical_questions}</div>
              </div>
            )}
            {/* Implementation Challenge move (policymaker debates, t/251) */}
            {trace.selection_reason === 'implementation_challenge' && (
              <div className="diag-kv" style={{ marginTop: 4 }}>
                <span className="diag-badge" style={{ fontSize: '0.6rem', fontWeight: 700, background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '2px 6px', borderRadius: 3 }}>
                  IMPLEMENTATION CHALLENGE
                </span>
                {(trace as Record<string, unknown>).implementation_challenge_trigger && (() => {
                  const trigger = (trace as Record<string, unknown>).implementation_challenge_trigger as { round?: number; operationality_score?: number; convergence_score?: number };
                  return (
                    <span className="diag-muted" style={{ marginLeft: 6 }}>
                      round {trigger.round ?? '?'} · operationality {trigger.operationality_score?.toFixed(2) ?? '?'} · convergence {trigger.convergence_score?.toFixed(2) ?? '?'}
                    </span>
                  );
                })()}
              </div>
            )}
            {trace.argument_network_snapshot && (
              <div style={{ fontSize: '0.7rem', marginTop: 4 }}>
                <div className="diag-k">Argument Network at Decision:</div>
                <div className="diag-muted">
                  {trace.argument_network_snapshot.total_claims} claims, {trace.argument_network_snapshot.total_edges} edges, {trace.argument_network_snapshot.unaddressed_claims} unaddressed
                </div>
                {(trace.argument_network_snapshot.strongest_unaddressed?.length ?? 0) > 0 && (
                  <div style={{ marginTop: 2 }}>
                    <span className="diag-k">Strongest unaddressed:</span>
                    {trace.argument_network_snapshot.strongest_unaddressed!.map((n, i) => (
                      <div key={i} className="diag-muted" style={{ paddingLeft: 8 }}>
                        {n.id} ({n.speaker}, strength {n.strength?.toFixed(2)}): {n.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {Object.keys(trace.commitment_snapshot).length > 0 && (
              <div className="diag-mod-commitments">
                <span className="diag-k">Commitments at selection:</span>
                {Object.entries(trace.commitment_snapshot).map(([debater, counts]) => (
                  <div key={debater} className="diag-mod-commit-row">
                    <span className="diag-mod-commit-name">{debater}:</span>
                    <span className="diag-muted">{counts.asserted}A {counts.conceded}C {counts.challenged}Ch</span>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleSection>
        );
      })()}

      {/* Pipeline Stage Work Products */}
      {diag?.stage_diagnostics && diag.stage_diagnostics.length > 0 && (() => {
        const stages = diag.stage_diagnostics;
        const stageColors: Record<string, string> = { brief: '#3b82f6', plan: '#a855f7', draft: '#22c55e', cite: '#fb923c' };
        return (
          <>
            {stages.map(s => (
              <CollapsibleSection key={s.stage} title={`${s.stage.toUpperCase()} — ${s.model} (temp=${s.temperature}, ${((s.response_time_ms ?? 0) / 1000).toFixed(1)}s${s.input_tokens != null || s.output_tokens != null ? `, ${(s.input_tokens ?? 0).toLocaleString()}/${(s.output_tokens ?? 0).toLocaleString()} tok` : ''})`}>
                {s.stage === 'brief' && !!(s.work_product as Record<string, unknown>).situation_assessment && (
                  <div style={{ padding: 6, marginBottom: 6, borderLeft: `3px solid ${stageColors[s.stage]}40`, fontSize: '0.75rem' }}>
                    {String((s.work_product as Record<string, unknown>).situation_assessment)}
                  </div>
                )}
                {s.stage === 'brief' && Array.isArray((s.work_product as Record<string, unknown>).strongest_angles) && (
                  <div style={{ marginBottom: 6 }}>
                    {((s.work_product as Record<string, unknown>).strongest_angles as { angle: string; why: string; grounding?: { node_id: string; why: string }[] }[]).map((a, i) => {
                      const sitGrounding = (a.grounding ?? []).filter(g => g.node_id.startsWith('sit-') || g.node_id.startsWith('cc-'));
                      const sitNodes = useTaxonomyStore.getState().situations?.nodes;
                      return (
                        <div key={i} style={{ margin: '3px 0', paddingLeft: 8, borderLeft: `2px solid ${stageColors[s.stage]}40` }}>
                          <div style={{ fontSize: '0.7rem', fontWeight: 600 }}>{a.angle}</div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{a.why}</div>
                          {sitGrounding.length > 0 && sitNodes && (
                            <div style={{ marginTop: 2 }}>
                              {sitGrounding.map(g => {
                                const sit = sitNodes.find(n => n.id === g.node_id);
                                const div = sit?.interpretation_divergence;
                                if (div == null) return (
                                  <span key={g.node_id} style={{ display: 'inline-block', fontSize: '0.6rem', marginRight: 6, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-secondary)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                    {g.node_id}
                                  </span>
                                );
                                const color = div > 0.40 ? '#22c55e' : div >= 0.20 ? '#f59e0b' : '#ef4444';
                                const isLow = div < 0.20;
                                return (
                                  <span key={g.node_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.6rem', marginRight: 6, padding: '1px 5px', borderRadius: 3, background: isLow ? '#ef444418' : 'var(--bg-secondary)', fontFamily: 'monospace' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>{g.node_id}</span>
                                    <span style={{ color, fontWeight: 600 }}>div:{div.toFixed(2)}</span>
                                    {isLow && <span title="Low divergence — may not generate disagreement">⚠</span>}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {s.stage === 'plan' && !!(s.work_product as Record<string, unknown>).strategic_goal && (
                  <div style={{ padding: 6, marginBottom: 6, borderLeft: `3px solid ${stageColors[s.stage]}40`, fontSize: '0.75rem', fontWeight: 600 }}>
                    {String((s.work_product as Record<string, unknown>).strategic_goal)}
                  </div>
                )}
                {s.stage === 'plan' && !!(s.work_product as Record<string, unknown>).core_thesis && (
                  <div style={{ padding: 6, marginBottom: 6, borderLeft: `3px solid ${stageColors[s.stage]}40`, fontSize: '0.7rem', fontStyle: 'italic' }}>
                    {String((s.work_product as Record<string, unknown>).core_thesis)}
                  </div>
                )}
                {s.stage === 'plan' && Array.isArray((s.work_product as Record<string, unknown>).planned_moves) && (
                  <div style={{ marginBottom: 6 }}>
                    {((s.work_product as Record<string, unknown>).planned_moves as { move: string; target?: string; detail: string }[]).map((m, i) => (
                      <div key={i} style={{ margin: '3px 0', paddingLeft: 8, borderLeft: `2px solid ${stageColors[s.stage]}40` }}>
                        <span className="diag-badge diag-badge-move">{m.move}</span>
                        {m.target && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--text-muted)' }}>{'→'} {m.target}</span>}
                        {m.detail && <div style={{ fontSize: '0.7rem', marginTop: 1 }}>{m.detail}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {s.stage === 'plan' && Array.isArray((s.work_product as Record<string, unknown>).argument_structure) && (
                  <div style={{ marginBottom: 6 }}>
                    {((s.work_product as Record<string, unknown>).argument_structure as { point: string; evidence: string; taxonomy_anchor: string }[]).map((a, i) => (
                      <div key={i} style={{ margin: '3px 0', paddingLeft: 8, borderLeft: `2px solid ${stageColors[s.stage]}40` }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600 }}>{a.point}</div>
                        {a.evidence && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Evidence: {a.evidence}</div>}
                        {a.taxonomy_anchor && <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Anchor: {a.taxonomy_anchor}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {s.stage === 'draft' && !!(s.work_product as Record<string, unknown>).disagreement_type && (
                  <div className="diag-kv" style={{ marginBottom: 4 }}>
                    <span className="diag-k">Disagreement:</span>
                    <span className="diag-badge diag-badge-type">{String((s.work_product as Record<string, unknown>).disagreement_type)}</span>
                  </div>
                )}
                {s.stage === 'draft' && diag?.topic_alignment && (
                  <div style={{ marginBottom: 6, padding: '4px 8px', borderLeft: `3px solid ${diag.topic_alignment.topic_aligned ? '#22c55e' : '#ef4444'}40`, fontSize: '0.65rem' }}>
                    <div className="diag-kv" style={{ marginBottom: 2 }}>
                      <span className="diag-k">Topic aligned</span>
                      <span className="diag-badge" style={{ fontSize: '0.45rem', background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}>Attempt {(diag.topic_alignment as Record<string, unknown>).draft_attempt ?? 1}</span>
                      {diag.topic_alignment.repaired && (
                        <span className="diag-badge" style={{ fontSize: '0.45rem', background: 'rgba(245,158,11,0.15)', color: '#d97706' }}>triggered regen</span>
                      )}
                    </div>
                    <div className="diag-kv">
                      <span className="diag-k">Result:</span>
                      <span className="diag-badge" style={{
                        fontSize: '0.5rem',
                        background: diag.topic_alignment.topic_aligned ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                        color: diag.topic_alignment.topic_aligned ? '#22c55e' : '#ef4444',
                      }}>
                        {diag.topic_alignment.topic_aligned ? 'yes' : 'no'}
                      </span>
                    </div>
                    {(diag.topic_alignment.scope_used?.off_scope_topics?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 2 }}>
                        <span className="diag-k">Off-scope topics (static):</span>
                        <ul style={{ margin: '2px 0 0 16px', padding: 0, listStyle: 'disc' }}>
                          {diag.topic_alignment.scope_used!.off_scope_topics!.map((item: string, i: number) => (
                            <li key={i} style={{ color: '#ef4444' }}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(diag.topic_alignment.scope_used?.drift_signatures?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 2 }}>
                        <span className="diag-k">Drift signatures (static):</span>
                        <ul style={{ margin: '2px 0 0 16px', padding: 0, listStyle: 'disc' }}>
                          {diag.topic_alignment.scope_used!.drift_signatures!.map((sig: string, i: number) => (
                            <li key={i} style={{ color: '#f59e0b' }}>{sig}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {s.stage === 'cite' && typeof (s.work_product as Record<string, unknown>).grounding_confidence === 'number' && (
                  <div className="diag-kv" style={{ marginBottom: 4 }}>
                    <span className="diag-k">Grounding confidence:</span>
                    <span className="diag-v">{((s.work_product as Record<string, unknown>).grounding_confidence as number).toFixed(2)}</span>
                  </div>
                )}
                <details style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  <summary style={{ cursor: 'pointer' }}>Full work product</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto', fontSize: '0.6rem' }}>{JSON.stringify(s.work_product, null, 2)}</pre>
                </details>
              </CollapsibleSection>
            ))}
          </>
        );
      })()}

      {/* Dialectical Moves */}
      {meta?.move_types && (
        <CollapsibleSection title={`Dialectical Moves — ${(meta.move_types as (string | MoveAnnotation)[]).map(m => getMoveName(m)).join(', ')}`} defaultOpen>
          {(meta.move_types as (string | MoveAnnotation)[]).map((m, i) => {
            const name = getMoveName(m);
            const ann = typeof m === 'object' ? m as MoveAnnotation : null;
            return (
              <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid rgba(59,130,246,0.3)' }}>
                <span className="diag-badge diag-badge-move">{name}</span>
                {ann?.target && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--text-muted)' }}>→ {ann.target}</span>}
                {ann?.detail && <div style={{ fontSize: '0.7rem', marginTop: 2 }}>{ann.detail}</div>}
              </div>
            );
          })}
          {!!meta.disagreement_type && (
            <div className="diag-kv" style={{ marginTop: 4 }}>
              <span className="diag-k">Disagreement type:</span>
              <span className="diag-badge diag-badge-type">{String(meta.disagreement_type)}</span>
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Key Assumptions */}
      {meta?.key_assumptions && (meta.key_assumptions as { assumption: string; if_wrong: string }[]).length > 0 && (
        <CollapsibleSection title={`Key Assumptions (${(meta.key_assumptions as unknown[]).length})`}>
          {(meta.key_assumptions as { assumption: string; if_wrong: string }[]).map((a, i) => (
            <div key={i} className="diag-assumption">
              <div><strong>Assumes:</strong> {a.assumption}</div>
              <div className="diag-muted">If wrong: {a.if_wrong}</div>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Extracted Claims */}
      {diag?.extracted_claims && (
        <CollapsibleSection title={`Extracted Claims (${diag.extracted_claims.accepted.length} accepted, ${diag.extracted_claims.rejected.length} rejected)`} defaultOpen>
          {diag.extracted_claims.accepted.map((c, i) => {
            const anNode = activeDebate?.argument_network?.nodes.find(n => n.id === c.id);
            const ec = anNode?.extraction_confidence;
            const ecBand = ec != null ? (ec >= 1.0 ? 'near-verbatim' : ec >= 0.8 ? 'faithful' : ec >= 0.6 ? 'implicit' : 'minimum') : null;
            const ecColor = ec != null ? (ec >= 0.8 ? '#22c55e' : ec >= 0.6 ? '#f59e0b' : '#ef4444') : '#6b7280';
            const repair = diag.entailment_repairs?.find(r => r.node_id === c.id);
            const hasEntailmentData = (diag.entailment_repairs?.length ?? 0) > 0;
            const verdictColor = repair ? (repair.verdict === 'entailed' ? '#22c55e' : repair.verdict === 'partial' ? '#f59e0b' : '#ef4444') : null;
            return (
              <div key={i} className="diag-claim diag-claim-accepted">
                <span className="diag-claim-status">✓ {c.id}</span>
                <span className="diag-claim-overlap">{c.overlap_pct}%</span>
                {ec != null && (
                  <span title={`FIRE ${ec.toFixed(2)} — ${ecBand}`} style={{ padding: '0 3px', borderRadius: 3, fontSize: '0.5rem', fontWeight: 600, background: `${ecColor}18`, color: ecColor }}>
                    {ec.toFixed(1)}
                  </span>
                )}
                {repair && (
                  <span title={`Entailment: ${repair.verdict} — ${repair.explanation}`} style={{ padding: '0 3px', borderRadius: 3, fontSize: '0.5rem', fontWeight: 600, background: `${verdictColor}18`, color: verdictColor! }}>
                    {repair.verdict === 'entailed' ? '✓' : repair.verdict === 'partial' ? '~' : '✗'}
                  </span>
                )}
                {!repair && hasEntailmentData && (
                  <span style={{ fontSize: '0.45rem', color: 'var(--text-muted)', opacity: 0.5 }}>ns</span>
                )}
                {anNode?.bdi_category && (
                  <span style={{ padding: '0 3px', borderRadius: 3, fontSize: '0.5rem', fontWeight: 600, background: anNode.bdi_category === 'belief' ? 'rgba(59,130,246,0.15)' : anNode.bdi_category === 'desire' ? 'rgba(168,85,247,0.15)' : 'rgba(249,115,22,0.15)', color: anNode.bdi_category === 'belief' ? '#3b82f6' : anNode.bdi_category === 'desire' ? '#a855f7' : '#f97316' }}>
                    {anNode.bdi_category[0].toUpperCase()}
                  </span>
                )}
                {anNode?.specificity && (
                  <span style={{ padding: '0 3px', borderRadius: 3, fontSize: '0.45rem', fontWeight: 600, background: 'rgba(107,114,128,0.12)', color: '#6b7280' }}>
                    {anNode.specificity}
                  </span>
                )}
                {anNode?.steelman_of && (
                  <span style={{ padding: '0 3px', borderRadius: 3, fontSize: '0.45rem', fontWeight: 600, background: 'rgba(20,184,166,0.15)', color: '#14b8a6' }}>
                    ⬆
                  </span>
                )}
                <span className="diag-claim-text">{c.text}</span>
                {repair && repair.verdict !== 'entailed' && repair.repaired_text && (
                  <div style={{ fontSize: '0.6rem', marginTop: 2, paddingLeft: 12 }}>
                    <span style={{ textDecoration: 'line-through', color: '#ef4444', opacity: 0.6 }}>{repair.original_text.slice(0, 80)}{repair.original_text.length > 80 ? '…' : ''}</span>
                    {' → '}
                    <span style={{ color: '#22c55e' }}>{repair.repaired_text.slice(0, 80)}{repair.repaired_text.length > 80 ? '…' : ''}</span>
                  </div>
                )}
              </div>
            );
          })}
          {diag.extracted_claims.rejected.map((c, i) => (
            <div key={i} className="diag-claim diag-claim-rejected">
              <span className="diag-claim-status">✗</span>
              <span className="diag-claim-overlap">{c.overlap_pct}%</span>
              <span className="diag-claim-text">{c.text}</span>
              <span className="diag-claim-reason">{c.reason}</span>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Claim Extraction Details — scheme classification, prompt, response */}
      {diag?.claim_extraction && (() => {
        const ce = diag.claim_extraction;
        return (
          <CollapsibleSection title={`Claim Extraction — ${ce.claims_parsed} claims, ${ce.schemes_classified.length} schemes (${ce.response_time_ms}ms)`} defaultOpen>
            {ce.schemes_classified.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <span className="diag-k">Argumentation Schemes Classified:</span>
                <div className="diag-badges" style={{ marginTop: 2 }}>
                  {ce.schemes_classified.map((s, i) => (
                    <span key={i} className="diag-badge" style={{ fontSize: '0.5rem', background: 'rgba(99,102,241,0.15)', color: '#6366f1' }}>{s}</span>
                  ))}
                </div>
              </div>
            )}
            <CollapsibleSection title="Extraction Prompt">
              <textarea readOnly className="diag-textarea" value={ce.prompt} />
            </CollapsibleSection>
            <CollapsibleSection title="Extraction Raw Response">
              <textarea readOnly className="diag-textarea" value={ce.raw_response} />
            </CollapsibleSection>
          </CollapsibleSection>
        );
      })()}

      {/* Exclusion Guard */}
      {(() => {
        const extTrace = diag?.extraction_trace as Record<string, unknown> | undefined;
        const exclusionGuard = extTrace?.exclusion_guard as {
          checked: number; refs_with_exclusion_vector: number; threshold: number;
          violations: { claim_id: string; claim_text: string; node_id: string; similarity_main: number; similarity_exclusion: number }[];
        } | undefined;
        const scopeDriftCheck = diag?.scope_drift_check as {
          checked: boolean; refs_checked: number; refs_with_exclusion_vector: number; threshold: number;
          warnings: { debater: string; node_id: string; similarity: number; draft_excerpt: string }[];
        } | undefined;
        const legacyViolations = (extTrace?.exclusion_violations as { claim_id: string; claim_text: string; node_id: string; similarity_main: number; similarity_exclusion: number }[] | undefined);
        const legacyWarnings = diag?.scope_drift_warnings;

        const hasExclusionGuard = !!exclusionGuard || (legacyViolations && legacyViolations.length > 0);
        const hasScopeCheck = !!scopeDriftCheck || (legacyWarnings && legacyWarnings.length > 0);
        const hasExtTrace = !!extTrace;
        const hasAnyData = hasExclusionGuard || hasScopeCheck || hasExtTrace || !!diag;

        if (!hasAnyData) return null;

        const violations = exclusionGuard?.violations ?? legacyViolations ?? [];
        const warnings = scopeDriftCheck?.warnings ?? legacyWarnings ?? [];
        const totalIssues = violations.length + warnings.length;

        return (
          <CollapsibleSection title={`Exclusion Guard${totalIssues > 0 ? ` — ${totalIssues} issue${totalIssues !== 1 ? 's' : ''}` : ''}`}>
            {/* Claim Extraction Guard */}
            <div style={{ marginBottom: 8 }}>
              <div className="diag-k" style={{ marginBottom: 3 }}>Claim Extraction Guard</div>
              {exclusionGuard ? (
                <>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 3 }}>
                    Checked {exclusionGuard.checked} claims against {exclusionGuard.refs_with_exclusion_vector} exclusion vectors (threshold: {exclusionGuard.threshold.toFixed(2)})
                  </div>
                  {violations.length > 0 ? violations.map((v, i) => (
                    <div key={i} style={{ fontSize: '0.6rem', marginLeft: 8, marginBottom: 2, padding: '2px 4px', borderLeft: '2px solid #ef4444', background: 'rgba(239,68,68,0.06)' }}>
                      <span style={{ fontWeight: 600, color: '#ef4444' }}>{v.claim_id}</span> → {v.node_id}
                      <span className="diag-muted"> (main: {v.similarity_main.toFixed(2)}, excl: {v.similarity_exclusion.toFixed(2)})</span>
                    </div>
                  )) : (
                    <div style={{ fontSize: '0.65rem', color: '#22c55e', fontWeight: 600 }}>All {exclusionGuard.checked} claims within scope — 0 exclusion violations</div>
                  )}
                </>
              ) : hasExtTrace ? (
                <div style={{ fontSize: '0.65rem', color: '#22c55e', fontWeight: 600 }}>All claims within scope — 0 exclusion violations</div>
              ) : (
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No exclusion guard data — extraction trace not available</div>
              )}
            </div>

            {/* Draft Scope Check */}
            <div style={{ marginBottom: 8 }}>
              <div className="diag-k" style={{ marginBottom: 3 }}>Draft Scope Check</div>
              {scopeDriftCheck ? (
                <>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 3 }}>
                    Checked {scopeDriftCheck.refs_checked} refs, {scopeDriftCheck.refs_with_exclusion_vector} with exclusion vectors (threshold: {scopeDriftCheck.threshold.toFixed(2)})
                  </div>
                  {warnings.length > 0 ? warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: '0.6rem', marginLeft: 8, marginBottom: 2, padding: '2px 4px', borderLeft: '2px solid #f59e0b', background: 'rgba(245,158,11,0.06)' }}>
                      <span style={{ fontWeight: 600, color: '#f59e0b' }}>{w.debater}</span> → {w.node_id}
                      <span className="diag-muted"> (sim: {w.similarity.toFixed(2)})</span>
                    </div>
                  )) : (
                    <div style={{ fontSize: '0.65rem', color: '#22c55e', fontWeight: 600 }}>All {scopeDriftCheck.refs_checked} refs within scope — 0 drift warnings</div>
                  )}
                </>
              ) : diag ? (
                <div style={{ fontSize: '0.65rem', color: '#22c55e', fontWeight: 600 }}>No scope drift detected — 0 warnings</div>
              ) : (
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No scope drift data — diagnostics not available</div>
              )}
            </div>

            {/* Taxonomy Context Injection — placeholder for t/489 */}
            {(diag as Record<string, unknown> | undefined)?.taxonomy_injection_trace && (() => {
              const tit = (diag as Record<string, unknown>).taxonomy_injection_trace as { considered: number; demoted: number; demoted_nodes?: { node_id: string; exclusion_similarity: number }[] };
              return (
                <div style={{ marginBottom: 8 }}>
                  <div className="diag-k" style={{ marginBottom: 3 }}>Taxonomy Context Injection</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 3 }}>
                    {tit.considered} nodes considered, {tit.demoted} demoted by exclusion filter
                  </div>
                  {tit.demoted_nodes?.map((n, i) => (
                    <div key={i} style={{ fontSize: '0.6rem', marginLeft: 8, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600 }}>{n.node_id}</span>
                      <span className="diag-muted"> (excl: {n.exclusion_similarity.toFixed(2)})</span>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Situation Injection — placeholder for t/490 */}
            {(diag as Record<string, unknown> | undefined)?.situation_injection_trace && (() => {
              const sit = (diag as Record<string, unknown>).situation_injection_trace as { considered: number; excluded: number; excluded_situations?: { situation_id: string; exclusion_similarity: number }[] };
              return (
                <div>
                  <div className="diag-k" style={{ marginBottom: 3 }}>Situation Injection</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 3 }}>
                    {sit.considered} situations considered, {sit.excluded} excluded
                  </div>
                  {sit.excluded_situations?.map((s, i) => (
                    <div key={i} style={{ fontSize: '0.6rem', marginLeft: 8, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600 }}>{s.situation_id}</span>
                      <span className="diag-muted"> (excl: {s.exclusion_similarity.toFixed(2)})</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </CollapsibleSection>
        );
      })()}

      {/* QBAF Claim Strength (D-Q3) */}
      <QbafClaimStrengthSection entryId={entryId} activeDebate={activeDebate} />

      {/* Context Usage Analysis — injected vs referenced */}
      {entry?.metadata?.injection_manifest && (
        <CollapsibleSection title="Context Usage Analysis">
          {(() => {
            const manifest = entry.metadata.injection_manifest as { povNodeIds: string[]; povPrimaryIds: string[]; situationNodeIds: string[]; vulnerabilityCount: number; policyCount: number; totalTokenEstimate: number };
            const referencedIds = new Set((entry.taxonomy_refs ?? []).map((r: { node_id: string }) => r.node_id));
            const injectedPov = manifest.povNodeIds ?? [];
            const injectedSit = manifest.situationNodeIds ?? [];
            const usedPov = injectedPov.filter(id => referencedIds.has(id));
            const usedSit = injectedSit.filter(id => referencedIds.has(id));
            const usedPrimary = (manifest.povPrimaryIds ?? []).filter(id => referencedIds.has(id));
            const unusedRefs = [...referencedIds].filter(id => !injectedPov.includes(id) && !injectedSit.includes(id));

            return (
              <div style={{ fontSize: '0.75rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <div className="diag-k">Perspective Nodes</div>
                    <div className="diag-v">{usedPov.length} / {injectedPov.length} used ({injectedPov.length > 0 ? Math.round(100 * usedPov.length / injectedPov.length) : 0}%)</div>
                  </div>
                  <div>
                    <div className="diag-k">Primary (★)</div>
                    <div className="diag-v">{usedPrimary.length} / {(manifest.povPrimaryIds ?? []).length} used</div>
                  </div>
                  <div>
                    <div className="diag-k">Situations</div>
                    <div className="diag-v">{usedSit.length} / {injectedSit.length} used ({injectedSit.length > 0 ? Math.round(100 * usedSit.length / injectedSit.length) : 0}%)</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <div className="diag-k">Vulnerabilities</div>
                    <div className="diag-v">{manifest.vulnerabilityCount} injected</div>
                  </div>
                  <div>
                    <div className="diag-k">Policies</div>
                    <div className="diag-v">{manifest.policyCount} injected</div>
                  </div>
                  <div>
                    <div className="diag-k">Est. Tokens</div>
                    <div className="diag-v">~{manifest.totalTokenEstimate?.toLocaleString()}</div>
                  </div>
                </div>
                {/* Policymaker situation boost (t/251) */}
                {(manifest as Record<string, unknown>).policymaker_situation_boost && (() => {
                  const psb = (manifest as Record<string, unknown>).policymaker_situation_boost as { boosted: number; keywords_matched?: string[] };
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                      <div>
                        <div className="diag-k">Policymaker Boost</div>
                        <div className="diag-v">{psb.boosted} situation{psb.boosted !== 1 ? 's' : ''} boosted</div>
                      </div>
                      {psb.keywords_matched && psb.keywords_matched.length > 0 && (
                        <div style={{ gridColumn: 'span 2' }}>
                          <div className="diag-k">Keywords Matched</div>
                          <div className="diag-v">{psb.keywords_matched.join(', ')}</div>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {/* Scope Filter Trace (10.5) */}
                {(manifest as Record<string, unknown>).scope_filter_trace && (() => {
                  const sft = (manifest as Record<string, unknown>).scope_filter_trace as {
                    demoted: { nodeId: string; reason: string; originalScore: number; newScore: number }[];
                    restorations: string[];
                  };
                  const restoredSet = new Set(sft.restorations);
                  return (
                    <div style={{ marginBottom: 8 }}>
                      <div className="diag-k" style={{ marginBottom: 4 }}>
                        Scope Filter — {sft.demoted.length} demoted, {sft.restorations.length} restored
                      </div>
                      {sft.demoted.map(d => {
                        const restored = restoredSet.has(d.nodeId);
                        return (
                          <div key={d.nodeId} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, fontSize: '0.65rem' }}>
                            <span style={{ fontFamily: 'monospace', minWidth: 52, color: restored ? '#f59e0b' : '#ef4444' }}>{d.nodeId}</span>
                            <span style={{ flex: 1, color: 'var(--text-muted)' }}>{d.reason}</span>
                            <span style={{ minWidth: 60, textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.55rem' }}>
                              {d.originalScore.toFixed(2)} → {d.newScore.toFixed(2)}
                            </span>
                            {restored && <span className="diag-badge" style={{ fontSize: '0.45rem', background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>restored</span>}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {/* Per-situation divergence scores (t/254) */}
                {injectedSit.length > 0 && (() => {
                  const sitNodes = useTaxonomyStore.getState().situations?.nodes;
                  if (!sitNodes) return null;
                  const sitWithDiv = injectedSit
                    .map(id => sitNodes.find(n => n.id === id))
                    .filter((n): n is NonNullable<typeof n> => !!n && n.interpretation_divergence != null);
                  if (sitWithDiv.length === 0) return null;
                  return (
                    <div style={{ marginBottom: 8 }}>
                      <div className="diag-k" style={{ marginBottom: 4 }}>Situation Divergence</div>
                      {sitWithDiv.map(sit => {
                        const div = sit.interpretation_divergence!;
                        const color = div > 0.40 ? '#22c55e' : div >= 0.20 ? '#f59e0b' : '#ef4444';
                        const label = div > 0.40 ? 'high' : div >= 0.20 ? 'moderate' : 'low';
                        const cited = referencedIds.has(sit.id);
                        const barWidth = Math.round(div * 100);
                        return (
                          <div key={sit.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, fontSize: '0.7rem' }}>
                            <span style={{ fontFamily: 'monospace', minWidth: 52, color: cited ? 'var(--accent)' : 'var(--text-muted)' }}>{sit.id}</span>
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{sit.label}</span>
                            <span style={{ minWidth: 36, textAlign: 'right', color: 'var(--text-muted)' }}>{div.toFixed(2)}</span>
                            <div style={{ width: 50, height: 8, background: 'var(--bg-secondary)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ width: `${barWidth}%`, height: '100%', background: color, borderRadius: 2 }} />
                            </div>
                            <span style={{ fontSize: '0.6rem', color, fontWeight: 600, minWidth: 28 }}>{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {unusedRefs.length > 0 && (
                  <div style={{ color: 'var(--warning)', marginTop: 4 }}>
                    {unusedRefs.length} referenced node(s) not in injected context — hallucinated refs?
                  </div>
                )}
              </div>
            );
          })()}
        </CollapsibleSection>
      )}

      {/* Synthesis Preferences — show political_feasibility + implementation_specificity scores (t/251) */}
      {entry.type === 'concluding' && (meta?.synthesis as Record<string, unknown> | undefined)?.preferences && (() => {
        const prefs = (meta!.synthesis as Record<string, unknown>).preferences as { conflict: string; prevails: string; criterion: string; rationale: string }[];
        const policymakerCriteria = ['political_feasibility', 'implementation_specificity'];
        const hasPolicymaker = prefs.some(p => policymakerCriteria.includes(p.criterion));
        if (prefs.length === 0) return null;
        return (
          <CollapsibleSection title={`Synthesis Preferences (${prefs.length})${hasPolicymaker ? ' — policymaker criteria active' : ''}`}>
            <div style={{ fontSize: '0.72rem' }}>
              {prefs.map((p, i) => {
                const isPolicyCriterion = policymakerCriteria.includes(p.criterion);
                return (
                  <div key={i} style={{ marginBottom: 6, padding: '4px 6px', background: 'var(--bg-secondary)', borderRadius: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span className="diag-badge" style={{
                        fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                        background: isPolicyCriterion ? 'rgba(239,68,68,0.15)' : 'rgba(99,102,241,0.15)',
                        color: isPolicyCriterion ? '#ef4444' : '#6366f1',
                      }}>
                        {p.criterion.replace(/_/g, ' ')}
                      </span>
                      <span style={{ fontWeight: 600 }}>→ {p.prevails}</span>
                    </div>
                    <div className="diag-muted">{p.conflict}</div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{p.rationale}</div>
                  </div>
                );
              })}
            </div>
          </CollapsibleSection>
        );
      })()}

      {/* Taxonomy Context */}
      {diag?.taxonomy_context && (
        <CollapsibleSection title="Taxonomy Context (BDI)">
          <textarea readOnly className="diag-textarea" value={diag.taxonomy_context} />
        </CollapsibleSection>
      )}

      {/* Commitment Context */}
      {diag?.commitment_context && (
        <CollapsibleSection title="Commitments Injected">
          <textarea readOnly className="diag-textarea" value={diag.commitment_context} />
        </CollapsibleSection>
      )}

      {/* Edge Tensions (moderator only) */}
      {diag?.edge_tensions && (
        <CollapsibleSection title="Edge Tensions Considered">
          <textarea readOnly className="diag-textarea" value={diag.edge_tensions} />
        </CollapsibleSection>
      )}

      {/* AN Context (moderator only) */}
      {diag?.argument_network_context && (
        <CollapsibleSection title="Argument Network State">
          <textarea readOnly className="diag-textarea" value={diag.argument_network_context} />
        </CollapsibleSection>
      )}

      {/* Taxonomy Refs */}
      {entry.taxonomy_refs.length > 0 && (
        <CollapsibleSection title={`Taxonomy Refs (${entry.taxonomy_refs.length})`}>
          {entry.taxonomy_refs.map((r, i) => (
            <div key={i} className="diag-ref">
              <span className="diag-ref-id">{r.node_id}</span>
              <span className="diag-ref-rel">{r.relevance?.slice(0, 100)}</span>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Claim Sketches */}
      {meta?.my_claims && (meta.my_claims as { claim: string; targets: string[] }[]).length > 0 && (
        <CollapsibleSection title={`Claim Sketches (${(meta.my_claims as unknown[]).length})`} defaultOpen>
          {(meta.my_claims as { claim: string; targets: string[] }[]).map((c, i) => (
            <div key={i} style={{ margin: '2px 0', fontSize: '0.7rem' }}>
              <span style={{ color: '#3b82f6' }}>{i + 1}.</span> {c.claim}
              {c.targets?.length > 0 && <span className="diag-muted" style={{ marginLeft: 6 }}>→ {c.targets.join(', ')}</span>}
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Policy Refs */}
      {(() => {
        const rawPolRefs = (meta?.policy_refs as (string | { policy_id: string; relevance?: string })[] | undefined) || entry.policy_refs || [];
        const polIds = rawPolRefs.map(p => typeof p === 'string' ? p : p.policy_id);
        if (polIds.length === 0) return null;
        return (
          <CollapsibleSection title={`Policy Refs (${polIds.length})`}>
            <div className="diag-badges">
              {polIds.map((id, i) => (
                <span key={i} className="diag-badge" style={{ background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }}>{id}</span>
              ))}
            </div>
          </CollapsibleSection>
        );
      })()}

      {/* Full Prompt */}
      {diag?.prompt && (
        <CollapsibleSection title="Full Prompt Sent to AI">
          {diag.prompt.includes('Scope reminder:') && (() => {
            const match = diag.prompt.match(/Scope reminder:[^\n]*/);
            if (!match) return null;
            return (
              <div style={{ marginBottom: 6, padding: '4px 8px', background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 4, fontSize: '0.65rem', color: '#06b6d4' }}>
                <span className="diag-k" style={{ fontSize: '0.55rem' }}>Scope block:</span> {match[0]}
              </div>
            );
          })()}
          <textarea readOnly className="diag-textarea" value={diag.prompt} />
        </CollapsibleSection>
      )}

      {/* Raw Response */}
      {diag?.raw_response && (
        <CollapsibleSection title="Raw AI Response">
          <textarea readOnly className="diag-textarea" value={diag.raw_response} />
        </CollapsibleSection>
      )}

      {!diag && !meta?.move_types && entry.taxonomy_refs.length === 0 && (
        <div className="diag-empty">No diagnostic data captured for this entry. Enable diagnostics mode before running the debate.</div>
      )}
    </div>
  );
}
