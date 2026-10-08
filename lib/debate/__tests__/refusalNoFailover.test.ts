import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── t/4105 SO cond 6 (e/284#12), CLI path ───────────────────────────
//
// When a call's primary backend is not gemini and only AI_API_KEY is set, the refusal naming that backend's own
// variable throws to the caller. The fallbackChains cascade must not treat it as a reason to fail over, or gemini
// would silently serve a request meant for another company. The CONTROL arm proves the exclusion is narrow: the
// same chain with an ordinary transient primary failure (HTTP 503) is still served by gemini.

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

// Claude primary whose fallback chain leads to gemini.
function makeRegistry() {
  return {
    backends: [
      { id: 'claude', label: 'Anthropic Claude' },
      { id: 'gemini', label: 'Google Gemini' },
    ],
    models: [
      { id: 'claude-haiku-4-5', apiModelId: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', backend: 'claude' },
      { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', backend: 'gemini' },
    ],
    fallbackChains: { 'claude-haiku-4-5': ['gemini-2.5-flash'] },
    contextWindows: { claude: 200000, gemini: 1048576 },
  };
}

const GEMINI_OK = JSON.stringify({
  candidates: [{ content: { parts: [{ text: 'served by gemini' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
});

let calls: string[] = [];
function stubFetch(claudeStatus: number) {
  vi.stubGlobal('fetch', async (url: string | URL): Promise<Response> => {
    const u = String(url);
    if (u.includes('anthropic.com')) {
      calls.push('claude');
      return new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: claudeStatus });
    }
    if (u.includes('googleapis.com')) {
      calls.push('gemini');
      return new Response(GEMINI_OK, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    calls.push(`other:${u}`);
    return new Response('{}', { status: 404 });
  });
}

async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
  for (let i = 0; i < 40; i++) await vi.advanceTimersByTimeAsync(30_000);
  return promise;
}

const ENV_KEYS = ['GEMINI_API_KEY', 'AI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'GROQ_API_KEY', 'DEBATE_ENVELOPE'];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  calls = [];
  mockExistsSync.mockReset().mockReturnValue(true);
  mockReadFileSync.mockReset().mockReturnValue(JSON.stringify(makeRegistry()));
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
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

describe('aiAdapter: a key-routing refusal never fails over (t/4105 C6)', () => {
  it('primary claude, only AI_API_KEY set, gemini in the chain: the named-variable error throws; gemini is never called', async () => {
    process.env.AI_API_KEY = 'google-placeholder';
    stubFetch(503);
    const { createCLIAdapter } = await import('../aiAdapter.js');
    const adapter = createCLIAdapter('/fake/root');
    const err = await runWithTimers(adapter.generateText('p', 'claude-haiku-4-5', { timeoutMs: 10_000 }).then(() => undefined, (e: unknown) => e));
    expect(String(err)).toMatch(/fallback for the gemini backend only/);
    expect(String(err)).toMatch(/ANTHROPIC_API_KEY/);
    expect(calls).not.toContain('gemini');
    expect(calls).toEqual([]);
  });

  it("a foreign-credential refusal on the primary send throws; gemini is never called", async () => {
    process.env.GROQ_API_KEY = 'groq-placeholder';
    process.env.GEMINI_API_KEY = 'gemini-placeholder';
    stubFetch(503);
    const { createCLIAdapter } = await import('../aiAdapter.js');
    const adapter = createCLIAdapter('/fake/root', 'groq-placeholder'); // explicit key that is the groq credential
    const err = await runWithTimers(adapter.generateText('p', 'claude-haiku-4-5', { timeoutMs: 10_000 }).then(() => undefined, (e: unknown) => e));
    expect(String(err)).toMatch(/value of GROQ_API_KEY/);
    expect(String(err)).not.toContain('groq-placeholder');
    expect(calls).toEqual([]);
  });

  it('a refusal raised by the claude SEND alone (gemini key legitimate) is not absorbed by the cascade', async () => {
    // Isolates the cascade's kind check: only the claude send refuses, so a cascade that absorbed the refusal
    // would reach a working gemini link and serve the request.
    process.env.ANTHROPIC_API_KEY = 'claude-placeholder';
    process.env.GEMINI_API_KEY = 'gemini-placeholder';
    stubFetch(503);
    vi.doMock('../../ai-client/index.js', async (importActual) => {
      const actual = await importActual<typeof import('../../ai-client/index.js')>();
      const { KeyRoutingRefusal } = await import('../../ai-client/apiKeyFallback.js');
      return {
        ...actual,
        callProvider: async (...args: Parameters<typeof actual.callProvider>) => {
          if (args[1] === 'claude') {
            throw new KeyRoutingRefusal('AIApiKeyForeignCredentialRefused', { goal: 'g', problem: 'the provided key is the value of GROQ_API_KEY', location: 'test', nextSteps: [] });
          }
          return actual.callProvider(...args);
        },
      };
    });
    const { createCLIAdapter } = await import('../aiAdapter.js');
    const adapter = createCLIAdapter('/fake/root');
    const err = await runWithTimers(adapter.generateText('p', 'claude-haiku-4-5', { timeoutMs: 10_000 }).then(() => undefined, (e: unknown) => e));
    expect(String(err)).toMatch(/value of GROQ_API_KEY/);
    expect(calls).not.toContain('gemini');
    vi.doUnmock('../../ai-client/index.js');
  });

  it('CONTROL: the same chain with a transient claude 503 is still served by gemini', async () => {
    process.env.ANTHROPIC_API_KEY = 'claude-placeholder';
    process.env.AI_API_KEY = 'google-placeholder';
    stubFetch(503);
    const { createCLIAdapter } = await import('../aiAdapter.js');
    const adapter = createCLIAdapter('/fake/root');
    const result = await runWithTimers(adapter.generateText('p', 'claude-haiku-4-5', { timeoutMs: 10_000 }));
    expect(result).toBe('served by gemini');
    expect(calls).toContain('claude');
    expect(calls.filter((c) => c === 'gemini')).toHaveLength(1);
  });
});
