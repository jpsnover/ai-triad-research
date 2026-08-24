// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/2978 — write/read identity contract for analytics `user`.
 *
 * The bug: the emitter stamped events with the RAW principal from /api/auth/me
 * (e.g. `a@b.com`), while "Your Activity" + the engagement self-filter query by the
 * DERIVED storage id from /api/user/profile (deriveStorageUserId → `a-at-b-com`). For
 * any principal the derivation rewrites, written events never matched the query →
 * empty panel. resolveAnalyticsUser MUST return the derived id for authenticated users
 * (so writes match reads), and the per-session anon key for anonymous users.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveAnalyticsUser } from '../analyticsEmitter';

/** fetch stub: match by URL substring → ok:true with the mapped JSON; miss → ok:false. */
function stubFetch(map: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const key = Object.keys(map).find(k => url.includes(k));
    return key
      ? Promise.resolve({ ok: true, json: () => Promise.resolve(map[key]) })
      : Promise.resolve({ ok: false });
  }));
}

describe('resolveAnalyticsUser — write/read identity contract (t/2978)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('authenticated: returns the DERIVED storage id from /api/user/profile, NOT the raw principal', async () => {
    stubFetch({
      '/api/user/profile': { userId: 'jsnover13-at-gmail-com', isAnonymous: false },
      '/api/auth/me': { user: 'jsnover13@gmail.com' }, // raw principal — must NOT be used
    });
    expect(await resolveAnalyticsUser()).toBe('jsnover13-at-gmail-com');
  });

  it('anonymous: keeps the per-session anon key from /api/auth/me (never the collapsed profile.userId)', async () => {
    stubFetch({
      '/api/user/profile': { userId: '_local_local', isAnonymous: true },
      '/api/auth/me': { user: 'anon-abc123' },
    });
    expect(await resolveAnalyticsUser()).toBe('anon-abc123');
  });

  it('falls back to the anon key when profile is unavailable but auth/me responds', async () => {
    stubFetch({ '/api/auth/me': { user: 'anon-xyz' } }); // profile → ok:false
    expect(await resolveAnalyticsUser()).toBe('anon-xyz');
  });

  it('falls back to _anonymous when both endpoints fail', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    expect(await resolveAnalyticsUser()).toBe('_anonymous');
  });

  it('falls back to _anonymous when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))));
    expect(await resolveAnalyticsUser()).toBe('_anonymous');
  });
});
