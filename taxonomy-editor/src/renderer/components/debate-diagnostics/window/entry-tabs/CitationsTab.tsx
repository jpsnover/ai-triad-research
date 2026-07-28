// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import type { EntryDiagnostics } from '../../../../types/debate';
import { Highlight } from '../helpers';
import './CitationsTab.css';

interface CitationResolutionDiag {
  path: 'tool-calling' | 'bank-scrub';
  bank_size: number;
  bank_sources: string[];
  citations_extracted: number;
  citations_matched: number;
  citations_fabricated: number;
  resolution_time_ms: number;
  matches: {
    citation_text: string;
    doc_id: string;
    title: string;
    similarity: number;
    match_type: 'exact' | 'fuzzy_title' | 'url' | 'arxiv_id';
  }[];
  fabrications: {
    citation_text: string;
    pattern: string;
    action: 'removed' | 'hedged';
    replacement?: string;
  }[];
  tool_calls?: {
    query: string;
    source_type?: string;
    results_count: number;
    top_result?: { doc_id: string; title: string; relevance: number };
    time_ms: number;
    empty: boolean;
  }[];
  scrub_diff?: {
    lines_removed: number;
    lines_modified: number;
    original_length: number;
    cleaned_length: number;
  };
  scrub_original?: string;
  warnings: string[];
}

export interface CitationsTabProps {
  diag: EntryDiagnostics | undefined;
  searchQuery?: string;
}

export function CitationsTab({ diag, searchQuery }: CitationsTabProps) {
  const _draftForCitations = (diag?.stage_diagnostics?.filter(s => s.stage === 'draft') ?? []).slice(-1)[0];
  const citationResDiag = _draftForCitations?.citation_resolution as CitationResolutionDiag | undefined;

  if (!citationResDiag) {
    return (
      <div className="ctn-root">
        <div className="ctn-empty">
          Citation resolution was not active for this turn.
        </div>
      </div>
    );
  }

  return (
    <div className="ctn-root">
      {/* -- 1. Summary Cards -- */}
      <div className="ctn-cards">
        {[
          {
            label: 'Path',
            value: citationResDiag.path === 'tool-calling' ? 'Tool-Call' : 'Bank+Scrub',
            color: citationResDiag.path === 'tool-calling' ? 'var(--color-saf)' : 'var(--warning)',
          },
          { label: 'Bank', value: `${citationResDiag.bank_size} srcs`, color: undefined },
          {
            label: 'Matched',
            value: `${citationResDiag.citations_matched}/${citationResDiag.citations_extracted}`,
            color: citationResDiag.citations_matched === citationResDiag.citations_extracted
              ? 'var(--success)'
              : citationResDiag.citations_fabricated > citationResDiag.citations_extracted / 2
                ? 'var(--danger)' : 'var(--warning)',
          },
          {
            label: 'Fabricated',
            value: citationResDiag.citations_fabricated === 0
              ? '0 — clean'
              : `${citationResDiag.citations_fabricated} ${citationResDiag.fabrications.filter(f => f.action === 'removed').length > 0 ? 'removed' : 'hedged'}`,
            color: citationResDiag.citations_fabricated === 0 ? 'var(--success)' : 'var(--danger)',
          },
        ].map(card => (
          <div key={card.label} className="ctn-card">
            <div className="ctn-card-label">{card.label}</div>
            {/* eslint-disable-next-line local/no-inline-style -- dynamic color (card.color) */}
            <div style={{
              fontSize: '0.82rem', fontWeight: 700, fontFamily: 'monospace',
              color: card.color ?? 'inherit',
            }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* -- 2. Matched Citations -- */}
      {citationResDiag.matches.length > 0 && (
        <details open className="ctn-details">
          <summary className="ctn-summary">
            Matched Citations ({citationResDiag.matches.length})
          </summary>
          {citationResDiag.matches
            .slice().sort((a, b) => b.similarity - a.similarity)
            .map((m, mi) => {
              const matchTypeColors: Record<string, string> = { exact: 'var(--success)', fuzzy_title: 'var(--warning)', url: 'var(--color-saf)', arxiv_id: 'var(--text-secondary)' };
              const mtColor = matchTypeColors[m.match_type] ?? 'var(--text-muted)';
              return (
                <div key={mi} className="ctn-match-card">
                  <div className="ctn-match-text">
                    &ldquo;{m.citation_text}&rdquo;
                  </div>
                  <div className="ctn-meta-row">
                    <span className="ctn-fw600">{m.doc_id}</span>
                    <span className="ctn-muted">— {m.similarity.toFixed(2)} similarity</span>
                    {/* eslint-disable-next-line local/no-inline-style -- dynamic color/background (mtColor) */}
                    <span style={{
                      fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 5px', borderRadius: 3,
                      color: mtColor, background: `${mtColor}18`,
                    }}>{m.match_type.replace('_', ' ').toUpperCase()}</span>
                  </div>
                  {m.title && (
                    <div className="ctn-sub-muted">
                      {m.title}
                    </div>
                  )}
                </div>
              );
            })}
        </details>
      )}

      {/* -- 3. Fabricated Citations -- */}
      {citationResDiag.fabrications.length > 0 && (
        <details open className="ctn-details">
          <summary className="ctn-summary">
            Fabricated Citations ({citationResDiag.fabrications.length})
          </summary>
          {citationResDiag.fabrications.map((f, fi) => {
            const patternColors: Record<string, string> = { arxiv: 'var(--text-secondary)', url: 'var(--color-saf)', title: 'var(--warning)', legislation: 'var(--text-secondary)' };
            const patColor = patternColors[f.pattern] ?? 'var(--text-muted)';
            return (
              <div key={fi} className="ctn-fab-card">
                <div className="ctn-fab-text">
                  &ldquo;{f.citation_text}&rdquo;
                </div>
                <div className="ctn-meta-row">
                  {/* eslint-disable-next-line local/no-inline-style -- dynamic color/background (patColor) */}
                  <span style={{
                    fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 5px', borderRadius: 3,
                    color: patColor, background: `${patColor}18`,
                  }}>{f.pattern.toUpperCase()}</span>
                  <span>Not in citation bank</span>
                  {/* eslint-disable-next-line local/no-inline-style -- dynamic color/background (f.action) */}
                  <span style={{
                    fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 5px', borderRadius: 3,
                    color: f.action === 'removed' ? 'var(--danger)' : 'var(--warning)',
                    background: f.action === 'removed' ? 'color-mix(in srgb, var(--danger) 10%, transparent)' : 'rgba(217,119,6,0.1)',
                  }}>{f.action}</span>
                </div>
                {f.replacement && (
                  <div className="ctn-replacement">
                    → {f.replacement}
                  </div>
                )}
              </div>
            );
          })}
        </details>
      )}

      {/* -- 4. Citation Bank -- */}
      {citationResDiag.bank_sources.length > 0 && (
        <details className="ctn-details">
          <summary className="ctn-summary">
            Citation Bank ({citationResDiag.bank_sources.length} available sources)
          </summary>
          {citationResDiag.bank_sources.slice(0, 5).map((src, si) => (
            <div key={si} className="ctn-bank-src">
              • {src}
            </div>
          ))}
          {citationResDiag.bank_sources.length > 5 && (
            <details className="ctn-details-sm">
              <summary className="ctn-summary-more">
                {citationResDiag.bank_sources.length - 5} more…
              </summary>
              {citationResDiag.bank_sources.slice(5).map((src, si) => (
                <div key={si} className="ctn-bank-src">
                  • {src}
                </div>
              ))}
            </details>
          )}
        </details>
      )}

      {/* -- 5. Tool Calls (Path B only) -- */}
      {citationResDiag.tool_calls && citationResDiag.tool_calls.length > 0 && (
        <details open className="ctn-details">
          <summary className="ctn-summary">
            Tool Calls ({citationResDiag.tool_calls.length})
          </summary>
          {citationResDiag.tool_calls.map((tc, ti) => (
            // eslint-disable-next-line local/no-inline-style -- dynamic borderLeft (tc.empty)
            <div key={ti} style={{
              marginBottom: 6, padding: '6px 8px', borderRadius: 4,
              borderLeft: `3px solid ${tc.empty ? 'var(--warning)' : 'var(--text-secondary)'}`,
              background: 'var(--bg-subtle)',
            }}>
              <div className="ctn-tc-header">
                <span className="ctn-fw700">LOOKUP #{ti + 1}</span>
                <span className="ctn-muted">{tc.time_ms}ms</span>
                {tc.empty && (
                  <span className="ctn-empty-badge">⚠ EMPTY</span>
                )}
              </div>
              <div className="ctn-tc-line">
                <strong>Query:</strong> {tc.query}
              </div>
              {tc.source_type && (
                <div className="ctn-tc-type">
                  Type: {tc.source_type}
                </div>
              )}
              <div className="ctn-tc-results">
                {tc.empty ? (
                  <span className="ctn-warn-text">Results: 0 — no verified sources found</span>
                ) : (
                  <span>
                    Results: {tc.results_count}
                    {tc.top_result && (
                      <> — top: <span className="ctn-saf">{tc.top_result.doc_id}</span> ({tc.top_result.relevance.toFixed(2)})</>
                    )}
                  </span>
                )}
              </div>
            </div>
          ))}
        </details>
      )}

      {/* -- 6. Scrub Diff (Path A only) -- */}
      {citationResDiag.scrub_diff && (
        <details open className="ctn-details">
          <summary className="ctn-summary">
            Scrub Diff
          </summary>
          <div className="ctn-scrub-summary">
            {citationResDiag.scrub_diff.lines_removed} lines removed, {citationResDiag.scrub_diff.lines_modified} lines modified
          </div>
          <div className="ctn-scrub-stats">
            <span>Original: {citationResDiag.scrub_diff.original_length} chars</span>
            <span>Cleaned: {citationResDiag.scrub_diff.cleaned_length} chars</span>
            <span>
              Δ {citationResDiag.scrub_diff.original_length - citationResDiag.scrub_diff.cleaned_length} chars removed
              ({((1 - citationResDiag.scrub_diff.cleaned_length / Math.max(1, citationResDiag.scrub_diff.original_length)) * 100).toFixed(1)}%)
            </span>
          </div>
        </details>
      )}

      {/* -- 7. Warnings -- */}
      {citationResDiag.warnings.length > 0 && (
        <details open className="ctn-details">
          <summary className="ctn-summary">
            Warnings ({citationResDiag.warnings.length})
          </summary>
          <ul className="ctn-warn-list">
            {citationResDiag.warnings.map((w, wi) => (
              <li key={wi} className="ctn-warn-item">{w}</li>
            ))}
          </ul>
        </details>
      )}

      {/* -- 8. Status Bar -- */}
      <div className="ctn-status-bar">
        <span>Resolution time: {citationResDiag.resolution_time_ms}ms</span>
        <span>Path: {citationResDiag.path}</span>
        <span>Bank: {citationResDiag.bank_size} srcs</span>
      </div>
    </div>
  );
}
