// Fault injection tests for bridge resilience layer (t/1087, Phase 4).
// Uses FaultHarness from lib/debate for circuit breaker and retry scenarios.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FaultHarness, type FaultProfile } from '../../../../lib/debate/__tests__/faultInjection';
import {
  resilientFetch,
  getResilienceState,
  resetResilience,
  setThrottleFromProbe,
  type ResilientFetchOptions,
  type EndpointCategory,
} from '../bridge/resilience';
import { getClientConfig } from '../lib/clientConfig';

vi.mock('@lib/debate/errors', () => ({
  ActionableError: class ActionableError extends Error {
    goal: string;
    problem: string;
    location: string;
    nextSteps: string[];
    constructor(opts: { goal: string; problem: string; location: string; nextSteps: string[] }) {
      super(opts.problem);
      this.name = 'ActionableError';
      this.goal = opts.goal;
      this.problem = opts.problem;
      this.location = opts.location;
      this.nextSteps = opts.nextSteps;
    }
  },
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn(), intern: vi.fn() }),
}));

function opts(overrides: Partial<ResilientFetchOptions> = {}): ResilientFetchOptions {
  return {
    timeoutMs: 5000,
    maxRetries: 0,
    critical: false,
    category: 'read' as EndpointCategory,
    ...overrides,
  };
}

const cfg = () => getClientConfig().resilience;

// ── Fault profiles ──

const ALWAYS_503: FaultProfile = {
  name: 'always503',
  description: 'Every call returns 503',
  faults: [{ target: 'ai-call', trigger: 'always', effect: 'throw-503' }],
};

const FIRST_CALL_503: FaultProfile = {
  name: 'firstCall503',
  description: '503 on first call only, then success',
  faults: [{ target: 'ai-call', trigger: 'nth-call', effect: 'throw-503', nthCall: 1 }],
};

// ── Helpers ──

function abortAwareMock(): typeof fetch {
  return ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      if (init?.signal) {
        if (init.signal.aborted) {
          reject(new DOMException('The operation was aborted', 'AbortError'));
          return;
        }
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      }
    })) as typeof fetch;
}

describe('resilienceFaults — FaultHarness integration', () => {
  let harness: FaultHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    resetResilience();
  });

  afterEach(() => {
    harness?.teardown();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── 1. Circuit breaker trip ──

  describe('circuit breaker trip via FaultHarness', () => {
    it('opens after circuitThreshold consecutive 503s and throws ActionableError', async () => {
      harness = new FaultHarness(ALWAYS_503);
      harness.install();

      for (let i = 0; i < cfg().circuitThreshold; i++) {
        await resilientFetch('/api/test', {}, opts());
      }
      expect(getResilienceState().circuits.read.state).toBe('OPEN');
      expect(getResilienceState().circuits.read.consecutiveFailures).toBe(cfg().circuitThreshold);

      const err = await resilientFetch('/api/test', {}, opts()).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe('ActionableError');
      expect((err as { goal: string }).goal).toMatch(/Make request/);
      expect((err as { problem: string }).problem).toMatch(/Circuit breaker OPEN/);
      expect((err as { location: string }).location).toBe('web-bridge/resilience');
      expect((err as { nextSteps: string[] }).nextSteps).toEqual(expect.arrayContaining([
        expect.stringMatching(/cooldown/i),
      ]));
    });
  });

  // ── 2. Circuit half-open probe ──

  describe('circuit half-open probe via FaultHarness', () => {
    async function tripCircuit() {
      harness = new FaultHarness(ALWAYS_503);
      harness.install();
      for (let i = 0; i < cfg().circuitThreshold; i++) {
        await resilientFetch('/api/test', {}, opts());
      }
      expect(getResilienceState().circuits.read.state).toBe('OPEN');
      harness.teardown();
    }

    it('transitions OPEN → HALF_OPEN → CLOSED on successful probe', async () => {
      await tripCircuit();

      vi.advanceTimersByTime(cfg().circuitCooldownMs + 1);

      const successFetch = vi.fn().mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
      vi.stubGlobal('fetch', successFetch);

      const res = await resilientFetch('/api/test', {}, opts());
      expect(res.ok).toBe(true);
      expect(getResilienceState().circuits.read.state).toBe('CLOSED');
      expect(getResilienceState().circuits.read.consecutiveFailures).toBe(0);
    });

    it('transitions OPEN → HALF_OPEN → OPEN on failed probe', async () => {
      await tripCircuit();

      vi.advanceTimersByTime(cfg().circuitCooldownMs + 1);

      harness = new FaultHarness(ALWAYS_503);
      harness.install();

      await resilientFetch('/api/test', {}, opts());
      expect(getResilienceState().circuits.read.state).toBe('OPEN');
    });
  });

  // ── 3. Adaptive throttle delays non-critical requests ──

  describe('adaptive throttle', () => {
    it('delays non-critical requests when THROTTLED', async () => {
      setThrottleFromProbe('THROTTLED', 500, 100);
      expect(getResilienceState().throttles.read.state).toBe('THROTTLED');

      const fetchMock = vi.fn().mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const promise = resilientFetch('/api/test', {}, opts({ critical: false }));

      expect(fetchMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(cfg().throttleDelayMs);
      await promise;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not delay critical requests when THROTTLED', async () => {
      setThrottleFromProbe('THROTTLED', 500, 100);

      const fetchMock = vi.fn().mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await resilientFetch('/api/test', {}, opts({ critical: true }));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // ── 4. Throttle exit ──

    it('stops delaying after throttle clears', async () => {
      setThrottleFromProbe('THROTTLED', 500, 100);
      setThrottleFromProbe('NORMAL', 120, 100);
      expect(getResilienceState().throttles.read.state).toBe('NORMAL');

      const fetchMock = vi.fn().mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await resilientFetch('/api/test', {}, opts({ critical: false }));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── 5. Category-specific timeouts ──

  describe('category-specific timeouts', () => {
    it('read call times out at specified timeout', async () => {
      vi.stubGlobal('fetch', abortAwareMock());
      const timeoutMs = 30_000;

      const promise = resilientFetch('/api/taxonomy', {}, opts({ timeoutMs, category: 'read' }));
      const rejection = expect(promise).rejects.toThrow('aborted');
      await vi.advanceTimersByTimeAsync(timeoutMs + 1);
      await rejection;
    });

    it('AI call times out at specified timeout', async () => {
      vi.stubGlobal('fetch', abortAwareMock());
      const timeoutMs = 120_000;

      const promise = resilientFetch('/api/ai/generate', { method: 'POST' }, opts({ timeoutMs, category: 'ai' }));
      const rejection = expect(promise).rejects.toThrow('aborted');
      await vi.advanceTimersByTimeAsync(timeoutMs + 1);
      await rejection;
    });

    it('mutation call times out at specified timeout', async () => {
      vi.stubGlobal('fetch', abortAwareMock());
      const timeoutMs = 60_000;

      const promise = resilientFetch('/api/taxonomy/acc', { method: 'PUT' }, opts({ timeoutMs, category: 'mutation' }));
      const rejection = expect(promise).rejects.toThrow('aborted');
      await vi.advanceTimersByTimeAsync(timeoutMs + 1);
      await rejection;
    });
  });

  // ── 6. Retry with exponential backoff ──

  describe('retry with exponential backoff via FaultHarness', () => {
    it('retries transient 503 and succeeds on second attempt', async () => {
      harness = new FaultHarness(FIRST_CALL_503);
      harness.install();

      const promise = resilientFetch('/api/test', {}, opts({ maxRetries: 1 }));
      // Backoff = min(retryBaseDelayMs * 2^0, retryMaxDelayMs) + jitter
      // Advance past max possible backoff: retryBaseDelayMs + retryJitterMaxMs
      await vi.advanceTimersByTimeAsync(cfg().retryBaseDelayMs + cfg().retryJitterMaxMs + 100);
      const res = await promise;
      expect(res.ok).toBe(true);
    });

    it('records circuit failure on 503 then resets on success', async () => {
      harness = new FaultHarness(FIRST_CALL_503);
      harness.install();

      const promise = resilientFetch('/api/test', {}, opts({ maxRetries: 1 }));
      await vi.advanceTimersByTimeAsync(cfg().retryBaseDelayMs + cfg().retryJitterMaxMs + 100);
      await promise;

      expect(getResilienceState().circuits.read.consecutiveFailures).toBe(0);
      expect(getResilienceState().circuits.read.state).toBe('CLOSED');
    });
  });

  // ── 7. FaultHarness stats tracking ──

  describe('FaultHarness stats integration', () => {
    it('tracks error count matching circuitThreshold', async () => {
      harness = new FaultHarness(ALWAYS_503);
      harness.install();

      for (let i = 0; i < cfg().circuitThreshold; i++) {
        await resilientFetch('/api/test', {}, opts());
      }

      expect(harness.stats.errors).toBe(cfg().circuitThreshold);
    });
  });
});
