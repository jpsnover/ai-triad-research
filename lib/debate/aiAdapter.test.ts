// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Tests for the retry, fallback, and timeout logic in aiAdapter.ts
 * (T4 from the 2026-05-01 code review).
 *
 * NOTE: A real bug exists in withRetry's retryable detection:
 *   lower.includes('rate') matches the word "generate" in every
 *   ActionableError Goal ("Generate text via ..."), causing ALL
 *   errors to be treated as retryable. Tests below work with
 *   this behaviour as-is and document it where relevant.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// ── Helpers ───────────────────────────────────────────────

function makeRegistry(overrides: Record<string, unknown> = {}) {
  return {
    backends: [
      { id: 'gemini', label: 'Google Gemini' },
      { id: 'claude', label: 'Anthropic Claude' },
      { id: 'groq', label: 'Groq' },
      { id: 'openai', label: 'OpenAI' },
    ],
    models: [
      { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', backend: 'gemini' },
      { id: 'claude-sonnet-4-5', apiModelId: 'claude-sonnet-4-5', label: 'Sonnet 4.5', backend: 'claude' },
      { id: 'groq-llama-3.3-70b-versatile', apiModelId: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70b', backend: 'groq' },
      { id: 'openai-gpt-5.5', apiModelId: 'gpt-5.5', label: 'GPT-5.5', backend: 'openai' },
    ],
    fallbackChains: {
      'gemini-2.5-flash': ['claude-sonnet-4-5', 'groq-llama-3.3-70b-versatile'],
      'claude-sonnet-4-5': ['gemini-2.5-flash'],
    },
    contextWindows: { gemini: 1048576, claude: 200000, groq: 131072, openai: 131072 },
    ...overrides,
  };
}

/** Build a fresh Response each call so .text() is never double-read. */
function freshResponse(body: object | string, status = 200): Response {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(bodyStr, {
    status,
    headers: { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' },
  });
}

function geminiOkBody(text = 'Hello from Gemini') {
  return {
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  };
}

function claudeOkBody(text = 'Hello from Claude') {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function groqOkBody(text = 'Hello from Groq') {
  return {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function openaiOkBody(text = 'Hello from OpenAI') {
  return {
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  };
}

// ── Mock fs to control registry loading ─────────────────

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

vi.mock('../search/tavily', () => ({
  tavilySearch: vi.fn(),
  buildSearchAugmentedPrompt: vi.fn(),
}));

// ── Setup / teardown ────────────────────────────────────

const savedEnvKeys = ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'AI_API_KEY', 'DEBATE_ENVELOPE'];
const savedEnv: Record<string, string | undefined> = {};
const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

// Suppress unhandled rejections from withTimeout's Promise.race losers.
// When Promise.race settles, the losing timeout promise still rejects,
// causing spurious unhandled rejection warnings in Node.
const suppressedRejections = new Set<Promise<unknown>>();
function onUnhandledRejection(event: PromiseRejectionEvent) {
  // Suppress ActionableError and timeout rejections from retry/timeout logic
  const msg = event.reason instanceof Error ? event.reason.message : String(event.reason);
  if (msg.includes('timed out') || msg.includes('ActionableError') || msg.includes('Goal:')) {
    event.preventDefault();
  }
}

beforeEach(() => {
  // Always use fake timers so retry delays don't block tests
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();

  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(JSON.stringify(makeRegistry()));

  for (const key of savedEnvKeys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  // Suppress dangling rejections from Promise.race in withTimeout
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('unhandledrejection', onUnhandledRejection);
  }
  // Node.js style
  process.on('unhandledRejection', () => {});
});

afterEach(async () => {
  // Run timers one more time to flush any pending retry/timeout callbacks
  await vi.advanceTimersByTimeAsync(300_000);
  await vi.runAllTimersAsync().catch(() => {});

  if (typeof globalThis.removeEventListener === 'function') {
    globalThis.removeEventListener('unhandledrejection', onUnhandledRejection);
  }
  process.removeAllListeners('unhandledRejection');

  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const key of savedEnvKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.resetModules();
});

async function getModule() {
  return await import('./aiAdapter');
}

/**
 * Helper: start an adapter call, advance fake timers past all possible
 * retry delays. Primary: 5+15+45=65s. Each cascade fallback: 5+15=20s.
 * With up to 3 cascades, worst case is ~65s + 3*20s = 125s. We advance
 * 200s total in steps, letting microtasks settle between ticks.
 */
async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
  for (let i = 0; i < 20; i++) {
    await vi.advanceTimersByTimeAsync(10_000);
  }
  return promise;
}

// ══════════════════════════════════════════════════════════

describe('aiAdapter', () => {

  // ── withRetry ─────────────────────────────────────────

  describe('withRetry (via generateText retry behavior)', () => {
    it('retries on 429 rate-limit and succeeds on second attempt', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return freshResponse({ error: 'rate limited' }, 429);
        return freshResponse(geminiOkBody(), 200);
      });

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      const result = await runWithTimers(adapter.generateText('test', 'gemini-2.5-flash'));

      expect(result).toBe('Hello from Gemini');
      expect(callCount).toBe(2);
    });

    it('retries on 503 unavailable error', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return freshResponse({ error: 'service unavailable' }, 503);
        return freshResponse(geminiOkBody(), 200);
      });

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      const result = await runWithTimers(adapter.generateText('test', 'gemini-2.5-flash'));

      expect(result).toBe('Hello from Gemini');
      expect(callCount).toBe(2);
    });

    it('retries on network errors (fetch failed)', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('fetch failed');
        return freshResponse(geminiOkBody(), 200);
      });

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      const result = await runWithTimers(adapter.generateText('test', 'gemini-2.5-flash'));

      expect(result).toBe('Hello from Gemini');
      expect(callCount).toBe(2);
    });

    it('retries on ECONNRESET error', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('ECONNRESET');
        return freshResponse(geminiOkBody(), 200);
      });

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      const result = await runWithTimers(adapter.generateText('test', 'gemini-2.5-flash'));

      expect(result).toBe('Hello from Gemini');
      expect(callCount).toBe(2);
    });

    it('retries on ETIMEDOUT error', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('ETIMEDOUT');
        return freshResponse(geminiOkBody(), 200);
      });

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      const result = await runWithTimers(adapter.generateText('test', 'gemini-2.5-flash'));

      expect(result).toBe('Hello from Gemini');
      expect(callCount).toBe(2);
    });

    it('retries on "socket hang up" error', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('socket hang up');
        return freshResponse(geminiOkBody(), 200);
      });

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      const result = await runWithTimers(adapter.generateText('test', 'gemini-2.5-flash'));

      expect(result).toBe('Hello from Gemini');
      expect(callCount).toBe(2);
    });

    it('retries on "timed out" error message', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Request timed out after 120s');
        return freshResponse(geminiOkBody(), 200);
      });

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      const result = await runWithTimers(adapter.generateText('test', 'gemini-2.5-flash'));

      expect(result).toBe('Hello from Gemini');
      expect(callCount).toBe(2);
    });

    it('exhausts maxRetries (3) and throws on persistent 429', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse({ error: 'rate limited' }, 429));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      await expect(runWithTimers(adapter.generateText('test', 'gemini-2.5-flash')))
        .rejects.toThrow(/429/);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('uses exponential backoff delays: 5s, 15s, 45s', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const fetchTimes: number[] = [];
      mockFetch.mockImplementation(async () => {
        fetchTimes.push(Date.now());
        throw new Error('fetch failed');
      });

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      await runWithTimers(adapter.generateText('test', 'gemini-2.5-flash').catch(() => {}));

      expect(fetchTimes).toHaveLength(3);
      const delay1 = fetchTimes[1] - fetchTimes[0];
      const delay2 = fetchTimes[2] - fetchTimes[1];
      expect(delay1).toBeGreaterThanOrEqual(4_000);
      expect(delay1).toBeLessThan(7_000);
      expect(delay2).toBeGreaterThanOrEqual(14_000);
      expect(delay2).toBeLessThan(17_000);
    });

    // NOTE: This documents a real bug — all ActionableErrors from backend
    // functions include "Generate" in the Goal field, and "generate"
    // contains the substring "rate", so lower.includes('rate') matches.
    // This means 401/400/403 errors ARE retried when they should not be.
    it('BUG: retries 401 errors because "generate" contains "rate"', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse({ error: 'unauthorized' }, 401));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      await expect(runWithTimers(adapter.generateText('test', 'gemini-2.5-flash')))
        .rejects.toThrow(/401/);
      // All 3 retries are consumed even for 401, because "generate" matches "rate"
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  // ── withTimeout ───────────────────────────────────────

  describe('withTimeout (via generateText timeout behavior)', () => {
    it('rejects with timeout error when fetch hangs', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      mockFetch.mockImplementation(() => new Promise(() => {}));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      await expect(
        runWithTimers(adapter.generateText('test', 'gemini-2.5-flash', { timeoutMs: 5_000 })),
      ).rejects.toThrow(/timed out/i);
    });

    it('returns result when response arrives before timeout', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(geminiOkBody('fast response'), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      const result = await runWithTimers(
        adapter.generateText('test', 'gemini-2.5-flash', { timeoutMs: 30_000 }),
      );
      expect(result).toBe('fast response');
    });

    it('timeout message includes the label and duration', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      mockFetch.mockImplementation(() => new Promise(() => {}));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      await expect(
        runWithTimers(adapter.generateText('test', 'gemini-2.5-flash', { timeoutMs: 10_000 })),
      ).rejects.toThrow(/Gemini API request timed out after 10s/);
    });
  });

  // ── resolveApiKey ─────────────────────────────────────

  describe('resolveApiKey (via createCLIAdapter)', () => {
    it('uses backend-specific env var (GEMINI_API_KEY)', async () => {
      process.env.GEMINI_API_KEY = 'gemini-specific-key';
      mockFetch.mockImplementation(async () => freshResponse(geminiOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('test', 'gemini-2.5-flash');

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('key=gemini-specific-key');
    });

    it('uses ANTHROPIC_API_KEY for claude backend', async () => {
      process.env.ANTHROPIC_API_KEY = 'claude-specific-key';
      mockFetch.mockImplementation(async () => freshResponse(claudeOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('test', 'claude-sonnet-4-5');

      const fetchOpts = mockFetch.mock.calls[0][1] as RequestInit;
      expect((fetchOpts.headers as Record<string, string>)['x-api-key']).toBe('claude-specific-key');
    });

    it('uses GROQ_API_KEY for groq backend', async () => {
      process.env.GROQ_API_KEY = 'groq-specific-key';
      mockFetch.mockImplementation(async () => freshResponse(groqOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('test', 'groq-llama-3.3-70b-versatile');

      const fetchOpts = mockFetch.mock.calls[0][1] as RequestInit;
      expect((fetchOpts.headers as Record<string, string>)['Authorization']).toBe('Bearer groq-specific-key');
    });

    it('uses OPENAI_API_KEY for openai backend', async () => {
      process.env.OPENAI_API_KEY = 'openai-specific-key';
      mockFetch.mockImplementation(async () => freshResponse(openaiOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('test', 'openai-gpt-5.5');

      const fetchOpts = mockFetch.mock.calls[0][1] as RequestInit;
      expect((fetchOpts.headers as Record<string, string>)['Authorization']).toBe('Bearer openai-specific-key');
    });

    it('falls back to AI_API_KEY when backend-specific key is missing', async () => {
      process.env.AI_API_KEY = 'universal-key';
      mockFetch.mockImplementation(async () => freshResponse(geminiOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('test', 'gemini-2.5-flash');

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('key=universal-key');
    });

    it('throws ActionableError when no API key is available', async () => {
      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      await expect(runWithTimers(adapter.generateText('test', 'gemini-2.5-flash')))
        .rejects.toThrow(/No API key/);
    });

    it('prefers explicit key over env vars', async () => {
      process.env.GEMINI_API_KEY = 'env-key';
      mockFetch.mockImplementation(async () => freshResponse(geminiOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root', 'explicit-key');
      await adapter.generateText('test', 'gemini-2.5-flash');

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('key=explicit-key');
    });
  });

  // ── resolveModel ──────────────────────────────────────

  describe('resolveModel (via generateText backend routing)', () => {
    it('resolves registered model IDs to correct Gemini backend', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(geminiOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('test', 'gemini-2.5-flash');

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('gemini-2.5-flash');
      expect(fetchUrl).toContain('generativelanguage.googleapis.com');
    });

    it('routes claude models to Anthropic API', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(claudeOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('test', 'claude-sonnet-4-5');

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('api.anthropic.com');
    });

    it('routes groq models to Groq API', async () => {
      process.env.GROQ_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(groqOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('test', 'groq-llama-3.3-70b-versatile');

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('api.groq.com');
    });

    it('routes openai models to OpenAI API', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(openaiOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('test', 'openai-gpt-5.5');

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('api.openai.com');
    });

    it('infers gemini backend from prefix for unknown models', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(geminiOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('test', 'gemini-999-unknown');

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('generativelanguage.googleapis.com');
      expect(fetchUrl).toContain('gemini-999-unknown');
    });

    it('infers claude backend from prefix for unknown models', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(claudeOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('test', 'claude-unknown-model');

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('api.anthropic.com');
    });

    it('defaults unknown model IDs (no known prefix) to gemini backend', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(geminiOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('test', 'totally-unknown-model');

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('generativelanguage.googleapis.com');
    });

    it('maps registered model ID to correct apiModelId', async () => {
      process.env.GROQ_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(groqOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('test', 'groq-llama-3.3-70b-versatile');

      const fetchBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(fetchBody.model).toBe('llama-3.3-70b-versatile');
    });
  });

  // ── loadRegistry ──────────────────────────────────────

  describe('loadRegistry (via createCLIAdapter)', () => {
    it('throws ActionableError when ai-models.json does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const mod = await getModule();
      expect(() => mod.createCLIAdapter('/fake/root'))
        .toThrow(/Model registry not found/);
    });

    it('throws ActionableError when ai-models.json contains invalid JSON', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{ invalid json');

      const mod = await getModule();
      expect(() => mod.createCLIAdapter('/fake/root'))
        .toThrow(/Failed to parse model registry/);
    });

    it('loads registry from correct path', async () => {
      const mod = await getModule();
      mod.createCLIAdapter('/my/repo');

      expect(mockReadFileSync).toHaveBeenCalledWith(
        path.join('/my/repo', 'ai-models.json'),
        'utf-8',
      );
    });

    it('caches registry after first load (singleton)', async () => {
      const mod = await getModule();
      mod.createCLIAdapter('/fake/root');
      mod.createCLIAdapter('/fake/root');

      expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });
  });

  // ── Fallback chains ───────────────────────────────────

  describe('fallback chains', () => {
    it('cascades to first fallback when primary fails', async () => {
      process.env.GEMINI_API_KEY = 'gemini-key';
      process.env.ANTHROPIC_API_KEY = 'claude-key';

      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('generativelanguage.googleapis.com')) {
          return freshResponse({ error: 'model not found' }, 404);
        }
        if (url.includes('api.anthropic.com')) {
          return freshResponse(claudeOkBody('fallback response'), 200);
        }
        return freshResponse({ error: 'unknown' }, 500);
      });

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      const result = await runWithTimers(adapter.generateText('test', 'gemini-2.5-flash'));
      expect(result).toBe('fallback response');
    });

    it('cascades to second fallback when first fallback also fails', async () => {
      process.env.GEMINI_API_KEY = 'gemini-key';
      process.env.ANTHROPIC_API_KEY = 'claude-key';
      process.env.GROQ_API_KEY = 'groq-key';

      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('generativelanguage.googleapis.com')) {
          return freshResponse({ error: 'model not found' }, 404);
        }
        if (url.includes('api.anthropic.com')) {
          return freshResponse({ error: 'overloaded' }, 500);
        }
        if (url.includes('api.groq.com')) {
          return freshResponse(groqOkBody('second fallback'), 200);
        }
        return freshResponse({ error: 'unknown' }, 500);
      });

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      const result = await runWithTimers(adapter.generateText('test', 'gemini-2.5-flash'));
      expect(result).toBe('second fallback');
    });

    it('throws original error when all fallbacks fail', async () => {
      process.env.GEMINI_API_KEY = 'gemini-key';
      process.env.ANTHROPIC_API_KEY = 'claude-key';
      process.env.GROQ_API_KEY = 'groq-key';

      mockFetch.mockImplementation(async () => freshResponse({ error: 'not found' }, 404));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      await expect(runWithTimers(adapter.generateText('test', 'gemini-2.5-flash')))
        .rejects.toThrow(/404/);
    });

    it('skips same-backend fallbacks on auth errors (401)', async () => {
      const customRegistry = makeRegistry({
        fallbackChains: {
          'gemini-2.5-flash': ['gemini-2.5-flash', 'groq-llama-3.3-70b-versatile'],
        },
      });
      mockReadFileSync.mockReturnValue(JSON.stringify(customRegistry));

      process.env.GEMINI_API_KEY = 'bad-key';
      process.env.GROQ_API_KEY = 'groq-key';

      const urls: string[] = [];
      mockFetch.mockImplementation(async (url: string) => {
        urls.push(url);
        if (url.includes('generativelanguage.googleapis.com')) {
          return freshResponse({ error: 'API key not valid' }, 401);
        }
        if (url.includes('api.groq.com')) {
          return freshResponse(groqOkBody('groq fallback'), 200);
        }
        return freshResponse({ error: 'unknown' }, 500);
      });

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      const result = await runWithTimers(adapter.generateText('test', 'gemini-2.5-flash'));
      expect(result).toBe('groq fallback');

      // Gemini fallback should have been skipped (auth error, same backend)
      const groqCalls = urls.filter(u => u.includes('groq'));
      expect(groqCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('skips fallback when no API key is available for that backend', async () => {
      process.env.GEMINI_API_KEY = 'gemini-key';

      mockFetch.mockImplementation(async () => freshResponse({ error: 'not found' }, 404));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      await expect(runWithTimers(adapter.generateText('test', 'gemini-2.5-flash')))
        .rejects.toThrow();
    });

    it('does not cascade when model has no fallbackChains entry', async () => {
      process.env.OPENAI_API_KEY = 'openai-key';

      mockFetch.mockImplementation(async () => freshResponse({ error: 'server error' }, 500));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      await expect(runWithTimers(adapter.generateText('test', 'openai-gpt-5.5')))
        .rejects.toThrow(/500/);
    });

    it('fallback retries use maxRetries=2 (not 3)', async () => {
      process.env.GEMINI_API_KEY = 'gemini-key';
      process.env.ANTHROPIC_API_KEY = 'claude-key';

      let claudeCallCount = 0;
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('generativelanguage.googleapis.com')) {
          return freshResponse({ error: 'not found' }, 404);
        }
        if (url.includes('api.anthropic.com')) {
          claudeCallCount++;
          return freshResponse({ error: 'rate limited' }, 429);
        }
        return freshResponse({ error: 'unknown' }, 500);
      });

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      await expect(runWithTimers(adapter.generateText('test', 'gemini-2.5-flash')))
        .rejects.toThrow();
      // Fallback uses maxRetries=2
      expect(claudeCallCount).toBe(2);
    });
  });

  // ── End-to-end backend responses ──────────────────────

  describe('end-to-end mock: Gemini response parsing', () => {
    it('extracts text from valid Gemini response', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(geminiOkBody('Gemini says hello'), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      const result = await adapter.generateText('prompt', 'gemini-2.5-flash');
      expect(result).toBe('Gemini says hello');
    });

    it('throws on empty candidates', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse({ candidates: [] }, 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await expect(runWithTimers(adapter.generateText('prompt', 'gemini-2.5-flash')))
        .rejects.toThrow(/No candidates/);
    });

    it('throws on invalid JSON response body', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse('not json at all', 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await expect(runWithTimers(adapter.generateText('prompt', 'gemini-2.5-flash')))
        .rejects.toThrow(/invalid JSON/);
    });
  });

  describe('end-to-end mock: Claude response parsing', () => {
    it('extracts text from valid Claude response', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(claudeOkBody('Claude says hello'), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      const result = await adapter.generateText('prompt', 'claude-sonnet-4-5');
      expect(result).toBe('Claude says hello');
    });

    it('sends correct headers for Claude', async () => {
      process.env.ANTHROPIC_API_KEY = 'my-claude-key';
      mockFetch.mockImplementation(async () => freshResponse(claudeOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('prompt', 'claude-sonnet-4-5');

      const fetchOpts = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = fetchOpts.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('my-claude-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    it('throws on empty content', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse({ content: [] }, 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await expect(runWithTimers(adapter.generateText('prompt', 'claude-sonnet-4-5')))
        .rejects.toThrow(/No content/);
    });
  });

  describe('end-to-end mock: Groq response parsing', () => {
    it('extracts text from valid Groq response', async () => {
      process.env.GROQ_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(groqOkBody('Groq says hello'), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      const result = await adapter.generateText('prompt', 'groq-llama-3.3-70b-versatile');
      expect(result).toBe('Groq says hello');
    });

    it('sends correct auth header for Groq', async () => {
      process.env.GROQ_API_KEY = 'my-groq-key';
      mockFetch.mockImplementation(async () => freshResponse(groqOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('prompt', 'groq-llama-3.3-70b-versatile');

      const fetchOpts = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = fetchOpts.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer my-groq-key');
    });

    it('throws on empty choices', async () => {
      process.env.GROQ_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse({ choices: [] }, 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await expect(runWithTimers(adapter.generateText('prompt', 'groq-llama-3.3-70b-versatile')))
        .rejects.toThrow(/No choices/);
    });
  });

  describe('end-to-end mock: OpenAI response parsing', () => {
    it('extracts text from valid OpenAI response', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(openaiOkBody('OpenAI says hello'), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      const result = await adapter.generateText('prompt', 'openai-gpt-5.5');
      expect(result).toBe('OpenAI says hello');
    });

    it('throws on missing message output', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse({ output: [] }, 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await expect(runWithTimers(adapter.generateText('prompt', 'openai-gpt-5.5')))
        .rejects.toThrow(/No message output/);
    });
  });

  // ── createCLIAdapter factory ──────────────────────────

  describe('createCLIAdapter', () => {
    it('returns an object implementing AIAdapter interface', async () => {
      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      expect(adapter.generateText).toBeTypeOf('function');
    });

    it('returns ExtendedAIAdapter with generate when DEBATE_ENVELOPE is not "0"', async () => {
      process.env.DEBATE_ENVELOPE = '1';
      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      expect(adapter.generate).toBeTypeOf('function');
    });

    it('returns ExtendedAIAdapter without generate when DEBATE_ENVELOPE is "0"', async () => {
      process.env.DEBATE_ENVELOPE = '0';
      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      expect(adapter.generate).toBeUndefined();
    });

    it('includes generateTextWithSearch method', async () => {
      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      expect(adapter.generateTextWithSearch).toBeTypeOf('function');
    });
  });

  // ── Request body construction ─────────────────────────

  describe('request body construction', () => {
    it('passes temperature and maxTokens to Gemini', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(geminiOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('prompt', 'gemini-2.5-flash', {
        temperature: 0.3, maxTokens: 4096,
      });

      const fetchBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(fetchBody.generationConfig.temperature).toBe(0.3);
      expect(fetchBody.generationConfig.maxOutputTokens).toBe(4096);
    });

    it('passes temperature and maxTokens to Claude', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(claudeOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('prompt', 'claude-sonnet-4-5', {
        temperature: 0.1, maxTokens: 2048,
      });

      const fetchBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(fetchBody.temperature).toBe(0.1);
      expect(fetchBody.max_tokens).toBe(2048);
    });

    it('enables JSON mode for Gemini', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(geminiOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('prompt', 'gemini-2.5-flash', { jsonMode: true });

      const fetchBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(fetchBody.generationConfig.responseMimeType).toBe('application/json');
    });

    it('enables JSON mode for Groq', async () => {
      process.env.GROQ_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(groqOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('prompt', 'groq-llama-3.3-70b-versatile', { jsonMode: true });

      const fetchBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(fetchBody.response_format).toEqual({ type: 'json_object' });
    });

    it('uses default temperature 0.7 when not specified', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(geminiOkBody(), 200));

      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('prompt', 'gemini-2.5-flash');

      const fetchBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(fetchBody.generationConfig.temperature).toBe(0.7);
    });

    it('appends responseSchema instruction to Claude prompt', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockFetch.mockImplementation(async () => freshResponse(claudeOkBody(), 200));

      const schema = { type: 'object', properties: { result: { type: 'string' } } };
      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      await adapter.generateText('prompt', 'claude-sonnet-4-5', { responseSchema: schema });

      const fetchBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      const userContent = fetchBody.messages[0].content;
      expect(userContent).toContain('JSON object conforming to this schema');
      expect(userContent).toContain('"result"');
    });
  });
});
