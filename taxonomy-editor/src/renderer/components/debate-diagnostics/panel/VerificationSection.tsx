// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import type { ArgumentNetworkNode } from '../../../types/debate';
import type { FactDiscrepancy } from '@lib/debate/types';
import { CollapsibleSection } from './helpers';
import { VerdictChip } from '../window/shared/VerdictChip';
import type { Verdict } from '../window/shared/VerdictChip';

export interface VerificationSectionProps {
  transcript: Array<{ type: string; content: string; metadata?: Record<string, unknown> }>;
  anNodes: ArgumentNetworkNode[];
}

// `partially_accurate` (evidence-gated, t/1701) sits between `supported` and
// `disputed`: the core claim holds but a sourced detail is off. It must NOT fold
// into a clean pass — see mapFactCheckVerdict.
const VERDICT_ORDER = ['supported', 'partially_accurate', 'disputed', 'false', 'unverifiable', 'pending', 'unknown'];

function mapFactCheckVerdict(v: string): Verdict {
  switch (v) {
    case 'supported': return 'pass';
    case 'partially_accurate': return 'caveat';
    case 'disputed': case 'false': return 'fail';
    default: return 'flag';
  }
}

const DISCREPANCY_SEVERITIES = new Set<FactDiscrepancy['severity']>(['minor', 'major']);
const DISCREPANCY_DIMENSIONS = new Set<FactDiscrepancy['dimension']>([
  'magnitude', 'temporal', 'attribution', 'scope', 'existence',
]);

/**
 * Defensively lift a `discrepancy` object out of untyped fact-check metadata.
 * Returns a `FactDiscrepancy` only when the required evidence fields are present
 * and the enums are valid; otherwise `undefined` (metadata is best-effort — the
 * upstream write sites may not populate it yet).
 */
function parseDiscrepancy(raw: unknown): FactDiscrepancy | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const d = raw as Record<string, unknown>;
  const { dimension, claimed, actual, source, severity } = d;
  if (
    typeof claimed !== 'string' || typeof actual !== 'string' || typeof source !== 'string' ||
    typeof dimension !== 'string' || !DISCREPANCY_DIMENSIONS.has(dimension as FactDiscrepancy['dimension']) ||
    typeof severity !== 'string' || !DISCREPANCY_SEVERITIES.has(severity as FactDiscrepancy['severity'])
  ) {
    return undefined;
  }
  return {
    dimension: dimension as FactDiscrepancy['dimension'],
    claimed,
    actual,
    source,
    severity: severity as FactDiscrepancy['severity'],
  };
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
  discrepancy?: FactDiscrepancy;
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
    discrepancy: parseDiscrepancy(fc.discrepancy),
  };
}

/** Distinct severity pill — `major` weakens the claim materially (danger), `minor` does not (warning). */
function SeverityTag({ severity }: { severity: FactDiscrepancy['severity'] }) {
  const color = severity === 'major' ? 'var(--danger)' : 'var(--warning)';
  return (
    <span
      title={severity === 'major' ? 'Major: materially weakens the claim (direction still holds)' : 'Minor: does not change the claim’s force'}
      style={{
        fontSize: 'var(--text-2xs)',
        fontWeight: 700,
        letterSpacing: '0.5px',
        padding: '1px 6px',
        borderRadius: 8,
        color,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        flexShrink: 0,
      }}
    >
      {severity.toUpperCase()}
    </span>
  );
}

/** Per-verdict discrepancy detail for a `partially_accurate` fact-check: what was off, and the source that establishes it. */
function DiscrepancyDetail({ discrepancy }: { discrepancy: FactDiscrepancy }) {
  return (
    <div
      className="diag-muted"
      style={{ fontSize: 'var(--text-2xs)', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      <div>
        <SeverityTag severity={discrepancy.severity} />{' '}
        <span style={{ textTransform: 'capitalize' }}>{discrepancy.dimension}</span> discrepancy
      </div>
      <div>
        Claimed <span style={{ color: 'var(--text-primary)' }}>&ldquo;{discrepancy.claimed}&rdquo;</span>
        {' → '}
        actual <span style={{ color: 'var(--text-primary)' }}>&ldquo;{discrepancy.actual}&rdquo;</span>
      </div>
      <div>Source: {discrepancy.source}</div>
    </div>
  );
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
                {fc.discrepancy && <SeverityTag severity={fc.discrepancy.severity} />}
                <span className="factcheck-detail-claim">{fc.checkedText}</span>
                <span className="diag-muted" style={{ fontSize: 'var(--text-2xs)' }}>{fc.isAuto ? 'auto' : 'user'}{fc.webSearchUsed ? ' · web' : ''}</span>
              </div>
              {expandedIdx === i && (
                <div className="factcheck-detail-expanded">
                  <div className="factcheck-detail-explanation">{fc.explanation}</div>
                  {fc.discrepancy && <DiscrepancyDetail discrepancy={fc.discrepancy} />}
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
