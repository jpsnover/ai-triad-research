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

describe('instrumentBridge — 429 rate-limit discriminators (t/3107)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('surfaces rate_limit_source + limit + current on the ai.error event for a 429', async () => {
    const err = Object.assign(new Error('Rate limit exceeded'), {
      httpStatus: 429, rateLimitSource: 'per_ip_rpm', limit: 20, current: 21,
    });
    const api = instrumentBridge({ generateText: () => Promise.reject(err) } as unknown as AppAPI);
    await expect((api as unknown as { generateText: () => Promise<unknown> }).generateText()).rejects.toThrow();

    const data = lastRecord().data as Record<string, unknown>;
    expect(data.rate_limit_source).toBe('per_ip_rpm');
    expect(data.limit).toBe(20);
    expect(data.current).toBe(21);
  });

  it('omits the rate-limit fields for a non-429 status', async () => {
    const err = Object.assign(new Error('boom'), { httpStatus: 500, rateLimitSource: 'per_ip_rpm', limit: 20, current: 21 });
    const api = instrumentBridge({ generateText: () => Promise.reject(err) } as unknown as AppAPI);
    await expect((api as unknown as { generateText: () => Promise<unknown> }).generateText()).rejects.toThrow();

    const data = lastRecord().data as Record<string, unknown>;
    expect(data.rate_limit_source).toBeUndefined();
    expect(data.limit).toBeUndefined();
  });

  it('omits fields absent from a partial 429 body (only what the server sent)', async () => {
    const err = Object.assign(new Error('Rate limit exceeded'), { httpStatus: 429, rateLimitSource: 'api_key_exhausted' });
    const api = instrumentBridge({ generateText: () => Promise.reject(err) } as unknown as AppAPI);
    await expect((api as unknown as { generateText: () => Promise<unknown> }).generateText()).rejects.toThrow();

    const data = lastRecord().data as Record<string, unknown>;
    expect(data.rate_limit_source).toBe('api_key_exhausted');
    expect(data.limit).toBeUndefined();
    expect(data.current).toBeUndefined();
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

describe('instrumentBridge — ai call metadata: model/timeoutMs/purpose (t/3519)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /** Find the request/start event for a bridge method (message `bridge.<method>`, no suffix). */
  function startRecord(method: string): { data?: Record<string, unknown> } | undefined {
    return mockRecord.mock.calls
      .map((c) => c[0] as { message: string; data?: Record<string, unknown> })
      .find((e) => e.message === `bridge.${method}`);
  }

  it('records model/timeoutMs/purpose on the ai.request start event for generateText', async () => {
    const api = instrumentBridge({ generateText: () => Promise.resolve({ text: 'ok' }) } as unknown as AppAPI);
    await (api as unknown as { generateText: (p: string, m: string, t: number, temp: number, o: { purpose?: string }) => Promise<unknown> })
      .generateText('prompt', 'claude-5-sonnet', 60_000, 0.7, { purpose: 'brief' });

    const start = startRecord('generateText');
    expect(start?.data?.model).toBe('claude-5-sonnet');
    expect(start?.data?.timeoutMs).toBe(60_000);
    expect(start?.data?.purpose).toBe('brief');
  });

  it('omits purpose when the caller passes no opts (optional field)', async () => {
    const api = instrumentBridge({ generateText: () => Promise.resolve({ text: 'ok' }) } as unknown as AppAPI);
    await (api as unknown as { generateText: (p: string, m: string, t: number) => Promise<unknown> })
      .generateText('prompt', 'claude-5-sonnet', 60_000);

    const start = startRecord('generateText');
    expect(start?.data?.model).toBe('claude-5-sonnet');
    expect(start?.data?.timeoutMs).toBe(60_000);
    expect(start?.data?.purpose).toBeUndefined();
  });

  it('records model/timeoutMs/purpose on the ai.response ok event', async () => {
    const api = instrumentBridge({ generateText: () => Promise.resolve({ text: 'ok' }) } as unknown as AppAPI);
    await (api as unknown as { generateText: (p: string, m: string, t: number, temp: number, o: { purpose?: string }) => Promise<unknown> })
      .generateText('prompt', 'claude-5-sonnet', 180_000, 0.7, { purpose: 'plan' });

    const ok = okRecord('generateText');
    expect(ok?.data?.model).toBe('claude-5-sonnet');
    expect(ok?.data?.timeoutMs).toBe(180_000);
    expect(ok?.data?.purpose).toBe('plan');
  });

  it('records model/timeoutMs/purpose on the ai.error event (the t/3518 diagnostic gap)', async () => {
    const api = instrumentBridge({ generateText: () => Promise.reject(new Error('timed out')) } as unknown as AppAPI);
    await expect(
      (api as unknown as { generateText: (p: string, m: string, t: number, temp: number, o: { purpose?: string }) => Promise<unknown> })
        .generateText('prompt', 'claude-5-sonnet', 60_000, 0.7, { purpose: 'brief' }),
    ).rejects.toThrow();

    const rec = lastRecord();
    expect(rec.data?.model).toBe('claude-5-sonnet');
    expect(rec.data?.timeoutMs).toBe(60_000);
    expect(rec.data?.purpose).toBe('brief');
  });

  it('records model on generateTextWithSearch and startChatStream (their model arg positions)', async () => {
    const api = instrumentBridge({
      generateTextWithSearch: () => Promise.resolve({ text: 'ok' }),
      startChatStream: () => Promise.resolve('ok'),
    } as unknown as AppAPI);

    await (api as unknown as { generateTextWithSearch: (p: string, m: string) => Promise<unknown> })
      .generateTextWithSearch('prompt', 'gemini-3-flash');
    expect(startRecord('generateTextWithSearch')?.data?.model).toBe('gemini-3-flash');

    await (api as unknown as { startChatStream: (s: string, msgs: unknown[], m: string) => Promise<unknown> })
      .startChatStream('system', [], 'claude-5-sonnet');
    expect(startRecord('startChatStream')?.data?.model).toBe('claude-5-sonnet');
  });

  it('omits model/timeoutMs/purpose for a non-AI method (field is ai-scoped)', async () => {
    const api = instrumentBridge({ loadEdges: () => Promise.resolve({ edges: [] }) } as unknown as AppAPI);
    await (api as unknown as { loadEdges: () => Promise<unknown> }).loadEdges();

    const start = startRecord('loadEdges');
    expect(start?.data?.model).toBeUndefined();
    expect(start?.data?.timeoutMs).toBeUndefined();
    expect(start?.data?.purpose).toBeUndefined();
  });
});
