// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression for t/2980: the web-bridge put()/del() helpers called res.json()
// unconditionally, so a 204 No Content response (empty body) threw
// "SyntaxError: Failed to execute 'json' on 'Response': Unexpected end of JSON input".
// PUT /api/preferences returns 204 on success, so setPreferences silently failed to
// persist. The guard `if (res.status === 204) return undefined` fixes both helpers.
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => undefined }));

import { api } from './web-bridge';

describe('web-bridge 204 No Content handling (t/2980)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('setPreferences resolves (no SyntaxError) when PUT returns 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    // Before the fix, put() → res.json() on the empty 204 body rejected with SyntaxError.
    await expect(api.setPreferences({} as never)).resolves.toBeUndefined();

    const putCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/preferences'));
    expect(putCall, 'expected a fetch to PUT /api/preferences').toBeTruthy();
    expect((putCall![1] as RequestInit | undefined)?.method).toBe('PUT');
  });

  it('a 200 JSON response still parses normally (guard is 204-specific)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ theme: 'dark' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // getPreferences uses get(); a real JSON body must still be read (no regression).
    await expect(api.getPreferences()).resolves.toMatchObject({ theme: 'dark' });
  });
});
