// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { TurnStageId, StageProvenance } from '../types.js';
import { getGlobalRecorder } from '../../flight-recorder/index.js';
import { parseJsonRobust } from '../helpers.js';
import type { StagePromptInput } from '../prompts.js';
import type { TurnPipelineInput } from './types.js';

// ── Pipeline runner ─────────────────────────────────────

export function buildStageInput(input: TurnPipelineInput): StagePromptInput {
  return {
    label: input.label,
    pov: input.pov,
    personality: input.personality,
    topic: input.topic,
    background: input.background,
    taxonomyContext:
      input.taxonomyContext +
      input.commitmentContext +
      input.establishedPoints +
      input.edgeContext +
      input.concessionHint,
    recentTranscript: input.recentTranscript,
    focusPoint: input.focusPoint,
    addressing: input.addressing,
    phase: input.phase,
    priorMoves: input.priorMoves,
    turnsSinceLastConcession: input.turnsSinceLastConcession,
    priorRefs: input.priorRefs,
    availablePovNodeIds: input.availablePovNodeIds,
    crossPovNodeIds: input.crossPovNodeIds,
    priorFlaggedHints: input.priorFlaggedHints,
    sourceContent: input.sourceContent,
    documentAnalysis: input.documentAnalysis,
    audience: input.audience,
    pendingIntervention: input.pendingIntervention,
    phaseContext: input.phaseContext,
    strategicHints: input.strategicHints,
    strongFoundations: input.strongFoundations,
    avoidClaims: input.avoidClaims,
    preserveConcessions: input.preserveConcessions,
    vocabularyExclusion: input.vocabularyExclusion,
    priorCruxContext: input.priorCruxContext,
    currentCruxContext: input.currentCruxContext,
    explorationPriming: input.explorationPriming,
    useBackgroundPrompt: input.useBackgroundPrompt,
    topicScope: input.topicScope,
    topicStructure: input.topicStructure,
    salienceBeacon: input.salienceBeacon,
  };
}

export function parseStageResponse<T>(raw: string, stage: TurnStageId): { product: T; error?: string } {
  try {
    const parsed = parseJsonRobust(raw) as T;
    return { product: parsed };
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'turn-pipeline', level: 'warn', message: `${stage} stage JSON parse failed`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    return {
      product: {} as T,
      error: `${stage} stage parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Provenance tagging ──────────────────────────────────

/** Stamp provenance metadata onto a parsed work product. */
export function tagProvenance<T>(
  product: T,
  prov: StageProvenance,
): T {
  (product as Record<string, unknown>)._provenance = prov;
  return product;
}

/** Serialize a work product to JSON for downstream prompt injection, stripping _provenance. */
export function toPromptJson(product: unknown): string {
  return JSON.stringify(product, (key, value) => key === '_provenance' ? undefined : value, 2);
}
