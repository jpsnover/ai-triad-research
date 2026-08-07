// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useDebateStore } from '../store';
import { useTaxonomyStore } from '../../useTaxonomyStore';
import { DEFAULT_MODEL } from '@lib/ai-client/defaults';

export function getSpeakerModel(activeDebate: { speaker_models?: Record<string, string> } | null, speaker: string, fallbackModel: string): string {
  return activeDebate?.speaker_models?.[speaker] || fallbackModel;
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
