// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React, { useMemo } from 'react';
import { SUPPRESSION_REASON_TOOLTIPS } from './constants';
import type { ModeratorTraceData } from '../types';
import { TensionsListDetail } from './TensionsListDetail';
import { DebateExchangeRich } from './DebateExchangeRich';

export function ModeratorTab({ trace }: { trace: ModeratorTraceData }) {
  const sectionStyle: React.CSSProperties = { marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border)' };
  const headingStyle: React.CSSProperties = { fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#f97316', marginBottom: 6 };

  const promptSections = useMemo(() => {
    if (!trace.selection_prompt) return [];
    const sections: { title: string; content: string }[] = [];
    const text = trace.selection_prompt;

    const headingRe = /(?:^|\n)(?:={3,}\s*(.+?)\s*={3,}|##\s*(.+?))\s*\n/g;
    let lastIdx = 0;
    let lastTitle = 'System Prompt';
    let match;
    while ((match = headingRe.exec(text)) !== null) {
      const preceding = text.slice(lastIdx, match.index).trim();
      if (preceding) sections.push({ title: lastTitle, content: preceding });
      lastTitle = (match[1] || match[2]).replace(/\s*\(.*?\)\s*$/, '');
      lastIdx = match.index + match[0].length;
    }
    const remaining = text.slice(lastIdx).trim();
    if (remaining) sections.push({ title: lastTitle, content: remaining });
    return sections;
  }, [trace.selection_prompt]);

  return (
    <>
      {/* Decision summary */}
      <div style={sectionStyle}>
        <div style={headingStyle}>Decision</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.75rem', alignItems: 'center' }}>
          {trace.selected && (
            <div><strong>Selected:</strong> <span style={{ color: '#f97316', fontWeight: 700 }}>{trace.selected}</span></div>
          )}
          {trace.selection_reason && (
            <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(249,115,22,0.15)', color: '#f97316', fontSize: '0.62rem', fontWeight: 600 }}>
              {trace.selection_reason.replace(/_/g, ' ')}
            </span>
          )}
          {trace.excluded_last_speaker && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>excluded: {trace.excluded_last_speaker}</div>
          )}
        </div>
        {trace.focus_point && (
          <div style={{ marginTop: 6, fontSize: '0.75rem' }}>
            <strong>Focus:</strong> {trace.focus_point}
          </div>
        )}
      </div>

      {/* Candidates */}
      {trace.candidates && trace.candidates.length > 0 && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Candidate Ranking</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {trace.candidates.map((c, i) => (
              <div key={i} style={{
                padding: '6px 10px', borderRadius: 6, fontSize: '0.72rem',
                background: c.debater === trace.selected ? 'rgba(249,115,22,0.12)' : 'transparent',
                border: `1px solid ${c.debater === trace.selected ? '#f97316' : 'var(--border)'}`,
                fontWeight: c.debater === trace.selected ? 700 : 400,
              }}>
                <div>#{c.rank} {c.debater}</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {c.claim_count != null && <span>{c.claim_count} claim{c.claim_count !== 1 ? 's' : ''} in AN</span>}
                  {c.computed_strength != null && (
                    <span
                      title="QBAF post-propagation acceptability: average computed strength across this debater's claims after attack/support edges are applied. Higher = arguments are holding up well under challenge."
                      style={{ marginLeft: 6, cursor: 'default', borderBottom: '1px dotted var(--text-muted)' }}
                    >
                      QBAF: {c.computed_strength.toFixed(3)} ({c.scored_count ?? '?'} scored)
                    </span>
                  )}
                  {c.computed_strength == null && (c.claim_count ?? 0) > 0 && (
                    <span
                      title="QBAF strength propagation has not run yet. Strengths will appear after the debate engine computes post-propagation acceptability scores."
                      style={{ marginLeft: 6, fontStyle: 'italic', cursor: 'default' }}
                    >
                      (no QBAF scores yet)
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Convergence + Commitments */}
      {(trace.convergence_score != null || trace.commitment_snapshot) && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Debate State</div>
          {trace.convergence_score != null && (
            <div style={{ fontSize: '0.72rem', marginBottom: 4 }}>
              <strong
                title={'Convergence measures how much the debaters are moving toward agreement on the current issue.\n\nThree weighted signals:\n• Cross-speaker support ratio (40%): Of all cross-speaker edges in the argument network, what fraction are supports vs. attacks? More support edges = higher convergence.\n• Concession rate (35%): How many claims on this issue have been conceded? More concessions = debaters yielding ground.\n• Stance alignment (25%): How many speaker pairs have at least one mutual support edge? Measures breadth of agreement across all participants.\n\nScore range: 0% (pure opposition) → 50% (baseline/unknown) → 100% (full agreement).\nWhen convergence exceeds the threshold, the moderator may suggest exploring a new topic.'}
                style={{ cursor: 'default', borderBottom: '1px dotted var(--text-muted)' }}
              >Convergence:</strong> {(trace.convergence_score * 100).toFixed(0)}%
              {trace.convergence_triggered && <span style={{ color: '#22c55e', marginLeft: 6, fontWeight: 700 }}>TRIGGERED</span>}
            </div>
          )}
          {trace.commitment_snapshot && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.7rem' }}>
              {Object.entries(trace.commitment_snapshot).map(([name, c]) => (
                <div key={name} style={{ padding: '4px 8px', borderRadius: 4, background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{name}</div>
                  <div style={{ display: 'flex', gap: 8, fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                    <span>{c.asserted} asserted</span>
                    <span>{c.conceded} conceded</span>
                    <span>{c.challenged} challenged</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active Moderator State */}
      {(trace.health_score != null || trace.intervention_recommended || trace.budget_remaining != null) && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Active Moderator</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.72rem', marginBottom: 6 }}>
            {trace.health_score != null && (
              <div>
                <strong
                  title={'Composite debate health score (0.0–1.0). Weighted average of 5 components:\n• Engagement \xD70.25 — are debaters substantively engaging with each other\'s claims?\n• Novelty \xD70.25 — are debaters introducing new ideas rather than recycling?\n• Responsiveness \xD70.20 — are debaters taking concession opportunities when warranted?\n• Coverage \xD70.15 — what fraction of relevant taxonomy nodes have been cited?\n• Balance \xD70.15 — are all debaters getting roughly equal speaking time?\n\nComputed over a sliding window of the last 3 convergence signals.\nGreen (≥0.70): healthy debate. Amber (0.40–0.69): degrading. Red (<0.40): intervention likely needed.\nWhen a component drops below its SLI floor for 2+ consecutive turns, the moderator auto-triggers an intervention.'}
                  style={{ cursor: 'default', borderBottom: '1px dotted var(--text-muted)' }}
                >Health:</strong>{' '}
                <span style={{ color: trace.health_score >= 0.7 ? '#22c55e' : trace.health_score >= 0.4 ? '#f59e0b' : '#ef4444', fontWeight: 700 }}>
                  {trace.health_score.toFixed(2)}
                </span>
              </div>
            )}
            {trace.budget_remaining != null && trace.budget_total != null && (
              <div>
                <strong
                  title={'Intervention budget — how many moderator interventions remain.\n\nBudget = ceil(argumentation_rounds / 2.5). For a 20-round debate with ~17 argumentation rounds, budget ≈ 7.\nEach intervention (except COMMIT) consumes 1 budget unit.\nWhen budget reaches 0, no further interventions can fire (except off-budget COMMIT moves in concluding phase).\nThis prevents the moderator from over-intervening and dominating the debate.'}
                  style={{ cursor: 'default', borderBottom: '1px dotted var(--text-muted)' }}
                >Budget:</strong> {trace.budget_remaining}/{trace.budget_total}
              </div>
            )}
            {trace.cooldown_rounds_left != null && (
              <div>
                <strong
                  title={'Cooldown — minimum rounds that must pass before the next intervention.\n\nAfter an intervention fires, the moderator enforces a 1-round gap before acting again.\nExempt from cooldown: Reconciliation (ACKNOWLEDGE, REVOICE), Elicitation (PIN, PROBE, CHALLENGE), and COMMIT.\n\n"ready" = cooldown expired, moderator can intervene if triggered.\n"N round(s)" = must wait N more rounds before the next intervention.'}
                  style={{ cursor: 'default', borderBottom: '1px dotted var(--text-muted)' }}
                >Cooldown:</strong> {trace.cooldown_rounds_left > 0 ? `${trace.cooldown_rounds_left} round(s)` : 'ready'}
              </div>
            )}
          </div>
          {trace.health_components && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: '0.62rem', marginBottom: 6 }}>
              {Object.entries(trace.health_components).map(([k, v]) => {
                const tooltips: Record<string, string> = {
                  engagement: 'Engagement (weight: 0.25, SLI floor: 0.25)\n\nMeasures how substantively debaters engage with each other\'s claims.\nComputed as the average dialectical_engagement.ratio from the last 3 convergence signals.\ndialectical_engagement.ratio = fraction of prior claims that were directly addressed.\n\nLow engagement means debaters are talking past each other — triggers elicitation interventions (PIN, PROBE, CHALLENGE).',
                  novelty: 'Novelty (weight: 0.25, SLI floor: 0.25)\n\nMeasures whether debaters are introducing new ideas vs. recycling old arguments.\nComputed as: 1 − avg(argument_redundancy.avg_self_overlap) over the last 3 signals.\navg_self_overlap compares each statement to the speaker\'s own prior statements via cosine similarity.\n\nLow novelty means the debate is going in circles — triggers elicitation interventions.',
                  responsiveness: 'Responsiveness (weight: 0.20, SLI floor: 0.15)\n\nMeasures whether debaters take concession opportunities when warranted.\nComputed from convergence signals: of turns where a concession opportunity existed, what fraction were "taken" vs. "missed"?\nIf no concession opportunities arose, defaults to 1.0 (no penalty).\n\nLow responsiveness means debaters are ignoring valid challenges — triggers elicitation interventions.',
                  coverage: 'Coverage (weight: 0.15, SLI floor: 0.20)\n\nMeasures what fraction of relevant taxonomy nodes have been cited in the debate.\nComputed as: min(cited_node_count / relevant_node_count, 1.0).\nIf no relevant nodes exist, defaults to 1.0.\n\nLow coverage means the debate is ignoring important perspectives from the taxonomy — triggers procedural interventions (REDIRECT, BALANCE, SEQUENCE).',
                  balance: 'Balance (weight: 0.15, SLI floor: 0.30)\n\nMeasures whether all debaters are getting roughly equal speaking time.\nComputed as: 1 − (max_turns − min_turns) / total_turns.\n1.0 = perfectly balanced; 0.0 = one debater completely dominated.\n\nLow balance means one debater is being sidelined — triggers procedural interventions (BALANCE, REDIRECT).',
                };
                return (
                  <span key={k} title={tooltips[k] || k} style={{ padding: '1px 5px', borderRadius: 3, background: 'var(--bg-primary)', border: '1px solid var(--border)', cursor: 'default' }}>
                    {k}: {((v as number) ?? 0).toFixed(2)}
                  </span>
                );
              })}
            </div>
          )}
          {trace.burden_per_debater && Object.keys(trace.burden_per_debater).length > 0 && (
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 6 }}>
              <strong
                title={'Burden — cumulative intervention load per debater.\n\nEach intervention adds a burden weight based on its family:\n• Elicitation (PIN, PROBE, CHALLENGE): 1.0 — most disruptive\n• Synthesis (COMPRESS, COMMIT): 0.8\n• Repair (CLARIFY, CHECK, SUMMARIZE): 0.75\n• Reflection (META-REFLECT): 0.6\n• Procedural (REDIRECT, BALANCE, SEQUENCE): 0.5\n• Reconciliation (ACKNOWLEDGE, REVOICE): 0.25 — least disruptive\n\nBurden cap: if a debater\'s burden exceeds 1.5\xD7 the average burden, high-burden moves (weight > 0.5) against that debater are suppressed.\nThis prevents the moderator from repeatedly targeting the same debater.'}
                style={{ cursor: 'default', borderBottom: '1px dotted var(--text-muted)' }}
              >Burden:</strong>{' '}
              {Object.entries(trace.burden_per_debater).map(([d, b]) => `${d}: ${((b as number) ?? 0).toFixed(2)}`).join(', ')}
            </div>
          )}
          {trace.intervention_recommended && (
            <div style={{ marginTop: 4, padding: '6px 8px', borderRadius: 4, background: trace.intervention_validated ? 'rgba(139,92,246,0.1)' : 'rgba(239,68,68,0.08)', border: `1px solid ${trace.intervention_validated ? '#8b5cf6' : '#ef4444'}` }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: trace.intervention_validated ? '#8b5cf6' : '#ef4444' }}>
                {trace.intervention_validated ? 'Intervention Fired' : 'Intervention Suppressed'}
                {trace.intervention_move && `: ${trace.intervention_move}`}
                {trace.intervention_target && ` → ${trace.intervention_target}`}
              </div>
              {trace.intervention_suppressed_reason && !trace.intervention_validated && (
                <div style={{ fontSize: '0.7rem', color: '#d97706', marginTop: 3 }}>
                  <strong>Reason:</strong>{' '}
                  <span
                    title={SUPPRESSION_REASON_TOOLTIPS[trace.intervention_suppressed_reason] ?? ''}
                    style={{ cursor: 'default', borderBottom: '1px dotted #d97706' }}
                  >
                    {trace.intervention_suppressed_reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                  {trace.intervention_suppression_explanation && (
                    <span> &mdash; {trace.intervention_suppression_explanation}</span>
                  )}
                </div>
              )}
              {trace.trigger_reasoning && (
                <div style={{ fontSize: '0.65rem', marginTop: 4 }}>
                  <strong>Trigger:</strong> {trace.trigger_reasoning}
                </div>
              )}
              {trace.trigger_evidence && (
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  <span
                    title="Signal name — the moderator AI's label for the debate behavior that triggered this intervention recommendation. Common signals include: evasion (debater dodging a question), term_ambiguity (key term used with conflicting meanings), stagnation_crux (debate stuck on a crux point), unsupported_claim (assertion without evidence), scope_creep (discussion drifting from source material), contradiction (debater contradicting a prior position)."
                    style={{ cursor: 'default', borderBottom: '1px dotted var(--text-muted)' }}
                  >Signal:</span> {String((trace.trigger_evidence as Record<string, unknown>).signal_name ?? 'unknown')}
                  {!!(trace.trigger_evidence as Record<string, unknown>).observed_behavior && (
                    <span> &mdash; {String((trace.trigger_evidence as Record<string, unknown>).observed_behavior)}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Selection prompt sections */}
      {promptSections.length > 0 && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Context Sent to Moderator</div>
          {promptSections.map((s, i) => {
            const isTensions = /KNOWN TENSIONS/i.test(s.title);
            const isExchange = /RECENT DEBATE EXCHANGE/i.test(s.title);
            return (
              <details key={i} style={{ marginBottom: 4 }} open={i < 2}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', color: 'var(--text-primary)', padding: '3px 0' }}>
                  {s.title}
                  <span style={{ marginLeft: 6, fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                    {s.content.length > 500 ? `${(s.content.length / 1024).toFixed(1)}KB` : `${s.content.length} chars`}
                  </span>
                </summary>
                {isTensions ? <TensionsListDetail content={s.content} />
                  : isExchange ? <DebateExchangeRich content={s.content} />
                  : <pre style={{ fontSize: '0.68rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflow: 'auto', margin: '4px 0 8px', padding: '6px 8px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>{s.content}</pre>
                }
              </details>
            );
          })}
        </div>
      )}

      {/* Raw AI response */}
      {trace.selection_response && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Moderator Response</div>
          <pre style={{ fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto', margin: 0, padding: '6px 8px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>
            {trace.selection_response}
          </pre>
        </div>
      )}
    </>
  );
}
