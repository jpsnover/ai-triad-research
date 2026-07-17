import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FaultHarness, type FaultProfile } from './faultInjection.js';

// ── Z.AI timeout → failover regression (t/1628 AC3) ─────────────────
//
// Follows the /add-fault-test playbook (self-certified; see t/1628 comment
// for the one deviation).
//
// Regression under test: a `zai-glm-5-2` call that times out must fail over
// to the next model in its fallback chain and RETURN a statement, not throw
// "no response from {model}" with zero output. Before t/1628, zai had an
// empty fallback chain, so the failover loop was a no-op and the timeout
// bubbled up as an ActionableError with no text. This test simulates the
// zai endpoint hanging and asserts the gemini fallback answers.

// ── Mock fs for registry loading ────────────────────────
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

// ── Helpers ─────────────────────────────────────────────

// Registry with a zai default whose fallback chain leads to gemini. Mirrors
// the shape of the landed ai-models.json fix (zai-glm-5-2 → gemini-2.5-flash).
function makeRegistry() {
  return {
    backends: [
      { id: 'zai', label: 'Z.AI' },
      { id: 'gemini', label: 'Google Gemini' },
    ],
    models: [
      { id: 'zai-glm-5-2', apiModelId: 'zai-glm-5-2', label: 'GLM 5.2', backend: 'zai' },
      { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', backend: 'gemini' },
    ],
    fallbackChains: {
      'zai-glm-5-2': ['gemini-2.5-flash'],
    },
    contextWindows: { zai: 131072, gemini: 1048576 },
  };
}

async function getModule() {
  return await import('../aiAdapter.js');
}

async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
  for (let i = 0; i < 20; i++) {
    await vi.advanceTimersByTimeAsync(10_000);
  }
  return promise;
}

// ── Setup / teardown ────────────────────────────────────

// aiAdapter has no 'zai' entry in BACKEND_ENV_KEYS, so the zai call resolves
// its key via the AI_API_KEY fallback; the gemini fallback uses GEMINI_API_KEY.
const savedEnvKeys = ['GEMINI_API_KEY', 'AI_API_KEY', 'DEBATE_ENVELOPE'];
const savedEnv: Record<string, string | undefined> = {};

function onUnhandledRejection(event: PromiseRejectionEvent) {
  const msg = event.reason instanceof Error ? event.reason.message : String(event.reason);
  if (msg.includes('timed out') || msg.includes('ActionableError') || msg.includes('Goal:')) {
    event.preventDefault();
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(JSON.stringify(makeRegistry()));

  for (const key of savedEnvKeys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('unhandledrejection', onUnhandledRejection);
  }
  process.on('unhandledRejection', () => {});
});

afterEach(async () => {
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

// ══════════════════════════════════════════════════════════

describe('Z.AI timeout failover (t/1628)', () => {

  it('a zai-glm-5-2 timeout fails over to gemini and returns a statement', async () => {
    process.env.AI_API_KEY = 'test-key';       // zai (no BACKEND_ENV_KEYS entry)
    process.env.GEMINI_API_KEY = 'test-key';   // gemini fallback

    // Only the zai endpoint hangs; every other fetch (the gemini fallback)
    // gets the harness default OK body ("Hello from Gemini").
    const zaiTimeout: FaultProfile = {
      name: 'zaiTimeout',
      description: 'Z.AI endpoint hangs; fallback chain must answer',
      faults: [{
        target: 'ai-call',
        trigger: 'match-request',
        matchFn: (url: string) => url.includes('api.z.ai'),
        effect: 'timeout',
      }],
    };

    const harness = new FaultHarness(zaiTimeout);
    harness.install();
    try {
      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      const result = await runWithTimers(
        adapter.generateText('test prompt', 'zai-glm-5-2', { timeoutMs: 10_000 }),
      );

      // Outcome, not throw: the gemini fallback produced the statement.
      expect(result).toBe('Hello from Gemini');
      // Proof the zai fault actually fired (i.e. we exercised failover, not a
      // straight-through success). The harness increments stats.timeouts on
      // every simulated timeout; the primary zai model is retried once before
      // the chain runs, so at least one timeout is recorded.
      //
      // HISTORY (t/1628 → t/1633): the original TL-approved design (t/1628#2)
      // proposed asserting a `fallbackAttempts` counter. FaultHarness only stubs
      // fetch, while failover happens inside aiAdapter above that layer, so the
      // counter could never be populated — it was a dead-green trap and was
      // removed from FaultStats in t/1633. We assert the observable outcome
      // (fallback statement returned) plus stats.timeouts instead, which proves
      // the same behavior using only counters the harness actually maintains.
      expect(harness.stats.timeouts).toBeGreaterThanOrEqual(1);
    } finally {
      harness.teardown();
    }
  });

  it('happy path still works after teardown (no fetch-stub leak)', async () => {
    process.env.AI_API_KEY = 'test-key';
    process.env.GEMINI_API_KEY = 'test-key';

    const harness = new FaultHarness({
      name: 'zaiTimeout2', description: 'reuse', faults: [{
        target: 'ai-call', trigger: 'match-request',
        matchFn: (url: string) => url.includes('api.z.ai'), effect: 'timeout',
      }],
    });
    harness.install();
    harness.teardown();

    // With the harness torn down, a direct fetch hits the real global again.
    // Restub locally to confirm the adapter can still succeed end-to-end.
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      const body = JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    });

    try {
      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');
      const result = await runWithTimers(
        adapter.generateText('test', 'gemini-2.5-flash', { timeoutMs: 30_000 }),
      );
      expect(result).toBe('ok');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
