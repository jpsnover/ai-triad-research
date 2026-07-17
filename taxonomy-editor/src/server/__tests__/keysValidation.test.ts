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
import { KEY_VALIDATION_PROBES, validateProviderKey, deriveKeyErrorMessage, extractProviderReason } from '../routes/keys.js';
import { setGlobalRecorder } from '../../../../lib/flight-recorder/index.js';

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

// t/1620 — a non-200 probe must surface the *real* provider cause instead of the
// blanket "Invalid API key" the old code returned for every failure. A known-good
// key that is Vertex-only, restricted, or on a project without the Generative
// Language API enabled was falsely labeled invalid; these tests pin the specific
// verdicts derived from the Google error body ({ error: { status, message,
// details:[{reason}] } }) and confirm no key material leaks into the message.
describe('non-200 probe surfaces the specific provider cause (t/1620)', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks(); });

  // The required AC: a 403 SERVICE_DISABLED body must NOT map to "Invalid API key".
  it('maps a 403 SERVICE_DISABLED body to a distinct, non-"Invalid API key" verdict (AC)', async () => {
    const body = {
      error: {
        code: 403,
        status: 'PERMISSION_DENIED',
        message: 'Generative Language API has not been used in project 123 before or it is disabled.',
        details: [{ reason: 'SERVICE_DISABLED' }],
      },
    };
    global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 403 })) as unknown as typeof fetch;

    const verdict = await validateProviderKey('gemini', 'good-but-api-disabled-key');
    expect(verdict.valid).toBe(false);
    expect(verdict.error).not.toBe('Invalid API key');
    expect(verdict.error).toMatch(/api is not enabled/i);
    // Never echo key material back to the caller.
    expect(verdict.error).not.toContain('good-but-api-disabled-key');
  });

  it('maps API_KEY_INVALID (400) to the genuine invalid-key message', () => {
    expect(deriveKeyErrorMessage(400, 'API_KEY_INVALID')).toBe('Invalid API key');
  });

  it('maps a referrer/IP restriction to a restricted-key message, not invalid', () => {
    const msg = deriveKeyErrorMessage(403, 'API_KEY_HTTP_REFERRER_BLOCKED');
    expect(msg).toMatch(/restricted/i);
    expect(msg).not.toBe('Invalid API key');
  });

  it('maps 429 / RESOURCE_EXHAUSTED to a quota message (key is fine)', () => {
    expect(deriveKeyErrorMessage(429, 'RESOURCE_EXHAUSTED')).toMatch(/quota|rate-limit/i);
    expect(deriveKeyErrorMessage(429, undefined)).toMatch(/quota|rate-limit/i);
  });

  it('maps a bare PERMISSION_DENIED (403) to a permission message, not invalid', () => {
    const msg = deriveKeyErrorMessage(403, 'PERMISSION_DENIED');
    expect(msg).toMatch(/permission/i);
    expect(msg).not.toBe('Invalid API key');
  });

  it('falls back to a status-aware message when no reason is present', () => {
    expect(deriveKeyErrorMessage(503, undefined)).toMatch(/HTTP 503/);
  });

  it('extractProviderReason prefers details[].reason, then status/code/type', () => {
    expect(extractProviderReason({ error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }))
      .toBe('SERVICE_DISABLED');
    expect(extractProviderReason({ error: { status: 'RESOURCE_EXHAUSTED' } })).toBe('RESOURCE_EXHAUSTED');
    expect(extractProviderReason({ error: { code: 'invalid_api_key', type: 'authentication_error' } })).toBe('invalid_api_key');
    expect(extractProviderReason({ error: { type: 'authentication_error' } })).toBe('authentication_error');
    expect(extractProviderReason({})).toBeUndefined();
    expect(extractProviderReason(null)).toBeUndefined();
  });

  it('records the non-200 verdict to the flight recorder with backend/status/reason and no key material', async () => {
    const recorded: Record<string, unknown>[] = [];
    setGlobalRecorder({ record: (e: Record<string, unknown>) => { recorded.push(e); } } as never);
    try {
      const body = { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } };
      global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 403 })) as unknown as typeof fetch;
      await validateProviderKey('gemini', 'secret-key-value');

      const evt = recorded.find(e => e.component === 'key-validation');
      expect(evt, 'a key-validation event should be recorded for the non-200').toBeDefined();
      expect(evt!.data).toMatchObject({ backend: 'gemini', httpStatus: 403, reason: 'SERVICE_DISABLED' });
      // The whole event must never carry key material — the key rides in the URL,
      // not the recorded payload.
      expect(JSON.stringify(evt)).not.toContain('secret-key-value');
    } finally {
      setGlobalRecorder(null as never);
    }
  });
});
