import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useResilienceStatus } from './useResilienceStatus';
import type { ResilienceStatus, EndpointCategory, CircuitState, ThrottleState } from '../bridge/resilience';

vi.mock('../bridge/resilience', () => {
  const ALL: EndpointCategory[] = ['read', 'mutation', 'ai', 'admin', 'telemetry'];
  const mkState = (
    overrides?: Partial<Record<EndpointCategory, { state: CircuitState; consecutiveFailures: number }>>,
    throttleOverrides?: Partial<Record<EndpointCategory, { state: ThrottleState; p95Ms: number; baselineMs: number }>>,
  ): ResilienceStatus => {
    const circuits = {} as ResilienceStatus['circuits'];
    const throttles = {} as ResilienceStatus['throttles'];
    for (const c of ALL) {
      circuits[c] = { state: 'CLOSED', consecutiveFailures: 0, ...overrides?.[c] };
      throttles[c] = { state: 'NORMAL', p95Ms: 0, baselineMs: 0, ...throttleOverrides?.[c] };
    }
    return { circuits, throttles };
  };

  return {
    subscribeResilience: vi.fn(() => () => {}),
    getResilienceState: vi.fn(() => mkState()),
    mkState,
  };
});

const { mkState } = await import('../bridge/resilience') as unknown as {
  mkState: (
    overrides?: Partial<Record<EndpointCategory, { state: CircuitState; consecutiveFailures: number }>>,
    throttleOverrides?: Partial<Record<EndpointCategory, { state: ThrottleState; p95Ms: number; baselineMs: number }>>,
  ) => ResilienceStatus;
};

function simulate(status: ResilienceStatus) {
  useResilienceStatus.getState()._handleUpdate(status);
}

describe('useResilienceStatus', () => {
  beforeEach(() => {
    useResilienceStatus.setState({
      alerts: [],
      toasts: [],
      _prevCircuits: { read: 'CLOSED', mutation: 'CLOSED', ai: 'CLOSED', admin: 'CLOSED', telemetry: 'CLOSED' },
      _prevThrottles: { read: 'NORMAL', mutation: 'NORMAL', ai: 'NORMAL', admin: 'NORMAL', telemetry: 'NORMAL' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with empty alerts and toasts', () => {
    const { alerts, toasts } = useResilienceStatus.getState();
    expect(alerts).toEqual([]);
    expect(toasts).toEqual([]);
  });

  describe('alerts', () => {
    it('creates server-down alert when circuit opens', () => {
      simulate(mkState({ read: { state: 'OPEN', consecutiveFailures: 5 } }));
      const { alerts } = useResilienceStatus.getState();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].kind).toBe('server-down');
      expect(alerts[0].category).toBe('read');
      expect(alerts[0].message).toContain('Data unavailable');
    });

    it('creates reconnecting alert when circuit is half-open', () => {
      simulate(mkState({ ai: { state: 'HALF_OPEN', consecutiveFailures: 5 } }));
      const { alerts } = useResilienceStatus.getState();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].kind).toBe('reconnecting');
      expect(alerts[0].message).toContain('AI service reconnecting');
    });

    it('creates degraded alert when throttle activates', () => {
      simulate(mkState(undefined, { read: { state: 'THROTTLED', p95Ms: 2000, baselineMs: 500 } }));
      const { alerts } = useResilienceStatus.getState();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].kind).toBe('degraded');
      expect(alerts[0].message).toContain('responding slowly');
    });

    it('stacks multiple alerts', () => {
      simulate(mkState(
        { read: { state: 'OPEN', consecutiveFailures: 5 }, ai: { state: 'HALF_OPEN', consecutiveFailures: 5 } },
        { mutation: { state: 'THROTTLED', p95Ms: 2000, baselineMs: 500 } },
      ));
      const { alerts } = useResilienceStatus.getState();
      expect(alerts).toHaveLength(3);
    });

    it('clears alerts when state recovers', () => {
      simulate(mkState({ read: { state: 'OPEN', consecutiveFailures: 5 } }));
      expect(useResilienceStatus.getState().alerts).toHaveLength(1);

      simulate(mkState());
      expect(useResilienceStatus.getState().alerts).toHaveLength(0);
    });

    it('ignores telemetry category', () => {
      simulate(mkState({ telemetry: { state: 'OPEN', consecutiveFailures: 5 } }));
      const { alerts } = useResilienceStatus.getState();
      expect(alerts).toHaveLength(0);
    });
  });

  describe('recovery toasts', () => {
    it('emits toast when circuit closes after being open', () => {
      useResilienceStatus.setState({
        _prevCircuits: { read: 'OPEN', mutation: 'CLOSED', ai: 'CLOSED', admin: 'CLOSED', telemetry: 'CLOSED' },
      });
      simulate(mkState());
      const { toasts } = useResilienceStatus.getState();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toContain('Data restored');
    });

    it('emits toast when circuit closes after being half-open', () => {
      useResilienceStatus.setState({
        _prevCircuits: { read: 'CLOSED', mutation: 'CLOSED', ai: 'HALF_OPEN', admin: 'CLOSED', telemetry: 'CLOSED' },
      });
      simulate(mkState());
      const { toasts } = useResilienceStatus.getState();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toContain('AI service restored');
    });

    it('emits toast when throttle clears', () => {
      useResilienceStatus.setState({
        _prevThrottles: { read: 'THROTTLED', mutation: 'NORMAL', ai: 'NORMAL', admin: 'NORMAL', telemetry: 'NORMAL' },
      });
      simulate(mkState());
      const { toasts } = useResilienceStatus.getState();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toContain('response times recovered');
    });

    it('does not emit toast for CLOSED→CLOSED (no change)', () => {
      simulate(mkState());
      const { toasts } = useResilienceStatus.getState();
      expect(toasts).toHaveLength(0);
    });

    it('dismissToast removes a toast by id', () => {
      useResilienceStatus.setState({
        _prevCircuits: { read: 'OPEN', mutation: 'CLOSED', ai: 'CLOSED', admin: 'CLOSED', telemetry: 'CLOSED' },
      });
      simulate(mkState());
      const { toasts, dismissToast } = useResilienceStatus.getState();
      expect(toasts).toHaveLength(1);
      dismissToast(toasts[0].id);
      expect(useResilienceStatus.getState().toasts).toHaveLength(0);
    });
  });

  describe('category labels', () => {
    it('uses correct label for mutation category', () => {
      simulate(mkState({ mutation: { state: 'OPEN', consecutiveFailures: 5 } }));
      const { alerts } = useResilienceStatus.getState();
      expect(alerts[0].message).toContain('Save unavailable');
    });

    it('uses correct label for admin category', () => {
      simulate(mkState({ admin: { state: 'OPEN', consecutiveFailures: 5 } }));
      const { alerts } = useResilienceStatus.getState();
      expect(alerts[0].message).toContain('Admin unavailable');
    });
  });
});
