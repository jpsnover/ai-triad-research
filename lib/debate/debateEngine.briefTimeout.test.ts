// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3518 Phase 2 seam test: proves that the opening phase composes
// DEFAULT_BRIEF_TIMEOUT_MS with getModelMinTimeout via Math.max.
// A mock returning 300_000 must yield briefTimeoutMs = 300_000, not 120_000.
// If the Math.max wiring or adapter delegation were deleted, this fails.

import { describe, it, expect } from 'vitest';
import { DebateEngine } from './debateEngine.js';
import type { ExtendedAIAdapter, GenerateOptions } from './aiAdapter.js';
import { createMinimalTaxonomy, createDefaultConfig } from './debateEngine.testHelpers.js';

describe('Opening brief timeout floor wiring (t/3518)', () => {
  it('brief gets 300_000 when getModelMinTimeout returns 300_000 (> DEFAULT_BRIEF_TIMEOUT_MS)', async () => {
    const capturedTimeouts: Array<number | undefined> = [];

    const adapter: ExtendedAIAdapter = {
      async generateText(_prompt: string, _model: string, opts?: GenerateOptions) {
        capturedTimeouts.push(opts?.timeoutMs);
        return '{"response":"mock"}';
      },
      getModelMinTimeout: (_model) => 300_000,
    };

    const engine = new DebateEngine(
      createDefaultConfig({ rounds: 1 }),
      adapter,
      createMinimalTaxonomy(),
    );

    try { await engine.run(); } catch { /* engine may throw on mock responses — we only need the call log */ }

    // The brief for each debater gets briefTimeoutMs = Math.max(DEFAULT_BRIEF_TIMEOUT_MS,
    // engine.adapter.getModelMinTimeout(model)) = Math.max(120_000, 300_000) = 300_000.
    // Other calls (init, synthesis, etc.) use DEFAULT_AI_TIMEOUT_MS = 120_000.
    // At least one call must have seen 300_000 — if the Math.max wiring is deleted or the
    // adapter delegation is broken, every call stays at 120_000 and this fails.
    expect(capturedTimeouts.length).toBeGreaterThan(0);
    expect(capturedTimeouts).toContain(300_000);
  });
});
