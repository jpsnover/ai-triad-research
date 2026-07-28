// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React, { useMemo } from 'react';
import './DetailsTab.css';
import { POVER_INFO } from '../../../../types/debate';
import type {
  SpeakerId,
  DebateSession,
  EntryDiagnostics,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  TurnValidationTrail,
} from '../../../../types/debate';
import { humanizeSpeakerIds } from '../../../../utils/humanizeSpeakers';
import { getMoveName, MOVE_EDGE_MAP } from '@lib/debate/helpers';
import type { MoveAnnotation } from '@lib/debate/helpers';
import { speakerLabel, Highlight, Section, ResizablePre } from '../helpers';
import { SUPPRESSION_REASON_TOOLTIPS } from '../shared/constants';
import { classifyHintTarget, HINT_TARGET_STYLE, EdgesUsedGrouped } from '../shared';
import type { TaxRefEdge } from '../../../taxonomy/TaxonomyRefDetail';
import type { UtilitySnapshot } from '../types';
import type { FlightRecorderEvent } from '@lib/flight-recorder/index';

interface SuppressedIntervention {
  intervention_move?: string | null;
  intervention_target?: SpeakerId | string | null;
  intervention_suppressed_reason?: string | null;
  intervention_suppression_explanation?: string | null;
  trigger_reasoning?: string | null;
}

export interface DetailsTabProps {
  entry: DebateSession['transcript'][number];
  entryIdx: number;
  diag: EntryDiagnostics | undefined;
  meta: Record<string, unknown> | undefined;
  debate: DebateSession;
  an: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] } | undefined;
  turnValTrail: TurnValidationTrail | undefined;
  perTurnUtilities: UtilitySnapshot[];
  precedingIntervention: DebateSession['transcript'][number] | null;
  interventionResponseField: Record<string, unknown> | string | null;
  suppressedIntervention: SuppressedIntervention | null;
  policyMap: Map<string, { id: string; action: string; source_povs: string[]; member_count: number }>;
  allEdges: TaxRefEdge[];
  taxNodeMap: Map<string, Record<string, unknown>>;
  nodeWeights: Map<string, { confidence?: number; priority?: number; operationality?: number; category?: string }>;
  nodeLabels: Map<string, string>;
  selectedTaxRefId: string | null;
  setSelectedTaxRefId: (id: string | null) => void;
  entryErrors?: (FlightRecorderEvent & { error: { name: string; message: string; stack?: string } })[];
}

/**
 * DetailsTab -- Overview/Details tab.
 * Shows per-turn utility delta, preceding intervention, suppressed intervention,
 * dialectical moves, turn validation, commitments, edges used, key assumptions,
 * policy refs, edge tensions, argument network context, model info, lineage frame,
 * and opening statement.
 */
export function DetailsTab({ entry, entryIdx, diag, meta, debate, an, turnValTrail, perTurnUtilities, precedingIntervention, interventionResponseField, suppressedIntervention, policyMap, allEdges, taxNodeMap, nodeWeights, nodeLabels, selectedTaxRefId, setSelectedTaxRefId, entryErrors }: DetailsTabProps) {
  // Lazy import to avoid circular dependency
  const { TurnValidationSection } = useMemo(() => {
    // TurnValidationSection is defined locally in DiagnosticsWindow.
    // Since this is Phase 2 extraction, we construct a simple version that
    // delegates to shared ScoreBreakdown. For now, the full TurnValidation
    // section is rendered via the shared component.
    return { TurnValidationSection: null as any };
  }, []);

  return (
    <div className="det-root">
      {/* Pipeline error banner */}
      {entry.type === 'statement' && diag && (diag.stage_diagnostics?.length ?? 0) > 0 && !diag.extracted_claims && !(diag as Record<string, unknown>).extraction_trace && (
        <div className="det-pipeline-error">
          <div className="det-pipeline-error-title">Pipeline Error</div>
          <div className="det-body-15">
            Pipeline stages completed ({diag.stage_diagnostics!.map(s => s.stage).join(' → ')}),
            but post-pipeline processing failed. Claim extraction, evidence gathering, and argument
            network updates were skipped for this turn. Check the flight recorder for error details.
          </div>
        </div>
      )}
      {/* Flight recorder errors for this entry */}
      {entryErrors && entryErrors.length > 0 && (
        <Section title={`Flight Recorder Errors (${entryErrors.length})`} defaultOpen copyText={entryErrors.map(e => `${e.error.name}: ${e.error.message}${e.error.stack ? '\n' + e.error.stack : ''}`).join('\n\n')}>
          {entryErrors.map((evt, i) => {
            const data = evt.data as Record<string, unknown> | undefined;
            return (
              <div key={i} className="det-error-item">
                <div className="det-error-head">
                  <span className="det-error-badge">{evt.error.name}</span>
                  {!!data?.speaker && (
                    <span className="det-muted-2xs">
                      {String(data.speaker)}{data.round ? ` R${data.round}` : ''}
                    </span>
                  )}
                  <span className="det-error-time">
                    {new Date(evt._wall).toLocaleTimeString()}
                  </span>
                </div>
                <div className="det-error-msg">{evt.error.message}</div>
                {evt.error.stack && (
                  <details className="det-mt4">
                    <summary className="det-stack-summary">Stack trace</summary>
                    <pre className="det-stack-pre">{evt.error.stack}</pre>
                  </details>
                )}
              </div>
            );
          })}
        </Section>
      )}
      {/* Per-turn utility delta for this speaker */}
      {((): React.ReactNode => {
        const turnSnap = perTurnUtilities?.find(s => s.entryId === entry.id);
        if (!turnSnap) return null;
        const snapIdx = perTurnUtilities.indexOf(turnSnap);
        const prevSnap = snapIdx > 0 ? perTurnUtilities[snapIdx - 1] : null;
        const curr = turnSnap.byAgent[entry.speaker];
        const prev = prevSnap?.byAgent[entry.speaker];
        if (!curr) return null;
        const delta = prev ? curr.composite - prev.composite : null;
        const deltaColor = delta === null ? 'var(--text-muted)' : delta > 0.01 ? 'var(--success)' : delta < -0.01 ? 'var(--danger)' : 'var(--warning)';
        const speakerColor: Record<string, string> = { accelerationist: 'var(--color-acc)', safetyist: 'var(--color-saf)', skeptic: 'var(--color-skp)' };
        const color = speakerColor[entry.speaker] ?? 'var(--text-muted)';
        const fmtDelta = (v: number | null, label: string, prevV?: number) => {
          if (v === null || v === undefined) return null;
          const d = prevV !== undefined ? v - prevV : null;
          const dStr = d !== null ? (d >= 0 ? `+${d.toFixed(3)}` : d.toFixed(3)) : '';
          const dColor = d !== null ? (d > 0.01 ? 'var(--success)' : d < -0.01 ? 'var(--danger)' : 'var(--text-muted)') : 'var(--text-muted)';
          return (
            <span key={label} className="det-fmt-delta">
              <span className="det-muted">{label}:</span>
              <strong>{v.toFixed(3)}</strong>
              {dStr && (
                // eslint-disable-next-line local/no-inline-style -- dynamic dColor
                <span style={{ fontSize: 'var(--text-2xs)', color: dColor }}>{dStr}</span>
              )}
            </span>
          );
        };
        return (
          // eslint-disable-next-line local/no-inline-style -- dynamic speaker color background/border-left
          <div style={{
            marginBottom: 10, padding: '8px 10px', borderRadius: 5,
            background: `${color}08`, borderLeft: `3px solid ${color}`,
            fontSize: '0.72rem',
          }}>
            <div className="det-row-g8-mb4">
              {/* eslint-disable-next-line local/no-inline-style -- dynamic speaker color */}
              <span style={{ fontWeight: 700, fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: '0.05em', color }}>Utility</span>
              <span className="det-num-bold">{curr.composite.toFixed(3)}</span>
              {delta !== null && (
                // eslint-disable-next-line local/no-inline-style -- dynamic deltaColor
                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: deltaColor }}>
                  {delta >= 0 ? '+' : ''}{delta.toFixed(3)}
                </span>
              )}
            </div>
            <div className="det-flex-wrap-g14">
              {fmtDelta(curr.position_strength, 'pos', prev?.position_strength)}
              {fmtDelta(curr.attack_effectiveness, 'atk', prev?.attack_effectiveness)}
              {fmtDelta(curr.crux_engagement, 'crux', prev?.crux_engagement)}
            </div>
          </div>
        );
      })()}

      {/* Preceding Intervention */}
      {precedingIntervention && (() => {
        const intMeta = precedingIntervention.intervention_metadata as {
          family?: string; move?: string; force?: string; target_debater?: string;
          trigger_reason?: string;
        } | undefined;
        const targetSpeakerId = intMeta?.target_debater;
        const targetLabel = targetSpeakerId
          ? (POVER_INFO[targetSpeakerId as Exclude<SpeakerId, 'user'>]?.label ?? targetSpeakerId)
          : null;
        const speakerIsTarget = targetLabel
          ? targetLabel === speakerLabel(entry.speaker)
          : true;
        const moveLabel = intMeta?.move ?? 'directive';
        const familyLabel = intMeta?.family ?? '';
        const directiveText = typeof precedingIntervention.content === 'string'
          ? precedingIntervention.content
          : JSON.stringify(precedingIntervention.content);

        const hasResponse = !!interventionResponseField;
        const responseObj = typeof interventionResponseField === 'object' ? interventionResponseField as Record<string, unknown> : null;
        const responseStr = typeof interventionResponseField === 'string' ? interventionResponseField : null;
        const isFromPlan = !!responseObj?.from_plan;

        const complianceColor = hasResponse && !isFromPlan ? 'var(--success)'
          : hasResponse && isFromPlan ? 'var(--warning)'
          : !speakerIsTarget ? 'var(--text-secondary)'
          : 'var(--danger)';
        const complianceIcon = hasResponse && !isFromPlan ? '✓'
          : hasResponse && isFromPlan ? '◐'
          : !speakerIsTarget ? '→'
          : '✗';

        const formatResponseSummary = () => {
          if (responseStr) return responseStr;
          if (!responseObj) return null;
          if (responseObj.from_plan) return responseObj.how_addressed as string;
          const pos = responseObj.position as string | undefined;
          const reason = responseObj.brief_reason as string ?? responseObj.explanation as string ?? responseObj.conclusion as string ?? '';
          const cond = responseObj.condition as string | undefined;
          if (pos) {
            const posLabel = pos === 'agree' ? 'Agreed' : pos === 'disagree' ? 'Disagreed' : pos === 'conditional' ? 'Conditional' : pos;
            return `${posLabel}${reason ? `: ${reason}` : ''}${cond && pos !== 'agree' ? ` (Condition: ${cond})` : ''}`;
          }
          const typ = responseObj.type as string | undefined;
          if (typ) return `${typ}${reason ? `: ${reason}` : ''}`;
          const term = responseObj.term as string | undefined;
          if (term) return `"${term}": ${responseObj.definition ?? ''}${responseObj.example ? ` (e.g., ${responseObj.example})` : ''}`;
          const ev = responseObj.evidence as string | undefined;
          if (ev) return `Evidence: ${ev}`;
          return JSON.stringify(responseObj);
        };

        return (
          <div className="det-mod-directive">
            <div className="det-row-g8-mb6">
              <span className="det-mod-directive-title">
                Moderator Directive
              </span>
              <span className="det-skp-badge">
                {moveLabel}{familyLabel ? ` · ${familyLabel}` : ''}
              </span>
              {targetLabel && (
                // eslint-disable-next-line local/no-inline-style -- dynamic color/weight from speakerIsTarget
                <span style={{ fontSize: 'var(--text-2xs)', color: !speakerIsTarget ? 'var(--text-secondary)' : 'var(--text-muted)', fontWeight: !speakerIsTarget ? 600 : 400 }}>
                  directed at {targetLabel}{!speakerIsTarget ? ` (not ${speakerLabel(entry.speaker)})` : ''}
                </span>
              )}
            </div>
            <div className="det-directive-text">
              &ldquo;{directiveText}&rdquo;
            </div>
            {/* eslint-disable-next-line local/no-inline-style -- dynamic complianceColor background/border */}
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '6px 10px', borderRadius: 4,
              background: `${complianceColor}12`,
              border: `1px solid ${complianceColor}30`,
            }}>
              {/* eslint-disable-next-line local/no-inline-style -- dynamic complianceColor background */}
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: complianceColor,
                flexShrink: 0, marginTop: 4,
              }} />
              <div>
                {hasResponse && (
                  <>
                    {/* eslint-disable-next-line local/no-inline-style -- dynamic complianceColor */}
                    <span style={{ fontWeight: 700, fontSize: '0.72rem', color: complianceColor }}>
                      {complianceIcon} {isFromPlan ? 'Addressed in plan' : 'Responded'}
                    </span>
                    {isFromPlan && (
                      <div className="det-muted-2xs-mt1">
                        Structured response field missing &mdash; showing plan intent
                      </div>
                    )}
                    <div className="det-primary-7-mt2">
                      {formatResponseSummary()}
                    </div>
                  </>
                )}
                {!hasResponse && !speakerIsTarget && (
                  <>
                    {/* eslint-disable-next-line local/no-inline-style -- dynamic complianceColor */}
                    <span style={{ fontWeight: 700, fontSize: '0.72rem', color: complianceColor }}>
                      {complianceIcon} Not targeted
                    </span>
                    <div className="det-muted-2xs-mt2">
                      This directive was aimed at {targetLabel}, but {speakerLabel(entry.speaker)} was selected to speak. {speakerLabel(entry.speaker)} was not required to respond.
                    </div>
                  </>
                )}
                {!hasResponse && speakerIsTarget && (
                  <>
                    {/* eslint-disable-next-line local/no-inline-style -- dynamic complianceColor */}
                    <span style={{ fontWeight: 700, fontSize: '0.72rem', color: complianceColor }}>
                      {complianceIcon} No response
                    </span>
                    <div className="det-muted-2xs-mt2">
                      The debater did not provide an explicit response to this directive.
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Suppressed Intervention */}
      {suppressedIntervention ? (
        <div className="det-suppressed">
          <div className="det-row-g6-mb6">
            <span className="det-suppressed-title">
              {'⚠'} Suppressed Intervention
            </span>
            {suppressedIntervention.intervention_move && (
              <span className="det-warning-badge">
                {suppressedIntervention.intervention_move}
              </span>
            )}
          </div>
          <div className="det-primary-7-mb4">
            The moderator recommended a <strong>{suppressedIntervention.intervention_move ?? 'intervention'}</strong>
            {suppressedIntervention.intervention_target && (
              <> directed at <strong>{speakerLabel(suppressedIntervention.intervention_target)}</strong></>
            )}
            , but it was blocked by the engine.
          </div>
          <div className="det-suppressed-reason">
            <strong className="det-warning">Reason: </strong>
            {suppressedIntervention.intervention_suppressed_reason && (
              <span
                title={SUPPRESSION_REASON_TOOLTIPS[suppressedIntervention.intervention_suppressed_reason] ?? ''}
                className="det-suppressed-reason-label"
              >
                {String(suppressedIntervention.intervention_suppressed_reason ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
              </span>
            )}
            {suppressedIntervention.intervention_suppression_explanation
              ? (suppressedIntervention.intervention_suppressed_reason ? ' — ' : '') + suppressedIntervention.intervention_suppression_explanation
              : (!suppressedIntervention.intervention_suppressed_reason ? 'No reason recorded' : '')
            }
          </div>
          {suppressedIntervention.trigger_reasoning && (
            <div className="det-muted-2xs-mt4-italic">
              {suppressedIntervention.trigger_reasoning}
            </div>
          )}
        </div>
      ) : null}

      {/* Dialectical Moves */}
      {!!meta?.move_types && (
        <Section title={`Dialectical Moves — ${(meta.move_types as (string | MoveAnnotation)[]).map(m => getMoveName(m)).join(', ')}`} defaultOpen copyText={`Moves: ${(meta.move_types as (string | MoveAnnotation)[]).map(m => getMoveName(m)).join(', ')}${meta.disagreement_type ? `\nType: ${meta.disagreement_type}` : ''}`}>
          {(() => {
            const acceptedIds = new Set(diag?.extracted_claims?.accepted.map(c => c.id) ?? []);
            const claimTargets = (meta.my_claims as { claim: string; targets: string[] }[] | undefined) ?? [];
            const allClaimTargetIds = [...new Set(claimTargets.flatMap(c => c.targets ?? []))];
            return (meta.move_types as (string | MoveAnnotation)[]).map((m, i) => {
              const name = getMoveName(m);
              const ann = typeof m === 'object' ? m as MoveAnnotation : null;
              const edgeInfo = MOVE_EDGE_MAP[name.toUpperCase()] || MOVE_EDGE_MAP[name];
              const cat = edgeInfo?.edgeType || 'neutral';
              const catColor = cat === 'attack' ? 'var(--danger)' : cat === 'support' ? 'var(--success)' : '#888';
              const matchEdgeType = cat === 'attack' ? 'attacks' : cat === 'support' ? 'supports' : null;
              const inferredTargets: { id: string; type: 'supports' | 'attacks'; text?: string }[] = [];
              if (!ann?.target && an?.edges) {
                const turnEdges = (an.edges ?? []).filter(e =>
                  acceptedIds.has(e.source) && (matchEdgeType ? e.type === matchEdgeType : true)
                );
                const seen = new Set<string>();
                for (const e of turnEdges) {
                  if (!seen.has(e.target)) {
                    seen.add(e.target);
                    const tNode = an?.nodes?.find(n => n.id === e.target);
                    inferredTargets.push({ id: e.target, type: (e.type === 'revoice_of' ? 'supports' : e.type) as 'supports' | 'attacks', text: tNode?.text });
                  }
                }
                if (inferredTargets.length === 0) {
                  for (const tid of allClaimTargetIds) {
                    if (!seen.has(tid)) {
                      seen.add(tid);
                      const tNode = an?.nodes?.find(n => n.id === tid);
                      inferredTargets.push({ id: tid, type: matchEdgeType ?? 'supports', text: tNode?.text });
                    }
                  }
                }
              }
              return (
                // eslint-disable-next-line local/no-inline-style -- dynamic catColor border-left
                <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: `2px solid ${catColor}44` }}>
                  <span className="det-saf-badge">{name}</span>
                  {/* eslint-disable-next-line local/no-inline-style -- dynamic catColor background/color */}
                  <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: `${catColor}18`, color: catColor, fontSize: 'var(--text-2xs)', fontWeight: 600, textTransform: 'capitalize' }}>{cat}</span>
                  {ann?.target && (() => {
                    const targetNode = an?.nodes?.find(n => n.id === ann.target);
                    return (<>
                      <span className="det-ml6-muted-2xs">{'→'} {ann.target}</span>
                      {targetNode && <span className="det-ml4-muted-2xs-italic">"{targetNode.text.length > 100 ? targetNode.text.slice(0, 100) + '…' : targetNode.text}"</span>}
                    </>);
                  })()}
                  {!ann?.target && inferredTargets.length > 0 && (
                    <div className="det-inferred-targets">
                      <span className="det-muted-2xs">{'→'}</span>
                      {inferredTargets.map(t => (
                        // eslint-disable-next-line local/no-inline-style -- dynamic attack/support color
                        <span key={t.id} data-tooltip={t.text} style={{
                          padding: '1px 5px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, cursor: 'default',
                          background: `${t.type === 'attacks' ? 'var(--danger)' : 'var(--success)'}15`,
                          color: t.type === 'attacks' ? 'var(--danger)' : 'var(--success)',
                        }}>{t.id}</span>
                      ))}
                    </div>
                  )}
                  {!ann?.target && inferredTargets.length === 0 && (
                    <span className="det-ml6-muted-2xs-o6">no AN target</span>
                  )}
                  {ann?.detail && <div className="det-primary-7-mt2">{ann.detail}</div>}
                </div>
              );
            });
          })()}
          {meta.disagreement_type ? <div className="det-mt4">Type: <strong>{String(meta.disagreement_type)}</strong></div> : null}
        </Section>
      )}

      {/* Turn Validation */}
      {turnValTrail && (
        <Section
          title={`Turn Validation — ${turnValTrail.final.outcome} (score ${(turnValTrail.final.process_reward ?? 0).toFixed(2)}, ${turnValTrail.attempts.length} attempt${turnValTrail.attempts.length === 1 ? '' : 's'})`}
          defaultOpen
        >
          {/* Inline turn validation summary (lightweight version) */}
          <div className="det-fs-75">
            <div className="det-row-g8-mb4">
              {/* eslint-disable-next-line local/no-inline-style -- dynamic outcome-based background/color */}
              <span style={{
                padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontSize: '0.7rem',
                background: turnValTrail.final.outcome === 'pass' ? 'rgba(22,163,74,0.15)' : turnValTrail.final.outcome === 'accept_with_flag' ? 'color-mix(in srgb, var(--warning) 15%, transparent)' : 'rgba(220,38,38,0.15)',
                color: turnValTrail.final.outcome === 'pass' ? 'var(--success)' : turnValTrail.final.outcome === 'accept_with_flag' ? 'var(--warning)' : 'var(--danger)',
              }}>{turnValTrail.final.outcome}</span>
              <span>score <strong>{(turnValTrail.final.process_reward ?? 0).toFixed(2)}</strong></span>
              <span className="det-muted">{turnValTrail.attempts.length} attempt{turnValTrail.attempts.length === 1 ? '' : 's'}</span>
            </div>
            {turnValTrail.final.repairHints && turnValTrail.final.repairHints.length > 0 && (
              <div className="det-mt4">
                <strong>Caveats:</strong>
                <ul className="det-caveats-list">
                  {turnValTrail.final.repairHints.map((h, i) => {
                    const target = classifyHintTarget(h);
                    const ts = HINT_TARGET_STYLE[target];
                    return (
                      <li key={i} className="det-mb3">
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
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Commitments Injected */}
      {diag?.commitment_context && (
        <Section title="Commitments Injected" defaultOpen copyText={diag.commitment_context}>
          <ResizablePre tall text={diag.commitment_context} />
        </Section>
      )}

      {/* Edges Used */}
      {!!(diag as Record<string, unknown>)?.edges_used && ((diag as Record<string, unknown>).edges_used as { source: string; target: string; type: string; confidence: number }[]).length > 0 && (
        <Section title={`Edges Used (${((diag as Record<string, unknown>).edges_used as unknown[]).length})`} defaultOpen copyText={((diag as Record<string, unknown>).edges_used as { source: string; target: string; type: string; confidence: number }[]).map(e => `${e.source} ${e.type} ${e.target} (${(e.confidence ?? 0).toFixed(2)})`).join('\n')}>
          <EdgesUsedGrouped edges={(diag as Record<string, unknown>).edges_used as { source: string; target: string; type: string; confidence: number }[]} allEdges={allEdges} taxNodeMap={taxNodeMap} nodeLabels={nodeLabels} />
        </Section>
      )}

      {/* Key Assumptions */}
      {!!meta?.key_assumptions && (meta.key_assumptions as { assumption: string; if_wrong: string }[]).length > 0 && (
        <Section title={`Key Assumptions (${(meta.key_assumptions as unknown[]).length})`} defaultOpen copyText={(meta.key_assumptions as { assumption: string; if_wrong: string }[]).map(a => `Assumes: ${a.assumption}\nIf wrong: ${a.if_wrong}`).join('\n\n')}>
          {(meta.key_assumptions as { assumption: string; if_wrong: string }[]).map((a, i) => (
            <div key={i} className="det-assumption">
              <div><strong>Assumes:</strong> {a.assumption}</div>
              <div className="det-muted-7">If wrong: {a.if_wrong}</div>
            </div>
          ))}
        </Section>
      )}

      {/* Policy Refs */}
      {(() => {
        const rawPolRefs = (meta?.policy_refs as (string | { policy_id: string; relevance?: string })[] | undefined) || entry.policy_refs || [];
        const polIds = rawPolRefs.map(p => typeof p === 'string' ? p : p.policy_id);
        if (polIds.length === 0) return null;
        return (
        <Section title={`Policy Refs (${polIds.length})`} defaultOpen copyText={polIds.join(', ')}>
          <ul className="det-policy-list">
            {polIds.map((p, i) => {
              const pol = policyMap.get(p);
              return (
                <li key={i} className="det-policy-item">
                  <span className="det-policy-id">{p}</span>
                  {pol ? (
                    <span className="det-primary-72">
                      {pol.action}
                      <span className="det-ml6-muted-2xs">
                        ({pol.source_povs.join(', ')}{pol.member_count > 0 ? ` · ${pol.member_count} members` : ''})
                      </span>
                    </span>
                  ) : (
                    <span className="det-muted-72-italic">not in registry</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
        );
      })()}

      {/* Edge Tensions */}
      {diag?.edge_tensions && (
        <Section title="Edge Tensions" defaultOpen copyText={diag.edge_tensions}>
          <ResizablePre tall text={diag.edge_tensions} />
        </Section>
      )}

      {/* Argument Network Context */}
      {diag?.argument_network_context && (
        <Section title="Argument Network Context" defaultOpen copyText={diag.argument_network_context}>
          <ResizablePre tall text={diag.argument_network_context} />
        </Section>
      )}

      {/* Model & Timing */}
      {diag?.model && (
        <Section title={`Model & Timing — ${diag.model} (${diag.response_time_ms ? (diag.response_time_ms / 1000).toFixed(1) + 's' : '?'})`} defaultOpen copyText={`Model: ${diag.model}\nResponse: ${diag.response_time_ms ? (diag.response_time_ms / 1000).toFixed(1) + 's' : '?'}`}>
          <div>Model: {diag.model}</div>
          {diag.response_time_ms && <div>Response: {(diag.response_time_ms / 1000).toFixed(1)}s</div>}
        </Section>
      )}

      {/* Lineage Frame */}
      {(() => {
        const frame = debate.topic.critique?.lineage_frame;
        if (!frame || frame.length === 0) return null;
        const manifest = (entry.metadata as Record<string, unknown>)?.injection_manifest as {
          lineage_boost?: { boostedNodeIds?: string[]; promotedNodeIds?: string[] };
        } | undefined;
        const lb = manifest?.lineage_boost;
        const maxPct = Math.max(...frame.map((f: { percentage: number }) => f.percentage));
        return (
          <Section title={`Lineage Frame (${frame.length} categor${frame.length !== 1 ? 'ies' : 'y'})`} copyText={frame.map((f: { label?: string; cluster_id: string; percentage: number; traditions?: string[] }) => `${f.label ?? f.cluster_id}: ${f.percentage.toFixed(1)}%${f.traditions?.length ? ` (${f.traditions.join(', ')})` : ''}`).join('\n')}>
            {frame.map((f: { cluster_id: string; label?: string; percentage: number; traditions?: string[] }, i: number) => (
              <div key={i} className="det-mb6">
                <div className="det-row-g6">
                  <div className="det-lineage-label">{f.label ?? f.cluster_id}</div>
                  <div className="det-lineage-bar">
                    {/* eslint-disable-next-line local/no-inline-style -- dynamic computed width */}
                    <div style={{ width: `${maxPct > 0 ? (f.percentage / maxPct) * 100 : 0}%`, height: '100%', borderRadius: 3, background: 'var(--warning)' }} />
                  </div>
                  <div className="det-lineage-pct">{f.percentage.toFixed(1)}%</div>
                </div>
                {f.traditions && f.traditions.length > 0 && (
                  <div className="det-lineage-traditions">
                    {f.traditions.join(', ')}
                  </div>
                )}
              </div>
            ))}
            <div className="det-mt4-muted-2xs">
              Boost: {lb ? <span className="det-success">active</span> : <span>inactive</span>}
              {lb && lb.promotedNodeIds && lb.promotedNodeIds.length > 0 && (
                <> {'·'} {lb.promotedNodeIds.length} promoted</>
              )}
            </div>
          </Section>
        );
      })()}

      {/* Statement (opening entries) */}
      {entry.content && entry.type === 'opening' && (
        <Section title="Statement" defaultOpen copyText={entry.content}>
          <div className="det-statement">
            <Highlight text={entry.content} />
          </div>
        </Section>
      )}
    </div>
  );
}
