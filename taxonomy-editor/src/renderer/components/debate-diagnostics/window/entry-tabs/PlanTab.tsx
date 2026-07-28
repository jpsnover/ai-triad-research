// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import { humanizeSpeakerIds } from '../../../../utils/humanizeSpeakers';
import { Highlight, CopyButton } from '../helpers';
import { classifyHintTarget, HINT_TARGET_STYLE } from '../shared';
import { TaxonomyRefDetail, type TaxRefNode, type TaxRefEdge } from '../../../taxonomy/TaxonomyRefDetail';
import './PlanTab.css';

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
    <div className="plan-root">
      {/* -- Top section: header + content from final plan -- */}
      <div className="plan-header">
        <span className="plan-badge">PLAN</span>
        <span>{planStage.model}</span>
        <span>temp={planStage.temperature}</span>
        <span>{(planStage.response_time_ms / 1000).toFixed(1)}s</span>
      </div>
      {/* Parse error banner */}
      {planStage.parse_error && (
        <div className="plan-parse-error">
          <strong>Parse error:</strong> {planStage.parse_error}
        </div>
      )}
      {/* Empty work_product fallback */}
      {!planStage.parse_error && planStage.work_product && Object.keys(planStage.work_product).length === 0 && (
        <div className="plan-empty-warning">
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
            <summary className="plan-oi-summary">
              <span className="plan-oi-badge">OPPONENT INTELLIGENCE</span>
              <span className="plan-oi-count">{hints.length} hint{hints.length !== 1 ? 's' : ''}</span>
            </summary>
            <div className="plan-oi-body">
              {hints.map((h: string, i: number) => {
                const isTrap = h.includes('asserted') && h.includes('conceded');
                const isGap = h.includes('sparse coverage') || h.includes('knowledge gap');
                const isShift = h.includes('shifted') && (h.includes('cooperative') || h.includes('adversarial'));
                const typeLabel = isTrap ? 'TRAP' : isGap ? 'GAP' : isShift ? 'SHIFT' : 'HINT';
                const typeColor = isTrap ? 'var(--danger)' : isGap ? 'var(--warning)' : isShift ? 'var(--text-secondary)' : 'var(--text-muted)';
                return (
                  // eslint-disable-next-line local/no-inline-style -- dynamic borderLeft color from typeColor
                  <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: `2px solid ${typeColor}40` }}>
                    {/* eslint-disable-next-line local/no-inline-style -- dynamic background/color from typeColor */}
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
          <div className="plan-directive">
            <div className="plan-directive-head">
              <span className="plan-directive-badge">MODERATOR DIRECTIVE</span>
            </div>
            {dr && (
              <>
                <div className="plan-mb4"><strong>Directive:</strong> <Highlight text={dr.directive} /></div>
                <div><strong>How addressed:</strong> <Highlight text={dr.how_addressed} /></div>
              </>
            )}
            {drp && !dr && <Highlight text={String(drp)} />}
          </div>
        );
      })()}
      {/* Strategic Goal */}
      {!!(planStage.work_product as Record<string, unknown>).strategic_goal && (
        <div className="plan-strategic-goal">
          <Highlight text={String((planStage.work_product as Record<string, unknown>).strategic_goal)} />
        </div>
      )}
      {/* Core Thesis */}
      {!!(planStage.work_product as Record<string, unknown>).core_thesis && (
        <div className="plan-core-thesis">
          <span className="plan-label">Core Thesis: </span>
          <Highlight text={String((planStage.work_product as Record<string, unknown>).core_thesis)} />
        </div>
      )}
      {/* Framing Choices */}
      {!!(planStage.work_product as Record<string, unknown>).framing_choices && (
        <div className="plan-framing">
          <span className="plan-label">Framing: </span>
          {Array.isArray((planStage.work_product as Record<string, unknown>).framing_choices)
            ? ((planStage.work_product as Record<string, unknown>).framing_choices as { frame: string; why: string }[]).map((fc, i) => (
              // eslint-disable-next-line local/no-inline-style -- dynamic marginTop from index
              <div key={i} style={{ marginTop: i > 0 ? 6 : 2 }}>
                <strong>{fc.frame}</strong>
                {fc.why && <span className="plan-why"> — {fc.why}</span>}
              </div>
            ))
            : <Highlight text={String((planStage.work_product as Record<string, unknown>).framing_choices)} />
          }
        </div>
      )}
      {/* Planned Moves */}
      {Array.isArray((planStage.work_product as Record<string, unknown>).planned_moves) && (
        <details open><summary className="plan-section-summary">Planned Moves</summary>
          {((planStage.work_product as Record<string, unknown>).planned_moves as { move: string; target?: string; detail: string }[]).map((m, i) => (
            <div key={i} className="plan-move">
              <span className="plan-move-badge">{m.move}</span>
              {m.target && <span className="plan-move-target">{'→'} {m.target}</span>}
              {m.detail && <div className="plan-detail-text"><Highlight text={m.detail} /></div>}
            </div>
          ))}
        </details>
      )}
      {/* Argumentation Structure */}
      {Array.isArray((planStage.work_product as Record<string, unknown>).argument_structure) && ((planStage.work_product as Record<string, unknown>).argument_structure as { point: string; evidence: string; taxonomy_anchor: string }[]).length > 0 && (
        <details open><summary className="plan-section-summary">Argumentation Structure</summary>
          {((planStage.work_product as Record<string, unknown>).argument_structure as { point: string; evidence: string; taxonomy_anchor: string }[]).map((s, i) => (
            <div key={i} className="plan-arg">
              <div className="plan-arg-point"><Highlight text={s.point} /></div>
              {s.evidence && <div className="plan-detail-text"><Highlight text={s.evidence} /></div>}
              {s.taxonomy_anchor && (
                <div className="plan-mt3">
                  <span className="plan-muted-2xs">Anchor: </span>
                  <button
                    onClick={() => setSelectedTaxRefId(selectedTaxRefId === s.taxonomy_anchor ? null : s.taxonomy_anchor)}
                    className="plan-anchor-btn"
                  >{s.taxonomy_anchor}</button>
                  {(() => { const lbl = (taxNodeMap.get(s.taxonomy_anchor!) as TaxRefNode | undefined)?.label; return lbl ? <span className="plan-muted-2xs"> — {lbl}</span> : null; })()}
                </div>
              )}
            </div>
          ))}
        </details>
      )}
      {/* Argument Sketch */}
      {!!(planStage.work_product as Record<string, unknown>).argument_sketch && (
        <details open><summary className="plan-section-summary">Argument Sketch</summary>
          <div className="plan-sketch">
            <Highlight text={String((planStage.work_product as Record<string, unknown>).argument_sketch)} />
          </div>
        </details>
      )}
      {/* Anticipated Responses */}
      {Array.isArray((planStage.work_product as Record<string, unknown>).anticipated_responses) && ((planStage.work_product as Record<string, unknown>).anticipated_responses as string[]).length > 0 && (
        <details open><summary className="plan-section-summary">Anticipated Responses</summary>
          <ul className="plan-list">
            {((planStage.work_product as Record<string, unknown>).anticipated_responses as string[]).map((r, i) => (
              <li key={i}><Highlight text={r} /></li>
            ))}
          </ul>
        </details>
      )}
      {/* Anticipated Challenges */}
      {Array.isArray((planStage.work_product as Record<string, unknown>).anticipated_challenges) && ((planStage.work_product as Record<string, unknown>).anticipated_challenges as string[]).length > 0 && (
        <details open><summary className="plan-section-summary">Anticipated Challenges</summary>
          <ul className="plan-list">
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
              <div className="plan-attempt-sep">
                <div className="plan-sep-line" />
                <span>Attempt {ai + 1}{isFinal ? ' (accepted)' : ' (rejected)'}</span>
                <span className="plan-fw400">{(attempt.response_time_ms / 1000).toFixed(1)}s</span>
                <div className="plan-sep-line" />
              </div>
            )}
            {/* Raw Prompt */}
            {/* eslint-disable-next-line local/no-inline-style -- dynamic marginTop from isSingle */}
            <details style={{ marginTop: isSingle ? 8 : 4 }}>
              <summary className="plan-raw-summary">
                Raw Prompt <CopyButton text={attempt.prompt} />
              </summary>
              <pre className="plan-raw-pre">{attempt.prompt}</pre>
            </details>
            {/* Raw Response */}
            <details>
              <summary className="plan-raw-summary">
                Raw Response <CopyButton text={attempt.raw_response} />
              </summary>
              <pre className="plan-raw-pre">{attempt.raw_response}</pre>
            </details>
            {/* Validation pass/fail + per-rule details */}
            {valData && (
              <div className="plan-val">
                {/* eslint-disable-next-line local/no-inline-style -- dynamic color/background from valData.pass */}
                <span style={{
                  display: 'inline-block', fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '1px 6px',
                  borderRadius: 3, marginRight: 6,
                  color: valData.pass ? 'var(--success)' : 'var(--danger)',
                  background: valData.pass ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                }}>{valData.pass ? '✓ Pass' : '✗ Fail'}</span>
                {/* Per-rule details (Plan stage) */}
                {(valData as unknown as { details?: { rule: string; pass: boolean; value?: string }[] }).details && (
                  <table className="plan-val-table">
                    <tbody>
                      {(valData as unknown as { details: { rule: string; pass: boolean; value?: string }[] }).details.map((d, di) => (
                        <tr key={di}>
                          {/* eslint-disable-next-line local/no-inline-style -- dynamic color from d.pass */}
                          <td style={{ padding: '1px 4px 1px 0', color: d.pass ? 'var(--success)' : 'var(--danger)', width: 14 }}>{d.pass ? '✓' : '✗'}</td>
                          <td className="plan-val-rule">{d.rule}</td>
                          <td className="plan-val-value">{d.value ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            {hints.length > 0 && (
              <details open className="plan-val-feedback">
                <summary className="plan-feedback-summary">Validation Feedback</summary>
                <ul className="plan-feedback-list">
                  {hints.map((h, hi) => {
                    const target = classifyHintTarget(h);
                    const ts = HINT_TARGET_STYLE[target];
                    return (
                      <li key={hi} className="plan-mb3">
                        {/* eslint-disable-next-line local/no-inline-style -- dynamic color/background from ts */}
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
