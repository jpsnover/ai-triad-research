// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo } from 'react';
import type { CoverageMap, StrengthWeightedCoverage } from '@lib/debate/coverageTracker';
import { CollapsibleSection } from './helpers';

/** Document Coverage section (CT-3/CT-4): shows per-claim coverage status sorted uncovered-first.
 *  Click-to-steer (CT-4): uncovered/partial claims are clickable — injects a steering question into the debate. */
export function DocumentCoverageSection({ coverageMap, strengthWeighted, onSteerToClaim }: { coverageMap: CoverageMap; strengthWeighted?: StrengthWeightedCoverage | null; onSteerToClaim?: (claimText: string) => void }) {
  const { stats, coverage, documentClaims } = coverageMap;
  const claimTextById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of documentClaims) m.set(c.id, c.text);
    return m;
  }, [documentClaims]);

  // Sort: uncovered first, then partially_covered, then covered
  const sortedCoverage = useMemo(() => {
    const order: Record<string, number> = { uncovered: 0, partially_covered: 1, covered: 2 };
    return [...coverage].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [coverage]);

  const statusIcon = (status: string) => {
    if (status === 'covered') return <span className="coverage-status-icon coverage-status-covered" title="Covered">&#9679;</span>;
    if (status === 'partially_covered') return <span className="coverage-status-icon coverage-status-partial" title="Partially covered">&#9681;</span>;
    return <span className="coverage-status-icon coverage-status-uncovered" title="Uncovered">&#9675;</span>;
  };

  return (
    <CollapsibleSection title={`Document Coverage — ${stats.coveredCount + stats.partiallyCoveredCount}/${stats.totalClaims} claims (${Math.round(stats.coveragePercentage)}%)`} defaultOpen>
      <div className="coverage-summary-row">
        <span className="coverage-stat coverage-stat-covered">{stats.coveredCount} covered</span>
        <span className="coverage-stat coverage-stat-partial">{stats.partiallyCoveredCount} partial</span>
        <span className="coverage-stat coverage-stat-uncovered">{stats.uncoveredCount} uncovered</span>
      </div>
      {strengthWeighted && (
        <div className="coverage-summary-row coverage-strength-row">
          <span className="coverage-stat" title="Coverage weighted by QBAF computed strength — penalizes missing load-bearing arguments">
            Strength-weighted: {Math.round(strengthWeighted.strength_weighted_coverage)}%
          </span>
          {Math.abs(strengthWeighted.coverage_gap) >= 1 && (
            <span className={`coverage-stat ${strengthWeighted.coverage_gap > 5 ? 'coverage-stat-uncovered' : 'coverage-stat-partial'}`}
              title="Gap between raw and strength-weighted coverage. Large gap = debate is avoiding the hard arguments.">
              gap: {strengthWeighted.coverage_gap > 0 ? '+' : ''}{Math.round(strengthWeighted.coverage_gap)}pp
            </span>
          )}
        </div>
      )}
      <div className="coverage-claim-list">
        {sortedCoverage.map(entry => {
          const claimText = claimTextById.get(entry.claimId) ?? entry.claimId;
          const isClickable = onSteerToClaim && entry.status !== 'covered';
          return (
          <div
            key={entry.claimId}
            className={`coverage-claim-row coverage-claim-${entry.status}${isClickable ? ' coverage-claim-steerable' : ''}`}
            onClick={isClickable ? () => onSteerToClaim(claimText) : undefined}
            title={isClickable ? 'Click to steer the debate toward this claim' : undefined}
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSteerToClaim(claimText); } } : undefined}
          >
            <div className="coverage-claim-header">
              {statusIcon(entry.status)}
              <span className="coverage-claim-id">{entry.claimId}</span>
              {isClickable && <span className="coverage-steer-hint">click to steer</span>}
              <span className="coverage-claim-score">{((entry.similarity ?? 0) * 100).toFixed(0)}%</span>
            </div>
            <div className="coverage-claim-text">{claimText}</div>
            {entry.matchedAnNodes.length > 0 && (
              <div className="coverage-matched-nodes">
                <span className="diag-muted">Matched AN:</span>
                {entry.matchedAnNodes.map(nodeId => (
                  <span key={nodeId} className="diag-badge" style={{ fontSize: 'var(--text-2xs)' }}>{nodeId}</span>
                ))}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
