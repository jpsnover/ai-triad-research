// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3206 — the /internal/canary/* anon-exemption is FLAG-GATED: auth-exempt ONLY when
// CANARY_LOOP_SAMPLER is set (staging canary rev). Prod (flag off) → NOT exempt (double-closed with
// the route 404). Real computeIsPublicPath + real config env read (no mocks) — toggling the env.

import { describe, it, expect, afterEach } from 'vitest';
import { computeIsPublicPath } from '../publicPaths.js';

describe('computeIsPublicPath — canary flag-gated exemption (t/3206)', () => {
  afterEach(() => { delete process.env.CANARY_LOOP_SAMPLER; });

  it('flag OFF: /internal/canary/* is NOT auth-exempt (prod double-closed)', () => {
    delete process.env.CANARY_LOOP_SAMPLER;
    expect(computeIsPublicPath('/internal/canary/loop-sampler/start')).toBe(false);
    expect(computeIsPublicPath('/internal/canary/loop-sampler/report')).toBe(false);
  });

  it('flag ON: /internal/canary/* IS auth-exempt (staging canary rev, headless driver)', () => {
    process.env.CANARY_LOOP_SAMPLER = '1';
    expect(computeIsPublicPath('/internal/canary/loop-sampler/start')).toBe(true);
    expect(computeIsPublicPath('/internal/canary/loop-sampler/report')).toBe(true);
  });

  it('flag ON: the exemption is scoped to EXACTLY /internal/canary/, not a broad /internal/', () => {
    process.env.CANARY_LOOP_SAMPLER = 'true';
    expect(computeIsPublicPath('/internal/admin/secret')).toBe(false); // not widened
    expect(computeIsPublicPath('/internal/')).toBe(false);
  });

  it('flag ON does not disturb the static allowlist (a normal API path stays non-public)', () => {
    process.env.CANARY_LOOP_SAMPLER = '1';
    expect(computeIsPublicPath('/api/taxonomy/acc')).toBe(false);
    expect(computeIsPublicPath('/readyz')).toBe(true); // existing exact-match still works
  });
});
