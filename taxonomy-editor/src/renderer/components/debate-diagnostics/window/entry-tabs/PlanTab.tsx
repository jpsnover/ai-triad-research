// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import { humanizeSpeakerIds } from '../../../../utils/humanizeSpeakers';
import { Highlight, CopyButton } from '../helpers';
import { classifyHintTarget, HINT_TARGET_STYLE } from '../shared';
import { TaxonomyRefDetail, type TaxRefNode, type TaxRefEdge } from '../../../taxonomy/TaxonomyRefDetail';

export interface PlanTabProps {
  planStage: any;
  planAttempts: any[];
  taxNodeMap: Map<string, Record<string, unknown>>;
  allEdges: TaxRefEdge[];
  selectedTaxRefId: string | null;
  setSelectedTaxRefId: (id: string | null) => void;
}

export function PlanTab(props: PlanTabProps) {
  const { planStage, planAttempts, taxNodeMap, allEdges, selectedTaxRefId, setSelectedTaxRefId } = props;
  return (
    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
      {/* -- Top section: header + content from final plan -- */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(168,85,247,0.2)', color: '#a855f7', fontWeight: 600 }}>PLAN</span>
        <span>{planStage.model}</span>
        <span>temp={planStage.temperature}</span>
        <span>{(planStage.response_time_ms / 1000).toFixed(1)}s</span>
      </div>
      {/* Parse error banner */}
      {planStage.parse_error && (
        <div style={{ padding: '6px 8px', margin: '6px 0', background: 'rgba(220,38,38,0.1)', borderLeft: '3px solid #dc2626', borderRadius: 4, fontSize: '0.72rem', color: '#dc2626' }}>
          <strong>Parse error:</strong> {planStage.parse_error}
        </div>
      )}
      {/* Empty work_product fallback */}
      {!planStage.parse_error && planStage.work_product && Object.keys(planStage.work_product).length === 0 && (
        <div style={{ padding: '6px 8px', margin: '6px 0', background: 'rgba(245,158,11,0.1)', borderLeft: '3px solid #f59e0b', borderRadius: 4, fontSize: '0.72rem', color: '#d97706' }}>
          No structured plan data — expand Raw Response below to inspect the model output.
        </div>
      )}
      {/* Opponent Intelligence */}
      {(() => {
        const prompt = planStage.prompt ?? '';
        const oiStart = prompt.indexOf('=== OPPONENT INTELLIGENCE ===');
        if (oiStart === -1) return null;
        const afterHeader = prompt.slice(oiStart + '=== OPPONENT INTELLIGENCE ==='.length);
        const hintLines = afterHeader.split('\n').filter((l: string) => l.trim().startsWith('- '));
        if (hintLines.length === 0) return null;
        const hints = hintLines.map((l: string) => l.trim().slice(2));
        return (
          <details open>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: 600, fontSize: 'var(--text-2xs)' }}>OPPONENT INTELLIGENCE</span>
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontWeight: 400 }}>{hints.length} hint{hints.length !== 1 ? 's' : ''}</span>
            </summary>
            <div style={{ padding: '4px 8px', fontSize: '0.72rem' }}>
              {hints.map((h: string, i: number) => {
                const isTrap = h.includes('asserted') && h.includes('conceded');
                const isGap = h.includes('sparse coverage') || h.includes('knowledge gap');
                const isShift = h.includes('shifted') && (h.includes('cooperative') || h.includes('adversarial'));
                const typeLabel = isTrap ? 'TRAP' : isGap ? 'GAP' : isShift ? 'SHIFT' : 'HINT';
                const typeColor = isTrap ? '#dc2626' : isGap ? '#d97706' : isShift ? '#2563eb' : '#6b7280';
                return (
                  <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: `2px solid ${typeColor}40` }}>
                    <span style={{ display: 'inline-block', padding: '0 4px', borderRadius: 3, background: `${typeColor}15`, color: typeColor, fontSize: 'var(--text-2xs)', fontWeight: 600, marginRight: 6 }}>{typeLabel}</span>
                    <Highlight text={h} />
                  </div>
                );
              })}
            </div>
          </details>
        );
      })()}
      {/* Moderator Directive Response */}
      {(() => {
        const wp = planStage.work_product as Record<string, unknown>;
        const drp = wp.directive_response_plan as string | undefined;
        const dr = wp.directive_response as { directive: string; how_addressed: string } | undefined;
        if (!drp && !dr) return null;
        return (
          <div style={{ padding: 8, margin: '6px 0', borderLeft: '3px solid rgba(245,158,11,0.6)', background: 'rgba(245,158,11,0.08)', borderRadius: 4, fontSize: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(245,158,11,0.2)', color: '#d97706', fontWeight: 600, fontSize: 'var(--text-2xs)' }}>MODERATOR DIRECTIVE</span>
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
      {/* Strategic Goal */}
      {!!(planStage.work_product as Record<string, unknown>).strategic_goal && (
        <div style={{ padding: 8, margin: '6px 0', borderLeft: '3px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.05)', fontSize: '0.78rem', fontWeight: 600 }}>
          <Highlight text={String((planStage.work_product as Record<string, unknown>).strategic_goal)} />
        </div>
      )}
      {/* Core Thesis */}
      {!!(planStage.work_product as Record<string, unknown>).core_thesis && (
        <div style={{ padding: 8, margin: '6px 0', borderLeft: '3px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.05)', fontSize: '0.78rem' }}>
          <span style={{ fontWeight: 600, fontSize: '0.7rem' }}>Core Thesis: </span>
          <Highlight text={String((planStage.work_product as Record<string, unknown>).core_thesis)} />
        </div>
      )}
      {/* Framing Choices */}
      {!!(planStage.work_product as Record<string, unknown>).framing_choices && (
        <div style={{ padding: 8, margin: '6px 0', borderLeft: '3px solid rgba(168,85,247,0.3)', fontSize: '0.72rem' }}>
          <span style={{ fontWeight: 600, fontSize: '0.7rem' }}>Framing: </span>
          {Array.isArray((planStage.work_product as Record<string, unknown>).framing_choices)
            ? ((planStage.work_product as Record<string, unknown>).framing_choices as { frame: string; why: string }[]).map((fc, i) => (
              <div key={i} style={{ marginTop: i > 0 ? 6 : 2 }}>
                <strong>{fc.frame}</strong>
                {fc.why && <span style={{ opacity: 0.7 }}> — {fc.why}</span>}
              </div>
            ))
            : <Highlight text={String((planStage.work_product as Record<string, unknown>).framing_choices)} />
          }
        </div>
      )}
      {/* Planned Moves */}
      {Array.isArray((planStage.work_product as Record<string, unknown>).planned_moves) && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Planned Moves</summary>
          {((planStage.work_product as Record<string, unknown>).planned_moves as { move: string; target?: string; detail: string }[]).map((m, i) => (
            <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid rgba(168,85,247,0.3)' }}>
              <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, background: 'rgba(168,85,247,0.2)', color: '#a855f7', fontSize: '0.7rem', fontWeight: 600 }}>{m.move}</span>
              {m.target && <span style={{ marginLeft: 6, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{'→'} {m.target}</span>}
              {m.detail && <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginTop: 2 }}><Highlight text={m.detail} /></div>}
            </div>
          ))}
        </details>
      )}
      {/* Argumentation Structure */}
      {Array.isArray((planStage.work_product as Record<string, unknown>).argument_structure) && ((planStage.work_product as Record<string, unknown>).argument_structure as { point: string; evidence: string; taxonomy_anchor: string }[]).length > 0 && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Argumentation Structure</summary>
          {((planStage.work_product as Record<string, unknown>).argument_structure as { point: string; evidence: string; taxonomy_anchor: string }[]).map((s, i) => (
            <div key={i} style={{ margin: '4px 0', padding: '6px 8px', borderLeft: '2px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.03)', borderRadius: '0 4px 4px 0' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600 }}><Highlight text={s.point} /></div>
              {s.evidence && <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginTop: 2 }}><Highlight text={s.evidence} /></div>}
              {s.taxonomy_anchor && (
                <div style={{ marginTop: 3 }}>
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>Anchor: </span>
                  <button
                    onClick={() => setSelectedTaxRefId(selectedTaxRefId === s.taxonomy_anchor ? null : s.taxonomy_anchor)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'var(--text-2xs)' }}
                  >{s.taxonomy_anchor}</button>
                  {(() => { const lbl = (taxNodeMap.get(s.taxonomy_anchor!) as TaxRefNode | undefined)?.label; return lbl ? <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}> — {lbl}</span> : null; })()}
                </div>
              )}
            </div>
          ))}
        </details>
      )}
      {/* Argument Sketch */}
      {!!(planStage.work_product as Record<string, unknown>).argument_sketch && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Argument Sketch</summary>
          <div style={{ fontSize: '0.72rem', padding: 6, background: 'rgba(128,128,128,0.05)', borderRadius: 4 }}>
            <Highlight text={String((planStage.work_product as Record<string, unknown>).argument_sketch)} />
          </div>
        </details>
      )}
      {/* Anticipated Responses */}
      {Array.isArray((planStage.work_product as Record<string, unknown>).anticipated_responses) && ((planStage.work_product as Record<string, unknown>).anticipated_responses as string[]).length > 0 && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Anticipated Responses</summary>
          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
            {((planStage.work_product as Record<string, unknown>).anticipated_responses as string[]).map((r, i) => (
              <li key={i}><Highlight text={r} /></li>
            ))}
          </ul>
        </details>
      )}
      {/* Anticipated Challenges */}
      {Array.isArray((planStage.work_product as Record<string, unknown>).anticipated_challenges) && ((planStage.work_product as Record<string, unknown>).anticipated_challenges as string[]).length > 0 && (
        <details open><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', margin: '6px 0' }}>Anticipated Challenges</summary>
          <ul style={{ fontSize: '0.72rem', margin: '4px 0', paddingLeft: 16 }}>
            {((planStage.work_product as Record<string, unknown>).anticipated_challenges as string[]).map((r, i) => (
              <li key={i}><Highlight text={r} /></li>
            ))}
          </ul>
        </details>
      )}
      {/* -- Per-attempt sections -- */}
      {planAttempts.length > 0 && planAttempts.map((attempt, ai) => {
        const isSingle = planAttempts.length === 1;
        const isFinal = ai === planAttempts.length - 1;
        const valData = (attempt as Record<string, unknown>).stage_validation as { pass: boolean; hints: string[] } | undefined;
        const hints = valData?.hints ?? [];
        return (
          <div key={ai}>
            {/* Attempt separator — omit for single attempt */}
            {!isSingle && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 6px',
                fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontWeight: 600,
              }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span>Attempt {ai + 1}{isFinal ? ' (accepted)' : ' (rejected)'}</span>
                <span style={{ fontWeight: 400 }}>{(attempt.response_time_ms / 1000).toFixed(1)}s</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
            )}
            {/* Raw Prompt */}
            <details style={{ marginTop: isSingle ? 8 : 4 }}>
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
            {/* Validation pass/fail + per-rule details */}
            {valData && (
              <div style={{ marginTop: 4, fontSize: '0.7rem' }}>
                <span style={{
                  display: 'inline-block', fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '1px 6px',
                  borderRadius: 3, marginRight: 6,
                  color: valData.pass ? '#16a34a' : '#dc2626',
                  background: valData.pass ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                }}>{valData.pass ? '✓ Pass' : '✗ Fail'}</span>
                {/* Per-rule details (Plan stage) */}
                {(valData as { details?: { rule: string; pass: boolean; value?: string }[] }).details && (
                  <table style={{ marginTop: 4, fontSize: 'var(--text-2xs)', borderCollapse: 'collapse' }}>
                    <tbody>
                      {(valData as { details: { rule: string; pass: boolean; value?: string }[] }).details.map((d, di) => (
                        <tr key={di}>
                          <td style={{ padding: '1px 4px 1px 0', color: d.pass ? '#16a34a' : '#dc2626', width: 14 }}>{d.pass ? '✓' : '✗'}</td>
                          <td style={{ padding: '1px 6px 1px 0', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{d.rule}</td>
                          <td style={{ padding: '1px 0', color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--text-2xs)', whiteSpace: 'nowrap' }}>{d.value ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
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
