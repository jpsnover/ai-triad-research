// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// FaultHarness gate (t/3055, prevention for the t/3053 incident). A real HTTP 429 at the AI
// endpoint must flow through the web-bridge's error-shape mapping to a *retryable*
// ActionableError carrying httpStatus:429 + a "Retry in Ns" window — the exact chain that
// crossRespond's moderator backoff (t/3053) depends on. The store-level backoff arms (#1585)
// inject a SYNTHETIC {httpStatus:429} and so cannot catch a regression in THIS mapping; this
// closes that single-context gap. /add-fault-test — see t/3055#2/#3.
import { describe, it, expect, vi } from 'vitest';
import { FaultHarness, type FaultProfile } from '@lib/debate/__tests__/faultInjection';
import { classifyAiRetry, parseRetryAfterMs } from '../utils/retryClassifier';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => undefined }));

import { api } from './web-bridge';

const always429: FaultProfile = {
  name: 'always429',
  description: 'AI endpoint returns HTTP 429 on every call (t/3055)',
  faults: [{ target: 'ai-call', trigger: 'always', effect: 'throw-429' }],
};

describe('web-bridge AI 429 → retryable ActionableError chain (t/3055 FaultHarness gate)', () => {
  it('maps a real 429 at /api/ai/generate to httpStatus:429 + a retry window the classifier accepts', async () => {
    const harness = new FaultHarness(always429);
    harness.install();
    try {
      const err = await api.generateText('hello', 'gemini-3.5-flash-lite', 30_000, 0.8)
        .then(() => null, (e: unknown) => e);

      // The fault fired → we exercised the real fetch path (not a mock).
      expect(harness.stats.errors, 'FaultHarness 429 fired').toBeGreaterThanOrEqual(1);

      // web-bridge maps the 429 into a structured, retryable ActionableError.
      expect(err, 'generateText rejects on 429').toBeInstanceOf(Error);
      expect((err as Error).name).toBe('ActionableError');
      expect((err as { httpStatus?: number }).httpStatus, 'httpStatus attached from the 429').toBe(429);
      expect((err as Error).message).toMatch(/Retry in \d+s/);

      // …which the retry classifier + parser (t/3048, used by the crossRespond backoff) accept.
      expect(classifyAiRetry(err)).toEqual({ retryable: true, reason: 'rate_limit' });
      // Specific value (TL must-have): the FaultHarness 429 body carries no retryAfterMs, so the
      // bridge defaults to 60s → 60000ms — assert the exact N, not just non-undefined.
      expect(parseRetryAfterMs(err)).toBe(60_000);
    } finally {
      harness.teardown();
    }
  });
});
