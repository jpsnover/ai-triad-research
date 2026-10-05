// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3942 — current Claude models 400 on any temperature ("`temperature` is deprecated for this
// model"). The provider retries without it; these lock that the rejection is memoised per model
// (one wasted request per process, not per call), logged once, and that accepting models are untouched.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const record = vi.fn();
vi.mock('../../flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record }) }));

import { generateViaClaude, _resetClaudeSamplingMemoForTests } from './claude.js';
import type { FetchFn } from '../types.js';

const OK_BODY = JSON.stringify({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', model: 'm' });
const REJECT_BODY = JSON.stringify({
  type: 'error',
  error: { type: 'invalid_request_error', message: '`temperature` is deprecated for this model.' },
});

function respond(status: number, bodyText: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => bodyText, body: null } as unknown as Response;
}

/** Fetch that rejects any body carrying temperature (rejecting model) or accepts all (accepting model). */
function makeFetch(rejectsTemperature: boolean) {
  const bodies: Record<string, unknown>[] = [];
  const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return rejectsTemperature && body.temperature != null ? respond(400, REJECT_BODY) : respond(200, OK_BODY);
  });
  return { fetchFn: fetchFn as unknown as FetchFn, bodies };
}

const call = (fetchFn: FetchFn, model: string) =>
  generateViaClaude(fetchFn, 'p', model, 'key', { timeoutMs: 5000, temperature: 0.7 });

describe('generateViaClaude — sampling-rejection memo (t/3942)', () => {
  beforeEach(() => {
    _resetClaudeSamplingMemoForTests();
    record.mockClear();
  });

  it('rejecting model: first call retries once, later calls make exactly one request without temperature', async () => {
    const { fetchFn, bodies } = makeFetch(true);
    await call(fetchFn, 'claude-sonnet-5');
    expect(bodies).toHaveLength(2);              // rejected + retry
    expect(bodies[0].temperature).toBe(0.7);
    expect(bodies[1].temperature).toBeUndefined();

    await call(fetchFn, 'claude-sonnet-5');
    await call(fetchFn, 'claude-sonnet-5');
    expect(bodies).toHaveLength(4);              // one request per later call
    expect(bodies[2].temperature).toBeUndefined();
    expect(bodies[3].temperature).toBeUndefined();
  });

  it('logs exactly one WARN naming the model and the dropped value', async () => {
    const { fetchFn } = makeFetch(true);
    await call(fetchFn, 'claude-opus-5');
    await call(fetchFn, 'claude-opus-5');
    expect(record).toHaveBeenCalledTimes(1);
    const evt = record.mock.calls[0][0] as { type: string; level: string; message: string };
    expect(evt.type).toBe('ai.fallback');
    expect(evt.level).toBe('warn');
    expect(evt.message).toContain('claude-opus-5');
    expect(evt.message).toContain('temperature=0.7');
  });

  it('memo is per model: a rejection on one model does not strip temperature from another', async () => {
    const rej = makeFetch(true);
    await call(rej.fetchFn, 'claude-opus-5');
    const acc = makeFetch(false);
    await call(acc.fetchFn, 'claude-haiku-4-5-20251001');
    expect(acc.bodies).toHaveLength(1);
    expect(acc.bodies[0].temperature).toBe(0.7);
  });

  it('refusal: a Claude stop_reason "refusal" surfaces as content_filter (not a silent "other")', async () => {
    const refusal = JSON.stringify({ content: [{ type: 'text', text: '' }], stop_reason: 'refusal', model: 'm' });
    const fetchFn = (async () => respond(200, refusal)) as unknown as FetchFn;
    const r = await generateViaClaude(fetchFn, 'p', 'claude-sonnet-5-5', 'key', { timeoutMs: 5000 });
    expect(r.stopReason).toBe('content_filter');
    expect(r.rawStopReason).toBe('refusal');
  });

  it('refusal with NO content blocks still returns content_filter instead of throwing "No content"', async () => {
    const refusal = JSON.stringify({ content: [], stop_reason: 'refusal', model: 'm' });
    const fetchFn = (async () => respond(200, refusal)) as unknown as FetchFn;
    const r = await generateViaClaude(fetchFn, 'p', 'claude-sonnet-5-5', 'key', { timeoutMs: 5000 });
    expect(r.stopReason).toBe('content_filter');
    expect(r.text).toBe('');
  });

  it('empty content WITHOUT a refusal still throws (the "No content" guard stays narrow)', async () => {
    const empty = JSON.stringify({ content: [], stop_reason: 'end_turn', model: 'm' });
    const fetchFn = (async () => respond(200, empty)) as unknown as FetchFn;
    await expect(generateViaClaude(fetchFn, 'p', 'claude-sonnet-5-5', 'key', { timeoutMs: 5000 }))
      .rejects.toThrow(/No content/);
  });

  it('refusal other arm: end_turn still normalizes to stop', async () => {
    const fetchFn = (async () => respond(200, OK_BODY)) as unknown as FetchFn;
    const r = await generateViaClaude(fetchFn, 'p', 'claude-sonnet-5-5', 'key', { timeoutMs: 5000 });
    expect(r.stopReason).toBe('stop');
  });

  it('accepting model: temperature sent on every call, one request each, no WARN', async () => {
    const { fetchFn, bodies } = makeFetch(false);
    await call(fetchFn, 'claude-sonnet-4-6');
    await call(fetchFn, 'claude-sonnet-4-6');
    expect(bodies).toHaveLength(2);
    expect(bodies.every(b => b.temperature === 0.7)).toBe(true);
    expect(record).not.toHaveBeenCalled();
  });
});
