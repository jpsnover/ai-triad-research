// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Electron's net.fetch (the probe's network call).
const fetchMock = vi.fn();
vi.mock('electron', () => ({ net: { fetch: (...args: unknown[]) => fetchMock(...args) } }));

import { probeApiKey, isSupportedProbeBackend, SUPPORTED_PROBE_BACKENDS } from '../keyProbe.js';

beforeEach(() => fetchMock.mockReset());

describe('keyProbe (t/1573)', () => {
  it('gemini probes generateContent — NOT list-models — and reflects r.ok (false-green fix)', async () => {
    // The bug: a key that 200s on GET /models?key=... but 401s on generateContent.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    const valid = await probeApiKey('gemini', 'bad-but-lists');
    expect(valid).toBe(false);

    const [url, opts] = fetchMock.mock.calls[0] as [string, { method?: string; body?: string }];
    expect(url).toContain('generateContent');
    expect(url).not.toContain('/models?key='); // must not be the permissive list endpoint
    expect(opts.method).toBe('POST');
    expect(opts.body).toContain('maxOutputTokens'); // minimal generation request
  });

  it('gemini returns true when generateContent 200s', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    expect(await probeApiKey('gemini', 'good')).toBe(true);
  });

  it('zai and deepseek are supported (not falling through to Unsupported) and hit the right endpoints', async () => {
    expect(isSupportedProbeBackend('zai')).toBe(true);
    expect(isSupportedProbeBackend('deepseek')).toBe(true);

    fetchMock.mockResolvedValue({ ok: true });
    await probeApiKey('zai', 'k');
    expect(fetchMock.mock.calls.at(-1)![0]).toContain('api.z.ai');
    await probeApiKey('deepseek', 'k');
    expect(fetchMock.mock.calls.at(-1)![0]).toContain('api.deepseek.com');
  });

  it('covers the full canonical backend set (matches KEY_VALIDATION_PROBES)', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    for (const b of SUPPORTED_PROBE_BACKENDS) {
      expect(await probeApiKey(b, 'k')).toBe(true);
    }
    expect([...SUPPORTED_PROBE_BACKENDS]).toEqual(['gemini', 'claude', 'groq', 'openai', 'deepseek', 'zai']);
  });

  it('throws for an unsupported backend (handlers gate with isSupportedProbeBackend first)', async () => {
    expect(isSupportedProbeBackend('ollama')).toBe(false);
    await expect(probeApiKey('ollama', 'k')).rejects.toThrow(/Unsupported backend/);
  });
});
