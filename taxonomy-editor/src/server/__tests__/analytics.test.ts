// @vitest-environment node

/**
 * Analytics aggregation — focuses on the additive fields requested by Analysis
 * (p/81#8) for cards t/891 (eventTypes) and t/892 (aiCost).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initAnalytics, appendEvents, queryAggregated, type AnalyticsEvent } from '../analytics.js';

let dataRoot: string;
const D = '2026-06-20';

function evt(partial: Partial<AnalyticsEvent>): AnalyticsEvent {
  return {
    user: 'a', session_id: 's1', timestamp: `${D}T10:00:00.000Z`,
    event_type: 'x', category: 'misc', detail: {}, ...partial,
  };
}

describe('queryAggregated eventTypes + aiCost (p/81#8)', () => {
  beforeEach(async () => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-'));
    await initAnalytics(dataRoot);
  });
  afterEach(() => { fs.rmSync(dataRoot, { recursive: true, force: true }); });

  it('counts event types and sums ai.call cost with a per-model breakdown', async () => {
    await appendEvents([
      evt({ event_type: 'debate.complete', category: 'debate' }),
      evt({ event_type: 'debate.abandon', category: 'debate' }),
      evt({ event_type: 'ai.call', category: 'ai', detail: { tokens_in: 100, tokens_out: 50, estimated_cost_usd: 0.001, model: 'gemini-flash' } }),
      evt({ user: 'b', session_id: 's2', event_type: 'ai.call', category: 'ai', detail: { tokens_in: 200, tokens_out: 80, estimated_cost_usd: 0.002, model: 'gemini-flash' } }),
      evt({ user: 'b', session_id: 's2', event_type: 'ai.call', category: 'ai', detail: { tokens_in: 10, tokens_out: 5, estimated_cost_usd: 0.0005, model: 'claude' } }),
    ]);

    const r = await queryAggregated(D, D);

    expect(r.eventTypes['debate.complete']).toBe(1);
    expect(r.eventTypes['debate.abandon']).toBe(1);
    expect(r.eventTypes['ai.call']).toBe(3);

    expect(r.aiCost.calls).toBe(3);
    expect(r.aiCost.tokensIn).toBe(310);
    expect(r.aiCost.tokensOut).toBe(135);
    expect(r.aiCost.costUsd).toBeCloseTo(0.0035, 6);
    expect(r.aiCost.byModel['gemini-flash']).toEqual({ calls: 2, tokensIn: 300, tokensOut: 130, costUsd: 0.003 });
    expect(r.aiCost.byModel['claude']).toEqual({ calls: 1, tokensIn: 10, tokensOut: 5, costUsd: 0.0005 });
  });

  it('treats missing ai.call detail fields as 0 / "unknown" model', async () => {
    await appendEvents([evt({ event_type: 'ai.call', category: 'ai', detail: {} })]);
    const r = await queryAggregated(D, D);
    expect(r.aiCost).toMatchObject({ calls: 1, tokensIn: 0, tokensOut: 0, costUsd: 0 });
    expect(r.aiCost.byModel['unknown']).toEqual({ calls: 1, tokensIn: 0, tokensOut: 0, costUsd: 0 });
  });

  it('returns empty/zeroed additive fields when there are no events', async () => {
    const r = await queryAggregated(D, D);
    expect(r.eventTypes).toEqual({});
    expect(r.aiCost).toEqual({ calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, byModel: {} });
  });
});
