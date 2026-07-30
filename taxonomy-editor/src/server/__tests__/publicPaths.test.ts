// @vitest-environment node

/**
 * t/1910 — the auth-exempt allowlist extracted from handleRequestInner's isPublicPath
 * OR-chain into publicPaths.ts. This table test pins the exact behavior (Server Auth
 * guardrail, p/135#9): every one of the 22 terms resolves public, and near-miss paths
 * do NOT — proving each term kept its exact-vs-prefix match-kind (an exact term must
 * not behave like a prefix, which would widen the allowlist = auth bypass).
 */

import { describe, it, expect } from 'vitest';
import { computeIsPublicPath, PUBLIC_EXACT_PATHS, PUBLIC_PATH_PREFIXES } from '../publicPaths.js';

describe('computeIsPublicPath — auth-exempt allowlist (t/1910)', () => {
  it('has exactly 15 exact + 7 prefix terms (guards accidental add/drop)', () => {
    expect(PUBLIC_EXACT_PATHS.size).toBe(15);
    expect(PUBLIC_PATH_PREFIXES.length).toBe(7);
  });

  it('every exact-match path resolves public', () => {
    for (const p of PUBLIC_EXACT_PATHS) expect(computeIsPublicPath(p)).toBe(true);
  });

  it('every prefix (and a path under it) resolves public', () => {
    for (const prefix of PUBLIC_PATH_PREFIXES) {
      expect(computeIsPublicPath(prefix)).toBe(true);          // the bare prefix
      expect(computeIsPublicPath(`${prefix}sub/thing`)).toBe(true); // something under it
    }
  });

  it('the full 22-path allowlist resolves public', () => {
    const samples = [...PUBLIC_EXACT_PATHS, ...PUBLIC_PATH_PREFIXES.map(p => `${p}anything`)];
    expect(samples.every(computeIsPublicPath)).toBe(true);
    expect(samples.length).toBe(22);
  });

  // Near-miss NEGATIVES (Server Auth p/135#9): each proves an EXACT term did not become
  // a prefix, and a PREFIX still needs its full boundary.
  it.each([
    '/api/models-x',      // NOT /api/models (exact term, not a prefix)
    '/api/models/extra',  // NOT /api/models
    '/health/x',          // NOT /health
    '/sw.jsx',            // NOT /sw.js — the exact/prefix flip pair
    '/api/publicX',       // NOT under /api/public/ (prefix needs the trailing slash)
    '/shareX',            // NOT under /share/
    '/workbox',           // NOT /workbox- (prefix needs the hyphen)
    '/api/private/thing', // not auth-exempt at all
    '/',                  // root is NOT public (goes through the auth gate)
    '',                   // empty path
  ])('near-miss %j is NOT public', (p) => {
    expect(computeIsPublicPath(p)).toBe(false);
  });
});
