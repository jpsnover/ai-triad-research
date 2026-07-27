// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ── NLI-style discrete evaluation mapping ───────────────────

import type { ArgumentNetworkNode } from '../types.js';
import type { BeliefVerification, RawExtractedClaim } from './processClaims.js';

export type NodeStrengthCategory = 'grounded' | 'reasoned' | 'asserted';
export type EdgeStrengthCategory = 'decisive' | 'substantial' | 'tangential';
export type BdiTernary = 'yes' | 'partial' | 'no';

const NODE_STRENGTH_MAP: Record<NodeStrengthCategory, number> = {
  grounded: 0.8,
  reasoned: 0.5,
  asserted: 0.2,
};

const EDGE_STRENGTH_MAP: Record<EdgeStrengthCategory, number> = {
  decisive: 1.0,
  substantial: 0.7,
  tangential: 0.3,
};

const BDI_TERNARY_MAP: Record<BdiTernary, number> = {
  yes: 1.0,
  partial: 0.5,
  no: 0.0,
};

/** Belief specificity → base_strength proxy (t/455 Stage 1).
 *  AI reliably judges whether a claim cites specific data vs makes broad assertions. */
export const BELIEF_SPECIFICITY_MAP: Record<string, number> = {
  precise: 0.70,  // cites specific data, named sources, dates
  general: 0.50,  // broad empirical claim without specific details
  abstract: 0.35, // theoretical, not empirically testable
};

/** Compute base_strength from a ThinkPRM verification chain (t/455 Stage 3).
 *  Decomposes the unreliable holistic "evidence quality" judgment into 4 tractable
 *  sub-steps, each producing a sub-score in [0,1]. */
export function beliefVerificationToStrength(v: BeliefVerification): number {
  // Sub-step 1: source_located — was the evidence found in the source?
  const locationScore = v.source_located === 'found' ? 1.0
    : v.source_located === 'not_found' ? 0.3  // claim cites evidence not in source
    : 0.1;  // no_source — claim cites nothing specific

  // Sub-step 2: evidence_supports — does the evidence actually support the claim?
  const supportScore = v.evidence_supports === 'strongly' ? 1.0
    : v.evidence_supports === 'partially' ? 0.65
    : v.evidence_supports === 'weakly' ? 0.35
    : 0.1;  // contradicts

  // Sub-step 3: counter_evidence — does the source contain contradicting info?
  const counterPenalty = v.counter_evidence === 'none' ? 0
    : v.counter_evidence === 'minor' ? 0.15
    : 0.30;  // significant

  // Sub-step 4: ambiguity_resolved — did the extraction collapse an open question?
  // "collapsed" caps strength at 0.6 — the claim may be accurate but represents
  // a choice among interpretations the source left open (Gur-Arieh et al., 2026).
  const ambiguityPenalty = v.ambiguity_resolved === 'collapsed' ? 0.20
    : 0;  // "none" or "acknowledged" — no penalty

  // Composite: weighted average with counter-evidence and ambiguity penalties
  const raw = 0.4 * locationScore + 0.6 * supportScore - counterPenalty - ambiguityPenalty;
  return Math.max(0.1, Math.min(0.95, raw));
}

export function discreteNodeStrength(category: string): number {
  const key = category.toLowerCase() as NodeStrengthCategory;
  return NODE_STRENGTH_MAP[key] ?? 0.5;
}

export function discreteEdgeStrength(category: string): number {
  const key = category.toLowerCase() as EdgeStrengthCategory;
  return EDGE_STRENGTH_MAP[key] ?? 0.7;
}

export function discreteBdiScore(value: string): number {
  const key = value.toLowerCase() as BdiTernary;
  return BDI_TERNARY_MAP[key] ?? 0.5;
}

/**
 * Map a fact-check verdict + confidence to a numeric base_strength for Belief claims.
 * Closes the belief-scoring asymmetry (theory-of-success §4.4) by using retrieval-augmented
 * verification as a proxy for empirical claim strength.
 *
 * When `evidenceStrength` is provided (from the evidence QBAF pipeline), it takes
 * precedence over the single-verdict mapping.
 */
export function factCheckToBaseStrength(
  verdict: string,
  confidence?: string,
  evidenceStrength?: number,
): number {
  // Evidence QBAF result takes precedence when available
  if (evidenceStrength !== undefined) {
    return Math.max(0, Math.min(1, evidenceStrength));
  }
  const conf = (confidence ?? 'medium').toLowerCase();
  switch (verdict) {
    // Legacy 'verified' is normalized to 'supported' upstream via normalizeVerdict
    // (the single read-alias, Option A) before reaching here, so it needs no case (t/1799).
    case 'supported':
      return conf === 'high' ? 0.85 : conf === 'low' ? 0.55 : 0.70;
    case 'disputed':
    case 'false':
      return conf === 'high' ? 0.15 : conf === 'low' ? 0.40 : 0.30;
    case 'unverifiable':
    default:
      return 0.50;
  }
}

function isDiscreteNodeStrength(v: unknown): v is string {
  return typeof v === 'string' && v.toLowerCase() in NODE_STRENGTH_MAP;
}

function isDiscreteEdgeStrength(v: unknown): v is string {
  return typeof v === 'string' && v.toLowerCase() in EDGE_STRENGTH_MAP;
}

function isDiscreteBdi(v: unknown): v is string {
  return typeof v === 'string' && v.toLowerCase() in BDI_TERNARY_MAP;
}

export function overlapToExtractionConfidence(overlap: number): number {
  if (overlap >= 0.7) return 1.0;
  if (overlap >= 0.5) return 0.8;
  if (overlap >= 0.3) return 0.6;
  return 0.5;
}

const ENTAILMENT_SAMPLING_RATES: Record<string, number> = {
  intention: 0.50,
  belief: 0.30,
  desire: 0.15,
};
const DEFAULT_SAMPLING_RATE = 0.30;

export function sampleNodesForEntailment(
  nodes: ArgumentNetworkNode[],
  rng: () => number = Math.random,
): ArgumentNetworkNode[] {
  return nodes.filter(n => {
    const rate = ENTAILMENT_SAMPLING_RATES[n.bdi_category ?? ''] ?? DEFAULT_SAMPLING_RATE;
    return rng() < rate;
  });
}

/**
 * Normalize a raw extracted claim from discrete categorical outputs to numeric floats.
 * Accepts both legacy float format (passthrough) and NLI-style discrete categories.
 */
export function normalizeExtractedClaim(claim: RawExtractedClaim): RawExtractedClaim {
  const normalized = { ...claim };

  // base_strength: accept discrete category string or legacy float
  // Only apply the evidential grounding map (grounded→0.8, reasoned→0.5, asserted→0.2)
  // to Belief claims. For Desires/Intentions, evidential grounding is epistemically
  // wrong — use neutral 0.5 so BDI composite scoring isn't biased by an empirical scale.
  if (isDiscreteNodeStrength(claim.base_strength)) {
    if (claim.bdi_category === 'belief' || !claim.bdi_category) {
      normalized.base_strength = discreteNodeStrength(claim.base_strength as unknown as string);
    } else {
      normalized.base_strength = 0.5;
    }
  }

  // bdi_sub_scores: accept discrete ternary strings or legacy floats
  if (claim.bdi_sub_scores && typeof claim.bdi_sub_scores === 'object') {
    const mapped: Record<string, number> = {};
    for (const [key, val] of Object.entries(claim.bdi_sub_scores)) {
      mapped[key] = isDiscreteBdi(val) ? discreteBdiScore(val as unknown as string) : (typeof val === 'number' ? val : 0.5);
    }
    normalized.bdi_sub_scores = mapped;
  }

  // edge weights: accept discrete "strength" field, discrete "weight" string, or legacy float
  if (claim.responds_to) {
    normalized.responds_to = claim.responds_to.map(rel => {
      const raw = rel.strength ?? rel.weight;
      if (isDiscreteEdgeStrength(raw)) {
        const canonical = (raw as string).toLowerCase() as EdgeStrengthCategory;
        return { ...rel, weight: discreteEdgeStrength(raw as string), strength: canonical };
      }
      return rel;
    });
  }

  return normalized;
}
