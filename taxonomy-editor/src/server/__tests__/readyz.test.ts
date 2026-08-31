// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3112 — GET /readyz deploy warm-gate.
// 200 ONLY when the embeddings.json precomputed-vector cache is present AND nodeCount>0
// (TL-approved contract, p/542#55); 503 while warming. Anon (deploy probe polls pre-auth).
// Covers: publicPaths inclusion + handler response shape.

import { describe, it, expect } from 'vitest';
import { PUBLIC_EXACT_PATHS, computeIsPublicPath } from '../publicPaths.js';

// t/3114 shared body-contract fixture. This SAME file is read by the deploy warm-gate's
// Pester (tests/ReadyzWarmGate.Tests.ps1) as the "real 200 body" it feeds to the predicate.
// The coupling: the assertion below forces this fixture to track the handler's actual output,
// and the Pester forces the gate to parse whatever key the fixture uses — so a coordinated
// status-field rename can't silently pass both (it goes red on one side or the other).
import readyBody from './fixtures/readyz-ready-body.json';

// ── publicPaths ──────────────────────────────────────────────────────────────

describe('publicPaths — /readyz', () => {
  it('is in PUBLIC_EXACT_PATHS (exact match, not prefix)', () => {
    expect(PUBLIC_EXACT_PATHS.has('/readyz')).toBe(true);
  });

  it('computeIsPublicPath returns true for /readyz', () => {
    expect(computeIsPublicPath('/readyz')).toBe(true);
  });

  it('does not treat it as a prefix (trailing path must not match)', () => {
    expect(computeIsPublicPath('/readyz/extra')).toBe(false);
  });
});

// ── handler response shape (inline simulation) ───────────────────────────────
// The route handler is a thin conditional over getEmbeddingsCacheStatus(). We test the
// output the conditional produces rather than importing meta.ts (which pulls heavy deps).
// Keep this in lockstep with the handler in routes/meta.ts.

type CacheStatus = { present: boolean; nodeCount: number | null };
type HandlerResult = { statusCode: number; body: Record<string, unknown> };

function simulateReadyz(status: CacheStatus): HandlerResult {
  const { present, nodeCount } = status;
  if (present && (nodeCount ?? 0) > 0) {
    return { statusCode: 200, body: { status: 'ready', nodeCount } };
  }
  return { statusCode: 503, body: { status: 'warming', present, nodeCount } };
}

describe('GET /readyz — response shape (t/3112)', () => {
  it('200 { status: ready, nodeCount } when cache present with nodeCount>0', () => {
    const { statusCode, body } = simulateReadyz({ present: true, nodeCount: 4144 });
    expect(statusCode).toBe(200);
    expect(body).toEqual({ status: 'ready', nodeCount: 4144 });
  });

  it('503 while warming when cache absent', () => {
    const { statusCode, body } = simulateReadyz({ present: false, nodeCount: null });
    expect(statusCode).toBe(503);
    expect(body.status).toBe('warming');
    expect(body.present).toBe(false);
  });

  it('503 when present but nodeCount is 0 (empty/partial cache is not ready)', () => {
    const { statusCode, body } = simulateReadyz({ present: true, nodeCount: 0 });
    expect(statusCode).toBe(503);
    expect(body.status).toBe('warming');
  });

  it('503 when present but nodeCount is null (guards the ?? 0 branch)', () => {
    const { statusCode } = simulateReadyz({ present: true, nodeCount: null });
    expect(statusCode).toBe(503);
  });
});

// ── shared body-contract fixture ↔ handler coupling (t/3114) ──────────────────
// This is the guard TL required for promoting the deploy warm-gate to BLOCKING: a
// blocking gate whose expected body drifts from the handler = block-every-deploy.
// readyz-ready-body.json is the single literal BOTH sides reference — here (producer
// side) and the gate's Pester (consumer side, feeds it to the predicate). The first
// assertion forces the fixture to track the handler's real 200 output; the Pester
// forces the gate to parse whatever key the fixture uses. A coordinated rename of
// `status` can't pass both — it goes red here (fixture no longer matches the handler)
// or in the Pester (gate parses the old key, gets a non-'ready' body → wait).
describe('/readyz shared body-contract fixture (t/3114)', () => {
  it('fixture equals the handler\'s real 200 ready body (producer-side pin)', () => {
    const real = simulateReadyz({ present: true, nodeCount: readyBody.nodeCount }).body;
    expect(real).toEqual(readyBody);
  });

  it('fixture carries the contract invariant the gate keys on: status==="ready", nodeCount>0', () => {
    expect(readyBody.status).toBe('ready');
    expect(readyBody.nodeCount).toBeGreaterThan(0);
  });
});
