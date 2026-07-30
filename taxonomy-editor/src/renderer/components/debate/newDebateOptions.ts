// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/** Options bag passed as the trailing argument of `createDebate()` — assembled from the
 *  New Debate setup form's field values. Extracted from NewDebateDialog to keep that file
 *  under the max-lines ceiling (t/1979). */
export type CreateDebateOptions = {
  title?: string;
  evaluatorModel?: string;
  pacing?: string;
  useAdaptiveStaging?: boolean;
  phaseBoundsOverride?: { maxConfrontationRounds?: number; maxArgumentationRounds?: number; maxConcludingRounds?: number };
  speakerModels?: Record<string, string>;
  modelTier?: 'basic' | 'advanced';
  stepMode?: boolean;
  stageModels?: { brief?: string; plan?: string; cite?: string };
  background?: string;
  excludeGreatestHits?: boolean;
};

/** Map the setup form's raw field values into the createDebate options object. Pure. */
export function buildDebateOptions(p: {
  debateTitle: string;
  background: string;
  evaluatorModel: string;
  confrontationRounds: number;
  argumentationRounds: number;
  concludingRounds: number;
  speakerModels: Record<string, string> | undefined;
  multiProvider: boolean;
  modelTier: 'basic' | 'advanced';
  stepMode: boolean;
  excludeGreatestHits: boolean;
  stageModels: { brief: string; plan: string; cite: string };
}): CreateDebateOptions {
  return {
    title: p.debateTitle || undefined,
    background: p.background.trim() || undefined,
    evaluatorModel: p.evaluatorModel || undefined,
    useAdaptiveStaging: true,
    phaseBoundsOverride: {
      maxConfrontationRounds: p.confrontationRounds,
      maxArgumentationRounds: p.argumentationRounds,
      maxConcludingRounds: p.concludingRounds,
    },
    speakerModels: p.speakerModels,
    modelTier: p.multiProvider ? p.modelTier : undefined,
    stepMode: p.stepMode || undefined,
    excludeGreatestHits: p.excludeGreatestHits || undefined,
    stageModels: (p.stageModels.brief || p.stageModels.plan || p.stageModels.cite)
      ? { ...(p.stageModels.brief && { brief: p.stageModels.brief }), ...(p.stageModels.plan && { plan: p.stageModels.plan }), ...(p.stageModels.cite && { cite: p.stageModels.cite }) }
      : undefined,
  };
}
