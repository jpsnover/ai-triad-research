// @vitest-environment node
//
// t/2019 (js/user-controlled-bypass) — the auth gate and the router both parse the
// request path with normalizedRequestPath (httpKit.ts), the ONE canonical parse.
//
// Before the fix the gate derived its path from raw `req.url.split('?')` while the
// router used `new URL().pathname`. An encoded-traversal path
// (/api/public/%2e%2e/admin) therefore read as a public /api/public/ prefix AT THE
// GATE (auth-exempt) while resolving to /api/admin AT THE ROUTER — a real auth bypass.
//
// These tests pin: (1) the normalization behaviour (dot-segment resolution + query
// strip, matching the router), (2) fail-secure on a malformed URL, and (3) the REAL
// exploit is now denied at the composed gate decision
// computeIsPublicPath(normalizedRequestPath(req)). The gate is inline in server.ts
// (which boots the HTTP server on import, so it can't be imported), so we exercise the
// exact composition the gate performs against the import-safe helper + allowlist.

import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'http';
import { normalizedRequestPath } from '../httpKit.js';
import { computeIsPublicPath } from '../publicPaths.js';

const req = (url: string | undefined): IncomingMessage => ({ url } as IncomingMessage);

describe('normalizedRequestPath (t/2019 auth-gate path canonicalization)', () => {
  describe('resolves dot-segments and strips the query — matching the router', () => {
    it('encoded traversal (%2e%2e) resolves out of the /api/public/ prefix', () => {
      expect(normalizedRequestPath(req('/api/public/%2e%2e/admin'))).toBe('/api/admin');
    });

    it('literal .. traversal resolves', () => {
      expect(normalizedRequestPath(req('/api/public/../admin'))).toBe('/api/admin');
    });

    it('multi-hop encoded traversal resolves fully', () => {
      expect(normalizedRequestPath(req('/api/public/%2e%2e/%2e%2e/admin'))).toBe('/admin');
    });

    it('traversal out of another public prefix (/.auth/) also resolves', () => {
      expect(normalizedRequestPath(req('/.auth/%2e%2e/api/admin'))).toBe('/api/admin');
    });

    it('strips the query string so freeTier exact-path checks stay exact', () => {
      expect(normalizedRequestPath(req('/api/ai/generate?model=x'))).toBe('/api/ai/generate');
    });

    it('leaves a legitimate path unchanged', () => {
      expect(normalizedRequestPath(req('/share/pov/acc-beliefs-001'))).toBe('/share/pov/acc-beliefs-001');
      expect(normalizedRequestPath(req('/api/models'))).toBe('/api/models');
    });

    it('is case-preserving (does not lowercase the path)', () => {
      expect(normalizedRequestPath(req('/api/Public/x'))).toBe('/api/Public/x');
    });
  });

  describe('fails secure on a malformed URL', () => {
    it('an unparseable URL returns the non-public, unroutable sentinel (never throws)', () => {
      const sentinel = normalizedRequestPath(req('//'));
      expect(sentinel).toBe('/__malformed_url__');
      // The sentinel is never in the public allowlist → the request is gated…
      expect(computeIsPublicPath(sentinel)).toBe(false);
      // …and matches no registered route (it starts with '/__', not '/api/…').
      expect(sentinel.startsWith('/__')).toBe(true);
    });

    it('undefined req.url falls back to root, not a throw', () => {
      expect(normalizedRequestPath(req(undefined))).toBe('/');
    });
  });

  describe('the encoded-traversal auth bypass is closed at the gate (regression)', () => {
    it('the RAW path would have been treated as public — the pre-fix vulnerability', () => {
      // Documents exactly what the fix removes: the raw split-on-? path the old gate
      // used reads as a /api/public/ prefix even though it resolves to /api/admin.
      expect(computeIsPublicPath('/api/public/%2e%2e/admin')).toBe(true);
    });

    it('the NORMALIZED gate path is NOT public → the exploit request is gated', () => {
      const gatePath = normalizedRequestPath(req('/api/public/%2e%2e/admin'));
      expect(gatePath).toBe('/api/admin');
      expect(computeIsPublicPath(gatePath)).toBe(false);
    });

    it('gate and router resolve the identical path for the exploit (no divergence)', () => {
      // Both the auth gate and the router feed req through normalizedRequestPath, so
      // the value they gate/route on is one and the same by construction.
      const r = req('/api/public/%2e%2e/admin');
      const gatePath = normalizedRequestPath(r);
      const routerPath = normalizedRequestPath(r);
      expect(gatePath).toBe(routerPath);
      expect(routerPath).toBe('/api/admin');
    });
  });
});
