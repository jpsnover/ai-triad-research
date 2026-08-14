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

/** Find the ok-completion event for a bridge method (its enriched result meta). */
function okRecord(method: string): { message: string; data?: Record<string, unknown> } | undefined {
  return mockRecord.mock.calls
    .map((c) => c[0] as { message: string; data?: Record<string, unknown> })
    .find((e) => e.message === `bridge.${method} ok`);
}

describe('instrumentBridge — listOpEdSets result shape (t/2606)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('records result_type=summary + has_opeds=false for the summary index', async () => {
    const rows = [{ set_id: 'a', topic: 'T', camps: ['acc'], voice_count: 1 }];
    const api = instrumentBridge({ listOpEdSets: () => Promise.resolve(rows) } as unknown as AppAPI);
    await (api as unknown as { listOpEdSets: () => Promise<unknown> }).listOpEdSets();

    const ok = okRecord('listOpEdSets');
    expect(ok?.data?.count).toBe(1);
    expect(ok?.data?.result_type).toBe('summary');
    expect(ok?.data?.has_opeds).toBe(false);
  });

  it('records result_type=full + has_opeds=true if full OpEdSets leak through (the t/2605 shape)', async () => {
    const full = [{ set_id: 'a', topic: 'T', opeds: [{ pov: 'acc' }] }];
    const api = instrumentBridge({ listOpEdSets: () => Promise.resolve(full) } as unknown as AppAPI);
    await (api as unknown as { listOpEdSets: () => Promise<unknown> }).listOpEdSets();

    const ok = okRecord('listOpEdSets');
    expect(ok?.data?.result_type).toBe('full');
    expect(ok?.data?.has_opeds).toBe(true);
  });

  it('records result_type=summary for an empty list (expected default)', async () => {
    const api = instrumentBridge({ listOpEdSets: () => Promise.resolve([]) } as unknown as AppAPI);
    await (api as unknown as { listOpEdSets: () => Promise<unknown> }).listOpEdSets();

    const ok = okRecord('listOpEdSets');
    expect(ok?.data?.count).toBe(0);
    expect(ok?.data?.result_type).toBe('summary');
  });
});

describe('instrumentBridge — loadOpEdSet grounding presence (t/2621)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('records has_grounding=true + grounded_member_count when some members are grounded', async () => {
    const set = { set_id: 'a', topic: 'T', opeds: [
      { pov: 'acc', grounding: [{ node_id: 'acc-b-001' }, { node_id: 'acc-b-002' }] },
      { pov: 'saf', grounding: [] },
    ] };
    const api = instrumentBridge({ loadOpEdSet: () => Promise.resolve(set) } as unknown as AppAPI);
    await (api as unknown as { loadOpEdSet: (id: string) => Promise<unknown> }).loadOpEdSet('a');

    const ok = okRecord('loadOpEdSet');
    expect(ok?.data?.member_count).toBe(2);
    expect(ok?.data?.has_grounding).toBe(true);
    expect(ok?.data?.grounded_member_count).toBe(1);
  });

  it('records has_grounding=false when no member carries grounding', async () => {
    const set = { set_id: 'a', topic: 'T', opeds: [{ pov: 'acc', grounding: [] }, { pov: 'saf' }] };
    const api = instrumentBridge({ loadOpEdSet: () => Promise.resolve(set) } as unknown as AppAPI);
    await (api as unknown as { loadOpEdSet: (id: string) => Promise<unknown> }).loadOpEdSet('a');

    const ok = okRecord('loadOpEdSet');
    expect(ok?.data?.member_count).toBe(2);
    expect(ok?.data?.has_grounding).toBe(false);
    expect(ok?.data?.grounded_member_count).toBe(0);
  });
});

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
