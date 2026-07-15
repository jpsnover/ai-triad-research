// @vitest-environment node

/**
 * t/1458 — key-validation probe completeness.
 *
 * The Test Keys feature reported "Unsupported backend" for openai/deepseek/zai
 * because validateProviderKey() was never updated when those backends were added
 * (the gap recurred 3×). This test is the guard that catches the *next* backend
 * addition: it asserts every backend registered in ai-models.json (except the
 * local-only ones) has an entry in KEY_VALIDATION_PROBES, so a new backend can't
 * ship without a validation probe.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { KEY_VALIDATION_PROBES, validateProviderKey } from '../routes/keys.js';
import { KEY_PROBE_CONFIGS } from '../../shared/keyProbes.js';

// ai-models.json is the canonical backend registry at the repo root. Resolve it
// relative to this test file (deterministic) rather than via getProjectRoot(),
// which is cwd-sensitive under vitest. __tests__ → server → src → taxonomy-editor
// → repo root.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

// Local-only backends have no hosted key to validate against a provider endpoint
// (per t/1458 AC) — intentionally excluded from the completeness requirement.
const LOCAL_ONLY = new Set(['ollama', 'azure']);

describe('key-validation probe completeness (t/1458)', () => {
  it('every registered backend except local-only has a validation probe', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'ai-models.json'), 'utf-8'),
    ) as { backends?: { id: string }[] };

    const registered = (config.backends ?? []).map(b => b.id).filter(id => !LOCAL_ONLY.has(id));
    expect(registered.length).toBeGreaterThan(0); // guard: config actually loaded

    const missing = registered.filter(id => !KEY_VALIDATION_PROBES[id]);
    expect(
      missing,
      `Backend(s) [${missing.join(', ')}] have no key-validation probe in routes/keys.ts — ` +
      `Test Keys will report "Unsupported backend" for them. Add each to KEY_VALIDATION_PROBES.`,
    ).toEqual([]);
  });

  it('does not carry probes for local-only backends (they have no hosted key)', () => {
    for (const id of LOCAL_ONLY) {
      expect(KEY_VALIDATION_PROBES[id]).toBeUndefined();
    }
  });

  it('KEY_VALIDATION_PROBES covers every entry in KEY_PROBE_CONFIGS (t/1574 drift guard)', () => {
    const sharedIds = Object.keys(KEY_PROBE_CONFIGS).sort();
    const localIds = Object.keys(KEY_VALIDATION_PROBES).sort();
    expect(localIds).toEqual(sharedIds);
  });
});

// t/1572 — the Gemini probe must hit generateContent (the real auth surface), not
// the list-models endpoint, which returns 200 for any key and produced a
// false-green for invalid keys. These tests mock global.fetch and assert both the
// verdict and the endpoint actually called.
describe('gemini key probe uses generateContent, not list-models (t/1572)', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks(); });

  it('reports valid:false when generateContent returns 401, and never hits the list endpoint (AC#2/#4)', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      // list-models would 200 for any key; generateContent gates on auth → 401.
      return new Response(JSON.stringify({ error: { code: 401 } }), { status: 401 });
    }) as unknown as typeof fetch;

    const verdict = await validateProviderKey('gemini', 'bad-key');
    expect(verdict.valid).toBe(false);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('gemini-2.0-flash:generateContent');
    expect(calls[0].url).not.toContain('/v1beta/models?key='); // NOT the permissive list endpoint
    expect(calls[0].init?.method).toBe('POST');
    expect(String(calls[0].init?.body)).toContain('maxOutputTokens');
  });

  it('reports valid:true when generateContent returns 200 (AC#3 happy path)', async () => {
    global.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const verdict = await validateProviderKey('gemini', 'good-key');
    expect(verdict.valid).toBe(true);
  });

  it('reports valid:false with a provider-unreachable message on network error (AC#3 unchanged)', async () => {
    global.fetch = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const verdict = await validateProviderKey('gemini', 'any-key');
    expect(verdict.valid).toBe(false);
    expect(verdict.error).toMatch(/could not reach provider/i);
  });
});
