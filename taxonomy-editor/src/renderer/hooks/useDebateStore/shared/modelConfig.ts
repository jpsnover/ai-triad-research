// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useDebateStore } from '../store';
import { useTaxonomyStore } from '../../useTaxonomyStore';
import { DEFAULT_MODEL } from '@lib/ai-client/defaults';
import { resolveBackend } from '@lib/ai-client/registry';
import type { ModelRegistry } from '@lib/ai-client/registry';
import aiModelsRegistry from '../../../../../../ai-models.json';

const registry = aiModelsRegistry as unknown as ModelRegistry;

export function getSpeakerModel(activeDebate: { speaker_models?: Record<string, string> } | null, speaker: string, fallbackModel: string): string {
  return activeDebate?.speaker_models?.[speaker] || fallbackModel;
}

/** Resolve the model a speaker's brief stage actually runs with — and thus the model the
 *  brief-timeout toast/dialog must display (t/2504). Mirrors the pipeline's
 *  `input.briefModel ?? input.model` (turnPipeline/runTurn.ts): the stage-level brief override
 *  wins, else the speaker's model (speaker_models override, else the base fallback). Keep in
 *  sync with the OpeningPipelineInput built at the emit site (clarificationSlice.ts). */
export function resolveBriefModel(
  activeDebate: { stage_models?: Record<string, string>; speaker_models?: Record<string, string> } | null,
  speaker: string,
  fallbackModel: string,
): string {
  return activeDebate?.stage_models?.brief || getSpeakerModel(activeDebate, speaker, fallbackModel);
}

/** Resolve the fast/cheap model for a scored-but-non-debate call (topic critique, t/3722) —
 *  never the heavy reasoning model the debate itself uses. Measured live (grok-4.7 vs
 *  gemini-3.5-flash-lite): 34-93s -> 2.4-3.0s end-to-end, same parseable output shape
 *  (rating/composite_score/issues/rewritten_topic all present).
 *
 *  Priority: the configured model's own backend's `debateTiers.basic` entry (so a Claude/Groq
 *  debate stays on a backend it already has a key for) — else `debateTiers.basic.gemini`.
 *  The Gemini fallback is safe even for an xai-only debate (xai has no fast model in the
 *  registry at all, only frontier Grok variants): `runTopicCritique`/`reEvaluateSuggestedTopic`
 *  already call `api.computeQueryEmbedding`/`computeEmbeddings` unconditionally on every run
 *  regardless of the debate's configured model, so a Gemini key is already a hard dependency
 *  of this call path before this function ever runs — this doesn't add a new one. Final
 *  fallback is the configured model itself, so this can never fail open to nothing. */
export function getCritiqueModel(configuredModel: string): string {
  const backend = resolveBackend(configuredModel);
  return registry.debateTiers?.basic?.[backend] || registry.debateTiers?.basic?.gemini || configuredModel;
}

/** Read the model for the current debate context.
 *  Priority: debate-specific override > global Settings model > default */
export function getConfiguredModel(): string {
  // Check debate-specific model first (set when the user picks a custom model in the New Debate dialog)
  const debateModel = useDebateStore.getState().debateModel;
  if (debateModel) {
    console.log(`[model] Using debate-specific model: ${debateModel}`);
    return debateModel;
  }
  // Re-derive from the current in-memory global AI setting each time — never rely on a
  // localStorage read here, which can be stale when the previous debate used a different
  // model that wasn't reflected in the new debate's creation context (t/2213).
  const globalModel = useTaxonomyStore.getState().geminiModel || DEFAULT_MODEL;
  console.log(`[model] Using global model: ${globalModel}`);
  return globalModel;
}
