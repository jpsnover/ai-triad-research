// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ── Dialectical move normalizer ──────────────────────────────

import type { DialecticalScheme } from '../types.js';

/**
 * Canonical move definitions with aliases that map common LLM hallucinations
 * and legacy/synonym names to the correct canonical move.
 *
 * Each canonical move has:
 * - keywords: tokens that, if present in the hallucinated name, suggest this move
 * - aliases: exact strings (lowercased) that map to this move
 */
const CANONICAL_MOVES: Record<DialecticalScheme, { keywords: string[]; aliases: string[] }> = {
  'DISTINGUISH': {
    keywords: ['distinguish', 'differentiat', 'inapplicab'],
    aliases: ['distinguish', 'differentiate', 'scope-limit', 'limit-scope'],
  },
  'COUNTEREXAMPLE': {
    keywords: ['counter', 'example', 'exception', 'counterpoint'],
    aliases: ['counterexample', 'counter-example', 'counter_example', 'counterpoint', 'provide-counterexample'],
  },
  'CONCEDE-AND-PIVOT': {
    keywords: ['conced', 'pivot', 'acknowledge', 'grant'],
    aliases: ['concede-and-pivot', 'concede_and_pivot', 'concede', 'concede-pivot', 'acknowledge-and-redirect',
              'partial-concession', 'tactical-concession', 'yield-and-redirect'],
  },
  'REFRAME': {
    keywords: ['refram', 'frame', 'perspect', 'assumption', 'expose', 'hidden', 'premise', 'reveal'],
    aliases: ['reframe', 're-frame', 'reframing', 'expose-assumption', 'expose_assumption',
              'expose-assumptions', 'surface-assumption', 'reveal-assumption', 'challenge-frame',
              'shift-frame', 'recontextualize'],
  },
  'EMPIRICAL CHALLENGE': {
    keywords: ['empiric', 'evidence', 'fact', 'data', 'ground', 'verify', 'check'],
    aliases: ['empirical challenge', 'empirical_challenge', 'empirical-challenge',
              'ground-check', 'ground_check', 'fact-check', 'challenge-evidence',
              'dispute-evidence', 'evidence-challenge', 'factual-challenge'],
  },
  'EXTEND': {
    keywords: ['extend', 'build', 'expand', 'steel', 'strengthen', 'amplif'],
    aliases: ['extend', 'build-on', 'build_on', 'steel-build', 'steel_build',
              'steelman-extend', 'amplify', 'elaborate'],
  },
  'UNDERCUT': {
    keywords: ['undercut', 'warrant', 'reasoning', 'logic', 'inference'],
    aliases: ['undercut', 'attack-warrant', 'challenge-reasoning', 'deny-inference',
              'challenge-logic', 'warrant-attack'],
  },
  'SPECIFY': {
    keywords: ['specif', 'falsif', 'operationaliz', 'crux', 'narrow', 'testab', 'predict'],
    aliases: ['specify', 'probe-falsifiability', 'identify-crux', 'identify_crux',
              'narrow', 'narrow-disagreement', 'demand-specification', 'force-prediction',
              'operationalize', 'find-crux', 'name-crux'],
  },
  'INTEGRATE': {
    keywords: ['integrat', 'synthes', 'reconcil', 'conditional', 'hybrid', 'combin'],
    aliases: ['integrate', 'synthesize', 'conditional-agree', 'conditional_agree',
              'conditional-agreement', 'reconcile', 'hybrid-position', 'combine',
              'merge-positions', 'bridge'],
  },
  'BURDEN-SHIFT': {
    keywords: ['burden', 'proof', 'onus', 'responsibility'],
    aliases: ['burden-shift', 'burden_shift', 'shift-burden', 'burden-of-proof',
              'challenge-burden', 'proof-burden'],
  },
};

/** All canonical move names as a set for O(1) lookup. */
const CANONICAL_SET = new Set<string>(Object.keys(CANONICAL_MOVES));

/** Legacy moves that should silently map to their canonical equivalents. */
const LEGACY_MAP: Record<string, DialecticalScheme> = {
  'reduce': 'UNDERCUT',     // "reduces to absurdity" is a form of undercutting the logic
  'escalate': 'REFRAME',    // "escalating" to a deeper principle is reframing the scope
};

export interface NormalizedMove {
  canonical: DialecticalScheme;
  original: string;
  confidence: number; // 0-1
  method: 'exact' | 'alias' | 'keyword' | 'legacy';
}

/**
 * Normalize a single LLM-produced move name to its canonical form.
 * Returns null if no match can be found above the confidence threshold.
 */
export function normalizeMove(raw: string, minConfidence = 0.5): NormalizedMove | null {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();

  // 1. Exact match against canonical names
  if (CANONICAL_SET.has(upper)) {
    return { canonical: upper as DialecticalScheme, original: trimmed, confidence: 1.0, method: 'exact' };
  }

  // 2. Legacy map
  if (LEGACY_MAP[lower]) {
    return { canonical: LEGACY_MAP[lower], original: trimmed, confidence: 0.8, method: 'legacy' };
  }

  // 3. Alias match (exact, case-insensitive)
  for (const [canonical, def] of Object.entries(CANONICAL_MOVES)) {
    if (def.aliases.includes(lower)) {
      return { canonical: canonical as DialecticalScheme, original: trimmed, confidence: 0.95, method: 'alias' };
    }
  }

  // 4. Keyword match — score each canonical move by keyword overlap
  const scores: { canonical: DialecticalScheme; score: number }[] = [];
  for (const [canonical, def] of Object.entries(CANONICAL_MOVES)) {
    let hits = 0;
    for (const kw of def.keywords) {
      if (lower.includes(kw)) hits++;
    }
    if (hits > 0) {
      // Score: proportion of keywords matched, weighted by how specific the match is
      const score = hits / def.keywords.length;
      scores.push({ canonical: canonical as DialecticalScheme, score });
    }
  }

  if (scores.length > 0) {
    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];
    // Require the best to be meaningfully better than second-best to avoid ambiguity
    const confidence = scores.length === 1 || best.score > scores[1].score * 1.3
      ? Math.min(0.85, best.score + 0.3)
      : Math.min(0.6, best.score + 0.1);

    if (confidence >= minConfidence) {
      return { canonical: best.canonical, original: trimmed, confidence, method: 'keyword' };
    }
  }

  return null;
}

/**
 * Normalize an array of LLM-produced move names.
 * Returns only moves that pass the confidence threshold.
 * Deduplicates canonical moves (if two raw moves map to the same canonical, keep highest confidence).
 */
export function normalizeMoves(rawMoves: string[], minConfidence = 0.5): {
  normalized: NormalizedMove[];
  rejected: { original: string; reason: string }[];
} {
  const normalized: NormalizedMove[] = [];
  const rejected: { original: string; reason: string }[] = [];
  const seen = new Map<DialecticalScheme, NormalizedMove>();

  for (const raw of rawMoves) {
    const result = normalizeMove(raw, minConfidence);
    if (!result) {
      rejected.push({ original: raw, reason: `No canonical match (below ${minConfidence} confidence)` });
      continue;
    }

    const existing = seen.get(result.canonical);
    if (!existing || result.confidence > existing.confidence) {
      seen.set(result.canonical, result);
    }
  }

  normalized.push(...seen.values());
  return { normalized, rejected };
}

export function getNextArgumentNodeNumber(nodes: ReadonlyArray<{ id: string }>): number {
  let max = 0;
  for (const node of nodes) {
    const match = /^AN-(\d+)$/.exec(node.id);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return max + 1;
}

import { ActionableError } from '../errors.js';

export function assertUniqueArgumentNodeIds(nodes: ReadonlyArray<{ id: string }>): void {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) {
      throw new ActionableError({
        goal: 'Build an argument network with unique node identifiers',
        problem: `Duplicate argument node id detected: ${node.id}`,
        location: 'argumentNetwork.assertUniqueArgumentNodeIds',
        nextSteps: ['Ensure each node receives a unique AN-N identifier before moderation begins'],
      });
    }
    seen.add(node.id);
  }
}
