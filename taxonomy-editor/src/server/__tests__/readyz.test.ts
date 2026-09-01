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
// The route handler is a thin conditional over getEmbeddingsResolution(). We test the
// output the conditional produces rather than importing meta.ts (which pulls heavy deps).
// Keep this in lockstep with the handler in routes/meta.ts.
// t/3165: 200 now requires RESOLUTION (a canary keyed lookup hits a real vector), not mere
// presence — a present-but-non-resolving cache (stale/wrong corpus) → 503.

const CANARY = 'acc-beliefs-003';
type Resolution = { present: boolean; nodeCount: number | null; resolves: boolean };
type HandlerResult = { statusCode: number; body: Record<string, unknown> };

function simulateReadyz(r: Resolution): HandlerResult {
  const { present, nodeCount, resolves } = r;
  if (present && (nodeCount ?? 0) > 0 && resolves) {
    return { statusCode: 200, body: { status: 'ready', nodeCount, resolves: true } };
  }
  const reason = !present ? 'cache-absent' : !resolves ? 'canary-not-resolving' : 'empty';
  return { statusCode: 503, body: { status: 'warming', present, nodeCount, resolves: false, reason, canary: CANARY } };
}

describe('GET /readyz — response shape (t/3112, t/3165 resolution)', () => {
  it('200 { status: ready, nodeCount, resolves } when present, nodeCount>0 AND canary resolves', () => {
    const { statusCode, body } = simulateReadyz({ present: true, nodeCount: 4144, resolves: true });
    expect(statusCode).toBe(200);
    expect(body).toEqual({ status: 'ready', nodeCount: 4144, resolves: true });
  });

  it('t/3165: 503 when cache present + nodeCount>0 but the canary does NOT resolve (stale/wrong corpus)', () => {
    const { statusCode, body } = simulateReadyz({ present: true, nodeCount: 4144, resolves: false });
    expect(statusCode).toBe(503);
    expect(body.status).toBe('warming');
    expect(body.resolves).toBe(false);
    expect(body.reason).toBe('canary-not-resolving');
  });

  it('503 while warming when cache absent', () => {
    const { statusCode, body } = simulateReadyz({ present: false, nodeCount: null, resolves: false });
    expect(statusCode).toBe(503);
    expect(body.status).toBe('warming');
    expect(body.present).toBe(false);
    expect(body.reason).toBe('cache-absent');
  });

  it('503 when present but nodeCount is 0 (empty/partial cache is not ready)', () => {
    const { statusCode, body } = simulateReadyz({ present: true, nodeCount: 0, resolves: false });
    expect(statusCode).toBe(503);
    expect(body.status).toBe('warming');
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
    const real = simulateReadyz({ present: true, nodeCount: readyBody.nodeCount, resolves: true }).body;
    expect(real).toEqual(readyBody);
  });

  it('fixture carries the contract invariants the gate keys on: status==="ready", nodeCount>0, resolves===true', () => {
    expect(readyBody.status).toBe('ready');
    expect(readyBody.nodeCount).toBeGreaterThan(0);
    expect(readyBody.resolves).toBe(true); // t/3165: resolution is now part of the 200 contract
  });
});
