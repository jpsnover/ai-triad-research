// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import type { ArgumentNetworkNode } from '../../../types/debate';
import { CollapsibleSection } from './helpers';
import { VerdictChip } from '../window/shared/VerdictChip';
import type { Verdict } from '../window/shared/VerdictChip';

export interface VerificationSectionProps {
  transcript: Array<{ type: string; content: string; metadata?: Record<string, unknown> }>;
  anNodes: ArgumentNetworkNode[];
}

const VERDICT_ORDER = ['verified', 'supported', 'disputed', 'false', 'unverifiable', 'pending', 'unknown'];

function mapFactCheckVerdict(v: string): Verdict {
  switch (v) {
    case 'verified': case 'supported': return 'pass';
    case 'disputed': case 'false': return 'fail';
    default: return 'flag';
  }
}

interface ParsedFactCheck {
  verdict: string;
  explanation: string;
  checkedText: string;
  isAuto: boolean;
  webSearchUsed: boolean;
  webSearchQueries: string[];
  webSearchCitations: Array<{ url?: string; title?: string }>;
  targetAnId?: string;
}

function parseFactCheckMeta(meta: Record<string, unknown>): ParsedFactCheck {
  const fc = (meta.fact_check ?? meta) as Record<string, unknown>;
  return {
    verdict: (fc.verdict as string) ?? 'unknown',
    explanation: (fc.explanation as string) ?? '',
    checkedText: (fc.checked_text as string) ?? '',
    isAuto: !!(fc.target_an_id),
    webSearchUsed: !!(fc.web_search_used),
    webSearchQueries: Array.isArray(fc.web_search_queries) ? fc.web_search_queries as string[] : [],
    webSearchCitations: Array.isArray(fc.web_search_citations) ? fc.web_search_citations as Array<{ url?: string; title?: string }> : [],
    targetAnId: fc.target_an_id as string | undefined,
  };
}

export function VerificationSection({ transcript, anNodes }: VerificationSectionProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const { stats, checks } = useMemo(() => {
    const factChecks = transcript.filter(e => e.type === 'fact-check');
    const verdictCounts: Record<string, number> = {};
    const autoVerdictCounts: Record<string, number> = {};
    const userVerdictCounts: Record<string, number> = {};
    let autoChecks = 0;
    let userChecks = 0;
    const parsed: ParsedFactCheck[] = [];

    for (const fc of factChecks) {
      const meta = (fc.metadata ?? {}) as Record<string, unknown>;
      const p = parseFactCheckMeta(meta);
      parsed.push(p);

      verdictCounts[p.verdict] = (verdictCounts[p.verdict] ?? 0) + 1;
      if (p.isAuto) {
        autoChecks++;
        autoVerdictCounts[p.verdict] = (autoVerdictCounts[p.verdict] ?? 0) + 1;
      } else {
        userChecks++;
        userVerdictCounts[p.verdict] = (userVerdictCounts[p.verdict] ?? 0) + 1;
      }
    }

    const preciseBeliefs = anNodes.filter(
      n => n.bdi_category === 'belief' && n.specificity === 'precise',
    );
    const verifiedPreciseBeliefs = preciseBeliefs.filter(
      n => n.verification_status && n.verification_status !== 'pending',
    );

    return {
      stats: {
        totalChecks: factChecks.length,
        autoChecks,
        userChecks,
        verdictCounts,
        autoVerdictCounts,
        userVerdictCounts,
        preciseBeliefs: preciseBeliefs.length,
        preciseVerified: verifiedPreciseBeliefs.length,
        coverage: preciseBeliefs.length > 0 ? verifiedPreciseBeliefs.length / preciseBeliefs.length : 0,
      },
      checks: parsed,
    };
  }, [transcript, anNodes]);

  if (stats.totalChecks === 0 && stats.preciseBeliefs === 0) return null;

  const sortedVerdicts = Object.entries(stats.verdictCounts).sort(
    (a, b) => (VERDICT_ORDER.indexOf(a[0]) - VERDICT_ORDER.indexOf(b[0])) || (b[1] - a[1]),
  );

  return (
    <CollapsibleSection title="Fact-Check Verification" defaultOpen>
      <div className="diag-kv">
        <span className="diag-k">Total checks:</span>
        <span className="diag-v">{stats.totalChecks} ({stats.autoChecks} auto, {stats.userChecks} user)</span>
      </div>
      {stats.preciseBeliefs > 0 && (
        <>
          <div className="diag-kv">
            <span className="diag-k">Precise-belief coverage:</span>
            <span className="diag-v">
              {stats.preciseVerified} / {stats.preciseBeliefs} ({(stats.coverage * 100).toFixed(0)}%)
            </span>
          </div>
          <div
            style={{
              height: 6,
              background: 'var(--bg-secondary)',
              borderRadius: 3,
              overflow: 'hidden',
              margin: '4px 0 8px',
            }}
            title={`${stats.preciseVerified} of ${stats.preciseBeliefs} precise empirical claims verified`}
          >
            <div
              style={{
                width: `${(stats.coverage * 100).toFixed(1)}%`,
                height: '100%',
                background: stats.coverage >= 0.75 ? 'var(--success)' : stats.coverage >= 0.4 ? 'var(--warning)' : 'var(--danger)',
                transition: 'width 0.2s',
              }}
            />
          </div>
        </>
      )}
      {sortedVerdicts.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <span className="diag-k">Verdicts:</span>
          <div className="diag-badges">
            {sortedVerdicts.map(([v, n]) => (
              <VerdictChip
                key={v}
                verdict={mapFactCheckVerdict(v)}
                label={`${v} (${n})`}
                tooltip={`${stats.autoVerdictCounts[v] ?? 0} auto, ${stats.userVerdictCounts[v] ?? 0} user`}
              />
            ))}
          </div>
        </div>
      )}
      {checks.length > 0 && (
        <div style={{ marginTop: 8 }} className="factcheck-detail-list">
          {checks.map((fc, i) => (
            <div key={i} className="factcheck-detail-row" onClick={() => setExpandedIdx(expandedIdx === i ? null : i)} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedIdx(expandedIdx === i ? null : i); } }}>
              <div className="factcheck-detail-header">
                <VerdictChip verdict={mapFactCheckVerdict(fc.verdict)} label={fc.verdict} />
                <span className="factcheck-detail-claim">{fc.checkedText}</span>
                <span className="diag-muted" style={{ fontSize: 'var(--text-2xs)' }}>{fc.isAuto ? 'auto' : 'user'}{fc.webSearchUsed ? ' · web' : ''}</span>
              </div>
              {expandedIdx === i && (
                <div className="factcheck-detail-expanded">
                  <div className="factcheck-detail-explanation">{fc.explanation}</div>
                  {fc.targetAnId && <div className="diag-muted" style={{ fontSize: 'var(--text-2xs)' }}>AN node: {fc.targetAnId}</div>}
                  {fc.webSearchQueries.length > 0 && (
                    <div className="diag-muted" style={{ fontSize: 'var(--text-2xs)' }}>Queries: {fc.webSearchQueries.slice(0, 3).join(', ')}</div>
                  )}
                  {fc.webSearchCitations.length > 0 && (
                    <div style={{ fontSize: 'var(--text-2xs)', marginTop: 2 }}>
                      {fc.webSearchCitations.slice(0, 5).map((c, ci) => (
                        <div key={ci} className="diag-muted">{c.title || c.url || 'citation'}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {stats.totalChecks === 0 && stats.preciseBeliefs > 0 && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
          No fact-checks recorded yet. Auto-verification requires a Gemini model with web-search grounding.
        </div>
      )}
    </CollapsibleSection>
  );
}
