// @vitest-environment node

/**
 * t/720 — pure access-control decisions extracted from server.ts.
 * L1 (AUTH_DISABLED production block), L3 (clone target containment),
 * L6 (terminal WebSocket admin gate).
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { isAuthDisabledAllowed, isPathWithinDir, isTerminalAccessAllowed, isAnonAllowedRoute } from '../accessControl.js';

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
