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
  warmUpCount: 6,
  warmUpDiscardCount: 2,
  warmUpIntervalMs: 5_000,
  windowSize: 20,
  enterFactor: 2.0,
  exitFactor: 1.5,
  gracePeriodMs: 30_000,
  timeoutMs: 10_000,
  thresholdFloorMs: 500,
  coldStartMultiple: 50,
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
    it('establishes baseline from kept warm-up samples (discarding first two)', async () => {
      let callCount = 0;
      fetchSpy.mockImplementation(async () => {
        callCount++;
        const latency = callCount <= 2 ? 200 : 100;
        vi.advanceTimersByTime(latency);
        return { ok: true, json: () => Promise.resolve({}) } as unknown as Response;
      });

      const mod = await loadModule();
      mod.initHealthProbe();

      // First probe fires immediately, then 5 more at warmUpInterval
      await vi.advanceTimersByTimeAsync(0);
      for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(5_000);

      const state = mod.getProbeState();
      expect(state.phase).toBe('steady');
      // First 2 samples (200ms) discarded, kept 4 at 100ms each → baseline = 100
      expect(state.baseline).toBe(100);
    });

    it('handles all probes failing during warm-up', async () => {
      failFetch();
      const mod = await loadModule();
      mod.initHealthProbe();

      await vi.advanceTimersByTimeAsync(0);
      for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(5_000);

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
    it('triggers THROTTLED when p95 exceeds enterFactor × baseline (floor disabled)', async () => {
      probeConfig = {
        ...defaultProbeConfig,
        warmUpCount: 1,
        warmUpDiscardCount: 0,
        gracePeriodMs: 0,
        intervalMs: 1_000,
        windowSize: 3,
        thresholdFloorMs: 0,
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

    it('clears THROTTLED when p95 drops below exitFactor × baseline (floor disabled)', async () => {
      probeConfig = {
        ...defaultProbeConfig,
        warmUpCount: 1,
        warmUpDiscardCount: 0,
        gracePeriodMs: 0,
        intervalMs: 1_000,
        windowSize: 2,
        thresholdFloorMs: 0,
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

    it('threshold floor prevents false alerts on low-latency baselines (t/1148)', async () => {
      probeConfig = {
        ...defaultProbeConfig,
        warmUpCount: 1,
        warmUpDiscardCount: 0,
        gracePeriodMs: 0,
        intervalMs: 1_000,
        windowSize: 3,
        thresholdFloorMs: 500,
      };

      let callCount = 0;
      fetchSpy.mockImplementation(async () => {
        callCount++;
        // baseline=4ms, steady=50ms — above 2× baseline (8ms) but well below 500ms floor
        const latency = callCount === 1 ? 4 : 50;
        vi.advanceTimersByTime(latency);
        return { ok: true, json: () => Promise.resolve({}) } as unknown as Response;
      });

      const mod = await loadModule();
      mod.initHealthProbe();
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);

      // Should NOT trigger THROTTLED — 50ms is below the 500ms floor
      expect(mockSetThrottle).not.toHaveBeenCalledWith('THROTTLED', expect.any(Number), expect.any(Number));
      mod.stopHealthProbe();
    });
  });

  describe('cold-start exclusion (t/1148)', () => {
    it('excludes latency spikes exceeding coldStartMultiple × baseline', async () => {
      probeConfig = {
        ...defaultProbeConfig,
        warmUpCount: 1,
        warmUpDiscardCount: 0,
        gracePeriodMs: 0,
        intervalMs: 1_000,
        windowSize: 5,
        thresholdFloorMs: 0,
        coldStartMultiple: 50,
      };

      let callCount = 0;
      fetchSpy.mockImplementation(async () => {
        callCount++;
        // baseline=100ms, then a 6000ms cold-start spike, then normal
        let latency: number;
        if (callCount === 1) latency = 100;
        else if (callCount === 2) latency = 6000;
        else latency = 120;
        vi.advanceTimersByTime(latency);
        return { ok: true, json: () => Promise.resolve({}) } as unknown as Response;
      });

      const mod = await loadModule();
      mod.initHealthProbe();
      await vi.advanceTimersByTimeAsync(0);

      // Cold-start spike probe (6000ms > 50 × 100ms = 5000ms) — should be excluded
      await vi.advanceTimersByTimeAsync(1_000);
      // Normal probes
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);

      const state = mod.getProbeState();
      // Cold-start was excluded, so only the normal 120ms probes are in the window
      expect(state.sampleCount).toBe(2);
      expect(mockSetThrottle).not.toHaveBeenCalledWith('THROTTLED', expect.any(Number), expect.any(Number));
      mod.stopHealthProbe();
    });
  });

  describe('consecutive-good-poll recovery (t/1151)', () => {
    it('clears THROTTLED after 3 consecutive good polls even when p95 is still high', async () => {
      probeConfig = {
        ...defaultProbeConfig,
        warmUpCount: 1,
        warmUpDiscardCount: 0,
        gracePeriodMs: 0,
        intervalMs: 1_000,
        windowSize: 10,
        thresholdFloorMs: 0,
      };

      let callCount = 0;
      fetchSpy.mockImplementation(async () => {
        callCount++;
        let latency: number;
        if (callCount === 1) latency = 100; // warm-up baseline
        else if (callCount <= 9) latency = 300; // 8 high-latency fills → THROTTLED
        else latency = 50; // recovery polls (50 < 100 * 1.5 = 150 exit threshold)
        vi.advanceTimersByTime(latency);
        return { ok: true, json: () => Promise.resolve({}) } as unknown as Response;
      });

      const mod = await loadModule();
      mod.initHealthProbe();
      await vi.advanceTimersByTimeAsync(0);

      // Fill window with high-latency probes to trigger THROTTLED
      for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(1_000);
      expect(mockSetThrottle).toHaveBeenCalledWith('THROTTLED', expect.any(Number), 100);

      mockSetThrottle.mockClear();

      // 1st and 2nd good polls — not enough yet (p95 of window still high)
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockSetThrottle).not.toHaveBeenCalledWith('NORMAL', expect.any(Number), expect.any(Number));

      // 3rd consecutive good poll triggers recovery
      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockSetThrottle).toHaveBeenCalledWith('NORMAL', expect.any(Number), 100);

      // Window was flushed — only the recovery sample remains
      const state = mod.getProbeState();
      expect(state.sampleCount).toBe(1);

      mod.stopHealthProbe();
    });

    it('resets consecutive counter when a bad poll interrupts recovery', async () => {
      probeConfig = {
        ...defaultProbeConfig,
        warmUpCount: 1,
        warmUpDiscardCount: 0,
        gracePeriodMs: 0,
        intervalMs: 1_000,
        windowSize: 10,
        thresholdFloorMs: 0,
      };

      let callCount = 0;
      fetchSpy.mockImplementation(async () => {
        callCount++;
        let latency: number;
        if (callCount === 1) latency = 100;
        else if (callCount <= 9) latency = 300; // fill → THROTTLED
        else if (callCount <= 11) latency = 50; // 2 good polls
        else if (callCount === 12) latency = 300; // bad poll interrupts
        else latency = 50; // resume good polls
        vi.advanceTimersByTime(latency);
        return { ok: true, json: () => Promise.resolve({}) } as unknown as Response;
      });

      const mod = await loadModule();
      mod.initHealthProbe();
      await vi.advanceTimersByTimeAsync(0);

      for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(1_000);
      expect(mockSetThrottle).toHaveBeenCalledWith('THROTTLED', expect.any(Number), 100);
      mockSetThrottle.mockClear();

      // 2 good polls, then a bad one
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000); // bad — resets counter

      // Next 2 good polls (only 2 consecutive, not 3)
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockSetThrottle).not.toHaveBeenCalledWith('NORMAL', expect.any(Number), expect.any(Number));

      // 3rd consecutive good poll after the reset → now triggers recovery
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
