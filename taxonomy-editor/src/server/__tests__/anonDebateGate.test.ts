// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3230 — enforceAnonDebateGate. A single anonymous debate drains the shared free Gemini key pool
// (K=4) → 429 storm → ~485s retry → user-facing 500 (prod incident, owner-approved disable). The
// gate 403s free-tier DEBATE generation (isFree && debateId) BEFORE any key/provider call, and is
// reversible via the `anon-debates` feature flag. These arms lock: blocked only for free+debate+
// flag-off; pass-through for flag-on, non-debate, and authenticated; flag not consulted when the
// cheap isFree/debateId guards already exclude the request (short-circuit).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerResponse } from 'http';

const { anonEnabled, record } = vi.hoisted(() => ({ anonEnabled: vi.fn(), record: vi.fn() }));
vi.mock('../featureFlags.js', () => ({ isAnonDebatesEnabled: anonEnabled }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record }) }));
// onnxEmbedding is pulled in transitively via aiBackends; stub it so the import is cheap + hermetic.
vi.mock('../../../../lib/embeddings/onnxEmbedding.js', () => ({
  tryWarmup: vi.fn(async () => false), warmup: vi.fn(async () => false),
  computeEmbedding: vi.fn(async () => []), computeEmbeddings: vi.fn(async () => []),
}));

import { enforceAnonDebateGate } from '../routes/generationContext.js';

/** Minimal ServerResponse stub capturing writeHead/end. */
function makeRes(): ServerResponse & { statusCode: number; body: string; ended: boolean } {
  const res = {
    statusCode: 0, body: '', ended: false,
    writeHead(code: number) { this.statusCode = code; return this; },
    end(chunk?: string) { this.body = chunk ?? ''; this.ended = true; return this; },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string; ended: boolean };
}

describe('enforceAnonDebateGate (t/3230)', () => {
  beforeEach(() => { anonEnabled.mockReset(); record.mockReset(); });

  it('free-tier debate + flag OFF → 403 (handled), non-retryable body, records a warn', () => {
    anonEnabled.mockReturnValue(false);
    const res = makeRes();
    const handled = enforceAnonDebateGate(res, true, 'deb-123');
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.reason).toBe('anon_debates_disabled');
    expect(body.retryable).toBe(false);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({ level: 'warn', component: 'ai-generate' });
  });

  it('free-tier debate + flag ON → pass-through (no response sent)', () => {
    anonEnabled.mockReturnValue(true);
    const res = makeRes();
    expect(enforceAnonDebateGate(res, true, 'deb-123')).toBe(false);
    expect(res.ended).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });

  it('free-tier NON-debate (no debateId) → pass-through even with flag OFF', () => {
    anonEnabled.mockReturnValue(false);
    const res = makeRes();
    expect(enforceAnonDebateGate(res, true, undefined)).toBe(false);
    expect(res.ended).toBe(false);
  });

  it('authenticated/paid debate (isFree=false) → pass-through even with flag OFF', () => {
    anonEnabled.mockReturnValue(false);
    const res = makeRes();
    expect(enforceAnonDebateGate(res, false, 'deb-123')).toBe(false);
    expect(res.ended).toBe(false);
  });

  it('short-circuit: the flag is NOT read when isFree is false or debateId is absent', () => {
    anonEnabled.mockReturnValue(false);
    enforceAnonDebateGate(makeRes(), false, 'deb-123');
    enforceAnonDebateGate(makeRes(), true, undefined);
    expect(anonEnabled).not.toHaveBeenCalled();
  });
});
