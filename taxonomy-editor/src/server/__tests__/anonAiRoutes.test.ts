// @vitest-environment node
//
// t/2489 — anonymous users may use AI chat via the free tier. The exemption is the
// FREE_TIER_AI_POST_PATHS allowlist consumed by isFreeTierRoute (server.ts); the
// anon_route_blocked guard stays for everything else. These assert the allowlist
// membership directly (the pure half; the freeTierEnabled() gate is applied by the
// caller) plus the negative arm: other AI routes are NOT exempt.

import { describe, it, expect } from 'vitest';
import { isFreeTierAiPath, FREE_TIER_AI_POST_PATHS } from '../anonAiRoutes.js';

describe('t/2489 — free-tier AI route allowlist (anon chat exemption)', () => {
  it('POST /api/ai/chat-stream is on the allowlist (the new anon-chat exemption)', () => {
    expect(isFreeTierAiPath('POST', '/api/ai/chat-stream')).toBe(true);
    expect(FREE_TIER_AI_POST_PATHS).toContain('/api/ai/chat-stream');
  });

  it('the pre-existing free-tier routes remain exempt (no regression)', () => {
    expect(isFreeTierAiPath('POST', '/api/ai/generate')).toBe(true);
    expect(isFreeTierAiPath('POST', '/api/embeddings/compute')).toBe(true);
    expect(isFreeTierAiPath('POST', '/api/embeddings/query')).toBe(true);
  });

  // ── Negative arm (TL guardrail #1): other AI routes stay anon-blocked ──
  it('other AI routes are NOT exempt — the anon block still applies to them', () => {
    // These have cost/abuse/key surface and must keep returning anon_route_blocked.
    expect(isFreeTierAiPath('POST', '/api/keys')).toBe(false);
    expect(isFreeTierAiPath('POST', '/api/ai/embed')).toBe(false);
    expect(isFreeTierAiPath('POST', '/api/nli/entail')).toBe(false);
    expect(isFreeTierAiPath('POST', '/api/ai/generate-stream')).toBe(false);
  });

  it('exact-match only — a sibling sub-path of an allowlisted route is NOT exempt', () => {
    // Prefix bleed would expose /api/ai/generate/x, /api/ai/chat-stream/x, etc.
    expect(isFreeTierAiPath('POST', '/api/ai/chat-stream/x')).toBe(false);
    expect(isFreeTierAiPath('POST', '/api/ai/generate/x')).toBe(false);
    expect(isFreeTierAiPath('POST', '/api/ai/chat-streamX')).toBe(false);
  });

  it('method-scoped — only POST is exempt (GET/PUT/DELETE of the same path are not)', () => {
    expect(isFreeTierAiPath('GET', '/api/ai/chat-stream')).toBe(false);
    expect(isFreeTierAiPath('PUT', '/api/ai/chat-stream')).toBe(false);
    expect(isFreeTierAiPath('DELETE', '/api/ai/generate')).toBe(false);
  });
});
