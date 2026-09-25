// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// t/3677 Phase 1 (log-only capture). Two properties:
//  1. Each adapter surfaces the PROVIDER-reported served id on ProviderResult, and leaves it
//     `undefined` (NOT an echo of the sent id) when the response carries none — the no-fabrication rule.
//  2. `callProvider` — the one seam both runtimes traverse — emits exactly ONE `ai.model_identity`
//     `info` event per call with `{backend, requested, apiModelIdSent, providerReported}`, and NEVER a
//     `warn`. Phase 1 is capture-only; the warn-on-divergence classifier is deferred to Phase 2/3
//     (calibrate on observed data + registry cross-check — t/3677#5). These tests would fail the moment
//     a divergence classifier is added here, which is the intended guard for the phasing.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FetchFn, GenerateOptions } from './types.js';
import { callProvider } from './client.js';
import { generateViaGemini } from './providers/gemini.js';
import { generateViaClaude } from './providers/claude.js';
import { generateViaGroq } from './providers/groq.js';
import { generateViaOpenAI } from './providers/openai.js';
import { FlightRecorder } from '../flight-recorder/flightRecorder.js';
import { setGlobalRecorder, clearGlobalRecorder } from '../flight-recorder/index.js';

function jsonFetch(body: unknown): FetchFn {
  return async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body), body: null } as unknown as Response);
}
const OPTS: GenerateOptions = { timeoutMs: 30_000 };

describe('t/3677 Phase 1 — adapters surface provider-reported served identity', () => {
  it('gemini reads modelVersion', async () => {
    const r = await generateViaGemini(
      jsonFetch({ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }], modelVersion: 'gemini-3.5-flash-lite-preview-05-2026' }),
      'p', 'gemini-3.5-flash-lite', 'k', OPTS);
    expect(r.providerReportedModel).toBe('gemini-3.5-flash-lite-preview-05-2026');
  });

  it('claude reads top-level model', async () => {
    const r = await generateViaClaude(
      jsonFetch({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', model: 'claude-haiku-4-5-20251001', usage: {} }),
      'p', 'claude-haiku-4-5', 'k', OPTS);
    expect(r.providerReportedModel).toBe('claude-haiku-4-5-20251001');
  });

  it('openai-compat (groq) reads response model', async () => {
    const r = await generateViaGroq(
      jsonFetch({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }], model: 'llama-3.3-70b-versatile', usage: {} }),
      'p', 'groq-llama-3.3-70b-versatile', 'k', OPTS);
    expect(r.providerReportedModel).toBe('llama-3.3-70b-versatile');
  });

  it('openai (Responses API) reads response model', async () => {
    const r = await generateViaOpenAI(
      jsonFetch({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }], status: 'completed', model: 'gpt-4o-2024-08-06', usage: {} }),
      'p', 'gpt-4o', 'k', OPTS);
    expect(r.providerReportedModel).toBe('gpt-4o-2024-08-06');
  });

  it('NO FABRICATION: absent served field yields undefined, not the sent id', async () => {
    const r = await generateViaGemini(
      jsonFetch({ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] /* no modelVersion */ }),
      'p', 'gemini-3.5-flash-lite', 'k', OPTS);
    expect(r.providerReportedModel).toBeUndefined();
  });
});

describe('t/3677 Phase 1 — callProvider emits one ai.model_identity info event (log-only, no classifier)', () => {
  let recorder: FlightRecorder;
  beforeEach(() => { recorder = new FlightRecorder({ capacity: 64 }); setGlobalRecorder(recorder); });
  afterEach(() => { clearGlobalRecorder(); });

  it('emits {backend, requested, apiModelIdSent, providerReported} at info; never warn', async () => {
    const body = { content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', model: 'claude-haiku-4-5-20251001', usage: {} };
    await callProvider(jsonFetch(body), 'claude', 'p', 'claude-haiku-4-5', 'k', { timeoutMs: 30_000, requestedModelId: 'claude-haiku-4-5' });
    const all = recorder.buffer.drain();
    const ident = all.filter(e => e.type === 'ai.model_identity');
    expect(ident).toHaveLength(1);
    expect(ident[0].level).toBe('info');
    expect(ident[0].data).toMatchObject({
      backend: 'claude',
      requested: 'claude-haiku-4-5',
      apiModelIdSent: 'claude-haiku-4-5',
      providerReported: 'claude-haiku-4-5-20251001',
    });
    // Phase 1 is log-only — NO divergence classification, so nothing warns (guards the phasing).
    expect(all.filter(e => e.level === 'warn')).toHaveLength(0);
  });

  it('undefined served id still emits ONE info event (the "unknown" state), never warn', async () => {
    const body = { candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] }; // gemini, no modelVersion
    await callProvider(jsonFetch(body), 'gemini', 'p', 'gemini-3.5-flash-lite', 'k', { timeoutMs: 30_000, requestedModelId: 'gemini-3.5-flash-lite' });
    const all = recorder.buffer.drain();
    const ident = all.filter(e => e.type === 'ai.model_identity');
    expect(ident).toHaveLength(1);
    expect(ident[0].level).toBe('info');
    expect((ident[0].data as { providerReported?: string }).providerReported).toBeUndefined();
    expect(all.filter(e => e.level === 'warn')).toHaveLength(0);
  });
});
