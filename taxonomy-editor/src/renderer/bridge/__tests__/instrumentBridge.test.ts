import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRecord = vi.fn();
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: mockRecord, intern: (_ns: string, v: string) => v }),
}));

vi.mock('../../lib/analyticsEmitter', () => ({
  trackAICall: vi.fn(),
}));

import { instrumentBridge } from '../instrumentBridge';
import type { AppAPI } from '../types';

/** Build a minimal AppAPI whose only method rejects with the given httpStatus. */
function apiRejectingWith(method: string, httpStatus?: number): AppAPI {
  const err = Object.assign(new Error(`HTTP ${httpStatus ?? 'network'}`), { httpStatus });
  return { [method]: () => Promise.reject(err) } as unknown as AppAPI;
}

/** Return the failure-record the wrapped call emitted (the last recorded event). */
function lastRecord(): { level: string; message: string; data?: { http_status?: number } } {
  return mockRecord.mock.calls.at(-1)?.[0] as { level: string; message: string; data?: { http_status?: number } };
}

describe('instrumentBridge — expected-status downgrade (t/2395)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downgrades an expected 403 on getDataRoot to debug', async () => {
    const api = instrumentBridge(apiRejectingWith('getDataRoot', 403));
    await expect((api as unknown as { getDataRoot: () => Promise<string> }).getDataRoot()).rejects.toThrow();

    const rec = lastRecord();
    expect(rec.level).toBe('debug');
    expect(rec.message).toBe('bridge.getDataRoot expected 403');
    expect(rec.data?.http_status).toBe(403);
  });

  it('keeps a NON-expected status on getDataRoot at error (no blanket downgrade)', async () => {
    const api = instrumentBridge(apiRejectingWith('getDataRoot', 500));
    await expect((api as unknown as { getDataRoot: () => Promise<string> }).getDataRoot()).rejects.toThrow();

    const rec = lastRecord();
    expect(rec.level).toBe('error');
    expect(rec.message).toBe('bridge.getDataRoot failed');
  });

  it('keeps a 403 on an unlisted method at error (per-method allowlist)', async () => {
    const api = instrumentBridge(apiRejectingWith('loadEdges', 403));
    await expect((api as unknown as { loadEdges: () => Promise<unknown> }).loadEdges()).rejects.toThrow();

    const rec = lastRecord();
    expect(rec.level).toBe('error');
    expect(rec.message).toBe('bridge.loadEdges failed');
  });

  it('still records the event when downgraded (ADR-003 — level drops, record stays)', async () => {
    const api = instrumentBridge(apiRejectingWith('getDataRoot', 403));
    await expect((api as unknown as { getDataRoot: () => Promise<string> }).getDataRoot()).rejects.toThrow();

    // start (debug) + failure (debug) — the failure event is still present
    const failure = mockRecord.mock.calls
      .map((c) => c[0] as { message: string })
      .find((e) => e.message === 'bridge.getDataRoot expected 403');
    expect(failure).toBeDefined();
  });
});
