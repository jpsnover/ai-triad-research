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

/** Build a minimal AppAPI whose only method rejects with a 429 carrying a structured retryAfterS. */
function apiRejecting429(method: string, retryAfterS?: number): AppAPI {
  const err = Object.assign(new Error('Rate limit exceeded'), { httpStatus: 429, retryAfterS });
  return { [method]: () => Promise.reject(err) } as unknown as AppAPI;
}

/** Return the failure-record the wrapped call emitted (the last recorded event). */
function lastRecord(): { level: string; message: string; data?: { http_status?: number; retry_after_s?: number } } {
  return mockRecord.mock.calls.at(-1)?.[0] as { level: string; message: string; data?: { http_status?: number; retry_after_s?: number } };
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

describe('instrumentBridge — structured 429 retry_after_s (t/3054)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('records retry_after_s on a 429 failure when the error carries retryAfterS', async () => {
    const api = instrumentBridge(apiRejecting429('generateText', 22));
    await expect((api as unknown as { generateText: () => Promise<unknown> }).generateText()).rejects.toThrow();

    const rec = lastRecord();
    expect(rec.data?.http_status).toBe(429);
    expect(rec.data?.retry_after_s).toBe(22);
  });

  it('omits retry_after_s when the 429 error has no structured cooldown', async () => {
    const api = instrumentBridge(apiRejecting429('generateText'));
    await expect((api as unknown as { generateText: () => Promise<unknown> }).generateText()).rejects.toThrow();

    const rec = lastRecord();
    expect(rec.data?.http_status).toBe(429);
    expect(rec.data?.retry_after_s).toBeUndefined();
  });

  it('omits retry_after_s for a non-429 status even if retryAfterS is present', async () => {
    const err = Object.assign(new Error('boom'), { httpStatus: 500, retryAfterS: 9 });
    const api = instrumentBridge({ generateText: () => Promise.reject(err) } as unknown as AppAPI);
    await expect((api as unknown as { generateText: () => Promise<unknown> }).generateText()).rejects.toThrow();

    const rec = lastRecord();
    expect(rec.data?.http_status).toBe(500);
    expect(rec.data?.retry_after_s).toBeUndefined();
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

describe('instrumentBridge — embedding batch_size (t/3071)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /** Find the request/start event for a bridge method (message `bridge.<method>`, no suffix). */
  function startRecord(method: string): { data?: Record<string, unknown> } | undefined {
    return mockRecord.mock.calls
      .map((c) => c[0] as { message: string; data?: Record<string, unknown> })
      .find((e) => e.message === `bridge.${method}`);
  }

  it('records batch_size = texts.length on the computeEmbeddings request event (the 2587 incident)', async () => {
    const texts = Array.from({ length: 2587 }, (_v, i) => `t${i}`);
    const api = instrumentBridge({ computeEmbeddings: () => Promise.resolve({ vectors: [] }) } as unknown as AppAPI);
    await (api as unknown as { computeEmbeddings: (t: string[]) => Promise<unknown> }).computeEmbeddings(texts);

    expect(startRecord('computeEmbeddings')?.data?.batch_size).toBe(2587);
  });

  it('records batch_size = 1 for a single-text computeQueryEmbedding', async () => {
    const api = instrumentBridge({ computeQueryEmbedding: () => Promise.resolve({ vector: [] }) } as unknown as AppAPI);
    await (api as unknown as { computeQueryEmbedding: (t: string) => Promise<unknown> }).computeQueryEmbedding('hello');

    expect(startRecord('computeQueryEmbedding')?.data?.batch_size).toBe(1);
  });

  it('omits batch_size for a non-embedding AI method (field is embedding-scoped)', async () => {
    const api = instrumentBridge({ generateText: () => Promise.resolve('ok') } as unknown as AppAPI);
    await (api as unknown as { generateText: () => Promise<unknown> }).generateText();

    const start = startRecord('generateText');
    expect(start).toBeDefined();
    expect(start?.data?.batch_size).toBeUndefined();
  });
});
