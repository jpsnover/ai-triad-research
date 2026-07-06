// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useDebateStore } from '../store';
import { DEFAULT_MODEL } from '@lib/ai-client/defaults';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

export function getSpeakerModel(activeDebate: { speaker_models?: Record<string, string> } | null, speaker: string, fallbackModel: string): string {
  return activeDebate?.speaker_models?.[speaker] || fallbackModel;
}

/** Read the model for the current debate context.
 *  Priority: debate-specific override > global Settings model > default */
export function getConfiguredModel(): string {
  // Check debate-specific model first
  const debateModel = useDebateStore.getState().debateModel;
  if (debateModel) {
    console.log(`[model] Using debate-specific model: ${debateModel}`);
    return debateModel;
  }
  try {
    const globalModel = localStorage.getItem('taxonomy-editor-gemini-model') || DEFAULT_MODEL;
    console.log(`[model] Using global model: ${globalModel}`);
    return globalModel;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Failed to read configured model from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    return DEFAULT_MODEL;
  }
}
