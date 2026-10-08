import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── t/4105 SO cond 4 (e/284#2): no key material in any error or log ──
//
// Mirrors PowerShell's sentinel test. AI_API_KEY (and, for the foreign-credential arm, another backend's
// variable) holds a SENTINEL; every refusal path is triggered; the sentinel must appear in no thrown error
// (message, problem, nextSteps, serialized form), no flight-recorder event, and no console or stderr line.

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

vi.mock('../../search/tavily', () => ({
  tavilySearch: vi.fn(),
  buildSearchAugmentedPrompt: vi.fn(),
}));

const SENTINEL = 'SENTINEL-4105-must-never-be-logged';

function makeRegistry() {
  return {
    backends: [{ id: 'claude', label: 'Claude' }, { id: 'gemini', label: 'Gemini' }],
    models: [
      { id: 'claude-haiku-4-5', apiModelId: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', backend: 'claude' },
      { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', backend: 'gemini' },
    ],
    // gemini primary falls back to claude: drives the cascade's softened secondary-link path
    fallbackChains: { 'claude-haiku-4-5': ['gemini-2.5-flash'], 'gemini-2.5-flash': ['claude-haiku-4-5'] },
    contextWindows: { claude: 200000, gemini: 1048576 },
  };
}

const ENV_KEYS = ['GEMINI_API_KEY', 'AI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'GROQ_API_KEY', 'DEBATE_ENVELOPE'];
const savedEnv: Record<string, string | undefined> = {};
let output: string[] = [];

async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
  for (let i = 0; i < 40; i++) await vi.advanceTimersByTimeAsync(30_000);
  return promise;
}

function errorText(e: unknown): string {
  const err = e as { message?: string; problem?: string; nextSteps?: string[]; stack?: string };
  return [String(e), err?.message, err?.problem, (err?.nextSteps ?? []).join(' '), err?.stack, JSON.stringify(e)].join('\n');
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  output = [];
  mockExistsSync.mockReset().mockReturnValue(true);
  mockReadFileSync.mockReset().mockReturnValue(JSON.stringify(makeRegistry()));
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  const capture = (...args: unknown[]) => { output.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => { capture(String(chunk)); return true; }) as typeof process.stderr.write);
  // Gemini answers 503 (so the cascade runs); anything else 404. No response body echoes the key.
  vi.stubGlobal('fetch', async (url: string | URL): Promise<Response> => {
    const u = String(url);
    if (u.includes('googleapis.com')) return new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 503 });
    return new Response('{}', { status: 404 });
  });
});

afterEach(async () => {
  await vi.runAllTimersAsync().catch(() => {});
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.resetModules();
});

describe('no key material in any refusal error or log (t/4105 C4)', () => {
  it('every refusal path: the sentinel appears in no error, no flight-recorder event and no console/stderr line', async () => {
    const { FlightRecorder } = await import('../../flight-recorder/flightRecorder.js');
    const { setGlobalRecorder, clearGlobalRecorder } = await import('../../flight-recorder/index.js');
    const recorder = new FlightRecorder({ capacity: 512 });
    setGlobalRecorder(recorder);
    const { resolveGenericFallbackKey, assertKeyForBackend, isKeyRoutingRefusal, BACKEND_KEY_ENV_VARS } = await import('../../ai-client/apiKeyFallback.js');
    const { callProvider } = await import('../../ai-client/client.js');
    const { createCLIAdapter } = await import('../aiAdapter.js');

    const errors: unknown[] = [];
    const capture = async (fn: () => unknown) => {
      try { await fn(); errors.push(new Error('expected a refusal, got none')); } catch (e) { errors.push(e); }
    };
    // For a timer-driven call: attach the rejection handler at creation, so advancing timers never sees it unhandled.
    const NONE = Symbol('none');
    const captureTimed = async (p: Promise<unknown>) => {
      const settled = p.then(() => NONE, (e: unknown) => e);
      const r = await runWithTimers(settled);
      errors.push(r === NONE ? new Error('expected a refusal, got none') : r);
    };

    try {
      // 1. The gemini-only refusal, for every non-gemini backend in the key map.
      process.env.AI_API_KEY = SENTINEL;
      for (const backend of Object.keys(BACKEND_KEY_ENV_VARS).filter((b) => b !== 'gemini')) {
        await capture(() => resolveGenericFallbackKey(backend));
      }
      // 2. The foreign-credential guard, directly and at the callProvider chokepoint.
      process.env.GROQ_API_KEY = SENTINEL;
      await capture(() => assertKeyForBackend(SENTINEL, 'claude', 'provided'));
      await capture(() => callProvider(globalThis.fetch, 'claude', 'p', 'claude-haiku-4-5', SENTINEL, { timeoutMs: 10_000 }));
      delete process.env.GROQ_API_KEY;
      // 3. The CLI primary refusal (claude, only AI_API_KEY).
      const adapter = createCLIAdapter('/fake/root');
      await captureTimed(adapter.generateText('p', 'claude-haiku-4-5', { timeoutMs: 10_000 }));
      // 4. The CLI cascade's softened secondary link: gemini (served by the sentinel AI_API_KEY) fails with a 503,
      //    and the claude link is skipped with a WARN.
      await captureTimed(adapter.generateText('p', 'gemini-2.5-flash', { timeoutMs: 10_000 }));

      const refusals = errors.filter((e) => isKeyRoutingRefusal(e));
      expect(refusals.length).toBeGreaterThanOrEqual(Object.keys(BACKEND_KEY_ENV_VARS).length + 1); // the paths really refused
      expect(output.some((l) => l.includes('AI_API_KEY applies to gemini only'))).toBe(true); // the cascade WARN fired

      const leaks = [
        ...errors.map(errorText).filter((t) => t.includes(SENTINEL)).map((t) => `error: ${t.slice(0, 160)}`),
        ...recorder.buffer.drain().map((e) => JSON.stringify(e)).filter((t) => t.includes(SENTINEL)).map((t) => `fr: ${t.slice(0, 160)}`),
        ...output.filter((l) => l.includes(SENTINEL)).map((l) => `log: ${l.slice(0, 160)}`),
      ];
      expect(leaks).toEqual([]);
    } finally {
      clearGlobalRecorder();
    }
  });
});
