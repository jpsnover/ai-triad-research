// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Regression guard for t/1958 — the anonymous BYOK key paths in web-bridge must
 * cover EVERY backend in the canonical ALL_API_KEY_BACKENDS list. Before the fix,
 * each site re-typed a stale array that omitted `zai` and `moonshot`, so:
 *   - deleteAllApiKeys() left zai/moonshot keys behind in sessionStorage
 *   - getApiKeySummary() dropped zai/moonshot from the key-management summary
 * These tests fail if any site ever regresses to a hand-maintained subset.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ALL_API_KEY_BACKENDS } from '@lib/ai-client/types';

vi.mock('../resilience', () => ({
  resilientFetch: vi.fn(),
  categorizeEndpoint: () => 'data',
  registerConnectionPoolProvider: vi.fn(),
}));

vi.mock('@lib/debate/errors', () => ({
  ActionableError: class ActionableError extends Error {},
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

vi.mock('../instrumentBridge', () => ({
  instrumentBridge: (raw: unknown) => raw,
}));

vi.mock('../../utils/keyShareCrypto', () => ({
  encryptKeysForSharing: vi.fn(),
  decryptKeysFromSharing: vi.fn(),
}));

vi.mock('../../hooks/useQuotaWarning', () => ({
  onQuotaMilestone: vi.fn(),
}));

// isAnonymous() calls fetch('/api/auth/me'); returning { anonymous: true } routes
// every key method through the sessionStorage BYOK branch under test.
const mockGlobalFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal('fetch', mockGlobalFetch);

function anonMeResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => Promise.resolve({ anonymous: true }),
    text: () => Promise.resolve('{"anonymous":true}'),
    clone() { return anonMeResponse(); },
  } as unknown as Response;
}

describe('web-bridge BYOK key paths cover all backends (t/1958)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockGlobalFetch.mockResolvedValue(anonMeResponse());
  });

  it('the two previously-omitted backends are in the canonical list', () => {
    expect(ALL_API_KEY_BACKENDS).toContain('zai');
    expect(ALL_API_KEY_BACKENDS).toContain('moonshot');
  });

  it('deleteAllApiKeys removes a stored key for every backend (incl. zai/moonshot)', async () => {
    for (const b of ALL_API_KEY_BACKENDS) {
      sessionStorage.setItem(`byok-${b}`, JSON.stringify([`key-${b}`]));
    }
    // Sanity: the previously-missed backends were actually written.
    expect(sessionStorage.getItem('byok-zai')).not.toBeNull();
    expect(sessionStorage.getItem('byok-moonshot')).not.toBeNull();

    const { api } = await import('../web-bridge');
    await api.deleteAllApiKeys();

    for (const b of ALL_API_KEY_BACKENDS) {
      expect(sessionStorage.getItem(`byok-${b}`)).toBeNull();
    }
  });

  it('getApiKeySummary reports every backend, including zai and moonshot', async () => {
    sessionStorage.setItem('byok-zai', JSON.stringify(['key-zai']));
    sessionStorage.setItem('byok-moonshot', JSON.stringify(['key-moonshot']));

    const { api } = await import('../web-bridge');
    const summary = await api.getApiKeySummary();

    const byBackend = new Map(summary.map((s) => [s.backend, s]));
    for (const b of ALL_API_KEY_BACKENDS) {
      expect(byBackend.has(b)).toBe(true);
    }
    expect(byBackend.get('zai')?.hasKey).toBe(true);
    expect(byBackend.get('moonshot')?.hasKey).toBe(true);
  });
});
