// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Mock Electron's net.fetch (the probe's network call).
const fetchMock = vi.fn();
vi.mock('electron', () => ({ net: { fetch: (...args: unknown[]) => fetchMock(...args) } }));

// fileIO.ts pulls in Electron's `app` at module load (AGENTS.md: modules using app/
// safeStorage can't be imported directly in vitest) — mock it and modelConfigCache.js
// (t/3556) so the probe's registry resolution is deterministic and doesn't touch disk.
vi.mock('../fileIO.js', () => ({ PROJECT_ROOT: '/fake/root' }));
const resolveDebateTierModelMock = vi.fn();
const resolveModelEntryMock = vi.fn();
vi.mock('../modelConfigCache.js', () => ({
  resolveDebateTierModel: (...args: unknown[]) => resolveDebateTierModelMock(...args),
  resolveModelEntry: (...args: unknown[]) => resolveModelEntryMock(...args),
}));

import { probeApiKey, isSupportedProbeBackend, SUPPORTED_PROBE_BACKENDS } from '../keyProbe.js';

beforeEach(() => {
  fetchMock.mockReset();
  resolveDebateTierModelMock.mockReset().mockReturnValue('gemini-3.5-flash-lite');
  resolveModelEntryMock.mockReset().mockReturnValue({ apiModelId: 'gemini-3.5-flash-lite' });
});

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

  it('gemini probe model is resolved from the registry, not hardcoded (t/3556 regression)', async () => {
    resolveDebateTierModelMock.mockReturnValue('gemini-9.9-future');
    resolveModelEntryMock.mockReturnValue({ apiModelId: 'gemini-9.9-future-api-id' });
    fetchMock.mockResolvedValueOnce({ ok: true });

    await probeApiKey('gemini', 'k');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('gemini-9.9-future-api-id');
    expect(url).not.toContain('gemini-2.0-flash'); // the retired model that caused t/3556
    expect(resolveDebateTierModelMock).toHaveBeenCalledWith(expect.any(String), 'basic', 'gemini');
  });

  it('gemini probe falls back to a literal (with a warning) when the registry cannot resolve a model — never throws', async () => {
    resolveDebateTierModelMock.mockReturnValue(undefined);
    fetchMock.mockResolvedValueOnce({ ok: true });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const valid = await probeApiKey('gemini', 'k');

    expect(valid).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ai-models.json'));
    warnSpy.mockRestore();
  });

  it('zai, deepseek, moonshot, and xai are supported (not falling through to Unsupported) and hit the right endpoints', async () => {
    expect(isSupportedProbeBackend('zai')).toBe(true);
    expect(isSupportedProbeBackend('deepseek')).toBe(true);
    expect(isSupportedProbeBackend('moonshot')).toBe(true);
    expect(isSupportedProbeBackend('xai')).toBe(true);

    fetchMock.mockResolvedValue({ ok: true });
    await probeApiKey('zai', 'k');
    expect(fetchMock.mock.calls.at(-1)![0]).toContain('api.z.ai');
    await probeApiKey('deepseek', 'k');
    expect(fetchMock.mock.calls.at(-1)![0]).toContain('api.deepseek.com');
    // t/3600: moonshot and xai were entirely missing (SUPPORTED_PROBE_BACKENDS stopped at 6
    // of the 8 registered hosted backends) — Test Keys reported "Unsupported backend" for
    // both despite the server-side probes already working.
    await probeApiKey('moonshot', 'k');
    const [moonshotUrl, moonshotOpts] = fetchMock.mock.calls.at(-1) as [string, { headers?: Record<string, string> }];
    expect(moonshotUrl).toBe('https://api.moonshot.ai/v1/models');
    expect(moonshotOpts.headers?.Authorization).toBe('Bearer k');
    await probeApiKey('xai', 'k');
    const [xaiUrl, xaiOpts] = fetchMock.mock.calls.at(-1) as [string, { headers?: Record<string, string> }];
    expect(xaiUrl).toBe('https://api.x.ai/v1/models');
    expect(xaiOpts.headers?.Authorization).toBe('Bearer k');
  });

  it('throws for an unsupported backend (handlers gate with isSupportedProbeBackend first)', async () => {
    expect(isSupportedProbeBackend('ollama')).toBe(false);
    await expect(probeApiKey('ollama', 'k')).rejects.toThrow(/Unsupported backend/);
  });
});

// t/3600 — probe completeness (mirrors server/__tests__/keysValidation.test.ts, t/1458). The
// prior version of this test PINNED the literal backend list instead of deriving it, so it
// didn't just fail to catch the moonshot/xai gap — it defended it: adding the two probes
// without updating this test's own literal would have gone red, inviting whoever landed the
// fix to "fix" the test back to matching, not to notice the completeness property it was
// supposed to protect had been dropped entirely. Reading the registry at runtime instead
// means the NEXT backend addition fails loudly here too, not just on the server (where this
// exact class of gap had already recurred 3 times before it recurred here a 4th).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

// Local-only backends have no hosted key to validate against a provider endpoint —
// intentionally excluded from the completeness requirement (mirrors keysValidation.test.ts).
const LOCAL_ONLY = new Set(['azure', 'ollama']);

describe('key-probe completeness (t/3600)', () => {
  it('every registered backend except local-only has an Electron probe', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'ai-models.json'), 'utf-8'),
    ) as { backends?: { id: string }[] };

    const registered = (config.backends ?? []).map(b => b.id).filter(id => !LOCAL_ONLY.has(id));
    expect(registered.length).toBeGreaterThan(0); // guard: config actually loaded

    const missing = registered.filter(id => !isSupportedProbeBackend(id));
    expect(
      missing,
      `Backend(s) [${missing.join(', ')}] have no key-probe in keyProbe.ts — ` +
      `Electron Test Keys will report "Unsupported backend" for them. Add each to SUPPORTED_PROBE_BACKENDS + probeApiKey.`,
    ).toEqual([]);
  });

  it('does not carry probes for local-only backends (they have no hosted key)', () => {
    for (const id of LOCAL_ONLY) {
      expect(isSupportedProbeBackend(id)).toBe(false);
    }
  });
});
