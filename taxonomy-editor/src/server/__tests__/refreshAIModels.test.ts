// @vitest-environment node

/**
 * t/1624 — refreshAIModels() must surface the *specific* Gemini model-discovery
 * failure (SERVICE_DISABLED / restricted / quota / invalid) instead of collapsing
 * every non-200 into a bare `HTTP ${status}`, and must record it structured to the
 * flight recorder — with NO key material, since the key rides in the fetch URL.
 *
 * These tests mock getApiKey (so a key is present) and global.fetch (so we control
 * the provider response), then assert both the returned `error` message and the
 * recorded FR event carry { backend, httpStatus, reason } and never the key.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// Keep every real config export except getApiKey (which would otherwise reach the
// keystore / disk). refreshAIModels only calls getApiKey; the rest are untouched.
vi.mock('../config.js', async (importActual) => {
  const actual = await importActual<typeof import('../config.js')>();
  return { ...actual, getApiKey: vi.fn(async () => 'secret-key-value') };
});

import { refreshAIModels } from '../ai/aiBackends.js';
import { setGlobalRecorder } from '../../../../lib/flight-recorder/index.js';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks(); setGlobalRecorder(null as never); });

describe('refreshAIModels surfaces the specific Gemini failure (t/1624)', () => {
  it('maps a 403 SERVICE_DISABLED body to a distinct message and records it with no key material', async () => {
    const recorded: Record<string, unknown>[] = [];
    setGlobalRecorder({ record: (e: Record<string, unknown>) => { recorded.push(e); } } as never);

    const body = {
      error: {
        code: 403,
        status: 'PERMISSION_DENIED',
        message: 'Generative Language API has not been used in project 123 before or it is disabled.',
        details: [{ reason: 'SERVICE_DISABLED' }],
      },
    };
    global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 403 })) as unknown as typeof fetch;

    const result = await refreshAIModels() as Record<string, { ok: boolean; count: number; error?: string }>;

    // Specific verdict, not a bare HTTP status and not "Invalid API key".
    expect(result.gemini.ok).toBe(false);
    expect(result.gemini.error).toMatch(/api is not enabled/i);
    expect(result.gemini.error).not.toMatch(/^HTTP 403$/);
    expect(result.gemini.error).not.toBe('Invalid API key');

    // FR event carries { backend, httpStatus, reason } and never the key.
    const evt = recorded.find(e => e.component === 'ai-backends');
    expect(evt, 'an ai-backends event should be recorded for the non-200').toBeDefined();
    expect(evt!.data).toMatchObject({ backend: 'gemini', httpStatus: 403, reason: 'SERVICE_DISABLED' });
    expect(JSON.stringify(evt)).not.toContain('secret-key-value');
  });

  it('records reason:null and a status-aware message when the error body is absent/non-JSON', async () => {
    const recorded: Record<string, unknown>[] = [];
    setGlobalRecorder({ record: (e: Record<string, unknown>) => { recorded.push(e); } } as never);

    // Non-JSON body → extractProviderReason throws → reason stays undefined.
    global.fetch = vi.fn(async () => new Response('gateway timeout', { status: 503 })) as unknown as typeof fetch;

    const result = await refreshAIModels() as Record<string, { ok: boolean; count: number; error?: string }>;
    expect(result.gemini.ok).toBe(false);
    expect(result.gemini.error).toMatch(/HTTP 503/);

    const evt = recorded.find(e => e.component === 'ai-backends');
    expect(evt!.data).toMatchObject({ backend: 'gemini', httpStatus: 503, reason: null });
    expect(JSON.stringify(evt)).not.toContain('secret-key-value');
  });
});
