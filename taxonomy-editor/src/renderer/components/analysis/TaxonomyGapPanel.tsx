// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { POV_KEYS } from '@lib/debate/types';
import type {
  DebateSession,
  TaxonomyGapAnalysis,
  PovCoverage,
  BdiBalance,
  CrossPovGap,
  UnmappedArgument,
  GapInjection,
  CrossCuttingProposal,
} from '../../types/debate';
import { POVER_INFO } from '../../types/debate';
import type { SpeakerId } from '../../types/debate';
import './TaxonomyGapPanel.css';

interface Props {
  debate: DebateSession;
}

// ── Helpers ─────────────────────────────────────────────

function coverageColor(pct: number): string {
  if (pct > 70) return '#22c55e';
  if (pct >= 40) return '#f59e0b';
  return '#ef4444';
}

const GAP_TYPE_COLORS: Record<string, { label: string; bg: string; fg: string }> = {
  cross_cutting:    { label: 'Cross-cutting',    bg: 'rgba(139,92,246,0.15)',  fg: '#8b5cf6' },
  novel_argument:   { label: 'Novel argument',   bg: 'rgba(59,130,246,0.15)',  fg: '#3b82f6' },
  refinement_needed:{ label: 'Refinement needed', bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b' },
  compromise:       { label: 'Compromise',        bg: 'rgba(34,197,94,0.15)',  fg: '#22c55e' },
  blind_spot:       { label: 'Blind spot',        bg: 'rgba(239,68,68,0.15)',  fg: '#ef4444' },
  unstated_assumption: { label: 'Unstated assumption', bg: 'rgba(148,163,184,0.15)', fg: '#64748b' },
};

function GapBadge({ type }: { type: string }) {
  const info = GAP_TYPE_COLORS[type] || { label: type, bg: 'rgba(148,163,184,0.15)', fg: '#64748b' };
  return (
    <span
      className="tgap-badge"
      /* eslint-disable-next-line local/no-inline-style -- dynamic: gap-type-derived bg/fg colors */
      style={{ background: info.bg, color: info.fg }}
    >
      {info.label}
    </span>
  );
}

function PovBadge({ pov }: { pov: string }) {
  const entry = Object.entries(POVER_INFO).find(([, v]) => v.pov === pov || v.label.toLowerCase() === pov.toLowerCase());
  const color = entry ? entry[1].color : '#888';
  const label = entry ? entry[1].label : pov;
  return (
    <span
      className="tgap-badge"
      /* eslint-disable-next-line local/no-inline-style -- dynamic: pov-derived bg/color/border */
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {label}
    </span>
  );
}

function BdiBadge({ bdi }: { bdi: string }) {
  const colors: Record<string, string> = { belief: '#3b82f6', desire: '#22c55e', intention: '#f59e0b', beliefs: '#3b82f6', desires: '#22c55e', intentions: '#f59e0b' };
  const c = colors[bdi.toLowerCase()] || '#888';
  return (
    <span
      className="tgap-badge"
      /* eslint-disable-next-line local/no-inline-style -- dynamic: bdi-derived bg/color */
      style={{ background: `${c}22`, color: c }}
    >
      {bdi.charAt(0).toUpperCase() + bdi.slice(1)}
    </span>
  );
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="tgap-progress-track">
      <div
        className="tgap-progress-fill"
        /* eslint-disable-next-line local/no-inline-style -- dynamic: pct width + series color */
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

// ── Section 1: Summary Banner ───────────────────────────

function SummaryBanner({ summary }: { summary: TaxonomyGapAnalysis['summary'] }) {
  const color = coverageColor(summary.overall_coverage_pct);
  return (
    <div className="tgap-section">
      <div className="tgap-section-header">Gap Analysis Summary</div>
      <div className="tgap-summary-row">
        {/* Coverage */}
        <div className="tgap-summary-coverage-card">
          <div
            className="tgap-coverage-circle"
            /* eslint-disable-next-line local/no-inline-style -- dynamic: coverage-derived border/text color */
            style={{ border: `3px solid ${color}`, color }}
          >
            {Math.round(summary.overall_coverage_pct)}%
          </div>
          <div>
            <div className="tgap-muted-label">Overall Coverage</div>
            <div className="tgap-value-sm">
              {summary.overall_coverage_pct > 70 ? 'Good' : summary.overall_coverage_pct >= 40 ? 'Moderate' : 'Low'}
            </div>
          </div>
        </div>

        {/* Underserved POV */}
        <div className="tgap-card-flex120">
          <div className="tgap-muted-label-mb2">Most Underserved Perspective</div>
          <div className="tgap-value-sm">{summary.most_underserved_pov}</div>
        </div>

        {/* Underserved BDI */}
        <div className="tgap-card-flex120">
          <div className="tgap-muted-label-mb2">Weakest BDI Layer</div>
          <div className="tgap-value-sm">{summary.most_underserved_bdi}</div>
        </div>

        {/* Unmapped count */}
        <div className="tgap-card-flex100">
          <div className="tgap-muted-label-mb2">Unmapped Args</div>
          <div className="tgap-value-lg">{summary.unmapped_argument_count}</div>
        </div>

        {/* Cross-POV gaps */}
        <div className="tgap-card-flex100">
          <div className="tgap-muted-label-mb2">Cross-Perspective Gaps</div>
          <div className="tgap-value-lg">{summary.cross_pov_gap_count}</div>
        </div>
      </div>

      {/* Recommendation */}
      {summary.recommendation && (
        <div className="tgap-recommendation">
          {summary.recommendation}
        </div>
      )}
    </div>
  );
}

// ── Section 2: Per-Perspective Coverage ─────────────────────────

function PovCoverageCard({ pov, coverage, bdi }: { pov: string; coverage: PovCoverage; bdi?: BdiBalance }) {
  const [expanded, setExpanded] = useState(false);
  const entry = Object.entries(POVER_INFO).find(([, v]) => v.pov === pov);
  const color = entry ? entry[1].color : '#888';
  const label = entry ? entry[1].label : pov;

  const unusedNodes = coverage.unreferenced_relevant || [];
  const showLimit = 5;

  return (
    <div className="tgap-pov-card">
      <div
        className="tgap-pov-title"
        /* eslint-disable-next-line local/no-inline-style -- dynamic: pov-derived color/border */
        style={{ color, borderBottom: `2px solid ${color}` }}
      >
        {label}
      </div>

      {/* Node counts */}
      <div className="tgap-node-counts">
        <span className="tgap-fw600">{coverage.referenced_nodes}</span>
        <span className="tgap-muted"> / {coverage.injected_nodes} nodes referenced</span>
        {coverage.total_nodes > 0 && (
          <span className="tgap-muted-ml4">
            ({coverage.total_nodes} total)
          </span>
        )}
      </div>

      {/* Utilization bar */}
      <div className="tgap-util-row">
        <ProgressBar value={coverage.referenced_nodes} max={coverage.injected_nodes || 1} color={color} />
        <span className="tgap-util-pct">
          {Math.round(coverage.utilization_rate * 100)}%
        </span>
      </div>

      {/* BDI breakdown */}
      {bdi && (
        <div className="tgap-mb8">
          <div className="tgap-2xs-label">BDI Breakdown</div>
          {(['beliefs', 'desires', 'intentions'] as const).map(cat => {
            const d = bdi[cat];
            const isWeakest = bdi.weakest_category.toLowerCase() === cat;
            const catColor = cat === 'beliefs' ? '#3b82f6' : cat === 'desires' ? '#22c55e' : '#f59e0b';
            return (
              <div key={cat} className="tgap-bdi-row">
                <span
                  className="tgap-bdi-cat"
                  /* eslint-disable-next-line local/no-inline-style -- dynamic: weakest-category weight/color */
                  style={{ fontWeight: isWeakest ? 700 : 400, color: isWeakest ? '#ef4444' : 'var(--text-muted)' }}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </span>
                <ProgressBar value={d.cited_count} max={d.node_count || 1} color={catColor} />
                <span className="tgap-bdi-count">
                  {d.cited_count}/{d.node_count}
                </span>
              </div>
            );
          })}
          {bdi.recommendation && (
            <div className="tgap-bdi-rec">
              {bdi.recommendation}
            </div>
          )}
        </div>
      )}

      {/* Primary but unused nodes */}
      {unusedNodes.length > 0 && (
        <div>
          <div className="tgap-unused-header">
            Primary but unused ({unusedNodes.length})
          </div>
          {unusedNodes.slice(0, expanded ? undefined : showLimit).map((nodeId, i) => (
            <code key={i} className="tgap-node-code">
              {nodeId}
            </code>
          ))}
          {unusedNodes.length > showLimit && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="tgap-link-btn-mt2"
            >
              {expanded ? 'Show less' : `and ${unusedNodes.length - showLimit} more...`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PovCoverageSection({ analysis }: { analysis: TaxonomyGapAnalysis }) {
  const povKeys = Object.keys(analysis.pov_coverage);
  if (povKeys.length === 0) return null;

  return (
    <div className="tgap-section">
      <div className="tgap-section-header">Per-Perspective Coverage</div>
      <div className="tgap-flex-wrap-g10">
        {povKeys.map(pov => (
          <PovCoverageCard
            key={pov}
            pov={pov}
            coverage={analysis.pov_coverage[pov]}
            bdi={analysis.bdi_balance[pov]}
          />
        ))}
      </div>
    </div>
  );
}

// ── Section 3: Unmapped Arguments ───────────────────────

function UnmappedArgumentsSection({ args }: { args: UnmappedArgument[] }) {
  if (args.length === 0) return null;

  return (
    <div className="tgap-section">
      <div className="tgap-section-header">Unmapped Arguments ({args.length})</div>
      <div className="tgap-card-table">
        <table className="tgap-table">
          <thead>
            <tr className="tgap-thead-row">
              <th className="tgap-th">AN Node</th>
              <th className="tgap-th">Speaker</th>
              <th className="tgap-th">Text</th>
              <th className="tgap-th">Gap Type</th>
            </tr>
          </thead>
          <tbody>
            {args.map((arg, i) => (
              <tr key={i} className="tgap-tr">
                <td className="tgap-td-nowrap">
                  <code className="tgap-2xs">{arg.an_node_id}</code>
                </td>
                <td className="tgap-td-nowrap">
                  {speakerLabel(arg.speaker)}
                </td>
                <td className="tgap-td-text">
                  {arg.text.length > 100 ? arg.text.slice(0, 100) + '...' : arg.text}
                </td>
                <td className="tgap-td">
                  <GapBadge type={arg.gap_type} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function speakerLabel(speaker: string): string {
  if (speaker === 'system') return 'Moderator';
  if (speaker === 'user') return 'You';
  const info = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>];
  return info?.label || speaker;
}

// ── Section 4: Cross-POV Gaps ───────────────────────────

function CrossPovGapsSection({ gaps }: { gaps: CrossPovGap[] }) {
  if (gaps.length === 0) return null;

  return (
    <div className="tgap-section">
      <div className="tgap-section-header">Cross-Perspective Gaps ({gaps.length})</div>
      <div className="tgap-flex-col-g8">
        {gaps.map((gap, i) => (
          <div key={i} className="tgap-card">
            <div className="tgap-desc-mb6">
              {gap.description}
            </div>
            <div className="tgap-flex-badges">
              <PovBadge pov={gap.suggested_pov} />
              <BdiBadge bdi={gap.suggested_bdi} />
              {gap.evidence_entries.length > 0 && (
                <span className="tgap-2xs-muted-ml4">
                  Evidence:{' '}
                  {gap.evidence_entries.map((entryId, j) => (
                    <code key={j} className="tgap-evidence-code">
                      {entryId}
                    </code>
                  ))}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Section 5: Gap Injection Results ────────────────────

function GapInjectionsSection({ injections }: { injections: GapInjection[] }) {
  if (injections.length === 0) return null;

  return (
    <div className="tgap-section">
      <div className="tgap-section-header">Gap Injection Results</div>
      {injections.map((inj, i) => (
        <div key={i} className="tgap-card-mb8">
          <div className="tgap-2xs-muted-mb6">
            Round {inj.round} &middot; Entry{' '}
            <code className="tgap-inline-code">
              {inj.transcript_entry_id}
            </code>
          </div>
          {inj.arguments.map((arg, j) => (
            <div key={j} className="tgap-injection-arg">
              <div className="tgap-desc-mb4">
                {arg.argument}
              </div>
              <div className="tgap-flex-badges">
                <GapBadge type={arg.gap_type} />
                {arg.relevant_povs.map((pov, k) => (
                  <PovBadge key={k} pov={pov} />
                ))}
              </div>
            </div>
          ))}
          {/* Responses */}
          {inj.responses && inj.responses.length > 0 && (
            <div className="tgap-mt6">
              <div className="tgap-2xs-label">Agent Responses</div>
              <div className="tgap-flex-g6-wrap">
                {inj.responses.map((resp, k) => {
                  const stanceColors: Record<string, string> = {
                    compatible: '#22c55e', opposed: '#ef4444', partial: '#f59e0b', reframed: '#3b82f6',
                  };
                  return (
                    <div key={k} className="tgap-response-chip">
                      <PovBadge pov={resp.pover} />
                      <span
                        className="tgap-fw600"
                        /* eslint-disable-next-line local/no-inline-style -- dynamic: stance-derived color */
                        style={{ color: stanceColors[resp.stance] || 'var(--text-muted)' }}
                      >
                        {resp.stance}
                      </span>
                      {!resp.engaged && (
                        <span className="tgap-muted-italic">
                          (not engaged)
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Section 6: Cross-Cutting Proposals ──────────────────

function CrossCuttingProposalsSection({ proposals }: { proposals: CrossCuttingProposal[] }) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (proposals.length === 0) return null;

  return (
    <div className="tgap-section">
      <div className="tgap-section-header">Cross-Cutting Proposals ({proposals.length})</div>
      {proposals.map((proposal, i) => (
        <div key={i} className="tgap-card-mb8">
          <div className="tgap-desc-mb4">
            {proposal.agreement_text}
          </div>
          <div className="tgap-flex-badges-mb6">
            <span className="tgap-proposed-label">
              {proposal.proposed_label}
            </span>
            {proposal.maps_to_existing && (
              <span className="tgap-maps-to">
                Maps to: {proposal.maps_to_existing}
              </span>
            )}
          </div>

          {/* Per-POV interpretations (collapsible) */}
          <button
            onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
            className="tgap-link-btn"
          >
            {expandedIndex === i ? 'Hide' : 'Show'} per-Perspective interpretations
          </button>

          {expandedIndex === i && (
            <div className="tgap-interp-list">
              {POV_KEYS.map(pov => {
                const interp = proposal.interpretations[pov];
                if (!interp) return null;
                const povEntry = Object.entries(POVER_INFO).find(([, v]) => v.pov === pov);
                const color = povEntry ? povEntry[1].color : '#888';
                const label = povEntry ? povEntry[1].label : pov;
                return (
                  <div
                    key={pov}
                    className="tgap-interp-card"
                    /* eslint-disable-next-line local/no-inline-style -- dynamic: pov-derived border/background */
                    style={{ borderLeft: `3px solid ${color}`, background: `${color}08` }}
                  >
                    <div
                      className="tgap-interp-label"
                      /* eslint-disable-next-line local/no-inline-style -- dynamic: pov-derived color */
                      style={{ color }}
                    >
                      {label}
                    </div>
                    <div className="tgap-interp-summary">
                      {interp.summary}
                    </div>
                    <div className="tgap-interp-bdi">
                      <span><strong>B:</strong> {interp.belief}</span>
                      <span><strong>D:</strong> {interp.desire}</span>
                      <span><strong>I:</strong> {interp.intention}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────

export function TaxonomyGapPanel({ debate }: Props) {
  const analysis = debate.taxonomy_gap_analysis;
  const injections = debate.gap_injections ?? [];
  const proposals = debate.cross_cutting_proposals ?? [];

  // Empty state
  if (!analysis) {
    return (
      <div className="tgap-empty">
        Gap analysis not available. Run a debate with synthesis to generate taxonomy gap diagnostics.
      </div>
    );
  }

  return (
    <div className="tgap-root">
      <SummaryBanner summary={analysis.summary} />
      <PovCoverageSection analysis={analysis} />
      <UnmappedArgumentsSection args={analysis.unmapped_arguments ?? []} />
      <CrossPovGapsSection gaps={analysis.cross_pov_gaps ?? []} />
      {injections.length > 0 && <GapInjectionsSection injections={injections} />}
      {proposals.length > 0 && <CrossCuttingProposalsSection proposals={proposals} />}
    </div>
  );
}
