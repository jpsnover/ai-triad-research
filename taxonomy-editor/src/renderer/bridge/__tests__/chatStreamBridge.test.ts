// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment jsdom

// Web-bridge startChatStream (t/2462) — SSE parsing + dispatch against the t/2457
// POST /api/ai/chat-stream contract, shape-identical to the Electron preload surface.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResilientFetch = vi.fn<(path: string, init: RequestInit, opts: unknown) => Promise<Response>>();

vi.mock('../resilience', () => ({
  resilientFetch: (...args: unknown[]) => mockResilientFetch(args[0] as string, args[1] as RequestInit, args[2]),
  categorizeEndpoint: () => 'ai',
  registerConnectionPoolProvider: vi.fn(),
  getResilienceState: vi.fn(),
  subscribeResilience: vi.fn(),
  resetResilience: vi.fn(),
}));

vi.mock('@lib/debate/errors', () => ({
  ActionableError: class ActionableError extends Error {
    goal: string; problem: string; location: string; nextSteps: string[]; httpStatus?: number;
    constructor(opts: { goal: string; problem: string; location: string; nextSteps: string[] }) {
      super(opts.problem);
      this.name = 'ActionableError';
      this.goal = opts.goal; this.problem = opts.problem; this.location = opts.location; this.nextSteps = opts.nextSteps;
    }
  },
}));

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('../instrumentBridge', () => ({ instrumentBridge: (raw: unknown) => raw }));
vi.mock('../../utils/keyShareCrypto', () => ({ encryptKeysForSharing: vi.fn(), decryptKeysFromSharing: vi.fn() }));
const mockQuotaMilestone = vi.fn();
vi.mock('../../hooks/useQuotaWarning', () => ({ onQuotaMilestone: (...a: unknown[]) => mockQuotaMilestone(...a) }));

vi.stubGlobal('fetch', vi.fn());

import { api } from '../web-bridge';

/** A real streaming SSE Response. `chunks` are enqueued in order so buffer-splitting across
 *  network reads is exercised (a single frame may span two enqueues). */
function sseResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

function frame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function jsonErrorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const MSGS = [{ role: 'user' as const, content: 'hello' }];

beforeEach(() => {
  mockResilientFetch.mockReset();
  mockQuotaMilestone.mockReset();
  sessionStorage.clear();
});

describe('web-bridge startChatStream — SSE happy path (t/2462)', () => {
  it('emits each chunk to onChatStreamChunk, returns accumulated fullText, fires onChatStreamDone', async () => {
    mockResilientFetch.mockResolvedValue(sseResponse([
      frame({ type: 'chunk', text: 'Hel' }),
      frame({ type: 'chunk', text: 'lo!' }),
      frame({ type: 'done', fullText: 'Hello!' }),
    ]));
    const chunks: string[] = [];
    const done: string[] = [];
    const offChunk = api.onChatStreamChunk((c) => chunks.push(c));
    const offDone = api.onChatStreamDone((f) => done.push(f));

    const result = await api.startChatStream('sys', MSGS, 'gemini-2.5-flash', 0.5, false);

    expect(chunks).toEqual(['Hel', 'lo!']);
    expect(result).toBe('Hello!');
    expect(done).toEqual(['Hello!']);
    offChunk(); offDone();
  });

  it('handles a frame split across two network reads', async () => {
    mockResilientFetch.mockResolvedValue(sseResponse([
      'data: {"type":"chunk","tex',
      't":"split"}\n\ndata: {"type":"done","fullText":"split"}\n\n',
    ]));
    const chunks: string[] = [];
    const off = api.onChatStreamChunk((c) => chunks.push(c));
    const result = await api.startChatStream('sys', MSGS);
    expect(chunks).toEqual(['split']);
    expect(result).toBe('split');
    off();
  });

  it('surfaces url_context metadata to onChatStreamUrlMetadata before done', async () => {
    const meta = { url_metadata: [{ retrieved_url: 'https://x.test', url_retrieval_status: 'SUCCESS' }] };
    mockResilientFetch.mockResolvedValue(sseResponse([
      frame({ type: 'chunk', text: 'grounded' }),
      frame({ type: 'chat-stream-url-metadata', urlContextMetadata: meta }),
      frame({ type: 'done', fullText: 'grounded' }),
    ]));
    const received: unknown[] = [];
    const off = api.onChatStreamUrlMetadata?.((m) => received.push(m)) ?? (() => {});
    await api.startChatStream('sys', MSGS, undefined, undefined, true);
    expect(received).toEqual([meta]);
    off();
  });
});

describe('web-bridge startChatStream — request shaping (t/2462)', () => {
  it('threads urlContext, messages, model, temperature, and BYOK key into the request body', async () => {
    sessionStorage.setItem('byok-api-key', 'user-key-123');
    mockResilientFetch.mockResolvedValue(sseResponse([frame({ type: 'done', fullText: '' })]));

    await api.startChatStream('my-sys', MSGS, 'gemini-2.5-pro', 0.9, true);

    const [path, init, opts] = mockResilientFetch.mock.calls[0];
    expect(path).toBe('/api/ai/chat-stream');
    expect(init.method).toBe('POST');
    expect((opts as { maxRetries: number }).maxRetries).toBe(0); // never auto-retry a POST mutation
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      systemInstruction: 'my-sys', model: 'gemini-2.5-pro', temperature: 0.9, urlContext: true, apiKey: 'user-key-123',
    });
    expect(body.messages).toEqual(MSGS);
  });

  it('omits apiKey when no BYOK key is stored and defaults urlContext to false', async () => {
    mockResilientFetch.mockResolvedValue(sseResponse([frame({ type: 'done', fullText: '' })]));
    await api.startChatStream('sys', MSGS);
    const body = JSON.parse(mockResilientFetch.mock.calls[0][1].body as string);
    expect(body.apiKey).toBeUndefined();
    expect(body.urlContext).toBe(false);
  });
});

describe('web-bridge startChatStream — error paths (t/2462)', () => {
  it('rejects and fires onChatStreamError on an SSE error event', async () => {
    mockResilientFetch.mockResolvedValue(sseResponse([
      frame({ type: 'chunk', text: 'partial' }),
      frame({ type: 'error', message: 'model exploded', code: 'STREAM_ERROR' }),
    ]));
    const errors: string[] = [];
    const off = api.onChatStreamError((e) => errors.push(e));
    await expect(api.startChatStream('sys', MSGS)).rejects.toThrow('model exploded');
    expect(errors).toEqual(['model exploded']);
    off();
  });

  it('normalizes a non-200 JSON error (429) into a rejection + onChatStreamError, and fires quota milestone', async () => {
    mockResilientFetch.mockResolvedValue(
      jsonErrorResponse(429, { error: 'Daily token limit exceeded', limitType: 'tokens_per_day' }),
    );
    const errors: string[] = [];
    const off = api.onChatStreamError((e) => errors.push(e));
    await expect(api.startChatStream('sys', MSGS)).rejects.toThrow(/Daily token limit/i);
    expect(errors).toHaveLength(1);
    expect(mockQuotaMilestone).toHaveBeenCalledWith(100, undefined);
    off();
  });

  it('unsubscribe removes a chunk listener', async () => {
    mockResilientFetch.mockResolvedValue(sseResponse([
      frame({ type: 'chunk', text: 'x' }),
      frame({ type: 'done', fullText: 'x' }),
    ]));
    const seen: string[] = [];
    const off = api.onChatStreamChunk((c) => seen.push(c));
    off(); // unsubscribe before streaming
    await api.startChatStream('sys', MSGS);
    expect(seen).toEqual([]);
  });
});
