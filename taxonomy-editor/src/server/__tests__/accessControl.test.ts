// @vitest-environment node

/**
 * t/720 — pure access-control decisions extracted from server.ts.
 * L1 (AUTH_DISABLED production block), L3 (clone target containment),
 * L6 (terminal WebSocket admin gate).
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { isAuthDisabledAllowed, isPathWithinDir, isTerminalAccessAllowed, isAnonAllowedRoute, invalidRouteParam, callerTierIdentity, clientSafeMessage, missingApiKeyError, expiredAuthCookies, hasEasyAuthSessionCookie } from '../security/accessControl.js';
import { resolveTier } from '../ai/proxyTiers.js';

describe('expiredAuthCookies (t/897)', () => {
  it('expires every AppServiceAuthSession cookie present plus the canonical name', () => {
    const out = expiredAuthCookies(['AppServiceAuthSession', 'AppServiceAuthSession1', 'other', 'anon_session_id']);
    expect(out.some(c => c.startsWith('AppServiceAuthSession='))).toBe(true);
    expect(out.some(c => c.startsWith('AppServiceAuthSession1='))).toBe(true);
    expect(out.some(c => c.startsWith('other='))).toBe(false); // non-auth cookies untouched
  });

  it('always expires the canonical cookie even when none are present', () => {
    const out = expiredAuthCookies([]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^AppServiceAuthSession=;/);
  });

  it('each expiry sets Max-Age=0 and Path=/ so the browser deletes it', () => {
    for (const c of expiredAuthCookies(['AppServiceAuthSession'])) {
      expect(c).toContain('Max-Age=0');
      expect(c).toContain('Path=/');
    }
  });
});

describe('hasEasyAuthSessionCookie (t/940)', () => {
  it('detects a present Easy Auth session cookie, including chunked variants', () => {
    expect(hasEasyAuthSessionCookie(['AppServiceAuthSession'])).toBe(true);
    expect(hasEasyAuthSessionCookie(['other', 'AppServiceAuthSession1'])).toBe(true);
    expect(hasEasyAuthSessionCookie(['appserviceauthsession'])).toBe(true); // case-insensitive
  });

  it('is false when no Easy Auth cookie is present (fresh session → no auto-clear)', () => {
    expect(hasEasyAuthSessionCookie([])).toBe(false);
    expect(hasEasyAuthSessionCookie(['anon_session_id', 'auth_anonymous'])).toBe(false);
  });
});

describe('missingApiKeyError (t/896)', () => {
  const base = { backend: 'claude', displayName: 'Claude (Anthropic)' };

  it('returns a structured 422 payload when no key is available (AC#1,#2)', () => {
    const out = missingApiKeyError({ ...base, serverProvidedKey: false, haveExplicitKey: false, hasResolvedKey: false });
    expect(out).toEqual({
      error: 'missing_api_key',
      backend: 'claude',
      message: 'No API key configured for Claude (Anthropic). Add one in Settings → API Keys.',
    });
  });

  it('returns null (proceed) when the free tier provides the key (AC#3)', () => {
    expect(missingApiKeyError({ ...base, serverProvidedKey: true, haveExplicitKey: false, hasResolvedKey: false })).toBeNull();
  });

  it('returns null when the caller supplied a key or one resolved from env/store', () => {
    expect(missingApiKeyError({ ...base, serverProvidedKey: false, haveExplicitKey: true, hasResolvedKey: true })).toBeNull();
    expect(missingApiKeyError({ ...base, serverProvidedKey: false, haveExplicitKey: false, hasResolvedKey: true })).toBeNull();
  });
});

describe('clientSafeMessage (t/853)', () => {
  const dump = [
    '', '  Goal:     Load chat session',
    '  Error:    Chat not found', '  Location: server/fileIO.ts → loadChatSession',
    '  Resolve:', '  1. Check the id',
  ].join('\n');

  it('strips ActionableError internals from a cause in production (goal: problem only)', () => {
    const cause = { goal: 'Load chat session', problem: 'Chat not found', location: 'server/fileIO.ts', nextSteps: ['x'] };
    const out = clientSafeMessage('whatever', cause, true);
    expect(out).toBe('Load chat session: Chat not found');
    expect(out).not.toMatch(/Location|Resolve|fileIO/);
  });

  it('strips a serialized ActionableError dump message in production', () => {
    const out = clientSafeMessage(dump, undefined, true);
    expect(out).toBe('Load chat session: Chat not found');
    expect(out).not.toMatch(/Location|Resolve|fileIO/);
  });

  it('passes plain validation messages through unchanged', () => {
    expect(clientSafeMessage('rating must be "up" or "down"', undefined, true)).toBe('rating must be "up" or "down"');
  });

  it('returns the full message in development (unchanged)', () => {
    expect(clientSafeMessage(dump, undefined, false)).toBe(dump);
  });
});

describe('callerTierIdentity (t/848)', () => {
  it('returns the principal/idp for an authenticated context', () => {
    expect(callerTierIdentity({ principalName: 'alice', idp: 'github', isAnonymous: false }))
      .toEqual({ principalName: 'alice', idp: 'github' });
  });

  it('maps anonymous / null context to an empty principal', () => {
    expect(callerTierIdentity({ principalName: '_local', idp: '_local', isAnonymous: true }))
      .toEqual({ principalName: '', idp: '' });
    expect(callerTierIdentity(null)).toEqual({ principalName: '', idp: '' });
  });

  it('an anonymous context never resolves to the platform tier (no header-spoof escalation)', () => {
    // Even if a spoofed x-ms-client-principal-* header existed, the verified
    // context is anonymous → empty principal → resolveTier is not platform.
    const id = callerTierIdentity({ principalName: '_local', idp: '_local', isAnonymous: true });
    expect(resolveTier(id.principalName, id.idp).level).not.toBe('platform');
  });
});

describe('isAuthDisabledAllowed (L1)', () => {
  it('blocks AUTH_DISABLED in production', () => {
    expect(isAuthDisabledAllowed({ AUTH_DISABLED: '1', NODE_ENV: 'production' })).toBe(false);
  });
  it('allows AUTH_DISABLED outside production', () => {
    expect(isAuthDisabledAllowed({ AUTH_DISABLED: '1', NODE_ENV: 'development' })).toBe(true);
    expect(isAuthDisabledAllowed({ AUTH_DISABLED: '1' })).toBe(true);
  });
  it('is false when AUTH_DISABLED is not exactly "1"', () => {
    expect(isAuthDisabledAllowed({ AUTH_DISABLED: '0' })).toBe(false);
    expect(isAuthDisabledAllowed({})).toBe(false);
  });
});

describe('isPathWithinDir (L3)', () => {
  const base = path.resolve('data-root');
  it('accepts the base itself and nested paths', () => {
    expect(isPathWithinDir(base, base)).toBe(true);
    expect(isPathWithinDir(path.join(base, 'sub', 'file.json'), base)).toBe(true);
  });
  it('rejects paths outside the base', () => {
    expect(isPathWithinDir(path.resolve('elsewhere'), base)).toBe(false);
    expect(isPathWithinDir(path.join(base, '..', 'evil'), base)).toBe(false); // traversal
    expect(isPathWithinDir(base + '-evil', base)).toBe(false);                // sibling prefix trick
  });
});

describe('isAnonAllowedRoute (t/763 anon_route_blocked classification)', () => {
  it('allows read-only GETs', () => {
    expect(isAnonAllowedRoute('GET', '/api/taxonomy/accelerationist')).toBe(true);
    expect(isAnonAllowedRoute('GET', '/api/edges')).toBe(true);
    expect(isAnonAllowedRoute('GET', '/api/community/debates')).toBe(true);
  });
  it('blocks AI/inference routes regardless of method', () => {
    for (const p of ['/api/keys/has', '/api/ai/chat', '/api/embeddings/x', '/api/nli/x',
      '/api/evidence-qbaf', '/api/models/refresh', '/api/harvest/concept']) {
      expect(isAnonAllowedRoute('GET', p)).toBe(false);
    }
    expect(isAnonAllowedRoute('GET', '/api/debates/abc/news-report')).toBe(false);
  });

  it('allows anon POST to /api/ai/temperature despite the /api/ai/ block (t/811)', () => {
    // Local server config — no key, no cost, no abuse vector. Chat + debates set
    // temperature before generation; the carve-out must precede the AI block.
    expect(isAnonAllowedRoute('POST', '/api/ai/temperature')).toBe(true);
    // Still blocks the other AI routes (the carve-out is exact-path only).
    expect(isAnonAllowedRoute('POST', '/api/ai/generate')).toBe(false);
    expect(isAnonAllowedRoute('POST', '/api/ai/temperature/x')).toBe(false);
  });

  it('allows anon POST to /api/admin/errors (t/811)', () => {
    expect(isAnonAllowedRoute('POST', '/api/admin/errors')).toBe(true);
  });
  it('allows anonymous save/delete of own ephemeral chats and debates', () => {
    expect(isAnonAllowedRoute('PUT', '/api/debates')).toBe(true);
    expect(isAnonAllowedRoute('DELETE', '/api/debates/abc')).toBe(true);
    expect(isAnonAllowedRoute('PUT', '/api/chats')).toBe(true);
    expect(isAnonAllowedRoute('DELETE', '/api/chats/xyz')).toBe(true);
  });
  it('blocks other writes', () => {
    expect(isAnonAllowedRoute('PUT', '/api/taxonomy/accelerationist')).toBe(false);
    expect(isAnonAllowedRoute('DELETE', '/api/conflicts/c1')).toBe(false);
    expect(isAnonAllowedRoute('POST', '/api/something-random')).toBe(false);
  });
  it('allows allowlisted read-like POSTs', () => {
    expect(isAnonAllowedRoute('POST', '/api/analytics/event')).toBe(true);
    expect(isAnonAllowedRoute('POST', '/api/community/submit')).toBe(true);
    expect(isAnonAllowedRoute('POST', '/api/debates/export')).toBe(true);
  });
});

describe('isTerminalAccessAllowed (L6)', () => {
  it('allows when AUTH_DISABLED (single-operator local mode)', () => {
    expect(isTerminalAccessAllowed({ authDisabled: true, principalName: '', isAdmin: false })).toBe(true);
  });
  it('requires an admin principal when auth is enabled', () => {
    expect(isTerminalAccessAllowed({ authDisabled: false, principalName: '', isAdmin: false })).toBe(false);
    expect(isTerminalAccessAllowed({ authDisabled: false, principalName: 'alice', isAdmin: false })).toBe(false);
    expect(isTerminalAccessAllowed({ authDisabled: false, principalName: 'alice', isAdmin: true })).toBe(true);
  });
});

describe('invalidRouteParam (t/810)', () => {
  it('passes well-formed params', () => {
    expect(invalidRouteParam('/api/debates/:id', '/api/debates/abc-123')).toBeNull();
    expect(invalidRouteParam('/api/edges/:index', '/api/edges/42')).toBeNull();
    expect(invalidRouteParam('/api/community/:type/:id', '/api/community/chats/9f8e')).toBeNull();
    expect(invalidRouteParam('/api/taxonomy/:pov', '/api/taxonomy/accelerationist')).toBeNull();
    expect(invalidRouteParam('/api/taxonomy/:pov/node/:nodeId/history', '/api/taxonomy/saf/node/saf-bel-001/history')).toBeNull();
    expect(invalidRouteParam('/health', '/health')).toBeNull(); // no params
  });

  it('rejects path traversal (raw, encoded, null byte) on id params', () => {
    expect(invalidRouteParam('/api/debates/:id', '/api/debates/%2e%2e')).toBe('id');       // encoded ..
    expect(invalidRouteParam('/api/debates/:id', '/api/debates/%2e%2e%2fetc')).toBe('id'); // encoded ../etc
    expect(invalidRouteParam('/api/debates/:id', '/api/debates/foo%00')).toBe('id');       // null byte
    expect(invalidRouteParam('/api/debates/:id', '/api/debates/a.b')).toBe('id');          // dot not allowed for id
  });

  it('rejects malformed percent-encoding', () => {
    expect(invalidRouteParam('/api/debates/:id', '/api/debates/%zz')).toBe('id');
  });

  it('allows dotted filenames but blocks traversal', () => {
    expect(invalidRouteParam('/api/flight-recorder/download/:filename', '/api/flight-recorder/download/dump-2026.json')).toBeNull();
    expect(invalidRouteParam('/api/proposals/:filename', '/api/proposals/%2e%2e')).toBe('filename'); // ".."
    expect(invalidRouteParam('/api/proposals/:filename', '/api/proposals/a%2fb')).toBe('filename');  // a/b
  });

  it('allows colon in review group ids but blocks traversal', () => {
    expect(invalidRouteParam('/api/admin/review/detail/:groupId', '/api/admin/review/detail/calibration%3Ajpsnover')).toBeNull();
    expect(invalidRouteParam('/api/admin/review/detail/:groupId', '/api/admin/review/detail/community%3Aabc-1')).toBeNull();
    expect(invalidRouteParam('/api/admin/review/detail/:groupId', '/api/admin/review/detail/%2e%2e%2fx')).toBe('groupId');
  });

  it('rejects invalid pov names', () => {
    expect(invalidRouteParam('/api/taxonomy/:pov', '/api/taxonomy/%2e%2e')).toBe('pov');
    expect(invalidRouteParam('/api/taxonomy/:pov', '/api/taxonomy/ACC')).toBe('pov'); // uppercase not allowed
  });
});
