// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * EntryDetailRouter — renders the entry detail panel for a selected transcript entry.
 *
 * Extracted from DiagnosticsWindow.tsx (lines 3830-8268).
 * Includes: entry header, proxied moderator trace, tab bar, tab content routing,
 * and text copy context menu.
 *
 * Four tabs delegate to extracted components:
 *   - DraftTab, ClaimsTab, EvidenceTab, CitationsTab (from ./entry-tabs)
 *
 * Remaining tabs (moderator, details, brief, plan, lookahead, cite, tax-refs)
 * are rendered inline.
 */

import React, { useState, useMemo, useContext, Fragment } from 'react';
import { api } from '@bridge';
import { POVER_INFO } from '../../../types/debate';
import type {
  SpeakerId,
  DebateSession,
  EntryDiagnostics,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  CommitmentStore,
  TurnValidationTrail,
  TurnAttempt,
} from '../../../types/debate';
import { humanizeSpeakerIds } from '../../../utils/humanizeSpeakers';
import { computeQbafStrengths } from '@lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '@lib/debate/qbaf';
import { explainNodeStrength } from '../../../utils/qbafExplain';
import { getMoveName, MOVE_EDGE_MAP } from '@lib/debate/helpers';
import { classifyOffScopeDrift, offScopeRepairHint } from '@lib/debate/prompts';
import type { MoveAnnotation } from '@lib/debate/helpers';
import type { TopicScope, TopicScopeRiskLevel } from '@lib/debate/types';
import { TaxonomyRefDetail, type TaxRefNode, type TaxRefEdge } from '../../TaxonomyRefDetail';
import { useTaxonomyStore } from '../../../hooks/useTaxonomyStore';
import {
  speakerLabel,
  Highlight,
  Section,
  CopyButton,
  AifBadge,
  TrafficLight,
  ResizablePre,
  DiagSearchContext,
} from './helpers';
import { EntryTab, OverviewTab, UtilitySnapshot } from './types';
import { SUPPRESSION_REASON_TOOLTIPS } from './shared/constants';
import { classifyHintTarget, HINT_TARGET_STYLE } from './shared';
import { EdgesUsedGrouped } from './shared';
import { DraftTab } from './entry-tabs';
import { ClaimsTab } from './entry-tabs';
import { EvidenceTab } from './entry-tabs';
import { CitationsTab } from './entry-tabs';

// ---------------------------------------------------------------------------
// Inline helper components (only used within entry detail tabs)
// ---------------------------------------------------------------------------

interface ModeratorTraceData {
  selected?: string; focus_point?: string; selection_reason?: string;
  excluded_last_speaker?: string | null; recent_scheme?: string | null;
  convergence_score?: number | null; convergence_triggered?: boolean;
  candidates?: { debater: string; computed_strength: number | null; claim_count?: number; scored_count?: number; rank: number }[];
  commitment_snapshot?: Record<string, { asserted: number; conceded: number; challenged: number }>;
  selection_prompt?: string; selection_response?: string;
  // Active moderator fields
  health_score?: number; health_components?: Record<string, number>; health_trend?: number;
  intervention_recommended?: boolean; intervention_move?: string | null;
  intervention_validated?: boolean; intervention_suppressed_reason?: string | null;
  intervention_suppression_explanation?: string | null;
  intervention_target?: string | null;
  trigger_reasoning?: string | null; trigger_evidence?: Record<string, unknown> | null;
  budget_remaining?: number; budget_total?: number;
  cooldown_rounds_left?: number; burden_per_debater?: Record<string, number>;
}

const DEBATER_COLORS: Record<string, string> = {
  accelerationist: '#f97316', safetyist: '#3b82f6', skeptic: '#a855f7',
};
function debaterColor(name: string): string {
  return DEBATER_COLORS[name.toLowerCase()] ?? '#888';
}

function truncateLabel(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function TensionsListDetail({ content }: { content: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [rationaleExpanded, setRationaleExpanded] = useState(false);

  const { accelerationist, safetyist, skeptic, edgesFile } = useTaxonomyStore();

  const nodeLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const pov of [accelerationist, safetyist, skeptic]) {
      if (!pov?.nodes) continue;
      for (const n of pov.nodes) map.set(n.id, n.label);
    }
    return map;
  }, [accelerationist, safetyist, skeptic]);

  /** Taxonomy node weights lookup — for confidence/priority/operationality display on Brief grounding (t/132, t/150) */
  const nodeWeights = useMemo(() => {
    const map = new Map<string, { confidence?: number; priority?: number; operationality?: number; category?: string }>();
    for (const pov of [accelerationist, safetyist, skeptic]) {
      if (!pov?.nodes) continue;
      for (const n of pov.nodes) map.set(n.id, { confidence: n.confidence, priority: n.priority, operationality: n.operationality, category: n.category });
    }
    return map;
  }, [accelerationist, safetyist, skeptic]);

  const edgeRationale = useMemo(() => {
    const map = new Map<string, string>();
    if (!edgesFile?.edges) return map;
    for (const e of edgesFile.edges) {
      map.set(`${e.source}|${e.target}|${e.type}`, e.rationale);
      if (e.bidirectional) map.set(`${e.target}|${e.source}|${e.type}`, e.rationale);
    }
    return map;
  }, [edgesFile]);

  const tensions = useMemo(() => {
    const re = /^(\S+)\s+(TENSION_WITH|CONTRADICTS|SUPPORTS)\s+(\S+)\s+\(confidence:\s*([\d.]+)\)/gm;
    const items: { source: string; relation: string; target: string; confidence: number; raw: string }[] = [];
    let m;
    while ((m = re.exec(content)) !== null) {
      items.push({ source: m[1], relation: m[2], target: m[3], confidence: parseFloat(m[4]), raw: m[0] });
    }
    return items;
  }, [content]);

  if (tensions.length === 0) {
    return <pre style={{ fontSize: '0.68rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflow: 'auto', margin: '4px 0 8px', padding: '6px 8px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>{content}</pre>;
  }

  const sel = selected != null ? tensions[selected] : null;
  const relationColor = (r: string) => r === 'CONTRADICTS' ? '#ef4444' : r === 'TENSION_WITH' ? '#f59e0b' : '#22c55e';
  const relationIcon = (r: string) => r === 'TENSION_WITH' ? '⟷' : r === 'CONTRADICTS' ? '✕' : '✓';
  const sourcePov = (id: string) => id.startsWith('acc-') ? 'acc' : id.startsWith('saf-') ? 'saf' : id.startsWith('skp-') ? 'skp' : id.startsWith('cc-') ? 'cc' : '';
  const povColor = (id: string) => {
    const p = sourcePov(id);
    return p === 'acc' ? '#f97316' : p === 'saf' ? '#3b82f6' : p === 'skp' ? '#a855f7' : p === 'cc' ? '#22c55e' : '#888';
  };

  const selRationale = sel ? edgeRationale.get(`${sel.source}|${sel.target}|${sel.relation}`) : undefined;
  const RATIONALE_TRUNCATE = 200;

  return (
    <div style={{ display: 'flex', gap: 8, margin: '4px 0 8px' }}>
      <div style={{ flex: '1 1 45%', maxHeight: 340, overflow: 'auto', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
        {tensions.map((t, i) => (
          <div key={i} onClick={() => { setSelected(i); setRationaleExpanded(false); }} style={{
            padding: '4px 8px', cursor: 'pointer', fontSize: '0.66rem',
            background: selected === i ? 'rgba(249,115,22,0.12)' : 'transparent',
            borderLeft: selected === i ? '3px solid #f97316' : '3px solid transparent',
            borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ color: povColor(t.source), fontWeight: 600 }}>{t.source}</span>
            <span style={{ color: relationColor(t.relation), fontSize: '0.58rem', fontWeight: 700, margin: '0 4px' }}>
              {relationIcon(t.relation)}
            </span>
            <span style={{ color: povColor(t.target), fontWeight: 600 }}>{t.target}</span>
            <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: '0.58rem' }}>{(t.confidence ?? 0).toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: '1 1 55%', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-primary)', fontSize: '0.7rem', minHeight: 80, overflow: 'auto' }}>
        {sel ? (
          <>
            {/* Header: relation badge + arrow icon */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
              <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 4, background: `${relationColor(sel.relation)}18`, color: relationColor(sel.relation), fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase' }}>
                {sel.relation.replace(/_/g, ' ')}
              </span>
              <span style={{ marginLeft: 8, color: relationColor(sel.relation), fontSize: '0.8rem' }}>
                {relationIcon(sel.relation)}
              </span>
            </div>

            {/* Source <-> Target side-by-side */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 12px 8px', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.6rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: 2 }}>Source</div>
                <div style={{ fontWeight: 600, color: povColor(sel.source), fontSize: '0.78rem', lineHeight: 1.3 }}>
                  {nodeLabel.get(sel.source) || sel.source}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 2 }}>{sel.source}</div>
              </div>
              <div style={{ color: relationColor(sel.relation), fontSize: '1rem', fontWeight: 700, flexShrink: 0, padding: '0 4px' }}>
                {relationIcon(sel.relation)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.6rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: 2 }}>Target</div>
                <div style={{ fontWeight: 600, color: povColor(sel.target), fontSize: '0.78rem', lineHeight: 1.3 }}>
                  {nodeLabel.get(sel.target) || sel.target}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 2 }}>{sel.target}</div>
              </div>
            </div>

            {/* Rationale */}
            {selRationale && (
              <div style={{ padding: '8px 12px 12px' }}>
                <div style={{ fontSize: '0.6rem', color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, marginBottom: 6 }}>Rationale</div>
                <div style={{ borderLeft: '3px solid #3b82f6', paddingLeft: 10, fontSize: '0.72rem', color: 'var(--text-primary)', lineHeight: 1.5, background: 'var(--bg-secondary)', borderRadius: '0 4px 4px 0', padding: '8px 10px 8px 12px' }}>
                  {!rationaleExpanded && selRationale.length > RATIONALE_TRUNCATE
                    ? selRationale.slice(0, RATIONALE_TRUNCATE) + '...'
                    : selRationale}
                </div>
                {selRationale.length > RATIONALE_TRUNCATE && (
                  <div
                    onClick={() => setRationaleExpanded(!rationaleExpanded)}
                    style={{ fontSize: '0.62rem', color: '#3b82f6', cursor: 'pointer', marginTop: 4 }}
                  >
                    {rationaleExpanded ? 'Show less' : 'Show more'}
                  </div>
                )}
              </div>
            )}

            {/* Confidence footer */}
            <div style={{ padding: '4px 12px 8px', fontSize: '0.62rem', color: 'var(--text-muted)' }}>
              Confidence: {(sel.confidence ?? 0).toFixed(2)}
            </div>
          </>
        ) : (
          <div style={{ padding: '8px 10px', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.65rem' }}>Select a tension to see details</div>
        )}
      </div>
    </div>
  );
}

function DebateExchangeRich({ content }: { content: string }) {
  const segments = useMemo(() => {
    const speakerRe = /^(Accelerationist|Safetyist|Skeptic|Prometheus|Sentinel|Cassandra)\s*(\[[^\]]*\])?:\s*/gm;
    const matches: { index: number; end: number; speaker: string; tag?: string }[] = [];
    let m;
    while ((m = speakerRe.exec(content)) !== null) {
      matches.push({ index: m.index, end: m.index + m[0].length, speaker: m[1], tag: m[2]?.replace(/[[\]]/g, '') });
    }
    if (matches.length === 0) return [{ text: content } as { speaker?: string; tag?: string; text: string }];
    const parts: { speaker?: string; tag?: string; text: string }[] = [];
    if (matches[0].index > 0) {
      const preamble = content.slice(0, matches[0].index).trim();
      if (preamble) parts.push({ text: preamble });
    }
    for (let i = 0; i < matches.length; i++) {
      const textEnd = i + 1 < matches.length ? matches[i + 1].index : content.length;
      parts.push({ speaker: matches[i].speaker, tag: matches[i].tag, text: content.slice(matches[i].end, textEnd).trim() });
    }
    return parts;
  }, [content]);

  if (segments.length <= 1 && !segments[0]?.speaker) {
    return <pre style={{ fontSize: '0.68rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflow: 'auto', margin: '4px 0 8px', padding: '6px 8px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>{content}</pre>;
  }

  return (
    <div style={{ maxHeight: 300, overflow: 'auto', margin: '4px 0 8px', padding: '6px 8px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>
      {segments.map((seg, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          {seg.speaker && (
            <div style={{ marginBottom: 3 }}>
              <span style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontSize: '0.72rem',
                color: '#fff', background: debaterColor(seg.speaker),
              }}>
                {seg.speaker}
              </span>
              {seg.tag && (
                <span style={{ marginLeft: 6, fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{seg.tag}</span>
              )}
            </div>
          )}
          <div style={{ fontSize: '0.68rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-primary)', lineHeight: 1.45 }}>
            {seg.text}
          </div>
        </div>
      ))}
    </div>
  );
}

function ModeratorTab({ trace }: { trace: ModeratorTraceData }) {
  const sectionStyle: React.CSSProperties = { marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border)' };
  const headingStyle: React.CSSProperties = { fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#f97316', marginBottom: 6 };

  // Parse the selection prompt into labeled sections
  const promptSections = useMemo(() => {
    if (!trace.selection_prompt) return [];
    const sections: { title: string; content: string }[] = [];
    const text = trace.selection_prompt;

    // Split on markdown-style headings (=== or ##)
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

// ---------------------------------------------------------------------------
// Props interface
// ---------------------------------------------------------------------------

export interface EntryDetailRouterProps {
  debate: DebateSession;
  entry: DebateSession['transcript'][number];
  entryIdx: number;
  diag: EntryDiagnostics | undefined;
  meta: Record<string, unknown> | undefined;
  turnValTrail: TurnValidationTrail | undefined;
  an: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] } | undefined;
  commitments: CommitmentStore | undefined;
  entryTab: EntryTab;
  setEntryTab: (tab: EntryTab) => void;
  effectiveOverviewTab: OverviewTab;
  selectedEntry: string | null;
  setSelectedEntry: (id: string | null) => void;
  setOverviewTab: (tab: OverviewTab) => void;
  setLocalOverride: (v: boolean) => void;
  proxiedModeratorTrace: Record<string, unknown> | null;
  taxNodeMap: Map<string, Record<string, unknown>>;
  policyMap: Map<string, { id: string; action: string; source_povs: string[]; member_count: number }>;
  allEdges: TaxRefEdge[];
  nodeWeights: Map<string, { confidence?: number; priority?: number; operationality?: number; category?: string }>;
  selectedTaxRefId: string | null;
  setSelectedTaxRefId: (id: string | null) => void;
  selectedPolicyId: string | null;
  setSelectedPolicyId: (id: string | null) => void;
  textCopyMenu: { x: number; y: number; text: string } | null;
  setTextCopyMenu: (menu: { x: number; y: number; text: string } | null) => void;
  tabContentRef: React.RefObject<HTMLDivElement | null>;
  searchQuery: string;
  perTurnUtilities: UtilitySnapshot[];
  nodeLabels: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EntryDetailRouter({
  debate,
  entry,
  entryIdx,
  diag,
  meta,
  turnValTrail,
  an,
  commitments,
  entryTab,
  setEntryTab,
  effectiveOverviewTab,
  selectedEntry,
  setSelectedEntry,
  setOverviewTab,
  setLocalOverride,
  proxiedModeratorTrace,
  taxNodeMap,
  policyMap,
  allEdges,
  nodeWeights,
  selectedTaxRefId,
  setSelectedTaxRefId,
  selectedPolicyId,
  setSelectedPolicyId,
  textCopyMenu,
  setTextCopyMenu,
  tabContentRef,
  searchQuery,
  perTurnUtilities,
  nodeLabels,
}: EntryDetailRouterProps) {
  const totalEntries = debate.transcript.length;
  const stmtId = entryIdx >= 0 ? `S${entryIdx + 1}` : '';
  const goToIdx = (i: number) => {
    if (i < 0 || i >= totalEntries) return;
    setSelectedEntry(debate.transcript[i].id);
    setLocalOverride(true);
  };
  const navBtnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '2px 8px', fontSize: '0.7rem', fontWeight: 600,
    borderRadius: 4, border: '1px solid var(--border)',
    background: disabled ? 'transparent' : 'rgba(249,115,22,0.1)',
    color: disabled ? 'var(--text-muted)' : '#f97316',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  });

  // ── Compute tab data presence ──
  const taxRefCount = entry.taxonomy_refs?.length ?? 0;
  const hasClaims = !!(
    diag?.extracted_claims ||
    (meta?.my_claims && (meta.my_claims as unknown[]).length > 0)
  );
  const evidenceStage = diag?.stage_diagnostics?.find(s => s.stage === 'evidence');
  const evidenceWP = evidenceStage?.work_product as {
    facts?: { claim: string; claim_label: string; doc_id: string; specificity: string; temporal_bound?: string | null; linked_taxonomy_nodes: string[] }[];
    keyPoints?: { stance: string; point: string; doc_id: string; pov: string; verbatim?: string }[];
    nodesCovered?: string[];
    totalCandidates?: number;
  } | undefined;
  const extTrace = diag?.extraction_trace as {
    candidates_proposed: number; candidates_accepted: number; candidates_rejected: number;
    rejection_reasons: Record<string, number>;
    an_node_count_before: number; an_node_count_after: number;
    an_nodes_added_ids: string[];
  } | undefined;
  const evidenceFactCount = (evidenceWP?.facts?.length ?? 0) + (evidenceWP?.keyPoints?.length ?? 0);
  const hasEvidence = !!evidenceStage || !!extTrace;
  const _draftForCitations = (diag?.stage_diagnostics?.filter(s => s.stage === 'draft') ?? []).slice(-1)[0];
  const citationResDiag = _draftForCitations?.citation_resolution as {
    path: 'tool-calling' | 'bank-scrub';
    bank_size: number; bank_sources: string[];
    citations_extracted: number; citations_matched: number; citations_fabricated: number;
    resolution_time_ms: number;
    matches: { citation_text: string; doc_id: string; title: string; similarity: number; match_type: 'exact' | 'fuzzy_title' | 'url' | 'arxiv_id' }[];
    fabrications: { citation_text: string; pattern: string; action: 'removed' | 'hedged'; replacement?: string }[];
    tool_calls?: { query: string; source_type?: string; results_count: number; top_result?: { doc_id: string; title: string; relevance: number }; time_ms: number; empty: boolean }[];
    scrub_diff?: { lines_removed: number; lines_modified: number; original_length: number; cleaned_length: number };
    scrub_original?: string;
    warnings: string[];
  } | undefined;
  const hasCitations = !!citationResDiag;
  const citationsCount = citationResDiag?.citations_extracted ?? 0;
  const hasPrecedingIntervention = (() => {
    if (!debate?.transcript || entryIdx <= 0) return false;
    for (let i = entryIdx - 1; i >= 0; i--) {
      const t = debate.transcript[i];
      if (t.type === 'intervention' && t.speaker === 'moderator') return true;
      if (t.type === 'statement' || t.type === 'opening') return false;
    }
    return false;
  })();
  const hasSuppressedIntervention = !!(
    (meta?.moderator_trace as Record<string, unknown> | undefined)?.intervention_recommended
    && !(meta?.moderator_trace as Record<string, unknown> | undefined)?.intervention_validated
  );
  const hasDetails = !!(
    hasPrecedingIntervention || hasSuppressedIntervention ||
    (meta?.key_assumptions && (meta.key_assumptions as unknown[]).length > 0) ||
    (meta?.policy_refs as string[])?.length || (entry.policy_refs?.length ?? 0) > 0 ||
    diag?.model ||
    diag?.commitment_context ||
    diag?.edge_tensions ||
    diag?.argument_network_context ||
    (meta?.move_types && (meta.move_types as unknown[]).length > 0)
  );
  const claimsCopy = [
    ...(diag?.extracted_claims ? [...diag.extracted_claims.accepted.map(c => `✓ ${c.id} (${c.overlap_pct}%): ${c.text}`), ...diag.extracted_claims.rejected.map(c => `✗ (${c.overlap_pct}%): ${c.text} — ${c.reason}`)] : []),
    ...((meta?.my_claims as { claim: string; targets: string[] }[])?.map((c, i) => `${i + 1}. ${c.claim}${c.targets?.length > 0 ? ` → ${c.targets.join(', ')}` : ''}`) ?? []),
  ].join('\n');
  const stages = diag?.stage_diagnostics;
  const briefAttempts = stages?.filter(s => s.stage === 'brief') ?? [];
  const planAttempts = stages?.filter(s => s.stage === 'plan') ?? [];
  const draftAttempts = stages?.filter(s => s.stage === 'draft') ?? [];
  const citeAttempts = stages?.filter(s => s.stage === 'cite') ?? [];
  const postDraftStage = stages?.find(s => s.stage === 'postDraft');
  const draftQualityStage = stages?.find(s => s.stage === 'draft_quality');
  const briefStage = briefAttempts.length > 0 ? briefAttempts[briefAttempts.length - 1] : undefined;
  const planStage = planAttempts.length > 0 ? planAttempts[planAttempts.length - 1] : undefined;
  const draftStage = draftAttempts.length > 0 ? draftAttempts[draftAttempts.length - 1] : undefined;
  const citeStage = citeAttempts.length > 0 ? citeAttempts[citeAttempts.length - 1] : undefined;
  const lookaheadDiag = (diag as Record<string, unknown> | undefined)?.lookahead as {
    stage: 'lookahead';
    first_attempt: { pass: boolean; utility_before: { position_strength: number; attack_effectiveness: number; crux_engagement: number; composite: number; concession_asymmetry: number }; utility_after: { position_strength: number; attack_effectiveness: number; crux_engagement: number; composite: number; concession_asymmetry: number }; utility_delta: number; threshold: number; tentative_claims: { text: string; strength: number }[]; tentative_network_size: { nodes: number; edges: number } };
    regen_triggered: boolean;
    regen_attempt?: { pass: boolean; utility_before: { composite: number }; utility_after: { composite: number }; utility_delta: number; threshold: number; tentative_claims: { text: string; strength: number }[]; tentative_network_size: { nodes: number; edges: number } };
    regen_attempts?: { pass: boolean; utility_before: { composite: number }; utility_after: { composite: number }; utility_delta: number; threshold: number; tentative_claims: { text: string; strength: number }[]; tentative_network_size: { nodes: number; edges: number } }[];
    per_claim_analysis?: { perClaim: { index: number; text: string; base_strength: number; marginal_delta: number; classification: 'STRONG' | 'WEAK'; dominant_component: string }[]; analysis: { strongFoundations: { text: string; base_strength: number; marginal_delta: number; reason: string }[]; avoidClaims: { text: string; base_strength: number; marginal_delta: number; reason: string }[] } }[];
    final_pass: boolean;
    elapsed_ms: number;
  } | undefined;

  // Build all draft stages across ALL orchestration attempts (t/504).
  type DraftAttemptEntry = typeof draftAttempts[number] & {
    orchestrationRun: number;
    stageRetryIndex: number;
    stageRetryCount: number;
  };
  const orchAttempts = turnValTrail?.attempts ?? [];
  const allDraftAttempts: DraftAttemptEntry[] = orchAttempts.length > 0
    ? orchAttempts.flatMap((a, runIdx) => {
        const drafts = (a.stage_diagnostics ?? []).filter(s => s.stage === 'draft');
        return drafts.map((s, di) => ({
          ...s, orchestrationRun: runIdx, stageRetryIndex: di, stageRetryCount: drafts.length,
        }));
      })
    : [];
  const hasMultipleOrchRuns = orchAttempts.length > 1;
  const effectiveDraftAttempts: (typeof draftAttempts[number] & {
    orchestrationRun?: number; stageRetryIndex?: number; stageRetryCount?: number;
  })[] =
    allDraftAttempts.length > 0
      ? allDraftAttempts
      : draftAttempts.map((s, i, arr) => ({
          ...s, orchestrationRun: undefined, stageRetryIndex: i, stageRetryCount: arr.length,
        }));

  // Find preceding moderator intervention for this entry
  const precedingIntervention = (() => {
    if (!debate?.transcript || entryIdx <= 0) return null;
    for (let i = entryIdx - 1; i >= 0; i--) {
      const t = debate.transcript[i];
      if (t.type === 'intervention' && t.speaker === 'moderator') return t;
      if (t.type === 'statement' || t.type === 'opening') break;
    }
    return null;
  })();
  const citeWorkProduct = citeStage?.work_product as Record<string, unknown> | undefined;
  const pinResponse = citeWorkProduct?.pin_response as {
    position?: string; condition?: string; brief_reason?: string;
  } | undefined;
  const interventionResponseField = (() => {
    if (!precedingIntervention) return null;
    const intMove = (precedingIntervention.intervention_metadata as { move?: string } | undefined)?.move;
    const fieldMap: Record<string, string> = {
      PIN: 'pin_response', PROBE: 'probe_response', CHALLENGE: 'challenge_response',
      CLARIFY: 'clarification', CHECK: 'check_response', REVOICE: 'revoice_response',
      'META-REFLECT': 'reflection', COMPRESS: 'compressed_thesis', COMMIT: 'commitment',
    };
    const field = intMove ? fieldMap[intMove] : undefined;
    if (field) {
      const citeVal = citeWorkProduct?.[field] as Record<string, unknown> | string | undefined;
      if (citeVal) return citeVal;
      const draftWP = draftStage?.work_product as Record<string, unknown> | undefined;
      const draftVal = draftWP?.[field] as Record<string, unknown> | string | undefined;
      if (draftVal) return draftVal;
    }
    const planWP = planStage?.work_product as Record<string, unknown> | undefined;
    const dr = planWP?.directive_response as { directive?: string; how_addressed?: string } | undefined;
    if (dr?.how_addressed) return { from_plan: true, how_addressed: dr.how_addressed, directive: dr.directive } as unknown as Record<string, unknown>;
    return null;
  })();

  const modTrace = (meta?.moderator_trace ?? proxiedModeratorTrace) as {
    selected?: string; focus_point?: string; selection_reason?: string;
    excluded_last_speaker?: string | null; recent_scheme?: string | null;
    convergence_score?: number | null; convergence_triggered?: boolean;
    candidates?: { debater: string; computed_strength: number | null; rank: number }[];
    commitment_snapshot?: Record<string, { asserted: number; conceded: number; challenged: number }>;
    selection_prompt?: string; selection_response?: string;
    intervention_recommended?: boolean; intervention_move?: string | null;
    intervention_validated?: boolean; intervention_suppressed_reason?: string | null;
    intervention_suppression_explanation?: string | null;
    intervention_target?: string | null; trigger_reasoning?: string | null;
  } | null;
  const suppressedIntervention = modTrace?.intervention_recommended && !modTrace.intervention_validated
    ? modTrace : null;
  const hasModTab = !!modTrace;

  const tabs: { id: EntryTab; label: string; count?: number; has: boolean; copy: string }[] = [
    { id: 'moderator', label: 'Moderator-Pre', has: hasModTab, copy: modTrace?.selection_prompt ?? '' },
    { id: 'details', label: 'Overview', has: hasDetails, copy: '' },
    { id: 'brief', label: 'Brief', has: !!briefStage, copy: JSON.stringify(briefStage?.work_product, null, 2) ?? '' },
    { id: 'plan', label: 'Plan', has: !!planStage, copy: JSON.stringify(planStage?.work_product, null, 2) ?? '' },
    { id: 'evidence', label: 'Evidence', count: evidenceFactCount || undefined, has: hasEvidence, copy: evidenceStage?.raw_response ?? '' },
    { id: 'citations', label: 'Citations', count: citationsCount || undefined, has: hasCitations, copy: citationResDiag ? JSON.stringify(citationResDiag, null, 2) : '' },
    { id: 'draft', label: 'Draft', has: !!(draftStage || entry.content), copy: draftStage ? (JSON.stringify(draftStage?.work_product, null, 2) ?? '') : (typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content, null, 2)) },
    { id: 'lookahead', label: 'Lookahead', has: !!lookaheadDiag, copy: lookaheadDiag ? JSON.stringify(lookaheadDiag, null, 2) : '' },
    { id: 'cite', label: 'Cite', has: !!citeStage, copy: JSON.stringify(citeStage?.work_product, null, 2) ?? '' },
    { id: 'claims', label: 'Claims', has: hasClaims, copy: claimsCopy },
    { id: 'tax-refs', label: 'Taxonomy Refs', count: taxRefCount, has: taxRefCount > 0, copy: entry.taxonomy_refs?.map(r => `${r.node_id}: ${r.relevance}`).join('\n') ?? '' },
  ];
  // If the current tab has no data, auto-select the first tab that does.
  const activeTab = tabs.find(t => t.id === entryTab)?.has
    ? entryTab
    : (tabs.find(t => t.has)?.id ?? 'details');
  const active = tabs.find(t => t.id === activeTab)!;
  const handleCopy = () => { if (active.copy) navigator.clipboard?.writeText(active.copy).catch(() => {}); };

  const tabBtnStyle = (t: typeof tabs[0]): React.CSSProperties => ({
    padding: '6px 12px',
    fontSize: '0.75rem',
    fontWeight: 600,
    border: '1px solid var(--border)',
    borderBottom: t.id === activeTab ? '1px solid var(--bg-primary)' : '1px solid var(--border)',
    background: t.id === activeTab ? 'var(--bg-primary)' : 'transparent',
    color: t.has ? (t.id === activeTab ? '#f97316' : 'var(--text-primary)') : 'var(--text-muted)',
    cursor: t.has ? 'pointer' : 'not-allowed',
    opacity: t.has ? 1 : 0.5,
    borderRadius: '6px 6px 0 0',
    marginRight: 2,
    marginBottom: -1,
    position: 'relative',
    zIndex: t.id === activeTab ? 2 : 1,
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* ── Entry header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        {stmtId && (
          <span
            title={`Statement ${stmtId}`}
            style={{
              padding: '1px 7px', borderRadius: 10,
              background: 'rgba(249,115,22,0.12)', color: '#f97316',
              fontSize: '0.7rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            }}
          >{stmtId}</span>
        )}
        <strong style={{ fontSize: '0.85rem' }}>{speakerLabel(entry.speaker)}</strong>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{entry.type}</span>
        {diag?.topic_alignment && (() => {
          const ta = diag.topic_alignment;
          const sft = (meta?.injection_manifest as Record<string, unknown> | undefined)?.scope_filter_trace as
            { demoted?: { nodeId: string }[] } | undefined;
          const demotedIds = new Set((sft?.demoted ?? []).map(d => d.nodeId));
          const hasDemotedRef = (entry.taxonomy_refs ?? []).some(r => demotedIds.has(r.node_id));
          const modDrift = entry.type === 'intervention' || (meta?.moderator_trace as Record<string, unknown> | undefined)?.drift_detected;
          let state: 'green' | 'amber' | 'red';
          let label: string;
          let tip: string;
          if (!ta.topic_aligned) {
            state = 'red'; label = 'off-scope'; tip = 'Topic alignment failed after all retries';
          } else if (ta.repaired) {
            state = 'amber'; label = 'repaired'; tip = 'Off-scope draft repaired on retry';
          } else if (modDrift || hasDemotedRef) {
            state = 'amber'; label = 'drift noted'; tip = modDrift ? 'Moderator flagged drift concern' : 'References demoted taxonomy node';
          } else {
            state = 'green'; label = 'on-scope'; tip = 'All topic alignment checks passed';
          }
          const colors = { green: '#16a34a', amber: '#d97706', red: '#dc2626' };
          const bgs = { green: 'rgba(22,163,74,0.15)', amber: 'rgba(245,158,11,0.15)', red: 'rgba(220,38,38,0.15)' };
          return (
            <span title={tip} style={{
              padding: '1px 6px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 600,
              background: bgs[state], color: colors[state], cursor: 'help',
            }}>{label}</span>
          );
        })()}
        {diag?.entailment_repairs && diag.entailment_repairs.some(r => r.verdict !== 'entailed') && (() => {
          const repaired = diag.entailment_repairs!.filter(r => r.verdict !== 'entailed');
          return (
            <span title={`${repaired.length} claim${repaired.length !== 1 ? 's' : ''} repaired by entailment verification`} style={{
              padding: '1px 6px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 600,
              background: 'rgba(245,158,11,0.15)', color: '#d97706', cursor: 'help',
            }}>{repaired.length} repaired</span>
          );
        })()}
        {!diag && !proxiedModeratorTrace && entry.type !== 'intervention' && <span style={{ color: '#f59e0b', fontSize: '0.65rem' }}>(no diagnostic capture &mdash; turn was generated before diagnostics was always-on)</span>}
        <span style={{ flex: 1 }} />
        {effectiveOverviewTab === 'transcript' && (
          <button
            onClick={() => { setSelectedEntry(null); setLocalOverride(true); }}
            title="Back to transcript list"
            style={{
              padding: '2px 8px', fontSize: '0.7rem', fontWeight: 600,
              borderRadius: 4, border: '1px solid var(--border)',
              background: 'rgba(249,115,22,0.1)', color: '#f97316',
              cursor: 'pointer',
            }}
          >{'▲'} Transcript</button>
        )}
        <button
          onClick={() => goToIdx(entryIdx - 1)}
          disabled={entryIdx <= 0}
          title="Previous statement"
          style={navBtnStyle(entryIdx <= 0)}
        >{'◀'} Prev</button>
        <button
          onClick={() => goToIdx(entryIdx + 1)}
          disabled={entryIdx >= totalEntries - 1}
          title="Next statement"
          style={navBtnStyle(entryIdx >= totalEntries - 1)}
        >Next {'▶'}</button>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
          {entryIdx + 1} / {totalEntries}
        </span>
        {diag?.stage_diagnostics?.some(s => s.prompt) && debate && (
          <button
            onClick={() => { setSelectedEntry(entry.id); setOverviewTab('prompt-diff'); setLocalOverride(true); }}
            title="View Prompt Diff for this entry"
            style={{
              marginLeft: 8, padding: '2px 8px', fontSize: '0.65rem', fontWeight: 600,
              borderRadius: 4, border: 'none',
              background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
              cursor: 'pointer',
            }}
          >Prompt Diff</button>
        )}
      </div>

      {/* ── Proxied moderator trace for system entries ── */}
      {proxiedModeratorTrace && (() => {
        const t = proxiedModeratorTrace as {
          selected?: string; focus_point?: string; selection_reason?: string;
          excluded_last_speaker?: string | null; recent_scheme?: string | null;
          convergence_score?: number | null; convergence_triggered?: boolean;
          candidates?: { debater: string; computed_strength: number | null; claim_count?: number; scored_count?: number; rank: number }[];
          argument_network_snapshot?: { total_claims: number; total_edges: number; unaddressed_claims: number } | null;
          commitment_snapshot?: Record<string, { asserted: number; conceded: number; challenged: number }>;
        };
        return (
          <div style={{
            margin: '0 0 10px', padding: '8px 12px', borderRadius: 6,
            background: 'rgba(249,115,22,0.08)', borderLeft: '3px solid #f97316',
            fontSize: '0.72rem',
          }}>
            <div style={{ fontWeight: 700, color: '#f97316', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Moderator Deliberation
            </div>
            {t.selected && (
              <div style={{ marginBottom: 3 }}>
                <strong>Selected:</strong> {t.selected}
                {t.selection_reason && <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: 'rgba(249,115,22,0.15)', color: '#f97316', fontSize: '0.6rem', fontWeight: 600 }}>{t.selection_reason.replace(/_/g, ' ')}</span>}
                {t.excluded_last_speaker && <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: '0.65rem' }}>(excluded last speaker: {t.excluded_last_speaker})</span>}
              </div>
            )}
            {t.focus_point && <div style={{ marginBottom: 3 }}><strong>Focus:</strong> {t.focus_point}</div>}
            {t.candidates && t.candidates.length > 0 && (
              <div style={{ marginBottom: 3 }}>
                <strong>Candidates:</strong>{' '}
                {t.candidates.map((c, i) => (
                  <span key={i} style={{ marginRight: 8, fontWeight: c.debater === t.selected ? 700 : 400, opacity: c.debater === t.selected ? 1 : 0.7 }}
                    title={[
                      `CANDIDATE RANKING — ${c.debater}`,
                      ``,
                      `QBAF Score: ${c.computed_strength != null ? c.computed_strength.toFixed(2) : 'n/a (no scored claims)'}`,
                      `Claims in argument network: ${c.claim_count ?? '?'}`,
                      `Claims with QBAF scores: ${c.scored_count ?? '?'}`,
                      ``,
                      `The QBAF score is the average computed_strength across all`,
                      `of this debater's claims in the argument network.`,
                      ``,
                      `computed_strength uses Quantitative Bipolar Argumentation`,
                      `Framework (QBAF) propagation: each claim starts with a`,
                      `base_strength (0-1), then attack/support edges from other`,
                      `claims raise or lower it. The final score reflects how well`,
                      `a claim survives challenges and gains support.`,
                      ``,
                      `Interpretation:`,
                      `  0.0-0.3  Weak — claims are heavily attacked or unsupported`,
                      `  0.3-0.5  Below average — more attacks than support`,
                      `  0.5       Neutral — balanced or unengaged`,
                      `  0.5-0.7  Above average — net support from other claims`,
                      `  0.7-1.0  Strong — well-supported, surviving challenges`,
                      ``,
                      `Lower-ranked candidates are selected first, as they have`,
                      `weaker argumentation positions and greater need to respond.`,
                    ].join('\n')}
                  >
                    #{c.rank} {c.debater}{c.computed_strength != null ? ` (QBAF: ${c.computed_strength.toFixed(2)})` : ''}
                  </span>
                ))}
              </div>
            )}
            {t.convergence_score != null && (
              <div style={{ marginBottom: 3 }}>
                <strong>Convergence:</strong> {(t.convergence_score * 100).toFixed(0)}%
                {t.convergence_triggered && <span style={{ color: '#22c55e', marginLeft: 4, fontWeight: 700 }}>triggered</span>}
              </div>
            )}
            {t.recent_scheme && <div style={{ marginBottom: 3 }}><strong>Recent scheme:</strong> {t.recent_scheme}</div>}
            {t.argument_network_snapshot && (
              <div style={{ marginBottom: 3 }}>
                <strong>AN snapshot:</strong> {t.argument_network_snapshot.total_claims} claims, {t.argument_network_snapshot.total_edges} edges, {t.argument_network_snapshot.unaddressed_claims} unaddressed
              </div>
            )}
            {t.commitment_snapshot && (
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {Object.entries(t.commitment_snapshot).map(([name, c]) => (
                  <span key={name} style={{ marginRight: 10 }}>{name}: {c.asserted}A {c.conceded}C {c.challenged}Ch</span>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Tabbed view ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: '8px 0 0', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', borderBottom: '1px solid var(--border)' }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => t.has && setEntryTab(t.id)}
              disabled={!t.has}
              style={tabBtnStyle(t)}
              title={t.has ? t.label : `${t.label} (no data)`}
            >
              {t.label}
              {t.count != null && <span style={{ marginLeft: 4, color: 'var(--text-muted)', fontWeight: 400 }}>({t.count})</span>}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {active.has && active.id !== 'tax-refs' && (
            <button
              onClick={handleCopy}
              style={{ fontSize: '0.75rem', padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', marginBottom: 4 }}
              title="Copy tab content"
            >Copy</button>
          )}
        </div>
        <div ref={tabContentRef} tabIndex={0} onContextMenu={(e) => {
          const sel = window.getSelection()?.toString();
          if (sel && sel.trim().length > 0) {
            e.preventDefault();
            setTextCopyMenu({ x: e.clientX, y: e.clientY, text: sel });
          }
        }} style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflowY: 'auto',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderTop: 'none',
          borderRadius: '0 6px 6px 6px',
          padding: activeTab === 'tax-refs' ? '8px 10px' : 0,
          outline: 'none',
          userSelect: 'text',
        }}>
          {/* ══════════════ TAX-REFS TAB ══════════════ */}
          {activeTab === 'tax-refs' && (
            <TaxRefsTabContent
              entry={entry}
              meta={meta}
              debate={debate}
              taxRefCount={taxRefCount}
              nodeWeights={nodeWeights}
              taxNodeMap={taxNodeMap}
              allEdges={allEdges}
              selectedTaxRefId={selectedTaxRefId}
              setSelectedTaxRefId={setSelectedTaxRefId}
              setOverviewTab={setOverviewTab}
            />
          )}

          {/* ══════════════ DETAILS (OVERVIEW) TAB ══════════════ */}
          {activeTab === 'details' && (
            <DetailsTabContent
              entry={entry}
              entryIdx={entryIdx}
              diag={diag}
              meta={meta}
              debate={debate}
              an={an}
              turnValTrail={turnValTrail}
              perTurnUtilities={perTurnUtilities}
              precedingIntervention={precedingIntervention}
              interventionResponseField={interventionResponseField}
              suppressedIntervention={suppressedIntervention}
              policyMap={policyMap}
              allEdges={allEdges}
              taxNodeMap={taxNodeMap}
              nodeWeights={nodeWeights}
              nodeLabels={nodeLabels}
              selectedTaxRefId={selectedTaxRefId}
              setSelectedTaxRefId={setSelectedTaxRefId}
            />
          )}

          {/* ══════════════ MODERATOR TAB ══════════════ */}
          {activeTab === 'moderator' && modTrace && (
            <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
              <ModeratorTab trace={modTrace} />
            </div>
          )}

          {/* ══════════════ BRIEF TAB ══════════════ */}
          {activeTab === 'brief' && briefStage && (
            <BriefTabContent
              entry={entry}
              briefStage={briefStage}
              briefAttempts={briefAttempts}
              turnValTrail={turnValTrail}
              nodeWeights={nodeWeights}
              taxNodeMap={taxNodeMap}
              allEdges={allEdges}
              selectedTaxRefId={selectedTaxRefId}
              setSelectedTaxRefId={setSelectedTaxRefId}
            />
          )}

          {/* ══════════════ PLAN TAB ══════════════ */}
          {activeTab === 'plan' && planStage && (
            <PlanTabContent
              planStage={planStage}
              planAttempts={planAttempts}
              taxNodeMap={taxNodeMap}
              allEdges={allEdges}
              selectedTaxRefId={selectedTaxRefId}
              setSelectedTaxRefId={setSelectedTaxRefId}
            />
          )}

          {/* ══════════════ DRAFT TAB (delegated) ══════════════ */}
          {activeTab === 'draft' && (draftStage || entry.content) && (
            <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
              <DraftTab
                entry={entry as any}
                diag={diag}
                meta={meta}
                debate={debate as any}
                turnValTrail={turnValTrail}
                an={an}
                selectedTaxRefId={selectedTaxRefId}
                setSelectedTaxRefId={setSelectedTaxRefId}
                nodeWeights={nodeWeights as any}
                taxNodeMap={taxNodeMap}
                allEdges={allEdges}
              />
            </div>
          )}

          {/* ══════════════ LOOKAHEAD TAB ══════════════ */}
          {activeTab === 'lookahead' && lookaheadDiag && (
            <LookaheadTabContent
              lookaheadDiag={lookaheadDiag}
            />
          )}

          {/* ══════════════ CITE TAB ══════════════ */}
          {activeTab === 'cite' && citeStage && (
            <CiteTabContent
              entry={entry}
              debate={debate}
              citeStage={citeStage}
              citeAttempts={citeAttempts}
              briefStage={briefStage}
              turnValTrail={turnValTrail}
              taxNodeMap={taxNodeMap}
              allEdges={allEdges}
              policyMap={policyMap}
              selectedTaxRefId={selectedTaxRefId}
              setSelectedTaxRefId={setSelectedTaxRefId}
              selectedPolicyId={selectedPolicyId}
              setSelectedPolicyId={setSelectedPolicyId}
            />
          )}

          {/* ══════════════ CLAIMS TAB (delegated) ══════════════ */}
          {activeTab === 'claims' && (
            <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
              <ClaimsTab
                entry={entry as any}
                diag={diag}
                meta={meta}
                debate={debate as any}
                an={an}
                nodeWeights={nodeWeights as any}
                searchQuery={searchQuery}
              />
            </div>
          )}

          {/* ══════════════ EVIDENCE TAB (delegated) ══════════════ */}
          {activeTab === 'evidence' && (
            <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
              <EvidenceTab
                entry={entry as any}
                diag={diag}
                an={an}
                searchQuery={searchQuery}
              />
            </div>
          )}

          {/* ══════════════ CITATIONS TAB (delegated) ══════════════ */}
          {activeTab === 'citations' && (
            <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
              <CitationsTab
                diag={diag}
                searchQuery={searchQuery}
              />
            </div>
          )}

        </div>

        {/* ── Text copy context menu ── */}
        {textCopyMenu && (
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'fixed', left: textCopyMenu.x, top: textCopyMenu.y, zIndex: 9999,
              background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
              padding: '4px 0', minWidth: 120, fontSize: '0.72rem',
            }}
          >
            <button
              onClick={() => { void navigator.clipboard.writeText(textCopyMenu.text); setTextCopyMenu(null); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '5px 12px', border: 'none', background: 'transparent',
                color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.72rem',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >Copy</button>
            <button
              onClick={() => {
                if (tabContentRef.current) {
                  const range = document.createRange();
                  range.selectNodeContents(tabContentRef.current);
                  const sel = window.getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                }
                setTextCopyMenu(null);
              }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '5px 12px', border: 'none', background: 'transparent',
                color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.72rem',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >Select All</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline tab content sub-components
// These are kept inline in this router as they are not yet extracted into
// separate files. They contain significant rendering logic for each tab.
// ---------------------------------------------------------------------------

/**
 * TaxRefsTabContent -- Taxonomy References tab.
 * Renders the taxonomy ref table with AN coverage and TaxonomyRefDetail.
 */
function TaxRefsTabContent({ entry, meta, debate, taxRefCount, nodeWeights, taxNodeMap, allEdges, selectedTaxRefId, setSelectedTaxRefId, setOverviewTab }: {
  entry: DebateSession['transcript'][number];
  meta: Record<string, unknown> | undefined;
  debate: DebateSession;
  taxRefCount: number;
  nodeWeights: Map<string, { confidence?: number; priority?: number; operationality?: number; category?: string }>;
  taxNodeMap: Map<string, Record<string, unknown>>;
  allEdges: TaxRefEdge[];
  selectedTaxRefId: string | null;
  setSelectedTaxRefId: (id: string | null) => void;
  setOverviewTab: (tab: OverviewTab) => void;
}) {
  const relevanceSources = (meta?.relevance_sources as { node_id: string; source: 'an' | 'topic'; an_score: number; topic_score: number; best_claim_id?: string; best_claim_text?: string; best_claim_sim?: number }[] | undefined);
  const sourceMap = new Map(relevanceSources?.map(s => [s.node_id, s]) ?? []);
  const hasSourceData = sourceMap.size > 0;

  const anCoverage = hasSourceData && debate?.argument_network?.nodes ? (() => {
    const anNodes = debate.argument_network.nodes;
    const claimMaxScores = new Map<string, { maxSim: number; bestNode: string }>();
    for (const src of relevanceSources!) {
      if (src.best_claim_id && src.best_claim_sim != null) {
        const existing = claimMaxScores.get(src.best_claim_id);
        if (!existing || src.best_claim_sim > existing.maxSim) {
          claimMaxScores.set(src.best_claim_id, { maxSim: src.best_claim_sim, bestNode: src.node_id });
        }
      }
    }
    const strong: { id: string; sim: number; text: string }[] = [];
    const moderate: { id: string; sim: number; text: string }[] = [];
    const weak: { id: string; sim: number; text: string }[] = [];
    for (const an of anNodes) {
      const match = claimMaxScores.get(an.id);
      const sim = match?.maxSim ?? 0;
      const item = { id: an.id, sim, text: truncateLabel(an.text, 50) };
      if (sim >= 0.5) strong.push(item);
      else if (sim >= 0.3) moderate.push(item);
      else weak.push(item);
    }
    const grounded = strong.length + moderate.length;
    return { strong, moderate, weak, total: anNodes.length, grounded };
  })() : null;

  return taxRefCount > 0 ? (
    <div style={{ flex: 1, minHeight: 200, overflowY: 'auto', padding: '8px 10px' }}>
      {/* AN Claim Coverage Summary */}
      {anCoverage && anCoverage.total > 0 && (
        <div style={{ marginBottom: 10, padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.75rem' }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>AN Claim Coverage</div>
          {anCoverage.strong.length > 0 && (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: '#16a34a' }}>{'●'}</span>{' '}
              <span style={{ fontWeight: 600 }}>Strong ({'≥'}0.5):</span>{' '}
              {anCoverage.strong.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ', '}
                  <button onClick={() => setOverviewTab('argument-network')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontFamily: 'inherit', fontSize: 'inherit' }} title={c.text}>{c.id}</button>
                </span>
              ))}
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{anCoverage.strong.length}/{anCoverage.total} claims grounded</span>
            </div>
          )}
          {anCoverage.moderate.length > 0 && (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: '#d97706' }}>{'◐'}</span>{' '}
              <span style={{ fontWeight: 600 }}>Moderate:</span>{' '}
              {anCoverage.moderate.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ', '}
                  <button onClick={() => setOverviewTab('argument-network')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontFamily: 'inherit', fontSize: 'inherit' }} title={c.text}>{c.id}</button>
                </span>
              ))}
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{anCoverage.moderate.length}/{anCoverage.total} claims</span>
            </div>
          )}
          {anCoverage.weak.length > 0 && (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: '#dc2626' }}>{'○'}</span>{' '}
              <span style={{ fontWeight: 600 }}>Weak ({'<'}0.3):</span>{' '}
              {anCoverage.weak.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ', '}
                  <button onClick={() => setOverviewTab('argument-network')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontFamily: 'inherit', fontSize: 'inherit' }} title={c.text}>{c.id}</button>
                </span>
              ))}
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{anCoverage.weak.length}/{anCoverage.total} claims orphaned</span>
            </div>
          )}
          <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: '0.7rem' }}>
            {anCoverage.grounded}/{anCoverage.total} AN claims have taxonomy grounding
            {anCoverage.weak.length > 0 && ` — ${anCoverage.weak.length} orphaned claim${anCoverage.weak.length > 1 ? 's' : ''} (taxonomy may be missing relevant nodes)`}
          </div>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', tableLayout: 'fixed' }}>
        <colgroup>
          {hasSourceData && <col style={{ width: '10%' }} />}
          <col style={{ width: '20%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: hasSourceData ? '62%' : '72%' }} />
        </colgroup>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
            {hasSourceData && <th style={{ padding: '4px 6px', fontWeight: 600, color: 'var(--text-muted)' }}>Source</th>}
            <th style={{ padding: '4px 6px', fontWeight: 600, color: 'var(--text-muted)' }}>Id</th>
            <th style={{ padding: '4px 6px', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>Score</th>
            <th style={{ padding: '4px 6px', fontWeight: 600, color: 'var(--text-muted)' }}>Relevance</th>
          </tr>
        </thead>
        <tbody>
          {[...entry.taxonomy_refs!].sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)).map((r, i) => {
            const isSelected = selectedTaxRefId === r.node_id;
            const score = r.relevance_score;
            const scoreColor = score == null ? 'var(--text-muted)'
              : score >= 0.45 ? '#16a34a'
              : score >= 0.30 ? '#d97706'
              : '#dc2626';
            const src = sourceMap.get(r.node_id);
            const isAN = src?.source === 'an';
            const tw = nodeWeights.get(r.node_id);
            const weightLabel = tw?.category === 'Beliefs' ? 'Confidence'
              : tw?.category === 'Desires' ? 'Priority'
              : tw?.category === 'Intentions' ? 'Operationality' : null;
            const weightValue = tw?.category === 'Beliefs' ? tw.confidence
              : tw?.category === 'Desires' ? tw.priority
              : tw?.category === 'Intentions' ? tw.operationality : undefined;
            return (
              <Fragment key={i}>
                <tr
                  style={{
                    borderBottom: src ? 'none' : '1px solid var(--border)',
                    background: isSelected ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
                  }}
                >
                  {hasSourceData && (
                    <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>
                      {src && (
                        <span style={{
                          display: 'inline-block',
                          padding: '1px 5px',
                          borderRadius: 3,
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          background: isAN ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)',
                          color: isAN ? '#22c55e' : '#f59e0b',
                        }}>{isAN ? (src.best_claim_id ?? 'AN') : 'TOPIC'}</span>
                      )}
                    </td>
                  )}
                  <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>
                    <button
                      onClick={() => setSelectedTaxRefId(isSelected ? null : r.node_id)}
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        color: 'var(--accent)', fontWeight: isSelected ? 700 : 600,
                        textDecoration: 'underline', fontFamily: 'inherit', fontSize: 'inherit', textAlign: 'left',
                      }}
                      title="Show Perspective details"
                    >{r.primary ? '★ ' : ''}{r.node_id}{(r as {label?: string}).label ? `: ${(r as {label?: string}).label}` : ''}</button>
                    {(score != null || weightValue != null) && (
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        ({score != null && <>Relevance {score.toFixed(2)}</>}
                        {score != null && weightLabel && weightValue != null && ' ; '}
                        {weightLabel && weightValue != null && <>{weightLabel} {weightLabel === 'Confidence' ? weightValue.toFixed(2) : `${weightValue}/5`}</>})
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '4px 6px', verticalAlign: 'top', textAlign: 'center', fontWeight: 600, color: scoreColor, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {score != null ? score.toFixed(2) : '—'}
                  </td>
                  <td style={{ padding: '4px 6px', verticalAlign: 'top', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                    {r.relevance}
                  </td>
                </tr>
                {/* Expandable scoring detail */}
                {src && (
                  <tr style={{ borderBottom: '1px solid var(--border)', background: isSelected ? 'rgba(245, 158, 11, 0.08)' : 'transparent' }}>
                    <td colSpan={hasSourceData ? 4 : 3} style={{ padding: '0 6px 4px 20px' }}>
                      <details style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Scoring detail</summary>
                        <div style={{ padding: '4px 0 2px 12px', lineHeight: 1.5 }}>
                          {isAN && src.best_claim_id && (
                            <div>
                              <strong>Best match:</strong>{' '}
                              <button onClick={() => setOverviewTab('argument-network')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontFamily: 'inherit', fontSize: 'inherit' }}>{src.best_claim_id}</button>
                              {src.best_claim_text && <> &ldquo;{truncateLabel(src.best_claim_text, 60)}&rdquo;</>}
                              {src.best_claim_sim != null && <> (sim: {src.best_claim_sim.toFixed(2)})</>}
                            </div>
                          )}
                          <div><strong>AN score:</strong> {src.an_score.toFixed(3)}</div>
                          <div><strong>Topic floor:</strong> {(src.topic_score * 0.5).toFixed(3)} (raw: {src.topic_score.toFixed(3)} {'×'} 0.5)</div>
                          <div><strong>Winner:</strong> {isAN ? 'AN score used' : 'Topic floor used — no AN match above floor'}</div>
                        </div>
                      </details>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
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
  ) : (
    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '8px 10px' }}>No taxonomy refs for this entry.</div>
  );
}

/**
 * DetailsTabContent -- Overview/Details tab.
 * Shows per-turn utility delta, preceding intervention, suppressed intervention,
 * dialectical moves, turn validation, commitments, edges used, key assumptions,
 * policy refs, edge tensions, argument network context, model info, lineage frame,
 * and opening statement.
 */
function DetailsTabContent({ entry, entryIdx, diag, meta, debate, an, turnValTrail, perTurnUtilities, precedingIntervention, interventionResponseField, suppressedIntervention, policyMap, allEdges, taxNodeMap, nodeWeights, nodeLabels, selectedTaxRefId, setSelectedTaxRefId }: {
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
  suppressedIntervention: Record<string, unknown> | null;
  policyMap: Map<string, { id: string; action: string; source_povs: string[]; member_count: number }>;
  allEdges: TaxRefEdge[];
  taxNodeMap: Map<string, Record<string, unknown>>;
  nodeWeights: Map<string, { confidence?: number; priority?: number; operationality?: number; category?: string }>;
  nodeLabels: Map<string, string>;
  selectedTaxRefId: string | null;
  setSelectedTaxRefId: (id: string | null) => void;
}) {
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
        const deltaColor = delta === null ? 'var(--text-muted)' : delta > 0.01 ? '#22c55e' : delta < -0.01 ? '#ef4444' : '#f59e0b';
        const speakerColor: Record<string, string> = { accelerationist: '#f97316', safetyist: '#3b82f6', skeptic: '#a855f7' };
        const color = speakerColor[entry.speaker] ?? '#6b7280';
        const fmtDelta = (v: number | null, label: string, prevV?: number) => {
          if (v === null || v === undefined) return null;
          const d = prevV !== undefined ? v - prevV : null;
          const dStr = d !== null ? (d >= 0 ? `+${d.toFixed(3)}` : d.toFixed(3)) : '';
          const dColor = d !== null ? (d > 0.01 ? '#22c55e' : d < -0.01 ? '#ef4444' : 'var(--text-muted)') : 'var(--text-muted)';
          return (
            <span key={label} style={{ display: 'inline-flex', gap: 3, alignItems: 'baseline' }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
              <strong>{v.toFixed(3)}</strong>
              {dStr && <span style={{ fontSize: '0.6rem', color: dColor }}>{dStr}</span>}
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
              <span style={{ fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', color }}>Utility</span>
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

        const complianceColor = hasResponse && !isFromPlan ? '#22c55e'
          : hasResponse && isFromPlan ? '#f59e0b'
          : !speakerIsTarget ? '#6366f1'
          : '#ef4444';
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
            background: 'rgba(168,85,247,0.08)', borderLeft: '3px solid #a855f7',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: '#a855f7', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Moderator Directive
              </span>
              <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(168,85,247,0.15)', color: '#a855f7', fontSize: '0.6rem', fontWeight: 600 }}>
                {moveLabel}{familyLabel ? ` · ${familyLabel}` : ''}
              </span>
              {targetLabel && (
                <span style={{ fontSize: '0.65rem', color: !speakerIsTarget ? '#6366f1' : 'var(--text-muted)', fontWeight: !speakerIsTarget ? 600 : 400 }}>
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
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 1 }}>
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
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      This directive was aimed at {targetLabel}, but {speakerLabel(entry.speaker)} was selected to speak. {speakerLabel(entry.speaker)} was not required to respond.
                    </div>
                  </>
                )}
                {!hasResponse && speakerIsTarget && (
                  <>
                    <span style={{ fontWeight: 700, fontSize: '0.72rem', color: complianceColor }}>
                      {complianceIcon} No response
                    </span>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
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
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.25)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f59e0b' }}>
              {'⚠'} Suppressed Intervention
            </span>
            {(suppressedIntervention as any).intervention_move && (
              <span style={{
                padding: '1px 6px', borderRadius: 3, fontSize: '0.65rem', fontWeight: 600,
                background: 'rgba(245, 158, 11, 0.18)', color: '#d97706',
              }}>
                {(suppressedIntervention as any).intervention_move}
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginBottom: 4 }}>
            The moderator recommended a <strong>{(suppressedIntervention as any).intervention_move ?? 'intervention'}</strong>
            {(suppressedIntervention as any).intervention_target && (
              <> directed at <strong>{speakerLabel((suppressedIntervention as any).intervention_target)}</strong></>
            )}
            , but it was blocked by the engine.
          </div>
          <div style={{
            fontSize: '0.7rem', color: '#92400e', padding: '5px 10px', borderRadius: 4,
            background: 'rgba(245, 158, 11, 0.12)', marginBottom: 4,
            borderLeft: '3px solid #d97706',
          }}>
            <strong style={{ color: '#d97706' }}>Reason: </strong>
            {(suppressedIntervention as any).intervention_suppressed_reason && (
              <span
                title={SUPPRESSION_REASON_TOOLTIPS[(suppressedIntervention as any).intervention_suppressed_reason] ?? ''}
                style={{ cursor: 'default', borderBottom: '1px dotted #92400e' }}
              >
                {((suppressedIntervention as any).intervention_suppressed_reason as string).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
              </span>
            )}
            {(suppressedIntervention as any).intervention_suppression_explanation
              ? ((suppressedIntervention as any).intervention_suppressed_reason ? ' — ' : '') + (suppressedIntervention as any).intervention_suppression_explanation
              : (!(suppressedIntervention as any).intervention_suppressed_reason ? 'No reason recorded' : '')
            }
          </div>
          {(suppressedIntervention as any).trigger_reasoning && (
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
              {(suppressedIntervention as any).trigger_reasoning}
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
              const catColor = cat === 'attack' ? '#ef4444' : cat === 'support' ? '#22c55e' : '#888';
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
                  <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, background: 'rgba(59,130,246,0.2)', color: '#3b82f6', fontSize: '0.7rem', fontWeight: 600 }}>{name}</span>
                  <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: `${catColor}18`, color: catColor, fontSize: '0.6rem', fontWeight: 600, textTransform: 'capitalize' }}>{cat}</span>
                  {ann?.target && (() => {
                    const targetNode = an?.nodes?.find(n => n.id === ann.target);
                    return (<>
                      <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--text-muted)' }}>{'→'} {ann.target}</span>
                      {targetNode && <span style={{ marginLeft: 4, fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>"{targetNode.text.length > 100 ? targetNode.text.slice(0, 100) + '…' : targetNode.text}"</span>}
                    </>);
                  })()}
                  {!ann?.target && inferredTargets.length > 0 && (
                    <div style={{ marginTop: 3, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{'→'}</span>
                      {inferredTargets.map(t => (
                        <span key={t.id} data-tooltip={t.text} style={{
                          padding: '1px 5px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 600, cursor: 'default',
                          background: `${t.type === 'attacks' ? '#ef4444' : '#22c55e'}15`,
                          color: t.type === 'attacks' ? '#ef4444' : '#22c55e',
                        }}>{t.id}</span>
                      ))}
                    </div>
                  )}
                  {!ann?.target && inferredTargets.length === 0 && (
                    <span style={{ marginLeft: 6, fontSize: '0.6rem', color: 'var(--text-muted)', opacity: 0.6 }}>no AN target</span>
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
                background: turnValTrail.final.outcome === 'pass' ? 'rgba(22,163,74,0.15)' : turnValTrail.final.outcome === 'accept_with_flag' ? 'rgba(245,158,11,0.15)' : 'rgba(220,38,38,0.15)',
                color: turnValTrail.final.outcome === 'pass' ? '#16a34a' : turnValTrail.final.outcome === 'accept_with_flag' ? '#d97706' : '#dc2626',
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
                          display: 'inline-block', fontSize: '0.6rem', fontWeight: 700,
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
                  <span style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 3, background: 'rgba(139,92,246,0.15)', color: '#8b5cf6', fontSize: '0.65rem', fontWeight: 600, fontFamily: 'monospace' }}>{p}</span>
                  {pol ? (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-primary)' }}>
                      {pol.action}
                      <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: '0.65rem' }}>
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
                    <div style={{ width: `${maxPct > 0 ? (f.percentage / maxPct) * 100 : 0}%`, height: '100%', borderRadius: 3, background: '#f59e0b' }} />
                  </div>
                  <div style={{ width: 36, textAlign: 'right', fontSize: '0.68rem', color: 'var(--text-muted)', flexShrink: 0 }}>{f.percentage.toFixed(1)}%</div>
                </div>
                {f.traditions && f.traditions.length > 0 && (
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2, paddingLeft: 4 }}>
                    {f.traditions.join(', ')}
                  </div>
                )}
              </div>
            ))}
            <div style={{ marginTop: 4, fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              Boost: {lb ? <span style={{ color: '#22c55e' }}>active</span> : <span>inactive</span>}
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

// ---------------------------------------------------------------------------
// Placeholder sub-components for remaining inline tabs.
// These contain the full rendering logic from DiagnosticsWindow but are
// structured as local components to keep the main router readable.
// The actual inline tab implementations (Brief, Plan, Lookahead, Cite)
// are large and will be further extracted in Phase 3.
// For Phase 2, these are kept as stubs that render a "Coming soon" message
// or delegate to the existing inline code via the parent's tab content area.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Inline tab sub-components: Brief, Plan, Lookahead, Cite
// Ported from DiagnosticsWindow.tsx lines 4955-7273 (Phase 2 — full inline)
// ---------------------------------------------------------------------------

function BriefTabContent(props: {
  entry: DebateSession['transcript'][number];
  briefStage: any;
  briefAttempts: any[];
  turnValTrail: TurnValidationTrail | undefined;
  nodeWeights: Map<string, { confidence?: number; priority?: number; operationality?: number; category?: string }>;
  taxNodeMap: Map<string, Record<string, unknown>>;
  allEdges: TaxRefEdge[];
  selectedTaxRefId: string | null;
  setSelectedTaxRefId: (id: string | null) => void;
}) {
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

function PlanTabContent(props: {
  planStage: any;
  planAttempts: any[];
  taxNodeMap: Map<string, Record<string, unknown>>;
  allEdges: TaxRefEdge[];
  selectedTaxRefId: string | null;
  setSelectedTaxRefId: (id: string | null) => void;
}) {
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
              <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: 600, fontSize: '0.68rem' }}>OPPONENT INTELLIGENCE</span>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 400 }}>{hints.length} hint{hints.length !== 1 ? 's' : ''}</span>
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
                    <span style={{ display: 'inline-block', padding: '0 4px', borderRadius: 3, background: `${typeColor}15`, color: typeColor, fontSize: '0.62rem', fontWeight: 600, marginRight: 6 }}>{typeLabel}</span>
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
              {m.target && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--text-muted)' }}>{'→'} {m.target}</span>}
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
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Anchor: </span>
                  <button
                    onClick={() => setSelectedTaxRefId(selectedTaxRefId === s.taxonomy_anchor ? null : s.taxonomy_anchor)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontFamily: 'monospace', fontSize: '0.65rem' }}
                  >{s.taxonomy_anchor}</button>
                  {(() => { const lbl = (taxNodeMap.get(s.taxonomy_anchor!) as TaxRefNode | undefined)?.label; return lbl ? <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}> — {lbl}</span> : null; })()}
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
                fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600,
              }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span>Attempt {ai + 1}{isFinal ? ' (accepted)' : ' (rejected)'}</span>
                <span style={{ fontWeight: 400 }}>{(attempt.response_time_ms / 1000).toFixed(1)}s</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
            )}
            {/* Raw Prompt */}
            <details style={{ marginTop: isSingle ? 8 : 4 }}>
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
            {/* Validation pass/fail + per-rule details */}
            {valData && (
              <div style={{ marginTop: 4, fontSize: '0.7rem' }}>
                <span style={{
                  display: 'inline-block', fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px',
                  borderRadius: 3, marginRight: 6,
                  color: valData.pass ? '#16a34a' : '#dc2626',
                  background: valData.pass ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                }}>{valData.pass ? '✓ Pass' : '✗ Fail'}</span>
                {/* Per-rule details (Plan stage) */}
                {(valData as { details?: { rule: string; pass: boolean; value?: string }[] }).details && (
                  <table style={{ marginTop: 4, fontSize: '0.68rem', borderCollapse: 'collapse' }}>
                    <tbody>
                      {(valData as { details: { rule: string; pass: boolean; value?: string }[] }).details.map((d, di) => (
                        <tr key={di}>
                          <td style={{ padding: '1px 4px 1px 0', color: d.pass ? '#16a34a' : '#dc2626', width: 14 }}>{d.pass ? '✓' : '✗'}</td>
                          <td style={{ padding: '1px 6px 1px 0', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{d.rule}</td>
                          <td style={{ padding: '1px 0', color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.63rem', whiteSpace: 'nowrap' }}>{d.value ?? ''}</td>
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

function LookaheadTabContent(props: {
  lookaheadDiag: any;
}) {
  const { lookaheadDiag } = props;
  return (
    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        <span style={{
          padding: '1px 6px', borderRadius: 3, fontWeight: 600,
          background: lookaheadDiag.final_pass ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)',
          color: lookaheadDiag.final_pass ? '#16a34a' : '#dc2626',
        }}>{lookaheadDiag.final_pass ? '✓ PASS' : '✗ FAIL'}</span>
        <span>LOOKAHEAD</span>
        <span>{(lookaheadDiag.elapsed_ms / 1000).toFixed(1)}s</span>
        {lookaheadDiag.regen_triggered && <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(245,158,11,0.2)', color: '#d97706', fontWeight: 600, fontSize: '0.62rem' }}>REGEN TRIGGERED</span>}
      </div>

      {/* Utility Delta Gauge */}
      {(() => {
        const r = lookaheadDiag.first_attempt;
        const before = r.utility_before.composite;
        const after = r.utility_after.composite;
        const delta = r.utility_delta;
        const pct = Math.min(Math.max((after / Math.max(before, 0.01)) * 50, 5), 95);
        const deltaColor = delta > 0.05 ? '#16a34a' : delta >= 0 ? '#d97706' : '#dc2626';
        return (
          <div style={{ padding: 8, margin: '6px 0', borderLeft: `3px solid ${deltaColor}`, background: `${deltaColor}08`, borderRadius: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginBottom: 6 }}>
              <span>Before: <strong>{before.toFixed(3)}</strong></span>
              <span style={{ color: deltaColor, fontWeight: 700 }}>{'Δ'}u = {delta >= 0 ? '+' : ''}{delta.toFixed(3)}</span>
              <span>After: <strong>{after.toFixed(3)}</strong></span>
            </div>
            <div style={{ height: 10, borderRadius: 5, background: 'var(--bg-secondary)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '50%', background: 'rgba(128,128,128,0.15)', borderRight: '2px solid var(--text-muted)' }} />
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: deltaColor, borderRadius: 5, transition: 'width 0.3s' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 2 }}>
              <span>threshold: {r.threshold.toFixed(3)}</span>
              <span>{r.pass ? '✓ passed' : '✗ below threshold'}</span>
            </div>
          </div>
        );
      })()}

      {/* Strategic Assessment */}
      {(() => {
        const r = lookaheadDiag.first_attempt;
        const posDelta = r.utility_after.position_strength - r.utility_before.position_strength;
        const atkDelta = r.utility_after.attack_effectiveness - r.utility_before.attack_effectiveness;
        const crxDelta = r.utility_after.crux_engagement - r.utility_before.crux_engagement;
        const claims = r.tentative_claims;
        const weakClaims = claims.filter((c: any) => c.strength < 0.4).length;
        const strongClaims = claims.filter((c: any) => c.strength >= 0.7).length;

        const assessments: string[] = [];
        if (posDelta < -0.03 && r.utility_before.position_strength > 0.7) {
          assessments.push(`Position dilution: speaker had strong position (${r.utility_before.position_strength.toFixed(2)}) but new claims drag the average down${weakClaims > 0 ? ` — ${weakClaims} weak claim${weakClaims !== 1 ? 's' : ''} (< 0.4 strength) pulling the mean` : ''}.`);
        } else if (posDelta < -0.03) {
          assessments.push(`Position weakened: new claims undermine the speaker's existing arguments.`);
        } else if (posDelta > 0.03) {
          assessments.push(`Position strengthened: new claims reinforce the speaker's stance (+${posDelta.toFixed(3)}).`);
        }
        if (atkDelta < 0.001 && r.utility_before.attack_effectiveness < 0.3) {
          assessments.push(`No offensive impact: claims are defensive — they reinforce the speaker's position but don't target opponent weak points.`);
        } else if (atkDelta < 0.001 && r.utility_before.attack_effectiveness >= 0.3) {
          assessments.push(`Attack plateau: speaker already has good attack coverage (${r.utility_before.attack_effectiveness.toFixed(2)}) and these claims don't extend it.`);
        } else if (atkDelta > 0.05) {
          assessments.push(`Strong offensive move: attacks landed on opponent nodes (+${atkDelta.toFixed(3)} effectiveness).`);
        }
        if (crxDelta < 0.001 && r.utility_before.crux_engagement >= 0.9) {
          assessments.push(`Cruxes fully addressed: all identified cruxes already engaged — new claims don't open new territory.`);
        } else if (crxDelta < 0.001 && r.utility_before.crux_engagement < 0.5) {
          assessments.push(`Crux avoidance: ${((1 - r.utility_before.crux_engagement) * 100).toFixed(0)}% of cruxes unaddressed and these claims don't engage them.`);
        } else if (crxDelta > 0.05) {
          assessments.push(`Crux engagement improved: speaker addressed previously unengaged disagreement points.`);
        }
        if (!r.pass && posDelta < 0 && atkDelta < 0.001) {
          assessments.push(`Pattern: padding — speaker is adding volume without advancing the debate. Retry hint would push toward targeted attacks on opponent weak points or unresolved cruxes.`);
        } else if (!r.pass && r.utility_delta >= 0 && r.utility_delta < r.threshold) {
          assessments.push(`Pattern: marginal — claims add slight value but below the threshold for meaningful contribution. More specific, falsifiable claims would score higher.`);
        } else if (r.pass && r.utility_delta > 0.05) {
          assessments.push(`Pattern: strong move — claims meaningfully advance the speaker's position.`);
        }

        if (assessments.length === 0) return null;
        return (
          <div style={{ margin: '6px 0', padding: '6px 8px', borderRadius: 4, background: 'var(--bg-secondary)', fontSize: '0.7rem', lineHeight: 1.5 }}>
            <div style={{ fontWeight: 600, fontSize: '0.68rem', marginBottom: 4, color: 'var(--text-muted)' }}>STRATEGIC ASSESSMENT</div>
            {assessments.map((a, i) => (
              <div key={i} style={{ margin: '3px 0', paddingLeft: 8, borderLeft: `2px solid ${a.includes('Pattern:') ? (r.pass ? '#16a34a40' : '#dc262640') : '#6b728040'}` }}>
                {a}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Utility Breakdown */}
      <details open style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem' }}>Utility Breakdown</summary>
        <table style={{ width: '100%', fontSize: '0.68rem', borderCollapse: 'collapse', marginTop: 4 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <th style={{ textAlign: 'left', padding: '2px 6px' }}>Component</th>
              <th style={{ textAlign: 'right', padding: '2px 6px' }}>Before</th>
              <th style={{ textAlign: 'right', padding: '2px 6px' }}>After</th>
              <th style={{ textAlign: 'right', padding: '2px 6px' }}>{'Δ'}</th>
              <th style={{ textAlign: 'left', padding: '2px 6px' }}>Assessment</th>
            </tr>
          </thead>
          <tbody>
            {(['position_strength', 'attack_effectiveness', 'crux_engagement', 'composite'] as const).map(k => {
              const b = lookaheadDiag.first_attempt.utility_before[k];
              const a = lookaheadDiag.first_attempt.utility_after[k];
              const d = a - b;
              const hint = k === 'position_strength'
                ? (d < -0.03 ? 'diluting' : d > 0.03 ? 'reinforcing' : 'stable')
                : k === 'attack_effectiveness'
                ? (d < 0.001 ? (b < 0.3 ? 'no attacks' : 'plateau') : 'attacks landed')
                : k === 'crux_engagement'
                ? (d < 0.001 ? (b >= 0.9 ? 'fully engaged' : 'avoiding cruxes') : 'engaging')
                : '';
              const hintColor = hint === 'diluting' || hint === 'no attacks' || hint === 'avoiding cruxes' ? '#dc2626'
                : hint === 'stable' || hint === 'plateau' || hint === 'fully engaged' ? 'var(--text-muted)'
                : '#16a34a';
              return (
                <tr key={k} style={{ borderBottom: '1px solid var(--border)', fontWeight: k === 'composite' ? 700 : 400 }}>
                  <td style={{ padding: '2px 6px' }}>{k.replace(/_/g, ' ')}</td>
                  <td style={{ textAlign: 'right', padding: '2px 6px' }}>{b.toFixed(3)}</td>
                  <td style={{ textAlign: 'right', padding: '2px 6px' }}>{a.toFixed(3)}</td>
                  <td style={{ textAlign: 'right', padding: '2px 6px', color: d > 0 ? '#16a34a' : d < 0 ? '#dc2626' : 'var(--text-muted)' }}>{d >= 0 ? '+' : ''}{d.toFixed(3)}</td>
                  <td style={{ padding: '2px 6px', fontSize: '0.62rem', color: hintColor, fontStyle: 'italic' }}>{hint}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>

      {/* Tentative Claims with Per-Claim Marginal Utility */}
      {lookaheadDiag.first_attempt.tentative_claims.length > 0 && (() => {
        const firstPca = lookaheadDiag.per_claim_analysis?.[0];
        const claims = lookaheadDiag.first_attempt.tentative_claims;
        const strongCount = firstPca ? firstPca.perClaim.filter((pc: any) => pc.classification === 'STRONG').length : claims.filter((c: any) => c.strength >= 0.7).length;
        const weakCount = firstPca ? firstPca.perClaim.filter((pc: any) => pc.classification === 'WEAK').length : claims.filter((c: any) => c.strength < 0.4).length;
        return (
          <details open style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem' }}>
            Tentative Claims ({claims.length})
            <span style={{ fontWeight: 400, fontSize: '0.62rem', marginLeft: 8, color: 'var(--text-muted)' }}>
              {strongCount > 0 && <span style={{ color: '#16a34a' }}>{strongCount} strong</span>}
              {strongCount > 0 && weakCount > 0 && ', '}
              {weakCount > 0 && <span style={{ color: '#dc2626' }}>{weakCount} weak</span>}
            </span>
          </summary>
            {claims.map((c: any, i: number) => {
              const pca = firstPca?.perClaim[i];
              const classification = pca?.classification;
              const marginalDelta = pca?.marginal_delta;
              const reason = firstPca?.analysis[classification === 'STRONG' ? 'strongFoundations' : 'avoidClaims']
                ?.find((a: any) => a.text === c.text)?.reason;
              const claimColor = classification === 'STRONG' ? '#16a34a' : classification === 'WEAK' ? '#dc2626' : (c.strength >= 0.7 ? '#16a34a' : c.strength >= 0.4 ? '#d97706' : '#dc2626');
              const label = classification ?? (c.strength >= 0.7 ? 'STRONG' : c.strength >= 0.4 ? 'MODERATE' : 'WEAK');
              return (
                <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: `2px solid ${claimColor}40`, fontSize: '0.7rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.6rem', color: claimColor, fontWeight: 600 }}>{c.strength.toFixed(2)}</span>
                    <span style={{ fontSize: '0.58rem', padding: '0 4px', borderRadius: 3, background: `${claimColor}15`, color: claimColor, fontWeight: 600 }}>{label}</span>
                    {marginalDelta != null && (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.58rem', color: marginalDelta >= 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                        {'Δ'}u {marginalDelta >= 0 ? '+' : ''}{marginalDelta.toFixed(4)}
                      </span>
                    )}
                  </div>
                  <Highlight text={c.text} />
                  {reason && (
                    <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2, paddingLeft: 4 }}>{reason}</div>
                  )}
                </div>
              );
            })}
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Tentative network: {lookaheadDiag.first_attempt.tentative_network_size.nodes} nodes, {lookaheadDiag.first_attempt.tentative_network_size.edges} edges
            </div>
          </details>
        );
      })()}

      {/* Attempt Progression Summary */}
      {lookaheadDiag.per_claim_analysis && lookaheadDiag.per_claim_analysis.length > 0 && (
        <div style={{ margin: '6px 0', padding: '6px 8px', borderRadius: 4, background: 'var(--bg-secondary)', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
          {lookaheadDiag.per_claim_analysis.map((pca: any, idx: number) => {
            const sCount = pca.perClaim.filter((pc: any) => pc.classification === 'STRONG').length;
            const wCount = pca.perClaim.filter((pc: any) => pc.classification === 'WEAK').length;
            const regenAttempts = lookaheadDiag.regen_attempts ?? (lookaheadDiag.regen_attempt ? [lookaheadDiag.regen_attempt] : []);
            const delta = idx === 0 ? lookaheadDiag.first_attempt.utility_delta : regenAttempts[idx - 1]?.utility_delta;
            const pass = idx === 0 ? lookaheadDiag.first_attempt.pass : regenAttempts[idx - 1]?.pass;
            return (
              <div key={idx} style={{ display: 'inline-block', marginRight: 12 }}>
                <span style={{ fontWeight: 600 }}>Attempt {idx + 1}:</span>{' '}
                <span style={{ color: delta != null && delta >= 0 ? '#16a34a' : '#dc2626' }}>{'Δ'}u = {delta != null ? (delta >= 0 ? '+' : '') + delta.toFixed(3) : '?'}</span>{' '}
                ({sCount} strong, {wCount} weak){pass ? ' ✓' : ''}
              </div>
            );
          })}
        </div>
      )}

      {/* Regeneration Attempts */}
      {lookaheadDiag.regen_triggered && (() => {
        const attempts = lookaheadDiag.regen_attempts ?? (lookaheadDiag.regen_attempt ? [lookaheadDiag.regen_attempt] : []);
        if (attempts.length === 0) return null;
        const pcaLog = lookaheadDiag.per_claim_analysis;
        return attempts.map((ra: any, ai: number) => {
          const guidancePca = pcaLog?.[ai];
          const regenPca = pcaLog?.[ai + 1];
          return (
            <div key={ai} style={{ marginTop: 8, padding: 8, borderLeft: '3px solid #d97706', background: 'rgba(245,158,11,0.06)', borderRadius: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(245,158,11,0.2)', color: '#d97706', fontWeight: 600, fontSize: '0.68rem' }}>REGEN {ai + 1}/{attempts.length}</span>
                <span style={{
                  padding: '1px 6px', borderRadius: 3, fontWeight: 600, fontSize: '0.62rem',
                  background: ra.pass ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)',
                  color: ra.pass ? '#16a34a' : '#dc2626',
                }}>{ra.pass ? '✓ PASS' : '✗ FAIL'}</span>
              </div>
              <div style={{ fontSize: '0.72rem' }}>
                <span>{'Δ'}u = {ra.utility_delta >= 0 ? '+' : ''}{ra.utility_delta.toFixed(3)}</span>
                <span style={{ marginLeft: 12, color: 'var(--text-muted)' }}>threshold: {ra.threshold.toFixed(3)}</span>
              </div>

              {/* Guidance injected into this retry */}
              {guidancePca && (guidancePca.analysis.strongFoundations.length > 0 || guidancePca.analysis.avoidClaims.length > 0) && (
                <details style={{ marginTop: 4 }}><summary style={{ cursor: 'pointer', fontSize: '0.68rem', color: 'var(--text-muted)' }}>Guidance Injected</summary>
                  {guidancePca.analysis.strongFoundations.length > 0 && (
                    <div style={{ marginTop: 2 }}>
                      <div style={{ fontSize: '0.6rem', fontWeight: 600, color: '#16a34a', marginBottom: 2 }}>STRONG FOUNDATIONS</div>
                      {guidancePca.analysis.strongFoundations.map((sf: any, si: number) => (
                        <div key={si} style={{ margin: '2px 0', paddingLeft: 8, borderLeft: '2px solid rgba(22,163,74,0.3)', fontSize: '0.62rem' }}>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.54rem', color: '#16a34a', marginRight: 4 }}>{'Δ'}u +{sf.marginal_delta.toFixed(4)}</span>
                          <span>{sf.text.slice(0, 80)}{sf.text.length > 80 ? '…' : ''}</span>
                          <div style={{ fontSize: '0.54rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{sf.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {guidancePca.analysis.avoidClaims.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: '0.6rem', fontWeight: 600, color: '#dc2626', marginBottom: 2 }}>DO NOT USE</div>
                      {guidancePca.analysis.avoidClaims.map((ac: any, aci: number) => (
                        <div key={aci} style={{ margin: '2px 0', paddingLeft: 8, borderLeft: '2px solid rgba(220,38,38,0.3)', fontSize: '0.62rem' }}>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.54rem', color: '#dc2626', marginRight: 4 }}>{'Δ'}u {ac.marginal_delta.toFixed(4)}</span>
                          <span>{ac.text.slice(0, 80)}{ac.text.length > 80 ? '…' : ''}</span>
                          <div style={{ fontSize: '0.54rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{ac.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              )}

              {/* Regen claims with per-claim analysis if available */}
              {ra.tentative_claims.length > 0 && (
                <details style={{ marginTop: 4 }}><summary style={{ cursor: 'pointer', fontSize: '0.68rem', color: 'var(--text-muted)' }}>Regen Claims ({ra.tentative_claims.length})</summary>
                  {ra.tentative_claims.map((c: any, ci: number) => {
                    const pc = regenPca?.perClaim[ci];
                    const pcColor = pc ? (pc.classification === 'STRONG' ? '#16a34a' : '#dc2626') : 'var(--text-muted)';
                    return (
                      <div key={ci} style={{ margin: '3px 0', paddingLeft: 8, borderLeft: `2px solid ${pcColor}40`, fontSize: '0.68rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.58rem', color: pcColor, fontWeight: 600 }}>{c.strength.toFixed(2)}</span>
                          {pc && <span style={{ fontSize: '0.54rem', padding: '0 3px', borderRadius: 2, background: `${pcColor}15`, color: pcColor, fontWeight: 600 }}>{pc.classification}</span>}
                          {pc && <span style={{ fontFamily: 'monospace', fontSize: '0.54rem', color: pcColor }}>{'Δ'}u {pc.marginal_delta >= 0 ? '+' : ''}{pc.marginal_delta.toFixed(4)}</span>}
                        </div>
                        <Highlight text={c.text} />
                      </div>
                    );
                  })}
                </details>
              )}
            </div>
          );
        });
      })()}

      {/* Low Utility Warning */}
      {!lookaheadDiag.final_pass && (
        <div style={{
          marginTop: 8, padding: '8px 10px', borderRadius: 4,
          borderLeft: '3px solid #dc2626', background: 'rgba(220,38,38,0.08)',
          fontSize: '0.72rem', color: '#dc2626', fontWeight: 600,
        }}>
          Low utility turn — all attempts failed threshold. Committed anyway; <code>low_utility_turn</code> logged.
        </div>
      )}

      {/* Raw Data */}
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Raw Data <CopyButton text={JSON.stringify(lookaheadDiag, null, 2)} />
        </summary>
        <pre style={{ fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(lookaheadDiag, null, 2)}</pre>
      </details>
    </div>
  );
}

function CiteTabContent(props: {
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
}) {
  const { entry, debate, citeStage, citeAttempts, briefStage, turnValTrail, taxNodeMap, allEdges, policyMap, selectedTaxRefId, setSelectedTaxRefId, selectedPolicyId, setSelectedPolicyId } = props;
  return (
    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
      {/* -- Top section: header + content from final cite -- */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        <span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(251,146,60,0.2)', color: '#fb923c', fontWeight: 600 }}>CITE</span>
        <span>{citeStage.model}</span>
        <span>temp={citeStage.temperature}</span>
        <span>{(citeStage.response_time_ms / 1000).toFixed(1)}s</span>
        {typeof (citeStage.work_product as Record<string, unknown>).grounding_confidence === 'number' && (
          <span style={{ padding: '1px 6px', borderRadius: 3, background: (citeStage.work_product as Record<string, unknown>).grounding_confidence as number >= 0.7 ? 'rgba(34,197,94,0.2)' : 'rgba(251,146,60,0.2)', fontSize: '0.65rem' }}>
            confidence: {((citeStage.work_product as Record<string, unknown>).grounding_confidence as number).toFixed(2)}
          </span>
        )}
      </div>
      {citeStage.parse_error && (
        <div style={{ padding: '6px 8px', margin: '6px 0', background: 'rgba(220,38,38,0.1)', borderLeft: '3px solid #dc2626', borderRadius: 4, fontSize: '0.72rem', color: '#dc2626' }}>
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
            <span style={{ marginLeft: 6, fontWeight: 400, fontSize: '0.65rem', color: '#f59e0b' }}>
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
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: isSelected ? 'rgba(245, 158, 11, 0.08)' : 'transparent' }}>
                    <td style={{ padding: '3px 6px', verticalAlign: 'top', overflow: 'hidden' }}>
                      <div>
                        <button
                          onClick={() => setSelectedTaxRefId(isSelected ? null : r.node_id)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontWeight: isSelected ? 700 : 600, textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'inherit', textAlign: 'left' }}
                          title="Show node details"
                        >{r.primary ? '★ ' : ''}{r.node_id}</button>
                        {isNew && (
                          <span title="New: not in Brief's relevant taxonomy nodes" style={{ marginLeft: 3, color: '#22c55e', fontWeight: 700, fontSize: '0.8em' }}>+</span>
                        )}
                        {promotedSet.has(r.node_id) ? (
                          <span
                            title={`Promoted into context by lineage boost — would not appear without boost${boostTraditions.length > 0 ? ` (${boostTraditions.join(', ')})` : ''}`}
                            style={{ marginLeft: 3, display: 'inline-block', padding: '0 4px', borderRadius: 2, background: 'rgba(245,158,11,0.25)', color: '#f59e0b', fontWeight: 700, fontSize: '0.65em', lineHeight: '1.4' }}
                          >L{'↑'}</span>
                        ) : boostedSet.has(r.node_id) ? (
                          <span
                            title={`Relevance score boosted by lineage matching${boostTraditions.length > 0 ? ` (${boostTraditions.join(', ')})` : ''}`}
                            style={{ marginLeft: 3, display: 'inline-block', padding: '0 3px', borderRadius: 2, background: 'rgba(245,158,11,0.12)', color: '#d97706', fontWeight: 600, fontSize: '0.65em', lineHeight: '1.4' }}
                          >L</span>
                        ) : null}
                      </div>
                      {nodeLabel && (
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }} title={nodeLabel}>
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
            <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid rgba(251,146,60,0.3)' }}>
              <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, background: 'rgba(251,146,60,0.2)', color: '#fb923c', fontSize: '0.7rem', fontWeight: 600 }}>{m.move}</span>
              {m.target && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--text-muted)' }}>{'→'} {m.target}</span>}
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
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: isSelected ? 'rgba(139,92,246,0.08)' : 'transparent' }}>
                    <td style={{ padding: '3px 6px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      <button
                        onClick={() => setSelectedPolicyId(isSelected ? null : p)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#8b5cf6', fontWeight: isSelected ? 700 : 600, textDecoration: 'underline', fontFamily: 'monospace', fontSize: 'inherit', textAlign: 'left' }}
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
              <div style={{ margin: '6px 0', padding: '8px 10px', borderRadius: 6, background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#8b5cf6', fontSize: '0.72rem' }}>{selectedPolicyId}</span>
                  <button onClick={() => setSelectedPolicyId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{'×'}</button>
                </div>
                {pol ? (<>
                  <div style={{ fontSize: '0.75rem', lineHeight: 1.5, marginBottom: 4 }}>{pol.action}</div>
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
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
            {lb && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: '#22c55e', fontWeight: 400 }}>boost active</span>}
          </summary>
            {frame.map((f: { cluster_id: string; label?: string; percentage: number; traditions?: string[] }, i: number) => (
              <div key={i} style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '2px solid rgba(245,158,11,0.3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>{f.label ?? f.cluster_id}</span>
                  <span style={{ fontSize: '0.65rem', color: '#f59e0b' }}>{(f.percentage * 100).toFixed(0)}%</span>
                </div>
                {f.traditions && f.traditions.length > 0 && (
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 1 }}>
                    {f.traditions.join(', ')}
                  </div>
                )}
              </div>
            ))}
            {lb && (
              <div style={{ marginTop: 4, fontSize: '0.65rem', color: 'var(--text-muted)' }}>
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
    </div>
  );
}
