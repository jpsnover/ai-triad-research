import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resilientFetch,
  categorizeEndpoint,
  getResilienceState,
  resetResilience,
  subscribeResilience,
  type EndpointCategory,
  type ResilientFetchOptions,
} from '../resilience';

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

const mockRecord = vi.fn();
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: mockRecord, intern: vi.fn() }),
}));

function mockFetchResponse(status: number, body: unknown = {}, headers?: Record<string, string>): Response {
  const h = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: h,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    body: { cancel: () => Promise.resolve() },
    clone: () => mockFetchResponse(status, body, headers),
  } as unknown as Response;
}

function defaultOpts(overrides: Partial<ResilientFetchOptions> = {}): ResilientFetchOptions {
  return {
    timeoutMs: 5000,
    maxRetries: 0,
    critical: true,
    category: 'read' as EndpointCategory,
    ...overrides,
  };
}

describe('resilience', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetResilience();
    mockRecord.mockClear();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('categorizeEndpoint', () => {
    it('classifies telemetry paths', () => {
      expect(categorizeEndpoint('/api/admin/telemetry', 'POST')).toBe('telemetry');
      expect(categorizeEndpoint('/api/admin/errors', 'POST')).toBe('telemetry');
    });

    it('classifies AI paths', () => {
      expect(categorizeEndpoint('/api/ai/generate', 'POST')).toBe('ai');
      expect(categorizeEndpoint('/api/ai/temperature', 'POST')).toBe('ai');
    });

    it('classifies admin paths', () => {
      expect(categorizeEndpoint('/api/admin/feedback', 'POST')).toBe('admin');
      expect(categorizeEndpoint('/api/admin/review/queue', 'GET')).toBe('admin');
    });

    it('classifies reads vs mutations', () => {
      expect(categorizeEndpoint('/api/taxonomy/acc', 'GET')).toBe('read');
      expect(categorizeEndpoint('/api/taxonomy/acc', 'PUT')).toBe('mutation');
      expect(categorizeEndpoint('/api/debates', 'POST')).toBe('mutation');
      expect(categorizeEndpoint('/api/debates/abc', 'DELETE')).toBe('mutation');
    });
  });

  describe('resilientFetch — basic', () => {
    it('returns successful response without retry', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { ok: true }));
      const res = await resilientFetch('/api/test', {}, defaultOpts());
      expect(res.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns 4xx without retrying', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(404));
      const res = await resilientFetch('/api/test', {}, defaultOpts({ maxRetries: 3 }));
      expect(res.status).toBe(404);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('passes method and body through to fetch', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200));
      await resilientFetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"x":1}',
      }, defaultOpts({ category: 'mutation' }));
      const call = fetchSpy.mock.calls[0];
      expect(call[0]).toBe('/api/test');
      expect(call[1].method).toBe('POST');
      expect(call[1].body).toBe('{"x":1}');
    });
  });

  describe('resilientFetch — retry on 5xx', () => {
    it('retries on 500 and succeeds on second attempt', async () => {
      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse(500))
        .mockResolvedValueOnce(mockFetchResponse(200, { ok: true }));
      const promise = resilientFetch('/api/test', {}, defaultOpts({ maxRetries: 1 }));
      await vi.advanceTimersByTimeAsync(5000);
      const res = await promise;
      expect(res.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('returns final 500 response after exhausting retries', async () => {
      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse(500))
        .mockResolvedValueOnce(mockFetchResponse(502));
      const promise = resilientFetch('/api/test', {}, defaultOpts({ maxRetries: 1 }));
      await vi.advanceTimersByTimeAsync(5000);
      const res = await promise;
      expect(res.status).toBe(502);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('retries up to maxRetries times', async () => {
      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse(503))
        .mockResolvedValueOnce(mockFetchResponse(503))
        .mockResolvedValueOnce(mockFetchResponse(503))
        .mockResolvedValueOnce(mockFetchResponse(200));
      const promise = resilientFetch('/api/test', {}, defaultOpts({ maxRetries: 3 }));
      await vi.advanceTimersByTimeAsync(60000);
      const res = await promise;
      expect(res.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe('resilientFetch — retry on network error', () => {
    it('retries on TypeError (fetch failure)', async () => {
      fetchSpy
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(mockFetchResponse(200));
      const promise = resilientFetch('/api/test', {}, defaultOpts({ maxRetries: 1 }));
      await vi.advanceTimersByTimeAsync(5000);
      const res = await promise;
      expect(res.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('throws TypeError after exhausting retries', async () => {
      fetchSpy
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const promise = resilientFetch('/api/test', {}, defaultOpts({ maxRetries: 1 }));
      // Attach rejection handler before advancing timers to avoid unhandled rejection
      const rejection = expect(promise).rejects.toThrow('Failed to fetch');
      await vi.advanceTimersByTimeAsync(5000);
      await rejection;
    });
  });

  describe('resilientFetch — 429 with Retry-After', () => {
    it('respects Retry-After header in seconds', async () => {
      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse(429, {}, { 'Retry-After': '2' }))
        .mockResolvedValueOnce(mockFetchResponse(200));
      const promise = resilientFetch('/api/test', {}, defaultOpts({ maxRetries: 1 }));
      await vi.advanceTimersByTimeAsync(5000);
      const res = await promise;
      expect(res.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('skips retry when Retry-After exceeds 30s', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(429, {}, { 'Retry-After': '120' }));
      const res = await resilientFetch('/api/test', {}, defaultOpts({ maxRetries: 3 }));
      expect(res.status).toBe(429);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('circuit breaker', () => {
    it('opens after 5 consecutive failures', async () => {
      for (let i = 0; i < 5; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/test', {}, defaultOpts());
      }
      const state = getResilienceState();
      expect(state.circuits.read.state).toBe('OPEN');
      expect(state.circuits.read.consecutiveFailures).toBe(5);
    });

    it('rejects immediately when circuit is OPEN', async () => {
      for (let i = 0; i < 5; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/test', {}, defaultOpts());
      }
      await expect(
        resilientFetch('/api/test', {}, defaultOpts()),
      ).rejects.toThrow(/Circuit breaker OPEN/);
      expect(fetchSpy).toHaveBeenCalledTimes(5);
    });

    it('includes failure reasons in the OPEN error message', async () => {
      for (let i = 0; i < 3; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/test', {}, defaultOpts());
      }
      for (let i = 0; i < 2; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(503));
        await resilientFetch('/api/test', {}, defaultOpts());
      }
      await expect(
        resilientFetch('/api/test', {}, defaultOpts()),
      ).rejects.toThrow(/Last failures: HTTP 500 \(x3\), HTTP 503 \(x2\)/);
    });

    it('does not count 429 as a circuit breaker failure', async () => {
      for (let i = 0; i < 10; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(429));
        await resilientFetch('/api/test', {}, defaultOpts());
      }
      const state = getResilienceState();
      expect(state.circuits.read.state).toBe('CLOSED');
      expect(state.circuits.read.consecutiveFailures).toBe(0);
    });

    it('transitions to HALF_OPEN after cooldown', async () => {
      for (let i = 0; i < 5; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/test', {}, defaultOpts());
      }
      expect(getResilienceState().circuits.read.state).toBe('OPEN');

      vi.advanceTimersByTime(60_001);
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200));
      const res = await resilientFetch('/api/test', {}, defaultOpts());
      expect(res.ok).toBe(true);
      expect(getResilienceState().circuits.read.state).toBe('CLOSED');
    });

    it('re-opens if HALF_OPEN probe fails', async () => {
      for (let i = 0; i < 5; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/test', {}, defaultOpts());
      }
      vi.advanceTimersByTime(60_001);
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
      await resilientFetch('/api/test', {}, defaultOpts());
      expect(getResilienceState().circuits.read.state).toBe('OPEN');
    });

    it('resets on success', async () => {
      for (let i = 0; i < 3; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/test', {}, defaultOpts());
      }
      expect(getResilienceState().circuits.read.consecutiveFailures).toBe(3);

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200));
      await resilientFetch('/api/test', {}, defaultOpts());
      expect(getResilienceState().circuits.read.consecutiveFailures).toBe(0);
    });

    it('exposes recentFailures in state', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
      await resilientFetch('/api/test', {}, defaultOpts());
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(503));
      await resilientFetch('/api/test', {}, defaultOpts());
      const state = getResilienceState();
      expect(state.circuits.read.recentFailures).toEqual(['HTTP 500', 'HTTP 503']);
    });

    it('clears recentFailures on success', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
      await resilientFetch('/api/test', {}, defaultOpts());
      expect(getResilienceState().circuits.read.recentFailures).toHaveLength(1);

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200));
      await resilientFetch('/api/test', {}, defaultOpts());
      expect(getResilienceState().circuits.read.recentFailures).toEqual([]);
    });

    it('caps recentFailures at 5 entries', async () => {
      // Use maxRetries to accumulate more failures without the circuit blocking calls.
      // 1 call with maxRetries=3 → 4 failures from retries, then 1 more call → 5 total.
      // Then succeed to reset count (not buffer check), then fail 3 more → 8 total recorded,
      // but buffer should be capped at 5.
      // Simpler: the circuit opens at 5 — all 5 fit in the cap. Verify cap via HALF_OPEN probe.
      for (let i = 0; i < 5; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/test', {}, defaultOpts());
      }
      expect(getResilienceState().circuits.read.recentFailures).toHaveLength(5);

      // Advance past cooldown, fail the HALF_OPEN probe → 6th failure, cap still 5
      vi.advanceTimersByTime(60_001);
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
      await resilientFetch('/api/test', {}, defaultOpts());
      expect(getResilienceState().circuits.read.recentFailures).toHaveLength(5);
      expect(getResilienceState().circuits.read.consecutiveFailures).toBe(6);
    });

    it('isolates categories — AI failures do not affect read circuit', async () => {
      for (let i = 0; i < 5; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/ai/generate', { method: 'POST' }, defaultOpts({ category: 'ai' }));
      }
      expect(getResilienceState().circuits.ai.state).toBe('OPEN');
      expect(getResilienceState().circuits.read.state).toBe('CLOSED');
    });
  });

  describe('circuit breaker flight recorder events', () => {
    function findRecordCall(type: string) {
      return mockRecord.mock.calls.find(
        (c: unknown[]) => (c[0] as { type: string }).type === type,
      );
    }

    it('emits structured data when circuit opens', async () => {
      for (let i = 0; i < 5; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/test', {}, defaultOpts());
      }
      const call = findRecordCall('network.circuit_open');
      expect(call).toBeDefined();
      const event = call![0] as Record<string, unknown>;
      expect(event.level).toBe('error');
      expect(event.data).toMatchObject({
        category: 'read',
        state: 'OPEN',
        trigger: 'threshold_exceeded',
        consecutiveFailures: 5,
      });
      expect((event.data as { recentFailures: string[] }).recentFailures).toHaveLength(5);
    });

    it('emits structured data on HALF_OPEN transition', async () => {
      for (let i = 0; i < 5; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/test', {}, defaultOpts());
      }
      mockRecord.mockClear();

      vi.advanceTimersByTime(60_001);
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200));
      await resilientFetch('/api/test', {}, defaultOpts());

      const halfOpenCall = findRecordCall('network.circuit_half_open');
      expect(halfOpenCall).toBeDefined();
      const event = halfOpenCall![0] as Record<string, unknown>;
      expect(event.data).toMatchObject({
        category: 'read',
        state: 'HALF_OPEN',
        consecutiveFailures: 5,
      });
    });

    it('emits structured data on CLOSED transition after probe success', async () => {
      for (let i = 0; i < 5; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/test', {}, defaultOpts());
      }
      mockRecord.mockClear();

      vi.advanceTimersByTime(60_001);
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200));
      await resilientFetch('/api/test', {}, defaultOpts());

      const closedCall = findRecordCall('network.circuit_closed');
      expect(closedCall).toBeDefined();
      const event = closedCall![0] as Record<string, unknown>;
      expect(event.data).toMatchObject({
        category: 'read',
        state: 'CLOSED',
        previousFailures: 5,
      });
    });

    it('emits re-OPEN event with probe failure details', async () => {
      for (let i = 0; i < 5; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/test', {}, defaultOpts());
      }
      mockRecord.mockClear();

      vi.advanceTimersByTime(60_001);
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(503));
      await resilientFetch('/api/test', {}, defaultOpts());

      const openCall = findRecordCall('network.circuit_open');
      expect(openCall).toBeDefined();
      const event = openCall![0] as Record<string, unknown>;
      expect(event.level).toBe('warn');
      expect(event.data).toMatchObject({
        category: 'read',
        state: 'OPEN',
        trigger: 'half_open_probe_failed',
        lastFailure: 'HTTP 503',
      });
    });
  });

  describe('adaptive throttle', () => {
    it('starts in NORMAL state', () => {
      const state = getResilienceState();
      expect(state.throttles.read.state).toBe('NORMAL');
    });

    it('does not block critical requests even when THROTTLED', async () => {
      // Feed baseline: 10 fast requests, then 10 slow ones to push p95 above 2× baseline
      const perfNow = vi.spyOn(performance, 'now');
      let fakeTime = 1000;
      perfNow.mockImplementation(() => fakeTime);

      for (let i = 0; i < 20; i++) {
        fetchSpy.mockImplementationOnce(async () => {
          // Simulate: first 10 take 100ms, next 10 take 5000ms
          fakeTime += i < 10 ? 100 : 5000;
          return mockFetchResponse(200);
        });
        await resilientFetch('/api/test', {}, defaultOpts());
      }

      const state = getResilienceState();
      expect(state.throttles.read.state).toBe('THROTTLED');

      // Critical request should NOT wait for the 2s throttle delay
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200));
      fakeTime += 1;
      const res = await resilientFetch('/api/test', {}, defaultOpts({ critical: true }));
      expect(res.ok).toBe(true);

      perfNow.mockRestore();
    });
  });

  describe('subscribeResilience', () => {
    it('notifies on circuit state changes', async () => {
      const listener = vi.fn();
      const unsub = subscribeResilience(listener);

      for (let i = 0; i < 5; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/test', {}, defaultOpts());
      }

      // Should have been called when circuit opened
      expect(listener).toHaveBeenCalled();
      const lastCall = listener.mock.calls[listener.mock.calls.length - 1][0];
      expect(lastCall.circuits.read.state).toBe('OPEN');

      unsub();
    });

    it('stops notifying after unsubscribe', async () => {
      const listener = vi.fn();
      const unsub = subscribeResilience(listener);
      unsub();

      for (let i = 0; i < 5; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/test', {}, defaultOpts());
      }

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('getResilienceState', () => {
    it('returns state for all categories', () => {
      const state = getResilienceState();
      const cats: EndpointCategory[] = ['read', 'mutation', 'ai', 'admin', 'telemetry'];
      for (const cat of cats) {
        expect(state.circuits[cat]).toBeDefined();
        expect(state.circuits[cat].state).toBe('CLOSED');
        expect(state.throttles[cat]).toBeDefined();
        expect(state.throttles[cat].state).toBe('NORMAL');
      }
    });
  });

  describe('resetResilience', () => {
    it('clears all state', async () => {
      for (let i = 0; i < 5; i++) {
        fetchSpy.mockResolvedValueOnce(mockFetchResponse(500));
        await resilientFetch('/api/test', {}, defaultOpts());
      }
      expect(getResilienceState().circuits.read.state).toBe('OPEN');

      resetResilience();
      expect(getResilienceState().circuits.read.state).toBe('CLOSED');
      expect(getResilienceState().circuits.read.consecutiveFailures).toBe(0);
    });
  });
});
