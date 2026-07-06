// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// TS port of Measure-DebateQuality's 8-metric weighted formula.
// Pure function on CalibrationDataPoint — no file I/O.

import type { CalibrationDataPoint } from './calibrationLogger.js';

export type QualityTier = 'Excellent' | 'Good' | 'Fair' | 'Poor';

export interface QualityScoreResult {
  score: number;
  tier: QualityTier;
  dimensions: {
    ArgumentDepth: number;
    ClaimCoverage: number;
    RebuttalEffectiveness: number;
    POVBalance: number;
    TopicAlignment: number;
    RepetitionResistance: number;
    ClaimRetention: number;
    RhetoricalQuality: number;
  };
}

function safe(v: number | null | undefined): number {
  return v ?? 0;
}

export function computeQualityScore(dp: CalibrationDataPoint): QualityScoreResult {
  const cruxAddressed = safe(dp.crux_addressed_ratio);
  const taxonomyMapped = safe(dp.taxonomy_mapped_ratio);
  const sitCruxAlignment = safe(dp.situation_crux_alignment);
  const avgBranchCohesion = safe(dp.avg_branch_cohesion);
  const topicAlignment = safe(dp.topic_alignment_rate);
  const repetitionRate = safe(dp.repetition_rate);
  const claimsForgotten = safe(dp.claims_forgotten_rate);
  const draftRepairRate = safe(dp.draft_repair_rate);

  const raw =
    (cruxAddressed * 20) +
    (taxonomyMapped * 15) +
    (sitCruxAlignment * 15) +
    (avgBranchCohesion * 10) +
    (topicAlignment * 15) +
    ((1 - repetitionRate) * 10) +
    ((1 - claimsForgotten) * 10) +
    ((1 - draftRepairRate) * 5);

  const score = Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;

  const tier: QualityTier =
    score >= 75 ? 'Excellent' :
    score >= 60 ? 'Good' :
    score >= 40 ? 'Fair' :
    'Poor';

  return {
    score,
    tier,
    dimensions: {
      ArgumentDepth: cruxAddressed,
      ClaimCoverage: taxonomyMapped,
      RebuttalEffectiveness: sitCruxAlignment,
      POVBalance: avgBranchCohesion,
      TopicAlignment: topicAlignment,
      RepetitionResistance: Math.round((1 - repetitionRate) * 10000) / 10000,
      ClaimRetention: Math.round((1 - claimsForgotten) * 10000) / 10000,
      RhetoricalQuality: Math.round((1 - draftRepairRate) * 10000) / 10000,
    },
  };
}
