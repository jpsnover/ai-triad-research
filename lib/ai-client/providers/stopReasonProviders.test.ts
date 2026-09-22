// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// t/3525 SO condition 4: per-provider both-arm fixtures. For EACH adapter a truncated response must
// yield stopReason 'max_tokens' and a normal one 'stop' — the mapping IS the feature, and an adapter
// that silently returns undefined reproduces the original silent-drop class. rawStopReason is asserted
// alongside so the FR-diagnostic passenger is proven wired too. Streaming adapters (gemini, deepseek)
// are the two extra parse sites and get their own SSE-body cases.
import { describe, it, expect, beforeAll } from 'vitest';
import type { FetchFn, ProviderResult } from '../types.js';
import { generateViaClaude } from './claude.js';
import { generateViaGemini, generateViaGeminiStream } from './gemini.js';
import { generateViaOpenAI } from './openai.js';
import { generateViaGroq } from './groq.js';
import { generateViaAzure } from './azure.js';
import { generateViaDeepSeek, generateViaDeepSeekStream } from './deepseek.js';
import { generateViaOllama } from './ollama.js';
import { generateViaZai } from './zai.js';
import { generateViaMoonshot } from './moonshot.js';
import { generateViaXai } from './xai.js';

type Gen = (fetchFn: FetchFn, prompt: string, model: string, key: string, opts: { timeoutMs: number }) => Promise<ProviderResult>;

function jsonFetch(body: unknown): FetchFn {
  return async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body), body: null } as unknown as Response);
}

// Chat-completions body: choices[0].message.content + finish_reason.
const cc = (finish: string) => ({ choices: [{ message: { content: 'hi' }, finish_reason: finish }], usage: {} });

interface Case {
  name: string;
  fn: Gen;
  truncated: unknown; truncatedRaw: string;
  normal: unknown;    normalRaw: string;
}

const CHAT_FAMILY: [string, Gen][] = [
  ['groq', generateViaGroq],
  ['azure', generateViaAzure],
  ['deepseek', generateViaDeepSeek],
  ['ollama', generateViaOllama],
  ['zai', generateViaZai],
  ['moonshot', generateViaMoonshot],
  ['xai', generateViaXai],
];

const CASES: Case[] = [
  {
    name: 'claude', fn: generateViaClaude,
    truncated: { content: [{ type: 'text', text: 'hi' }], stop_reason: 'max_tokens', usage: {} }, truncatedRaw: 'max_tokens',
    normal:    { content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: {} },   normalRaw: 'end_turn',
  },
  {
    name: 'gemini', fn: generateViaGemini,
    truncated: { candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'MAX_TOKENS' }] }, truncatedRaw: 'MAX_TOKENS',
    normal:    { candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] },       normalRaw: 'STOP',
  },
  {
    name: 'openai', fn: generateViaOpenAI,
    truncated: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }], status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: {} }, truncatedRaw: 'max_output_tokens',
    normal:    { output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }], status: 'completed', usage: {} }, normalRaw: 'completed',
  },
  ...CHAT_FAMILY.map(([name, fn]): Case => ({
    name, fn,
    truncated: cc('length'), truncatedRaw: 'length',
    normal:    cc('stop'),   normalRaw: 'stop',
  })),
];

describe('stopReason — per-provider both-arm parse (t/3525)', () => {
  beforeAll(() => { process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com'; });

  for (const c of CASES) {
    it(`${c.name}: truncated → 'max_tokens' (raw "${c.truncatedRaw}")`, async () => {
      const r = await c.fn(jsonFetch(c.truncated), 'p', 'm', 'k', { timeoutMs: 5000 });
      expect(r.stopReason).toBe('max_tokens');
      expect(r.rawStopReason).toBe(c.truncatedRaw);
    });
    it(`${c.name}: normal → 'stop' (raw "${c.normalRaw}")`, async () => {
      const r = await c.fn(jsonFetch(c.normal), 'the-prompt', 'm', 'k', { timeoutMs: 5000 });
      expect(r.stopReason).toBe('stop');
      expect(r.rawStopReason).toBe(c.normalRaw);
      // t/3566: the FR-forensics diagnostics passenger is wired end-to-end through every non-stream
      // adapter — request/response byte sizes and the HTTP status are populated on the ProviderResult.
      expect(r.diagnostics?.requestBytes).toBeGreaterThan(0);
      expect(r.diagnostics?.responseBytes).toBeGreaterThan(0);
      expect(r.diagnostics?.httpStatus).toBe(200);
    });
  }
});

// ── Streaming adapters: the two extra parse sites. finishReason/finish_reason arrives on the final
//    SSE chunk (Gemini can carry MAX_TOKENS with empty parts). ──
function sseFetch(chunks: unknown[]): FetchFn {
  return async () => {
    const encoder = new TextEncoder();
    const data = encoder.encode(chunks.map(c => `data: ${JSON.stringify(c)}\n`).join('\n'));
    let pos = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pos >= data.length) { controller.close(); return; }
        controller.enqueue(data.slice(pos, pos + 64));
        pos += 64;
      },
    });
    return { ok: true, status: 200, body: stream } as unknown as Response;
  };
}

describe('stopReason — streaming parse sites (t/3525)', () => {
  it('gemini stream: final chunk finishReason MAX_TOKENS (empty parts) → max_tokens', async () => {
    const fetchFn = sseFetch([
      { candidates: [{ content: { parts: [{ text: 'hel' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'lo' }] } }] },
      { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }, // empty-parts final chunk
    ]);
    const r = await generateViaGeminiStream(fetchFn, 'p', 'gemini-pro', 'k', { timeoutMs: 5000 });
    expect(r.text).toBe('hello');
    expect(r.stopReason).toBe('max_tokens');
    expect(r.rawStopReason).toBe('MAX_TOKENS');
  });

  it('gemini stream: STOP on final chunk → stop', async () => {
    const fetchFn = sseFetch([
      { candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }] },
    ]);
    const r = await generateViaGeminiStream(fetchFn, 'p', 'gemini-pro', 'k', { timeoutMs: 5000 });
    expect(r.stopReason).toBe('stop');
    expect(r.rawStopReason).toBe('STOP');
  });

  it('deepseek stream: final chunk finish_reason length → max_tokens', async () => {
    const fetchFn = sseFetch([
      { choices: [{ delta: { content: 'par' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'tial' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'length' }], usage: {} },
    ]);
    const r = await generateViaDeepSeekStream(fetchFn, 'p', 'deepseek-chat', 'k', { timeoutMs: 5000 });
    expect(r.text).toBe('partial');
    expect(r.stopReason).toBe('max_tokens');
    expect(r.rawStopReason).toBe('length');
  });

  it('deepseek stream: finish_reason stop → stop', async () => {
    const fetchFn = sseFetch([
      { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }], usage: {} },
    ]);
    const r = await generateViaDeepSeekStream(fetchFn, 'p', 'deepseek-chat', 'k', { timeoutMs: 5000 });
    expect(r.stopReason).toBe('stop');
    expect(r.rawStopReason).toBe('stop');
  });
});
