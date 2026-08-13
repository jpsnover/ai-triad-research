// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React, { useMemo } from 'react';
import { SUPPRESSION_REASON_TOOLTIPS } from './constants';
import type { ModeratorTraceData } from '../types';
import { TensionsListDetail } from './TensionsListDetail';
import { DebateExchangeRich } from './DebateExchangeRich';
import './ModeratorTab.css';

type PromptSection = { title: string; content: string };
type Candidate = NonNullable<ModeratorTraceData['candidates']>[number];

const HEALTH_COMPONENT_TOOLTIPS: Record<string, string> = {
  engagement: 'Engagement (weight: 0.25, SLI floor: 0.25)\n\nMeasures how substantively debaters engage with each other\'s claims.\nComputed as the average dialectical_engagement.ratio from the last 3 convergence signals.\ndialectical_engagement.ratio = fraction of prior claims that were directly addressed.\n\nLow engagement means debaters are talking past each other — triggers elicitation interventions (PIN, PROBE, CHALLENGE).',
  novelty: 'Novelty (weight: 0.25, SLI floor: 0.25)\n\nMeasures whether debaters are introducing new ideas vs. recycling old arguments.\nComputed as: 1 − avg(argument_redundancy.avg_self_overlap) over the last 3 signals.\navg_self_overlap compares each statement to the speaker\'s own prior statements via cosine similarity.\n\nLow novelty means the debate is going in circles — triggers elicitation interventions.',
  responsiveness: 'Responsiveness (weight: 0.20, SLI floor: 0.15)\n\nMeasures whether debaters take concession opportunities when warranted.\nComputed from convergence signals: of turns where a concession opportunity existed, what fraction were "taken" vs. "missed"?\nIf no concession opportunities arose, defaults to 1.0 (no penalty).\n\nLow responsiveness means debaters are ignoring valid challenges — triggers elicitation interventions.',
  coverage: 'Coverage (weight: 0.15, SLI floor: 0.20)\n\nMeasures what fraction of relevant taxonomy nodes have been cited in the debate.\nComputed as: min(cited_node_count / relevant_node_count, 1.0).\nIf no relevant nodes exist, defaults to 1.0.\n\nLow coverage means the debate is ignoring important perspectives from the taxonomy — triggers procedural interventions (REDIRECT, BALANCE, SEQUENCE).',
  balance: 'Balance (weight: 0.15, SLI floor: 0.30)\n\nMeasures whether all debaters are getting roughly equal speaking time.\nComputed as: 1 − (max_turns − min_turns) / total_turns.\n1.0 = perfectly balanced; 0.0 = one debater completely dominated.\n\nLow balance means one debater is being sidelined — triggers procedural interventions (BALANCE, REDIRECT).',
};

function parsePromptSections(selectionPrompt: string | undefined): PromptSection[] {
  if (!selectionPrompt) return [];
  const sections: PromptSection[] = [];
  const text = selectionPrompt;

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
}

function DecisionSection({ trace }: { trace: ModeratorTraceData }) {
  return (
    <div className="mod-tab-section">
      <div className="mod-tab-heading">Decision</div>
      <div className="mod-tab-decision-row">
        {trace.selected && (
          <div><strong>Selected:</strong> <span className="mod-tab-decision-selected">{trace.selected}</span></div>
        )}
        {trace.selection_reason && (
          <span className="mod-tab-decision-reason">
            {trace.selection_reason.replace(/_/g, ' ')}
          </span>
        )}
        {trace.excluded_last_speaker && (
          <div className="mod-tab-decision-excluded">excluded: {trace.excluded_last_speaker}</div>
        )}
      </div>
      {trace.focus_point && (
        <div className="mod-tab-decision-focus">
          <strong>Focus:</strong> {trace.focus_point}
        </div>
      )}
    </div>
  );
}

function CandidateCard({ c, selected }: { c: Candidate; selected: ModeratorTraceData['selected'] }) {
  return (
    // eslint-disable-next-line local/no-inline-style -- selected-state drives background, border, and fontWeight
    <div className="mod-tab-candidate-card" style={{
      background: c.debater === selected ? 'color-mix(in srgb, var(--color-acc) 12%, transparent)' : 'transparent',
      border: `1px solid ${c.debater === selected ? 'var(--color-acc)' : 'var(--border-color)'}`,
      fontWeight: c.debater === selected ? 700 : 400,
    }}>
      <div>#{c.rank} {c.debater}</div>
      <div className="mod-tab-candidate-meta">
        {c.claim_count != null && <span>{c.claim_count} claim{c.claim_count !== 1 ? 's' : ''} in AN</span>}
        {c.computed_strength != null && (
          <span
            title="QBAF post-propagation acceptability: average computed strength across this debater's claims after attack/support edges are applied. Higher = arguments are holding up well under challenge."
            className="mod-tab-candidate-qbaf"
          >
            QBAF: {c.computed_strength.toFixed(3)} ({c.scored_count ?? '?'} scored)
          </span>
        )}
        {c.computed_strength == null && (c.claim_count ?? 0) > 0 && (
          <span
            title="QBAF strength propagation has not run yet. Strengths will appear after the debate engine computes post-propagation acceptability scores."
            className="mod-tab-candidate-no-qbaf"
          >
            (no QBAF scores yet)
          </span>
        )}
      </div>
    </div>
  );
}

function CandidatesSection({ trace }: { trace: ModeratorTraceData }) {
  if (!(trace.candidates && trace.candidates.length > 0)) return null;
  return (
    <div className="mod-tab-section">
      <div className="mod-tab-heading">Candidate Ranking</div>
      <div className="mod-tab-candidates-flex">
        {trace.candidates.map((c, i) => (
          <CandidateCard key={i} c={c} selected={trace.selected} />
        ))}
      </div>
    </div>
  );
}

function DebateStateSection({ trace }: { trace: ModeratorTraceData }) {
  if (!(trace.convergence_score != null || trace.commitment_snapshot)) return null;
  return (
    <div className="mod-tab-section">
      <div className="mod-tab-heading">Debate State</div>
      {trace.convergence_score != null && (
        <div className="mod-tab-debate-state-conv">
          <strong
            title={'Convergence measures how much the debaters are moving toward agreement on the current issue.\n\nThree weighted signals:\n• Cross-speaker support ratio (40%): Of all cross-speaker edges in the argument network, what fraction are supports vs. attacks? More support edges = higher convergence.\n• Concession rate (35%): How many claims on this issue have been conceded? More concessions = debaters yielding ground.\n• Stance alignment (25%): How many speaker pairs have at least one mutual support edge? Measures breadth of agreement across all participants.\n\nScore range: 0% (pure opposition) → 50% (baseline/unknown) → 100% (full agreement).\nWhen convergence exceeds the threshold, the moderator may suggest exploring a new topic.'}
            className="mod-tab-tooltip-trigger"
          >Convergence:</strong> {(trace.convergence_score * 100).toFixed(0)}%
          {trace.convergence_triggered && <span className="mod-tab-conv-triggered">TRIGGERED</span>}
        </div>
      )}
      {trace.commitment_snapshot && (
        <div className="mod-tab-commitment-list">
          {Object.entries(trace.commitment_snapshot).map(([name, c]) => (
            <div key={name} className="mod-tab-commitment-entry">
              <div className="mod-tab-commitment-name">{name}</div>
              <div className="mod-tab-commitment-stats">
                <span>{c.asserted} asserted</span>
                <span>{c.conceded} conceded</span>
                <span>{c.challenged} challenged</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModeratorMetricsRow({ trace }: { trace: ModeratorTraceData }) {
  return (
    <div className="mod-tab-metrics-row">
      {trace.health_score != null && (
        <div>
          <strong
            title={'Composite debate health score (0.0–1.0). Weighted average of 5 components:\n• Engagement \xD70.25 — are debaters substantively engaging with each other\'s claims?\n• Novelty \xD70.25 — are debaters introducing new ideas rather than recycling?\n• Responsiveness \xD70.20 — are debaters taking concession opportunities when warranted?\n• Coverage \xD70.15 — what fraction of relevant taxonomy nodes have been cited?\n• Balance \xD70.15 — are all debaters getting roughly equal speaking time?\n\nComputed over a sliding window of the last 3 convergence signals.\nGreen (≥0.70): healthy debate. Amber (0.40–0.69): degrading. Red (<0.40): intervention likely needed.\nWhen a component drops below its SLI floor for 2+ consecutive turns, the moderator auto-triggers an intervention.'}
            className="mod-tab-tooltip-trigger"
          >Health:</strong>{' '}
          {/* eslint-disable-next-line local/no-inline-style -- score-driven color */}
          <span className="mod-tab-health-value" style={{ color: trace.health_score >= 0.7 ? 'var(--success)' : trace.health_score >= 0.4 ? 'var(--warning)' : 'var(--danger)' }}>
            {trace.health_score.toFixed(2)}
          </span>
        </div>
      )}
      {trace.budget_remaining != null && trace.budget_total != null && (
        <div>
          <strong
            title={'Intervention budget — how many moderator interventions remain.\n\nBudget = ceil(argumentation_rounds / 2.5). For a 20-round debate with ~17 argumentation rounds, budget ≈ 7.\nEach intervention (except COMMIT) consumes 1 budget unit.\nWhen budget reaches 0, no further interventions can fire (except off-budget COMMIT moves in concluding phase).\nThis prevents the moderator from over-intervening and dominating the debate.'}
            className="mod-tab-tooltip-trigger"
          >Budget:</strong> {trace.budget_remaining}/{trace.budget_total}
        </div>
      )}
      {trace.cooldown_rounds_left != null && (
        <div>
          <strong
            title={'Cooldown — minimum rounds that must pass before the next intervention.\n\nAfter an intervention fires, the moderator enforces a 1-round gap before acting again.\nExempt from cooldown: Reconciliation (ACKNOWLEDGE, REVOICE), Elicitation (PIN, PROBE, CHALLENGE), and COMMIT.\n\n"ready" = cooldown expired, moderator can intervene if triggered.\n"N round(s)" = must wait N more rounds before the next intervention.'}
            className="mod-tab-tooltip-trigger"
          >Cooldown:</strong> {trace.cooldown_rounds_left > 0 ? `${trace.cooldown_rounds_left} round(s)` : 'ready'}
        </div>
      )}
    </div>
  );
}

function HealthComponentChip({ k, v }: { k: string; v: unknown }) {
  return (
    <span title={HEALTH_COMPONENT_TOOLTIPS[k] || k} className="mod-tab-health-chip">
      {k}: {((v as number) ?? 0).toFixed(2)}
    </span>
  );
}

function HealthComponentsRow({ trace }: { trace: ModeratorTraceData }) {
  if (!trace.health_components) return null;
  return (
    <div className="mod-tab-health-components-row">
      {Object.entries(trace.health_components).map(([k, v]) => (
        <HealthComponentChip key={k} k={k} v={v} />
      ))}
    </div>
  );
}

function BurdenRow({ trace }: { trace: ModeratorTraceData }) {
  if (!(trace.burden_per_debater && Object.keys(trace.burden_per_debater).length > 0)) return null;
  return (
    <div className="mod-tab-burden-row">
      <strong
        title={'Burden — cumulative intervention load per debater.\n\nEach intervention adds a burden weight based on its family:\n• Elicitation (PIN, PROBE, CHALLENGE): 1.0 — most disruptive\n• Synthesis (COMPRESS, COMMIT): 0.8\n• Repair (CLARIFY, CHECK, SUMMARIZE): 0.75\n• Reflection (META-REFLECT): 0.6\n• Procedural (REDIRECT, BALANCE, SEQUENCE): 0.5\n• Reconciliation (ACKNOWLEDGE, REVOICE): 0.25 — least disruptive\n\nBurden cap: if a debater\'s burden exceeds 1.5\xD7 the average burden, high-burden moves (weight > 0.5) against that debater are suppressed.\nThis prevents the moderator from repeatedly targeting the same debater.'}
        className="mod-tab-tooltip-trigger"
      >Burden:</strong>{' '}
      {Object.entries(trace.burden_per_debater).map(([d, b]) => `${d}: ${((b as number) ?? 0).toFixed(2)}`).join(', ')}
    </div>
  );
}

function InterventionSuppressionReason({ trace }: { trace: ModeratorTraceData }) {
  if (!(trace.intervention_suppressed_reason && !trace.intervention_validated)) return null;
  return (
    <div className="mod-tab-suppression-reason">
      <strong>Reason:</strong>{' '}
      <span
        title={SUPPRESSION_REASON_TOOLTIPS[trace.intervention_suppressed_reason] ?? ''}
        className="mod-tab-suppression-tooltip"
      >
        {trace.intervention_suppressed_reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
      </span>
      {trace.intervention_suppression_explanation && (
        <span> &mdash; {trace.intervention_suppression_explanation}</span>
      )}
    </div>
  );
}

function TriggerEvidenceRow({ trace }: { trace: ModeratorTraceData }) {
  if (!trace.trigger_evidence) return null;
  return (
    <div className="mod-tab-trigger-evidence">
      <span
        title="Signal name — the moderator AI's label for the debate behavior that triggered this intervention recommendation. Common signals include: evasion (debater dodging a question), term_ambiguity (key term used with conflicting meanings), stagnation_crux (debate stuck on a crux point), unsupported_claim (assertion without evidence), scope_creep (discussion drifting from source material), contradiction (debater contradicting a prior position)."
        className="mod-tab-tooltip-trigger"
      >Signal:</span> {String((trace.trigger_evidence as Record<string, unknown>).signal_name ?? 'unknown')}
      {!!(trace.trigger_evidence as Record<string, unknown>).observed_behavior && (
        <span> &mdash; {String((trace.trigger_evidence as Record<string, unknown>).observed_behavior)}</span>
      )}
    </div>
  );
}

function InterventionBox({ trace }: { trace: ModeratorTraceData }) {
  if (!trace.intervention_recommended) return null;
  return (
    // eslint-disable-next-line local/no-inline-style -- validation-state drives background and border color
    <div className="mod-tab-intervention-box" style={{ background: trace.intervention_validated ? 'color-mix(in srgb, var(--text-secondary) 10%, transparent)' : 'color-mix(in srgb, var(--danger) 8%, transparent)', border: `1px solid ${trace.intervention_validated ? 'var(--text-secondary)' : 'var(--danger)'}` }}>
      {/* eslint-disable-next-line local/no-inline-style -- validation-state drives text color */}
      <div className="mod-tab-intervention-title" style={{ color: trace.intervention_validated ? 'var(--text-secondary)' : 'var(--danger)' }}>
        {trace.intervention_validated ? 'Intervention Fired' : 'Intervention Suppressed'}
        {trace.intervention_move && `: ${trace.intervention_move}`}
        {trace.intervention_target && ` → ${trace.intervention_target}`}
      </div>
      <InterventionSuppressionReason trace={trace} />
      {trace.trigger_reasoning && (
        <div className="mod-tab-intervention-inner">
          <strong>Trigger:</strong> {trace.trigger_reasoning}
        </div>
      )}
      <TriggerEvidenceRow trace={trace} />
    </div>
  );
}

function ActiveModeratorSection({ trace }: { trace: ModeratorTraceData }) {
  if (!(trace.health_score != null || trace.intervention_recommended || trace.budget_remaining != null)) return null;
  return (
    <div className="mod-tab-section">
      <div className="mod-tab-heading">Active Moderator</div>
      <ModeratorMetricsRow trace={trace} />
      <HealthComponentsRow trace={trace} />
      <BurdenRow trace={trace} />
      <InterventionBox trace={trace} />
    </div>
  );
}

function PromptSectionDetails({ s, i }: { s: PromptSection; i: number }) {
  const isTensions = /KNOWN TENSIONS/i.test(s.title);
  const isExchange = /RECENT DEBATE EXCHANGE/i.test(s.title);
  return (
    <details className="mod-tab-prompt-details" open={i < 2}>
      <summary className="mod-tab-prompt-summary">
        {s.title}
        <span className="mod-tab-prompt-char-count">
          {s.content.length > 500 ? `${(s.content.length / 1024).toFixed(1)}KB` : `${s.content.length} chars`}
        </span>
      </summary>
      {isTensions ? <TensionsListDetail content={s.content} />
        : isExchange ? <DebateExchangeRich content={s.content} />
        : <pre className="mod-tab-prompt-pre">{s.content}</pre>
      }
    </details>
  );
}

function PromptSectionsSection({ sections }: { sections: PromptSection[] }) {
  if (!(sections.length > 0)) return null;
  return (
    <div className="mod-tab-section">
      <div className="mod-tab-heading">Context Sent to Moderator</div>
      {sections.map((s, i) => (
        <PromptSectionDetails key={i} s={s} i={i} />
      ))}
    </div>
  );
}

function ResponseSection({ trace }: { trace: ModeratorTraceData }) {
  if (!trace.selection_response) return null;
  return (
    <div className="mod-tab-section">
      <div className="mod-tab-heading">Moderator Response</div>
      <pre className="mod-tab-response-pre">
        {trace.selection_response}
      </pre>
    </div>
  );
}

export function ModeratorTab({ trace }: { trace: ModeratorTraceData }) {
  const promptSections = useMemo(() => parsePromptSections(trace.selection_prompt), [trace.selection_prompt]);

  return (
    <>
      {/* Decision summary */}
      <DecisionSection trace={trace} />

      {/* Candidates */}
      <CandidatesSection trace={trace} />

      {/* Convergence + Commitments */}
      <DebateStateSection trace={trace} />

      {/* Active Moderator State */}
      <ActiveModeratorSection trace={trace} />

      {/* Selection prompt sections */}
      <PromptSectionsSection sections={promptSections} />

      {/* Raw AI response */}
      <ResponseSection trace={trace} />
    </>
  );
}
