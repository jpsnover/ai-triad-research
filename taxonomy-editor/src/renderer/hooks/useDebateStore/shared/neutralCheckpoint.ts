// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { TaxonomyRef } from '../../../types/debate';
import type { DebateStore } from '../types';
import type { SpeakerMapping } from '@lib/debate/neutralEvaluator';
import { runNeutralEvaluation, buildSpeakerMapping } from '@lib/debate/neutralEvaluator';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { getConfiguredModel } from './modelConfig';
import { phaseGuardedSet } from './generation';

// ── Neutral evaluation speaker mapping ──────────────────────────────
let _neutralMapping: SpeakerMapping | null = null;
export function resetNeutralMapping(): void { _neutralMapping = null; }

/** Fire-and-forget neutral evaluation at a checkpoint. Non-blocking, never throws. */
export async function runNeutralCheckpoint(
  checkpoint: 'baseline' | 'midpoint' | 'final',
  get: () => DebateStore,
  set: (partial: Partial<DebateStore>) => void,
  addTranscriptEntry: (entry: { type: string; speaker: string; content: string; taxonomy_refs: TaxonomyRef[]; metadata?: Record<string, unknown> }) => string,
): Promise<void> {
  try {
    const debate = get().activeDebate;
    if (!debate) return;

    if (!_neutralMapping) {
      _neutralMapping = buildSpeakerMapping(debate.active_povers);
    }

    const model = getConfiguredModel();
    const adapter = {
      generateText: async (prompt: string, m: string, opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number }) => {
        const result = await api.generateText(prompt, m, opts?.timeoutMs, opts?.temperature);
        return result.text;
      },
    };

    const evaluation = await runNeutralEvaluation(checkpoint, {
      adapter,
      topic: debate.topic.final || debate.topic.original,
      transcript: debate.transcript,
      contextSummaries: debate.context_summaries,
      activePovers: debate.active_povers,
      model,
      speakerMapping: _neutralMapping,
    });

    // Store on session (phase-guarded to prevent clobbering 'closed' phase)
    const freshDebate = get().activeDebate;
    if (!freshDebate) return;
    const existing = freshDebate.neutral_evaluations ?? [];
    phaseGuardedSet(get, set, {
      neutral_evaluations: [...existing, evaluation],
      neutral_speaker_mapping: _neutralMapping!,
    });

    // Add transcript entry for visibility
    const cruxCount = evaluation.cruxes?.length ?? 0;
    const claimCount = evaluation.claims?.length ?? 0;
    const notes = evaluation.overall_assessment?.notes ?? '';
    addTranscriptEntry({
      type: 'system',
      speaker: 'system',
      content: `[Neutral evaluation: ${checkpoint}] ${cruxCount} cruxes, ${claimCount} claims evaluated. ${notes}`,
      taxonomy_refs: [],
      metadata: { neutral_checkpoint: checkpoint },
    });

    getGlobalRecorder()?.record({ type: 'state.change', debate_id: debate?.id, component: 'neutral-eval', level: 'info', message: `neutral.${checkpoint}`, data: { cruxes: cruxCount, claims: claimCount, engaging: evaluation.overall_assessment?.debate_is_engaging_real_disagreement } });
  } catch (err) {
    console.warn(`[Neutral Eval] ${checkpoint} failed (non-blocking):`, err);
    getGlobalRecorder()?.record({ type: 'state.error', component: 'neutral-eval', level: 'warn', message: `neutral.${checkpoint}.failed`, data: { error: String(err) } });
  }
}
