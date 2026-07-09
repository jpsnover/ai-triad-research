// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import type { EntryDiagnostics } from '../../../../types/debate';
import { Highlight } from '../helpers';

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
      <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
        <div style={{ padding: '12px 8px', color: 'var(--text-muted)', fontSize: '0.72rem', textAlign: 'center' }}>
          Citation resolution was not active for this turn.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
      {/* -- 1. Summary Cards -- */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {[
          {
            label: 'Path',
            value: citationResDiag.path === 'tool-calling' ? 'Tool-Call' : 'Bank+Scrub',
            color: citationResDiag.path === 'tool-calling' ? '#3b82f6' : '#d97706',
          },
          { label: 'Bank', value: `${citationResDiag.bank_size} srcs`, color: undefined },
          {
            label: 'Matched',
            value: `${citationResDiag.citations_matched}/${citationResDiag.citations_extracted}`,
            color: citationResDiag.citations_matched === citationResDiag.citations_extracted
              ? '#22c55e'
              : citationResDiag.citations_fabricated > citationResDiag.citations_extracted / 2
                ? '#ef4444' : '#d97706',
          },
          {
            label: 'Fabricated',
            value: citationResDiag.citations_fabricated === 0
              ? '0 — clean'
              : `${citationResDiag.citations_fabricated} ${citationResDiag.fabrications.filter(f => f.action === 'removed').length > 0 ? 'removed' : 'hedged'}`,
            color: citationResDiag.citations_fabricated === 0 ? '#22c55e' : '#ef4444',
          },
        ].map(card => (
          <div key={card.label} style={{
            flex: '1 1 100px', padding: '6px 10px', borderRadius: 4,
            background: 'var(--bg-subtle)', border: '1px solid var(--border)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 2 }}>{card.label}</div>
            <div style={{
              fontSize: '0.82rem', fontWeight: 700, fontFamily: 'monospace',
              color: card.color ?? 'inherit',
            }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* -- 2. Matched Citations -- */}
      {citationResDiag.matches.length > 0 && (
        <details open style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', marginBottom: 6 }}>
            Matched Citations ({citationResDiag.matches.length})
          </summary>
          {citationResDiag.matches
            .slice().sort((a, b) => b.similarity - a.similarity)
            .map((m, mi) => {
              const matchTypeColors: Record<string, string> = { exact: '#16a34a', fuzzy_title: '#d97706', url: '#3b82f6', arxiv_id: '#8b5cf6' };
              const mtColor = matchTypeColors[m.match_type] ?? '#6b7280';
              return (
                <div key={mi} style={{
                  marginBottom: 6, padding: '6px 8px', borderRadius: 4,
                  borderLeft: '3px solid #22c55e', background: 'var(--bg-subtle)',
                }}>
                  <div style={{ fontSize: 'var(--text-2xs)', fontFamily: 'monospace', marginBottom: 3, color: '#22c55e' }}>
                    &ldquo;{m.citation_text}&rdquo;
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-2xs)' }}>
                    <span style={{ fontWeight: 600 }}>{m.doc_id}</span>
                    <span style={{ color: 'var(--text-muted)' }}>— {m.similarity.toFixed(2)} similarity</span>
                    <span style={{
                      fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 5px', borderRadius: 3,
                      color: mtColor, background: `${mtColor}18`,
                    }}>{m.match_type.replace('_', ' ').toUpperCase()}</span>
                  </div>
                  {m.title && (
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>
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
        <details open style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', marginBottom: 6 }}>
            Fabricated Citations ({citationResDiag.fabrications.length})
          </summary>
          {citationResDiag.fabrications.map((f, fi) => {
            const patternColors: Record<string, string> = { arxiv: '#8b5cf6', url: '#3b82f6', title: '#d97706', legislation: '#059669' };
            const patColor = patternColors[f.pattern] ?? '#6b7280';
            return (
              <div key={fi} style={{
                marginBottom: 6, padding: '6px 8px', borderRadius: 4,
                borderLeft: '3px solid #ef4444', background: 'var(--bg-subtle)',
              }}>
                <div style={{ fontSize: 'var(--text-2xs)', fontFamily: 'monospace', marginBottom: 3, color: '#ef4444' }}>
                  &ldquo;{f.citation_text}&rdquo;
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-2xs)' }}>
                  <span style={{
                    fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 5px', borderRadius: 3,
                    color: patColor, background: `${patColor}18`,
                  }}>{f.pattern.toUpperCase()}</span>
                  <span>Not in citation bank</span>
                  <span style={{
                    fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 5px', borderRadius: 3,
                    color: f.action === 'removed' ? '#ef4444' : '#d97706',
                    background: f.action === 'removed' ? 'rgba(239,68,68,0.1)' : 'rgba(217,119,6,0.1)',
                  }}>{f.action}</span>
                </div>
                {f.replacement && (
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 3 }}>
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
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', marginBottom: 6 }}>
            Citation Bank ({citationResDiag.bank_sources.length} available sources)
          </summary>
          {citationResDiag.bank_sources.slice(0, 5).map((src, si) => (
            <div key={si} style={{ fontSize: 'var(--text-2xs)', padding: '2px 0', color: '#3b82f6' }}>
              • {src}
            </div>
          ))}
          {citationResDiag.bank_sources.length > 5 && (
            <details style={{ marginTop: 2 }}>
              <summary style={{ cursor: 'pointer', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                {citationResDiag.bank_sources.length - 5} more…
              </summary>
              {citationResDiag.bank_sources.slice(5).map((src, si) => (
                <div key={si} style={{ fontSize: 'var(--text-2xs)', padding: '2px 0', color: '#3b82f6' }}>
                  • {src}
                </div>
              ))}
            </details>
          )}
        </details>
      )}

      {/* -- 5. Tool Calls (Path B only) -- */}
      {citationResDiag.tool_calls && citationResDiag.tool_calls.length > 0 && (
        <details open style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', marginBottom: 6 }}>
            Tool Calls ({citationResDiag.tool_calls.length})
          </summary>
          {citationResDiag.tool_calls.map((tc, ti) => (
            <div key={ti} style={{
              marginBottom: 6, padding: '6px 8px', borderRadius: 4,
              borderLeft: `3px solid ${tc.empty ? '#f59e0b' : '#0ea5e9'}`,
              background: 'var(--bg-subtle)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: 'var(--text-2xs)' }}>
                <span style={{ fontWeight: 700 }}>LOOKUP #{ti + 1}</span>
                <span style={{ color: 'var(--text-muted)' }}>{tc.time_ms}ms</span>
                {tc.empty && (
                  <span style={{
                    fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '0 5px', borderRadius: 3,
                    background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                  }}>⚠ EMPTY</span>
                )}
              </div>
              <div style={{ fontSize: 'var(--text-2xs)', marginBottom: 2 }}>
                <strong>Query:</strong> {tc.query}
              </div>
              {tc.source_type && (
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                  Type: {tc.source_type}
                </div>
              )}
              <div style={{ fontSize: 'var(--text-2xs)', marginTop: 2 }}>
                {tc.empty ? (
                  <span style={{ color: '#f59e0b' }}>Results: 0 — no verified sources found</span>
                ) : (
                  <span>
                    Results: {tc.results_count}
                    {tc.top_result && (
                      <> — top: <span style={{ color: '#3b82f6' }}>{tc.top_result.doc_id}</span> ({tc.top_result.relevance.toFixed(2)})</>
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
        <details open style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', marginBottom: 6 }}>
            Scrub Diff
          </summary>
          <div style={{ fontSize: 'var(--text-2xs)', marginBottom: 4 }}>
            {citationResDiag.scrub_diff.lines_removed} lines removed, {citationResDiag.scrub_diff.lines_modified} lines modified
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
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
        <details open style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', marginBottom: 6 }}>
            Warnings ({citationResDiag.warnings.length})
          </summary>
          <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 'var(--text-2xs)' }}>
            {citationResDiag.warnings.map((w, wi) => (
              <li key={wi} style={{ marginBottom: 3, lineHeight: 1.35 }}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      {/* -- 8. Status Bar -- */}
      <div style={{
        marginTop: 10, padding: '4px 8px', borderRadius: 3,
        background: 'var(--bg-subtle)', border: '1px solid var(--border)',
        fontSize: 'var(--text-2xs)', color: 'var(--text-muted)',
        display: 'flex', gap: 12,
      }}>
        <span>Resolution time: {citationResDiag.resolution_time_ms}ms</span>
        <span>Path: {citationResDiag.path}</span>
        <span>Bank: {citationResDiag.bank_size} srcs</span>
      </div>
    </div>
  );
}
