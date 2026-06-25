// @vitest-environment node

/**
 * t/948 — paid Gemini fallback key resolver. The key-store `_system` partition
 * takes precedence; the GEMINI_PAID_KEY env var is the fallback. With no stored
 * `_system` key in the test data root, these exercise the env-var path + null case.
 * (The full key-store path + the server catch-and-retry are covered by deploy
 * acceptance — server.ts isn't import-testable.)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { getPaidGeminiFallbackKey } from '../config.js';

describe('getPaidGeminiFallbackKey (t/948)', () => {
  afterEach(() => { delete process.env.GEMINI_PAID_KEY; });

  it('falls back to GEMINI_PAID_KEY when no key-store entry exists', async () => {
    process.env.GEMINI_PAID_KEY = 'paid-key-xyz';
    expect(await getPaidGeminiFallbackKey()).toBe('paid-key-xyz');
  });

  it('trims surrounding whitespace from the env var', async () => {
    process.env.GEMINI_PAID_KEY = '  paid-key-xyz  ';
    expect(await getPaidGeminiFallbackKey()).toBe('paid-key-xyz');
  });

  it('returns null when neither the key store nor the env var is configured', async () => {
    expect(await getPaidGeminiFallbackKey()).toBeNull();
  });

  it('treats a blank env var as unset (null, not empty string)', async () => {
    process.env.GEMINI_PAID_KEY = '   ';
    expect(await getPaidGeminiFallbackKey()).toBeNull();
  });
});
