// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { runOpeningPipeline } from './turnPipeline.js';
import type { OpeningPipelineInput, BriefEventFn } from './turnPipeline.js';
import type { StageGenerateFn } from './turnPipeline/types.js';

// ── Minimal fixture ─────────────────────────────────────────

const INPUT: OpeningPipelineInput = {
  label: 'Accelerationist',
  pov: 'acc',
  personality: 'optimist',
  topic: 'Is AI good?',
  taxonomyContext: '',
  priorStatements: '',
  isFirst: true,
  model: 'test-model',
  briefTimeoutMs: 200,
  briefMaxRetries: 2,
};

// Stage-appropriate minimal JSON responses
const STAGE_RESPONSES: Record<string, string> = {
  brief: JSON.stringify({ claim_sketches: [], situation_assessment: 'ok', prior_context_summary: '' }),
  plan: JSON.stringify({ framing_choices: [], argument_skeleton: [] }),
  draft: JSON.stringify({ statement: 'Test statement.', key_assumptions: [], claim_sketches: [] }),
  cite: JSON.stringify({ taxonomy_refs: [], policy_refs: [] }),
};

function stageKey(label: string): string {
  for (const key of Object.keys(STAGE_RESPONSES)) {
    if (label.includes(key)) return key;
  }
  return 'draft';
}

// ── Tests ───────────────────────────────────────────────────

describe('runOpeningPipeline — brief timeout events', () => {
  it('emits brief.timeout and brief.retrying when first brief call times out, then succeeds on retry', async () => {
    let briefCalls = 0;
    const generate: StageGenerateFn = async (_prompt, _model, _opts, label) => {
      if (label.includes('brief')) {
        briefCalls++;
        if (briefCalls === 1) {
          throw new DOMException('The operation was aborted', 'AbortError');
        }
      }
      return STAGE_RESPONSES[stageKey(label)];
    };

    const events: Array<{ phase: string; data: unknown }> = [];
    const onBriefEvent: BriefEventFn = (phase, data) => events.push({ phase, data });

    await runOpeningPipeline(INPUT, generate, undefined, onBriefEvent);

    const phases = events.map(e => e.phase);
    expect(phases).toContain('brief.timeout');
    expect(phases).toContain('brief.retrying');
    expect(phases).not.toContain('brief.retries_exhausted');

    const timeoutEvent = events.find(e => e.phase === 'brief.timeout')!;
    const data = timeoutEvent.data as { agent: string; attempt: number; maxRetries: number; elapsedMs: number };
    expect(data.agent).toBe('Accelerationist');
    expect(data.attempt).toBe(0);
    expect(data.maxRetries).toBe(2);
    expect(data.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('emits brief.retries_exhausted and rethrows when all timeout retries fail', async () => {
    const generate: StageGenerateFn = async (_prompt, _model, _opts, label) => {
      if (label.includes('brief')) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      return STAGE_RESPONSES[stageKey(label)];
    };

    const events: Array<{ phase: string; data: unknown }> = [];
    const onBriefEvent: BriefEventFn = (phase, data) => events.push({ phase, data });

    await expect(
      runOpeningPipeline(INPUT, generate, undefined, onBriefEvent),
    ).rejects.toThrow();

    const phases = events.map(e => e.phase);
    // 3 attempts (0, 1, 2) each emit brief.timeout
    expect(events.filter(e => e.phase === 'brief.timeout')).toHaveLength(3);
    // 2 retrying events (after attempt 0 and 1)
    expect(events.filter(e => e.phase === 'brief.retrying')).toHaveLength(2);
    expect(phases).toContain('brief.retries_exhausted');
  });

  it('does not emit brief timeout events on clean brief call', async () => {
    const generate: StageGenerateFn = async (_prompt, _model, _opts, label) =>
      STAGE_RESPONSES[stageKey(label)];

    const events: Array<{ phase: string }> = [];
    const onBriefEvent: BriefEventFn = (phase) => events.push({ phase });

    await runOpeningPipeline(INPUT, generate, undefined, onBriefEvent);

    expect(events).toHaveLength(0);
  });

  it('forwards briefTimeoutMs to the generate call options', async () => {
    const seenTimeouts: (number | undefined)[] = [];
    const generate: StageGenerateFn = async (_prompt, _model, opts, label) => {
      if (label.includes('brief')) seenTimeouts.push(opts.timeoutMs);
      return STAGE_RESPONSES[stageKey(label)];
    };

    await runOpeningPipeline({ ...INPUT, briefTimeoutMs: 5_000 }, generate, undefined, undefined);

    expect(seenTimeouts[0]).toBe(5_000);
  });
});
