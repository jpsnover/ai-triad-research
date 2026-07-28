// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * ExtractionTimelinePanel — diagnoses claim-extraction plateau failures.
 *
 * Shows per-turn lifecycle trace (status, sizes, funnel, overlap), a cumulative
 * AN-growth chart, a rejection-reason sparkline, and plateau alerts.
 */

import { useState, useMemo } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type {
  DebateSession,
  ClaimExtractionTrace,
  ExtractionSummary,
} from '../../types/debate';
import { POVER_INFO } from '../../types/debate';
import type { SpeakerId } from '../../types/debate';
import './ExtractionTimelinePanel.css';

interface Props {
  debate: DebateSession;
}

const STATUS_COLORS: Record<ClaimExtractionTrace['status'], { bg: string; fg: string; label: string }> = {
  ok: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e', label: 'OK' },
  no_new_nodes: { bg: 'rgba(245,158,11,0.18)', fg: '#f59e0b', label: 'No new nodes' },
  empty_response: { bg: 'rgba(245,158,11,0.18)', fg: '#f59e0b', label: 'Empty' },
  truncated_response: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444', label: 'Truncated' },
  parse_error: { bg: 'rgba(239,68,68,0.18)', fg: '#ef4444', label: 'Parse error' },
  adapter_error: { bg: 'rgba(239,68,68,0.18)', fg: '#ef4444', label: 'Adapter error' },
  skipped: { bg: 'rgba(148,163,184,0.18)', fg: '#94a3b8', label: 'Skipped' },
};

function speakerLabel(speaker: SpeakerId): string {
  if (speaker === 'user') return 'You';
  return POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label || speaker;
}

function StatusBadge({ status }: { status: ClaimExtractionTrace['status'] }) {
  const c = STATUS_COLORS[status];
  return (
    <span
      className="etl-status-badge"
      /* eslint-disable-next-line local/no-inline-style -- dynamic: status-driven bg/fg colors */
      style={{ background: c.bg, color: c.fg }}
    >{c.label}</span>
  );
}

function GrowthChart({ summary, traces }: { summary: ExtractionSummary; traces: ClaimExtractionTrace[] }) {
  const W = 420, H = 90, PAD = 20;
  if (traces.length === 0) return null;
  const maxCount = Math.max(1, ...summary.an_growth_series.map(p => p.cumulative_count));
  const maxRound = Math.max(1, ...summary.an_growth_series.map(p => p.round));
  const x = (r: number) => PAD + ((r - 1) / Math.max(1, maxRound - 1)) * (W - 2 * PAD);
  const y = (c: number) => H - PAD - (c / maxCount) * (H - 2 * PAD);
  const points = summary.an_growth_series
    .map(p => `${x(p.round)},${y(p.cumulative_count)}`).join(' ');

  // Highlight plateau segment
  const plateauStart = summary.plateau_started_at_turn;
  let plateauRect: React.ReactNode = null;
  if (summary.plateau_detected && plateauStart != null) {
    const x1 = x(plateauStart);
    const x2 = W - PAD;
    plateauRect = (
      <rect x={x1} y={PAD} width={Math.max(2, x2 - x1)} height={H - 2 * PAD}
        fill="rgba(239,68,68,0.12)" />
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="etl-chart-svg"
      /* eslint-disable-next-line local/no-inline-style -- dynamic: computed chart height */
      style={{ height: H }}
    >
      {plateauRect}
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border)" strokeWidth={0.5} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--border)" strokeWidth={0.5} />
      <polyline fill="none" stroke="#22c55e" strokeWidth={1.5} points={points} />
      {summary.an_growth_series.map((p, i) => (
        <circle key={i} cx={x(p.round)} cy={y(p.cumulative_count)} r={2}
          fill={p.cumulative_count === (summary.an_growth_series[i - 1]?.cumulative_count ?? 0) ? '#ef4444' : '#22c55e'} />
      ))}
      <text x={PAD} y={PAD - 4} fontSize={9} fill="var(--text-muted)">AN nodes (cumulative): {maxCount}</text>
      <text x={W - PAD} y={H - 4} fontSize={9} fill="var(--text-muted)" textAnchor="end">turn →</text>
    </svg>
  );
}

function RejectionSparkline({ traces }: { traces: ClaimExtractionTrace[] }) {
  const W = 420, H = 60, PAD = 20;
  if (traces.length === 0) return null;
  const reasons = new Set<string>();
  traces.forEach(t => Object.keys(t.rejection_reasons).forEach(r => reasons.add(r)));
  const reasonList = [...reasons];
  const colors: Record<string, string> = {
    low_overlap: '#f59e0b',
    too_short: '#94a3b8',
    missing_scheme: '#8b5cf6',
    unknown_speaker: '#ec4899',
  };
  const maxRejects = Math.max(1, ...traces.map(t =>
    Object.values(t.rejection_reasons).reduce((a, b) => a + b, 0)));
  const barW = Math.max(4, (W - 2 * PAD) / traces.length - 2);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="etl-chart-svg"
      /* eslint-disable-next-line local/no-inline-style -- dynamic: computed chart height */
      style={{ height: H }}
    >
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border)" strokeWidth={0.5} />
      {traces.map((t, i) => {
        const x = PAD + i * (barW + 2);
        let yOffset = H - PAD;
        return (
          <g key={t.entry_id}>
            {reasonList.map(reason => {
              const count = t.rejection_reasons[reason] ?? 0;
              if (count === 0) return null;
              const h = (count / maxRejects) * (H - 2 * PAD);
              yOffset -= h;
              return (
                <rect key={reason} x={x} y={yOffset} width={barW} height={h}
                  fill={colors[reason] ?? '#64748b'}>
                  <title>{reason}: {count} on turn {t.round}</title>
                </rect>
              );
            })}
          </g>
        );
      })}
      <text x={PAD} y={PAD - 4} fontSize={9} fill="var(--text-muted)">
        Rejections by reason (max {maxRejects}/turn)
      </text>
      {reasonList.map((r, i) => (
        <g key={r} transform={`translate(${PAD + i * 110}, ${H - 4})`}>
          <rect x={0} y={-7} width={8} height={8} fill={colors[r] ?? '#64748b'} />
          <text x={11} y={0} fontSize={9} fill="var(--text-muted)">{r}</text>
        </g>
      ))}
    </svg>
  );
}

function TraceRow({ trace, idx, onSelect, selected }: {
  trace: ClaimExtractionTrace;
  idx: number;
  onSelect: () => void;
  selected: boolean;
}) {
  const topReason = Object.entries(trace.rejection_reasons).sort((a, b) => b[1] - a[1])[0];
  const delta = trace.an_node_count_after - trace.an_node_count_before;
  const deltaColor = delta > 0 ? '#22c55e' : '#ef4444';
  return (
    <tr
      onClick={onSelect}
      className="etl-trace-row"
      /* eslint-disable-next-line local/no-inline-style -- dynamic: selection + zebra-stripe background */
      style={{
        background: selected ? 'rgba(249,115,22,0.08)' : (idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'),
      }}
    >
      <td className="etl-td etl-td-stmt">S{trace.round}</td>
      <td className="etl-td">{speakerLabel(trace.speaker)}</td>
      <td className="etl-td"><StatusBadge status={trace.status} /></td>
      <td className="etl-td-num">{(trace.prompt_chars / 1024).toFixed(1)}k</td>
      <td className="etl-td-num">{(trace.response_chars / 1024).toFixed(1)}k</td>
      <td className="etl-td">{trace.response_truncated ? '✓' : ''}</td>
      <td className="etl-td-num">{trace.candidates_proposed}</td>
      <td className="etl-td-num">{trace.candidates_accepted}</td>
      <td
        className="etl-td-num etl-td-delta"
        /* eslint-disable-next-line local/no-inline-style -- dynamic: delta sign color */
        style={{ color: deltaColor }}
      >{delta > 0 ? `+${delta}` : delta}</td>
      <td className="etl-td">{topReason ? `${topReason[0]} (${topReason[1]})` : '—'}</td>
      <td className="etl-td-num">{Math.round(trace.max_overlap_vs_existing * 100)}%</td>
    </tr>
  );
}

const navBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '2px 8px',
  fontSize: 'var(--text-2xs)',
  fontWeight: 600,
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: disabled ? 'transparent' : 'rgba(249,115,22,0.1)',
  color: disabled ? 'var(--text-muted)' : '#f97316',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
});
function AttributionSummary({ traces, debate }: { traces: ClaimExtractionTrace[]; debate: DebateSession }) {
  const stats = useMemo(() => {
    const allDecisions = traces.flatMap(t => t.attribution_decisions ?? []);
    if (allDecisions.length === 0) return null;
    const attributed = allDecisions.filter(d => d.primary_ref != null);
    const unattributed = allDecisions.filter(d => d.primary_ref == null);
    const novelCount = unattributed.filter(d => d.unattributed_reason === 'novel_argument').length;
    const noEmbCount = unattributed.filter(d => d.unattributed_reason === 'no_embedding').length;

    // Confidence distribution buckets
    const confBuckets = { high: 0, medium: 0, low: 0 };
    for (const d of attributed) {
      if (d.attribution_confidence >= 0.7) confBuckets.high++;
      else if (d.attribution_confidence >= 0.5) confBuckets.medium++;
      else confBuckets.low++;
    }

    // Most-attributed taxonomy nodes
    const refCounts = new Map<string, number>();
    for (const d of attributed) {
      refCounts.set(d.primary_ref!, (refCounts.get(d.primary_ref!) ?? 0) + 1);
    }
    const topRefs = [...refCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    return { total: allDecisions.length, attributed: attributed.length, unattributed: unattributed.length, novelCount, noEmbCount, confBuckets, topRefs };
  }, [traces]);

  if (!stats) return null;

  const ratio = debate.extraction_summary?.unattributed_claim_ratio;
  const ratioColor = ratio != null && ratio > 0.5 ? '#ef4444' : ratio != null && ratio > 0.25 ? '#f59e0b' : '#22c55e';

  return (
    <details className="etl-mb4">
      <summary className="etl-summary">
        Taxonomy Attribution ({stats.attributed}/{stats.total} attributed{ratio != null ? ` · ${(ratio * 100).toFixed(0)}% unattributed` : ''})
      </summary>
      <div className="etl-attr-body">
        {/* Ratio alert */}
        {ratio != null && ratio > 0.5 && (
          <div className="etl-ratio-alert">
            <strong className="etl-red">High unattributed ratio ({(ratio * 100).toFixed(0)}%).</strong>{' '}
            Over half of AN claims could not be mapped to taxonomy Belief nodes. This may indicate
            the debate is producing novel arguments outside the taxonomy&apos;s coverage, or that embeddings
            are missing.
          </div>
        )}

        {/* Summary stats */}
        <div className="etl-stats-row">
          <span>Attributed: <strong className="etl-green">{stats.attributed}</strong></span>
          <span>Unattributed: <strong
            /* eslint-disable-next-line local/no-inline-style -- dynamic: conditional color on count */
            style={{ color: stats.unattributed > 0 ? '#ef4444' : 'var(--text-primary)' }}
          >{stats.unattributed}</strong>
            {stats.novelCount > 0 && <span className="etl-muted"> ({stats.novelCount} novel)</span>}
            {stats.noEmbCount > 0 && <span className="etl-muted"> ({stats.noEmbCount} no emb)</span>}
          </span>
        </div>

        {/* Confidence distribution */}
        {stats.attributed > 0 && (
          <div className="etl-mb8">
            <div className="etl-section-label">Confidence Distribution</div>
            <div className="etl-conf-bar">
              {stats.confBuckets.high > 0 && (
                <div className="etl-conf-seg etl-bg-green"
                  /* eslint-disable-next-line local/no-inline-style -- dynamic: flex weight from bucket count */
                  style={{ flex: stats.confBuckets.high }}
                  title={`High confidence (≥0.70): ${stats.confBuckets.high} claims`}
                >{stats.confBuckets.high}</div>
              )}
              {stats.confBuckets.medium > 0 && (
                <div className="etl-conf-seg etl-bg-blue"
                  /* eslint-disable-next-line local/no-inline-style -- dynamic: flex weight from bucket count */
                  style={{ flex: stats.confBuckets.medium }}
                  title={`Medium confidence (0.50–0.69): ${stats.confBuckets.medium} claims`}
                >{stats.confBuckets.medium}</div>
              )}
              {stats.confBuckets.low > 0 && (
                <div className="etl-conf-seg etl-bg-amber"
                  /* eslint-disable-next-line local/no-inline-style -- dynamic: flex weight from bucket count */
                  style={{ flex: stats.confBuckets.low }}
                  title={`Low confidence (0.35–0.49): ${stats.confBuckets.low} claims`}
                >{stats.confBuckets.low}</div>
              )}
            </div>
            <div className="etl-conf-legend">
              <span><span className="etl-legend-swatch etl-bg-green" />High ≥0.70</span>
              <span><span className="etl-legend-swatch etl-bg-blue" />Med 0.50–0.69</span>
              <span><span className="etl-legend-swatch etl-bg-amber" />Low 0.35–0.49</span>
            </div>
          </div>
        )}

        {/* Most-attributed nodes */}
        {stats.topRefs.length > 0 && (
          <div>
            <div className="etl-section-label">Most-Attributed Taxonomy Nodes</div>
            <div className="etl-col-gap2">
              {stats.topRefs.map(([nodeId, count]) => {
                const maxCount = stats.topRefs[0][1];
                return (
                  <div key={nodeId} className="etl-row-center6">
                    <span className="etl-node-id">{nodeId}</span>
                    <div className="etl-bar-track">
                      <div
                        className="etl-bar-fill"
                        /* eslint-disable-next-line local/no-inline-style -- dynamic: bar width from count ratio */
                        style={{ width: `${(count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="etl-bar-count">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

export function ExtractionTimelinePanel({ debate }: Props) {
  const traces = useMemo(() => {
    const out: ClaimExtractionTrace[] = [];
    if (!debate.diagnostics) return out;
    for (const entryDiag of Object.values(debate.diagnostics.entries)) {
      if (entryDiag.extraction_trace) out.push(entryDiag.extraction_trace);
    }
    return out.sort((a, b) => a.round - b.round);
  }, [debate]);

  const summary = debate.extraction_summary;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdx = selectedId ? traces.findIndex(t => t.entry_id === selectedId) : -1;
  const selected = selectedIdx >= 0 ? traces[selectedIdx] : null;
  const goToIdx = (i: number) => {
    if (i < 0 || i >= traces.length) return;
    setSelectedId(traces[i].entry_id);
  };
  const jumpToTranscript = (stmtId: string) => {
    // Opens the statement in the main window by scrolling — id="stmt-S12".
    try {
      const el = window.opener?.document.getElementById(`stmt-${stmtId}`)
        ?? document.getElementById(`stmt-${stmtId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (window.opener) window.opener.focus();
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'extraction-timeline',
        level: 'debug',
        message: 'Cross-window DOM access failed during transcript scroll',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }
  };

  if (traces.length === 0) {
    return (
      <div className="etl-empty">
        No extraction traces yet. Start a debate to populate this panel.
      </div>
    );
  }

  return (
    <div className="etl-panel">
      {summary?.plateau_detected && (
        <div className="etl-plateau-alert">
          <strong className="etl-red">⚠ Extraction plateau detected.</strong>{' '}
          No new AN nodes have been added since {summary.plateau_last_an_id ?? 'early rounds'}
          {summary.plateau_started_at_turn != null && ` (starting at turn ${summary.plateau_started_at_turn})`}.
          Inspect recent turns below for the root cause — likely a context-bloat, truncated response,
          or saturated-network condition.
        </div>
      )}

      {summary && (
        <div className="etl-summary-row">
          <span>Turns: <strong className="etl-primary">{summary.total_turns}</strong></span>
          <span>Proposed: <strong className="etl-primary">{summary.total_proposed}</strong></span>
          <span>Accepted: <strong className="etl-primary">{summary.total_accepted}</strong></span>
          <span>Acceptance: <strong
            /* eslint-disable-next-line local/no-inline-style -- dynamic: threshold-based color */
            style={{ color: summary.acceptance_rate >= 0.5 ? '#22c55e' : '#f59e0b' }}
          >
            {(summary.acceptance_rate * 100).toFixed(0)}%
          </strong></span>
          {summary.unattributed_claim_ratio != null && (
            <span>Unattributed: <strong
              /* eslint-disable-next-line local/no-inline-style -- dynamic: threshold-based color */
              style={{ color: summary.unattributed_claim_ratio > 0.5 ? '#ef4444' : summary.unattributed_claim_ratio > 0.25 ? '#f59e0b' : '#22c55e' }}
            >
              {(summary.unattributed_claim_ratio * 100).toFixed(0)}%
            </strong></span>
          )}
        </div>
      )}

      <details open className="etl-mb4">
        <summary className="etl-summary">Charts</summary>
        {summary && <GrowthChart summary={summary} traces={traces} />}
        <RejectionSparkline traces={traces} />
      </details>

      {/* Taxonomy Attribution Summary */}
      <AttributionSummary traces={traces} debate={debate} />

      <div className="etl-mt10">
        <table className="etl-table">
          <thead>
            <tr>
              <th className="etl-th-num" data-tooltip={"Statement number — the position of this debate entry in the full transcript (e.g., S4 = 4th entry).\n\nClick a row to see detailed extraction diagnostics."}>Stmt</th>
              <th className="etl-th" data-tooltip={"The AI debater who made this statement.\n\nAccelerationist\nSafetyist\nSkeptic"}>Speaker</th>
              <th className="etl-th" data-tooltip={"Extraction status for this turn.\n\nOK = claims extracted successfully\nNo new nodes = no new AN nodes (duplicates or low overlap)\nEmpty = AI returned an empty response\nTruncated = response cut off (context too large)\nParse error = couldn't parse as valid JSON\nAdapter error = AI backend call failed"}>Status</th>
              <th className="etl-th-num" data-tooltip={"Prompt size in kilobytes — the extraction prompt sent to the AI.\n\nGrows each turn as transcript and AN context accumulate. Prompts over 15k may cause truncated responses."}>Prompt</th>
              <th className="etl-th-num" data-tooltip={"Response size in kilobytes — the AI's raw response.\n\nSmall responses (< 1k) may indicate the model failed to extract meaningful claims."}>Resp</th>
              <th className="etl-th" data-tooltip={"Response truncation flag.\n\n✓ = response was cut off mid-stream (usually max_tokens hit).\nTruncated responses often produce parse errors or missing claims."}>Trunc?</th>
              <th className="etl-th-num" data-tooltip={"Candidates proposed — claim candidates the AI proposed.\n\nEach candidate is a potential argument network node. Typically 2-4 per turn."}>Prop</th>
              <th className="etl-th-num" data-tooltip={"Candidates accepted — proposed claims that passed validation.\n\nClaims are rejected if:\n• Word overlap with statement < 10-15%\n• Duplicate of existing AN node (> 30% overlap)"}>Acc</th>
              <th className="etl-th-num" data-tooltip={"Argument Network delta — net change in AN node count.\n\n+3 = three new nodes added\n+0 = no growth (plateau indicator)\n\nConsecutive +0 deltas indicate an extraction plateau."}>AN Δ</th>
              <th className="etl-th" data-tooltip={"Top rejection reason with count in parentheses.\n\nduplicate_claim = too similar to existing AN node (> 30%)\nlow_overlap = not grounded in statement (< 10-15%)\ntoo_short = claim too brief\nmissing_scheme = no argumentation scheme\n\n'—' = no claims were rejected"}>Top reject</th>
              <th className="etl-th-num" data-tooltip={"Max word overlap vs. existing AN nodes.\n\nHigh values (> 60%) = debate covers well-trodden ground.\nNear 100% = near-duplicates of existing nodes.\n\nConsistently high = AN saturation (diminishing returns)."}>Max overlap</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((t, i) => (
              <TraceRow
                key={t.entry_id}
                trace={t}
                idx={i}
                selected={selectedId === t.entry_id}
                onSelect={() => setSelectedId(selectedId === t.entry_id ? null : t.entry_id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="etl-detail-panel">
          <div className="etl-detail-header">
            <button
              onClick={() => goToIdx(selectedIdx - 1)}
              disabled={selectedIdx <= 0}
              title="Previous statement"
              /* eslint-disable-next-line local/no-inline-style -- dynamic: disabled-state styling */
              style={navBtn(selectedIdx <= 0)}
            >◀ Prev</button>
            <button
              onClick={() => goToIdx(selectedIdx + 1)}
              disabled={selectedIdx >= traces.length - 1}
              title="Next statement"
              /* eslint-disable-next-line local/no-inline-style -- dynamic: disabled-state styling */
              style={navBtn(selectedIdx >= traces.length - 1)}
            >Next ▶</button>
            <span className="etl-nav-count">
              {selectedIdx + 1} / {traces.length}
            </span>
            <span className="etl-stmt-label">
              <span className="etl-orange">S{selected.round}</span>
              {' — '}{speakerLabel(selected.speaker)} · <StatusBadge status={selected.status} />
            </span>
            <button
              onClick={() => jumpToTranscript(`S${selected.round}`)}
              title="Scroll to this statement in the main transcript"
              /* eslint-disable-next-line local/no-inline-style -- dynamic: disabled-state styling + margin */
              style={{ ...navBtn(false), marginLeft: 'auto' }}
            >↗ Show in transcript</button>
          </div>
          {selected.error_message && (
            <div className="etl-error-line">
              <strong>Error:</strong> {selected.error_message}
            </div>
          )}
          <div className="extraction-detail etl-detail-grid">
            <span data-tooltip="AI model used for extraction. Different models have different extraction quality.">Model: {selected.model || '(default)'}</span>
            <span data-tooltip="Wall-clock response time (includes network + inference). Long times (> 10s) may indicate context overload.">Response time: {selected.response_time_ms} ms</span>
            <span data-tooltip={"Extraction prompt size in chars and estimated tokens (~4 chars/token).\nLarge prompts consume more context window and may cause truncation."}>Prompt: {selected.prompt_chars.toLocaleString()} chars (~{selected.prompt_token_estimate.toLocaleString()} tokens)</span>
            <span data-tooltip="AI response size in characters. Very short (< 1k) = possible failure; very long = over-generating.">Response: {selected.response_chars.toLocaleString()} chars</span>
            <span data-tooltip={"Prompt template hash (for cache dedup) + version ID.\nSame hash = same prompt structure. Useful for debugging extraction quality changes."}>Prompt hash: <code>{selected.prompt_hash}</code> ({selected.extraction_prompt_version})</span>
            <span data-tooltip={"AN node count before → after extraction.\nGrowth of 0 across multiple turns = plateau (debate's key arguments already captured)."}>AN: {selected.an_node_count_before} → {selected.an_node_count_after}</span>
            <span data-tooltip={"Claim candidates proposed by the AI.\nEach is evaluated for grounding (word overlap) and novelty (vs. existing AN nodes)."}>Candidates proposed: {selected.candidates_proposed}</span>
            <span data-tooltip={"Accepted = passed validation (sufficient overlap, not duplicate).\nRejected = failed (duplicate_claim, low_overlap, too_short, missing_scheme)."}>Accepted: {selected.candidates_accepted} · Rejected: {selected.candidates_rejected}</span>
            <span data-tooltip={"Highest word overlap between any proposed claim and existing AN nodes.\n> 60% = well-trodden ground. Near 30% = borderline duplicates."}>Max overlap vs. existing: {(selected.max_overlap_vs_existing * 100).toFixed(0)}%</span>
            <span data-tooltip="Extraction attempt number. Normally 1. Higher = retried due to parse errors, empty responses, or truncation.">Attempt: {selected.attempt_count}</span>
          </div>
          {Object.keys(selected.rejection_reasons).length > 0 && (
            <div className="etl-mt6">
              <strong>Rejection reasons:</strong>{' '}
              {Object.entries(selected.rejection_reasons).map(([r, c]) => (
                <span key={r} className="etl-reject-chip">{r}×{c}</span>
              ))}
            </div>
          )}
          {selected.rejected_overlap_pcts.length > 0 && (
            <div className="etl-mt4">
              <strong>Rejected overlap %:</strong> {selected.rejected_overlap_pcts.join(', ')}
            </div>
          )}
          {selected.an_nodes_added_ids.length > 0 && (
            <div className="etl-mt4">
              <strong>Added:</strong> {selected.an_nodes_added_ids.join(', ')}
            </div>
          )}
          {/* Per-turn taxonomy attribution */}
          {selected.attribution_decisions && selected.attribution_decisions.length > 0 && (
            <div className="etl-attr-section">
              <div className="etl-attr-head">
                <strong>Taxonomy Attribution</strong>
                <span className="etl-green">{selected.attribution_attributed ?? 0} attributed</span>
                {(selected.attribution_unattributed ?? 0) > 0 && (
                  <span className="etl-red">{selected.attribution_unattributed} unattributed</span>
                )}
              </div>
              {selected.attribution_decisions.map(d => {
                const isUnattributed = !d.primary_ref;
                const conf = d.attribution_confidence;
                const confColor = conf >= 0.7 ? '#22c55e' : conf >= 0.5 ? '#3b82f6' : conf >= 0.35 ? '#f59e0b' : '#ef4444';
                return (
                  <div key={d.claim_id} className="etl-attr-row">
                    <span className="etl-claim-id">{d.claim_id}</span>
                    {isUnattributed ? (
                      <span className="etl-unattr-chip">
                        {d.unattributed_reason === 'novel_argument' ? 'novel argument' : 'no embedding'}
                      </span>
                    ) : (
                      <>
                        <span className="etl-muted">&rarr;</span>
                        <span className="etl-fw600">{d.primary_ref}</span>
                        <span
                          className="etl-conf-chip"
                          /* eslint-disable-next-line local/no-inline-style -- dynamic: confidence-driven bg/fg color */
                          style={{ background: `${confColor}18`, color: confColor }}
                        >
                          {conf.toFixed(2)}
                        </span>
                        {d.secondary_refs_count > 0 && (
                          <span className="etl-muted">+{d.secondary_refs_count} secondary</span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
