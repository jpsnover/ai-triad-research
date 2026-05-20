// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Post-debate retry effectiveness analysis.
 *
 * Analyzes the attempts[] array across all turns to determine whether
 * retries improve debate quality or just churn through different weaknesses.
 */

import type { TurnAttempt, TurnValidationTrail } from './types.js';

// ── Types ────────────────────────────────────────────────

export interface TurnRetryAnalysis {
  entry_id: string;
  speaker: string;
  attempt_count: number;
  scores: number[];
  best_score: number;
  best_attempt: number;
  last_score: number;
  score_improved: boolean;
  score_delta: number;        // best - first
  used_best: boolean;         // did we use the best or the last?
  hint_persistence_rate: number;  // % of attempt N hints that reappear in N+1
  hint_churn_rate: number;        // % of attempt N+1 hints that are brand new
  all_hints: string[][];          // per-attempt hint lists for inspection
}

export interface DebateRetryAnalysis {
  debate_id: string;
  total_turns: number;
  turns_with_retries: number;
  turns_improved: number;
  turns_regressed: number;
  turns_flat: number;
  avg_score_delta: number;
  avg_hint_persistence: number;
  avg_hint_churn: number;
  best_attempt_distribution: Record<number, number>;  // attempt_index → count
  per_turn: TurnRetryAnalysis[];
  recommendation: string;
}

// ── Analysis ─────────────────────────────────────────────

function computeHintOverlap(hintsA: string[], hintsB: string[]): { persistence: number; churn: number } {
  if (hintsA.length === 0 && hintsB.length === 0) return { persistence: 0, churn: 0 };
  if (hintsA.length === 0) return { persistence: 0, churn: 1 };

  // Fuzzy match: two hints are "the same" if they share 3+ consecutive words
  const normalize = (h: string) => h.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const trigrams = (text: string): Set<string> => {
    const words = text.split(/\s+/);
    const set = new Set<string>();
    for (let i = 0; i <= words.length - 3; i++) {
      set.add(words.slice(i, i + 3).join(' '));
    }
    return set;
  };

  const aTrigrams = hintsA.map(h => trigrams(normalize(h)));

  let persisted = 0;
  let newHints = 0;

  for (const hintB of hintsB) {
    const bTri = trigrams(normalize(hintB));
    const matchesAny = aTrigrams.some(aTri => {
      for (const t of bTri) {
        if (aTri.has(t)) return true;
      }
      return false;
    });
    if (matchesAny) {
      persisted++;
    } else {
      newHints++;
    }
  }

  return {
    persistence: hintsA.length > 0 ? persisted / hintsA.length : 0,
    churn: hintsB.length > 0 ? newHints / hintsB.length : 0,
  };
}

export function analyzeTurnRetries(
  entryId: string,
  speaker: string,
  trail: TurnValidationTrail,
): TurnRetryAnalysis {
  const attempts = trail.attempts;
  const scores = attempts.map(a => a.validation.process_reward ?? 0);
  const bestScore = Math.max(...scores);
  const bestAttempt = scores.indexOf(bestScore);
  const lastScore = scores[scores.length - 1];
  const firstScore = scores[0];

  const allHints = attempts.map(a => a.validation.repairHints ?? []);

  // Compute hint overlap between consecutive attempts
  let totalPersistence = 0;
  let totalChurn = 0;
  let overlapCount = 0;
  for (let i = 1; i < allHints.length; i++) {
    const overlap = computeHintOverlap(allHints[i - 1], allHints[i]);
    totalPersistence += overlap.persistence;
    totalChurn += overlap.churn;
    overlapCount++;
  }

  return {
    entry_id: entryId,
    speaker,
    attempt_count: attempts.length,
    scores,
    best_score: Math.round(bestScore * 100) / 100,
    best_attempt: bestAttempt,
    last_score: Math.round(lastScore * 100) / 100,
    score_improved: bestScore > firstScore + 0.02,
    score_delta: Math.round((bestScore - firstScore) * 100) / 100,
    used_best: bestAttempt !== attempts.length - 1,
    hint_persistence_rate: overlapCount > 0 ? Math.round(totalPersistence / overlapCount * 100) / 100 : 0,
    hint_churn_rate: overlapCount > 0 ? Math.round(totalChurn / overlapCount * 100) / 100 : 0,
    all_hints: allHints,
  };
}

export function analyzeDebateRetries(
  debateId: string,
  turnValidations: Record<string, TurnValidationTrail>,
  transcriptSpeakers: Record<string, string>,
): DebateRetryAnalysis {
  const perTurn: TurnRetryAnalysis[] = [];
  const bestDist: Record<number, number> = {};

  for (const [entryId, trail] of Object.entries(turnValidations)) {
    if (trail.attempts.length <= 1) continue; // no retries
    const speaker = transcriptSpeakers[entryId] ?? 'unknown';
    const analysis = analyzeTurnRetries(entryId, speaker, trail);
    perTurn.push(analysis);

    bestDist[analysis.best_attempt] = (bestDist[analysis.best_attempt] ?? 0) + 1;
  }

  const improved = perTurn.filter(t => t.score_improved).length;
  const regressed = perTurn.filter(t => t.score_delta < -0.02).length;
  const flat = perTurn.length - improved - regressed;

  const avgDelta = perTurn.length > 0
    ? Math.round(perTurn.reduce((s, t) => s + t.score_delta, 0) / perTurn.length * 100) / 100
    : 0;
  const avgPersistence = perTurn.length > 0
    ? Math.round(perTurn.reduce((s, t) => s + t.hint_persistence_rate, 0) / perTurn.length * 100) / 100
    : 0;
  const avgChurn = perTurn.length > 0
    ? Math.round(perTurn.reduce((s, t) => s + t.hint_churn_rate, 0) / perTurn.length * 100) / 100
    : 0;

  // Recommendation
  let recommendation: string;
  if (avgDelta > 0.05 && avgChurn < 0.5) {
    recommendation = 'Retries are effective — scores improve and hints are being addressed.';
  } else if (avgDelta > 0.02 && avgChurn > 0.7) {
    recommendation = 'Retries show marginal improvement but high hint churn — the judge finds new problems instead of recognizing fixes. Consider reducing maxRetries to 1.';
  } else if (avgDelta <= 0.02 && avgChurn > 0.6) {
    recommendation = 'Retries are not effective — scores are flat and the judge churns through different weaknesses. Retries are wasting tokens without improving quality. Consider disabling retries (maxRetries=0) or using only deterministic validation.';
  } else if (regressed > improved) {
    recommendation = 'Retries are counterproductive — more turns regressed than improved. The best-attempt selection is protecting against the worst outcomes, but the retry budget is being wasted.';
  } else {
    recommendation = 'Mixed results — retries help some turns but not others. Current best-attempt selection mitigates regression.';
  }

  return {
    debate_id: debateId,
    total_turns: Object.keys(turnValidations).length,
    turns_with_retries: perTurn.length,
    turns_improved: improved,
    turns_regressed: regressed,
    turns_flat: flat,
    avg_score_delta: avgDelta,
    avg_hint_persistence: avgPersistence,
    avg_hint_churn: avgChurn,
    best_attempt_distribution: bestDist,
    per_turn: perTurn,
    recommendation,
  };
}

/**
 * Format analysis as a readable summary for display or logging.
 */
export function formatRetryAnalysis(analysis: DebateRetryAnalysis): string {
  const lines: string[] = [
    `=== Retry Effectiveness Analysis ===`,
    `Debate: ${analysis.debate_id}`,
    `Turns with retries: ${analysis.turns_with_retries}/${analysis.total_turns}`,
    ``,
    `Score impact:`,
    `  Improved: ${analysis.turns_improved} (${Math.round(analysis.turns_improved / Math.max(1, analysis.turns_with_retries) * 100)}%)`,
    `  Regressed: ${analysis.turns_regressed} (${Math.round(analysis.turns_regressed / Math.max(1, analysis.turns_with_retries) * 100)}%)`,
    `  Flat: ${analysis.turns_flat}`,
    `  Avg score delta: ${analysis.avg_score_delta >= 0 ? '+' : ''}${analysis.avg_score_delta}`,
    ``,
    `Hint behavior:`,
    `  Avg persistence: ${Math.round(analysis.avg_hint_persistence * 100)}% (hints that reappear across retries)`,
    `  Avg churn: ${Math.round(analysis.avg_hint_churn * 100)}% (brand new hints per retry)`,
    ``,
    `Best attempt distribution:`,
  ];

  for (const [idx, count] of Object.entries(analysis.best_attempt_distribution).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    lines.push(`  Attempt ${idx}: ${count} turns`);
  }

  lines.push('');
  lines.push(`RECOMMENDATION: ${analysis.recommendation}`);
  lines.push('');
  lines.push('Per-turn detail:');

  for (const t of analysis.per_turn) {
    const trajectory = t.scores.map(s => s.toFixed(2)).join(' → ');
    lines.push(`  ${t.entry_id} (${t.speaker}): ${trajectory} [best=${t.best_attempt}, delta=${t.score_delta >= 0 ? '+' : ''}${t.score_delta}, churn=${Math.round(t.hint_churn_rate * 100)}%]`);
  }

  return lines.join('\n');
}
