import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FaultHarness, AI_FAULT_PROFILES, type FaultProfile } from './faultInjection.js';

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

function makeRegistry() {
  return {
    backends: [
      { id: 'gemini', label: 'Google Gemini' },
      { id: 'claude', label: 'Anthropic Claude' },
      { id: 'groq', label: 'Groq' },
    ],
    models: [
      { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', backend: 'gemini' },
      { id: 'claude-sonnet-4-5', apiModelId: 'claude-sonnet-4-5', label: 'Sonnet 4.5', backend: 'claude' },
      { id: 'groq-llama-3.3-70b-versatile', apiModelId: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70b', backend: 'groq' },
    ],
    fallbackChains: {
      'gemini-2.5-flash': ['claude-sonnet-4-5', 'groq-llama-3.3-70b-versatile'],
    },
    contextWindows: { gemini: 1048576, claude: 200000, groq: 131072 },
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

const savedEnvKeys = ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'AI_API_KEY', 'DEBATE_ENVELOPE'];
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

describe('FaultHarness mechanics', () => {

  it('intercepts fetch and returns OK for non-faulted calls', async () => {
    const harness = new FaultHarness({
      name: 'no-faults', description: 'Passthrough', faults: [],
    });
    harness.install();
    try {
      const res = await globalThis.fetch('https://example.com');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.candidates[0].content.parts[0].text).toBe('Hello from Gemini');
    } finally {
      harness.teardown();
    }
  });

  it('tracks fault stats (errors, timeouts) accurately', async () => {
    const harness = new FaultHarness(AI_FAULT_PROFILES.totalAiOutage);
    harness.install();
    try {
      await globalThis.fetch('https://a.com');
      await globalThis.fetch('https://b.com');
      await globalThis.fetch('https://c.com');
      expect(harness.stats.errors).toBe(3);
      expect(harness.stats.timeouts).toBe(0);
    } finally {
      harness.teardown();
    }
  });

  it('nth-call trigger fires only on the specified call number', async () => {
    const harness = new FaultHarness(AI_FAULT_PROFILES.silentAiDrop); // nthCall=3
    harness.install();
    try {
      const res1 = await globalThis.fetch('https://example.com');
      expect(res1.status).toBe(200);
      const res2 = await globalThis.fetch('https://example.com');
      expect(res2.status).toBe(200);
      expect(harness.stats.timeouts).toBe(0);

      // Call 3: timeout (don't await — it never resolves)
      globalThis.fetch('https://example.com');
      expect(harness.stats.timeouts).toBe(1);

      // Call 4: back to normal (nth-call is exact match)
      const res4 = await globalThis.fetch('https://example.com');
      expect(res4.status).toBe(200);
      expect(harness.stats.timeouts).toBe(1);
    } finally {
      harness.teardown();
    }
  });

  it('teardown restores original fetch', async () => {
    const sentinel = vi.fn().mockResolvedValue(new Response('restored'));
    vi.stubGlobal('fetch', sentinel);

    const harness = new FaultHarness(AI_FAULT_PROFILES.totalAiOutage);
    harness.install();
    const res = await globalThis.fetch('https://example.com');
    expect(res.status).toBe(503);
    expect(sentinel).not.toHaveBeenCalled();

    harness.teardown();
    await globalThis.fetch('https://example.com');
    expect(sentinel).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════

describe('AI fault profiles × aiAdapter (Coherent Experience Checklist)', () => {

  it('totalAiOutage: no silent swallowing — adapter retries then throws', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.GROQ_API_KEY = 'test-key';

    const harness = new FaultHarness(AI_FAULT_PROFILES.totalAiOutage);
    harness.install();
    try {
      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      const err = await runWithTimers(
        adapter.generateText('test', 'gemini-2.5-flash'),
      ).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/503|unavailable/i);
      expect(harness.stats.errors).toBeGreaterThan(1);
    } finally {
      harness.teardown();
    }
  });

  it('authFailFast: 401 skips retry — single fetch call', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    const harness = new FaultHarness(AI_FAULT_PROFILES.authFailFast);
    harness.install();
    try {
      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      await expect(
        runWithTimers(adapter.generateText('test', 'gemini-2.5-flash')),
      ).rejects.toThrow(/401|Permission/);
      expect(harness.stats.errors).toBe(1);
    } finally {
      harness.teardown();
    }
  });

  it('silentAiDrop: timeout rejects with ActionableError (no hang)', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    const allTimeout: FaultProfile = {
      name: 'allTimeout',
      description: 'Every call hangs — validates timeout detection',
      faults: [{ target: 'ai-call', trigger: 'always', effect: 'timeout' }],
    };
    const harness = new FaultHarness(allTimeout);
    harness.install();
    try {
      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      const err = await runWithTimers(
        adapter.generateText('test', 'gemini-2.5-flash', { timeoutMs: 10_000 }),
      ).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/timed out/i);
      expect((err as Error).name).toBe('ActionableError');
      expect(harness.stats.timeouts).toBeGreaterThanOrEqual(1);
    } finally {
      harness.teardown();
    }
  });

  it('tokenExhaustion: 429 on first call → adapter retries and recovers', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    const firstCall429: FaultProfile = {
      name: 'firstCall429',
      description: '429 on first call only — validates retry recovery',
      faults: [{ target: 'ai-call', trigger: 'nth-call', effect: 'throw-429', nthCall: 1 }],
    };
    const harness = new FaultHarness(firstCall429);
    harness.install();
    try {
      const mod = await getModule();
      const adapter = mod.createCLIAdapter('/fake/root');

      const result = await runWithTimers(
        adapter.generateText('test', 'gemini-2.5-flash'),
      );

      expect(result).toBe('Hello from Gemini');
      expect(harness.stats.errors).toBe(1);
    } finally {
      harness.teardown();
    }
  });
});
