// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * ExtractionTimelinePanel — diagnoses claim-extraction plateau failures.
 *
 * Shows per-turn lifecycle trace (status, sizes, funnel, overlap), a cumulative
 * AN-growth chart, a rejection-reason sparkline, and plateau alerts.
 */

import { useState, useMemo } from 'react';
import type {
  DebateSession,
  ClaimExtractionTrace,
  ExtractionSummary,
} from '../types/debate';
import { POVER_INFO } from '../types/debate';
import type { PoverId } from '../types/debate';

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

function speakerLabel(speaker: PoverId): string {
  if (speaker === 'user') return 'You';
  return POVER_INFO[speaker as Exclude<PoverId, 'user'>]?.label || speaker;
}

function StatusBadge({ status }: { status: ClaimExtractionTrace['status'] }) {
  const c = STATUS_COLORS[status];
  return (
    <span style={{
      background: c.bg, color: c.fg, padding: '1px 6px', borderRadius: 3,
      fontSize: '0.6rem', fontWeight: 700, whiteSpace: 'nowrap',
    }}>{c.label}</span>
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
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ display: 'block', marginTop: 4, width: '100%', height: H, maxWidth: 720 }}>
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
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ display: 'block', marginTop: 4, width: '100%', height: H, maxWidth: 720 }}>
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
      style={{
        cursor: 'pointer',
        background: selected ? 'rgba(249,115,22,0.08)' : (idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'),
      }}
    >
      <td style={{ ...td, fontWeight: 700, color: '#f97316' }}>S{trace.round}</td>
      <td style={td}>{speakerLabel(trace.speaker)}</td>
      <td style={td}><StatusBadge status={trace.status} /></td>
      <td style={tdNum}>{(trace.prompt_chars / 1024).toFixed(1)}k</td>
      <td style={tdNum}>{(trace.response_chars / 1024).toFixed(1)}k</td>
      <td style={td}>{trace.response_truncated ? '✓' : ''}</td>
      <td style={tdNum}>{trace.candidates_proposed}</td>
      <td style={tdNum}>{trace.candidates_accepted}</td>
      <td style={{ ...tdNum, color: deltaColor, fontWeight: 700 }}>{delta > 0 ? `+${delta}` : delta}</td>
      <td style={td}>{topReason ? `${topReason[0]} (${topReason[1]})` : '—'}</td>
      <td style={tdNum}>{Math.round(trace.max_overlap_vs_existing * 100)}%</td>
    </tr>
  );
}

const navBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '2px 8px',
  fontSize: '0.65rem',
  fontWeight: 600,
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: disabled ? 'transparent' : 'rgba(249,115,22,0.1)',
  color: disabled ? 'var(--text-muted)' : '#f97316',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
});
const td: React.CSSProperties = { padding: '3px 6px', fontSize: '0.7rem', borderBottom: '1px solid var(--border)' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' };
const th: React.CSSProperties = { padding: '4px 6px', fontSize: '0.65rem', fontWeight: 700, textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', cursor: 'help' };
const thNum: React.CSSProperties = { ...th, textAlign: 'right' as const };

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
    } catch { /* ignore cross-window access */ }
  };

  if (traces.length === 0) {
    return (
      <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: '0.75rem' }}>
        No extraction traces yet. Start a debate to populate this panel.
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 0 40px', maxWidth: 820 }}>
      {summary?.plateau_detected && (
        <div style={{
          margin: '0 0 10px', padding: '8px 10px', borderRadius: 6,
          background: 'rgba(239,68,68,0.12)', borderLeft: '3px solid #ef4444',
          fontSize: '0.75rem',
        }}>
          <strong style={{ color: '#ef4444' }}>⚠ Extraction plateau detected.</strong>{' '}
          No new AN nodes have been added since {summary.plateau_last_an_id ?? 'early rounds'}
          {summary.plateau_started_at_turn != null && ` (starting at turn ${summary.plateau_started_at_turn})`}.
          Inspect recent turns below for the root cause — likely a context-bloat, truncated response,
          or saturated-network condition.
        </div>
      )}

      {summary && (
        <div style={{ display: 'flex', gap: 16, fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>
          <span>Turns: <strong style={{ color: 'var(--text-primary)' }}>{summary.total_turns}</strong></span>
          <span>Proposed: <strong style={{ color: 'var(--text-primary)' }}>{summary.total_proposed}</strong></span>
          <span>Accepted: <strong style={{ color: 'var(--text-primary)' }}>{summary.total_accepted}</strong></span>
          <span>Acceptance: <strong style={{ color: summary.acceptance_rate >= 0.5 ? '#22c55e' : '#f59e0b' }}>
            {(summary.acceptance_rate * 100).toFixed(0)}%
          </strong></span>
        </div>
      )}

      <details open style={{ marginBottom: 4 }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Charts</summary>
        {summary && <GrowthChart summary={summary} traces={traces} />}
        <RejectionSparkline traces={traces} />
      </details>

      <div style={{ marginTop: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <thead>
            <tr>
              <th style={thNum} data-tooltip={"Statement number — the position of this debate entry in the full transcript (e.g., S4 = 4th entry).\n\nClick a row to see detailed extraction diagnostics."}>Stmt</th>
              <th style={th} data-tooltip={"The AI debater who made this statement.\n\nPrometheus (accelerationist)\nSentinel (safetyist)\nCassandra (skeptic)"}>Speaker</th>
              <th style={th} data-tooltip={"Extraction status for this turn.\n\nOK = claims extracted successfully\nNo new nodes = no new AN nodes (duplicates or low overlap)\nEmpty = AI returned an empty response\nTruncated = response cut off (context too large)\nParse error = couldn't parse as valid JSON\nAdapter error = AI backend call failed"}>Status</th>
              <th style={thNum} data-tooltip={"Prompt size in kilobytes — the extraction prompt sent to the AI.\n\nGrows each turn as transcript and AN context accumulate. Prompts over 15k may cause truncated responses."}>Prompt</th>
              <th style={thNum} data-tooltip={"Response size in kilobytes — the AI's raw response.\n\nSmall responses (< 1k) may indicate the model failed to extract meaningful claims."}>Resp</th>
              <th style={th} data-tooltip={"Response truncation flag.\n\n✓ = response was cut off mid-stream (usually max_tokens hit).\nTruncated responses often produce parse errors or missing claims."}>Trunc?</th>
              <th style={thNum} data-tooltip={"Candidates proposed — claim candidates the AI proposed.\n\nEach candidate is a potential argument network node. Typically 2-4 per turn."}>Prop</th>
              <th style={thNum} data-tooltip={"Candidates accepted — proposed claims that passed validation.\n\nClaims are rejected if:\n• Word overlap with statement < 10-15%\n• Duplicate of existing AN node (> 30% overlap)"}>Acc</th>
              <th style={thNum} data-tooltip={"Argument Network delta — net change in AN node count.\n\n+3 = three new nodes added\n+0 = no growth (plateau indicator)\n\nConsecutive +0 deltas indicate an extraction plateau."}>AN Δ</th>
              <th style={th} data-tooltip={"Top rejection reason with count in parentheses.\n\nduplicate_claim = too similar to existing AN node (> 30%)\nlow_overlap = not grounded in statement (< 10-15%)\ntoo_short = claim too brief\nmissing_scheme = no argumentation scheme\n\n'—' = no claims were rejected"}>Top reject</th>
              <th style={thNum} data-tooltip={"Max word overlap vs. existing AN nodes.\n\nHigh values (> 60%) = debate covers well-trodden ground.\nNear 100% = near-duplicates of existing nodes.\n\nConsistently high = AN saturation (diminishing returns)."}>Max overlap</th>
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
        <div style={{
          marginTop: 12, padding: 10, borderRadius: 6,
          background: 'rgba(249,115,22,0.05)', border: '1px solid rgba(249,115,22,0.2)',
          fontSize: '0.72rem',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
            flexWrap: 'wrap',
          }}>
            <button
              onClick={() => goToIdx(selectedIdx - 1)}
              disabled={selectedIdx <= 0}
              title="Previous statement"
              style={navBtn(selectedIdx <= 0)}
            >◀ Prev</button>
            <button
              onClick={() => goToIdx(selectedIdx + 1)}
              disabled={selectedIdx >= traces.length - 1}
              title="Next statement"
              style={navBtn(selectedIdx >= traces.length - 1)}
            >Next ▶</button>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
              {selectedIdx + 1} / {traces.length}
            </span>
            <span style={{ fontWeight: 700, marginLeft: 4 }}>
              <span style={{ color: '#f97316' }}>S{selected.round}</span>
              {' — '}{speakerLabel(selected.speaker)} · <StatusBadge status={selected.status} />
            </span>
            <button
              onClick={() => jumpToTranscript(`S${selected.round}`)}
              title="Scroll to this statement in the main transcript"
              style={{ ...navBtn(false), marginLeft: 'auto' }}
            >↗ Show in transcript</button>
          </div>
          {selected.error_message && (
            <div style={{ color: '#ef4444', marginBottom: 6 }}>
              <strong>Error:</strong> {selected.error_message}
            </div>
          )}
          <div className="extraction-detail" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px' }}>
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
            <div style={{ marginTop: 6 }}>
              <strong>Rejection reasons:</strong>{' '}
              {Object.entries(selected.rejection_reasons).map(([r, c]) => (
                <span key={r} style={{
                  display: 'inline-block', marginRight: 6, padding: '1px 6px',
                  background: 'rgba(239,68,68,0.12)', color: '#ef4444', borderRadius: 3,
                  fontSize: '0.65rem',
                }}>{r}×{c}</span>
              ))}
            </div>
          )}
          {selected.rejected_overlap_pcts.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <strong>Rejected overlap %:</strong> {selected.rejected_overlap_pcts.join(', ')}
            </div>
          )}
          {selected.an_nodes_added_ids.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <strong>Added:</strong> {selected.an_nodes_added_ids.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
