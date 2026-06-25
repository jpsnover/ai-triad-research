import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRecord = vi.fn();
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

const mockSetThrottle = vi.fn();
vi.mock('../resilience', () => ({
  setThrottleFromProbe: (...args: unknown[]) => mockSetThrottle(...args),
}));

const defaultProbeConfig = {
  intervalMs: 30_000,
  warmUpCount: 3,
  warmUpDiscardCount: 1,
  warmUpIntervalMs: 5_000,
  windowSize: 10,
  enterFactor: 2.0,
  exitFactor: 1.5,
  gracePeriodMs: 15_000,
  timeoutMs: 10_000,
};

let probeConfig = { ...defaultProbeConfig };
vi.mock('../../lib/clientConfig', () => ({
  getClientConfig: () => ({
    healthProbe: probeConfig,
  }),
}));

async function loadModule() {
  const mod = await import('../healthProbe');
  return mod;
}

describe('healthProbe', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    mockRecord.mockClear();
    mockSetThrottle.mockClear();
    probeConfig = { ...defaultProbeConfig };
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function okFetch(latencyMs = 50) {
    fetchSpy.mockImplementation(async () => {
      vi.advanceTimersByTime(latencyMs);
      return {
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response;
    });
  }

  function failFetch() {
    fetchSpy.mockRejectedValue(new Error('network error'));
  }

  describe('warm-up phase', () => {
    it('establishes baseline from kept warm-up samples (discarding first)', async () => {
      let callCount = 0;
      fetchSpy.mockImplementation(async () => {
        callCount++;
        const latency = callCount === 1 ? 200 : 100;
        vi.advanceTimersByTime(latency);
        return { ok: true, json: () => Promise.resolve({}) } as unknown as Response;
      });

      const mod = await loadModule();
      mod.initHealthProbe();

      // First probe fires immediately
      await vi.advanceTimersByTimeAsync(0);
      // Wait for warmUpInterval between probes
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);

      const state = mod.getProbeState();
      expect(state.phase).toBe('steady');
      // First sample (200ms) discarded, kept two at 100ms each → baseline = 100
      expect(state.baseline).toBe(100);
    });

    it('handles all probes failing during warm-up', async () => {
      failFetch();
      const mod = await loadModule();
      mod.initHealthProbe();

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);

      const state = mod.getProbeState();
      expect(state.phase).toBe('steady');
      expect(state.baseline).toBe(0);
    });

    it('prevents double init', async () => {
      okFetch();
      const mod = await loadModule();
      mod.initHealthProbe();
      mod.initHealthProbe();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('grace period', () => {
    it('suppresses throttle during grace period even if p95 is high', async () => {
      probeConfig = { ...defaultProbeConfig, warmUpCount: 1, warmUpDiscardCount: 0, gracePeriodMs: 60_000 };
      let callCount = 0;
      fetchSpy.mockImplementation(async () => {
        callCount++;
        const latency = callCount === 1 ? 50 : 500;
        vi.advanceTimersByTime(latency);
        return { ok: true, json: () => Promise.resolve({}) } as unknown as Response;
      });

      const mod = await loadModule();
      mod.initHealthProbe();
      // Warm-up with 1 sample
      await vi.advanceTimersByTimeAsync(0);

      // First steady probe — high latency, but within grace period
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockSetThrottle).not.toHaveBeenCalled();

      mod.stopHealthProbe();
    });
  });

  describe('steady-state transitions', () => {
    it('triggers THROTTLED when p95 exceeds enterFactor × baseline', async () => {
      probeConfig = {
        ...defaultProbeConfig,
        warmUpCount: 1,
        warmUpDiscardCount: 0,
        gracePeriodMs: 0,
        intervalMs: 1_000,
        windowSize: 3,
      };

      let callCount = 0;
      fetchSpy.mockImplementation(async () => {
        callCount++;
        const latency = callCount === 1 ? 50 : 150;
        vi.advanceTimersByTime(latency);
        return { ok: true, json: () => Promise.resolve({}) } as unknown as Response;
      });

      const mod = await loadModule();
      mod.initHealthProbe();
      await vi.advanceTimersByTimeAsync(0);

      // Fill window with high-latency probes (150ms > 50 * 2.0 = 100)
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockSetThrottle).toHaveBeenCalledWith('THROTTLED', expect.any(Number), 50);
      mod.stopHealthProbe();
    });

    it('clears THROTTLED when p95 drops below exitFactor × baseline', async () => {
      probeConfig = {
        ...defaultProbeConfig,
        warmUpCount: 1,
        warmUpDiscardCount: 0,
        gracePeriodMs: 0,
        intervalMs: 1_000,
        windowSize: 2,
      };

      let callCount = 0;
      fetchSpy.mockImplementation(async () => {
        callCount++;
        // warm-up: 100ms baseline, then high, then low
        let latency: number;
        if (callCount === 1) latency = 100;
        else if (callCount <= 4) latency = 300;
        else latency = 50;
        vi.advanceTimersByTime(latency);
        return { ok: true, json: () => Promise.resolve({}) } as unknown as Response;
      });

      const mod = await loadModule();
      mod.initHealthProbe();
      await vi.advanceTimersByTimeAsync(0);

      // High latency probes → THROTTLED
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockSetThrottle).toHaveBeenCalledWith('THROTTLED', expect.any(Number), 100);

      mockSetThrottle.mockClear();
      // Low latency probes → NORMAL (50ms < 100 * 1.5 = 150)
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockSetThrottle).toHaveBeenCalledWith('NORMAL', expect.any(Number), 100);

      mod.stopHealthProbe();
    });
  });

  describe('probe failure handling', () => {
    it('records to flight recorder on fetch failure', async () => {
      probeConfig = { ...defaultProbeConfig, warmUpCount: 1, warmUpDiscardCount: 0 };
      failFetch();

      const mod = await loadModule();
      mod.initHealthProbe();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({
        type: 'system.error',
        component: 'health-probe',
        level: 'warn',
      }));
      mod.stopHealthProbe();
    });

    it('skips latency recording on null probe result', async () => {
      probeConfig = {
        ...defaultProbeConfig,
        warmUpCount: 1,
        warmUpDiscardCount: 0,
        gracePeriodMs: 0,
        intervalMs: 1_000,
      };

      let callCount = 0;
      fetchSpy.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          vi.advanceTimersByTime(50);
          return { ok: true, json: () => Promise.resolve({}) } as unknown as Response;
        }
        throw new Error('down');
      });

      const mod = await loadModule();
      mod.initHealthProbe();
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(1_000);
      // Failed probe shouldn't trigger state change
      expect(mockSetThrottle).not.toHaveBeenCalled();

      const state = mod.getProbeState();
      expect(state.sampleCount).toBe(0);
      mod.stopHealthProbe();
    });
  });

  describe('stopHealthProbe', () => {
    it('resets state to idle', async () => {
      probeConfig = { ...defaultProbeConfig, warmUpCount: 1, warmUpDiscardCount: 0 };
      okFetch();
      const mod = await loadModule();
      mod.initHealthProbe();
      await vi.advanceTimersByTimeAsync(0);

      expect(mod.getProbeState().phase).toBe('steady');
      mod.stopHealthProbe();
      expect(mod.getProbeState().phase).toBe('idle');
      expect(mod.getProbeState().baseline).toBe(0);
      expect(mod.getProbeState().sampleCount).toBe(0);
    });

    it('allows re-init after stop', async () => {
      probeConfig = { ...defaultProbeConfig, warmUpCount: 1, warmUpDiscardCount: 0 };
      okFetch();
      const mod = await loadModule();
      mod.initHealthProbe();
      await vi.advanceTimersByTimeAsync(0);
      mod.stopHealthProbe();

      mod.initHealthProbe();
      await vi.advanceTimersByTimeAsync(0);
      expect(mod.getProbeState().phase).toBe('steady');
      mod.stopHealthProbe();
    });
  });

  describe('getProbeState', () => {
    it('returns rounded values', async () => {
      probeConfig = { ...defaultProbeConfig, warmUpCount: 1, warmUpDiscardCount: 0 };
      fetchSpy.mockImplementation(async () => {
        vi.advanceTimersByTime(33.7);
        return { ok: true, json: () => Promise.resolve({}) } as unknown as Response;
      });

      const mod = await loadModule();
      mod.initHealthProbe();
      await vi.advanceTimersByTimeAsync(0);

      const state = mod.getProbeState();
      expect(state.baseline).toBe(34);
      expect(Number.isInteger(state.baseline)).toBe(true);
      expect(Number.isInteger(state.p95)).toBe(true);
      mod.stopHealthProbe();
    });
  });
});
