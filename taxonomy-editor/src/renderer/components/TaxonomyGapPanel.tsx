// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import type {
  DebateSession,
  TaxonomyGapAnalysis,
  PovCoverage,
  BdiBalance,
  CrossPovGap,
  UnmappedArgument,
  GapInjection,
  CrossCuttingProposal,
} from '../types/debate';
import { POVER_INFO } from '../types/debate';
import type { PoverId } from '../types/debate';

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
    <span style={{
      padding: '1px 6px', borderRadius: 4,
      fontSize: '0.63rem', fontWeight: 700,
      background: info.bg, color: info.fg,
    }}>
      {info.label}
    </span>
  );
}

function PovBadge({ pov }: { pov: string }) {
  const entry = Object.entries(POVER_INFO).find(([, v]) => v.pov === pov || v.label.toLowerCase() === pov.toLowerCase());
  const color = entry ? entry[1].color : '#888';
  const label = entry ? entry[1].label : pov;
  return (
    <span style={{
      padding: '1px 6px', borderRadius: 4,
      fontSize: '0.63rem', fontWeight: 700,
      background: `${color}22`, color,
      border: `1px solid ${color}44`,
    }}>
      {label}
    </span>
  );
}

function BdiBadge({ bdi }: { bdi: string }) {
  const colors: Record<string, string> = { belief: '#3b82f6', desire: '#22c55e', intention: '#f59e0b', beliefs: '#3b82f6', desires: '#22c55e', intentions: '#f59e0b' };
  const c = colors[bdi.toLowerCase()] || '#888';
  return (
    <span style={{
      padding: '1px 6px', borderRadius: 4,
      fontSize: '0.63rem', fontWeight: 700,
      background: `${c}22`, color: c,
    }}>
      {bdi.charAt(0).toUpperCase() + bdi.slice(1)}
    </span>
  );
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{
      height: 6, borderRadius: 3, background: 'var(--bg-secondary)',
      overflow: 'hidden', flex: 1,
    }}>
      <div style={{
        height: '100%', borderRadius: 3,
        width: `${pct}%`, background: color,
        transition: 'width 0.3s ease',
      }} />
    </div>
  );
}

const SECTION_HEADER: React.CSSProperties = {
  fontSize: '0.85rem', fontWeight: 700, marginBottom: 8,
};

const CARD: React.CSSProperties = {
  border: '1px solid var(--border-color)', borderRadius: 8, padding: 12,
};

// ── Section 1: Summary Banner ───────────────────────────

function SummaryBanner({ summary }: { summary: TaxonomyGapAnalysis['summary'] }) {
  const color = coverageColor(summary.overall_coverage_pct);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={SECTION_HEADER}>Gap Analysis Summary</div>
      <div style={{
        display: 'flex', gap: 12, flexWrap: 'wrap',
      }}>
        {/* Coverage */}
        <div style={{ ...CARD, flex: '1 1 120px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            border: `3px solid ${color}`, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: '0.8rem', fontWeight: 700, color,
          }}>
            {Math.round(summary.overall_coverage_pct)}%
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Overall Coverage</div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>
              {summary.overall_coverage_pct > 70 ? 'Good' : summary.overall_coverage_pct >= 40 ? 'Moderate' : 'Low'}
            </div>
          </div>
        </div>

        {/* Underserved POV */}
        <div style={{ ...CARD, flex: '1 1 120px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 2 }}>Most Underserved POV</div>
          <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>{summary.most_underserved_pov}</div>
        </div>

        {/* Underserved BDI */}
        <div style={{ ...CARD, flex: '1 1 120px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 2 }}>Weakest BDI Layer</div>
          <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>{summary.most_underserved_bdi}</div>
        </div>

        {/* Unmapped count */}
        <div style={{ ...CARD, flex: '1 1 100px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 2 }}>Unmapped Args</div>
          <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{summary.unmapped_argument_count}</div>
        </div>

        {/* Cross-POV gaps */}
        <div style={{ ...CARD, flex: '1 1 100px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 2 }}>Cross-POV Gaps</div>
          <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{summary.cross_pov_gap_count}</div>
        </div>
      </div>

      {/* Recommendation */}
      {summary.recommendation && (
        <div style={{
          marginTop: 8, padding: '8px 12px', borderRadius: 6,
          background: 'rgba(245,158,11,0.08)', borderLeft: '3px solid #f59e0b',
          fontSize: '0.72rem', lineHeight: 1.5, color: 'var(--text-primary)',
        }}>
          {summary.recommendation}
        </div>
      )}
    </div>
  );
}

// ── Section 2: Per-POV Coverage ─────────────────────────

function PovCoverageCard({ pov, coverage, bdi }: { pov: string; coverage: PovCoverage; bdi?: BdiBalance }) {
  const [expanded, setExpanded] = useState(false);
  const entry = Object.entries(POVER_INFO).find(([, v]) => v.pov === pov);
  const color = entry ? entry[1].color : '#888';
  const label = entry ? entry[1].label : pov;

  const unusedNodes = coverage.unreferenced_relevant || [];
  const showLimit = 5;

  return (
    <div style={{ ...CARD, flex: '1 1 200px', minWidth: 200 }}>
      <div style={{
        fontWeight: 700, fontSize: '0.8rem', color,
        borderBottom: `2px solid ${color}`, paddingBottom: 4, marginBottom: 8,
      }}>
        {label}
      </div>

      {/* Node counts */}
      <div style={{ fontSize: '0.7rem', marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>{coverage.referenced_nodes}</span>
        <span style={{ color: 'var(--text-muted)' }}> / {coverage.injected_nodes} nodes referenced</span>
        {coverage.total_nodes > 0 && (
          <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
            ({coverage.total_nodes} total)
          </span>
        )}
      </div>

      {/* Utilization bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <ProgressBar value={coverage.referenced_nodes} max={coverage.injected_nodes || 1} color={color} />
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', minWidth: 32, textAlign: 'right' }}>
          {Math.round(coverage.utilization_rate * 100)}%
        </span>
      </div>

      {/* BDI breakdown */}
      {bdi && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, marginBottom: 4 }}>BDI Breakdown</div>
          {(['beliefs', 'desires', 'intentions'] as const).map(cat => {
            const d = bdi[cat];
            const isWeakest = bdi.weakest_category.toLowerCase() === cat;
            const catColor = cat === 'beliefs' ? '#3b82f6' : cat === 'desires' ? '#22c55e' : '#f59e0b';
            return (
              <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{
                  fontSize: '0.63rem', width: 55, textAlign: 'right',
                  fontWeight: isWeakest ? 700 : 400,
                  color: isWeakest ? '#ef4444' : 'var(--text-muted)',
                }}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </span>
                <ProgressBar value={d.cited_count} max={d.node_count || 1} color={catColor} />
                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', minWidth: 28, textAlign: 'right' }}>
                  {d.cited_count}/{d.node_count}
                </span>
              </div>
            );
          })}
          {bdi.recommendation && (
            <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 4 }}>
              {bdi.recommendation}
            </div>
          )}
        </div>
      )}

      {/* Primary but unused nodes */}
      {unusedNodes.length > 0 && (
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, marginBottom: 4, color: 'var(--text-muted)' }}>
            Primary but unused ({unusedNodes.length})
          </div>
          {unusedNodes.slice(0, expanded ? undefined : showLimit).map((nodeId, i) => (
            <code key={i} style={{
              display: 'block', fontSize: '0.6rem', color: 'var(--text-muted)',
              padding: '1px 4px', marginBottom: 1,
              background: 'var(--bg-secondary)', borderRadius: 3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {nodeId}
            </code>
          ))}
          {unusedNodes.length > showLimit && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                background: 'none', border: 'none', color: '#3b82f6',
                fontSize: '0.63rem', cursor: 'pointer', padding: '2px 0', marginTop: 2,
              }}
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
    <div style={{ marginBottom: 16 }}>
      <div style={SECTION_HEADER}>Per-POV Coverage</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
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
    <div style={{ marginBottom: 16 }}>
      <div style={SECTION_HEADER}>Unmapped Arguments ({args.length})</div>
      <div style={{
        ...CARD, padding: 0,
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: '0.65rem' }}>AN Node</th>
              <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: '0.65rem' }}>Speaker</th>
              <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: '0.65rem' }}>Text</th>
              <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: '0.65rem' }}>Gap Type</th>
            </tr>
          </thead>
          <tbody>
            {args.map((arg, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border-color)' }}>
                <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                  <code style={{ fontSize: '0.63rem' }}>{arg.an_node_id}</code>
                </td>
                <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                  {speakerLabel(arg.speaker)}
                </td>
                <td style={{ padding: '5px 8px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {arg.text.length > 100 ? arg.text.slice(0, 100) + '...' : arg.text}
                </td>
                <td style={{ padding: '5px 8px' }}>
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
  const info = POVER_INFO[speaker as Exclude<PoverId, 'user'>];
  return info?.label || speaker;
}

// ── Section 4: Cross-POV Gaps ───────────────────────────

function CrossPovGapsSection({ gaps }: { gaps: CrossPovGap[] }) {
  if (gaps.length === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={SECTION_HEADER}>Cross-POV Gaps ({gaps.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {gaps.map((gap, i) => (
          <div key={i} style={CARD}>
            <div style={{ fontSize: '0.72rem', lineHeight: 1.5, marginBottom: 6 }}>
              {gap.description}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <PovBadge pov={gap.suggested_pov} />
              <BdiBadge bdi={gap.suggested_bdi} />
              {gap.evidence_entries.length > 0 && (
                <span style={{ fontSize: '0.63rem', color: 'var(--text-muted)', marginLeft: 4 }}>
                  Evidence:{' '}
                  {gap.evidence_entries.map((entryId, j) => (
                    <code key={j} style={{
                      padding: '1px 4px', marginRight: 3, borderRadius: 3,
                      background: 'var(--bg-secondary)', fontSize: '0.6rem',
                      cursor: 'pointer',
                    }}>
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
    <div style={{ marginBottom: 16 }}>
      <div style={SECTION_HEADER}>Gap Injection Results</div>
      {injections.map((inj, i) => (
        <div key={i} style={{ ...CARD, marginBottom: 8 }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 6 }}>
            Round {inj.round} &middot; Entry{' '}
            <code style={{ fontSize: '0.63rem', background: 'var(--bg-secondary)', padding: '0 3px', borderRadius: 2 }}>
              {inj.transcript_entry_id}
            </code>
          </div>
          {inj.arguments.map((arg, j) => (
            <div key={j} style={{
              padding: '8px 10px', marginBottom: 6, borderRadius: 6,
              background: 'var(--bg-secondary)',
              borderLeft: '3px solid #8b5cf6',
            }}>
              <div style={{ fontSize: '0.72rem', lineHeight: 1.5, marginBottom: 4 }}>
                {arg.argument}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <GapBadge type={arg.gap_type} />
                {arg.relevant_povs.map((pov, k) => (
                  <PovBadge key={k} pov={pov} />
                ))}
              </div>
            </div>
          ))}
          {/* Responses */}
          {inj.responses && inj.responses.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, marginBottom: 4 }}>Agent Responses</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {inj.responses.map((resp, k) => {
                  const stanceColors: Record<string, string> = {
                    compatible: '#22c55e', opposed: '#ef4444', partial: '#f59e0b', reframed: '#3b82f6',
                  };
                  return (
                    <div key={k} style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '3px 8px', borderRadius: 4,
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.65rem',
                    }}>
                      <PovBadge pov={resp.pover} />
                      <span style={{
                        color: stanceColors[resp.stance] || 'var(--text-muted)',
                        fontWeight: 600,
                      }}>
                        {resp.stance}
                      </span>
                      {!resp.engaged && (
                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
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
    <div style={{ marginBottom: 16 }}>
      <div style={SECTION_HEADER}>Cross-Cutting Proposals ({proposals.length})</div>
      {proposals.map((proposal, i) => (
        <div key={i} style={{ ...CARD, marginBottom: 8 }}>
          <div style={{ fontSize: '0.72rem', lineHeight: 1.5, marginBottom: 4 }}>
            {proposal.agreement_text}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{
              padding: '2px 8px', borderRadius: 4,
              fontSize: '0.68rem', fontWeight: 700,
              background: 'rgba(59,130,246,0.12)', color: '#3b82f6',
              border: '1px solid rgba(59,130,246,0.3)',
            }}>
              {proposal.proposed_label}
            </span>
            {proposal.maps_to_existing && (
              <span style={{
                padding: '1px 6px', borderRadius: 4,
                fontSize: '0.63rem', fontWeight: 600,
                background: 'rgba(34,197,94,0.12)', color: '#22c55e',
              }}>
                Maps to: {proposal.maps_to_existing}
              </span>
            )}
          </div>

          {/* Per-POV interpretations (collapsible) */}
          <button
            onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
            style={{
              background: 'none', border: 'none', color: '#3b82f6',
              fontSize: '0.65rem', cursor: 'pointer', padding: '2px 0',
            }}
          >
            {expandedIndex === i ? 'Hide' : 'Show'} per-POV interpretations
          </button>

          {expandedIndex === i && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(['accelerationist', 'safetyist', 'skeptic'] as const).map(pov => {
                const interp = proposal.interpretations[pov];
                if (!interp) return null;
                const povEntry = Object.entries(POVER_INFO).find(([, v]) => v.pov === pov);
                const color = povEntry ? povEntry[1].color : '#888';
                const label = povEntry ? povEntry[1].label : pov;
                return (
                  <div key={pov} style={{
                    padding: '6px 10px', borderRadius: 6,
                    borderLeft: `3px solid ${color}`,
                    background: `${color}08`,
                  }}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color, marginBottom: 3 }}>
                      {label}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      {interp.summary}
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 3, fontSize: '0.6rem' }}>
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
      <div style={{
        textAlign: 'center', padding: '32px 16px',
        color: 'var(--text-muted)', fontSize: '0.78rem',
      }}>
        Gap analysis not available. Run a debate with synthesis to generate taxonomy gap diagnostics.
      </div>
    );
  }

  return (
    <div style={{ fontSize: '0.75rem', overflowY: 'auto' }}>
      <SummaryBanner summary={analysis.summary} />
      <PovCoverageSection analysis={analysis} />
      <UnmappedArgumentsSection args={analysis.unmapped_arguments} />
      <CrossPovGapsSection gaps={analysis.cross_pov_gaps} />
      {injections.length > 0 && <GapInjectionsSection injections={injections} />}
      {proposals.length > 0 && <CrossCuttingProposalsSection proposals={proposals} />}
    </div>
  );
}
