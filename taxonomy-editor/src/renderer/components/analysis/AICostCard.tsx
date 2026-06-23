// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * AICostCard (t/892) — total tokens, estimated USD cost, per-model breakdown,
 * and per-debate average for the selected period. Data is server-aggregated
 * from ai.call events (tokens_in / tokens_out / estimated_cost_usd).
 */

import type { AICostAggregate } from './AnalyticsDashboard';
import './analyticsCards.css';

function fmtUsd(n: number): string { return `$${n.toFixed(n < 1 ? 4 : 2)}`; }
function fmtTokens(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

export function AICostCard({ aiCost, debateCount }: { aiCost?: AICostAggregate; debateCount?: number }) {
  if (!aiCost || aiCost.calls === 0) {
    return (
      <div className="analytics-card">
        <div className="analytics-card-label">AI Spend</div>
        <div className="analytics-card-empty">No AI calls in this period</div>
      </div>
    );
  }

  const totalTokens = aiCost.tokensIn + aiCost.tokensOut;
  const models = Object.entries(aiCost.byModel).sort(([, a], [, b]) => b.costUsd - a.costUsd);
  const perDebate = debateCount && debateCount > 0 ? aiCost.costUsd / debateCount : null;

  return (
    <div className="analytics-card">
      <div className="analytics-card-label">AI Spend</div>
      <div className="analytics-card-primary">{fmtUsd(aiCost.costUsd)}</div>
      <div className="analytics-card-rows">
        <div>{fmtTokens(totalTokens)} tokens ({fmtTokens(aiCost.tokensIn)} in / {fmtTokens(aiCost.tokensOut)} out)</div>
        {perDebate != null && <div>{fmtUsd(perDebate)} / debate</div>}
        {models.length > 1 && models.map(([m, b]) => (
          <div key={m} className="analytics-card-sub">{m}: {fmtUsd(b.costUsd)}</div>
        ))}
      </div>
    </div>
  );
}
