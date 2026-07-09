// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React, { useMemo } from 'react';
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
    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
      {/* Pipeline error banner */}
      {entry.type === 'statement' && diag && (diag.stage_diagnostics?.length ?? 0) > 0 && !diag.extracted_claims && !(diag as Record<string, unknown>).extraction_trace && (
        <div style={{
          marginBottom: 10, padding: '10px 12px', borderRadius: 6,
          background: 'color-mix(in srgb, var(--danger) 8%, transparent)', borderLeft: '3px solid var(--danger)',
          fontSize: '0.75rem',
        }}>
          <div style={{ fontWeight: 700, color: 'var(--danger)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Pipeline Error</div>
          <div style={{ color: 'var(--text-primary)', lineHeight: 1.5 }}>
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
              <div key={i} style={{
                marginBottom: 8, padding: '8px 10px', borderRadius: 5,
                background: 'color-mix(in srgb, var(--danger) 6%, transparent)', borderLeft: '3px solid var(--danger)',
                fontSize: '0.72rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    padding: '1px 6px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600,
                    background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)',
                  }}>{evt.error.name}</span>
                  {data?.speaker && (
                    <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                      {String(data.speaker)}{data.round ? ` R${data.round}` : ''}
                    </span>
                  )}
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginLeft: 'auto', fontFamily: 'monospace' }}>
                    {new Date(evt._wall).toLocaleTimeString()}
                  </span>
                </div>
                <div style={{ color: 'var(--text-primary)', lineHeight: 1.4 }}>{evt.error.message}</div>
                {evt.error.stack && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', cursor: 'pointer' }}>Stack trace</summary>
                    <pre style={{
                      fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', margin: '4px 0 0',
                      padding: '6px 8px', borderRadius: 3, background: 'var(--bg-secondary)',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 150, overflow: 'auto',
                    }}>{evt.error.stack}</pre>
                  </details>
                )}
              </div>
            );
          })}
        </Section>
      )}
      {/* Per-turn utility delta for this speaker */}
      {(() => {
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
            <span key={label} style={{ display: 'inline-flex', gap: 3, alignItems: 'baseline' }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
              <strong>{v.toFixed(3)}</strong>
              {dStr && <span style={{ fontSize: 'var(--text-2xs)', color: dColor }}>{dStr}</span>}
            </span>
          );
        };
        return (
          <div style={{
            marginBottom: 10, padding: '8px 10px', borderRadius: 5,
            background: `${color}08`, borderLeft: `3px solid ${color}`,
            fontSize: '0.72rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: '0.05em', color }}>Utility</span>
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{curr.composite.toFixed(3)}</span>
              {delta !== null && (
                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: deltaColor }}>
                  {delta >= 0 ? '+' : ''}{delta.toFixed(3)}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
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
          <div style={{
            marginBottom: 12, padding: '10px 12px', borderRadius: 6,
            background: 'color-mix(in srgb, var(--color-skp) 8%, transparent)', borderLeft: '3px solid var(--color-skp)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: 'var(--color-skp)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Moderator Directive
              </span>
              <span style={{ padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--color-skp) 15%, transparent)', color: 'var(--color-skp)', fontSize: 'var(--text-2xs)', fontWeight: 600 }}>
                {moveLabel}{familyLabel ? ` · ${familyLabel}` : ''}
              </span>
              {targetLabel && (
                <span style={{ fontSize: 'var(--text-2xs)', color: !speakerIsTarget ? 'var(--text-secondary)' : 'var(--text-muted)', fontWeight: !speakerIsTarget ? 600 : 400 }}>
                  directed at {targetLabel}{!speakerIsTarget ? ` (not ${speakerLabel(entry.speaker)})` : ''}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 8, fontStyle: 'italic' }}>
              &ldquo;{directiveText}&rdquo;
            </div>
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '6px 10px', borderRadius: 4,
              background: `${complianceColor}12`,
              border: `1px solid ${complianceColor}30`,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: complianceColor,
                flexShrink: 0, marginTop: 4,
              }} />
              <div>
                {hasResponse && (
                  <>
                    <span style={{ fontWeight: 700, fontSize: '0.72rem', color: complianceColor }}>
                      {complianceIcon} {isFromPlan ? 'Addressed in plan' : 'Responded'}
                    </span>
                    {isFromPlan && (
                      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 1 }}>
                        Structured response field missing &mdash; showing plan intent
                      </div>
                    )}
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginTop: 2 }}>
                      {formatResponseSummary()}
                    </div>
                  </>
                )}
                {!hasResponse && !speakerIsTarget && (
                  <>
                    <span style={{ fontWeight: 700, fontSize: '0.72rem', color: complianceColor }}>
                      {complianceIcon} Not targeted
                    </span>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                      This directive was aimed at {targetLabel}, but {speakerLabel(entry.speaker)} was selected to speak. {speakerLabel(entry.speaker)} was not required to respond.
                    </div>
                  </>
                )}
                {!hasResponse && speakerIsTarget && (
                  <>
                    <span style={{ fontWeight: 700, fontSize: '0.72rem', color: complianceColor }}>
                      {complianceIcon} No response
                    </span>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>
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
      {suppressedIntervention && (
        <div style={{
          marginBottom: 10, padding: '8px 10px', borderRadius: 6,
          background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--warning) 25%, transparent)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--warning)' }}>
              {'⚠'} Suppressed Intervention
            </span>
            {suppressedIntervention.intervention_move && (
              <span style={{
                padding: '1px 6px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600,
                background: 'color-mix(in srgb, var(--warning) 18%, transparent)', color: 'var(--warning)',
              }}>
                {suppressedIntervention.intervention_move}
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginBottom: 4 }}>
            The moderator recommended a <strong>{suppressedIntervention.intervention_move ?? 'intervention'}</strong>
            {suppressedIntervention.intervention_target && (
              <> directed at <strong>{speakerLabel(suppressedIntervention.intervention_target)}</strong></>
            )}
            , but it was blocked by the engine.
          </div>
          <div style={{
            fontSize: '0.7rem', color: 'var(--warning)', padding: '5px 10px', borderRadius: 4,
            background: 'color-mix(in srgb, var(--warning) 12%, transparent)', marginBottom: 4,
            borderLeft: '3px solid var(--warning)',
          }}>
            <strong style={{ color: 'var(--warning)' }}>Reason: </strong>
            {suppressedIntervention.intervention_suppressed_reason && (
              <span
                title={SUPPRESSION_REASON_TOOLTIPS[suppressedIntervention.intervention_suppressed_reason] ?? ''}
                style={{ cursor: 'default', borderBottom: '1px dotted var(--warning)' }}
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
            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
              {suppressedIntervention.trigger_reasoning}
            </div>
          )}
        </div>
      )}

      {/* Dialectical Moves */}
      {meta?.move_types && (
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
                    inferredTargets.push({ id: e.target, type: e.type, text: tNode?.text });
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
                <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: `2px solid ${catColor}44` }}>
                  <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--color-saf) 20%, transparent)', color: 'var(--color-saf)', fontSize: '0.7rem', fontWeight: 600 }}>{name}</span>
                  <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: `${catColor}18`, color: catColor, fontSize: 'var(--text-2xs)', fontWeight: 600, textTransform: 'capitalize' }}>{cat}</span>
                  {ann?.target && (() => {
                    const targetNode = an?.nodes?.find(n => n.id === ann.target);
                    return (<>
                      <span style={{ marginLeft: 6, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{'→'} {ann.target}</span>
                      {targetNode && <span style={{ marginLeft: 4, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>"{targetNode.text.length > 100 ? targetNode.text.slice(0, 100) + '…' : targetNode.text}"</span>}
                    </>);
                  })()}
                  {!ann?.target && inferredTargets.length > 0 && (
                    <div style={{ marginTop: 3, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{'→'}</span>
                      {inferredTargets.map(t => (
                        <span key={t.id} data-tooltip={t.text} style={{
                          padding: '1px 5px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, cursor: 'default',
                          background: `${t.type === 'attacks' ? 'var(--danger)' : 'var(--success)'}15`,
                          color: t.type === 'attacks' ? 'var(--danger)' : 'var(--success)',
                        }}>{t.id}</span>
                      ))}
                    </div>
                  )}
                  {!ann?.target && inferredTargets.length === 0 && (
                    <span style={{ marginLeft: 6, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', opacity: 0.6 }}>no AN target</span>
                  )}
                  {ann?.detail && <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginTop: 2 }}>{ann.detail}</div>}
                </div>
              );
            });
          })()}
          {meta.disagreement_type && <div style={{ marginTop: 4 }}>Type: <strong>{meta.disagreement_type as string}</strong></div>}
        </Section>
      )}

      {/* Turn Validation */}
      {turnValTrail && (
        <Section
          title={`Turn Validation — ${turnValTrail.final.outcome} (score ${(turnValTrail.final.process_reward ?? 0).toFixed(2)}, ${turnValTrail.attempts.length} attempt${turnValTrail.attempts.length === 1 ? '' : 's'})`}
          defaultOpen
        >
          {/* Inline turn validation summary (lightweight version) */}
          <div style={{ fontSize: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{
                padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontSize: '0.7rem',
                background: turnValTrail.final.outcome === 'pass' ? 'rgba(22,163,74,0.15)' : turnValTrail.final.outcome === 'accept_with_flag' ? 'color-mix(in srgb, var(--warning) 15%, transparent)' : 'rgba(220,38,38,0.15)',
                color: turnValTrail.final.outcome === 'pass' ? 'var(--success)' : turnValTrail.final.outcome === 'accept_with_flag' ? 'var(--warning)' : 'var(--danger)',
              }}>{turnValTrail.final.outcome}</span>
              <span>score <strong>{(turnValTrail.final.process_reward ?? 0).toFixed(2)}</strong></span>
              <span style={{ color: 'var(--text-muted)' }}>{turnValTrail.attempts.length} attempt{turnValTrail.attempts.length === 1 ? '' : 's'}</span>
            </div>
            {turnValTrail.final.repairHints && turnValTrail.final.repairHints.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <strong>Caveats:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {turnValTrail.final.repairHints.map((h, i) => {
                    const target = classifyHintTarget(h);
                    const ts = HINT_TARGET_STYLE[target];
                    return (
                      <li key={i} style={{ marginBottom: 3 }}>
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
      {(diag as Record<string, unknown>)?.edges_used && ((diag as Record<string, unknown>).edges_used as { source: string; target: string; type: string; confidence: number }[]).length > 0 && (
        <Section title={`Edges Used (${((diag as Record<string, unknown>).edges_used as unknown[]).length})`} defaultOpen copyText={((diag as Record<string, unknown>).edges_used as { source: string; target: string; type: string; confidence: number }[]).map(e => `${e.source} ${e.type} ${e.target} (${(e.confidence ?? 0).toFixed(2)})`).join('\n')}>
          <EdgesUsedGrouped edges={(diag as Record<string, unknown>).edges_used as { source: string; target: string; type: string; confidence: number }[]} allEdges={allEdges} taxNodeMap={taxNodeMap} nodeLabels={nodeLabels} />
        </Section>
      )}

      {/* Key Assumptions */}
      {meta?.key_assumptions && (meta.key_assumptions as { assumption: string; if_wrong: string }[]).length > 0 && (
        <Section title={`Key Assumptions (${(meta.key_assumptions as unknown[]).length})`} defaultOpen copyText={(meta.key_assumptions as { assumption: string; if_wrong: string }[]).map(a => `Assumes: ${a.assumption}\nIf wrong: ${a.if_wrong}`).join('\n\n')}>
          {(meta.key_assumptions as { assumption: string; if_wrong: string }[]).map((a, i) => (
            <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>
              <div><strong>Assumes:</strong> {a.assumption}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>If wrong: {a.if_wrong}</div>
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
          <ul style={{ margin: '4px 0', paddingLeft: 0, listStyle: 'none' }}>
            {polIds.map((p, i) => {
              const pol = policyMap.get(p);
              return (
                <li key={i} style={{ margin: '3px 0', display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)', color: 'var(--text-secondary)', fontSize: 'var(--text-2xs)', fontWeight: 600, fontFamily: 'monospace' }}>{p}</span>
                  {pol ? (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-primary)' }}>
                      {pol.action}
                      <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}>
                        ({pol.source_povs.join(', ')}{pol.member_count > 0 ? ` · ${pol.member_count} members` : ''})
                      </span>
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>not in registry</span>
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
              <div key={i} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{f.label ?? f.cluster_id}</div>
                  <div style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden', flexShrink: 0 }}>
                    <div style={{ width: `${maxPct > 0 ? (f.percentage / maxPct) * 100 : 0}%`, height: '100%', borderRadius: 3, background: 'var(--warning)' }} />
                  </div>
                  <div style={{ width: 36, textAlign: 'right', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', flexShrink: 0 }}>{f.percentage.toFixed(1)}%</div>
                </div>
                {f.traditions && f.traditions.length > 0 && (
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2, paddingLeft: 4 }}>
                    {f.traditions.join(', ')}
                  </div>
                )}
              </div>
            ))}
            <div style={{ marginTop: 4, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
              Boost: {lb ? <span style={{ color: 'var(--success)' }}>active</span> : <span>inactive</span>}
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
          <div style={{ fontSize: '0.75rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            <Highlight text={entry.content} />
          </div>
        </Section>
      )}
    </div>
  );
}
